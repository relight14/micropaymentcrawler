"""
LedeWire API Integration
Real HTTP implementation using secured credentials.
"""
import os
import uuid
import json
import logging
import requests
from requests.adapters import HTTPAdapter
import ssl
import urllib3
from urllib3.util.retry import Retry
from urllib3.util.ssl_ import create_urllib3_context
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

# Set up detailed logging for debugging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

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
        self.api_base = "https://api-staging.ledewire.com/v1"
        
        # Note: API key/secret only required for API key authentication endpoint
        # Email/password auth and other buyer flows work without API credentials
        
        # Setup HTTP session with default headers (auth added per-request as needed)
        self.session = requests.Session()
        
        # Configure retry strategy for connection issues
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
        )
        self.session.mount('https://', HTTPAdapter(max_retries=retry_strategy))
        
        # Set default headers (NO API KEY HEADERS - those are only for specific endpoints)
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
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
            # PRODUCTION: Re-raise with proper HTTP status
            if hasattr(e, 'response') and e.response is not None:
                if e.response.status_code == 401:
                    raise requests.HTTPError("Invalid credentials", response=e.response)
                elif e.response.status_code == 400:
                    raise requests.HTTPError("Invalid request", response=e.response)
                elif e.response.status_code == 404:
                    raise requests.HTTPError("Invalid email or password", response=e.response)
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
    
    def login_api_key(self, key: str, secret: Optional[str] = None) -> Dict[str, Any]:
        """
        POST /v1/auth/login/api-key
        Authenticate using API key and secret, returns JWT token.
        """
        try:
            # Send API key credentials in request body (NOT headers)
            request_body = {"key": key}
            if secret:
                request_body["secret"] = secret
                
            response = self.session.post(
                f"{self.api_base}/auth/login/api-key",
                json=request_body,
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            # PRODUCTION: Re-raise with proper HTTP status
            if hasattr(e, 'response') and e.response is not None:
                if e.response.status_code == 401:
                    raise requests.HTTPError("Invalid API key or secret", response=e.response)
                elif e.response.status_code == 400:
                    raise requests.HTTPError("Invalid API key request", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
            else:
                raise requests.HTTPError(f"LedeWire service unavailable: {str(e)}")

    def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """
        POST /v1/auth/refresh
        Refresh access token using refresh token.
        """
        from backend.utils.config import is_mock_mode
        
        # Mock mode: return mock refresh response
        if is_mock_mode():
            return {
                "access_token": "mock_access_token_" + str(uuid.uuid4())[:8],
                "refresh_token": refresh_token,  # Keep same refresh token
                "token_type": "Bearer",
                "expires_in": 3600
            }
            
        try:
            response = self.session.post(
                f"{self.api_base}/auth/refresh",
                json={"refresh_token": refresh_token},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            # PRODUCTION: Re-raise with proper HTTP status
            if hasattr(e, 'response') and e.response is not None:
                if e.response.status_code == 401:
                    raise requests.HTTPError("Invalid or expired refresh token", response=e.response)
                elif e.response.status_code == 400:
                    raise requests.HTTPError("Invalid refresh request", response=e.response)
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
        from backend.utils.config import is_mock_mode
        
        # Mock mode: return mock wallet balance
        if is_mock_mode():
            return {
                "balance_cents": 50000,  # $500.00 mock balance
                "balance_usd": 500.00,
                "currency": "USD"
            }
            
        try:
            response = self.session.get(
                f"{self.api_base}/wallet/balance",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
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
            # Log the purchase request details
            request_data = {
                "content_id": content_id,
                "price_cents": price_cents
            }
            headers = {
                "Authorization": f"Bearer {access_token[:20]}...",  # Truncate token for security
                "Idempotency-Key": idempotency_key,
                "X-Request-ID": idempotency_key
            }
            
            logger.info(f"Creating purchase - URL: {self.api_base}/purchases")
            logger.info(f"Request headers: {headers}")
            logger.info(f"Request body: {request_data}")
            
            # CRITICAL: Ensure idempotency key is sent to LedeWire for provider-side protection
            response = self.session.post(
                f"{self.api_base}/purchases",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Idempotency-Key": idempotency_key,  # MUST be sent to prevent provider double charges
                    "X-Request-ID": idempotency_key  # Backup header for redundancy
                },
                json=request_data,
                timeout=10
            )
            
            logger.info(f"Purchase response status: {response.status_code}")
            logger.info(f"Purchase response headers: {dict(response.headers)}")
            
            try:
                response_data = response.json()
                logger.info(f"Purchase response body: {response_data}")
            except:
                response_text = response.text
                logger.error(f"Purchase response (non-JSON): {response_text}")
                response_data = {"error": {"code": 500, "message": f"Invalid JSON response: {response_text}"}}
            
            response.raise_for_status()
            return response_data
        except requests.RequestException as e:
            # Log detailed error information
            logger.error(f"Purchase request failed: {str(e)}")
            
            if hasattr(e, 'response') and e.response is not None:
                logger.error(f"Error response status: {e.response.status_code}")
                logger.error(f"Error response headers: {dict(e.response.headers)}")
                try:
                    error_body = e.response.json()
                    logger.error(f"Error response body: {error_body}")
                except:
                    error_text = e.response.text
                    logger.error(f"Error response text: {error_text}")
                
                # PRODUCTION: Re-raise with proper HTTP status
                if e.response.status_code == 402:
                    raise requests.HTTPError("Insufficient funds in wallet", response=e.response)
                elif e.response.status_code == 401:
                    raise requests.HTTPError("Invalid or expired token", response=e.response)
                elif e.response.status_code == 400:
                    raise requests.HTTPError("Invalid purchase request", response=e.response)
                else:
                    raise requests.HTTPError(f"LedeWire service error: {e.response.status_code}", response=e.response)
            else:
                logger.error(f"Network error: {str(e)}")
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