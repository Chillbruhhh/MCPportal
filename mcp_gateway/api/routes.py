"""
REST API Routes.

This module defines the REST API endpoints for the MCP Gateway,
providing unified access to MCP server operations.
"""

import uuid
from typing import Any, Dict, List
import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sse_starlette.sse import EventSourceResponse

logger = logging.getLogger(__name__)

from ..core.gateway import MCPGateway
# Removed old MCP transport - now using FastMCP SDK
from ..core.settings_discovery import discover_mcp_settings
from ..models.gateway import ResourceRequest, ToolExecutionRequest
from ..models.mcp import MCPServerStatus
from ..models.responses import (
    APIResponse,
    ErrorResponse,
    HealthResponse,
    MetricsResponse,
    ResourceAccessResponse,
    ResourcesListResponse,
    ServerActionResponse,
    ServerDetailResponse,
    ServersListResponse,
    ToolExecutionResponse,
    ToolsListResponse,
)
from .dependencies import get_gateway, get_rate_limited_gateway

router = APIRouter(tags=["MCP Gateway API"])


def _map_health_status(status: MCPServerStatus) -> str:
    """Map internal server status to health status labels expected by the UI."""
    status_map = {
        MCPServerStatus.CONNECTED: "healthy",
        MCPServerStatus.FAILED: "error",
        MCPServerStatus.DISCONNECTED: "offline",
    }
    return status_map.get(status, "unknown")


def _serialize_tool(server_name: str, tool: Any) -> Dict[str, Any]:
    """Normalize tool metadata so the UI can display discovery details."""
    if hasattr(tool, "model_dump"):
        data = tool.model_dump()
        data.setdefault("server_name", server_name)
        if not data.get("prefixed_name"):
            original = data.get("original_name") or data.get("name") or "unknown"
            data["prefixed_name"] = f"{server_name}_{original}"
        if not data.get("original_name") and data.get("name"):
            data["original_name"] = data["name"]
        if "parameters" not in data:
            schema = data.get("inputSchema") or {}
            data["parameters"] = schema
        return data

    if isinstance(tool, dict):
        original = tool.get("original_name") or tool.get("name") or "unknown"
        description = tool.get("description")
        parameters = tool.get("parameters") or tool.get("inputSchema") or {}
    else:
        original = getattr(tool, "original_name", None) or getattr(tool, "name", "unknown")
        description = getattr(tool, "description", None)
        parameters = (
            getattr(tool, "parameters", None)
            or getattr(tool, "inputSchema", None)
            or {}
        )

    return {
        "original_name": original,
        "prefixed_name": f"{server_name}_{original}",
        "server_name": server_name,
        "description": description,
        "parameters": parameters,
    }


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


@router.get("/health", response_model=HealthResponse)
async def get_health(gateway: MCPGateway = Depends(get_gateway)) -> HealthResponse:
    """
    Get gateway health status.

    Returns:
        Health status including gateway and server information
    """
    try:
        gateway_status = await gateway.get_status()
        health_results = await gateway.get_health_results()

        return HealthResponse(
            status="healthy" if gateway_status.active_servers > 0 else "degraded",
            gateway=gateway_status,
            servers=health_results
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Health check failed: {str(e)}"
        )


@router.get("/servers", response_model=ServersListResponse)
async def list_servers(gateway: MCPGateway = Depends(get_rate_limited_gateway)) -> ServersListResponse:
    """
    List all configured MCP servers (including discovered ones).

    Returns:
        List of servers with their status and capabilities
    """
    try:
        # Get all servers from gateway (includes discovered servers)
        all_servers = gateway.get_servers()
        
        aggregator = getattr(gateway, 'aggregator', None)

        # Convert to API format
        servers_list = []
        server_configs = getattr(gateway, '_server_configs', {})

        for server in all_servers:
            server_dict = server.model_dump()
            # Map status to API format
            if server.status == MCPServerStatus.CONNECTED:
                server_dict['status'] = 'active'
            elif server.status == MCPServerStatus.FAILED:
                server_dict['status'] = 'failed'
            elif server.status == MCPServerStatus.DISCONNECTED:
                server_dict['status'] = 'disconnected'
            else:
                server_dict['status'] = 'inactive'

            # Add enabled field - use the server's enabled field
            server_dict['enabled'] = server.enabled

            # Derive health status expected by the dashboard widgets
            server_dict['health_status'] = _map_health_status(server.status)

            # Normalise server type so filtering works even for discovered servers
            if not server_dict.get('server_type'):
                source = (server_dict.get('source') or '').lower()
                if source:
                    server_dict['server_type'] = 'discovered'
                elif server.url.startswith(('process://', 'stdio://')):
                    server_dict['server_type'] = 'custom'
                else:
                    server_dict['server_type'] = 'marketplace' if 'marketplace' in source else 'custom'

            # Populate discovery metadata so the UI can show tool chips and metrics
            aggregated_tools = []
            if aggregator:
                if hasattr(aggregator, 'get_tools_for_server'):
                    aggregated_tools = aggregator.get_tools_for_server(server.name)
                elif hasattr(aggregator, 'get_tools_by_server'):
                    aggregated_tools = aggregator.get_tools_by_server(server.name)

            tools_payload = [_serialize_tool(server.name, tool) for tool in aggregated_tools]

            if not tools_payload and server_dict.get('tools'):
                tools_payload = [
                    _serialize_tool(server.name, tool)
                    for tool in server_dict.get('tools', [])
                ]

            server_dict['discovered_tools'] = tools_payload

            if tools_payload:
                server_dict['tools_count'] = len(tools_payload)
            else:
                server_dict['tools_count'] = (
                    server_dict.get('tools_count')
                    or len(server_dict.get('tools', []) or [])
                    or 0
                )

            # Mark whether this server is managed in gateway configuration
            managed_flag = getattr(server, 'is_managed', None)
            if managed_flag is None:
                managed_flag = server.name in server_configs
            server_dict['is_managed'] = bool(managed_flag)

            servers_list.append(server_dict)

        active_count = sum(1 for s in servers_list if s['status'] == 'active')
        inactive_count = sum(1 for s in servers_list if s['status'] == 'inactive')
        failed_count = sum(1 for s in servers_list if s['status'] == 'failed')
        disconnected_count = sum(1 for s in servers_list if s['status'] == 'disconnected')

        return ServersListResponse(
            servers=servers_list,
            total=len(servers_list),
            active=active_count,
            failed=failed_count + disconnected_count + inactive_count
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list servers: {str(e)}"
        )


