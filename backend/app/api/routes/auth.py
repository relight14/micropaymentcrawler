"""Authentication routes"""

from fastapi import APIRouter, HTTPException, Header, Depends
from slowapi import Limiter
from slowapi.util import get_remote_address
from pydantic import BaseModel
from typing import Dict, Any, Optional

from integrations.ledewire import LedeWireAPI
from schemas.api import LoginRequest, SignupRequest, AuthResponse, WalletBalanceResponse
from utils.rate_limit import get_user_or_ip_key

router = APIRouter()

# Initialize LedeWire API integration
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


@router.post("/login", response_model=AuthResponse)
# @limiter.limit("5/minute")  # Prevent brute force attacks
async def login(request: LoginRequest):
    """Authenticate user with email and password"""
    try:
        result = ledewire.login(request.email, request.password)
        
        if "error" in result:
            # Handle API errors from LedeWire
            error_msg = ledewire.handle_api_error(result)
            raise HTTPException(status_code=401, detail=f"Login failed: {error_msg}")
        
        return AuthResponse(
            access_token=result["access_token"],
            user_id=result["user_id"],
            success=True,
            message="Login successful"
        )
        
    except HTTPException:
        raise  # Re-raise FastAPI exceptions as-is
    except Exception as e:
        # Log the full error for debugging while returning safe message to user
        print(f"Login error for {request.email}: {e}")
        raise HTTPException(status_code=500, detail="Authentication service unavailable")


@router.post("/signup", response_model=AuthResponse) 
# @limiter.limit("3/minute")  # Limit account creation attempts
async def signup(request: SignupRequest):
    """Create new user account"""
    try:
        result = ledewire.signup(request.email, request.password)
        
        if "error" in result:
            error_msg = ledewire.handle_api_error(result)
            
            # Check for specific signup errors
            if "already exists" in error_msg.lower() or "duplicate" in error_msg.lower():
                raise HTTPException(status_code=409, detail="Account already exists")
            elif "invalid" in error_msg.lower() and "password" in error_msg.lower():
                raise HTTPException(status_code=400, detail="Password does not meet requirements")
            else:
                raise HTTPException(status_code=400, detail=f"Signup failed: {error_msg}")
        
        return AuthResponse(
            access_token=result["access_token"],
            user_id=result["user_id"], 
            success=True,
            message="Account created successfully"
        )
        
    except HTTPException:
        raise  # Re-raise FastAPI exceptions as-is
    except Exception as e:
        print(f"Signup error for {request.email}: {e}")
        raise HTTPException(status_code=500, detail="Account creation service unavailable")


@router.get("/balance", response_model=WalletBalanceResponse)
# @limiter.limit("10/minute")
async def get_wallet_balance(authorization: str = Header(None, alias="Authorization")):
    """Get current wallet balance for authenticated user"""
    try:
        access_token = extract_bearer_token(authorization)
        
        # Get wallet balance from LedeWire
        balance_result = ledewire.get_wallet_balance(access_token)
        
        if "error" in balance_result:
            error_message = ledewire.handle_api_error(balance_result)
            raise HTTPException(status_code=401, detail=f"Authentication failed: {error_message}")
        
        return WalletBalanceResponse(
            balance_cents=balance_result["balance_cents"],
            balance_display=f"${balance_result['balance_cents'] / 100:.2f}",
            currency="USD"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        # Network or connection errors
        print(f"Wallet balance error: {e}")
        raise HTTPException(status_code=503, detail="Wallet service temporarily unavailable")