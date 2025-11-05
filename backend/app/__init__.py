"""
LedeWire AI Research Tool - Application Factory
"""

import os
import logging
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from config import config
from utils.rate_limit import limiter
from utils.static import NoCacheStaticFiles
from middleware.error_handler import ErrorHandlerMiddleware, BudgetExceededError
from app.api.routes import auth, research, purchase, chat, sources, health, wallet, projects


# Configure logging
def setup_logging():
    """Setup structured logging for production"""
    log_level = getattr(logging, config.LOG_LEVEL.upper(), logging.INFO)
    
    # Clear any existing handlers
    logging.root.handlers = []
    
    # Create formatter
    if config.STRUCTURED_LOGGING:
        # JSON-like structured logging for production
        formatter = logging.Formatter(
            '{"time":"%(asctime)s", "level":"%(levelname)s", "name":"%(name)s", "message":"%(message)s"}'
        )
    else:
        # Human-readable logging for development
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    
    # Configure root logger
    logging.root.setLevel(log_level)
    logging.root.addHandler(console_handler)
    
    # Set specific levels for noisy libraries
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


def create_app() -> FastAPI:
    """Create and configure FastAPI application"""
    
    # Setup logging first
    setup_logging()
    logger = logging.getLogger(__name__)
    
    # Validate configuration
    config_errors = config.validate()
    if config_errors:
        logger.error(f"❌ Configuration errors: {', '.join(config_errors)}")
        if config.IS_PRODUCTION:
            raise ValueError(f"Production configuration invalid: {', '.join(config_errors)}")
        else:
            logger.warning("⚠️  Configuration warnings (development mode - proceeding anyway)")
    
    # Log configuration summary
    logger.info(f"🚀 Starting application with config: {config.get_summary()}")
    
    app = FastAPI(
        title="LedeWire AI Research Tool",
        description="AI-powered research tool with tiered services and dynamic pricing",
        version="1.0.0"
    )
    
    # Add error handling middleware (first, to catch all errors)
    app.add_middleware(ErrorHandlerMiddleware)
    
    # CORS middleware - production-ready configuration
    if config.ALLOWED_ORIGINS:
        allowed_origins = config.ALLOWED_ORIGINS
        logger.info(f"✅ CORS configured with {len(allowed_origins)} allowed origins")
    else:
        allowed_origins = ["*"]
        logger.warning("⚠️  WARNING: ALLOWED_ORIGINS not set - using permissive CORS policy!")
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,  # Set to False when using Bearer tokens only
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )
    
    # Rate limiting with tiered limits
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    
    # Custom exception handlers
    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request, exc):
        return JSONResponse(
            status_code=429,
            content={"detail": f"Rate limit exceeded: {exc.detail}"}
        )
    
    @app.exception_handler(BudgetExceededError)
    async def budget_exceeded_handler(request, exc):
        return JSONResponse(
            status_code=429,
            content={
                "detail": str(exc),
                "type": "budget_exceeded",
                "retry_after": "24h"
            }
        )
    
    # Static files with no-cache - handle both dev and deployment paths
    possible_static_dirs = ["static", "backend/static", "./static"]
    static_dir = None
    for dir_path in possible_static_dirs:
        if os.path.exists(dir_path):
            static_dir = dir_path
            break
    
    if static_dir:
        app.mount("/static", NoCacheStaticFiles(directory=static_dir), name="static")
    
    # Include API routes
    app.include_router(health.router, tags=["health"])  # Root level routes like /
    app.include_router(auth.router, prefix="/api/auth", tags=["authentication"])
    app.include_router(wallet.router, prefix="/api/wallet", tags=["wallet"])
    app.include_router(research.router, prefix="/api/research", tags=["research"])
    app.include_router(purchase.router, prefix="/api/purchase", tags=["purchase"])  # Re-enabled for purchase flow
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(sources.router, prefix="/api/sources", tags=["sources"])
    app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
    
    return app