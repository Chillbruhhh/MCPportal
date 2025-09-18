"""
Tests for API Routes.

This module tests the REST API endpoints of the MCP Gateway.
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch
from fastapi.testclient import TestClient

from mcp_gateway.main import app
from mcp_gateway.api.dependencies import set_gateway
from mcp_gateway.models.mcp import MCPServer, MCPServerStatus, AggregatedTool, AggregatedResource
from mcp_gateway.models.gateway import GatewayStatus, HealthCheckResult


class TestAPIRoutes:
    """Test cases for API routes."""
    
    @pytest.fixture
    def mock_gateway(self):
        """Create mock gateway for testing."""
        gateway = AsyncMock()
        
        # Mock status
        gateway.get_status.return_value = GatewayStatus(
            total_servers=2,
            active_servers=1,
            failed_servers=1,
            total_tools=3,
            total_resources=2,
            uptime="1h 30m"
        )
        
        # Mock health results
        gateway.get_health_results.return_value = [
            HealthCheckResult(
                server_name="server1",
                healthy=True,
                response_time=0.1,
                error=None
            ),
            HealthCheckResult(
                server_name="server2",
                healthy=False,
                response_time=0.0,
                error="Connection timeout"
            )
        ]
        
        # Mock servers
        gateway.get_servers.return_value = [
            MCPServer(
                name="server1",
                url="http://localhost:3000",
                status=MCPServerStatus.CONNECTED
            ),
            MCPServer(
                name="server2",
                url="http://localhost:3001",
                status=MCPServerStatus.FAILED
            )
        ]

        # Aggregated tool metadata per server for discovery view
        server1_tools = [
            AggregatedTool(
                original_name="read_file",
                prefixed_name="server1_read_file",
                server_name="server1",
                description="Read file contents",
                parameters={}
            ),
            AggregatedTool(
                original_name="write_file",
                prefixed_name="server1_write_file",
                server_name="server1",
                description="Write file contents",
                parameters={}
            )
        ]

        gateway.aggregator = Mock()
        gateway._server_configs = {"server1": Mock()}

        def _tools_for_server(name: str):
            return server1_tools if name == "server1" else []

        gateway.aggregator.get_tools_for_server.side_effect = _tools_for_server
        gateway.aggregator.get_tools_by_server.side_effect = _tools_for_server
        
        # Mock tools
        gateway.get_aggregated_tools.return_value = [
            AggregatedTool(
                original_name="read_file",
                prefixed_name="server1.read_file",
                server_name="server1",
                description="Read file contents",
                parameters={}
            ),
            AggregatedTool(
                original_name="write_file",
                prefixed_name="server1.write_file",
                server_name="server1",
                description="Write file contents",
                parameters={}
            )
        ]
        
        # Mock resources
        gateway.get_aggregated_resources.return_value = [
            AggregatedResource(
                original_uri="file:///test.txt",
                prefixed_uri="server1://file:///test.txt",
                server_name="server1",
                name="test.txt",
                description="Test file",
                mime_type="text/plain"
            )
        ]
        
        return gateway
    
    @pytest.fixture
    def client(self, mock_gateway):
        """Create test client with mock gateway."""
        set_gateway(mock_gateway)
        # Create minimal test app without middleware that causes issues
        from fastapi import FastAPI
        from mcp_gateway.api.routes import router as api_router
        
        test_app = FastAPI(title="Test MCP Gateway")
        test_app.include_router(api_router, prefix="/api/v1")
        
        # Add basic routes without middleware
        @test_app.get("/")
        async def root():
            return {"message": "MCP Gateway Test"}
            
        @test_app.get("/ui")
        async def ui():
            return {"message": "UI Test"}
            
        @test_app.get("/health")
        async def health():
            return {"status": "healthy"}
            
        @test_app.get("/favicon.ico")
        async def favicon():
            return {"message": "favicon"}
        
        return TestClient(test_app)
    
    def test_health_endpoint(self, client):
        """Test health endpoint."""
        response = client.get("/api/v1/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ["healthy", "degraded"]
        assert "gateway" in data
        assert "servers" in data
    
    def test_list_servers(self, client):
        """Test listing servers."""
        response = client.get("/api/v1/servers")
        
        assert response.status_code == 200
        data = response.json()
        assert "servers" in data
        assert "total" in data
        assert "active" in data
        assert "failed" in data
        assert data["total"] == 2
        assert data["active"] == 1
        assert data["failed"] == 1
        # Ensure discovery metadata is present for dashboard UI
        server_names = {server["name"] for server in data["servers"]}
        assert {"server1", "server2"} == server_names
        first_server = next(server for server in data["servers"] if server["name"] == "server1")
        assert first_server["health_status"] == "healthy"
        assert first_server["tools_count"] == 2
        assert len(first_server["discovered_tools"]) == 2
        assert first_server["is_managed"] is True
        second_server = next(server for server in data["servers"] if server["name"] == "server2")
        assert second_server["tools_count"] == 0
        assert second_server["is_managed"] is False
    
    def test_get_server_details(self, client, mock_gateway):
        """Test getting server details."""
        # Mock server details
        mock_gateway.get_server_by_name.return_value = MCPServer(
            name="server1",
            url="http://localhost:3000",
            status=MCPServerStatus.CONNECTED
        )
        
        mock_gateway.aggregator.get_tools_by_server.return_value = [
            AggregatedTool(
                original_name="read_file",
                prefixed_name="server1.read_file",
                server_name="server1",
                description="Read file contents",
                parameters={}
            )
        ]
        
        mock_gateway.aggregator.get_resources_by_server.return_value = []
        
        response = client.get("/api/v1/servers/server1")
        
        assert response.status_code == 200
        data = response.json()
        assert "server" in data
        assert "tools" in data
        assert "resources" in data
        assert data["server"]["name"] == "server1"
    
    def test_get_server_details_not_found(self, client, mock_gateway):
        """Test getting details for non-existent server."""
        mock_gateway.get_server_by_name.return_value = None
        
        response = client.get("/api/v1/servers/non-existent")
        
        assert response.status_code == 404
    
    def test_list_tools(self, client):
        """Test listing tools."""
        response = client.get("/api/v1/tools")
        
        assert response.status_code == 200
        data = response.json()
        assert "tools" in data
        assert "total" in data
        assert "by_server" in data
        assert data["total"] == 2
    
    def test_list_resources(self, client):
        """Test listing resources."""
        response = client.get("/api/v1/resources")
        
        assert response.status_code == 200
        data = response.json()
        assert "resources" in data
        assert "total" in data
        assert "by_server" in data
        assert data["total"] == 1
    
    def test_execute_tool_success(self, client, mock_gateway):
        """Test successful tool execution."""
        from mcp_gateway.models.gateway import ToolExecutionResponse
        
        mock_gateway.execute_tool.return_value = ToolExecutionResponse(
            tool_name="server1.read_file",
            server_name="server1",
            success=True,
            result={"content": "Test file content"},
            execution_time=0.1
        )
        
        response = client.post(
            "/api/v1/tools/execute",
            json={
                "tool_name": "server1.read_file",
                "parameters": {"path": "/test.txt"}
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["tool_name"] == "server1.read_file"
        assert data["server_name"] == "server1"
    
    def test_execute_tool_failure(self, client, mock_gateway):
        """Test tool execution failure."""
        from mcp_gateway.models.gateway import ToolExecutionResponse
        
        mock_gateway.execute_tool.return_value = ToolExecutionResponse(
            tool_name="server1.read_file",
            server_name="server1",
            success=False,
            error="Tool execution failed",
            execution_time=0.0
        )
        
        response = client.post(
            "/api/v1/tools/execute",
            json={
                "tool_name": "server1.read_file",
                "parameters": {"path": "/test.txt"}
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is False
        assert "failed" in data["error"]
    
    def test_access_resource_success(self, client, mock_gateway):
        """Test successful resource access."""
        from mcp_gateway.models.gateway import ResourceResponse
        
        mock_gateway.access_resource.return_value = ResourceResponse(
            resource_uri="server1://file:///test.txt",
            server_name="server1",
            success=True,
            content="Test file content",
            mime_type="text/plain"
        )
        
        response = client.post(
            "/api/v1/resources/access",
            json={
                "resource_uri": "server1://file:///test.txt"
            }
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["content"] == "Test file content"
    
    def test_get_metrics(self, client, mock_gateway):
        """Test getting metrics."""
        from mcp_gateway.models.gateway import GatewayMetrics
        
        mock_gateway.get_metrics.return_value = GatewayMetrics(
            total_requests=100,
            successful_requests=95,
            failed_requests=5,
            average_response_time=0.2,
            active_connections=3
        )
        
        response = client.get("/api/v1/metrics")
        
        assert response.status_code == 200
        data = response.json()
        assert "metrics" in data
        assert data["metrics"]["total_requests"] == 100
    
    def test_reconnect_server_success(self, client, mock_gateway):
        """Test successful server reconnection."""
        mock_gateway.get_server_by_name.return_value = MCPServer(
            name="server1",
            url="http://localhost:3000",
            status=MCPServerStatus.FAILED
        )
        
        mock_gateway.discovery.reconnect_server.return_value = True
        
        response = client.post("/api/v1/servers/server1/reconnect")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["server_name"] == "server1"
        assert data["action"] == "reconnect"
    
    def test_reconnect_server_not_found(self, client, mock_gateway):
        """Test reconnecting non-existent server."""
        mock_gateway.get_server_by_name.return_value = None
        
        response = client.post("/api/v1/servers/non-existent/reconnect")
        
        assert response.status_code == 404
    
    def test_get_status(self, client, mock_gateway):
        """Test getting comprehensive status."""
        mock_gateway.aggregator.get_aggregation_stats.return_value = {
            "total_tools": 3,
            "total_resources": 2,
            "tool_conflicts": 0,
            "resource_conflicts": 0
        }
        
        mock_gateway.aggregator.get_tool_conflicts.return_value = {}
        mock_gateway.aggregator.get_resource_conflicts.return_value = {}
        
        response = client.get("/api/v1/status")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "gateway" in data["data"]
        assert "aggregation" in data["data"]
        assert "conflicts" in data["data"]
    
    def test_search_tools(self, client):
        """Test tool search."""
        response = client.get("/api/v1/tools/search?q=read&server=server1")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert isinstance(data["data"], list)
    
    def test_search_resources(self, client):
        """Test resource search."""
        response = client.get("/api/v1/resources/search?q=test&server=server1")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert isinstance(data["data"], list)
    
    def test_authentication_required(self, mock_gateway):
        """Test API authentication when API key is set."""
        # Create settings with API key
        with patch('mcp_gateway.config.settings.get_settings') as mock_get_settings:
            mock_settings = Mock()
            mock_settings.api_key = "test-api-key"
            mock_get_settings.return_value = mock_settings
            
            set_gateway(mock_gateway)
            client = TestClient(app)
            
            # Request without API key should fail
            response = client.get("/api/v1/servers")
            assert response.status_code == 401
            
            # Request with correct API key should succeed
            response = client.get(
                "/api/v1/servers",
                headers={"Authorization": "Bearer test-api-key"}
            )
            assert response.status_code == 200
    
    def test_rate_limiting(self, client, mock_gateway):
        """Test rate limiting functionality."""
        with patch('mcp_gateway.api.dependencies.RATE_LIMIT_REQUESTS', 2):
            # First two requests should succeed
            response1 = client.get("/api/v1/servers")
            assert response1.status_code == 200
            
            response2 = client.get("/api/v1/servers")
            assert response2.status_code == 200
            
            # Third request should be rate limited
            response3 = client.get("/api/v1/servers")
            assert response3.status_code == 429
    
    def test_error_handling(self, client, mock_gateway):
        """Test API error handling."""
        # Mock an exception in the gateway
        mock_gateway.get_servers.side_effect = Exception("Test error")
        
        response = client.get("/api/v1/servers")
        
        assert response.status_code == 500
        data = response.json()
        assert "error" in data
    
    @pytest.mark.asyncio
    async def test_sse_endpoint(self, client):
        """Test SSE endpoint availability."""
        # Test that SSE endpoint exists and returns correct content type
        with client as test_client:
            # We can't easily test streaming in TestClient, but we can check the endpoint exists
            response = test_client.get("/api/v1/events", headers={"Accept": "text/event-stream"})
            # The endpoint should exist (may return error due to test setup, but not 404)
            assert response.status_code != 404
    
    def test_main_ui_endpoint(self, client):
        """Test main UI endpoint."""
        response = client.get("/")
        
        # Should return HTML (either the actual UI or fallback)
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")
    
    def test_ui_endpoint(self, client):
        """Test UI endpoint."""
        response = client.get("/ui")
        
        # Should return HTML
        assert response.status_code == 200
        assert "text/html" in response.headers.get("content-type", "")
    
    def test_simple_health_endpoint(self, client, mock_gateway):
        """Test simple health endpoint."""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
    
    def test_favicon_endpoint(self, client):
        """Test favicon endpoint."""
        response = client.get("/favicon.ico")
        
        assert response.status_code == 200
        assert "image/svg+xml" in response.headers.get("content-type", "")
