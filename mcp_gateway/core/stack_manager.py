"""
Stack Manager for MCP Portal
Handles MCP stack creation, assignment, and server management
"""

import asyncio
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID, uuid4
import logging

from ..models.agent import (
    MCPStack, MCPServer, StackServerAssignment,
    CreateStackRequest, UpdateStackRequest, AssignStackServersRequest,
    CreateServerRequest, UpdateServerRequest,
    MCPStackWithServers, MCPServerWithHealth,
    STACK_TEMPLATES, StackTemplate,
    ServerType, HealthStatus
)

logger = logging.getLogger(__name__)


class StackManager:
    """Manages MCP stacks and server assignments"""

    def __init__(self, database_client=None, websocket_manager=None, mcp_gateway=None):
        self.db = database_client
        self.ws_manager = websocket_manager
        self.gateway = mcp_gateway

    # Stack Management
    async def create_stack(
        self,
        user_id: UUID,
        request: CreateStackRequest
    ) -> MCPStackWithServers:
        """Create a new MCP stack"""
        try:
            # Create stack
            stack_data = {
                'id': str(uuid4()),
                'user_id': str(user_id),
                'name': request.name,
                'description': request.description,
                'template_name': request.template_name,
                'server_configs': [],
                'is_active': True,
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }

            stack_result = await self.db.table('mcp_stacks').insert(stack_data).execute()

            # Debug the database response
            logger.info(f"Database response type: {type(stack_result)}")
            logger.info(f"Database response data type: {type(stack_result.data)}")
            logger.info(f"Database response data: {stack_result.data}")

            # Handle different response formats from Supabase
            if hasattr(stack_result, 'data') and stack_result.data:
                if isinstance(stack_result.data, list) and len(stack_result.data) > 0:
                    stack_data_result = stack_result.data[0]
                elif isinstance(stack_result.data, dict):
                    # Check if this is an error response from database
                    if 'code' in stack_result.data and 'message' in stack_result.data:
                        error_msg = stack_result.data.get('message', 'Unknown database error')
                        if '23503' in stack_result.data.get('code', ''):
                            # Foreign key constraint violation
                            if 'user_id' in error_msg:
                                raise ValueError("Development user not found in auth.users table. Please restart the server to create the development user.")
                            else:
                                raise ValueError(f"Database constraint violation: {error_msg}")
                        else:
                            raise ValueError(f"Database error: {error_msg}")

                    stack_data_result = stack_result.data
                else:
                    raise ValueError(f"Unexpected database response format: {type(stack_result.data)}")
            else:
                raise ValueError("No data returned from database after stack creation")

            stack = MCPStack(**stack_data_result)

            # Assign initial servers if provided
            if request.server_ids:
                await self._assign_servers_to_stack(
                    stack.id, request.server_ids, user_id
                )

            # Get stack with servers
            stack_with_servers = await self.get_stack_with_servers(stack.id, user_id)

            # Apply template configuration if specified
            if request.template_name:
                await self._apply_stack_template(stack.id, request.template_name, user_id)

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'stack_created',
                        'stack': {
                            'id': str(stack.id),
                            'name': stack.name,
                            'description': stack.description,
                            'template_name': stack.template_name,
                            'servers_count': len(request.server_ids)
                        }
                    }
                )

            logger.info(f"Created stack {stack.id} for user {user_id}")
            return stack_with_servers

        except Exception as e:
            logger.error(f"Failed to create stack: {e}")
            raise

    async def create_stack_with_server_names(
        self,
        user_id: UUID,
        stack_name: str,
        server_names: List[str],
        description: Optional[str] = None,
        template_name: Optional[str] = None
    ) -> MCPStackWithServers:
        """
        Create a new MCP stack using server names (supports discovered servers).
        This method automatically imports discovered servers into the database as needed.
        """
        try:
            # Auto-import discovered servers and get their UUIDs
            server_uuids = await self._auto_import_discovered_servers(server_names, user_id)

            if not server_uuids:
                raise ValueError(f"No valid servers found for names: {server_names}")

            # Create stack request with the imported server UUIDs
            request = CreateStackRequest(
                name=stack_name,
                description=description,
                template_name=template_name,
                server_ids=server_uuids
            )

            # Use the regular create_stack method
            return await self.create_stack(user_id, request)

        except Exception as e:
            logger.error(f"Failed to create stack with server names: {e}")
            raise

    async def get_user_stacks(self, user_id: UUID) -> List[MCPStackWithServers]:
        """Get all stacks for a user with their servers"""
        try:
            # Get stacks
            stacks_result = await self.db.table('mcp_stacks')\
                .select('*')\
                .eq('user_id', str(user_id))\
                .order('created_at', desc=True)\
                .execute()

            stacks_with_servers = []

            for stack_data in stacks_result.data:
                stack_with_servers = await self._build_stack_with_servers(stack_data)
                stacks_with_servers.append(stack_with_servers)

            return stacks_with_servers

        except Exception as e:
            logger.error(f"Failed to get user stacks: {e}")
            raise

    async def get_stack_with_servers(
        self,
        stack_id: UUID,
        user_id: UUID
    ) -> Optional[MCPStackWithServers]:
        """Get specific stack with servers"""
        try:
            # Get stack
            stack_result = await self.db.table('mcp_stacks')\
                .select('*')\
                .eq('id', str(stack_id))\
                .eq('user_id', str(user_id))\
                .single()\
                .execute()

            if not stack_result.data:
                return None

            return await self._build_stack_with_servers(stack_result.data)

        except Exception as e:
            logger.error(f"Failed to get stack with servers: {e}")
            return None

    async def update_stack(
        self,
        stack_id: UUID,
        user_id: UUID,
        request: UpdateStackRequest
    ) -> MCPStackWithServers:
        """Update stack information"""
        try:
            # Build update data
            updates = {'updated_at': datetime.utcnow().isoformat()}

            if request.name is not None:
                updates['name'] = request.name
            if request.description is not None:
                updates['description'] = request.description
            if request.is_active is not None:
                updates['is_active'] = request.is_active

            # Update stack
            result = await self.db.table('mcp_stacks')\
                .update(updates)\
                .eq('id', str(stack_id))\
                .eq('user_id', str(user_id))\
                .execute()

            if not result.data:
                raise ValueError("Stack not found or access denied")

            # Get updated stack with servers
            updated_stack = await self.get_stack_with_servers(stack_id, user_id)

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'stack_updated',
                        'stack': {
                            'id': str(stack_id),
                            'name': updated_stack.name,
                            'description': updated_stack.description,
                            'is_active': updated_stack.is_active,
                            'servers_count': len(updated_stack.servers)
                        }
                    }
                )

            logger.info(f"Updated stack {stack_id}")
            return updated_stack

        except Exception as e:
            logger.error(f"Failed to update stack: {e}")
            raise

    async def delete_stack(self, stack_id: UUID, user_id: UUID) -> None:
        """Delete a stack and its assignments"""
        try:
            # First check if stack is assigned to any agents
            agents_result = await self.db.table('agents')\
                .select('id, name')\
                .eq('assigned_stack_id', str(stack_id))\
                .execute()

            if agents_result.data:
                agent_names = [agent['name'] for agent in agents_result.data]
                raise ValueError(f"Cannot delete stack - assigned to agents: {', '.join(agent_names)}")

            # Delete stack (assignments will be cascade deleted)
            result = await self.db.table('mcp_stacks')\
                .delete()\
                .eq('id', str(stack_id))\
                .eq('user_id', str(user_id))\
                .execute()

            if not result.data:
                raise ValueError("Stack not found or access denied")

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'stack_deleted',
                        'stack_id': str(stack_id)
                    }
                )

            logger.info(f"Deleted stack {stack_id}")

        except Exception as e:
            logger.error(f"Failed to delete stack: {e}")
            raise

    async def assign_servers_to_stack(
        self,
        stack_id: UUID,
        user_id: UUID,
        request: AssignStackServersRequest
    ) -> MCPStackWithServers:
        """Add servers to a stack (additive - keeps existing servers)"""
        try:
            # Verify stack belongs to user
            stack = await self.get_stack_with_servers(stack_id, user_id)
            if not stack:
                raise ValueError("Stack not found or access denied")

            # Get existing server assignments to prevent duplicates
            existing_assignments = await self.db.table('stack_server_assignments')\
                .select('server_id')\
                .eq('stack_id', str(stack_id))\
                .execute()

            existing_server_ids = {item['server_id'] for item in existing_assignments.data} if existing_assignments.data else set()

            # Filter out servers that are already assigned to prevent duplicates
            new_server_ids = [server_id for server_id in request.server_ids
                            if str(server_id) not in existing_server_ids]

            if not new_server_ids:
                logger.info(f"All requested servers already assigned to stack {stack_id}")
                return stack

            # Add only new assignments
            await self._assign_servers_to_stack(
                stack_id, new_server_ids, user_id, request.tool_permissions
            )

            # Get updated stack
            updated_stack = await self.get_stack_with_servers(stack_id, user_id)

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'stack_servers_updated',
                        'stack': {
                            'id': str(stack_id),
                            'name': updated_stack.name,
                            'servers_count': len(updated_stack.servers),
                            'tools_count': updated_stack.tools_count
                        }
                    }
                )

            logger.info(f"Added {len(new_server_ids)} new servers to stack {stack_id} (skipped {len(request.server_ids) - len(new_server_ids)} duplicates)")
            return updated_stack

        except Exception as e:
            logger.error(f"Failed to assign servers to stack: {e}")
            raise

    async def assign_servers_to_stack_by_names(
        self,
        stack_id: UUID,
        user_id: UUID,
        server_names: List[str],
        tool_permissions: Optional[Dict[str, Dict[str, bool]]] = None
    ) -> MCPStackWithServers:
        """Add servers to a stack using server names (supports discovered servers)"""
        try:
            # Verify stack belongs to user
            stack = await self.get_stack_with_servers(stack_id, user_id)
            if not stack:
                raise ValueError("Stack not found or access denied")

            # Auto-import discovered servers and get their UUIDs
            server_uuids = await self._auto_import_discovered_servers(server_names, user_id)

            if not server_uuids:
                raise ValueError(f"No valid servers found for names: {server_names}")

            # Create request for the UUID-based assignment method
            from ..models.agent import AssignStackServersRequest
            request = AssignStackServersRequest(
                server_ids=server_uuids,
                tool_permissions=tool_permissions
            )

            # Use the existing UUID-based assignment method
            return await self.assign_servers_to_stack(stack_id, user_id, request)

        except Exception as e:
            logger.error(f"Failed to assign servers to stack by names: {e}")
            raise

    # Server Management
    async def create_server(
        self,
        user_id: UUID,
        request: CreateServerRequest
    ) -> MCPServerWithHealth:
        """Create a new MCP server"""
        try:
            # Create server
            server_data = {
                'id': str(uuid4()),
                'user_id': str(user_id),
                'name': request.name,
                'description': request.description,
                'server_type': request.server_type,
                'connection_config': request.connection_config,
                'tools_config': request.tools_config or {},
                'icon_url': request.icon_url,
                'documentation_url': request.documentation_url,
                'health_status': HealthStatus.UNKNOWN,
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }

            result = await self.db.table('mcp_servers').insert(server_data).execute()
            server = MCPServer(**result.data[0])

            # Test server connection if it's a custom server
            if request.server_type == ServerType.CUSTOM:
                await self._test_server_health(server)

            # Build response with health info
            server_with_health = await self._build_server_with_health(server.model_dump())

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'server_created',
                        'server': {
                            'id': str(server.id),
                            'name': server.name,
                            'server_type': server.server_type,
                            'health_status': server.health_status
                        }
                    }
                )

            logger.info(f"Created server {server.id} for user {user_id}")
            return server_with_health

        except Exception as e:
            logger.error(f"Failed to create server: {e}")
            raise

    async def get_user_servers(self, user_id: UUID) -> List[MCPServerWithHealth]:
        """Get all servers for a user"""
        try:
            # Get servers
            servers_result = await self.db.table('mcp_servers')\
                .select('*')\
                .eq('user_id', str(user_id))\
                .order('created_at', desc=True)\
                .execute()

            servers_with_health = []

            for server_data in servers_result.data:
                server_with_health = await self._build_server_with_health(server_data)
                servers_with_health.append(server_with_health)

            return servers_with_health

        except Exception as e:
            logger.error(f"Failed to get user servers: {e}")
            raise

    async def update_server(
        self,
        server_id: UUID,
        user_id: UUID,
        request: UpdateServerRequest
    ) -> MCPServerWithHealth:
        """Update server configuration"""
        try:
            # Build update data
            updates = {'updated_at': datetime.utcnow().isoformat()}

            if request.name is not None:
                updates['name'] = request.name
            if request.description is not None:
                updates['description'] = request.description
            if request.connection_config is not None:
                updates['connection_config'] = request.connection_config
            if request.tools_config is not None:
                updates['tools_config'] = request.tools_config
            if request.icon_url is not None:
                updates['icon_url'] = request.icon_url
            if request.documentation_url is not None:
                updates['documentation_url'] = request.documentation_url

            # Update server
            result = await self.db.table('mcp_servers')\
                .update(updates)\
                .eq('id', str(server_id))\
                .eq('user_id', str(user_id))\
                .execute()

            if not result.data:
                raise ValueError("Server not found or access denied")

            server = MCPServer(**result.data[0])

            # Test health if connection config changed
            if request.connection_config is not None:
                await self._test_server_health(server)

            # Build response
            server_with_health = await self._build_server_with_health(server.model_dump())

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'server_updated',
                        'server': {
                            'id': str(server_id),
                            'name': server.name,
                            'health_status': server.health_status
                        }
                    }
                )

            logger.info(f"Updated server {server_id}")
            return server_with_health

        except Exception as e:
            logger.error(f"Failed to update server: {e}")
            raise

    async def delete_server(self, server_id: UUID, user_id: UUID) -> None:
        """Delete a server"""
        try:
            # Check if server is used in any stacks
            assignments_result = await self.db.table('stack_server_assignments')\
                .select('mcp_stacks!inner(name)')\
                .eq('server_id', str(server_id))\
                .execute()

            if assignments_result.data:
                stack_names = [assign['mcp_stacks']['name'] for assign in assignments_result.data]
                raise ValueError(f"Cannot delete server - used in stacks: {', '.join(stack_names)}")

            # Delete server
            result = await self.db.table('mcp_servers')\
                .delete()\
                .eq('id', str(server_id))\
                .eq('user_id', str(user_id))\
                .execute()

            if not result.data:
                raise ValueError("Server not found or access denied")

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'server_deleted',
                        'server_id': str(server_id)
                    }
                )

            logger.info(f"Deleted server {server_id}")

        except Exception as e:
            logger.error(f"Failed to delete server: {e}")
            raise

    async def test_server_health(self, server_id: UUID, user_id: UUID) -> Dict[str, Any]:
        """Test server health and update status"""
        try:
            # Get server
            server_result = await self.db.table('mcp_servers')\
                .select('*')\
                .eq('id', str(server_id))\
                .eq('user_id', str(user_id))\
                .single()\
                .execute()

            if not server_result.data:
                raise ValueError("Server not found or access denied")

            server = MCPServer(**server_result.data)
            health_info = await self._test_server_health(server)

            return health_info

        except Exception as e:
            logger.error(f"Failed to test server health: {e}")
            raise

    # Template Management
    async def get_stack_templates(self) -> List[StackTemplate]:
        """Get available stack templates"""
        return STACK_TEMPLATES

    async def create_stack_from_template(
        self,
        user_id: UUID,
        template_name: str,
        stack_name: Optional[str] = None
    ) -> MCPStackWithServers:
        """Create a stack from a template"""
        try:
            # Find template
            template = next((t for t in STACK_TEMPLATES if t.name == template_name), None)
            if not template:
                raise ValueError(f"Template '{template_name}' not found")

            # Create stack
            request = CreateStackRequest(
                name=stack_name or template.display_name,
                description=template.description,
                template_name=template_name,
                server_ids=[]  # Will be populated by template
            )

            stack = await self.create_stack(user_id, request)

            # Apply template configuration
            await self._apply_stack_template(stack.id, template_name, user_id)

            return await self.get_stack_with_servers(stack.id, user_id)

        except Exception as e:
            logger.error(f"Failed to create stack from template: {e}")
            raise

    # Auto-import functionality for discovered MCP servers
    async def _auto_import_discovered_servers(
        self,
        server_names: List[str],
        user_id: UUID
    ) -> List[UUID]:
        """
        Auto-import discovered MCP servers into database if they don't exist.
        Returns list of database UUIDs for all servers.
        """
        try:
            server_uuids = []

            for server_name in server_names:
                # First, check if server already exists in database
                existing_result = await self.db.table('mcp_servers')\
                    .select('id')\
                    .eq('name', server_name)\
                    .eq('user_id', str(user_id))\
                    .execute()

                if existing_result.data:
                    # Server already exists, use its UUID
                    server_uuids.append(UUID(existing_result.data[0]['id']))
                    logger.info(f"Found existing database server for '{server_name}': {existing_result.data[0]['id']}")
                else:
                    # Server doesn't exist, auto-import from discovered servers
                    imported_uuid = await self._import_discovered_server(server_name, user_id)
                    if imported_uuid:
                        server_uuids.append(imported_uuid)
                        logger.info(f"Auto-imported discovered server '{server_name}' with UUID: {imported_uuid}")
                    else:
                        logger.warning(f"Failed to auto-import server '{server_name}' - server not found in gateway")

            return server_uuids

        except Exception as e:
            logger.error(f"Failed to auto-import servers: {e}")
            raise

    async def _import_discovered_server(self, server_name: str, user_id: UUID) -> Optional[UUID]:
        """
        Import a single discovered MCP server into the database.
        Returns the new server UUID or None if not found.
        """
        try:
            # Get discovered server from gateway
            if not self.gateway:
                logger.error("Gateway not available for server import")
                return None

            discovered_servers = self.gateway.get_servers()
            discovered_server = next((s for s in discovered_servers if s.name == server_name), None)

            if not discovered_server:
                logger.warning(f"Discovered server '{server_name}' not found in gateway")
                return None

            # Create database server record
            server_id = uuid4()
            server_data = {
                'id': str(server_id),
                'user_id': str(user_id),
                'name': discovered_server.name,
                'description': f"Auto-imported from discovered MCP server",
                'server_type': ServerType.DISCOVERED,
                'connection_config': {
                    'url': discovered_server.url,
                    'source': discovered_server.source or 'auto-discovered'
                },
                'tools_config': {},
                'health_status': self._map_mcp_status_to_health(discovered_server.status),
                'created_at': datetime.utcnow().isoformat(),
                'updated_at': datetime.utcnow().isoformat()
            }

            result = await self.db.table('mcp_servers').insert(server_data).execute()

            if result.data:
                logger.info(f"Successfully imported discovered server '{server_name}' as database server")
                return server_id
            else:
                logger.error(f"Failed to insert discovered server '{server_name}' into database")
                return None

        except Exception as e:
            logger.error(f"Failed to import discovered server '{server_name}': {e}")
            return None

    def _map_mcp_status_to_health(self, mcp_status) -> HealthStatus:
        """Map MCP server status to database health status"""
        from ..models.mcp import MCPServerStatus

        if mcp_status == MCPServerStatus.CONNECTED:
            return HealthStatus.HEALTHY
        elif mcp_status == MCPServerStatus.FAILED:
            return HealthStatus.ERROR
        elif mcp_status == MCPServerStatus.DISCONNECTED:
            return HealthStatus.OFFLINE
        else:
            return HealthStatus.UNKNOWN

    # Private helper methods
    async def _build_stack_with_servers(self, stack_data: Dict[str, Any]) -> MCPStackWithServers:
        """Build MCPStackWithServers from database data"""
        try:
            # Get assigned servers
            assignments_result = await self.db.table('stack_server_assignments')\
                .select('*, mcp_servers(*)')\
                .eq('stack_id', stack_data['id'])\
                .execute()

            servers = []
            total_tools = 0

            for assignment in assignments_result.data:
                server_data = assignment['mcp_servers']
                if server_data:
                    server_with_health = await self._build_server_with_health(server_data)
                    servers.append(server_with_health)
                    total_tools += server_with_health.tools_count

            return MCPStackWithServers(
                **stack_data,
                servers=servers,
                tools_count=total_tools
            )

        except Exception as e:
            logger.error(f"Failed to build stack with servers: {e}")
            raise

    async def _build_server_with_health(self, server_data: Dict[str, Any]) -> MCPServerWithHealth:
        """Build MCPServerWithHealth from database data"""
        try:
            # Count tools
            tools_config = server_data.get('tools_config', {})
            tools_count = len(tools_config) if isinstance(tools_config, dict) else 0

            # Get last error from health check if any
            last_error = None
            if server_data.get('health_status') == HealthStatus.ERROR:
                # Could store last error in a separate field or derive from logs
                last_error = "Connection failed"

            return MCPServerWithHealth(
                **server_data,
                tools_count=tools_count,
                last_error=last_error
            )

        except Exception as e:
            logger.error(f"Failed to build server with health: {e}")
            # Return basic server info even if health check fails
            return MCPServerWithHealth(
                **server_data,
                tools_count=0,
                last_error=str(e)
            )

    async def _assign_servers_to_stack(
        self,
        stack_id: UUID,
        server_ids: List[UUID],
        user_id: UUID,
        tool_permissions: Optional[Dict[str, Dict[str, bool]]] = None
    ) -> None:
        """Assign servers to a stack"""
        try:
            assignments = []

            for server_id in server_ids:
                # Verify server belongs to user
                server_result = await self.db.table('mcp_servers')\
                    .select('id')\
                    .eq('id', str(server_id))\
                    .eq('user_id', str(user_id))\
                    .single()\
                    .execute()

                if not server_result.data:
                    raise ValueError(f"Server {server_id} not found or access denied")

                # Get tool permissions for this server
                server_permissions = {}
                if tool_permissions and str(server_id) in tool_permissions:
                    server_permissions = tool_permissions[str(server_id)]

                assignments.append({
                    'id': str(uuid4()),
                    'stack_id': str(stack_id),
                    'server_id': str(server_id),
                    'server_config': {},
                    'tool_permissions': server_permissions,
                    'created_at': datetime.utcnow().isoformat()
                })

            if assignments:
                await self.db.table('stack_server_assignments').insert(assignments).execute()

        except Exception as e:
            logger.error(f"Failed to assign servers to stack: {e}")
            raise

    async def _apply_stack_template(
        self,
        stack_id: UUID,
        template_name: str,
        user_id: UUID
    ) -> None:
        """Apply template configuration to a stack"""
        try:
            template = next((t for t in STACK_TEMPLATES if t.name == template_name), None)
            if not template:
                return

            # Find matching servers by name
            servers_result = await self.db.table('mcp_servers')\
                .select('id, name')\
                .eq('user_id', str(user_id))\
                .execute()

            available_servers = {server['name']: server['id'] for server in servers_result.data}

            # Find servers that match template recommendations
            matching_server_ids = []
            for recommended_name in template.recommended_servers:
                # Try exact match first
                if recommended_name in available_servers:
                    matching_server_ids.append(UUID(available_servers[recommended_name]))
                else:
                    # Try partial match
                    for server_name, server_id in available_servers.items():
                        if recommended_name.lower() in server_name.lower():
                            matching_server_ids.append(UUID(server_id))
                            break

            # Assign matching servers
            if matching_server_ids:
                await self._assign_servers_to_stack(stack_id, matching_server_ids, user_id)

            # Update stack with template config
            await self.db.table('mcp_stacks')\
                .update({
                    'server_configs': [template.default_config],
                    'updated_at': datetime.utcnow().isoformat()
                })\
                .eq('id', str(stack_id))\
                .execute()

        except Exception as e:
            logger.error(f"Failed to apply stack template: {e}")

    async def _test_server_health(self, server: MCPServer) -> Dict[str, Any]:
        """Test server health and update status"""
        try:
            health_status = HealthStatus.UNKNOWN
            error_message = None
            tools_discovered = 0

            # Test connection based on server type
            if self.gateway:
                try:
                    # Try to list tools from the server
                    tools = await self.gateway.list_tools(server.name)
                    tools_discovered = len(tools) if tools else 0
                    health_status = HealthStatus.HEALTHY
                except Exception as e:
                    health_status = HealthStatus.ERROR
                    error_message = str(e)
            else:
                # Basic connection test if no gateway available
                health_status = HealthStatus.UNKNOWN

            # Update server health in database
            await self.db.table('mcp_servers')\
                .update({
                    'health_status': health_status,
                    'last_health_check': datetime.utcnow().isoformat(),
                    'updated_at': datetime.utcnow().isoformat()
                })\
                .eq('id', str(server.id))\
                .execute()

            return {
                'health_status': health_status,
                'tools_discovered': tools_discovered,
                'error_message': error_message,
                'last_checked': datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error(f"Failed to test server health: {e}")
            return {
                'health_status': HealthStatus.ERROR,
                'tools_discovered': 0,
                'error_message': str(e),
                'last_checked': datetime.utcnow().isoformat()
            }