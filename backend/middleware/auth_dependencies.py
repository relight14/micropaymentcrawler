"""
FastAPI authentication dependencies for consistent auth across all routes.

This module provides reusable authentication dependencies that handle:
- Bearer token extraction from Authorization headers
- JWT token validation with LedeWire API
- User ID extraction from JWT tokens
- Authenticated user information retrieval

Usage:
    from middleware.auth_dependencies import get_current_token, get_current_user_id, get_authenticated_user
    
    @router.get("/endpoint")
    async def endpoint(token: str = Depends(get_current_token)):
        # Use validated token
        pass
"""

import logging
from typing import Dict, Any
from fastapi import Header, Depends, HTTPException
from utils.auth import extract_bearer_token, validate_user_token, extract_user_id_from_token

logger = logging.getLogger(__name__)


def get_current_token(authorization: str = Header(None, alias="Authorization")) -> str:
    """
    FastAPI dependency to extract and return the current user's access token.
    
    Args:
        authorization: Authorization header from request (injected by FastAPI)
        
    Returns:
        str: Validated bearer token
        
    Raises:
        HTTPException: 401 if token is missing or invalid format
        
    Example:
        @router.get("/endpoint")
        async def endpoint(token: str = Depends(get_current_token)):
            # token is validated and ready to use
            pass
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    return extract_bearer_token(authorization)


def get_current_user_id(token: str = Depends(get_current_token)) -> str:
    """
    FastAPI dependency to extract the current user's ID from their token.
    
    Args:
        token: Access token (injected via get_current_token dependency)
        
    Returns:
        str: User ID extracted from JWT (format: "user_{email|sub|user_id}")
        
    Example:
        @router.get("/endpoint")
        async def endpoint(user_id: str = Depends(get_current_user_id)):
            # user_id is ready to use
            pass
    """
    return extract_user_id_from_token(token)


def get_authenticated_user(token: str = Depends(get_current_token)) -> Dict[str, Any]:
    """
    FastAPI dependency to validate token and return authenticated user info.
    
    This dependency:
    1. Validates the token with LedeWire API
    2. Returns user wallet balance and account info
    
    Args:
        token: Access token (injected via get_current_token dependency)
        
    Returns:
        dict: User information including wallet balance
        
    Raises:
        HTTPException: 401 if token is invalid or expired
        HTTPException: 503 if authentication service is unavailable
        
    Example:
        @router.get("/endpoint")
        async def endpoint(user: dict = Depends(get_authenticated_user)):
            # user contains validated user info and wallet balance
            pass
    """
    return validate_user_token(token)


def get_authenticated_user_with_id(token: str = Depends(get_current_token)) -> Dict[str, Any]:
    """
    FastAPI dependency to get both authenticated user info and user ID.
    
    Returns a dict containing:
    - All fields from validate_user_token() (wallet balance, etc.)
    - user_id: Extracted user identifier
    - access_token: The validated token
    
    Args:
        token: Access token (injected via get_current_token dependency)
        
    Returns:
        dict: User info with added user_id and access_token fields
        
    Example:
        @router.post("/endpoint")
        async def endpoint(user: dict = Depends(get_authenticated_user_with_id)):
            user_id = user['user_id']
            balance = user.get('balance_cents', 0)
            # Use both user_id and wallet info
            pass
    """
    user_info = validate_user_token(token)
    user_id = extract_user_id_from_token(token)
    
    return {
        **user_info,
        "user_id": user_id,
        "access_token": token
    }
