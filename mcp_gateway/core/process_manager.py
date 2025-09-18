"""
MCP Process Manager.

This module handles starting, managing, and communicating with
command-line MCP servers via stdin/stdout using the unified transport.
"""

import asyncio
import json
import logging
import os
import platform
import subprocess
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from ..config.settings import MCPServerConfig
from ..models.mcp import (
    MCPRequest,
    MCPResponse,
    MCPServer,
    MCPServerStatus,
    MCPTool,
    MCPResource,
)
from .unified_transport import create_transport, UnifiedTransportBase

logger = logging.getLogger(__name__)


class MCPProcess:
    """Represents a running MCP server process using unified transport."""
    
    def __init__(self, config: MCPServerConfig):
        self.config = config
        self.transport = create_transport(config)
        
    @property
    def server_info(self) -> Optional[Dict[str, Any]]:
        """Get server info from transport."""
        return self.transport.server_info
    
    @property
    def capabilities(self) -> List[str]:
        """Get capabilities from transport."""
        return list(self.transport.capabilities.keys())
    
    @property
    def tools(self) -> List[MCPTool]:
        """Get tools from transport."""
        return self.transport.tools
    
    @property
    def resources(self) -> List[MCPResource]:
        """Get resources from transport."""
        return self.transport.resources
    
    @property
    def initialized(self) -> bool:
        """Check if transport is initialized."""
        return self.transport.initialized
    
    @property
    def framework(self) -> str:
        """Get detected framework type."""
        return self.transport.framework.value
    
    @property
    def process(self) -> Optional[subprocess.Popen]:
        """Get the underlying process (stdio only)."""
        # Only stdio transport has a process
        if hasattr(self.transport, 'process'):
            return self.transport.process
        return None
        
    def generate_request_id(self) -> str:
        """Generate unique request ID."""
        return self.transport.generate_request_id()
    
    async def start_communication(self):
        """Start communication via unified transport (deprecated - use start())."""
        # This method is deprecated since transport.start() handles everything
        return self.transport.is_running()
    
    async def send_request(self, request: MCPRequest, timeout: float = 60.0) -> MCPResponse:
        """Send a request via unified transport."""
        return await self.transport.send_request(request, timeout)
    
    async def initialize(self) -> bool:
        """Initialize via unified transport."""
        # The transport handles initialization internally when started
        return self.transport.initialized
    
    async def list_tools(self) -> List[MCPTool]:
        """List available tools via unified transport."""
        return await self.transport.list_tools()
    
    async def list_resources(self) -> List[MCPResource]:
        """List available resources via unified transport."""
        return await self.transport.list_resources()
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool via unified transport."""
        return await self.transport.call_tool(tool_name, arguments)
    
    async def read_resource(self, uri: str) -> Dict[str, Any]:
        """Read a resource via unified transport."""
        return await self.transport.read_resource(uri)
    
    async def stop(self):
        """Stop via unified transport."""
        return await self.transport.stop()


class MCPProcessManager:
    """Manages MCP server processes."""
    
    def __init__(self):
        self.processes: Dict[str, MCPProcess] = {}
        self.cleanup_tasks: List[asyncio.Task] = []
    
    def _translate_command(self, command: str, args: List[str]) -> Tuple[str, List[str]]:
        """Translate Windows commands to Linux equivalents when running in Docker."""
        # Check if we're running in a Docker container
        is_docker = os.path.exists('/.dockerenv') or os.path.exists('/proc/1/cgroup')
        
        if not is_docker:
            return command, args
        
        # Translate common Windows commands
        if command == "cmd" and args and args[0] == "/c":
            # cmd /c npx ... -> npx ...
            if len(args) > 1:
                return args[1], args[2:]
            return "sh", ["-c", " ".join(args[1:])]
        
        elif command == "powershell" or command == "pwsh":
            # powershell -Command ... -> sh -c ...
            if "-Command" in args:
                cmd_idx = args.index("-Command")
                if cmd_idx + 1 < len(args):
                    return "sh", ["-c", args[cmd_idx + 1]]
            return "sh", ["-c", " ".join(args)]
        
        elif command.endswith(".exe"):
            # Remove .exe extension
            command = command[:-4]
        
        # For npx commands, ensure they work in Docker
        if command == "npx":
            # Add --yes flag to avoid prompts
            new_args = ["--yes"] + args
            return command, new_args
        
        # For Docker commands, update host references
        if command == "docker":
            # Replace host.docker.internal with host.docker.internal for Docker-in-Docker
            updated_args = []
            for arg in args:
                if isinstance(arg, str):
                    # Replace localhost with host.docker.internal for container communication
                    arg = arg.replace("localhost:", "host.docker.internal:")
                    # Keep host.docker.internal as is
                updated_args.append(arg)
            return command, updated_args
        
        return command, args
    
    async def start_server(self, config: MCPServerConfig) -> Optional[MCPServer]:
        """Start an MCP server process or establish SSE connection."""
        if config.name in self.processes:
            await self.stop_server(config.name)
        
        try:
            # Check if this is a URL-based (SSE) server or command-based (stdio) server
            if hasattr(config, 'url') and config.url:
                logger.info(f"Starting SSE connection to server {config.name} at {config.url}")
                return await self._start_sse_server(config)
            elif hasattr(config, 'command') and config.command:
                logger.info(f"Starting stdio process for server {config.name}")
                return await self._start_stdio_server(config)
            else:
                logger.warning(f"Server {config.name} has no command or URL specified")
                return None
            
        except Exception as e:
            logger.error(f"Error starting MCP server {config.name}: {e}")
            await self.stop_server(config.name)
            return None
    
    async def _start_stdio_server(self, config: MCPServerConfig) -> Optional[MCPServer]:
        """Start a stdio-based MCP server process."""
        try:
            logger.info(f"Starting stdio server {config.name} with command: {config.command} {config.args or []}")
            
            # Prepare environment
            env = os.environ.copy()
            if hasattr(config, 'env') and config.env:
                env.update(config.env)
            
            # Add Docker socket path for Docker-in-Docker
            is_docker = os.path.exists('/.dockerenv') or os.path.exists('/proc/1/cgroup')
            if is_docker:
                env['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
                logger.debug(f"Detected Docker environment for server {config.name}")
            
            # Translate command for Docker compatibility
            translated_command, translated_args = self._translate_command(
                config.command, config.args or []
            )
            command_parts = [translated_command] + translated_args
            
            logger.info(f"Translated command for {config.name}: {' '.join(command_parts)}")
            
            # On Windows (non-Docker), try to resolve command path
            if os.name == 'nt' and not (os.path.exists('/.dockerenv') or os.path.exists('/proc/1/cgroup')):
                # Try to find the command in PATH or use full path
                import shutil
                resolved_command = shutil.which(translated_command)
                if resolved_command:
                    command_parts[0] = resolved_command
                    logger.debug(f"Resolved command path for {config.name}: {resolved_command}")
                else:
                    # Log warning but try anyway
                    logger.warning(f"Command '{translated_command}' not found in PATH for server {config.name}")
            
            # Create MCP process wrapper with unified transport
            mcp_process = MCPProcess(config)
            self.processes[config.name] = mcp_process
            
            # Start transport with translated command parts and environment
            logger.debug(f"Starting transport for stdio server {config.name}")
            success = await mcp_process.transport.start_process(command_parts, env)
            
            if not success:
                logger.error(f"Failed to start stdio transport for server {config.name}")
                return None
            
            # Get capabilities from unified transport
            tools = mcp_process.tools
            resources = mcp_process.resources
            
            # Create MCPServer object
            server = MCPServer(
                name=config.name,
                url=f"stdio://{config.name}",  # Use stdio:// scheme for stdio servers
                status=MCPServerStatus.CONNECTED,
                capabilities=mcp_process.capabilities,
                tools=tools,
                resources=resources,
                last_ping=datetime.utcnow(),
                last_error=None,
                retry_count=0,
                max_retries=config.max_retries,
                source=f"{config.source} ({mcp_process.framework})" if config.source else mcp_process.framework,
                enabled=True
            )
            
            logger.info(f"Started {mcp_process.framework} stdio server: {config.name} with {len(tools)} tools")
            return server
            
        except Exception as e:
            logger.error(f"Error starting stdio server {config.name}: {e}")
            return None
    
    async def _start_sse_server(self, config: MCPServerConfig) -> Optional[MCPServer]:
        """Start an SSE-based MCP server connection."""
        try:
            # Create MCP process wrapper with unified transport (will create SSE transport)
            mcp_process = MCPProcess(config)
            self.processes[config.name] = mcp_process
            
            # Start SSE transport 
            success = await mcp_process.transport.start()
            
            if not success:
                logger.warning(f"Failed to connect to SSE server {config.name} at {config.url}")
                return None
            
            # Get capabilities from unified transport
            tools = mcp_process.tools
            resources = mcp_process.resources
            
            # Create MCPServer object
            server = MCPServer(
                name=config.name,
                url=config.url,  # Use the actual SSE URL
                status=MCPServerStatus.CONNECTED,
                capabilities=mcp_process.capabilities,
                tools=tools,
                resources=resources,
                last_ping=datetime.utcnow(),
                last_error=None,
                retry_count=0,
                max_retries=config.max_retries,
                source=f"{config.source} ({mcp_process.framework})" if config.source else f"SSE ({mcp_process.framework})",
                enabled=True
            )
            
            logger.info(f"Connected to {mcp_process.framework} SSE server: {config.name} at {config.url} with {len(tools)} tools")
            return server
            
        except Exception as e:
            logger.error(f"Error connecting to SSE server {config.name}: {e}")
            return None
    
    async def stop_server(self, server_name: str):
        """Stop an MCP server process."""
        if server_name in self.processes:
            mcp_process = self.processes.pop(server_name)
            await mcp_process.stop()
    
    async def stop_all_servers(self):
        """Stop all MCP server processes."""
        tasks = []
        for server_name in list(self.processes.keys()):
            tasks.append(self.stop_server(server_name))
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    def get_process(self, server_name: str) -> Optional[MCPProcess]:
        """Get an MCP process by name."""
        return self.processes.get(server_name)
    
    async def call_tool(self, server_name: str, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call a tool on a specific MCP server."""
        process = self.get_process(server_name)
        if not process:
            raise RuntimeError(f"MCP server {server_name} not found")
        
        return await process.call_tool(tool_name, arguments)
    
    async def read_resource(self, server_name: str, uri: str) -> Dict[str, Any]:
        """Read a resource from a specific MCP server."""
        process = self.get_process(server_name)
        if not process:
            raise RuntimeError(f"MCP server {server_name} not found")
        
        return await process.read_resource(uri)
    
    def is_running(self, server_name: str) -> bool:
        """Check if an MCP server is running."""
        process = self.get_process(server_name)
        return process is not None and process.transport.is_running()
    
    async def health_check(self, server_name: str) -> bool:
        """Perform health check on an MCP server."""
        process = self.get_process(server_name)
        if not process:
            return False
        
        return await process.transport.health_check() 
