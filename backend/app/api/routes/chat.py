"""Chat and conversation routes"""

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel
from typing import Optional, Dict, Any
import time

from services.ai.conversational import AIResearchService
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter

router = APIRouter()

# Initialize services
ai_service = AIResearchService()
ledewire = LedeWireAPI()

# Token validation cache with TTL (5 minutes)
_token_cache: Dict[str, tuple[Any, float]] = {}
_TOKEN_CACHE_TTL = 300  # 5 minutes
_last_cache_cleanup = time.time()
_CACHE_CLEANUP_INTERVAL = 60  # Clean up every minute


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
    suggest_research: bool = False
    topic_hint: Optional[str] = None
    # Intent detection fields
    source_search_requested: bool = False
    source_query: str = ""
    source_confidence: float = 0.0


def _cleanup_token_cache():
    """Periodically clean up expired token cache entries"""
    global _last_cache_cleanup
    current_time = time.time()
    
    # Only cleanup if interval has passed
    if current_time - _last_cache_cleanup < _CACHE_CLEANUP_INTERVAL:
        return
    
    # Remove expired entries
    expired_keys = [
        token for token, (_, timestamp) in _token_cache.items()
        if current_time - timestamp >= _TOKEN_CACHE_TTL
    ]
    
    for token in expired_keys:
        del _token_cache[token]
    
    _last_cache_cleanup = current_time


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


def validate_user_token(access_token: str, use_cache: bool = True):
    """Validate JWT token with LedeWire API (with caching for performance)."""
    # Periodic cleanup
    _cleanup_token_cache()
    
    # Check cache first if enabled
    if use_cache and access_token in _token_cache:
        cached_result, cached_time = _token_cache[access_token]
        if time.time() - cached_time < _TOKEN_CACHE_TTL:
            return cached_result
        else:
            # Cache expired, remove it
            del _token_cache[access_token]
    
    try:
        balance_result = ledewire.get_wallet_balance(access_token)
        
        if "error" in balance_result:
            error_message = ledewire.handle_api_error(balance_result)
            raise HTTPException(status_code=401, detail=f"Invalid token: {error_message}")
        
        # Cache successful validation
        if use_cache:
            _token_cache[access_token] = (balance_result, time.time())
            # Limit cache size to prevent memory bloat
            if len(_token_cache) > 10000:
                # Remove oldest 10% of entries
                sorted_by_time = sorted(_token_cache.items(), key=lambda x: x[1][1])
                for token, _ in sorted_by_time[:1000]:
                    if token in _token_cache:
                        del _token_cache[token]
        
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
    """
    Extract user ID from JWT token by decoding the payload.
    Uses email or sub claim as the unique user identifier.
    """
    try:
        import json
        import base64
        
        # JWT format: header.payload.signature
        parts = access_token.split('.')
        if len(parts) != 3:
            raise ValueError("Invalid JWT format")
        
        # Decode the payload (middle part)
        payload = parts[1]
        # Add padding if needed for base64 decoding
        padding = 4 - (len(payload) % 4)
        if padding != 4:
            payload += '=' * padding
        
        decoded_bytes = base64.urlsafe_b64decode(payload)
        decoded_payload = json.loads(decoded_bytes)
        
        # Extract user identifier from token claims
        # Prefer email, fall back to sub (subject), then user_id
        user_identifier = (
            decoded_payload.get('email') or 
            decoded_payload.get('sub') or 
            decoded_payload.get('user_id')
        )
        
        if not user_identifier:
            raise ValueError("No user identifier found in JWT")
        
        return f"user_{user_identifier}"
        
    except Exception as e:
        # Fallback for chat: use anonymous user
        import hashlib  
        print(f"⚠️ Failed to decode JWT for chat, using anon fallback: {e}")
        return f"anon_{hashlib.sha256(access_token.encode()).hexdigest()[:12]}"


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
        
        # Process chat message with user-specific session
        response = await ai_service.chat(chat_request.message, chat_request.mode, user_id)
        
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