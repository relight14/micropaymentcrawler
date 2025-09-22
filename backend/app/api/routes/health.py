"""Health check routes"""

from fastapi import APIRouter
from fastapi.responses import RedirectResponse

router = APIRouter()


@router.get("/")
async def root():
    """Root endpoint - redirect to chat interface."""
    return RedirectResponse(url="/static/chat.html")


@router.get("/health")
async def health_check():
    """Health check endpoint for monitoring"""
    return {
        "status": "healthy",
        "service": "LedeWire AI Research Tool",
        "version": "1.0.0"
    }


@router.get("/chat")
async def chat_interface():
    """Chat interface endpoint - redirect to chat interface."""
    return RedirectResponse(url="/static/chat.html")