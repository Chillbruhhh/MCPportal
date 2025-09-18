"""
MCP Portal Main Entry Point.

This module serves as the main entry point for the MCP Portal application,
handling startup, shutdown, and signal handling.
"""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI

from .api.server_management import create_app
from .config.settings import Settings
from .core.gateway import MCPGateway
from .utils.logging import setup_logging

logger = logging.getLogger(__name__)


async def create_application() -> FastAPI:
    """Create and configure the FastAPI application."""
    # Load settings
    settings = Settings()
    
    # Setup logging with default values for missing attributes
    setup_logging(
        log_level=settings.log_level,
        log_file="logs/mcp_gateway.log"  # Default log file
    )
    
    # Create gateway
    gateway = MCPGateway(settings)
    
    # Create FastAPI app
    app = create_app(gateway, settings)
    
    return app


async def run_server():
    """Run the MCP Gateway server."""
    try:
        app = await create_application()
        
        # Find available port starting from configured settings
        from .config.settings import Settings
        settings = Settings()
        port = settings.gateway_port
        max_attempts = 10
        
        for attempt in range(max_attempts):
            try:
                # Test if port is available
                import socket
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                result = sock.connect_ex(('127.0.0.1', port))
                sock.close()
                
                if result != 0:  # Port is available
                    break
                else:
                    logger.info(f"Port {port} is in use, trying {port + 1}")
                    port += 1
                    
            except Exception as e:
                logger.warning(f"Error testing port {port}: {e}")
                port += 1
        
        if port > settings.gateway_port + max_attempts:
            raise RuntimeError(f"Could not find available port after {max_attempts} attempts")
        
        logger.info(f"Starting MCP Gateway on 0.0.0.0:{port}")
        
        config = uvicorn.Config(
            app=app,
            host="0.0.0.0",
            port=port,
            log_level="info",
            access_log=True,
            server_header=False,
            date_header=False
        )
        
        server = uvicorn.Server(config)
        await server.serve()
        
    except Exception as e:
        logger.error(f"Failed to start MCP Gateway: {e}")
        raise


def main():
    """Main entry point for the MCP Gateway."""
    try:
        # Create application
        # app = asyncio.run(create_application()) # This line is removed as per the new_code
        
        # Find free port
        # port = find_free_port(8020) # This line is removed as per the new_code
        # if port != 8020: # This line is removed as per the new_code
        #     logger.info(f"Port 8020 is busy, using port {port} instead") # This line is removed as per the new_code
        
        # Run server
        asyncio.run(run_server()) # This line is updated as per the new_code
        
    except KeyboardInterrupt:
        logger.info("Shutting down MCP Gateway...")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Failed to start MCP Gateway: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