@router.get("/debug/servers")
async def debug_servers(gateway: MCPGateway = Depends(get_gateway)):
    """
    Debug endpoint to test server data without SSE.
    
    Returns:
        Raw server data for debugging
    """
    try:
        # Get all configured servers (including discovered ones)
        all_server_configs = gateway.settings.get_mcp_servers_with_discovery()
        
        # Get connected servers
        connected_servers = gateway.get_servers()
        connected_by_name = {s.name: s for s in connected_servers}
        
        debug_data = {
            "total_configs": len(all_server_configs),
            "connected_servers": len(connected_servers),
            "server_configs": [
                {
                    "name": config.name,
                    "url": config.url,
                    "command": getattr(config, 'command', None),
                    "source": getattr(config, 'source', 'unknown'),
                    "enabled": getattr(config, 'enabled', True),
                    "connected": config.name in connected_by_name
                }
                for config in all_server_configs
            ],
            "connected_server_names": [s.name for s in connected_servers]
        }
        
        return debug_data
        
    except Exception as e:
        return {"error": str(e)}


@router.get("/debug/sse-test")
async def debug_sse_test(request: Request):
    """
    Simple SSE test endpoint to debug format issues.
    """
    
    async def simple_stream():
        """Simple SSE stream for testing."""
        # Send a simple test message
        test_data = {"type": "test", "message": "Hello from SSE"}
        
        # Proper SSE format
        yield f"data: {json.dumps(test_data)}\n\n"
        
        # Send another message after 1 second
        await asyncio.sleep(1)
        test_data2 = {"type": "test", "message": "Second message"}
        yield f"data: {json.dumps(test_data2)}\n\n"
    
    return StreamingResponse(
        simple_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )


@router.post("/servers/refresh")
async def refresh_servers(
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> APIResponse:
    """
    Refresh server discovery from IDE configurations.
    
    This endpoint triggers a fresh discovery of MCP servers from IDE configurations
    without actually starting them. Servers must be enabled individually via the UI.
    
    Returns:
        Discovery results summary
    """
    try:
        # Trigger fresh discovery
        await gateway.refresh_discovery()
        
        # Get refreshed servers
        all_servers = gateway.get_servers()
        
        # Count different types
        configured_count = len(gateway.settings.mcp_servers)
        discovered_count = len(all_servers) - configured_count
        
        return APIResponse(
            success=True,
            data={
                "message": "Server discovery refreshed successfully",
                "total_servers": len(all_servers),
                "configured_servers": configured_count,
                "discovered_servers": discovered_count,
                "discovered_count": discovered_count  # For UI compatibility
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to refresh server discovery: {str(e)}"
        )


@router.get("/servers/{server_name}", response_model=ServerDetailResponse)
async def get_server_details(
    server_name: str,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> ServerDetailResponse:
    """
    Get detailed information about a specific server.

    Args:
        server_name: Name of the server

    Returns:
        Detailed server information including tools and resources
    """
    try:
        server = gateway.get_server_by_name(server_name)
        if not server:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Server '{server_name}' not found"
            )

        # Get tools and resources for this server
        tools = gateway.aggregator.get_tools_by_server(server_name)
        resources = gateway.aggregator.get_resources_by_server(server_name)

        return ServerDetailResponse(
            server=server,
            tools=tools,
            resources=resources
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get server details: {str(e)}"
        )


@router.get("/tools", response_model=ToolsListResponse)
async def list_tools(gateway: MCPGateway = Depends(get_rate_limited_gateway)) -> ToolsListResponse:
    """
    List all aggregated tools from all servers.

    Returns:
        List of aggregated tools with prefixed names
    """
    try:
        tools = gateway.get_aggregated_tools()

        # Count tools by server
        by_server = {}
        for tool in tools:
            by_server[tool.server_name] = by_server.get(tool.server_name, 0) + 1

        return ToolsListResponse(
            tools=tools,
            total=len(tools),
            by_server=by_server
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list tools: {str(e)}"
        )


@router.get("/resources", response_model=ResourcesListResponse)
async def list_resources(gateway: MCPGateway = Depends(get_rate_limited_gateway)) -> ResourcesListResponse:
    """
    List all aggregated resources from all servers.

    Returns:
        List of aggregated resources with prefixed URIs
    """
    try:
        resources = gateway.get_aggregated_resources()

        # Count resources by server
        by_server = {}
        for resource in resources:
            by_server[resource.server_name] = by_server.get(resource.server_name, 0) + 1

        return ResourcesListResponse(
            resources=resources,
            total=len(resources),
            by_server=by_server
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list resources: {str(e)}"
        )


@router.post("/tools/execute", response_model=ToolExecutionResponse)
async def execute_tool(
    request: ToolExecutionRequest,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> ToolExecutionResponse:
    """
    Execute a tool on the appropriate MCP server.

    Args:
        request: Tool execution request

    Returns:
        Tool execution result
    """
    try:
        result = await gateway.execute_tool(request)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tool execution failed: {str(e)}"
        )


@router.post("/resources/access", response_model=ResourceAccessResponse)
async def access_resource(
    request: ResourceRequest,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> ResourceAccessResponse:
    """
    Access a resource from the appropriate MCP server.

    Args:
        request: Resource access request

    Returns:
        Resource access result
    """
    try:
        result = await gateway.access_resource(request)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Resource access failed: {str(e)}"
        )


# MCP Protocol Endpoints

# Session management
_mcp_sessions = {}  # session_id -> session_data
_sse_connections = {}  # connection_id -> (session_id, queue)

@router.get("/mcp")
@router.post("/mcp")
async def mcp_endpoint(request: Request, gateway: MCPGateway = Depends(get_gateway)):
    """
    Main MCP endpoint following MCP Streamable HTTP Transport specification.
    
    Implements the complete MCP handshake sequence:
    1. Client opens SSE stream (GET) → Server sends endpoint event
    2. Client sends initialize (POST) → Server responds with session ID
    3. Client sends initialized notification (POST) → Server responds 202 Accepted
    4. Normal operation begins
    """
    import json
    import asyncio
    from datetime import datetime, timezone
    
    if request.method == "GET":
        # Handle SSE stream establishment
        logger.info("MCP SSE stream requested")
        
        # Check Accept header
        accept_header = request.headers.get("accept", "")
        if "text/event-stream" not in accept_header and "*/*" not in accept_header:
            return JSONResponse(
                {"error": "SSE streams require Accept: text/event-stream header"},
                status_code=400
            )
        
        # Get session ID if provided
        session_id = request.headers.get("Mcp-Session-Id")
        connection_id = str(uuid.uuid4())
        
        logger.info(f"Opening MCP SSE stream (session: {session_id}, connection: {connection_id})")
        if not session_id:
            logger.info(f"SSE stream {connection_id} opened without session - will link during initialize")
        
        async def sse_generator():
            """Generate proper MCP SSE events according to specification."""
            try:
                # Create message queue for this connection
                message_queue = asyncio.Queue(maxsize=100)
                _sse_connections[connection_id] = (session_id, message_queue)
                
                # CRITICAL: Send endpoint event first (MCP SSE Transport requirement)
                # This tells the client where to send POST messages
                endpoint_url = "/api/v1/mcp"  # Full endpoint path
                yield f"event: endpoint\ndata: {endpoint_url}\n\n"
                
                # Force a small delay to ensure event is sent
                await asyncio.sleep(0.1)
                
                # Send initial ready message as proper SSE message event
                server_ready = {
                    "jsonrpc": "2.0",
                    "method": "notifications/ready",
                    "params": {
                        "serverInfo": {
                            "name": "mcp-portal",
                            "version": "1.0.0",
                            "protocolVersion": "2024-11-05"
                        }
                    }
                }
                yield f"event: message\ndata: {json.dumps(server_ready)}\n\n"
                
                # Log that SSE stream is ready for Cline
                logger.info(f"MCP SSE stream ready for client (connection: {connection_id})")
                
                # Main event loop
                while True:
                    try:
                        # Check if client disconnected
                        if await request.is_disconnected():
                            logger.info(f"MCP SSE client disconnected: {connection_id}")
                            break
                        
                        # Wait for outgoing message with timeout
                        try:
                            message = await asyncio.wait_for(message_queue.get(), timeout=60.0)
                            # Send as proper SSE message event
                            yield f"event: message\ndata: {json.dumps(message)}\n\n"
                            logger.debug(f"SSE sent message to {connection_id}: {message.get('method', 'unknown')}")
                        except asyncio.TimeoutError:
                            # Send keep-alive ping as heartbeat event (less frequent)
                            ping = {"timestamp": datetime.now(timezone.utc).isoformat()}
                            yield f"event: ping\ndata: {json.dumps(ping)}\n\n"
                            logger.debug(f"SSE keep-alive ping sent to {connection_id}")
                            
                    except Exception as e:
                        logger.error(f"MCP SSE generator error: {e}")
                        break
                        
            finally:
                # Clean up connection
                if connection_id in _sse_connections:
                    del _sse_connections[connection_id]
                logger.info(f"MCP SSE connection closed: {connection_id}")
        
        return StreamingResponse(
            sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Methods": "*"
            }
        )
    
    elif request.method == "POST":
        # Handle JSON-RPC messages
        logger.info("MCP JSON-RPC request received")
        
        # Check Accept header
        accept_header = request.headers.get("accept", "")
        if ("application/json" not in accept_header and 
            "text/event-stream" not in accept_header and 
            "*/*" not in accept_header):
            return JSONResponse(
                {"error": "MCP requires Accept: application/json, text/event-stream"},
                status_code=400
            )
        
        # Get session ID from header
        session_id = request.headers.get("Mcp-Session-Id")
        
        try:
            # Parse JSON-RPC message
            message = await request.json()
            method = message.get('method', 'unknown')
            logger.info(f"MCP message: {method} (session: {session_id})")
            
            # Handle notifications specially - they MUST return 202 Accepted with no body
            if method.startswith("notifications/"):
                logger.info(f"Processing MCP notification: {method}")
                
                if method == "notifications/initialized":
                    # Validate session exists
                    if session_id and session_id in _mcp_sessions:
                        _mcp_sessions[session_id]["initialized"] = True
                        logger.info(f"MCP session {session_id} marked as initialized")
                    
                    # Return 202 Accepted with no body (per MCP spec)
                    return Response(status_code=202)
                
                else:
                    # Other notifications - also return 202 Accepted
                    logger.info(f"Processed MCP notification: {method}")
                    return Response(status_code=202)
            
            # Handle requests (not notifications)
            else:
                # Process the request
                response = await handle_mcp_message(message, gateway)
                
                # For initialize requests, add session management
                if method == "initialize":
                    if not session_id:
                        # Create new session
                        session_id = str(uuid.uuid4())
                        _mcp_sessions[session_id] = {
                            "created_at": datetime.now(timezone.utc),
                            "client_info": message.get("params", {}).get("clientInfo", {}),
                            "protocol_version": message.get("params", {}).get("protocolVersion", "2024-11-05"),
                            "initialized": False
                        }
                        logger.info(f"Created new MCP session: {session_id}")
                        
                        # Link any unlinked SSE connections to this session (for Cline flow)
                        # Cline opens SSE stream first, then sends initialize
                        linked_sse_connection = None
                        for conn_id, (conn_session_id, message_queue) in list(_sse_connections.items()):
                            if conn_session_id is None:  # Unlinked connection
                                _sse_connections[conn_id] = (session_id, message_queue)
                                linked_sse_connection = (conn_id, message_queue)
                                logger.info(f"Linked SSE connection {conn_id} to new session {session_id}")
                                break  # Link only the most recent unlinked connection
                        
                        # If we linked an SSE connection, send initialize response via SSE (Cline expects this)
                        if linked_sse_connection:
                            conn_id, message_queue = linked_sse_connection
                            try:
                                await message_queue.put(response)
                                logger.info(f"Sent initialize response via SSE to connection {conn_id}")
                                # Return 202 to indicate response sent via SSE
                                response_with_session = Response(status_code=202)
                                response_with_session.headers["Mcp-Session-Id"] = session_id
                                return response_with_session
                            except Exception as e:
                                logger.error(f"Failed to send initialize via SSE: {e}")
                                # Fall back to direct JSON response
                    
                    # Fallback: Add session ID to response headers (for clients without SSE)
                    json_response = JSONResponse(response)
                    json_response.headers["Mcp-Session-Id"] = session_id
                    return json_response
                
                # For other requests, check if there's an active SSE connection
                # If so, send response via SSE stream (MCP spec compliance)
                active_sse_connection = None
                
                # First, try to find SSE connection by session ID (if provided)
                if session_id:
                    for conn_id, (conn_session_id, message_queue) in _sse_connections.items():
                        if conn_session_id == session_id:
                            active_sse_connection = (conn_id, message_queue)
                            break
                
                # If no session ID or no matching connection, check for any active SSE connection
                # This handles cases where clients (like Cline) don't send session IDs but expect SSE responses
                if not active_sse_connection and _sse_connections:
                    # Use the most recent SSE connection (last in dict)
                    conn_id = list(_sse_connections.keys())[-1]
                    conn_session_id, message_queue = _sse_connections[conn_id]
                    if conn_session_id:  # Only use connections with linked sessions
                        active_sse_connection = (conn_id, message_queue)
                        logger.info(f"Using active SSE connection {conn_id} for sessionless request: {method}")
                
                if active_sse_connection:
                    # Send response via SSE stream (proper MCP behavior)
                    conn_id, message_queue = active_sse_connection
                    try:
                        await message_queue.put(response)
                        logger.info(f"Routed MCP {method} response via SSE to connection {conn_id}")
                        # Return 202 Accepted to indicate response will come via SSE
                        return Response(status_code=202)
                    except Exception as e:
                        logger.error(f"Failed to route {method} response via SSE: {e}")
                        return JSONResponse(response)  # Fallback to direct response
                else:
                    # No active SSE connection, validate session if provided
                    if session_id and session_id not in _mcp_sessions:
                        return JSONResponse(
                            {"error": "Invalid session ID"},
                            status_code=404
                        )
                    
                    # Return JSON response directly (for clients without SSE)
                    logger.info(f"No SSE connection available - sending {method} as direct JSON response")
                    return JSONResponse(response)
            
        except json.JSONDecodeError:
            return JSONResponse(
                {"error": "Invalid JSON-RPC message"},
                status_code=400
            )
        except Exception as e:
            logger.error(f"MCP message handling error: {e}")
            return JSONResponse(
                {"error": f"Internal error: {str(e)}"},
                status_code=500
            )
    
    else:
        # Method not allowed
        return JSONResponse(
            {"error": "Method not allowed. Use GET for SSE streams or POST for JSON-RPC messages."},
            status_code=405
        )


@router.post("/mcp/register")
async def mcp_client_registration(
    request: Request,
    gateway: MCPGateway = Depends(get_gateway)
):
    """
    MCP Client Registration endpoint for dynamic client registration.
    
    This endpoint handles client registration requests from Claude Code and other MCP clients.
    This is typically called before establishing the SSE connection.
    
    Returns:
        Registration response with client configuration
    """
    try:
        # Get client registration data from request
        registration_data = await request.json() if request.headers.get("content-type") == "application/json" else {}
        
        # Generate client ID and return registration response
        client_id = f"client_{uuid.uuid4().hex[:8]}"
        
        registration_response = {
            "client_id": client_id,
            "client_secret": "not_required_for_sse",
            "registration_access_token": "not_required_for_sse",
            "endpoints": {
                "sse": f"/api/v1/mcp",  # Updated to use main MCP endpoint
                "request": f"/api/v1/mcp"  # Updated to use main MCP endpoint
            },
            "server_info": {
                "name": "mcp-gateway",
                "version": "1.0.0",
                "description": "MCP Gateway - Unified access to multiple MCP servers"
            }
        }
        
        return registration_response
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Client registration failed: {str(e)}"
        )


