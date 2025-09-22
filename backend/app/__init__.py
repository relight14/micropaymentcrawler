"""
LedeWire AI Research Tool - Application Factory
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

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
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    
    # Static files with no-cache
    app.mount("/static", NoCacheStaticFiles(directory="../frontend"), name="static")
    
    # Include API routes
    app.include_router(auth.router, prefix="/api/auth", tags=["authentication"])
    app.include_router(pricing.router, prefix="/api", tags=["pricing"])
    app.include_router(purchase.router, prefix="/api", tags=["purchase"])
    app.include_router(chat.router, prefix="/api", tags=["chat"])
    app.include_router(sources.router, prefix="/api", tags=["sources"])
    app.include_router(health.router, prefix="/api", tags=["health"])
    
    return app