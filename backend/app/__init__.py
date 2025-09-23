"""
LedeWire AI Research Tool - Application Factory
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from utils.rate_limit import get_user_or_ip_key
from utils.static import NoCacheStaticFiles
from app.api.routes import auth, pricing, purchase, chat, sources, health


def create_app() -> FastAPI:
    """Create and configure FastAPI application"""
    
    app = FastAPI(
        title="LedeWire AI Research Tool",
        description="AI-powered research tool with tiered services and dynamic pricing",
        version="1.0.0"
    )
    
    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Rate limiting
    limiter = Limiter(key_func=get_user_or_ip_key)
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
    app.include_router(pricing.router, prefix="/api", tags=["pricing"])
    app.include_router(purchase.router, prefix="/api/purchase", tags=["purchase"])
    app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
    app.include_router(sources.router, prefix="/api/sources", tags=["sources"])
    
    return app