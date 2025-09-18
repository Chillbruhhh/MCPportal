"""
Server Management API.

This module provides the FastAPI application factory and
server management endpoints for the MCP Gateway.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
import json

from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .dependencies import get_gateway, set_gateway
from .middleware import setup_middleware
from .routes import router as api_router
from ..config.settings import Settings
from ..core.gateway import MCPGateway
from ..ui.sse import create_event_stream, sse_manager, start_periodic_updates
from ..mcp_server import get_gateway_server
from ..db.client import get_database_client
from ..core.agent_manager import AgentManager
from ..core.stack_manager import StackManager
from .agent_routes import router as agent_router, init_agent_routes
from .stack_routes import router as stack_router, init_stack_routes

logger = logging.getLogger(__name__)


async def handle_mcp_message(message: dict, gateway_instance=None):
    """Handle MCP message and return response"""
    # For now, handle basic initialize and other common requests
    method = message.get("method", "")
    
    # Skip notifications - they're handled in the endpoint directly
    if method.startswith("notifications/"):
        logger.info(f"Skipping notification in handle_mcp_message: {method}")
        return {"status": "notification_handled_elsewhere"}
    
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": message.get("id"),
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {},
                    "resources": {},
                    "prompts": {}
                },
                "serverInfo": {
                    "name": "MCP Gateway",
                    "version": "1.0.0"
                }
            }
        }

    elif method == "tools/list":
        # Get the actual aggregated tools from the gateway
        try:
            if gateway_instance and hasattr(gateway_instance, 'get_aggregated_tools'):
                tools = gateway_instance.get_aggregated_tools()
                # Convert to standard MCP tool format
                tools_data = []
                for tool in tools:
                    # Use the actual input schema stored in the aggregated tool (from original MCP server)
                    input_schema = tool.parameters if tool.parameters else {
                        "type": "object",
                        "properties": {}
                    }
                    
                    mcp_tool = {
                        "name": tool.prefixed_name,  # Use prefixed name as the tool name
                        "description": tool.description,
                        "inputSchema": input_schema  # Use original schema from MCP server
                    }
                    tools_data.append(mcp_tool)
                    logger.debug(f"Tool {tool.prefixed_name} from {tool.server_name} has schema: {input_schema}")
                    
                    # Log if schema is empty
                    if not input_schema or input_schema == {"type": "object", "properties": {}}:
                        logger.warning(f"Tool {tool.prefixed_name} from {tool.server_name} has empty schema! Original parameters: {tool.parameters}")
                    
                logger.info(f"Returning {len(tools_data)} aggregated tools in MCP format")
            else:
                tools_data = []
                logger.warning("No gateway instance or get_aggregated_tools method available")
                
            return {
                "jsonrpc": "2.0", 
                "id": message.get("id"),
                "result": {
                    "tools": tools_data
                }
            }
        except Exception as e:
            logger.error(f"Error getting aggregated tools: {e}")
            return {
                "jsonrpc": "2.0", 
                "id": message.get("id"),
                "result": {
                    "tools": []
                }
            }
    elif method == "tools/call":
        # Handle tool execution
        try:
            params = message.get("params", {})
            tool_name = params.get("name")
            arguments = params.get("arguments", {})
            
            if not tool_name:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {
                        "code": -32602,
                        "message": "Missing required parameter: name"
                    }
                }
            
            if not gateway_instance:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {
                        "code": -32603,
                        "message": "Gateway instance not available"
                    }
                }
            
            # Execute tool via gateway
            from ..models.gateway import ToolExecutionRequest
            tool_request = ToolExecutionRequest(
                tool_name=tool_name,
                parameters=arguments
            )
            
            result = await gateway_instance.execute_tool(tool_request)
            
            if result.success:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(result.result, indent=2) if result.result else "Tool executed successfully"
                            }
                        ]
                    }
                }
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {
                        "code": -32603,
                        "message": f"Tool execution failed: {result.error}"
                    }
                }
                
        except Exception as e:
            logger.error(f"Error in tools/call: {e}")
            return {
                "jsonrpc": "2.0",
                "id": message.get("id"),
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(e)}"
                }
            }
    elif method == "resources/list":
        # Get the actual aggregated resources from the gateway
        try:
            if gateway_instance and hasattr(gateway_instance, 'get_aggregated_resources'):
                resources = gateway_instance.get_aggregated_resources()
                resources_data = [resource.model_dump() for resource in resources]
                logger.info(f"Returning {len(resources_data)} aggregated resources")
            else:
                resources_data = []
                logger.warning("No gateway instance or get_aggregated_resources method available")
                
            return {
                "jsonrpc": "2.0", 
                "id": message.get("id"),
                "result": {
                    "resources": resources_data
                }
            }
        except Exception as e:
            logger.error(f"Error getting aggregated resources: {e}")
            return {
                "jsonrpc": "2.0", 
                "id": message.get("id"),
                "result": {
                    "resources": []
                }
            }
    elif method == "resources/read":
        # Handle resource access
        try:
            params = message.get("params", {})
            resource_uri = params.get("uri")
            
            if not resource_uri:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {
                        "code": -32602,
                        "message": "Missing required parameter: uri"
                    }
                }
            
            if not gateway_instance:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {
                        "code": -32603,
                        "message": "Gateway instance not available"
                    }
                }
            
            # Access resource via gateway
            from ..models.gateway import ResourceRequest
            resource_request = ResourceRequest(
                resource_uri=resource_uri,
                parameters=params
            )
            
            result = await gateway_instance.access_resource(resource_request)
            
            if result.success:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "result": {
                        "contents": [
                            {
                                "uri": resource_uri,
                                "mimeType": result.mime_type or "text/plain",
                                "text": result.content or ""
                            }
                        ]
                    }
                }
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {
                        "code": -32603,
                        "message": f"Resource access failed: {result.error}"
                    }
                }
                
        except Exception as e:
            logger.error(f"Error in resources/read: {e}")
            return {
                "jsonrpc": "2.0",
                "id": message.get("id"),
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(e)}"
                }
            }
    else:
        return {
            "jsonrpc": "2.0",
            "id": message.get("id"),
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}"
            }
        }


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.

    Args:
        app: FastAPI application instance
    """
    gateway = app.state.gateway
    
    # Startup
    logger.info("Starting MCP Gateway application")

    try:
        # Start gateway
        await gateway.start()

        # Start FastMCP server
        mcp_server = await get_gateway_server()
        app.state.mcp_server = mcp_server

        # Set gateway for SSE manager
        sse_manager.set_gateway(gateway)

        # Start periodic SSE updates
        await start_periodic_updates()

        logger.info("MCP Gateway application started successfully")

        yield

    except Exception as e:
        logger.error(f"Failed to start MCP Gateway: {e}")
        raise

    finally:
        # Shutdown
        logger.info("Shutting down MCP Gateway application")

        if gateway:
            await gateway.stop()

        # Close database client if present
        try:
            db_client = getattr(app.state, "db", None)
            if db_client and hasattr(db_client, "aclose"):
                await db_client.aclose()
        except Exception as e:
            logger.warning(f"Error closing database client: {e}")

        logger.info("MCP Gateway application shutdown complete")


