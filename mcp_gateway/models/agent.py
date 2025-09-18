"""
Agent models for MCP Portal
Handles agent registration, authentication, and MCP stack assignments
"""

from datetime import datetime
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field
from enum import Enum
import uuid

from .mcp import AggregatedTool


class AgentType(str, Enum):
    """Supported agent types"""
    CLAUDE_CODE = "claude-code"
    CURSOR = "cursor"
    KIRO = "kiro"
    CUSTOM = "custom"


class AgentStatus(str, Enum):
    """Agent connection status"""
    ONLINE = "online"
    OFFLINE = "offline"
    ERROR = "error"


class ServerType(str, Enum):
    """MCP Server source types"""
    DISCOVERED = "discovered"  # Auto-discovered from IDE configs
    CUSTOM = "custom"         # User-added custom servers
    MARKETPLACE = "marketplace"  # From Smithery.ai marketplace


class HealthStatus(str, Enum):
    """Server health status"""
    HEALTHY = "healthy"
    ERROR = "error"
    OFFLINE = "offline"
    UNKNOWN = "unknown"


# Base models
class AgentBase(BaseModel):
    """Base agent model"""
    name: str = Field(..., description="Human-readable agent name")
    type: AgentType = Field(..., description="Agent type")
    settings: Dict[str, Any] = Field(default_factory=dict, description="Agent-specific configuration")


class AgentTokenBase(BaseModel):
    """Base agent token model"""
    name: Optional[str] = Field(None, description="Optional token name")
    agent_type: Optional[AgentType] = Field(None, description="Intended agent type")
    expires_at: Optional[datetime] = Field(None, description="Token expiration time")


class MCPServerBase(BaseModel):
    """Base MCP server model"""
    name: str = Field(..., description="Server name")
    description: Optional[str] = Field(None, description="Server description")
    server_type: ServerType = Field(default=ServerType.DISCOVERED, description="Server source type")
    connection_config: Dict[str, Any] = Field(..., description="Server connection configuration")
    tools_config: Dict[str, Any] = Field(default_factory=dict, description="Tool configurations")
    icon_url: Optional[str] = Field(None, description="Server icon URL")
    documentation_url: Optional[str] = Field(None, description="Server documentation URL")


class MCPStackBase(BaseModel):
    """Base MCP stack model"""
    name: str = Field(..., description="Stack name")
    description: Optional[str] = Field(None, description="Stack description")
    template_name: Optional[str] = Field(None, description="Template this stack was created from")
    server_configs: List[Dict[str, Any]] = Field(default_factory=list, description="Server configurations")
    is_active: bool = Field(default=True, description="Whether stack is active")


# Database models (with IDs and timestamps)
class Agent(AgentBase):
    """Complete agent model"""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Agent unique identifier")
    user_id: uuid.UUID = Field(..., description="Owner user ID")
    token_hash: str = Field(..., description="Hashed authentication token")
    last_connected: Optional[datetime] = Field(None, description="Last connection timestamp")
    status: AgentStatus = Field(default=AgentStatus.OFFLINE, description="Current status")
    assigned_stack_id: Optional[uuid.UUID] = Field(None, description="Assigned MCP stack ID")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update timestamp")

    class Config:
        from_attributes = True


class AgentToken(AgentTokenBase):
    """Complete agent token model"""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Token unique identifier")
    user_id: uuid.UUID = Field(..., description="Owner user ID")
    token_hash: str = Field(..., description="Hashed token value")
    last_used: Optional[datetime] = Field(None, description="Last usage timestamp")
    is_active: bool = Field(default=True, description="Whether token is active")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")

    class Config:
        from_attributes = True


class MCPServer(MCPServerBase):
    """Complete MCP server model"""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Server unique identifier")
    user_id: uuid.UUID = Field(..., description="Owner user ID")
    health_status: HealthStatus = Field(default=HealthStatus.UNKNOWN, description="Current health status")
    last_health_check: Optional[datetime] = Field(None, description="Last health check timestamp")
    enabled: bool = Field(default=True, description="Whether the server is enabled in the gateway")
    source: Optional[str] = Field(None, description="Origin information for the server")
    last_ping: Optional[datetime] = Field(None, description="Most recent successful ping time")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update timestamp")

    class Config:
        from_attributes = True


class MCPStack(MCPStackBase):
    """Complete MCP stack model"""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Stack unique identifier")
    user_id: uuid.UUID = Field(..., description="Owner user ID")
    agent_id: Optional[uuid.UUID] = Field(None, description="Assigned agent ID")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update timestamp")

    class Config:
        from_attributes = True