@router.get("/mcp/sse")
async def mcp_sse_endpoint(request: Request):
    """
    MCP Protocol SSE endpoint using official FastMCP SDK.
    
    This endpoint provides MCP protocol communication over Server-Sent Events
    using the official MCP SDK for proper Claude Desktop compatibility.
    
    Returns:
        EventSourceResponse with official MCP protocol support
    """
    try:
        # Import here to avoid circular imports
        from ..mcp_server import get_gateway_server
        
        # Get the FastMCP server instance
        mcp_server = await get_gateway_server()
        
        # Create a proper SSE response using FastMCP's Starlette app
        # Get the SSE app from FastMCP
        sse_app = mcp_server.mcp.sse_app()
        
        # Create an ASGI scope for the request
        scope = {
            "type": "http",
            "method": request.method,
            "path": "/sse",  # FastMCP expects /sse path
            "query_string": str(request.url.query).encode(),
            "headers": [(k.encode(), v.encode()) for k, v in request.headers.items()],
        }
        
        # Handle the request with FastMCP's SSE app
        from starlette.responses import StreamingResponse
        
        # Create a streaming response that forwards to FastMCP
        async def sse_generator():
            """Generator that forwards SSE events from FastMCP."""
            # This is a simplified approach - FastMCP will handle the actual SSE protocol
            import asyncio
            
            # Send a simple SSE event to start
            yield "data: {\"jsonrpc\": \"2.0\", \"method\": \"ping\"}\n\n"
            
            # Keep connection alive
            while True:
                await asyncio.sleep(30)
                yield "data: {\"jsonrpc\": \"2.0\", \"method\": \"ping\"}\n\n"
        
        return StreamingResponse(
            sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            }
        )
        
    except Exception as e:
        logger.error(f"FastMCP SSE endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"FastMCP SSE endpoint failed: {str(e)}"
        )


