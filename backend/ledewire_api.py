"""
LedeWire API Integration
Real HTTP implementation using secured credentials.
"""
import os
import uuid
import json
import requests
from requests.adapters import HTTPAdapter
import ssl
import urllib3
from urllib3.util.retry import Retry
from urllib3.util.ssl_ import create_urllib3_context
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

# SSL adapter removed - was unsafe and ineffective for SNI issues

class LedeWireAPI:
    """
    LedeWire API wrapper - Production implementation with real HTTP calls.
    Uses secured environment variables for authentication with SSL fixes.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        # Load credentials from secure environment variables
        self.api_key = api_key or os.getenv("LEDEWIRE_API_KEY")
        self.api_secret = os.getenv("LEDEWIRE_API_SECRET")
        self.api_base = "https://api.ledewire.com/v1"
        self.use_mock = os.getenv("LEDEWIRE_USE_MOCK", "false").lower() == "true"
        
        # PRODUCTION SECURITY: Validate credentials required
        if not self.use_mock and (not self.api_key or not self.api_secret):
            raise ValueError("PRODUCTION ERROR: LedeWire API credentials required. Set LEDEWIRE_API_KEY and LEDEWIRE_API_SECRET")
        
        # Setup HTTP session with REAL authentication headers
        self.session = requests.Session()
        
        # Configure retry strategy for connection issues
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        self.session.mount('https://', HTTPAdapter(max_retries=retry_strategy))
        
        if self.api_key and self.api_secret:
            self.session.headers.update({
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-API-Key': self.api_key,
                'X-API-Secret': self.api_secret,
                'User-Agent': 'LedeWire-Client/1.0'
            })
    
    # Authentication Methods
    
    def authenticate_user(self, email: str, password: str) -> Dict[str, Any]:
        """
        POST /v1/auth/login/email
        Authenticate user and return JWT token.
        """
        try:
            response = self.session.post(
                f"{self.api_base}/auth/login/email",
                json={
                    "email": email,
                    "password": password
                },
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if self.use_mock:
                # Development-only fallback
                user_id = f"mock_user_{uuid.uuid4().hex[:8]}"
                return {
                    "access_token": f"mock_jwt_token_{uuid.uuid4().hex[:16]}",
                    "refresh_token": f"mock_refresh_token_{uuid.uuid4().hex[:16]}",
                    "expires_at": (datetime.now() + timedelta(hours=2)).isoformat(),
                    "user_id": user_id,
                    "email": email,
                    "_fallback": True
                }
            else:
                # PRODUCTION: Re-raise with proper HTTP status
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 401:
                        raise requests.HTTPError("Invalid credentials", response=e.response)
                    elif e.response.status_code == 400:
                        raise requests.HTTPError("Invalid request", response=e.response)
                    else:
                        raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")
    
    def signup_user(self, email: str, password: str, name: str) -> Dict[str, Any]:
        """
        POST /v1/auth/signup
        Register new user and return JWT token.
        """
        try:
            response = self.session.post(
                f"{self.api_base}/auth/signup",
                json={
                    "email": email,
                    "password": password,
                    "name": name
                },
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if self.use_mock:
                # Development-only fallback
                user_id = f"mock_user_{uuid.uuid4().hex[:8]}"
                return {
                    "access_token": f"mock_jwt_token_{uuid.uuid4().hex[:16]}",
                    "refresh_token": f"mock_refresh_token_{uuid.uuid4().hex[:16]}",
                    "expires_at": (datetime.now() + timedelta(hours=2)).isoformat(),
                    "user_id": user_id,
                    "email": email,
                    "name": name,
                    "_fallback": True
                }
            else:
                # PRODUCTION: Re-raise with proper HTTP status
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 400:
                        raise requests.HTTPError("Invalid signup data", response=e.response)
                    elif e.response.status_code == 409:
                        raise requests.HTTPError("Email already exists", response=e.response)
                    else:
                        raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")
    
    # User Methods
    
    def get_user_info(self, access_token: str) -> Dict[str, Any]:
        """
        GET /v1/user/me
        Get current user information from access token.
        """
        try:
            response = self.session.get(
                f"{self.api_base}/user/me",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if self.use_mock:
                # Development-only fallback
                # Extract mock user ID from token for consistency
                user_id = f"mock_user_{uuid.uuid4().hex[:8]}"
                return {
                    "user_id": user_id,
                    "email": f"user_{user_id.split('_')[2]}@example.com",
                    "name": f"User {user_id.split('_')[2]}",
                    "_fallback": True
                }
            else:
                # PRODUCTION: Re-raise with proper HTTP status
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 401:
                        raise requests.HTTPError("Invalid or expired token", response=e.response)
                    else:
                        raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")
    
    # Wallet Methods
    
    def get_wallet_balance(self, access_token: str) -> Dict[str, Any]:
        """
        GET /v1/wallet/balance
        Get user's current wallet balance.
        """
        try:
            response = self.session.get(
                f"{self.api_base}/wallet/balance",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if self.use_mock:
                # Development-only fallback
                return {
                    "balance_cents": 10000,  # $100.00 mock balance
                    "_fallback": True
                }
            else:
                # PRODUCTION: Re-raise with proper HTTP status
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 401:
                        raise requests.HTTPError("Invalid or expired token", response=e.response)
                    else:
                        raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")
    
    def check_sufficient_funds(self, access_token: str, amount_cents: int) -> bool:
        """
        Helper method to check if user has sufficient funds.
        """
        balance = self.get_wallet_balance(access_token)
        return balance["balance_cents"] >= amount_cents
    
    # Purchase Methods
    
    def create_purchase(self, access_token: str, content_id: str, price_cents: int, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """
        POST /v1/purchases
        Create a new content purchase with idempotency.
        """
        # PRODUCTION SAFETY: Require idempotency key to prevent double charges
        if not idempotency_key:
            raise ValueError("CRITICAL: Idempotency key required for payment operations")
        
        try:
            # CRITICAL: Ensure idempotency key is sent to LedeWire for provider-side protection
            response = self.session.post(
                f"{self.api_base}/purchases",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Idempotency-Key": idempotency_key,  # MUST be sent to prevent provider double charges
                    "X-Request-ID": idempotency_key  # Backup header for redundancy
                },
                json={
                    "content_id": content_id,
                    "amount_cents": price_cents
                },
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if self.use_mock:
                # Development-only: check funds first
                if not self.check_sufficient_funds(access_token, price_cents):
                    return {
                        "error": {
                            "code": 402,
                            "message": "Insufficient funds in wallet"
                        }
                    }
                
                # Mock purchase for development
                purchase_id = str(uuid.uuid4())
                return {
                    "id": purchase_id,
                    "content_id": content_id,
                    "buyer_id": f"mock_buyer_{uuid.uuid4().hex[:8]}",
                    "seller_id": f"mock_seller_{uuid.uuid4().hex[:8]}",
                    "amount_cents": price_cents,
                    "timestamp": datetime.now().isoformat(),
                    "status": "completed",
                    "_fallback": True
                }
            else:
                # PRODUCTION: Re-raise with proper HTTP status
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 402:
                        raise requests.HTTPError("Insufficient funds in wallet", response=e.response)
                    elif e.response.status_code == 401:
                        raise requests.HTTPError("Invalid or expired token", response=e.response)
                    elif e.response.status_code == 400:
                        raise requests.HTTPError("Invalid purchase request", response=e.response)
                    else:
                        raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")
    
    def verify_purchase(self, access_token: str, content_id: str) -> Dict[str, Any]:
        """
        GET /v1/purchase/verify?content_id=X
        Verify if user has purchased specific content.
        """
        try:
            response = self.session.get(
                f"{self.api_base}/purchase/verify",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"content_id": content_id},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if self.use_mock:
                # Development-only fallback
                return {
                    "has_purchased": True,  # Always true for mock
                    "purchase_details": {
                        "purchase_id": f"mock_purchase_{uuid.uuid4().hex[:8]}",
                        "purchase_date": datetime.now().isoformat()
                    },
                    "checkout_readiness": {
                        "is_authenticated": True,
                        "has_sufficient_funds": self.check_sufficient_funds(access_token, 100)  # $1.00 example
                    },
                    "_fallback": True
                }
            else:
                # PRODUCTION: Re-raise with proper HTTP status
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 401:
                        raise requests.HTTPError("Invalid or expired token", response=e.response)
                    elif e.response.status_code == 404:
                        raise requests.HTTPError("Content not found", response=e.response)
                    else:
                        raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")
    
    # Content Access Methods
    
    def get_content_access_info(self, access_token: str, content_id: str) -> Dict[str, Any]:
        """
        GET /v1/content/{id}/with-access
        Get content access information for user.
        """
        try:
            response = self.session.get(
                f"{self.api_base}/content/{content_id}/with-access",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            if self.use_mock:
                # Development-only fallback
                balance = self.get_wallet_balance(access_token)
                return {
                    "user_id": f"mock_user_{uuid.uuid4().hex[:8]}",
                    "has_purchased": False,  # Default to false, check purchase history
                    "has_sufficient_funds": balance["balance_cents"] >= 100,  # $1.00 minimum
                    "wallet_balance_cents": balance["balance_cents"],
                    "next_required_action": "purchase",  # Could be: authenticate, fund_wallet, purchase, none
                    "_fallback": True
                }
            else:
                # PRODUCTION: Re-raise with proper HTTP status
                if hasattr(e, 'response') and e.response is not None:
                    if e.response.status_code == 401:
                        raise requests.HTTPError("Invalid or expired token", response=e.response)
                    elif e.response.status_code == 404:
                        raise requests.HTTPError("Content not found", response=e.response)
                    else:
                        raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")

    # Error Handling
    
    def handle_api_error(self, response: Dict[str, Any]) -> str:
        """
        Handle LedeWire API errors gracefully.
        """
        if "error" in response:
            error_code = response["error"].get("code", 500)
            error_message = response["error"].get("message", "Unknown error")
            
            # Map common errors to user-friendly messages
            error_map = {
                401: "Please log in to continue",
                402: "Insufficient funds - please add money to your wallet", 
                404: "Content not found",
                429: "Too many requests - please try again later"
            }
            
            return error_map.get(error_code, f"Error: {error_message}")
        
        return "Unknown error occurred"

# Convenience function for easy import
def get_ledewire_api(api_key: Optional[str] = None) -> LedeWireAPI:
    """
    Factory function to create LedeWire API instance.
    """
    return LedeWireAPI(api_key=api_key)