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
from app.api.routes import auth, research, purchase, chat, sources, health


def create_app() -> FastAPI:
    """Create and configure FastAPI application"""
    
    app = FastAPI(
        title="LedeWire AI Research Tool",
        description="AI-powered research tool with tiered services and dynamic pricing",
        version="1.0.0"
    )
    
    # CORS middleware - production-ready configuration
    # In production, only allow requests from your actual frontend domain
    allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",") if os.getenv("ALLOWED_ORIGINS") else ["*"]
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,  # Set to False when using Bearer tokens only
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )
    
    # Rate limiting with tiered limits
    limiter = Limiter(key_func=get_user_or_ip_key)
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    
    # Apply rate limits to protected endpoints
    from app.api.routes import purchase, research, chat
    
    # Purchase endpoint: strict rate limit (expensive operations)
    limiter.limit("10/minute")(purchase.purchase_research)
    
    # Research endpoints: moderate rate limits
    limiter.limit("15/minute")(research.analyze_research_query)
    limiter.limit("5/minute")(research.generate_research_report)
    limiter.limit("30/minute")(research.get_enrichment_status)
    limiter.limit("60/minute")(research.get_source_details)
    
    # Chat endpoints: higher rate limits
    limiter.limit("30/minute")(chat.chat)
    limiter.limit("60/minute")(chat.get_conversation_history)
    limiter.limit("10/minute")(chat.clear_conversation)
    
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