class StackServerAssignment(BaseModel):
    """Stack-Server assignment model"""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Assignment unique identifier")
    stack_id: uuid.UUID = Field(..., description="Stack ID")
    server_id: uuid.UUID = Field(..., description="Server ID")
    server_config: Dict[str, Any] = Field(default_factory=dict, description="Stack-specific server config")
    tool_permissions: Dict[str, bool] = Field(default_factory=dict, description="Per-tool permissions")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")

    class Config:
        from_attributes = True


class AgentAccessLog(BaseModel):
    """Agent access log model"""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Log unique identifier")
    agent_id: Optional[uuid.UUID] = Field(None, description="Agent ID")
    tool_name: str = Field(..., description="Tool name accessed")
    server_name: str = Field(..., description="Server name")
    success: bool = Field(..., description="Whether access was successful")
    error_message: Optional[str] = Field(None, description="Error message if failed")
    request_data: Optional[Dict[str, Any]] = Field(None, description="Sanitized request data")
    response_size: Optional[int] = Field(None, description="Response size in bytes")
    duration_ms: Optional[int] = Field(None, description="Request duration in milliseconds")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")

    class Config:
        from_attributes = True


class DashboardLayout(BaseModel):
    """Dashboard layout model for saving React Flow graphs"""
    id: uuid.UUID = Field(default_factory=uuid.uuid4, description="Layout unique identifier")
    user_id: uuid.UUID = Field(..., description="Owner user ID")
    name: str = Field(default="default", description="Layout name")
    layout_data: Dict[str, Any] = Field(..., description="React Flow nodes and edges")
    is_default: bool = Field(default=False, description="Whether this is the default layout")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update timestamp")

    class Config:
        from_attributes = True


# Request/Response models
class AgentConnectionRequest(BaseModel):
    """Agent connection request"""
    token: str = Field(..., description="Agent authentication token")
    agent_name: Optional[str] = Field(None, description="Optional agent name")
    agent_type: Optional[AgentType] = Field(None, description="Agent type")


class AgentConnectionResponse(BaseModel):
    """Agent connection response"""
    agent_id: uuid.UUID = Field(..., description="Agent ID")
    name: str = Field(..., description="Agent name")
    type: AgentType = Field(..., description="Agent type")
    assigned_stack: Optional['MCPStackWithServers'] = Field(None, description="Assigned MCP stack")
    websocket_url: str = Field(..., description="WebSocket URL for real-time updates")


class CreateAgentTokenRequest(BaseModel):
    """Create agent token request"""
    name: Optional[str] = Field(None, description="Optional token name")
    agent_type: Optional[AgentType] = Field(None, description="Intended agent type")
    expires_in_days: Optional[int] = Field(None, description="Token expiration in days")


class CreateAgentTokenResponse(BaseModel):
    """Create agent token response"""
    token_id: uuid.UUID = Field(..., description="Token ID")
    token: str = Field(..., description="Raw token (only shown once)")
    name: Optional[str] = Field(None, description="Token name")
    agent_type: Optional[AgentType] = Field(None, description="Intended agent type")
    expires_at: Optional[datetime] = Field(None, description="Expiration timestamp")


class MCPServerWithHealth(MCPServer):
    """MCP server with health information"""
    tools_count: int = Field(..., description="Number of available tools")
    last_error: Optional[str] = Field(None, description="Last error message")
    tool_permissions: Dict[str, bool] = Field(
        default_factory=dict,
        description="Stack-specific tool enablement toggles"
    )
    discovered_tools: List[AggregatedTool] = Field(
        default_factory=list,
        description="Tools discovered via gateway aggregation"
    )
    is_managed: bool = Field(default=True, description="Whether this server is persisted in the database")


class MCPStackWithServers(MCPStack):
    """MCP stack with associated servers"""
    servers: List[MCPServerWithHealth] = Field(default_factory=list, description="Assigned servers")
    tools_count: int = Field(default=0, description="Total tools count across all servers")


class AgentWithStack(Agent):
    """Agent with assigned stack information"""
    assigned_stack: Optional[MCPStackWithServers] = Field(None, description="Assigned MCP stack")
    tools_count: int = Field(default=0, description="Total available tools")
    last_access: Optional[datetime] = Field(None, description="Last tool access time")


class CreateStackRequest(BaseModel):
    """Create MCP stack request"""
    name: str = Field(..., description="Stack name")
    description: Optional[str] = Field(None, description="Stack description")
    template_name: Optional[str] = Field(None, description="Template to use")
    server_ids: List[uuid.UUID] = Field(default_factory=list, description="Initial server IDs")