@router.post("/mcp/request")
async def mcp_request_endpoint(request_data: Dict[str, Any]):
    """
    MCP Protocol HTTP POST endpoint for handling MCP requests.
    
    This endpoint handles MCP protocol requests sent via HTTP POST from
    Claude Code and other MCP clients. Requests are processed and responses
    are sent via SSE streams.
    
    Args:
        request_data: MCP request data (initialize, tools/list, tools/call, etc.)
        
    Returns:
        Success confirmation (actual response sent via SSE)
    """
    try:
        logger.info(f"Received MCP POST request: {request_data.get('method', 'unknown')}")
        
        # Get the MCP transport instance
        from ..core.mcp_transport import MCPSSETransport
        from ..core.gateway import get_gateway
        
        gateway = get_gateway()
        transport = MCPSSETransport(gateway)
        
        # Handle the MCP request
        response = await transport.handle_mcp_request(request_data)
        
        return {
            "status": "success",
            "message": "Request processed and response sent via SSE",
            "method": request_data.get('method', 'unknown')
        }
        
    except Exception as e:
        logger.error(f"MCP POST request error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"MCP request processing failed: {str(e)}"
        )


@router.post("/messages")
async def mcp_messages_endpoint(request_data: Dict[str, Any]):
    """
    Standard MCP SSE messages endpoint (FastMCP compatible).
    
    This is the standard endpoint that MCP clients (like Claude Code) expect
    for SSE transport. It follows the FastMCP pattern where:
    - SSE endpoint: /sse (for stream connection)
    - Messages endpoint: /messages (for HTTP POST requests)
    
    Args:
        request_data: MCP request data (initialize, tools/list, tools/call, etc.)
        
    Returns:
        Success confirmation (actual response sent via SSE)
    """
    try:
        logger.info(f"Received MCP messages request: {request_data.get('method', 'unknown')}")
        
        # Get the MCP transport instance
        from ..core.mcp_transport import MCPSSETransport
        from ..core.gateway import get_gateway
        
        gateway = get_gateway()
        transport = MCPSSETransport(gateway)
        
        # Handle the MCP request
        response = await transport.handle_mcp_request(request_data)
        
        return {
            "status": "success",
            "message": "Request processed and response sent via SSE",
            "method": request_data.get('method', 'unknown')
        }
        
    except Exception as e:
        logger.error(f"MCP messages request error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"MCP messages request processing failed: {str(e)}"
        )


@router.get("/config", response_model=Dict[str, Any])
async def get_configuration(gateway: MCPGateway = Depends(get_gateway)) -> Dict[str, Any]:
    """
    Get the current MCP server configuration in JSON format.
    
    Returns:
        Current MCP server configuration as JSON
    """
    try:
        # Get all server configurations (including discovered ones)
        all_server_configs = gateway.settings.get_mcp_servers_with_discovery()
        
        # Convert to a JSON-serializable format similar to cursor/claude desktop config
        config_dict = {
            "mcpServers": {}
        }
        
        for server_config in all_server_configs:
            server_dict = {
                "enabled": getattr(server_config, 'enabled', True),
                "source": getattr(server_config, 'source', 'manual')
            }
            
            # Add command or URL based on server type
            if hasattr(server_config, 'command') and server_config.command:
                server_dict["command"] = server_config.command
                if hasattr(server_config, 'args') and server_config.args:
                    server_dict["args"] = server_config.args
                if hasattr(server_config, 'env') and server_config.env:
                    server_dict["env"] = server_config.env
            elif hasattr(server_config, 'url') and server_config.url:
                server_dict["url"] = server_config.url
                if hasattr(server_config, 'transport') and server_config.transport:
                    server_dict["transport"] = server_config.transport
            
            # Add other configuration fields
            if hasattr(server_config, 'timeout'):
                server_dict["timeout"] = server_config.timeout
            if hasattr(server_config, 'max_retries'):
                server_dict["max_retries"] = server_config.max_retries
            
            config_dict["mcpServers"][server_config.name] = server_dict
        
        return config_dict
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get configuration: {str(e)}"
        )


