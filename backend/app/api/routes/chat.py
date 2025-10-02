"""Chat and conversation routes"""

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel
from typing import Optional, Dict, Any

from services.ai.conversational import AIResearchService
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter

router = APIRouter()

# Initialize services
ai_service = AIResearchService()
ledewire = LedeWireAPI()


class ChatRequest(BaseModel):
    message: str
    mode: str = "conversational"  # "conversational" or "deep_research"


class ChatResponse(BaseModel):
    response: str
    mode: str
    conversation_length: int
    sources: Optional[list] = None
    licensing_summary: Optional[dict] = None
    total_cost: Optional[float] = None
    refined_query: Optional[str] = None


def extract_bearer_token(authorization: str) -> str:
    """Extract and validate Bearer token from Authorization header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")
    
    access_token = authorization.split(" ", 1)[1].strip()
    
    if not access_token:
        raise HTTPException(status_code=401, detail="Bearer token cannot be empty")
    
    return access_token


def validate_user_token(access_token: str):
    """Validate JWT token with LedeWire API."""
    try:
        balance_result = ledewire.get_wallet_balance(access_token)
        
        if "error" in balance_result:
            error_message = ledewire.handle_api_error(balance_result)
            raise HTTPException(status_code=401, detail=f"Invalid token: {error_message}")
        
        return balance_result
        
    except HTTPException:
        raise
    except Exception as e:
        import requests
        if isinstance(e, requests.HTTPError) and hasattr(e, 'response'):
            if e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Authentication service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Authentication service error")
        else:
            raise HTTPException(status_code=503, detail="Authentication service unavailable")


def extract_user_id_from_token(access_token: str) -> str:
    """Extract user ID from JWT token for session isolation"""
    try:
        response = ledewire.get_wallet_balance(access_token)
        if response.get('balance_cents') is not None:
            wallet_id = response.get('wallet_id', 'mock_wallet')
            return f"user_{wallet_id}"
        else:
            import hashlib
            return f"user_{hashlib.sha256(access_token.encode()).hexdigest()[:12]}"
    except Exception:
        import hashlib  
        return f"anon_{hashlib.sha256(access_token.encode()).hexdigest()[:12]}"


@router.post("", response_model=ChatResponse)
@limiter.limit("30/minute")
async def chat(request: Request, chat_request: ChatRequest, authorization: str = Header(None)):
    """AI chat endpoint supporting both conversational and deep research modes"""
    try:
        # Require authentication for all chat modes
        if not authorization:
            raise HTTPException(status_code=401, detail="Authorization required")
        
        token = extract_bearer_token(authorization)
        validate_user_token(token)
        user_id = extract_user_id_from_token(token)
        
        # Process chat message with user-specific session
        response = ai_service.chat(chat_request.message, chat_request.mode, user_id)
        
        return ChatResponse(**response)
        
    except HTTPException:
        raise
    except Exception as e:
        return ChatResponse(
            response="I'm having trouble right now, but I'm here to help with your research questions!",
            mode=chat_request.mode,
            conversation_length=0
        )


@router.get("/history")
@limiter.limit("60/minute")
async def get_conversation_history(request: Request, authorization: str = Header(None)):
    """Get current conversation history for authenticated user"""
    # Require authentication
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    
    token = extract_bearer_token(authorization)
    validate_user_token(token)
    user_id = token[:16]  # Use first 16 chars as user identifier
    
    history = ai_service.get_conversation_history(user_id)
    return {
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
async def clear_conversation(request: Request, authorization: str = Header(None)):
    """Clear conversation history for authenticated user"""
    # Require authentication
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization required")
    
    token = extract_bearer_token(authorization)
    validate_user_token(token)
    user_id = token[:16]  # Use first 16 chars as user identifier
    
    ai_service.clear_conversation(user_id)
    return {"success": True, "message": "Conversation cleared"}