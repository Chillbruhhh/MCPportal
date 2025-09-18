"""
MCP Server Discovery and Connection Management.

This module handles discovering, connecting to, and maintaining
connections with MCP servers.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

import httpx

from ..config.settings import MCPServerConfig
from ..models.mcp import (
    MCPRequest,
    MCPResource,
    MCPResponse,
    MCPServer,
    MCPServerStatus,
    MCPTool,
)

logger = logging.getLogger(__name__)


class MCPDiscovery:
    """Handles MCP server discovery and connection management."""

    def __init__(self, connection_timeout: int = 30, max_retries: int = 3):
        """
        Initialize MCP discovery.

        Args:
            connection_timeout: Connection timeout in seconds
            max_retries: Maximum retry attempts
        """
        self.connection_timeout = connection_timeout
        self.max_retries = max_retries
        self._client_sessions: Dict[str, httpx.AsyncClient] = {}
        self._server_connections: Dict[str, MCPServer] = {}

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.cleanup()

    def generate_request_id(self) -> str:
        """Generate unique request ID."""
        return str(uuid.uuid4())

    async def discover_servers(self, server_configs: List[MCPServerConfig]) -> List[MCPServer]:
        """
        Discover and connect to MCP servers from configuration.

        Args:
            server_configs: List of server configurations

        Returns:
            List of discovered servers with connection status
        """
        servers = []

        # Process servers concurrently
        tasks = []
        for config in server_configs:
            if config.enabled:
                task = asyncio.create_task(
                    self._connect_to_server(config),
                    name=f"connect-{config.name}"
                )
                tasks.append(task)

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, Exception):
                    logger.error(f"Server discovery failed: {result}")
                elif isinstance(result, MCPServer):
                    servers.append(result)
                    self._server_connections[result.name] = result

        logger.info(f"Discovered {len(servers)} servers")
        return servers

    async def _connect_to_server(self, config: MCPServerConfig) -> MCPServer:
        """
        Connect to a single MCP server.

        Args:
            config: Server configuration

        Returns:
            MCPServer with connection status
        """
        server = MCPServer(
            name=config.name,
            url=config.url,
            status=MCPServerStatus.CONNECTING,
            max_retries=config.max_retries
        )

        try:
            # Create persistent HTTP client for this server
            client = httpx.AsyncClient(
                timeout=httpx.Timeout(config.timeout),
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
            )
            self._client_sessions[config.name] = client

            # Perform MCP handshake
            server = await self._perform_handshake(server, client)

            if server.status == MCPServerStatus.CONNECTED:
                # Discover capabilities
                server = await self._discover_capabilities(server, client)

            logger.info(f"Successfully connected to server '{config.name}' at {config.url}")

        except Exception as e:
            logger.error(f"Failed to connect to server '{config.name}': {e}")
            server.status = MCPServerStatus.FAILED
            server.last_error = str(e)

            # Clean up client session on failure
            if config.name in self._client_sessions:
                await self._client_sessions[config.name].aclose()
                del self._client_sessions[config.name]

        return server

    async def _perform_handshake(self, server: MCPServer, client: httpx.AsyncClient) -> MCPServer:
        """
        Perform MCP handshake with server.

        Args:
            server: Server to connect to
            client: HTTP client for requests

        Returns:
            Updated server with connection status
        """
        handshake_request = MCPRequest(
            id=self.generate_request_id(),
            method="initialize",
            params={
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "roots": {},
                    "sampling": {}
                },
                "clientInfo": {
                    "name": "mcp-gateway",
                    "version": "1.0.0"
                }
            }
        )

        response = await client.post(
            server.url,
            json=handshake_request.model_dump(),
            headers={"Content-Type": "application/json"}
        )

        if response.status_code == 200:
            mcp_response = MCPResponse(**response.json())

            if mcp_response.error:
                raise Exception(f"Handshake failed: {mcp_response.error}")

            if mcp_response.result:
                server.status = MCPServerStatus.CONNECTED
                server.last_ping = datetime.utcnow()

                # Extract server capabilities
                server_info = mcp_response.result.get("serverInfo", {})
                capabilities = mcp_response.result.get("capabilities", {})

                server.capabilities = list(capabilities.keys())

                logger.debug(f"Handshake successful with {server.name}: {server_info}")

        else:
            raise Exception(f"HTTP {response.status_code}: {response.text}")

        return server

    async def _discover_capabilities(self, server: MCPServer, client: httpx.AsyncClient) -> MCPServer:
        """
        Discover server capabilities (tools and resources).

        Args:
            server: Connected server
            client: HTTP client for requests

        Returns:
            Updated server with discovered capabilities
        """
        # Discover tools
        if "tools" in server.capabilities:
            try:
                tools = await self._list_tools(server, client)
                server.tools = tools
                logger.debug(f"Discovered {len(tools)} tools from {server.name}")
            except Exception as e:
                logger.warning(f"Failed to list tools from {server.name}: {e}")

        # Discover resources
        if "resources" in server.capabilities:
            try:
                resources = await self._list_resources(server, client)
                server.resources = resources
                logger.debug(f"Discovered {len(resources)} resources from {server.name}")
            except Exception as e:
                logger.warning(f"Failed to list resources from {server.name}: {e}")

        return server

    async def _list_tools(self, server: MCPServer, client: httpx.AsyncClient) -> List[MCPTool]:
        """
        List tools from MCP server.

        Args:
            server: Server to query
            client: HTTP client for requests

        Returns:
            List of available tools
        """
        request = MCPRequest(
            id=self.generate_request_id(),
            method="tools/list",
            params={}
        )

        response = await client.post(
            server.url,
            json=request.model_dump(),
            headers={"Content-Type": "application/json"}
        )

        if response.status_code == 200:
            mcp_response = MCPResponse(**response.json())

            if mcp_response.error:
                raise Exception(f"Tools list failed: {mcp_response.error}")

            if mcp_response.result and "tools" in mcp_response.result:
                tools_data = mcp_response.result["tools"]
                tools = []
                for tool_data in tools_data:
                    tool = MCPTool(**tool_data)
                    tools.append(tool)
                    
                    # Log schema extraction for debugging
                    logger.debug(f"Extracted tool '{tool.name}' from {server.name} with schema: {tool.inputSchema}")
                    
                    # Log if schema is empty
                    if not tool.inputSchema or tool.inputSchema == {}:
                        logger.warning(f"Tool '{tool.name}' from {server.name} has empty schema! Raw tool data: {tool_data}")
                
                logger.info(f"Extracted {len(tools)} tools from {server.name}")
                return tools

        return []

    async def _list_resources(self, server: MCPServer, client: httpx.AsyncClient) -> List[MCPResource]:
        """
        List resources from MCP server.

        Args:
            server: Server to query
            client: HTTP client for requests

        Returns:
            List of available resources
        """
        request = MCPRequest(
            id=self.generate_request_id(),
            method="resources/list",
            params={}
        )

        response = await client.post(
            server.url,
            json=request.model_dump(),
            headers={"Content-Type": "application/json"}
        )

        if response.status_code == 200:
            mcp_response = MCPResponse(**response.json())

            if mcp_response.error:
                raise Exception(f"Resources list failed: {mcp_response.error}")

            if mcp_response.result and "resources" in mcp_response.result:
                resources_data = mcp_response.result["resources"]
                return [MCPResource(**resource) for resource in resources_data]

        return []

    async def health_check_server(self, server_name: str) -> bool:
        """
        Perform health check on a specific server.

        Args:
            server_name: Name of server to check

        Returns:
            True if server is healthy, False otherwise
        """
        if server_name not in self._server_connections:
            return False

        server = self._server_connections[server_name]
        client = self._client_sessions.get(server_name)

        if not client:
            return False

        try:
            # Simple ping request
            ping_request = MCPRequest(
                id=self.generate_request_id(),
                method="ping",
                params={}
            )

            response = await client.post(
                server.url,
                json=ping_request.model_dump(),
                headers={"Content-Type": "application/json"}
            )

            if response.status_code == 200:
                server.last_ping = datetime.utcnow()
                server.status = MCPServerStatus.CONNECTED
                server.retry_count = 0
                return True

        except Exception as e:
            logger.warning(f"Health check failed for {server_name}: {e}")
            server.last_error = str(e)
            server.retry_count += 1

            if server.retry_count >= server.max_retries:
                server.status = MCPServerStatus.FAILED
            else:
                server.status = MCPServerStatus.RECONNECTING

        return False

    async def health_check_all_servers(self) -> Dict[str, bool]:
        """
        Perform health check on all connected servers.

        Returns:
            Dictionary mapping server names to health status
        """
        results = {}

        if not self._server_connections:
            return results

        # Run health checks concurrently
        tasks = []
        for server_name in self._server_connections.keys():
            task = asyncio.create_task(
                self.health_check_server(server_name),
                name=f"health-check-{server_name}"
            )
            tasks.append((server_name, task))

        for server_name, task in tasks:
            try:
                is_healthy = await task
                results[server_name] = is_healthy
            except Exception as e:
                logger.error(f"Health check task failed for {server_name}: {e}")
                results[server_name] = False

        return results

    async def reconnect_server(self, server_name: str) -> bool:
        """
        Attempt to reconnect to a failed server.

        Args:
            server_name: Name of server to reconnect

        Returns:
            True if reconnection successful, False otherwise
        """
        if server_name not in self._server_connections:
            logger.warning(f"Cannot reconnect unknown server: {server_name}")
            return False

        server = self._server_connections[server_name]

        # Clean up existing client session
        if server_name in self._client_sessions:
            await self._client_sessions[server_name].aclose()
            del self._client_sessions[server_name]

        # Create new server config for reconnection
        config = MCPServerConfig(
            name=server.name,
            url=server.url,
            timeout=self.connection_timeout,
            max_retries=self.max_retries
        )

        try:
            reconnected_server = await self._connect_to_server(config)
            self._server_connections[server_name] = reconnected_server

            return reconnected_server.status == MCPServerStatus.CONNECTED

        except Exception as e:
            logger.error(f"Reconnection failed for {server_name}: {e}")
            return False

    async def get_server_client(self, server_name: str) -> Optional[httpx.AsyncClient]:
        """
        Get HTTP client for a specific server.

        Args:
            server_name: Name of server

        Returns:
            HTTP client if available, None otherwise
        """
        return self._client_sessions.get(server_name)

    async def get_connected_servers(self) -> List[MCPServer]:
        """
        Get list of connected servers.

        Returns:
            List of connected servers
        """
        return [
            server for server in self._server_connections.values()
            if server.status == MCPServerStatus.CONNECTED
        ]

    async def get_all_servers(self) -> List[MCPServer]:
        """
        Get list of all servers regardless of status.

        Returns:
            List of all servers
        """
        return list(self._server_connections.values())

    def get_server(self, server_name: str) -> Optional[MCPServer]:
        """Retrieve a cached server connection by name."""
        return self._server_connections.get(server_name)

    async def connect_to_server(self, server_name: str, server_url: str) -> bool:
        """
        Connect to a specific MCP server.
        
        Args:
            server_name: Name of the server
            server_url: URL of the server
            
        Returns:
            True if connection successful, False otherwise
        """
        try:
            config = MCPServerConfig(
                name=server_name,
                url=server_url,
                timeout=self.connection_timeout,
                max_retries=self.max_retries
            )
            
            server = await self._connect_to_server(config)
            self._server_connections[server_name] = server
            
            logger.info(f"Connected to server '{server_name}' at {server_url}")
            return server.status == MCPServerStatus.CONNECTED
            
        except Exception as e:
            logger.error(f"Failed to connect to server '{server_name}': {e}")
            return False

    async def disconnect_from_server(self, server_name: str) -> bool:
        """
        Disconnect from a specific MCP server.
        
        Args:
            server_name: Name of the server to disconnect from
            
        Returns:
            True if disconnection successful, False otherwise
        """
        try:
            # Close client session if exists
            if server_name in self._client_sessions:
                await self._client_sessions[server_name].aclose()
                del self._client_sessions[server_name]
            
            # Update server status
            if server_name in self._server_connections:
                self._server_connections[server_name].status = MCPServerStatus.DISCONNECTED
                logger.info(f"Disconnected from server '{server_name}'")
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to disconnect from server '{server_name}': {e}")
            return False

    async def cleanup(self):
        """Clean up all client sessions."""
        for client in self._client_sessions.values():
            await client.aclose()
        self._client_sessions.clear()
        self._server_connections.clear()
        logger.info("Discovery cleanup completed")