class CreateStackWithNamesRequest(BaseModel):
    """Create MCP stack request using server names (supports discovered servers)"""
    name: str = Field(..., description="Stack name")
    description: Optional[str] = Field(None, description="Stack description")
    template_name: Optional[str] = Field(None, description="Template to use")
    server_names: List[str] = Field(default_factory=list, description="Server names (discovered or database servers)")


class UpdateStackRequest(BaseModel):
    """Update MCP stack request"""
    name: Optional[str] = Field(None, description="New stack name")
    description: Optional[str] = Field(None, description="New stack description")
    is_active: Optional[bool] = Field(None, description="Whether stack is active")


class AssignStackServersRequest(BaseModel):
    """Assign servers to stack request"""
    server_ids: List[uuid.UUID] = Field(..., description="Server IDs to assign")
    tool_permissions: Optional[Dict[str, Dict[str, bool]]] = Field(None, description="Per-server tool permissions")


class AssignStackServersByNamesRequest(BaseModel):
    """Assign servers to stack by names request (supports discovered servers)"""
    server_names: List[str] = Field(..., description="Server names to assign")
    tool_permissions: Optional[Dict[str, Dict[str, bool]]] = Field(None, description="Per-server tool permissions")


class CreateServerRequest(BaseModel):
    """Create MCP server request"""
    name: str = Field(..., description="Server name")
    description: Optional[str] = Field(None, description="Server description")
    server_type: ServerType = Field(..., description="Server type")
    connection_config: Dict[str, Any] = Field(..., description="Connection configuration")
    tools_config: Optional[Dict[str, Any]] = Field(None, description="Tools configuration")
    icon_url: Optional[str] = Field(None, description="Icon URL")
    documentation_url: Optional[str] = Field(None, description="Documentation URL")


class UpdateServerRequest(BaseModel):
    """Update MCP server request"""
    name: Optional[str] = Field(None, description="New server name")
    description: Optional[str] = Field(None, description="New server description")
    connection_config: Optional[Dict[str, Any]] = Field(None, description="New connection config")
    tools_config: Optional[Dict[str, Any]] = Field(None, description="New tools config")
    icon_url: Optional[str] = Field(None, description="New icon URL")
    documentation_url: Optional[str] = Field(None, description="New documentation URL")


class GraphLayoutRequest(BaseModel):
    """Save graph layout request"""
    name: str = Field(default="default", description="Layout name")
    layout_data: Dict[str, Any] = Field(..., description="React Flow nodes and edges")
    is_default: bool = Field(default=False, description="Set as default layout")


class MCPAccessRequest(BaseModel):
    """MCP tool access request from agent"""
    tool_name: str = Field(..., description="Tool name to execute")
    server_name: str = Field(..., description="Target server name")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Tool parameters")


class MCPAccessResponse(BaseModel):
    """MCP tool access response"""
    success: bool = Field(..., description="Whether request succeeded")
    result: Optional[Any] = Field(None, description="Tool execution result")
    error: Optional[str] = Field(None, description="Error message if failed")
    duration_ms: int = Field(..., description="Execution duration")


# Stack templates
class StackTemplate(BaseModel):
    """MCP stack template"""
    name: str = Field(..., description="Template name")
    display_name: str = Field(..., description="Human-readable template name")
    description: str = Field(..., description="Template description")
    icon: str = Field(..., description="Template icon")
    recommended_servers: List[str] = Field(..., description="Recommended server names")
    default_config: Dict[str, Any] = Field(default_factory=dict, description="Default configuration")


# Pre-defined stack templates
STACK_TEMPLATES = [
    StackTemplate(
        name="development",
        display_name="Development Stack",
        description="Essential tools for software development",
        icon="🛠️",
        recommended_servers=["github", "filesystem", "git", "docker", "postgresql"],
        default_config={"auto_commit": False, "test_mode": True}
    ),
    StackTemplate(
        name="data-analysis",
        display_name="Data Analysis Stack",
        description="Tools for data science and analytics",
        icon="📊",
        recommended_servers=["filesystem", "postgresql", "sqlite", "pandas", "numpy"],
        default_config={"cache_results": True, "plot_inline": True}
    ),
    StackTemplate(
        name="web-scraping",
        display_name="Web Scraping Stack",
        description="Tools for web scraping and automation",
        icon="🕷️",
        recommended_servers=["brave-search", "puppeteer", "filesystem", "sqlite"],
        default_config={"respect_robots": True, "rate_limit": 1000}
    ),
    StackTemplate(
        name="content-creation",
        display_name="Content Creation Stack",
        description="Tools for writing and media creation",
        icon="✍️",
        recommended_servers=["filesystem", "google-drive", "brave-search", "image-generation"],
        default_config={"auto_save": True, "backup_enabled": True}
    )
]
