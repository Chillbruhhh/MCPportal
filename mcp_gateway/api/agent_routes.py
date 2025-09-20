"""
Agent API Routes for MCP Portal
Handles agent registration, authentication, and management endpoints
"""

from typing import List, Dict, Any, Optional
from uuid import UUID
from datetime import datetime
import time
import json
from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import logging

from ..models.agent import (
    Agent, AgentToken, AgentConnectionRequest, AgentConnectionResponse,
    CreateAgentTokenRequest, CreateAgentTokenResponse,
    AgentWithStack, MCPAccessRequest, MCPAccessResponse,
    UpdateStackRequest, AssignStackServersRequest
)
from ..core.agent_manager import AgentManager
from ..core.gateway import MCPGateway

logger = logging.getLogger(__name__)

# Security (allow missing credentials in dev; will return a mock user)
security = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/api/v1", tags=["agents"])

# Dependency injection (these would be properly configured in main app)
agent_manager: Optional[AgentManager] = None
mcp_gateway: Optional[MCPGateway] = None


def get_agent_manager() -> AgentManager:
    """Get agent manager instance"""
    if agent_manager is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Agent manager not initialized"
        )
    return agent_manager


def get_mcp_gateway() -> MCPGateway:
    """Get MCP gateway instance"""
    if mcp_gateway is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MCP gateway not initialized"
        )
    return mcp_gateway


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UUID:
    """Get current user from JWT token (Supabase auth)"""
    # This would integrate with Supabase JWT validation
    # For now, return a mock user ID
    # TODO: Implement proper Supabase JWT validation
    try:
        # Decode JWT and extract user_id
        # user_id = decode_supabase_jwt(credentials.credentials)
        user_id = UUID("00000000-0000-0000-0000-000000000000")  # Mock for now
        return user_id
    except Exception as e:
        logger.error(f"Failed to validate user token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )


# Agent Token Management
@router.post("/auth/token", response_model=CreateAgentTokenResponse)
async def create_agent_token(
    request: CreateAgentTokenRequest,
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """Create a new agent authentication token"""
    try:
        return await manager.create_agent_token(current_user, request)
    except Exception as e:
        logger.error(f"Failed to create agent token: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/tokens", response_model=List[AgentToken])
async def list_agent_tokens(
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """List all agent tokens for current user"""
    try:
        # Get tokens from database
        tokens_result = await manager.db.table('agent_tokens')\
            .select('*')\
            .eq('user_id', str(current_user))\
            .eq('is_active', True)\
            .order('created_at', desc=True)\
            .execute()

        return [AgentToken(**token) for token in tokens_result.data]

    except Exception as e:
        logger.error(f"Failed to list agent tokens: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve tokens"
        )


@router.delete("/tokens/{token_id}")
async def revoke_agent_token(
    token_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """Revoke an agent token"""
    try:
        # Deactivate token
        result = await manager.db.table('agent_tokens')\
            .update({'is_active': False})\
            .eq('id', str(token_id))\
            .eq('user_id', str(current_user))\
            .execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Token not found"
            )

        # Disconnect any agents using this token
        # (This would need to track token->agent relationships)

        return {"message": "Token revoked successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to revoke token: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to revoke token"
        )


# Agent Connection
@router.post("/agents/connect", response_model=AgentConnectionResponse)
async def connect_agent(
    request: AgentConnectionRequest,
    manager: AgentManager = Depends(get_agent_manager)
):
    """Connect an agent using authentication token"""
    try:
        return await manager.connect_agent(request)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to connect agent: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to connect agent"
        )


@router.post("/agents/connect-via-mcp", response_model=AgentConnectionResponse)
async def connect_agent_via_mcp(
    request: AgentConnectionRequest,
    manager: AgentManager = Depends(get_agent_manager)
):
    """
    Connect an agent via MCP protocol with token-based authentication.
    This endpoint is called when agents connect through MCP server protocol.
    """
    try:
        # Enhanced connection for MCP-based agents
        response = await manager.connect_agent_via_mcp(request)

        logger.info(f"MCP agent connected: {request.agent_name} ({request.agent_type})")
        return response

    except ValueError as e:
        logger.warning(f"MCP agent connection failed - invalid token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to connect MCP agent: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to connect agent via MCP protocol"
        )


# Agent Management
@router.get("/agents", response_model=List[AgentWithStack])
async def list_agents(
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """List all agents for current user"""
    try:
        return await manager.get_user_agents(current_user)
    except Exception as e:
        logger.error(f"Failed to list agents: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve agents"
        )


@router.get("/agents/{agent_id}", response_model=AgentWithStack)
async def get_agent(
    agent_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """Get specific agent details"""
    try:
        agents = await manager.get_user_agents(current_user)
        agent = next((a for a in agents if a.id == agent_id), None)

        if not agent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Agent not found"
            )

        return agent

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get agent: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve agent"
        )


@router.put("/agents/{agent_id}", response_model=Agent)
async def update_agent(
    agent_id: UUID,
    updates: Dict[str, Any],
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """Update agent settings"""
    try:
        # Filter allowed updates
        allowed_fields = {'name', 'settings'}
        filtered_updates = {k: v for k, v in updates.items() if k in allowed_fields}

        if not filtered_updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid updates provided"
            )

        return await manager.update_agent(agent_id, current_user, filtered_updates)

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to update agent: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update agent"
        )


@router.delete("/agents/{agent_id}")
async def delete_agent(
    agent_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """Delete an agent"""
    try:
        await manager.delete_agent(agent_id, current_user)
        return {"message": "Agent deleted successfully"}

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to delete agent: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete agent"
        )


@router.put("/agents/{agent_id}/stack")
async def assign_stack_to_agent(
    agent_id: UUID,
    stack_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """Assign an MCP stack to an agent"""
    try:
        await manager.assign_stack_to_agent(agent_id, stack_id, current_user)
        return {"message": "Stack assigned successfully"}

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to assign stack: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign stack"
        )


# MCP Access Control (The critical security endpoint)
@router.post("/mcp/{agent_token}/call", response_model=MCPAccessResponse)
async def agent_mcp_call(
    agent_token: str,
    request: MCPAccessRequest,
    manager: AgentManager = Depends(get_agent_manager),
    gateway: MCPGateway = Depends(get_mcp_gateway)
):
    """
    Secure MCP proxy endpoint - agents can only access assigned tools
    This is the critical security boundary!
    """
    start_time = time.time()
    token_hash = manager._hash_token(agent_token)

    try:
        # 1. Validate agent has access to this tool
        has_access = await manager.validate_agent_access(
            token_hash, request.server_name, request.tool_name
        )

        if not has_access:
            await manager.log_agent_access(
                token_hash, request.tool_name, request.server_name,
                success=False, error_message="Access denied - tool not in agent's stack"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied - tool not assigned to agent"
            )

        # 2. Proxy call to actual MCP server
        result = await gateway.call_tool(
            server_name=request.server_name,
            tool_name=request.tool_name,
            parameters=request.parameters
        )

        duration_ms = int((time.time() - start_time) * 1000)

        # 3. Log successful access
        await manager.log_agent_access(
            token_hash, request.tool_name, request.server_name,
            success=True, response_size=len(str(result)) if result else 0,
            duration_ms=duration_ms
        )

        return MCPAccessResponse(
            success=True,
            result=result,
            duration_ms=duration_ms
        )

    except HTTPException:
        # Already logged above for access denied
        raise
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = str(e)

        # Log failed access
        await manager.log_agent_access(
            token_hash, request.tool_name, request.server_name,
            success=False, error_message=error_msg, duration_ms=duration_ms
        )

        logger.error(f"MCP call failed for agent {agent_token}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tool execution failed: {error_msg}"
        )


# Agent Access Logs
@router.get("/agents/{agent_id}/logs")
async def get_agent_access_logs(
    agent_id: UUID,
    limit: int = 100,
    current_user: UUID = Depends(get_current_user),
    manager: AgentManager = Depends(get_agent_manager)
):
    """Get access logs for an agent"""
    try:
        # Verify agent belongs to user
        agents = await manager.get_user_agents(current_user)
        if not any(a.id == agent_id for a in agents):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Agent not found"
            )

        # Get logs
        logs_result = await manager.db.table('agent_access_logs')\
            .select('*')\
            .eq('agent_id', str(agent_id))\
            .order('created_at', desc=True)\
            .limit(limit)\
            .execute()

        return logs_result.data

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get agent logs: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve logs"
        )


