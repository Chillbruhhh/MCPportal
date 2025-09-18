"""
Agent Manager for MCP Portal
Handles agent registration, authentication, token management, and real-time tracking
"""

import hashlib
import secrets
import asyncio
import json
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
from uuid import UUID, uuid4
import logging

from ..models.agent import (
    Agent, AgentToken, MCPStack, AgentType, AgentStatus,
    AgentConnectionRequest, AgentConnectionResponse,
    CreateAgentTokenRequest, CreateAgentTokenResponse,
    AgentWithStack, MCPStackWithServers
)

logger = logging.getLogger(__name__)


class AgentManager:
    """Manages agent registration, authentication, and lifecycle"""

    def __init__(self, database_client=None, websocket_manager=None):
        self.db = database_client
        self.ws_manager = websocket_manager
        self.active_agents: Dict[str, Agent] = {}  # token_hash -> Agent
        self.agent_connections: Dict[UUID, Any] = {}  # agent_id -> websocket

    async def create_agent_token(
        self,
        user_id: UUID,
        request: CreateAgentTokenRequest
    ) -> CreateAgentTokenResponse:
        """Create a new agent authentication token"""
        try:
            # Generate secure random token
            raw_token = secrets.token_urlsafe(32)
            token_hash = self._hash_token(raw_token)

            # Calculate expiration if specified
            expires_at = None
            if request.expires_in_days:
                expires_at = datetime.utcnow() + timedelta(days=request.expires_in_days)

            # Create token record
            token_data = {
                'id': str(uuid4()),
                'user_id': str(user_id),
                'token_hash': token_hash,
                'name': request.name,
                'agent_type': request.agent_type,
                'expires_at': expires_at.isoformat() if expires_at else None,
                'is_active': True,
                'created_at': datetime.utcnow().isoformat()
            }

            # Save to database
            await self.db.table('agent_tokens').insert(token_data).execute()

            logger.info(f"Created agent token for user {user_id}: {request.name}")

            return CreateAgentTokenResponse(
                token_id=UUID(token_data['id']),
                token=raw_token,  # Only returned once!
                name=request.name,
                agent_type=request.agent_type,
                expires_at=expires_at
            )

        except Exception as e:
            logger.error(f"Failed to create agent token: {e}")
            raise

    async def connect_agent_via_mcp(
        self,
        request: AgentConnectionRequest,
        websocket=None
    ) -> AgentConnectionResponse:
        """
        Connect an agent via MCP protocol with enhanced auto-discovery.
        This method handles the special case of agents connecting through MCP server protocol.
        """
        try:
            token_hash = self._hash_token(request.token)

            # Validate token and get user
            token_result = await self.db.table('agent_tokens')\
                .select('*')\
                .eq('token_hash', token_hash)\
                .eq('is_active', True)\
                .single()\
                .execute()

            if not token_result.data:
                raise ValueError("Invalid or expired token")

            token_data = token_result.data
            user_id = UUID(token_data['user_id'])

            # Check token expiration
            if token_data.get('expires_at'):
                expires_at = datetime.fromisoformat(token_data['expires_at'])
                if expires_at < datetime.utcnow():
                    raise ValueError("Token has expired")

            # Check if agent already exists for this token
            existing_agent = await self._get_agent_by_token(token_hash)

            if existing_agent:
                # Update existing agent with MCP connection info
                agent = await self._update_agent_mcp_connection(existing_agent, request)
            else:
                # Create new agent with MCP discovery info
                agent = await self._create_new_mcp_agent(user_id, token_hash, request)

            # Store in active agents
            self.active_agents[token_hash] = agent

            # Store WebSocket connection if provided
            if websocket:
                self.agent_connections[agent.id] = websocket

            # Update token last_used
            await self.db.table('agent_tokens')\
                .update({'last_used': datetime.utcnow().isoformat()})\
                .eq('token_hash', token_hash)\
                .execute()

            # Get assigned stack information
            assigned_stack = None
            if agent.assigned_stack_id:
                assigned_stack = await self._get_stack_with_servers(agent.assigned_stack_id)

            # Notify other clients about agent discovery via MCP
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'agent_discovered_via_mcp',
                        'agent': {
                            'id': str(agent.id),
                            'name': agent.name,
                            'type': agent.type,
                            'status': agent.status,
                            'assigned_stack_id': str(agent.assigned_stack_id) if agent.assigned_stack_id else None,
                            'connection_method': 'mcp_protocol'
                        }
                    }
                )

            logger.info(f"MCP Agent auto-discovered: {agent.name} ({agent.type}) for user {user_id}")

            return AgentConnectionResponse(
                agent_id=agent.id,
                name=agent.name,
                type=agent.type,
                assigned_stack=assigned_stack,
                websocket_url=f"/ws/agents/{agent.id}"
            )

        except Exception as e:
            logger.error(f"Failed to connect MCP agent: {e}")
            raise

    async def connect_agent(
        self,
        request: AgentConnectionRequest,
        websocket=None
    ) -> AgentConnectionResponse:
        """Connect an agent using authentication token"""
        try:
            token_hash = self._hash_token(request.token)

            # Validate token and get user
            token_result = await self.db.table('agent_tokens')\
                .select('*')\
                .eq('token_hash', token_hash)\
                .eq('is_active', True)\
                .single()\
                .execute()

            if not token_result.data:
                raise ValueError("Invalid or expired token")

            token_data = token_result.data
            user_id = UUID(token_data['user_id'])

            # Check token expiration
            if token_data.get('expires_at'):
                expires_at = datetime.fromisoformat(token_data['expires_at'])
                if expires_at < datetime.utcnow():
                    raise ValueError("Token has expired")

            # Check if agent already exists for this token
            existing_agent = await self._get_agent_by_token(token_hash)

            if existing_agent:
                # Update existing agent
                agent = await self._update_agent_connection(existing_agent, request)
            else:
                # Create new agent
                agent = await self._create_new_agent(user_id, token_hash, request)

            # Store in active agents
            self.active_agents[token_hash] = agent

            # Store WebSocket connection if provided
            if websocket:
                self.agent_connections[agent.id] = websocket

            # Update token last_used
            await self.db.table('agent_tokens')\
                .update({'last_used': datetime.utcnow().isoformat()})\
                .eq('token_hash', token_hash)\
                .execute()

            # Get assigned stack information
            assigned_stack = None
            if agent.assigned_stack_id:
                assigned_stack = await self._get_stack_with_servers(agent.assigned_stack_id)

            # Notify other clients about agent connection
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'agent_connected',
                        'agent': {
                            'id': str(agent.id),
                            'name': agent.name,
                            'type': agent.type,
                            'status': agent.status,
                            'assigned_stack_id': str(agent.assigned_stack_id) if agent.assigned_stack_id else None
                        }
                    }
                )

            logger.info(f"Agent connected: {agent.name} ({agent.type}) for user {user_id}")

            return AgentConnectionResponse(
                agent_id=agent.id,
                name=agent.name,
                type=agent.type,
                assigned_stack=assigned_stack,
                websocket_url=f"/ws/agents/{agent.id}"
            )

        except Exception as e:
            logger.error(f"Failed to connect agent: {e}")
            raise

    async def disconnect_agent(self, agent_id: UUID) -> None:
        """Disconnect an agent and update status"""
        try:
            # Update agent status
            await self.db.table('agents')\
                .update({
                    'status': AgentStatus.OFFLINE,
                    'last_connected': datetime.utcnow().isoformat(),
                    'updated_at': datetime.utcnow().isoformat()
                })\
                .eq('id', str(agent_id))\
                .execute()

            # Remove from active agents
            token_hash_to_remove = None
            for token_hash, agent in self.active_agents.items():
                if agent.id == agent_id:
                    token_hash_to_remove = token_hash
                    break

            if token_hash_to_remove:
                del self.active_agents[token_hash_to_remove]

            # Remove WebSocket connection
            if agent_id in self.agent_connections:
                del self.agent_connections[agent_id]

            # Get agent info for notification
            agent_result = await self.db.table('agents')\
                .select('user_id, name, type')\
                .eq('id', str(agent_id))\
                .single()\
                .execute()

            if agent_result.data and self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    UUID(agent_result.data['user_id']),
                    {
                        'type': 'agent_disconnected',
                        'agent_id': str(agent_id)
                    }
                )

            logger.info(f"Agent disconnected: {agent_id}")

        except Exception as e:
            logger.error(f"Failed to disconnect agent {agent_id}: {e}")

    async def get_user_agents(self, user_id: UUID) -> List[AgentWithStack]:
        """Get all agents for a user with their assigned stacks"""
        try:
            # Get agents
            agents_result = await self.db.table('agents')\
                .select('*')\
                .eq('user_id', str(user_id))\
                .order('created_at', desc=True)\
                .execute()

            agents_with_stacks = []

            for agent_data in agents_result.data:
                agent = Agent(**agent_data)

                # Get assigned stack if exists
                assigned_stack = None
                tools_count = 0
                if agent.assigned_stack_id:
                    assigned_stack = await self._get_stack_with_servers(agent.assigned_stack_id)
                    tools_count = assigned_stack.tools_count if assigned_stack else 0

                # Get last access time
                last_access_result = await self.db.table('agent_access_logs')\
                    .select('created_at')\
                    .eq('agent_id', str(agent.id))\
                    .order('created_at', desc=True)\
                    .limit(1)\
                    .execute()

                last_access = None
                if last_access_result.data:
                    last_access = datetime.fromisoformat(last_access_result.data[0]['created_at'])

                agents_with_stacks.append(AgentWithStack(
                    **agent.model_dump(),
                    assigned_stack=assigned_stack,
                    tools_count=tools_count,
                    last_access=last_access
                ))

            return agents_with_stacks

        except Exception as e:
            logger.error(f"Failed to get user agents: {e}")
            raise

    async def update_agent(
        self,
        agent_id: UUID,
        user_id: UUID,
        updates: Dict[str, Any]
    ) -> Agent:
        """Update agent information"""
        try:
            # Add updated_at timestamp
            updates['updated_at'] = datetime.utcnow().isoformat()

            # Update in database
            result = await self.db.table('agents')\
                .update(updates)\
                .eq('id', str(agent_id))\
                .eq('user_id', str(user_id))\
                .execute()

            if not result.data:
                raise ValueError("Agent not found or access denied")

            updated_agent = Agent(**result.data[0])

            # Update in active agents if connected
            for token_hash, agent in self.active_agents.items():
                if agent.id == agent_id:
                    self.active_agents[token_hash] = updated_agent
                    break

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'agent_updated',
                        'agent': {
                            'id': str(updated_agent.id),
                            'name': updated_agent.name,
                            'type': updated_agent.type,
                            'status': updated_agent.status,
                            'assigned_stack_id': str(updated_agent.assigned_stack_id) if updated_agent.assigned_stack_id else None
                        }
                    }
                )

            logger.info(f"Updated agent {agent_id}: {updates}")
            return updated_agent

        except Exception as e:
            logger.error(f"Failed to update agent {agent_id}: {e}")
            raise

    async def delete_agent(self, agent_id: UUID, user_id: UUID) -> None:
        """Delete an agent and its tokens"""
        try:
            # First disconnect if online
            if agent_id in self.agent_connections:
                await self.disconnect_agent(agent_id)

            # Delete agent tokens
            await self.db.table('agent_tokens')\
                .delete()\
                .eq('user_id', str(user_id))\
                .in_('token_hash',
                     await self._get_agent_token_hashes(agent_id))\
                .execute()

            # Delete agent
            result = await self.db.table('agents')\
                .delete()\
                .eq('id', str(agent_id))\
                .eq('user_id', str(user_id))\
                .execute()

            if not result.data:
                raise ValueError("Agent not found or access denied")

            # Notify clients
            if self.ws_manager:
                await self.ws_manager.broadcast_to_user(
                    user_id,
                    {
                        'type': 'agent_deleted',
                        'agent_id': str(agent_id)
                    }
                )

            logger.info(f"Deleted agent {agent_id}")

        except Exception as e:
            logger.error(f"Failed to delete agent {agent_id}: {e}")
            raise

    async def assign_stack_to_agent(
        self,
        agent_id: UUID,
        stack_id: UUID,
        user_id: UUID
    ) -> None:
        """Assign an MCP stack to an agent"""
        try:
            # Verify stack belongs to user
            stack_result = await self.db.table('mcp_stacks')\
                .select('id')\
                .eq('id', str(stack_id))\
                .eq('user_id', str(user_id))\
                .single()\
                .execute()

            if not stack_result.data:
                raise ValueError("Stack not found or access denied")

            # Update agent
            await self.update_agent(
                agent_id,
                user_id,
                {'assigned_stack_id': str(stack_id)}
            )

            # Update stack
            await self.db.table('mcp_stacks')\
                .update({
                    'agent_id': str(agent_id),
                    'updated_at': datetime.utcnow().isoformat()
                })\
                .eq('id', str(stack_id))\
                .execute()

            logger.info(f"Assigned stack {stack_id} to agent {agent_id}")

        except Exception as e:
            logger.error(f"Failed to assign stack to agent: {e}")
            raise

    async def get_agent_accessible_tools(self, token_hash: str) -> List[Dict[str, Any]]:
        """Get all tools accessible by an agent"""
        try:
            # Use database function for efficient query
            result = await self.db.rpc(
                'get_agent_accessible_tools',
                {'agent_token_hash': token_hash}
            ).execute()

            return result.data or []

        except Exception as e:
            logger.error(f"Failed to get agent accessible tools: {e}")
            return []

    async def validate_agent_access(
        self,
        token_hash: str,
        server_name: str,
        tool_name: str
    ) -> bool:
        """Validate if agent has access to specific tool"""
        try:
            accessible_tools = await self.get_agent_accessible_tools(token_hash)

            for tool in accessible_tools:
                if (tool['server_name'] == server_name and
                    tool['tool_name'] == tool_name):
                    return True

            return False

        except Exception as e:
            logger.error(f"Failed to validate agent access: {e}")
            return False

    async def log_agent_access(
        self,
        token_hash: str,
        tool_name: str,
        server_name: str,
        success: bool,
        error_message: Optional[str] = None,
        response_size: Optional[int] = None,
        duration_ms: Optional[int] = None
    ) -> None:
        """Log agent access attempt"""
        try:
            # Use database function for logging
            await self.db.rpc(
                'log_agent_access',
                {
                    'agent_token_hash': token_hash,
                    'tool_name': tool_name,
                    'server_name': server_name,
                    'success': success,
                    'error_message': error_message,
                    'response_size': response_size,
                    'duration_ms': duration_ms
                }
            ).execute()

        except Exception as e:
            logger.error(f"Failed to log agent access: {e}")

    # Private helper methods
    def _hash_token(self, token: str) -> str:
        """Hash a token for storage"""
        return hashlib.sha256(token.encode()).hexdigest()

    async def _get_agent_by_token(self, token_hash: str) -> Optional[Agent]:
        """Get agent by token hash"""
        try:
            result = await self.db.table('agents')\
                .select('*')\
                .eq('token_hash', token_hash)\
                .single()\
                .execute()

            if result.data:
                return Agent(**result.data)
            return None

        except Exception:
            return None

    async def _create_new_mcp_agent(
        self,
        user_id: UUID,
        token_hash: str,
        request: AgentConnectionRequest
    ) -> Agent:
        """Create a new agent via MCP discovery"""
        agent_data = {
            'id': str(uuid4()),
            'user_id': str(user_id),
            'name': request.agent_name or f"{request.agent_type.replace('-', ' ').title()} Agent",
            'type': request.agent_type or AgentType.CUSTOM,
            'token_hash': token_hash,
            'status': AgentStatus.ONLINE,
            'last_connected': datetime.utcnow().isoformat(),
            'settings': {
                'connection_method': 'mcp_protocol',
                'auto_discovered': True,
                'discovered_at': datetime.utcnow().isoformat()
            },
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }

        result = await self.db.table('agents').insert(agent_data).execute()
        return Agent(**result.data[0])

    async def _update_agent_mcp_connection(
        self,
        agent: Agent,
        request: AgentConnectionRequest
    ) -> Agent:
        """Update existing agent for MCP connection"""
        updates = {
            'status': AgentStatus.ONLINE,
            'last_connected': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat(),
            'settings': {
                **agent.settings,
                'connection_method': 'mcp_protocol',
                'last_mcp_connection': datetime.utcnow().isoformat()
            }
        }

        # Update name if provided
        if request.agent_name and request.agent_name != agent.name:
            updates['name'] = request.agent_name

        # Update type if provided
        if request.agent_type and request.agent_type != agent.type:
            updates['type'] = request.agent_type

        result = await self.db.table('agents')\
            .update(updates)\
            .eq('id', str(agent.id))\
            .execute()

        return Agent(**result.data[0])

    async def _create_new_agent(
        self,
        user_id: UUID,
        token_hash: str,
        request: AgentConnectionRequest
    ) -> Agent:
        """Create a new agent"""
        agent_data = {
            'id': str(uuid4()),
            'user_id': str(user_id),
            'name': request.agent_name or f"Agent {secrets.token_hex(4)}",
            'type': request.agent_type or AgentType.CUSTOM,
            'token_hash': token_hash,
            'status': AgentStatus.ONLINE,
            'last_connected': datetime.utcnow().isoformat(),
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }

        result = await self.db.table('agents').insert(agent_data).execute()
        return Agent(**result.data[0])

    async def _update_agent_connection(
        self,
        agent: Agent,
        request: AgentConnectionRequest
    ) -> Agent:
        """Update existing agent connection"""
        updates = {
            'status': AgentStatus.ONLINE,
            'last_connected': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }

        # Update name if provided
        if request.agent_name and request.agent_name != agent.name:
            updates['name'] = request.agent_name

        # Update type if provided
        if request.agent_type and request.agent_type != agent.type:
            updates['type'] = request.agent_type

        result = await self.db.table('agents')\
            .update(updates)\
            .eq('id', str(agent.id))\
            .execute()

        return Agent(**result.data[0])

    async def _get_stack_with_servers(self, stack_id: UUID) -> Optional[MCPStackWithServers]:
        """Get stack with associated servers"""
        try:
            # Get stack
            stack_result = await self.db.table('mcp_stacks')\
                .select('*')\
                .eq('id', str(stack_id))\
                .single()\
                .execute()

            if not stack_result.data:
                return None

            stack_data = stack_result.data

            # Get assigned servers
            servers_result = await self.db.table('stack_server_assignments')\
                .select('*, mcp_servers(*)')\
                .eq('stack_id', str(stack_id))\
                .execute()

            servers = []
            total_tools = 0

            for assignment in servers_result.data:
                server_data = assignment['mcp_servers']
                if server_data:
                    tools_count = len(server_data.get('tools_config', {}))
                    total_tools += tools_count

                    servers.append({
                        **server_data,
                        'tools_count': tools_count
                    })

            return MCPStackWithServers(
                **stack_data,
                servers=servers,
                tools_count=total_tools
            )

        except Exception as e:
            logger.error(f"Failed to get stack with servers: {e}")
            return None

    async def _get_agent_token_hashes(self, agent_id: UUID) -> List[str]:
        """Get all token hashes for an agent"""
        try:
            result = await self.db.table('agents')\
                .select('token_hash')\
                .eq('id', str(agent_id))\
                .execute()

            return [row['token_hash'] for row in result.data]

        except Exception:
            return []