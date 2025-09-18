"""
Tool/Resource Aggregation Engine.

This module handles aggregating tools and resources from multiple
MCP servers with intelligent prefixing to avoid naming conflicts.
"""

import logging
from collections import defaultdict
from typing import Dict, List, Optional

from ..models.mcp import (
    AggregatedResource,
    AggregatedTool,
    MCPServer,
    MCPServerStatus,
)

logger = logging.getLogger(__name__)


class MCPAggregator:
    """Handles aggregation of tools and resources from multiple MCP servers."""

    def __init__(self, prefix_strategy: str = "server_name"):
        """
        Initialize aggregator.

        Args:
            prefix_strategy: Strategy for prefixing ("server_name", "short_name", "none")
        """
        self.prefix_strategy = prefix_strategy
        self._aggregated_tools: Dict[str, AggregatedTool] = {}
        self._aggregated_resources: Dict[str, AggregatedResource] = {}
        self._tool_conflicts: Dict[str, List[str]] = defaultdict(list)
        self._resource_conflicts: Dict[str, List[str]] = defaultdict(list)

    def _generate_prefix(self, server_name: str) -> str:
        """
        Generate prefix for a server based on the strategy.

        Args:
            server_name: Name of the server

        Returns:
            Prefix to use for tools/resources
        """
        if self.prefix_strategy == "server_name":
            return server_name
        elif self.prefix_strategy == "short_name":
            # Use first word or first 8 chars
            parts = server_name.split("-")
            if len(parts) > 1:
                return parts[0]
            return server_name[:8]
        elif self.prefix_strategy == "none":
            return ""
        else:
            return server_name

    def _detect_conflicts(self, servers: List[MCPServer]) -> None:
        """
        Detect naming conflicts between tools and resources.

        Args:
            servers: List of servers to check for conflicts
        """
        # Track tool names across servers
        tool_names: Dict[str, List[str]] = defaultdict(list)
        resource_uris: Dict[str, List[str]] = defaultdict(list)

        for server in servers:
            if server.status != MCPServerStatus.CONNECTED:
                continue

            # Check tool conflicts
            for tool in server.tools:
                tool_names[tool.name].append(server.name)

            # Check resource conflicts
            for resource in server.resources:
                resource_uris[resource.uri].append(server.name)

        # Store conflicts
        self._tool_conflicts = {
            name: servers for name, servers in tool_names.items()
            if len(servers) > 1
        }

        self._resource_conflicts = {
            uri: servers for uri, servers in resource_uris.items()
            if len(servers) > 1
        }

        if self._tool_conflicts:
            logger.warning(f"Tool name conflicts detected: {list(self._tool_conflicts.keys())}")

        if self._resource_conflicts:
            logger.warning(f"Resource URI conflicts detected: {list(self._resource_conflicts.keys())}")

    async def aggregate_tools(self, servers: List[MCPServer]) -> List[AggregatedTool]:
        """
        Aggregate tools from all connected servers with prefixing.

        Args:
            servers: List of MCP servers

        Returns:
            List of aggregated tools with prefixes
        """
        self._detect_conflicts(servers)
        # Clear existing aggregated tools before re-aggregating
        self._aggregated_tools.clear()
        aggregated_tools = []

        for server in servers:
            if server.status != MCPServerStatus.CONNECTED:
                logger.debug(f"Skipping tools from disconnected server: {server.name}")
                continue

            prefix = self._generate_prefix(server.name)

            for tool in server.tools:
                # Determine if prefixing is needed
                needs_prefix = (
                    self.prefix_strategy != "none" and
                    (tool.name in self._tool_conflicts or prefix)
                )

                if needs_prefix and prefix:
                    prefixed_name = f"{prefix}_{tool.name}"  # Use underscore instead of dot for Claude Code compatibility
                else:
                    prefixed_name = tool.name

                aggregated_tool = AggregatedTool(
                    original_name=tool.name,
                    prefixed_name=prefixed_name,
                    server_name=server.name,
                    description=tool.description,
                    parameters=tool.inputSchema
                )

                aggregated_tools.append(aggregated_tool)
                self._aggregated_tools[prefixed_name] = aggregated_tool

                logger.debug(
                    f"Aggregated tool '{tool.name}' from {server.name} "
                    f"as '{prefixed_name}' with schema: {tool.inputSchema}"
                )

        logger.info(f"Aggregated {len(aggregated_tools)} tools from {len(servers)} servers")
        return aggregated_tools

    async def aggregate_resources(self, servers: List[MCPServer]) -> List[AggregatedResource]:
        """
        Aggregate resources from all connected servers with prefixing.

        Args:
            servers: List of MCP servers

        Returns:
            List of aggregated resources with prefixes
        """
        # Clear existing aggregated resources before re-aggregating
        self._aggregated_resources.clear()
        aggregated_resources = []

        for server in servers:
            if server.status != MCPServerStatus.CONNECTED:
                logger.debug(f"Skipping resources from disconnected server: {server.name}")
                continue

            prefix = self._generate_prefix(server.name)

            for resource in server.resources:
                # Determine if prefixing is needed
                needs_prefix = (
                    self.prefix_strategy != "none" and
                    (resource.uri in self._resource_conflicts or prefix)
                )

                if needs_prefix and prefix:
                    prefixed_uri = f"{prefix}_{resource.uri}"  # Use underscore instead of :// for consistency
                else:
                    prefixed_uri = resource.uri

                aggregated_resource = AggregatedResource(
                    original_uri=resource.uri,
                    prefixed_uri=prefixed_uri,
                    server_name=server.name,
                    name=resource.name,
                    description=resource.description,
                    mime_type=resource.mimeType
                )

                aggregated_resources.append(aggregated_resource)
                self._aggregated_resources[prefixed_uri] = aggregated_resource

                logger.debug(
                    f"Aggregated resource '{resource.uri}' from {server.name} "
                    f"as '{prefixed_uri}'"
                )

        logger.info(f"Aggregated {len(aggregated_resources)} resources from {len(servers)} servers")
        return aggregated_resources

    def find_tool_by_name(self, tool_name: str) -> Optional[AggregatedTool]:
        """
        Find aggregated tool by name (prefixed or original).

        Args:
            tool_name: Tool name to search for

        Returns:
            AggregatedTool if found, None otherwise
        """
        # First try exact match on prefixed name
        if tool_name in self._aggregated_tools:
            return self._aggregated_tools[tool_name]

        # Try converting dot notation to underscore notation for backward compatibility
        # Legacy clients might still send prefix.tool_name format
        if '.' in tool_name:
            # Find the first dot and convert it to an underscore
            first_dot = tool_name.find('.')
            if first_dot != -1:
                normalized_name = tool_name[:first_dot] + '_' + tool_name[first_dot + 1:]
                if normalized_name in self._aggregated_tools:
                    logger.debug(f"Found tool '{tool_name}' via dot-to-underscore normalization to '{normalized_name}'")
                    return self._aggregated_tools[normalized_name]

        # Then try to match original name
        for tool in self._aggregated_tools.values():
            if tool.original_name == tool_name:
                return tool

        logger.warning(f"Tool '{tool_name}' not found. Available tools: {list(self._aggregated_tools.keys())}")
        return None

    def find_resource_by_uri(self, resource_uri: str) -> Optional[AggregatedResource]:
        """
        Find aggregated resource by URI (prefixed or original).

        Args:
            resource_uri: Resource URI to search for

        Returns:
            AggregatedResource if found, None otherwise
        """
        # First try exact match on prefixed URI
        if resource_uri in self._aggregated_resources:
            return self._aggregated_resources[resource_uri]

        # Try converting scheme notation to underscore notation for backward compatibility  
        # Legacy format: prefix://uri -> prefix_uri
        if '://' in resource_uri:
            normalized_uri = resource_uri.replace('://', '_', 1)
            if normalized_uri in self._aggregated_resources:
                logger.debug(f"Found resource '{resource_uri}' via scheme-to-underscore normalization to '{normalized_uri}'")
                return self._aggregated_resources[normalized_uri]

        # Then try to match original URI
        for resource in self._aggregated_resources.values():
            if resource.original_uri == resource_uri:
                return resource

        # Try matching the original URI directly
        for resource in self._aggregated_resources.values():
            if resource.original_uri == resource_uri:
                logger.debug(f"Found resource '{resource_uri}' via original URI match")
                return resource

        logger.warning(f"Resource '{resource_uri}' not found. Available resources: {list(self._aggregated_resources.keys())}")
        return None

    def get_tools_by_server(self, server_name: str) -> List[AggregatedTool]:
        """
        Get all tools provided by a specific server.

        Args:
            server_name: Name of the server

        Returns:
            List of tools from the specified server
        """
        return [
            tool for tool in self._aggregated_tools.values()
            if tool.server_name == server_name
        ]

    def get_resources_by_server(self, server_name: str) -> List[AggregatedResource]:
        """
        Get all resources provided by a specific server.

        Args:
            server_name: Name of the server

        Returns:
            List of resources from the specified server
        """
        return [
            resource for resource in self._aggregated_resources.values()
            if resource.server_name == server_name
        ]

    def get_all_tools(self) -> List[AggregatedTool]:
        """
        Get all aggregated tools.

        Returns:
            List of all aggregated tools
        """
        return list(self._aggregated_tools.values())

    def get_tools_for_server(self, server_name: str) -> List[AggregatedTool]:
        """Return aggregated tools for a specific server."""
        if not server_name:
            return []
        return [
            tool
            for tool in self._aggregated_tools.values()
            if tool.server_name == server_name
        ]

    def get_all_resources(self) -> List[AggregatedResource]:
        """
        Get all aggregated resources.

        Returns:
            List of all aggregated resources
        """
        return list(self._aggregated_resources.values())

    def get_tool_conflicts(self) -> Dict[str, List[str]]:
        """
        Get detected tool name conflicts.

        Returns:
            Dictionary mapping tool names to conflicting server names
        """
        return dict(self._tool_conflicts)

    def get_resource_conflicts(self) -> Dict[str, List[str]]:
        """
        Get detected resource URI conflicts.

        Returns:
            Dictionary mapping resource URIs to conflicting server names
        """
        return dict(self._resource_conflicts)

    def get_aggregation_stats(self) -> Dict[str, int]:
        """
        Get aggregation statistics.

        Returns:
            Dictionary with aggregation statistics
        """
        tools_by_server = defaultdict(int)
        resources_by_server = defaultdict(int)

        for tool in self._aggregated_tools.values():
            tools_by_server[tool.server_name] += 1

        for resource in self._aggregated_resources.values():
            resources_by_server[resource.server_name] += 1

        return {
            "total_tools": len(self._aggregated_tools),
            "total_resources": len(self._aggregated_resources),
            "tool_conflicts": len(self._tool_conflicts),
            "resource_conflicts": len(self._resource_conflicts),
            "servers_with_tools": len(tools_by_server),
            "servers_with_resources": len(resources_by_server),
            "tools_by_server": dict(tools_by_server),
            "resources_by_server": dict(resources_by_server)
        }

    async def refresh_aggregation(self, servers: List[MCPServer]) -> None:
        """
        Refresh aggregation from updated server list.

        Args:
            servers: Updated list of servers
        """
        logger.info("Refreshing tool and resource aggregation")

        # Clear existing aggregations
        self._aggregated_tools.clear()
        self._aggregated_resources.clear()
        self._tool_conflicts.clear()
        self._resource_conflicts.clear()

        # Re-aggregate
        await self.aggregate_tools(servers)
        await self.aggregate_resources(servers)

        logger.info("Aggregation refresh completed")

    def validate_tool_name(self, tool_name: str) -> bool:
        """
        Validate if a tool name exists in aggregated tools.

        Args:
            tool_name: Tool name to validate

        Returns:
            True if tool exists, False otherwise
        """
        return self.find_tool_by_name(tool_name) is not None

    def validate_resource_uri(self, resource_uri: str) -> bool:
        """
        Validate if a resource URI exists in aggregated resources.

        Args:
            resource_uri: Resource URI to validate

        Returns:
            True if resource exists, False otherwise
        """
        return self.find_resource_by_uri(resource_uri) is not None

    def get_available_tool_names(self) -> List[str]:
        """
        Get list of all available tool names (prefixed).

        Returns:
            List of available tool names
        """
        return list(self._aggregated_tools.keys())

    def get_available_resource_uris(self) -> List[str]:
        """
        Get list of all available resource URIs (prefixed).

        Returns:
            List of available resource URIs
        """
        return list(self._aggregated_resources.keys())

    async def update_aggregation(self, servers: List[MCPServer]) -> None:
        """
        Update aggregation for all servers.
        
        Args:
            servers: List of servers to aggregate
        """
        await self.aggregate_tools(servers)
        await self.aggregate_resources(servers)
