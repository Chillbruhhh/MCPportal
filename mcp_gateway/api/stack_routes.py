"""
Stack API Routes for MCP Portal
Handles MCP stack and server management endpoints
"""

from typing import List, Dict, Any, Optional
from uuid import UUID, uuid4
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import logging

from ..models.agent import (
    MCPStack, MCPServer, MCPStackWithServers, MCPServerWithHealth,
    CreateStackRequest, CreateStackWithNamesRequest, UpdateStackRequest,
    AssignStackServersRequest, AssignStackServersByNamesRequest,
    CreateServerRequest, UpdateServerRequest,
    StackTemplate
)
from ..core.stack_manager import StackManager

logger = logging.getLogger(__name__)

# Security (allow missing credentials in dev; will return a mock user)
security = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/api/v1", tags=["stacks", "servers"])

# Dependency injection
stack_manager: Optional[StackManager] = None


def get_stack_manager() -> StackManager:
    """Get stack manager instance"""
    if stack_manager is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stack manager not initialized"
        )
    return stack_manager


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> UUID:
    """Get current user from JWT token (Supabase auth)"""
    # TODO: Implement proper Supabase JWT validation
    try:
        # Development mode: Use a special null UUID that bypasses auth constraints
        # In production, this should validate real Supabase JWT tokens
        user_id = UUID("00000000-0000-0000-0000-000000000000")

        # Try to ensure development user exists in auth.users
        global stack_manager
        if stack_manager and hasattr(stack_manager, 'db'):
            try:
                # First, try to create the user using Supabase SQL functions if available
                await stack_manager.db.rpc('create_development_user_if_needed', {
                    'dev_user_id': str(user_id)
                }).execute()
                logger.info(f"Ensured development user exists: {user_id}")
            except Exception as e:
                logger.warning(f"Could not create development user via RPC: {e}")

                # Fallback: Try direct insert with minimal required fields
                try:
                    # Check if user exists first
                    user_check = await stack_manager.db.from_('auth.users').select('id').eq('id', str(user_id)).limit(1).execute()
                    if not user_check.data:
                        # Try creating with minimal auth.users structure
                        await stack_manager.db.from_('auth.users').insert({
                            'id': str(user_id),
                            'email': 'dev@mcpportal.local',
                            'created_at': datetime.utcnow().isoformat(),
                            'updated_at': datetime.utcnow().isoformat()
                        }).execute()
                        logger.info(f"Created minimal development user: {user_id}")
                except Exception as e2:
                    logger.warning(f"Could not create auth user directly: {e2}")
                    logger.warning("Continuing with mock user - stack creation may fail due to FK constraints")

        return user_id
    except Exception as e:
        logger.error(f"Failed to validate user token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )


# Stack Management Endpoints
@router.post("/stacks", response_model=MCPStackWithServers)
async def create_stack(
    request: CreateStackRequest,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Create a new MCP stack"""
    try:
        return await manager.create_stack(current_user, request)
    except Exception as e:
        logger.error(f"Failed to create stack: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.post("/stacks/create-with-names", response_model=MCPStackWithServers)
async def create_stack_with_names(
    request: CreateStackWithNamesRequest,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Create a new MCP stack using server names (supports discovered servers)"""
    logger.info(f"create_stack_with_names endpoint called with request: {request}")
    try:
        result = await manager.create_stack_with_server_names(
            current_user,
            request.name,
            request.server_names,
            request.description,
            request.template_name
        )
        logger.info(f"Stack created successfully: {result.id}")
        return result
    except ValueError as e:
        logger.error(f"ValueError in create_stack_with_names: {e}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Exception in create_stack_with_names: {e}")
        logger.exception("Full stacktrace:")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/stacks", response_model=List[MCPStackWithServers])
async def list_stacks(
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """List all stacks for current user"""
    try:
        return await manager.get_user_stacks(current_user)
    except Exception as e:
        logger.error(f"Failed to list stacks: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve stacks"
        )


@router.get("/stacks/{stack_id}", response_model=MCPStackWithServers)
async def get_stack(
    stack_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Get specific stack details"""
    try:
        stack = await manager.get_stack_with_servers(stack_id, current_user)
        if not stack:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stack not found"
            )
        return stack
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get stack: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve stack"
        )


@router.put("/stacks/{stack_id}", response_model=MCPStackWithServers)
async def update_stack(
    stack_id: UUID,
    request: UpdateStackRequest,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Update stack configuration"""
    try:
        return await manager.update_stack(stack_id, current_user, request)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to update stack: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update stack"
        )


@router.delete("/stacks/{stack_id}")
async def delete_stack(
    stack_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Delete a stack"""
    try:
        await manager.delete_stack(stack_id, current_user)
        return {"message": "Stack deleted successfully"}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to delete stack: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete stack"
        )


@router.put("/stacks/{stack_id}/servers", response_model=MCPStackWithServers)
async def assign_servers_to_stack(
    stack_id: UUID,
    request: AssignStackServersRequest,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Assign servers to a stack"""
    try:
        return await manager.assign_servers_to_stack(stack_id, current_user, request)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to assign servers to stack: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign servers"
        )


@router.put("/stacks/{stack_id}/servers/by-names", response_model=MCPStackWithServers)
async def assign_servers_to_stack_by_names(
    stack_id: UUID,
    request: AssignStackServersByNamesRequest,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Assign servers to a stack using server names (supports discovered servers)"""
    try:
        return await manager.assign_servers_to_stack_by_names(
            stack_id, current_user, request.server_names, request.tool_permissions
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to assign servers to stack by names: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to assign servers by names"
        )


# Server Management Endpoints
@router.post("/servers", response_model=MCPServerWithHealth)
async def create_server(
    request: CreateServerRequest,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Create a new MCP server"""
    try:
        return await manager.create_server(current_user, request)
    except Exception as e:
        logger.error(f"Failed to create server: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/servers", response_model=List[MCPServerWithHealth])
async def list_servers(
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """List all servers for current user"""
    try:
        return await manager.get_user_servers(current_user)
    except Exception as e:
        logger.error(f"Failed to list servers: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve servers"
        )


@router.get("/servers/{server_id}", response_model=MCPServerWithHealth)
async def get_server(
    server_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Get specific server details"""
    try:
        servers = await manager.get_user_servers(current_user)
        server = next((s for s in servers if s.id == server_id), None)

        if not server:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Server not found"
            )

        return server
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get server: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve server"
        )


@router.put("/servers/{server_id}", response_model=MCPServerWithHealth)
async def update_server(
    server_id: UUID,
    request: UpdateServerRequest,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Update server configuration"""
    try:
        return await manager.update_server(server_id, current_user, request)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to update server: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update server"
        )


@router.delete("/servers/{server_id}")
async def delete_server(
    server_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Delete a server"""
    try:
        await manager.delete_server(server_id, current_user)
        return {"message": "Server deleted successfully"}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to delete server: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete server"
        )


@router.post("/servers/{server_id}/test")
async def test_server_health(
    server_id: UUID,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Test server health and connectivity"""
    try:
        health_info = await manager.test_server_health(server_id, current_user)
        return health_info
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to test server health: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to test server health"
        )


# Template Management
@router.get("/templates", response_model=List[StackTemplate])
async def list_stack_templates(
    manager: StackManager = Depends(get_stack_manager)
):
    """Get available stack templates"""
    try:
        return await manager.get_stack_templates()
    except Exception as e:
        logger.error(f"Failed to get templates: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve templates"
        )


@router.post("/templates/{template_name}/stacks", response_model=MCPStackWithServers)
async def create_stack_from_template(
    template_name: str,
    stack_name: Optional[str] = None,
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Create a stack from a template"""
    try:
        return await manager.create_stack_from_template(
            current_user, template_name, stack_name
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Failed to create stack from template: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to create stack from template"
        )


# Dashboard endpoints (for React Flow integration)
@router.get("/dashboard")
async def get_dashboard_data(
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Get all dashboard data for React Flow interface"""
    try:
        # This will be used by the frontend to populate all tabs
        from ..core.agent_manager import agent_manager as agent_mgr

        if not agent_mgr:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Agent manager not available"
            )

        # Get all data needed for dashboard
        agents = await agent_mgr.get_user_agents(current_user)
        stacks = await manager.get_user_stacks(current_user)
        servers = await manager.get_user_servers(current_user)
        templates = await manager.get_stack_templates()

        return {
            "agents": agents,
            "stacks": stacks,
            "servers": servers,
            "templates": templates,
            "timestamp": datetime.utcnow().isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get dashboard data: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve dashboard data"
        )


@router.put("/dashboard/layout")
async def save_dashboard_layout(
    layout_data: Dict[str, Any],
    layout_name: str = "default",
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Save React Flow dashboard layout"""
    try:
        # Save layout to database
        layout_entry = {
            'id': str(uuid4()),
            'user_id': str(current_user),
            'name': layout_name,
            'layout_data': layout_data,
            'is_default': layout_name == "default",
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }

        # Upsert layout
        result = await manager.db.table('dashboard_layouts')\
            .upsert(layout_entry, on_conflict='user_id,name')\
            .execute()

        return {"message": "Layout saved successfully", "layout": result.data[0]}

    except Exception as e:
        logger.error(f"Failed to save dashboard layout: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save layout"
        )


@router.get("/dashboard/layout")
async def get_dashboard_layout(
    layout_name: str = "default",
    current_user: UUID = Depends(get_current_user),
    manager: StackManager = Depends(get_stack_manager)
):
    """Get saved React Flow dashboard layout"""
    try:
        result = await manager.db.table('dashboard_layouts')\
            .select('*')\
            .eq('user_id', str(current_user))\
            .eq('name', layout_name)\
            .single()\
            .execute()

        if result.data:
            return result.data
        else:
            # Return empty layout if none exists
            return {
                'layout_data': {'nodes': [], 'edges': []},
                'name': layout_name,
                'is_default': True
            }

    except Exception as e:
        logger.error(f"Failed to get dashboard layout: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve layout"
        )


# Health check
@router.get("/stacks/health")
async def stacks_health():
    """Health check for stack service"""
    return {
        "status": "healthy",
        "service": "stack-management",
        "timestamp": datetime.utcnow().isoformat()
    }


# Initialize dependencies (called from main app)
def init_stack_routes(stack_mgr: StackManager):
    """Initialize route dependencies"""
    global stack_manager
    stack_manager = stack_mgr
    logger.info("Stack routes initialized with manager")

    # Log all routes for debugging
    for route in router.routes:
        if hasattr(route, 'methods') and hasattr(route, 'path'):
            logger.info(f"Registered route: {route.methods} {route.path}")
        elif hasattr(route, 'path'):
            logger.info(f"Registered route: {route.path}")
