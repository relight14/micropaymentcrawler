"""Chat and conversation routes"""

from fastapi import APIRouter, HTTPException, Header, Request, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any
import time
import requests

from services.ai.conversational import AIResearchService
from services.conversation_manager import conversation_manager
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter
from utils.auth import extract_bearer_token, extract_user_id_from_token, validate_user_token

router = APIRouter()

# Initialize services
ai_service = AIResearchService()
ledewire = LedeWireAPI()


class ChatRequest(BaseModel):
    message: str
    mode: str = "conversational"  # "conversational" or "deep_research"
    project_id: Optional[int] = None  # Optional project context


class ChatResponse(BaseModel):
    response: str
    mode: str
    conversation_length: int
    project_id: int  # Project context window ID
    sources: Optional[list] = None
    licensing_summary: Optional[dict] = None
    total_cost: Optional[float] = None
    refined_query: Optional[str] = None
    suggest_research: bool = False
    topic_hint: Optional[str] = None
    # Intent detection fields
    source_search_requested: bool = False
    source_query: str = ""
    source_confidence: float = 0.0


# Note: chat.py no longer needs local token validation - using centralized utils.auth


@router.post("", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat(request: Request, chat_request: ChatRequest, authorization: str = Header(None)):
    """AI chat endpoint supporting both conversational and deep research modes (free for all users)"""
    try:
        # Chat is free - allow both authenticated and anonymous users
        if authorization:
            # Authenticated user - validate token and get user ID
            try:
                token = extract_bearer_token(authorization)
                validate_user_token(token)
                user_id = extract_user_id_from_token(token)
            except HTTPException:
                # If token validation fails, fall back to anonymous
                import hashlib
                client_ip = request.client.host if request.client else "unknown"
                user_id = f"anon_{hashlib.sha256(client_ip.encode()).hexdigest()[:12]}"
        else:
            # Anonymous user - generate ID from IP
            import hashlib
            client_ip = request.client.host if request.client else "unknown"
            user_id = f"anon_{hashlib.sha256(client_ip.encode()).hexdigest()[:12]}"
        
        # Get or create project context
        # If a project_id is provided, validate it exists and belongs to user
        if chat_request.project_id:
            from data.db_wrapper import db_instance as db, normalize_query
            
            # Verify project exists and belongs to user
            project_query = normalize_query("""
                SELECT id FROM projects WHERE id = ? AND user_id = ? AND is_active = TRUE
            """)
            project_result = db.execute_query(project_query, (chat_request.project_id, user_id))
            
            if project_result:
                # Project exists and belongs to user - use it
                project_id = chat_request.project_id
            else:
                # Project doesn't exist or doesn't belong to user - create/get default
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Invalid project_id {chat_request.project_id} for user {user_id}, using default project")
                project_id = conversation_manager.get_or_create_default_project(user_id)
        else:
            # No project_id provided - auto-create or get default project
            project_id = conversation_manager.get_or_create_default_project(user_id)
        
        # Save user message to database
        conversation_manager.add_message(project_id, user_id, "user", chat_request.message)
        
        # Get conversation context from database
        conversation_history = conversation_manager.get_context_window(project_id, window_size=20)
        
        # Process chat message with context
        response = await ai_service.chat_with_context(
            chat_request.message, 
            chat_request.mode, 
            user_id,
            conversation_history
        )
        
        # Save assistant response to database
        response_metadata = {
            'sources': response.get('sources'),
            'licensing_summary': response.get('licensing_summary'),
            'total_cost': response.get('total_cost'),
            'refined_query': response.get('refined_query'),
            'source_search_requested': response.get('source_search_requested', False),
            'source_query': response.get('source_query', ''),
            'source_confidence': response.get('source_confidence', 0.0)
        }
        conversation_manager.add_message(
            project_id, 
            user_id, 
            "assistant", 
            response['response'],
            response_metadata
        )
        
        return ChatResponse(project_id=project_id, **response)
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"Chat error: {e}")
        print(traceback.format_exc())
        # Generate anonymous user ID for error response
        import hashlib
        client_ip = request.client.host if request.client else "unknown"
        error_user_id = f"anon_{hashlib.sha256(client_ip.encode()).hexdigest()[:12]}"
        # Get or create project for error response
        error_project_id = conversation_manager.get_or_create_default_project(error_user_id)
        return ChatResponse(
            response="I'm having trouble right now, but I'm here to help with your research questions!",
            mode=chat_request.mode,
            conversation_length=0,
            project_id=error_project_id
        )


@router.get("/history")
@limiter.limit("60/minute")
async def get_conversation_history(
    request: Request, 
    authorization: str = Header(None),
    project_id: Optional[int] = None
):
    """Get conversation history for a project"""
    # Require authentication
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    
    token = extract_bearer_token(authorization)
    validate_user_token(token)
    user_id = extract_user_id_from_token(token)
    
    # Get project context
    if not project_id:
        project_id = conversation_manager.get_or_create_default_project(user_id)
    
    history = conversation_manager.get_conversation_history(project_id)
    return {
        "project_id": project_id,
        "history": history,
        "length": len(history)
    }


@router.get("/user-id")
async def get_current_user_id(authorization: str = Header(None)):
    """Get current user ID for session management"""
    # Require authentication
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    
    token = extract_bearer_token(authorization)
    validate_user_token(token)
    user_id = extract_user_id_from_token(token)
    
    return {"user_id": user_id}


@router.post("/clear")
@limiter.limit("10/minute")
async def clear_conversation(
    request: Request, 
    authorization: str = Header(None),
    project_id: Optional[int] = None
):
    """Clear conversation history for a project"""
    # Require authentication
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    
    token = extract_bearer_token(authorization)
    validate_user_token(token)
    user_id = extract_user_id_from_token(token)
    
    # Get project context
    if not project_id:
        project_id = conversation_manager.get_or_create_default_project(user_id)
    
    conversation_manager.clear_conversation(project_id, user_id)
    return {"success": True, "message": "Conversation cleared", "project_id": project_id}