# WebSocket for real-time agent communication
@router.websocket("/ws/agents/{agent_id}")
async def agent_websocket(
    websocket: WebSocket,
    agent_id: UUID,
    manager: AgentManager = Depends(get_agent_manager)
):
    """WebSocket endpoint for real-time agent communication"""
    await websocket.accept()

    try:
        # Store connection
        manager.agent_connections[agent_id] = websocket

        # Keep connection alive
        while True:
            try:
                # Receive messages from agent
                data = await websocket.receive_text()
                message = json.loads(data)

                # Handle different message types
                if message.get('type') == 'ping':
                    await websocket.send_text(json.dumps({'type': 'pong'}))
                elif message.get('type') == 'status_update':
                    # Update agent status
                    await manager.update_agent(
                        agent_id,
                        message.get('user_id'),  # This should come from auth
                        {'status': message.get('status', 'online')}
                    )

            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"WebSocket error for agent {agent_id}: {e}")
                break

    finally:
        # Clean up connection
        await manager.disconnect_agent(agent_id)
        if agent_id in manager.agent_connections:
            del manager.agent_connections[agent_id]


# Health check
@router.get("/agents/health")
async def agents_health():
    """Health check for agent service"""
    return {
        "status": "healthy",
        "service": "agent-management",
        "timestamp": datetime.utcnow().isoformat()
    }


# Initialize dependencies (called from main app)
def init_agent_routes(agent_mgr: AgentManager, gateway: MCPGateway):
    """Initialize route dependencies"""
    global agent_manager, mcp_gateway
    agent_manager = agent_mgr
    mcp_gateway = gateway
