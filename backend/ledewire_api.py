"""
LedeWire API Integration
Real HTTP implementation using secured credentials.
"""
import os
import uuid
import json
import requests
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

class LedeWireAPI:
    """
    LedeWire API wrapper - Production implementation with real HTTP calls.
    Uses secured environment variables for authentication.
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
        if self.api_key and self.api_secret:
            self.session.headers.update({
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-API-Key': self.api_key,
                'X-API-Secret': self.api_secret
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
                return {
                    "access_token": f"mock_jwt_token_{uuid.uuid4().hex[:16]}",
                    "refresh_token": f"mock_refresh_token_{uuid.uuid4().hex[:16]}",
                    "expires_at": (datetime.now() + timedelta(hours=2)).isoformat(),
                    "_fallback": True
                }
            else:
                # PRODUCTION: FAIL CLOSED - no free access
                raise Exception(f"LedeWire authentication failed: {str(e)}")
    
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
                return {
                    "access_token": f"mock_jwt_token_{uuid.uuid4().hex[:16]}",
                    "refresh_token": f"mock_refresh_token_{uuid.uuid4().hex[:16]}",
                    "expires_at": (datetime.now() + timedelta(hours=2)).isoformat(),
                    "_fallback": True
                }
            else:
                # PRODUCTION: FAIL CLOSED - no free access
                raise Exception(f"LedeWire signup failed: {str(e)}")
    
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
                # PRODUCTION: FAIL CLOSED - no free money!
                raise Exception(f"LedeWire wallet balance check failed: {str(e)}")
    
    def check_sufficient_funds(self, access_token: str, amount_cents: int) -> bool:
        """
        Helper method to check if user has sufficient funds.
        """
        balance = self.get_wallet_balance(access_token)
        return balance["balance_cents"] >= amount_cents
    
    # Purchase Methods
    
    def create_purchase(self, access_token: str, content_id: str, price_cents: int) -> Dict[str, Any]:
        """
        POST /v1/purchases
        Create a new content purchase with idempotency.
        """
        # Add idempotency key for safe retries
        idempotency_key = str(uuid.uuid4())
        
        try:
            response = self.session.post(
                f"{self.api_base}/purchases",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Idempotency-Key": idempotency_key
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
                # PRODUCTION: FAIL CLOSED - no free purchases!
                raise Exception(f"LedeWire purchase failed: {str(e)}")
    
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
                # PRODUCTION: FAIL CLOSED - no free access verification!
                raise Exception(f"LedeWire purchase verification failed: {str(e)}")
    
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
                # PRODUCTION: FAIL CLOSED - no free content access info!
                raise Exception(f"LedeWire content access check failed: {str(e)}")

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