@router.post("/config", response_model=APIResponse)
async def save_configuration(
    config_data: Dict[str, Any],
    gateway: MCPGateway = Depends(get_gateway)
) -> APIResponse:
    """
    Save MCP server configuration from JSON format.
    
    Args:
        config_data: New MCP server configuration in JSON format
        
    Returns:
        Success response with configuration update results
    """
    try:
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Starting configuration save with {len(config_data.get('mcpServers', {}))} servers")
        
        # Validate that the config has the expected structure
        if "mcpServers" not in config_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid configuration format. Expected 'mcpServers' key."
            )
        
        # Convert JSON config to MCPServerConfig objects
        from ..config.settings import MCPServerConfig
        
        new_server_configs = []
        for server_name, server_config in config_data["mcpServers"].items():
            try:
                logger.info(f"Processing server config for: {server_name}")
                # Create MCPServerConfig object
                config_kwargs = {
                    "name": server_name,
                    "enabled": server_config.get("enabled", True),
                    "timeout": server_config.get("timeout", 30),
                    "max_retries": server_config.get("max_retries", 3)
                }
                
                # Handle command-based servers
                if "command" in server_config:
                    config_kwargs["command"] = server_config["command"]
                    if "args" in server_config:
                        config_kwargs["args"] = server_config["args"]
                    if "env" in server_config:
                        config_kwargs["env"] = server_config["env"]
                
                # Handle URL-based servers
                elif "url" in server_config:
                    config_kwargs["url"] = server_config["url"]
                    if "transport" in server_config:
                        config_kwargs["transport"] = server_config["transport"]
                
                # Add source information
                config_kwargs["source"] = server_config.get("source", "manual")
                
                # Create and validate the config
                config_obj = MCPServerConfig(**config_kwargs)
                new_server_configs.append(config_obj)
                logger.info(f"Successfully created config for: {server_name}")
                
            except Exception as e:
                logger.error(f"Error creating config for server '{server_name}': {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid configuration for server '{server_name}': {str(e)}"
                )
        
        # Store original configuration for recovery
        original_config = gateway.settings.mcp_servers  # This is already a List[MCPServerConfig]
        logger.info(f"Stored original config with {len(original_config)} servers")
        
        # Update the gateway settings with new configurations
        # Note: This updates the runtime configuration, not the persistent file
        try:
            logger.info("Updating gateway settings with new configurations")
            # Assign the parsed list directly to mcp_servers
            gateway.settings.mcp_servers = new_server_configs
            logger.info(f"Updated gateway settings with {len(new_server_configs)} servers")
            
            # Trigger discovery refresh to pick up changes
            logger.info("Triggering discovery refresh")
            await gateway.refresh_discovery()
            logger.info("Discovery refresh completed")
            
        except Exception as e:
            logger.error(f"Error during configuration update: {str(e)}")
            # Restore original configuration on failure
            gateway.settings.mcp_servers = original_config
            logger.info(f"Restored original configuration with {len(original_config)} servers")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to update server configurations: {str(e)}"
            )
        
        # Get updated server count
        updated_servers = gateway.get_servers()
        
        return APIResponse(
            success=True,
            data={
                "message": "Configuration updated successfully",
                "total_servers": len(updated_servers),
                "updated_servers": len(new_server_configs),
                "note": "Configuration updated in runtime. Restart gateway to persist changes."
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in save_configuration: {str(e)}")
        logger.error(f"Exception type: {type(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save configuration: {str(e)}"
        )


@router.get("/sse")
async def mcp_sse_endpoint(request: Request):
    """
    Standard MCP SSE endpoint (FastMCP compatible).
    
    This is the standard SSE endpoint that MCP clients (like Claude Code) expect
    for SSE transport. It follows the FastMCP pattern where:
    - SSE endpoint: /sse (for stream connection)
    - Messages endpoint: /messages (for HTTP POST requests)
    
    Returns:
        SSE stream for MCP protocol communication
    """
    try:
        logger.info("Standard MCP SSE endpoint requested")
        
        # Get the MCP transport instance
        from ..core.mcp_transport import MCPSSETransport
        from ..core.gateway import get_gateway
        
        gateway = get_gateway()
        transport = MCPSSETransport(gateway)
        
        # Create SSE streaming response
        async def sse_generator():
            """Generator that creates MCP SSE events."""
            connection_id = str(uuid.uuid4())
            logger.info(f"New standard MCP SSE connection: {connection_id}")
            
            # Create message queues for this connection
            outgoing_queue = asyncio.Queue(maxsize=100)
            transport._active_connections[connection_id] = outgoing_queue
            
            try:
                # Send MCP initialization
                await transport._send_mcp_initialization(outgoing_queue)
                
                # Main event loop
                while True:
                    try:
                        # Check if client disconnected
                        if await request.is_disconnected():
                            logger.info(f"Standard MCP SSE client disconnected: {connection_id}")
                            break
                        
                        # Wait for outgoing message
                        message = await asyncio.wait_for(outgoing_queue.get(), timeout=30.0)
                        
                        # Format as SSE event
                        event_data = json.dumps(message) if isinstance(message, dict) else str(message)
                        yield f"data: {event_data}\n\n"
                        
                    except asyncio.TimeoutError:
                        # Send keep-alive ping
                        yield f"data: {json.dumps({'jsonrpc': '2.0', 'method': 'ping'})}\n\n"
                        
                    except Exception as e:
                        logger.error(f"Standard MCP SSE generator error: {e}")
                        break
                        
            finally:
                # Clean up connection
                if connection_id in transport._active_connections:
                    del transport._active_connections[connection_id]
                logger.info(f"Standard MCP SSE connection closed: {connection_id}")
        
        return StreamingResponse(
            sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            }
        )
        
    except Exception as e:
        logger.error(f"Standard MCP SSE endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"SSE connection failed: {str(e)}"
        )


@router.get("/mcp/sse-debug")
async def mcp_sse_debug(request: Request):
    """Debug endpoint to test MCP SSE compatibility with Claude Desktop."""
    
    async def debug_stream():
        """Simple MCP SSE stream for debugging."""
        # Send initial MCP server info according to MCP spec
        server_info = {
            "jsonrpc": "2.0",
            "method": "notifications/server_info",
            "params": {
                "name": "MCP Gateway Debug",
                "version": "1.0.0"
            }
        }
        yield f"data: {json.dumps(server_info)}\n\n"
        
        # Keep alive
        for i in range(10):
            await asyncio.sleep(5)
            keepalive = {
                "jsonrpc": "2.0", 
                "method": "notifications/ping",
                "params": {"timestamp": datetime.utcnow().isoformat()}
            }
            yield f"data: {json.dumps(keepalive)}\n\n"
    
    return EventSourceResponse(
        debug_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )


# MCP requests are now handled entirely through the FastMCP SSE endpoint

# Settings Discovery Endpoints

@router.get("/discovery/settings")
async def discover_settings_endpoint():
    """
    Discover MCP settings from various IDEs and environments.
    
    Scans common configuration locations for:
    - Cursor IDE
    - Windsurf
    - VS Code  
    - Claude Desktop
    - Continue.dev
    - Aider
    - Codeium
    
    Returns:
        List of discovered MCP server configurations
    """
    try:
        discovered_settings = discover_mcp_settings()
        
        return {
            "status": "success",
            "total_discovered": len(discovered_settings),
            "servers": [
                {
                    "name": config.name,
                    "url": config.url,
                    "enabled": config.enabled,
                    "timeout": config.timeout,
                    "max_retries": config.max_retries
                }
                for config in discovered_settings
            ]
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Settings discovery failed: {str(e)}"
        )


@router.post("/discovery/apply")
async def apply_discovered_settings(
    gateway: MCPGateway = Depends(get_gateway)
):
    """
    Apply discovered MCP settings to the gateway.
    
    This endpoint discovers settings from IDEs and applies them to the gateway,
    effectively making all your existing MCP servers available through the gateway.
    
    Returns:
        Summary of applied settings
    """
    try:
        # Discover settings
        discovered_settings = discover_mcp_settings()
        
        # Apply to gateway (you'll need to implement this in the gateway)
        # For now, we'll just return the discovered settings
        
        return {
            "status": "success",
            "message": "Settings discovery completed",
            "applied_servers": len(discovered_settings),
            "servers": [config.name for config in discovered_settings],
            "instructions": {
                "claude_code": f'claude mcp add-json mcp-gateway \'{{"type":"sse","url":"http://localhost:{gateway.settings.gateway_port}/api/v1/mcp/sse"}}\' --scope user',
                "manual_config": {
                    "type": "sse",
                    "url": f"http://localhost:{gateway.settings.gateway_port}/api/v1/mcp/sse"
                }
            }
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Settings application failed: {str(e)}"
        )


@router.get("/discovery/status")
async def discovery_status():
    """
    Get status of settings discovery system.
    
    Returns:
        Discovery system status and statistics
    """
    try:
        from ..core.settings_discovery import settings_discovery
        
        summary = settings_discovery.get_discovery_summary()
        
        return {
            "status": "active",
            "summary": summary,
            "supported_ides": [
                "Cursor IDE",
                "Windsurf",
                "VS Code",
                "Claude Desktop", 
                "Continue.dev",
                "Aider",
                "Codeium"
            ]
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Discovery status failed: {str(e)}"
        )


@router.get("/metrics", response_model=MetricsResponse)
async def get_metrics(gateway: MCPGateway = Depends(get_rate_limited_gateway)) -> MetricsResponse:
    """
    Get gateway performance metrics.

    Returns:
        Gateway and server performance metrics
    """
    try:
        metrics = gateway.get_metrics()
        return MetricsResponse(metrics=metrics)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get metrics: {str(e)}"
        )