def create_app(gateway: MCPGateway, settings: Settings) -> FastAPI:
    """
    Create and configure the FastAPI application.

    Args:
        gateway: MCP Gateway instance
        settings: Application settings

    Returns:
        Configured FastAPI application
    """
    # Create FastAPI application
    app = FastAPI(
        title="MCP Portal",
        description="Centralized Model Context Protocol Aggregation Service",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
        lifespan=lifespan
    )

    # Store gateway in app state
    app.state.gateway = gateway
    set_gateway(gateway)

    # Setup middleware
    setup_middleware(app)

    # Initialize database client (Supabase if configured, else null dev client)
    db_client = get_database_client(settings)
    app.state.db = db_client

    # Initialize managers and route dependencies
    agent_mgr = AgentManager(database_client=db_client)
    stack_mgr = StackManager(database_client=db_client, mcp_gateway=gateway)
    init_agent_routes(agent_mgr, gateway)
    init_stack_routes(stack_mgr)

    # Add nested SSE endpoints (for MCP Portal compatibility)
    @app.get("/sse/sse")
    async def nested_sse_endpoint(request: Request):
        """Nested SSE endpoint for MCP Portal compatibility (/sse/sse)"""
        logger.info("Nested SSE endpoint requested (/sse/sse)")
        return await root_sse_endpoint(request)

    @app.post("/sse/messages")
    async def nested_sse_messages_endpoint(request: Request):
        """Nested SSE messages endpoint for MCP Portal compatibility (/sse/messages)"""
        logger.info("Nested SSE messages endpoint requested (/sse/messages)")
        return await root_messages_endpoint(request)

    # Add root-level /sse endpoint (required for FastMCP compatibility)
    @app.get("/sse")
    async def root_sse_endpoint(request: Request):
        """Root-level SSE endpoint for MCP compatibility"""
        logger.info("Root-level SSE endpoint requested")
        
        # Create connection ID
        import uuid
        import asyncio
        connection_id = str(uuid.uuid4())
        logger.info(f"New root-level SSE connection: {connection_id}")
        
        # Create MCP transport and SSE stream
        from ..core.mcp_transport import MCPSSETransport
        transport = MCPSSETransport(gateway)
        
        # Return EventSourceResponse for SSE stream
        return await transport.create_mcp_sse_stream(request)

    @app.post("/sse")
    async def root_sse_post_endpoint(request: Request):
        """Root-level SSE POST endpoint for MCP clients that send initialize directly to SSE endpoint"""
        logger.info("Root-level SSE POST endpoint requested")
        
        # Get the JSON body
        try:
            body = await request.json()
            method = body.get('method', 'unknown')
            logger.info(f"Received MCP message at /sse: {body}")
        except Exception as e:
            logger.error(f"Failed to parse JSON body at /sse: {e}")
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid JSON")
        
        # Check if this is a non-initialization request without session
        # (Cursor pattern - goes straight to tools/list)
        session_id = request.headers.get("Mcp-Session-Id")
        auto_created_session = False
        
        if not method.startswith("notifications/") and method != "initialize" and not session_id:
            logger.info(f"SSE client ({method}) without session - creating auto-session")
            # Create an auto-session for clients like Cursor that skip initialization
            import uuid
            from datetime import datetime, timezone
            session_id = str(uuid.uuid4())
            auto_created_session = True
            
            # Import session storage from routes module
            from .routes import _mcp_sessions
            _mcp_sessions[session_id] = {
                "created_at": datetime.now(timezone.utc),
                "client_info": {"name": "auto-session", "source": "sse-direct"},
                "protocol_version": "2024-11-05",
                "initialized": True,  # Mark as auto-initialized
                "auto_created": True
            }
            logger.info(f"Auto-created MCP session for SSE client: {session_id}")
        
        # Handle MCP message (same as /messages endpoint)
        try:
            response = await handle_mcp_message(body, gateway)
            
            # Log client pattern for analytics
            user_agent = request.headers.get("User-Agent", "unknown")
            if auto_created_session:
                logger.info(f"SSE auto-session response to {user_agent}: {method}")
            else:
                logger.info(f"SSE standard response to {user_agent}: {method}")
            
            logger.debug(f"MCP response from /sse: {response}")
            
            # For auto-created sessions, just return the response without session headers
            # (Cursor doesn't expect session management)
            return response
        except Exception as e:
            logger.error(f"Error handling MCP message at /sse: {e}")
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail="Internal server error")

    # Add root-level /messages endpoint (required for FastMCP compatibility) - NO AUTH REQUIRED
    @app.post("/messages")
    async def root_messages_endpoint(request: Request):
        """Root-level MCP messages endpoint - NO AUTHENTICATION REQUIRED"""
        
        logger.info("Root-level MCP messages endpoint requested (no auth)")
        
        # Get the JSON body
        try:
            body = await request.json()
            logger.info(f"Received MCP message: {body}")
        except Exception as e:
            logger.error(f"Failed to parse JSON body: {e}")
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid JSON")
        
        # Forward to MCP transport
        try:
            # We can use the mcp_gateway instance to handle the request
            response = await handle_mcp_message(body, gateway)
            logger.info(f"MCP response: {response}")
            return response
        except Exception as e:
            logger.error(f"Error handling MCP message: {e}")
            from fastapi import HTTPException
            raise HTTPException(status_code=500, detail="Internal server error")

    # Disable OAuth entirely - no protected resource needed
    @app.get("/.well-known/oauth-protected-resource")
    async def oauth_protected_resource():
        """Return 404 to indicate no OAuth protection"""
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="OAuth not required")

    # Add Cline-compatible endpoint aliases for better compatibility
    @app.get("/events")
    async def cline_events_endpoint(request: Request):
        """Cline-compatible SSE events endpoint (alias for /sse)"""
        logger.info("Cline-compatible /events SSE endpoint requested")
        return await root_sse_endpoint(request)

    @app.post("/message")
    async def cline_message_endpoint(request: Request):
        """Cline-compatible message endpoint (alias for /messages)"""
        logger.info("Cline-compatible /message endpoint requested")
        return await root_messages_endpoint(request)

    # Debug endpoint for session information
    @app.get("/debug/sessions")
    async def debug_sessions():
        """Debug endpoint to show active MCP sessions"""
        try:
            from .routes import _mcp_sessions
            return {
                "total_sessions": len(_mcp_sessions),
                "sessions": {
                    session_id: {
                        "created_at": str(session_data.get("created_at")),
                        "client_info": session_data.get("client_info"),
                        "protocol_version": session_data.get("protocol_version"),
                        "initialized": session_data.get("initialized"),
                        "auto_created": session_data.get("auto_created", False)
                    }
                    for session_id, session_data in _mcp_sessions.items()
                }
            }
        except Exception as e:
            return {"error": str(e), "sessions": {}}

    # Disable OAuth authorization server
    @app.get("/.well-known/oauth-authorization-server")
    async def oauth_authorization_server():
        """Return 404 to disable OAuth"""
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="OAuth not required")

    @app.post("/register")
    async def oauth_register():
        """Disable OAuth registration"""
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="OAuth not required")

    @app.get("/authorize")
    async def oauth_authorize():
        """Disable OAuth authorization"""
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="OAuth not required")

    @app.post("/token")
    async def oauth_token():
        """Disable OAuth token"""
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="OAuth not required")

    # Include API routes (FastMCP SSE endpoint is included in these routes)
    app.include_router(api_router, prefix="/api/v1")
    # Include agents/stacks routers (they already include /api/v1 in their prefixes)
    app.include_router(agent_router)
    logger.info(f"Including stack_router with {len(stack_router.routes)} routes")
    app.include_router(stack_router)

    # Static / legacy UI (conditionally served)
    static_dir = Path(__file__).parent.parent / "ui" / "static"
    assets_dir = Path(__file__).parent.parent.parent / "assets"

    if settings.serve_legacy_ui:
        if static_dir.exists():
            app.mount("/static", StaticFiles(directory=static_dir), name="static")
        else:
            logger.warning(f"Static directory not found: {static_dir}")
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
        else:
            logger.warning(f"Assets directory not found: {assets_dir}")

        @app.get("/", response_class=HTMLResponse)
        async def root():
            html_file = static_dir / "index.html"
            if html_file.exists():
                return FileResponse(html_file)
            return HTMLResponse(
                content="""
                <html><head><title>MCP Portal</title></head>
                <body>
                  <h1>MCP Portal</h1>
                  <p>Management UI not available</p>
                  <p><a href="/api/docs">API Documentation</a></p>
                </body>
                </html>
                """,
                status_code=200,
            )

        @app.get("/ui", response_class=HTMLResponse)
        async def ui():
            return await root()
    else:
        # Minimal root when legacy UI is disabled
        @app.get("/")
        async def root_disabled():
            return {"message": "MCP Gateway running", "docs": "/api/docs"}

    # Events endpoint
    @app.get("/api/v1/events")
    async def stream_events(request: Request, gateway: MCPGateway = Depends(get_gateway)):
        """
        Server-Sent Events endpoint for real-time updates.

        Args:
            request: FastAPI request object
            gateway: Gateway instance

        Returns:
            EventSourceResponse for SSE streaming
        """
        return await create_event_stream(request, gateway)

    # Minimal dashboard WebSocket for dev to avoid 403s and support ping/metrics
    @app.websocket("/ws/dashboard")
    async def dashboard_ws(websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                try:
                    data = await websocket.receive_text()
                except WebSocketDisconnect:
                    break
                except Exception:
                    continue

                try:
                    message = json.loads(data)
                except Exception:
                    message = {}

                msg_type = message.get("type")
                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
                elif msg_type == "request_metrics":
                    metrics = gateway.get_metrics()
                    await websocket.send_text(json.dumps({"type": "metrics_update", "metrics": metrics.model_dump()}))
                # Ignore other message types for now
        finally:
            try:
                await websocket.close()
            except Exception:
                pass

    # Favicon endpoint
    @app.get("/favicon.ico")
    async def favicon():
        """
        Serve favicon.

        Returns:
            Favicon response
        """
        # Return a simple SVG favicon
        svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#2563eb"/>
        <text x="50" y="65" text-anchor="middle" fill="white" font-size="50" font-family="Arial">🌐</text>
        </svg>"""

        return HTMLResponse(content=svg_content, media_type="image/svg+xml")

    # Health check endpoint
    @app.get("/health")
    async def health():
        """
        Simple health check endpoint.

        Returns:
            Health status
        """
        try:
            if gateway:
                status = await gateway.get_status()
                return {
                    "status": "healthy",
                    "active_servers": status.active_servers,
                    "total_servers": status.total_servers,
                    "uptime": status.uptime
                }
            else:
                return {"status": "starting"}
        except Exception as e:
            logger.error(f"Health check error: {e}")
            return {"status": "error", "message": str(e)}

    # Global exception handler
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        """
        Global exception handler.

        Args:
            request: Request that caused the exception
            exc: Exception that occurred

        Returns:
            Error response
        """
        logger.error(f"Unhandled exception: {exc}", exc_info=True)

        return HTMLResponse(
            content="""
            <html>
                <head><title>Error</title></head>
                <body>
                    <h1>Internal Server Error</h1>
                    <p>An unexpected error occurred.</p>
                    <p><a href="/">Return to Home</a></p>
                </body>
            </html>
            """,
            status_code=500
        )

    return app 
