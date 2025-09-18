"""
Core Gateway Logic.

This module implements the central MCP Gateway that orchestrates
server interactions, request routing, and response aggregation.
"""

import asyncio
import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..config.settings import Settings, MCPServerConfig
from ..models.gateway import (
    GatewayMetrics,
    GatewayStatus,
    HealthCheckResult,
    ResourceRequest,
    ResourceResponse,
    ServerEvent,
    ServerEventType,
    ServerStatistics,
    ToolExecutionRequest,
    ToolExecutionResponse,
)
from ..models.mcp import (
    AggregatedResource,
    AggregatedTool,
    MCPRequest,
    MCPResponse,
    MCPServer,
    MCPServerStatus,
)
from .aggregator import MCPAggregator
from .discovery import MCPDiscovery
from .process_manager import MCPProcessManager

logger = logging.getLogger(__name__)


class MCPGateway:
    """Central MCP Gateway that manages servers and routes requests."""

    def __init__(self, settings: Settings):
        """
        Initialize MCP Gateway.

        Args:
            settings: Application settings
        """
        self.settings = settings
        self.discovery = MCPDiscovery(
            connection_timeout=settings.connection_timeout,
            max_retries=settings.max_retries
        )
        self.process_manager = MCPProcessManager()
        self.aggregator = MCPAggregator(
            prefix_strategy=getattr(settings, "prefix_strategy", "server_name")
        )

        # Gateway state
        self._start_time = datetime.utcnow()
        self._servers: Dict[str, MCPServer] = {}
        self._server_configs: Dict[str, MCPServerConfig] = {}
        self._server_stats: Dict[str, ServerStatistics] = {}
        self._event_callbacks: List[callable] = []
        self._metrics = GatewayMetrics()

        # Background tasks
        self._health_check_task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self):
        """Start the gateway and initialize connections."""
        logger.info("Starting MCP Gateway")
        self._running = True

        # Only discover servers at startup, don't initialize them
        # Servers will be initialized when enabled via UI
        logger.info("Discovering MCP servers from IDE configurations...")
        await self._discover_servers()

        # Start background health checking
        self._health_check_task = asyncio.create_task(
            self._health_check_loop(),
            name="health-check-loop"
        )

        logger.info("MCP Gateway started successfully")

    async def stop(self):
        """Stop the gateway and clean up connections."""
        logger.info("Stopping MCP Gateway")
        self._running = False

        # Stop health check task
        if self._health_check_task and not self._health_check_task.done():
            self._health_check_task.cancel()
            try:
                await self._health_check_task
            except asyncio.CancelledError:
                pass

        # Clean up discovery and process manager
        await self.discovery.cleanup()
        await self.process_manager.stop_all_servers()

        logger.info("MCP Gateway stopped")

    async def _discover_servers(self):
        """Discover servers from IDE configurations and store them without initializing."""
        server_configs = self.settings.get_mcp_servers_with_discovery()

        if not server_configs:
            logger.warning("No MCP servers configured or discovered")
            return

        logger.info(f"Discovered {len(server_configs)} MCP servers (configured + discovered)")

        # Create MCPServer objects for discovered servers but don't initialize them
        for config in server_configs:
            if not config.command and not config.url:
                logger.warning(f"Server {config.name} has no command or URL specified, skipping")
                continue
                
            # Create URL from config - if it's a command, use stdio:// scheme  
            url = config.url if config.url else f"stdio://{config.command}"
            
            # Create server object in disconnected state
            server = MCPServer(
                name=config.name,
                url=url,
                status=MCPServerStatus.DISCONNECTED,
                source=getattr(config, 'source', 'unknown'),
                last_error="Not connected - discovered from IDE configuration",
                max_retries=getattr(config, 'max_retries', 3)
            )
            
            # Store server in gateway state
            self._servers[config.name] = server
            
            # Cache server configuration for later use
            self._server_configs[config.name] = config
            
            # Initialize server statistics
            self._server_stats[config.name] = ServerStatistics(
                server_name=config.name,
                total_requests=0,
                successful_requests=0,
                failed_requests=0,
                average_response_time=0.0,
                last_request_time=None,
                error_count=0
            )
            
            logger.info(f"Discovered server: {config.name} (source: {getattr(config, 'source', 'unknown')})")

    async def refresh_discovery(self):
        """Refresh server discovery from IDE configurations."""
        # Clear existing servers
        self._servers.clear()
        self._server_configs.clear()
        self._server_stats.clear()
        
        # Rediscover servers
        await self._discover_servers()
        
        # Broadcast status update
        await self._broadcast_status_update()

    async def _broadcast_status_update(self):
        """Broadcast status update to SSE clients."""
        from ..ui.sse import sse_manager
        if sse_manager:
            await sse_manager.broadcast_status_update()

    async def _initialize_servers(self):
        """Initialize connections to configured servers."""
        server_configs = self.settings.get_mcp_servers_with_discovery()

        if not server_configs:
            logger.warning("No MCP servers configured or discovered")
            return

        logger.info(f"Initializing {len(server_configs)} MCP servers (configured + discovered)")

        all_servers = []
        
        # Separate command-based and URL-based servers
        command_servers = []
        url_servers = []
        
        for config in server_configs:
            # Skip servers without proper configuration
            if not config.command and not config.url:
                logger.warning(f"Server {config.name} has no command or URL specified, skipping")
                continue
                
            if config.command:
                command_servers.append(config)
            elif config.url:
                url_servers.append(config)
        
        # Start command-based servers (stdio)
        for config in command_servers:
            try:
                server = await self.process_manager.start_server(config)
                if server:
                    all_servers.append(server)
                    logger.info(f"Successfully started command-based server: {config.name}")
                else:
                    logger.error(f"Failed to start command-based server: {config.name}")
            except Exception as e:
                logger.error(f"Error starting command-based server {config.name}: {e}")
        
        # Connect to URL-based servers (HTTP)
        if url_servers:
            discovered_servers = await self.discovery.discover_servers(url_servers)
            for server in discovered_servers:
                if server.status == MCPServerStatus.CONNECTED:
                    all_servers.append(server)
                    logger.info(f"Successfully connected to URL-based server: {server.name}")
                else:
                    logger.error(f"Failed to connect to URL-based server: {server.name} - {server.last_error}")
        
        # Update server registry
        for server in all_servers:
            self._servers[server.name] = server
            self._server_stats[server.name] = ServerStatistics(
                server_name=server.name,
                status=server.status,
                last_ping=server.last_ping or datetime.utcnow()
            )

        # Aggregate tools and resources
        # tools/resources will be aggregated when servers are toggled (process_manager already has them)

        logger.info(
            f"Server initialization complete: {len(all_servers)} servers connected, "
            f"{len(self._servers)} total servers"
        )

        # Emit server events
        for server in all_servers:
            await self._emit_server_event(
                ServerEventType.CONNECTED if server.status == MCPServerStatus.CONNECTED
                else ServerEventType.FAILED,
                server.name,
                f"Server {server.status.value}"
            )

    async def _health_check_loop(self):
        """Background health check loop."""
        while self._running:
            try:
                await asyncio.sleep(self.settings.health_check_interval)

                if not self._running:
                    break

                await self._perform_health_checks()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Health check loop error: {e}")

    async def _perform_health_checks(self):
        """Perform health checks on all servers."""
        if not self._servers:
            return

        logger.debug("Performing health checks on all servers")

        health_results = await self.discovery.health_check_all_servers()

        for server_name, is_healthy in health_results.items():
            if server_name not in self._servers:
                continue

            server = self._servers[server_name]
            previous_status = server.status

            if is_healthy:
                server.status = MCPServerStatus.CONNECTED
                server.last_ping = datetime.utcnow()
                server.retry_count = 0
            else:
                server.retry_count += 1
                if server.retry_count >= server.max_retries:
                    server.status = MCPServerStatus.FAILED
                else:
                    server.status = MCPServerStatus.RECONNECTING

            # Emit event if status changed
            if previous_status != server.status:
                await self._emit_server_event(
                    ServerEventType.CONNECTED if server.status == MCPServerStatus.CONNECTED
                    else ServerEventType.FAILED,
                    server_name,
                    f"Server status changed from {previous_status.value} to {server.status.value}"
                )

                # If server failed, try to reconnect
                if server.status == MCPServerStatus.FAILED:
                    asyncio.create_task(
                        self._attempt_reconnection(server_name),
                        name=f"reconnect-{server_name}"
                    )

    async def _attempt_reconnection(self, server_name: str):
        """Attempt to reconnect a failed server."""
        logger.info(f"Attempting to reconnect server: {server_name}")

        await self._emit_server_event(
            ServerEventType.RECONNECTING,
            server_name,
            "Attempting to reconnect server"
        )

        success = await self.discovery.reconnect_server(server_name)

        if success:
            server = self._servers[server_name]
            server.status = MCPServerStatus.CONNECTED
            server.retry_count = 0

            # Refresh aggregation
            servers = await self.discovery.get_all_servers()
            await self.aggregator.refresh_aggregation(servers)

            await self._emit_server_event(
                ServerEventType.CONNECTED,
                server_name,
                "Server reconnected successfully"
            )
        else:
            await self._emit_server_event(
                ServerEventType.FAILED,
                server_name,
                "Server reconnection failed"
            )

    async def _emit_server_event(self, event_type: ServerEventType,
                               server_name: str, message: str,
                               data: Optional[Dict[str, Any]] = None):
        """Emit server event to registered callbacks."""
        event = ServerEvent(
            event_type=event_type,
            server_name=server_name,
            message=message,
            data=data
        )

        for callback in self._event_callbacks:
            try:
                await callback(event)
            except Exception as e:
                logger.error(f"Error in event callback: {e}")

    def register_event_callback(self, callback: callable):
        """Register callback for server events."""
        self._event_callbacks.append(callback)

    async def execute_tool(self, request: ToolExecutionRequest) -> ToolExecutionResponse:
        """
        Execute a tool on the appropriate MCP server.

        Args:
            request: Tool execution request

        Returns:
            Tool execution response
        """
        start_time = time.time()

        # Find the tool
        tool = self.aggregator.find_tool_by_name(request.tool_name)
        if not tool:
            return ToolExecutionResponse(
                tool_name=request.tool_name,
                server_name="unknown",
                success=False,
                error=f"Tool '{request.tool_name}' not found",
                execution_time=time.time() - start_time
            )

        # Get server
        server = self._servers.get(tool.server_name)
        if not server or server.status != MCPServerStatus.CONNECTED:
            return ToolExecutionResponse(
                tool_name=request.tool_name,
                server_name=tool.server_name,
                success=False,
                error=f"Server '{tool.server_name}' is not available",
                execution_time=time.time() - start_time
            )

        # Execute tool - check if it's a command-based or URL-based server
        try:
            if server.url.startswith(("process://", "stdio://")):
                # Use process manager for command-based servers
                result = await self.process_manager.call_tool(
                    tool.server_name,
                    tool.original_name,
                    request.parameters
                )
                execution_time = time.time() - start_time
                
                # Update server statistics
                self._update_server_stats(tool.server_name, execution_time, True)
                
                return ToolExecutionResponse(
                    tool_name=request.tool_name,
                    server_name=tool.server_name,
                    success=True,
                    result=result,
                    execution_time=execution_time
                )
            else:
                # Use discovery for URL-based servers
                client = await self.discovery.get_server_client(tool.server_name)
                if not client:
                    return ToolExecutionResponse(
                        tool_name=request.tool_name,
                        server_name=tool.server_name,
                        success=False,
                        error=f"No client connection for server '{tool.server_name}'",
                        execution_time=time.time() - start_time
                    )

                mcp_request = MCPRequest(
                    id=self.discovery.generate_request_id(),
                    method="tools/call",
                    params={
                        "name": tool.original_name,
                        "arguments": request.parameters
                    }
                )

                response = await client.post(
                    server.url,
                    json=mcp_request.model_dump(),
                    headers={"Content-Type": "application/json"},
                    timeout=request.timeout or 30
                )

                execution_time = time.time() - start_time

                # Update server statistics
                self._update_server_stats(tool.server_name, execution_time, True)

                if response.status_code == 200:
                    mcp_response = MCPResponse(**response.json())

                    if mcp_response.error:
                        return ToolExecutionResponse(
                            tool_name=request.tool_name,
                            server_name=tool.server_name,
                            success=False,
                            error=str(mcp_response.error),
                            execution_time=execution_time
                        )

                    return ToolExecutionResponse(
                        tool_name=request.tool_name,
                        server_name=tool.server_name,
                        success=True,
                        result=mcp_response.result,
                        execution_time=execution_time
                    )
                else:
                    return ToolExecutionResponse(
                        tool_name=request.tool_name,
                        server_name=tool.server_name,
                        success=False,
                        error=f"HTTP {response.status_code}: {response.text}",
                        execution_time=execution_time
                    )

        except Exception as e:
            execution_time = time.time() - start_time
            self._update_server_stats(tool.server_name, execution_time, False)

            return ToolExecutionResponse(
                tool_name=request.tool_name,
                server_name=tool.server_name,
                success=False,
                error=str(e),
                execution_time=execution_time
            )

    async def access_resource(self, request: ResourceRequest) -> ResourceResponse:
        """
        Access a resource from the appropriate MCP server.

        Args:
            request: Resource access request

        Returns:
            Resource access response
        """
        # Find the resource
        resource = self.aggregator.find_resource_by_uri(request.resource_uri)
        if not resource:
            return ResourceResponse(
                resource_uri=request.resource_uri,
                server_name="unknown",
                success=False,
                error=f"Resource '{request.resource_uri}' not found"
            )

        # Get server
        server = self._servers.get(resource.server_name)
        if not server or server.status != MCPServerStatus.CONNECTED:
            return ResourceResponse(
                resource_uri=request.resource_uri,
                server_name=resource.server_name,
                success=False,
                error=f"Server '{resource.server_name}' is not available"
            )

        # Access resource - check if it's a command-based or URL-based server
        try:
            if server.url.startswith(("process://", "stdio://")):
                # Use process manager for command-based servers
                result = await self.process_manager.read_resource(
                    resource.server_name,
                    resource.original_uri
                )
                
                # Extract content from result
                content = ""
                mime_type = None
                if result and "contents" in result:
                    contents = result["contents"]
                    if contents and len(contents) > 0:
                        content = contents[0].get("text", "")
                        mime_type = contents[0].get("mimeType")
                
                return ResourceResponse(
                    resource_uri=request.resource_uri,
                    server_name=resource.server_name,
                    success=True,
                    content=content,
                    mime_type=mime_type
                )
            else:
                # Use discovery for URL-based servers
                client = await self.discovery.get_server_client(resource.server_name)
                if not client:
                    return ResourceResponse(
                        resource_uri=request.resource_uri,
                        server_name=resource.server_name,
                        success=False,
                        error=f"No client connection for server '{resource.server_name}'"
                    )

                mcp_request = MCPRequest(
                    id=self.discovery.generate_request_id(),
                    method="resources/read",
                    params={
                        "uri": resource.original_uri,
                        **(request.parameters or {})
                    }
                )

                response = await client.post(
                    server.url,
                    json=mcp_request.model_dump(),
                    headers={"Content-Type": "application/json"}
                )

                if response.status_code == 200:
                    mcp_response = MCPResponse(**response.json())

                    if mcp_response.error:
                        return ResourceResponse(
                            resource_uri=request.resource_uri,
                            server_name=resource.server_name,
                            success=False,
                            error=str(mcp_response.error)
                        )

                    result = mcp_response.result or {}
                    return ResourceResponse(
                        resource_uri=request.resource_uri,
                        server_name=resource.server_name,
                        success=True,
                        content=result.get("contents", [{}])[0].get("text", ""),
                        mime_type=result.get("contents", [{}])[0].get("mimeType")
                    )
                else:
                    return ResourceResponse(
                        resource_uri=request.resource_uri,
                        server_name=resource.server_name,
                        success=False,
                        error=f"HTTP {response.status_code}: {response.text}"
                    )

        except Exception as e:
            return ResourceResponse(
                resource_uri=request.resource_uri,
                server_name=resource.server_name,
                success=False,
                error=str(e)
            )

    def _update_server_stats(self, server_name: str, execution_time: float, success: bool):
        """Update server statistics."""
        if server_name not in self._server_stats:
            self._server_stats[server_name] = ServerStatistics(
                server_name=server_name
            )

        stats = self._server_stats[server_name]
        stats.total_requests += 1
        stats.last_request = datetime.utcnow()

        if success:
            stats.successful_requests += 1
        else:
            stats.failed_requests += 1

        # Update average response time
        if stats.total_requests == 1:
            stats.average_response_time = execution_time
        else:
            stats.average_response_time = (
                (stats.average_response_time * (stats.total_requests - 1) + execution_time) /
                stats.total_requests
            )

    async def get_status(self) -> GatewayStatus:
        """Get current gateway status."""
        servers = list(self._servers.values())
        active_servers = sum(1 for s in servers if s.status == MCPServerStatus.CONNECTED)
        failed_servers = sum(1 for s in servers if s.status == MCPServerStatus.FAILED)

        uptime = datetime.utcnow() - self._start_time
        uptime_str = str(uptime).split('.')[0]  # Remove microseconds

        return GatewayStatus(
            total_servers=len(servers),
            active_servers=active_servers,
            failed_servers=failed_servers,
            total_tools=len(self.aggregator.get_all_tools()),
            total_resources=len(self.aggregator.get_all_resources()),
            uptime=uptime_str,
            last_updated=datetime.utcnow()
        )

    async def get_health_results(self) -> List[HealthCheckResult]:
        """Get health check results for all servers."""
        results = []

        for server_name, server in self._servers.items():
            health_result = HealthCheckResult(
                server_name=server_name,
                healthy=server.status == MCPServerStatus.CONNECTED,
                response_time=0.0,  # Would need to track this separately
                error=server.last_error,
                timestamp=server.last_ping or datetime.utcnow()
            )
            results.append(health_result)

        return results

    def get_servers(self) -> List[MCPServer]:
        """Get all servers."""
        return list(self._servers.values())

    def get_server_by_name(self, name: str) -> Optional[MCPServer]:
        """Get server by name."""
        return self._servers.get(name)

    def get_aggregated_tools(self) -> List[AggregatedTool]:
        """Get all aggregated tools."""
        return self.aggregator.get_all_tools()

    def get_aggregated_resources(self) -> List[AggregatedResource]:
        """Get all aggregated resources."""
        return self.aggregator.get_all_resources()

    def get_metrics(self) -> GatewayMetrics:
        """Get gateway metrics."""
        total_requests = sum(stats.total_requests for stats in self._server_stats.values())
        successful_requests = sum(stats.successful_requests for stats in self._server_stats.values())
        failed_requests = sum(stats.failed_requests for stats in self._server_stats.values())

        if total_requests > 0:
            avg_response_time = sum(
                stats.average_response_time * stats.total_requests
                for stats in self._server_stats.values()
            ) / total_requests
        else:
            avg_response_time = 0.0

        return GatewayMetrics(
            total_requests=total_requests,
            successful_requests=successful_requests,
            failed_requests=failed_requests,
            average_response_time=avg_response_time,
            active_connections=len(self._event_callbacks),
            server_statistics=list(self._server_stats.values())
        )

    # Server Management Methods

    async def toggle_server(self, server_name: str, enabled: bool) -> bool:
        """
        Toggle server enabled/disabled state.
        
        Args:
            server_name: Name of the server to toggle
            enabled: Whether to enable or disable the server
            
        Returns:
            True if successful, False otherwise
        """
        try:
            server = self.get_server_by_name(server_name)
            if not server:
                logger.warning(f"Server '{server_name}' not found for toggle")
                return False
            
            # Get cached server configuration
            server_config = self._server_configs.get(server_name)
            
            if not server_config:
                logger.warning(f"Server configuration for '{server_name}' not found")
                return False
            
            if enabled:
                # Enable server
                server_config.enabled = True

                # Start the server if it's process-based
                if server_config.command:
                    result = await self.process_manager.start_server(server_config)
                    if result:
                        self._servers[server_name] = result
                        self._servers[server_name].enabled = True
                        logger.info(f"Server '{server_name}' enabled and started successfully")
                        # Update aggregation
                        await self.aggregator.update_aggregation(list(self._servers.values()))
                        return True
                    else:
                        logger.warning(f"Server '{server_name}' enabled but failed to start")
                        return False
                else:
                    # For URL-based servers, try to connect
                    success = await self.discovery.connect_to_server(server_name, server.url)
                    if success:
                        updated = self.discovery.get_server(server_name)
                        if updated:
                            updated.enabled = True
                            self._servers[server_name] = updated
                        logger.info(f"Server '{server_name}' enabled and connected successfully")
                        # Update aggregation
                        await self.aggregator.update_aggregation(list(self._servers.values()))
                        return True
                    else:
                        logger.warning(f"Server '{server_name}' enabled but failed to connect")
                        return False
            else:
                # Disable server
                server_config.enabled = False

                # Stop the server if it's process-based
                if server_config.command:
                    await self.process_manager.stop_server(server_name)
                    logger.info(f"Server '{server_name}' disabled and stopped")
                else:
                    # For URL-based servers, disconnect
                    await self.discovery.disconnect_from_server(server_name)
                    logger.info(f"Server '{server_name}' disabled and disconnected")

                if server_name in self._servers:
                    self._servers[server_name].enabled = False
                    self._servers[server_name].status = MCPServerStatus.DISCONNECTED

                # Update aggregation
                await self.aggregator.update_aggregation(list(self._servers.values()))

                return True
            
        except Exception as e:
            logger.error(f"Failed to toggle server '{server_name}': {e}")
            return False

    async def update_server_config(self, server_name: str, updates: dict) -> bool:
        """
        Update server configuration.
        
        Args:
            server_name: Name of the server to update
            updates: Dictionary of configuration updates
            
        Returns:
            True if successful, False otherwise
        """
        try:
            server = self.get_server_by_name(server_name)
            if not server:
                logger.warning(f"Server '{server_name}' not found for update")
                return False
            
            # Update server configuration
            if 'url' in updates:
                server.url = updates['url']
            if 'enabled' in updates:
                # Use toggle_server for enabled state changes
                await self.toggle_server(server_name, updates['enabled'])
            
            logger.info(f"Server '{server_name}' configuration updated")
            return True
            
        except Exception as e:
            logger.error(f"Failed to update server '{server_name}': {e}")
            return False

    async def remove_server(self, server_name: str) -> bool:
        """
        Remove server from gateway.
        
        Args:
            server_name: Name of the server to remove
            
        Returns:
            True if successful, False otherwise
        """
        try:
            server = self.get_server_by_name(server_name)
            if not server:
                logger.warning(f"Server '{server_name}' not found for removal")
                return False
            
            # Disconnect from server
            await self.discovery.disconnect_from_server(server_name)
            
            # Remove from servers dict
            del self._servers[server_name]
            
            # Remove from stats
            if server_name in self._server_stats:
                del self._server_stats[server_name]
            
            # Update aggregation
            await self.aggregator.update_aggregation(list(self._servers.values()))
            
            logger.info(f"Server '{server_name}' removed")
            return True
            
        except Exception as e:
            logger.error(f"Failed to remove server '{server_name}': {e}")
            return False

    async def refresh_discovered_servers(self, discovered_servers: List[MCPServerConfig]) -> bool:
        """
        Refresh the gateway with newly discovered servers.
        
        Args:
            discovered_servers: List of discovered server configurations
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Add new discovered servers
            for server_config in discovered_servers:
                if server_config.name not in self._servers:
                    # Create new server
                    server = MCPServer(
                        name=server_config.name,
                        url=server_config.url,
                        status=MCPServerStatus.DISCONNECTED,
                        last_ping=None,
                        last_error=None
                    )
                    self._servers[server_config.name] = server
                    
                    # Initialize stats
                    self._server_stats[server_config.name] = ServerStatistics(
                        server_name=server_config.name,
                        total_requests=0,
                        successful_requests=0,
                        failed_requests=0,
                        average_response_time=0.0
                    )
                    
                    # Try to connect if enabled
                    if server_config.enabled:
                        await self.discovery.connect_to_server(server_config.name, server_config.url)
            
            # Update aggregation
            await self.aggregator.update_aggregation(list(self._servers.values()))
            
            logger.info(f"Refreshed with {len(discovered_servers)} discovered servers")
            return True
            
        except Exception as e:
            logger.error(f"Failed to refresh discovered servers: {e}")
            return False