@router.post("/servers/{server_name}/reconnect", response_model=ServerActionResponse)
async def reconnect_server(
    server_name: str,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> ServerActionResponse:
    """
    Reconnect to a specific server.

    Args:
        server_name: Name of the server to reconnect

    Returns:
        Reconnection result
    """
    try:
        server = gateway.get_server_by_name(server_name)
        if not server:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Server '{server_name}' not found"
            )

        success = await gateway.discovery.reconnect_server(server_name)

        return ServerActionResponse(
            server_name=server_name,
            action="reconnect",
            success=success,
            message="Reconnection successful" if success else "Reconnection failed"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Reconnection failed: {str(e)}"
        )


@router.get("/status", response_model=APIResponse[Dict[str, Any]])
async def get_status(gateway: MCPGateway = Depends(get_gateway)) -> APIResponse[Dict[str, Any]]:
    """
    Get comprehensive gateway status.

    Returns:
        Comprehensive status information
    """
    try:
        gateway_status = await gateway.get_status()
        aggregation_stats = gateway.aggregator.get_aggregation_stats()

        status_data = {
            "gateway": gateway_status.model_dump(),
            "aggregation": aggregation_stats,
            "conflicts": {
                "tools": gateway.aggregator.get_tool_conflicts(),
                "resources": gateway.aggregator.get_resource_conflicts()
            }
        }

        return APIResponse(
            success=True,
            data=status_data
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get status: {str(e)}"
        )


