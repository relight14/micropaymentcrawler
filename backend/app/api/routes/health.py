"""Health check routes"""

from fastapi import APIRouter
from fastapi.responses import RedirectResponse, FileResponse
import os

router = APIRouter()


@router.get("/")
async def root():
    """Root endpoint - serve chat interface directly."""
    chat_file = "static/chat.html"
    if os.path.exists(chat_file):
        return FileResponse(chat_file, media_type="text/html")
    else:
        return {"message": "Welcome to LedeWire AI Research Tool", "status": "running"}


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