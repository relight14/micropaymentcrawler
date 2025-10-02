"""Rate limiting utilities"""

import hashlib
from fastapi import Request
from slowapi import Limiter


def get_user_or_ip_key(request: Request) -> str:
    """Get unique identifier for rate limiting - user ID if authenticated, otherwise IP"""
    
    # Try to get authenticated user ID first
    access_token = request.headers.get("Authorization")
    if access_token and access_token.startswith("Bearer "):
        token = access_token[7:]  # Remove "Bearer " prefix
        try:
            # For now, use a token-based ID (development fallback)
            return f"user_{hashlib.sha256(token.encode()).hexdigest()[:12]}"
        except:
            pass
    
    # Fallback to IP-based rate limiting
    client_ip = request.client.host if request.client else "unknown"
    return f"ip_{client_ip}"


# Shared limiter instance - can be imported by route modules and app factory
limiter = Limiter(key_func=get_user_or_ip_key)