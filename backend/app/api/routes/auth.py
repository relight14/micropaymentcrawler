"""Authentication routes"""

import logging
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Dict, Any, Optional
import requests  # For handling HTTP exceptions from LedeWire API

from integrations.ledewire import LedeWireAPI
from schemas.api import LoginRequest, SignupRequest, AuthResponse, WalletBalanceResponse

router = APIRouter()
logger = logging.getLogger(__name__)

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
async def login(request: LoginRequest, x_previous_user_id: str = Header(None, alias="X-Previous-User-ID")):
    """Authenticate user with email and password"""
    try:
        result = ledewire.authenticate_user(request.email, request.password)
        
        if "error" in result:
            # Handle API errors from LedeWire
            error_msg = ledewire.handle_api_error(result)
            raise HTTPException(status_code=401, detail=f"Login failed: {error_msg}")
        
        # DEBUG: Log what LedeWire actually returns (mask token)
        debug_result = {k: (v[:20] + "..." if k == "access_token" and v else v) for k, v in result.items()}
        logger.info(f"🔍 LedeWire login response for {request.email}: {debug_result}")
        
        # Handle conversation migration from anonymous to authenticated user
        logger.debug(f"Migration check: x_previous_user_id={x_previous_user_id}, has_access_token={bool(result.get('access_token'))}")
        
        if x_previous_user_id and result.get("access_token"):
            from app.api.routes.chat import extract_user_id_from_token, ai_service
            
            # Security: Only allow migration of "anonymous" or specific patterns to prevent hijacking
            if x_previous_user_id == "anonymous" or x_previous_user_id.startswith("anon_"):
                # Get the new authenticated user ID
                new_user_id = extract_user_id_from_token(result["access_token"])
                logger.info(f"Attempting migration from '{x_previous_user_id}' to '{new_user_id}'")
                
                # Migrate conversation history using the shared AI service instance
                migrated = ai_service.migrate_conversation(x_previous_user_id, new_user_id)
                if migrated:
                    logger.info(f"Migrated conversation from {x_previous_user_id} to {new_user_id}")
                else:
                    logger.warning(f"No conversation to migrate from {x_previous_user_id}")
            else:
                logger.warning(f"Rejected migration attempt for suspicious user_id: {x_previous_user_id}")
        elif x_previous_user_id:
            logger.warning(f"Migration skipped: Missing access token for user_id {x_previous_user_id}")
        else:
            logger.debug(f"No previous user ID provided for migration")
        
        return AuthResponse(
            access_token=result["access_token"],
            user_id=result.get("user_id", "unknown"),  # Handle missing user_id gracefully
            success=True,
            message="Login successful"
        )
        
    except HTTPException:
        raise  # Re-raise FastAPI exceptions as-is
    except requests.HTTPError as e:
        # Extract the actual error message from the HTTPError
        logger.error(f"Login error for {request.email}: {e}")
        error_message = str(e).split(',')[0] if ',' in str(e) else str(e)
        raise HTTPException(status_code=401, detail=error_message)
    except Exception as e:
        # Log the full error for debugging while returning safe message to user
        logger.error(f"Unexpected login error for {request.email}: {e}")
        raise HTTPException(status_code=500, detail="Authentication service unavailable")


@router.post("/signup", response_model=AuthResponse)
async def signup(request: SignupRequest):
    """Create new user account"""
    try:
        # Combine first and last name for LedeWire API
        full_name = f"{request.first_name} {request.last_name}"
        result = ledewire.signup_user(request.email, request.password, full_name)
        
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
            user_id=result.get("user_id", "unknown"),  # Handle missing user_id gracefully
            success=True,
            message="Account created successfully"
        )
        
    except HTTPException:
        raise  # Re-raise FastAPI exceptions as-is
    except requests.HTTPError as e:
        # Extract the actual error message from the HTTPError
        logger.error(f"Signup error for {request.email}: {e}")
        error_message = str(e).split(',')[0] if ',' in str(e) else str(e)
        # Determine appropriate status code based on error message
        if "already exists" in error_message.lower():
            raise HTTPException(status_code=409, detail=error_message)
        elif "invalid" in error_message.lower():
            raise HTTPException(status_code=400, detail=error_message)
        else:
            raise HTTPException(status_code=400, detail=error_message)
    except Exception as e:
        logger.error(f"Unexpected signup error for {request.email}: {e}")
        raise HTTPException(status_code=500, detail="Account creation service unavailable")


class RefreshRequest(BaseModel):
    refresh_token: str

@router.post("/refresh")
async def refresh_token(request: RefreshRequest):
    """Refresh access token using refresh token"""
    try:
        if not request.refresh_token:
            raise HTTPException(status_code=400, detail="Refresh token required")
            
        # Note: LedeWire API doesn't currently support token refresh
        # TODO: Implement when LedeWire adds refresh token support
        raise HTTPException(status_code=501, detail="Token refresh not yet implemented")
        
        
    except requests.exceptions.HTTPError as e:
        if "Invalid or expired refresh token" in str(e):
            raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
        else:
            logger.error(f"Token refresh error: {str(e)}")
            raise HTTPException(status_code=503, detail="Unable to refresh token")
    except Exception as e:
        logger.error(f"Token refresh error: {e}")
        raise HTTPException(status_code=500, detail="Token refresh service unavailable")


@router.get("/balance", response_model=WalletBalanceResponse)
# @limiter.limit("10/minute")
async def get_wallet_balance(authorization: str = Header(None, alias="Authorization")):
    """Get current wallet balance for authenticated user"""
    try:
        access_token = extract_bearer_token(authorization)
        
        # Get wallet balance from LedeWire
        balance_result = ledewire.get_wallet_balance(access_token)
        
        logger.debug(f"LedeWire API balance response: {balance_result}")
        
        if "error" in balance_result:
            error_message = ledewire.handle_api_error(balance_result)
            raise HTTPException(status_code=401, detail=f"Authentication failed: {error_message}")
        
        # Handle both "balance" and "balance_cents" field names
        balance_cents = balance_result.get("balance_cents") or balance_result.get("balance", 0)
        
        return WalletBalanceResponse(
            balance_cents=balance_cents,
            balance_display=f"${balance_cents / 100:.2f}",
            currency="USD"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        # Network or connection errors
        logger.error(f"Wallet balance error: {e}")
        raise HTTPException(status_code=503, detail="Wallet service temporarily unavailable")