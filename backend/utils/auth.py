"""Shared authentication utilities for JWT token handling."""

import json
import base64
import hashlib
import logging
from fastapi import HTTPException
from integrations.ledewire import LedeWireAPI

logger = logging.getLogger(__name__)
ledewire = LedeWireAPI()


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
        if isinstance(e, requests.HTTPError) and hasattr(e, 'response') and e.response is not None:
            if e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Authentication service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Authentication service error")
        else:
            # Network error or service unavailable
            raise HTTPException(status_code=503, detail="Authentication service unavailable")


def extract_user_id_from_token(access_token: str) -> str:
    """
    Extract user ID from JWT token by decoding the payload.
    Uses email or sub claim as the unique user identifier.
    """
    try:
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
        # Fallback: hash the token itself (should rarely happen)
        # This ensures service continues working even with malformed tokens
        logger.warning(f"Failed to decode JWT, using hash fallback: {e}")
        return f"user_{hashlib.sha256(access_token.encode()).hexdigest()[:16]}"
