"""
Configuration settings for MCP Gateway using Pydantic Settings.

This module handles environment variable loading and validation
for the MCP Gateway application.
"""

import json
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, ConfigDict
from pydantic_settings import BaseSettings


class MCPServerConfig(BaseModel):
    """Configuration for an individual MCP server."""

    name: str = Field(..., description="Server identifier")
    
    # URL-based servers (SSE/HTTP)
    url: Optional[str] = Field(None, description="Server connection URL")
    transport: Optional[str] = Field(None, description="Transport type (sse, http)")
    sse_endpoint: Optional[str] = Field("/sse", description="SSE endpoint path (default: /sse)")
    messages_endpoint: Optional[str] = Field("/messages", description="Messages endpoint path (default: /messages)")
    
    # Command-based servers (stdio)
    command: Optional[str] = Field(None, description="Command to start the server")
    args: Optional[List[str]] = Field(None, description="Command arguments")
    env: Optional[Dict[str, str]] = Field(None, description="Environment variables")
    
    # Common settings
    enabled: bool = Field(True, description="Whether server is enabled")
    timeout: int = Field(30, description="Connection timeout in seconds")
    max_retries: int = Field(3, description="Maximum retry attempts")
    source: Optional[str] = Field(None, description="Source IDE/configuration file")
    
    def model_post_init(self, __context) -> None:
        """Validate that either URL or command is specified after model initialization."""
        if not self.url and not self.command:
            raise ValueError("Either 'url' or 'command' must be specified")
    
    @classmethod
    def from_dict(cls, data: dict):
        """Create MCPServerConfig from dictionary, handling legacy format."""
        # Handle legacy format where url is required
        if "url" in data and "command" not in data:
            return cls(**data)
        elif "command" in data:
            return cls(**data)
        else:
            # Legacy format - add default url if missing
            if "url" not in data:
                data["url"] = f"http://localhost:3000/{data.get('name', 'unknown')}"
            return cls(**data)


class Settings(BaseSettings):
    """Main application settings."""

    # Gateway Configuration
    gateway_host: str = Field("0.0.0.0", description="Gateway host address")
    gateway_port: int = Field(8025, description="Gateway port")
    serve_legacy_ui: bool = Field(False, description="Serve built-in legacy static HTML UI at / and /ui")
    log_level: str = Field("INFO", description="Logging level")

    # MCP Server Configuration
    mcp_servers: str = Field(
        '[{"name": "example", "url": "http://localhost:3003"}]',
        description="JSON array of MCP server configurations"
    )

    # Security Configuration
    api_key_header: str = Field("X-API-Key", description="API key header name")
    allowed_origins: str = Field(
        '["http://localhost:3000", "http://localhost:8080"]',
        description="JSON array of allowed CORS origins"
    )
    api_key: Optional[str] = Field(None, description="Optional API key for authentication")

    # Monitoring and Health Check Settings
    health_check_interval: int = Field(30, description="Health check interval in seconds")
    connection_timeout: int = Field(30, description="Connection timeout in seconds")
    max_retries: int = Field(3, description="Maximum retry attempts")

    # Optional Database Configuration
    database_url: Optional[str] = Field(None, description="Database URL for persistence")

    # Optional: Supabase / auth configuration (accepted but optional)
    supabase_url: Optional[str] = Field(None, description="Supabase REST URL (e.g., https://<project>.supabase.co or .../rest/v1)")
    supabase_anon_key: Optional[str] = Field(None, description="Supabase anon key")
    supabase_service_role_key: Optional[str] = Field(None, description="Supabase service role key")
    jwt_secret: Optional[str] = Field(None, description="JWT secret for auth token validation (optional)")
    agent_token_secret: Optional[str] = Field(None, description="Secret for generating agent tokens (optional)")

    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="allow"  # allow additional env vars without failing validation
    )

    @field_validator("mcp_servers")
    @classmethod
    def validate_mcp_servers(cls, v):
        """Validate and parse MCP servers JSON configuration."""
        try:
            servers_data = json.loads(v)
            if not isinstance(servers_data, list):
                raise ValueError("MCP servers must be a JSON array")

            # Validate each server configuration
            servers = []
            for server_data in servers_data:
                server = MCPServerConfig.from_dict(server_data)
                servers.append(server)

            return servers
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format for MCP servers: {e}")
        except Exception as e:
            raise ValueError(f"Error parsing MCP servers configuration: {e}")

    @field_validator("allowed_origins")
    @classmethod
    def validate_allowed_origins(cls, v):
        """Validate and parse allowed origins JSON configuration."""
        try:
            origins = json.loads(v)
            if not isinstance(origins, list):
                raise ValueError("Allowed origins must be a JSON array")
            return origins
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON format for allowed origins: {e}")

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, v):
        """Validate log level."""
        valid_levels = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
        if v.upper() not in valid_levels:
            raise ValueError(f"Log level must be one of: {valid_levels}")
        return v.upper()

    def get_mcp_servers(self) -> List[MCPServerConfig]:
        """Get parsed MCP server configurations."""
        return self.mcp_servers

    def get_mcp_servers_with_discovery(self) -> List[MCPServerConfig]:
        """
        Get MCP servers from configuration and discovery.

        Returns:
            List of MCP server configurations (config + discovered)
        """
        # Get configured servers
        configured_servers = self.get_mcp_servers()
        
        # Get discovered servers
        try:
            from ..core.settings_discovery import discover_mcp_settings
            discovered_servers = discover_mcp_settings()
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Failed to discover MCP settings: {e}")
            discovered_servers = []
        
        # Combine and deduplicate
        all_servers = {}
        
        # Add configured servers first (they take precedence)
        for server in configured_servers:
            all_servers[server.name] = server
        
        # Add discovered servers if not already configured
        for server in discovered_servers:
            if server.name not in all_servers:
                all_servers[server.name] = server
            else:
                import logging
                logger = logging.getLogger(__name__)
                logger.debug(f"Skipping discovered server '{server.name}' - already configured")
        
        result = list(all_servers.values())
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Total MCP servers (config + discovered): {len(result)}")
        return result

    def get_allowed_origins(self) -> List[str]:
        """Get parsed allowed origins."""
        return self.allowed_origins


# Global settings instance
settings = Settings()


def get_settings() -> Settings:
    """Get the global settings instance."""
    return settings
