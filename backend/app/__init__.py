"""
LedeWire AI Research Tool - Application Factory
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from utils.rate_limit import limiter
from utils.static import NoCacheStaticFiles
from app.api.routes import auth, research, purchase, chat, sources, health


def create_app() -> FastAPI:
    """Create and configure FastAPI application"""
    
    app = FastAPI(
        title="LedeWire AI Research Tool",
        description="AI-powered research tool with tiered services and dynamic pricing",
        version="1.0.0"
    )
    
    # CORS middleware - production-ready configuration
    allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
    if allowed_origins_env:
        # Production: Use explicit allowlist from environment variable
        allowed_origins = [origin.strip() for origin in allowed_origins_env.split(",")]
    else:
        # Development: Allow all origins, but warn about security implications
        allowed_origins = ["*"]
        print("⚠️  WARNING: ALLOWED_ORIGINS not set - using permissive CORS policy. Set ALLOWED_ORIGINS in production!")
    
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
    
    # Custom rate limit exception handler
    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(request, exc):
        return JSONResponse(
            status_code=429,
            content={"detail": f"Rate limit exceeded: {exc.detail}"}
        )
    
    # Static files with no-cache
    static_dir = "static"
    if os.path.exists(static_dir):
        app.mount("/static", NoCacheStaticFiles(directory=static_dir), name="static")
    
    # Include API routes
    app.include_router(health.router, tags=["health"])  # Root level routes like /
    app.include_router(auth.router, prefix="/api/auth", tags=["authentication"])
    app.include_router(research.router, prefix="/api/research", tags=["research"])
    app.include_router(purchase.router, prefix="/api/purchase", tags=["purchase"])  # Re-enabled for purchase flow
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(sources.router, prefix="/api/sources", tags=["sources"])
    
    return app