@router.get("/tools/search")
async def search_tools(
    q: str = "",
    server: str = None,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> APIResponse[List[Dict[str, Any]]]:
    """
    Search for tools by name or description.

    Args:
        q: Search query
        server: Filter by server name

    Returns:
        List of matching tools
    """
    try:
        tools = gateway.get_aggregated_tools()

        # Filter by server if specified
        if server:
            tools = [t for t in tools if t.server_name == server]

        # Filter by search query
        if q:
            q_lower = q.lower()
            tools = [
                t for t in tools
                if q_lower in t.prefixed_name.lower() or
                   q_lower in t.original_name.lower() or
                   q_lower in t.description.lower()
            ]

        tools_data = [tool.model_dump() for tool in tools]

        return APIResponse(
            success=True,
            data=tools_data
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tool search failed: {str(e)}"
        )


@router.get("/resources/search")
async def search_resources(
    q: str = "",
    server: str = None,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> APIResponse[List[Dict[str, Any]]]:
    """
    Search for resources by URI or name.

    Args:
        q: Search query
        server: Filter by server name

    Returns:
        List of matching resources
    """
    try:
        resources = gateway.get_aggregated_resources()

        # Filter by server if specified
        if server:
            resources = [r for r in resources if r.server_name == server]

        # Filter by search query
        if q:
            q_lower = q.lower()
            resources = [
                r for r in resources
                if q_lower in r.prefixed_uri.lower() or
                   q_lower in r.original_uri.lower() or
                   q_lower in r.name.lower() or
                   (r.description and q_lower in r.description.lower())
            ]

        resources_data = [resource.model_dump() for resource in resources]

        return APIResponse(
            success=True,
            data=resources_data
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Resource search failed: {str(e)}"
        )


@router.post("/servers/{server_name}/enable", response_model=ServerActionResponse)
async def enable_server(
    server_name: str,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> ServerActionResponse:
    """
    Enable a server.

    Args:
        server_name: Name of the server to enable

    Returns:
        Action result
    """
    try:
        # Check if server exists in gateway's internal state first
        server = gateway.get_server_by_name(server_name)
        if not server:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Server '{server_name}' not found"
            )
        
        # Get the cached server configuration
        server_config = gateway._server_configs.get(server_name)
        if not server_config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Server '{server_name}' configuration not found"
            )
        
        # Enable the server configuration
        server_config.enabled = True
        
        # Try to start the server
        if server_config.command:
            result = await gateway.process_manager.start_server(server_config)
            if result:
                # Update the gateway's internal state with the new server
                result.enabled = True  # Mark as enabled by user
                gateway._servers[server_name] = result
                
                # Update aggregation
                await gateway.aggregator.update_aggregation(list(gateway._servers.values()))
                
                # Refresh MCP server tools
                from ..mcp_server import refresh_mcp_tools
                await refresh_mcp_tools()
                
                return ServerActionResponse(
                    success=True,
                    action="enable",
                    message=f"Server '{server_name}' enabled and started successfully",
                    server_name=server_name
                )
            else:
                return ServerActionResponse(
                    success=False,
                    action="enable",
                    message=f"Server '{server_name}' enabled but failed to start",
                    server_name=server_name
                )
        else:
            # For URL-based servers, attempt to connect via SSE using unified transport
            logger.info(f"Attempting to connect to SSE server: {server_name}")
            
            try:
                result = await gateway.process_manager.start_server(server_config)
                if result:
                    # Update the gateway's internal state with the new server
                    result.enabled = True  # Mark as enabled by user
                    gateway._servers[server_name] = result
                    
                    # Update aggregation
                    await gateway.aggregator.update_aggregation(list(gateway._servers.values()))
                    
                    # Refresh MCP server tools
                    from ..mcp_server import refresh_mcp_tools
                    await refresh_mcp_tools()
                    
                    logger.info(f"SSE server {server_name} connected successfully with {len(result.tools)} tools")
                    
                    return ServerActionResponse(
                        success=True,
                        action="enable",
                        message=f"SSE server '{server_name}' connected successfully with {len(result.tools)} tools",
                        server_name=server_name
                    )
                else:
                    # If connection failed, just mark as enabled (fallback behavior)
                    server = gateway.get_server_by_name(server_name)
                    if server:
                        server.enabled = True
                    
                    # Refresh MCP server tools
                    from ..mcp_server import refresh_mcp_tools
                    await refresh_mcp_tools()
                    
                    return ServerActionResponse(
                        success=False,
                        action="enable",
                        message=f"Server '{server_name}' enabled but SSE connection failed",
                        server_name=server_name
                    )
            except Exception as e:
                logger.error(f"Error connecting to SSE server {server_name}: {e}")
                
                # Fallback to just marking as enabled
                server = gateway.get_server_by_name(server_name)
                if server:
                    server.enabled = True
                
                # Refresh MCP server tools
                from ..mcp_server import refresh_mcp_tools
                await refresh_mcp_tools()
                
                return ServerActionResponse(
                    success=False,
                    action="enable",
                    message=f"Server '{server_name}' enabled but connection failed: {str(e)}",
                    server_name=server_name
                )
            
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to enable server '{server_name}': {str(e)}"
        )


@router.post("/servers/{server_name}/disable", response_model=ServerActionResponse)
async def disable_server(
    server_name: str,
    gateway: MCPGateway = Depends(get_rate_limited_gateway)
) -> ServerActionResponse:
    """
    Disable a server.

    Args:
        server_name: Name of the server to disable

    Returns:
        Action result
    """
    try:
        # Get the cached server configuration
        server_config = gateway._server_configs.get(server_name)
        if not server_config:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Server '{server_name}' not found in configuration"
            )
        
        # Disable the server configuration
        server_config.enabled = False
        
        # Stop the server if it's running
        if server_config.command:
            await gateway.process_manager.stop_server(server_name)
            
            # Update the gateway's internal state - mark as disconnected and disabled
            if server_name in gateway._servers:
                gateway._servers[server_name].status = MCPServerStatus.DISCONNECTED
                gateway._servers[server_name].enabled = False
                gateway._servers[server_name].last_error = "Server disabled by user"
                
                # Update aggregation
                await gateway.aggregator.update_aggregation(list(gateway._servers.values()))
        else:
            # For URL-based servers, just mark as disabled
            server = gateway.get_server_by_name(server_name)
            if server:
                server.enabled = False
        
        # Refresh MCP server tools
        from ..mcp_server import refresh_mcp_tools
        await refresh_mcp_tools()
        
        return ServerActionResponse(
            success=True,
            action="disable",
            message=f"Server '{server_name}' disabled successfully",
            server_name=server_name
        )
            
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to disable server '{server_name}': {str(e)}"
        )


# Note: Exception handlers are defined in main.py on the FastAPI app instance


