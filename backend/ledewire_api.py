"""
LedeWire API Integration
Mock implementation that matches real API structure - easily swappable for production.
"""
import uuid
import json
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

class LedeWireAPI:
    """
    LedeWire API wrapper - Mock implementation for MVP.
    Replace API_BASE_URL and add real credentials when ready.
    """
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or "mock_api_key"
        self.api_base = "https://api.ledewire.com/v1"  # Ready for production
        self.mock_balance = 100.00  # Mock wallet balance for testing
    
    # Authentication Methods
    
    def authenticate_user(self, email: str, password: str) -> Dict[str, Any]:
        """
        POST /v1/auth/login/email
        Authenticate user and return JWT token.
        """
        # Mock authentication - replace with real API call
        return {
            "access_token": f"mock_jwt_token_{uuid.uuid4().hex[:16]}",
            "refresh_token": f"mock_refresh_token_{uuid.uuid4().hex[:16]}",
            "expires_at": (datetime.now() + timedelta(hours=2)).isoformat()
        }
    
    def signup_user(self, email: str, password: str, name: str) -> Dict[str, Any]:
        """
        POST /v1/auth/signup
        Register new user and return JWT token.
        """
        # Mock signup - replace with real API call
        return {
            "access_token": f"mock_jwt_token_{uuid.uuid4().hex[:16]}",
            "refresh_token": f"mock_refresh_token_{uuid.uuid4().hex[:16]}",
            "expires_at": (datetime.now() + timedelta(hours=2)).isoformat()
        }
    
    # Wallet Methods
    
    def get_wallet_balance(self, access_token: str) -> Dict[str, Any]:
        """
        GET /v1/wallet/balance
        Get user's current wallet balance.
        """
        # Mock balance check - replace with real API call
        return {
            "balance_cents": int(self.mock_balance * 100)  # Convert to cents
        }
    
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
        Create a new content purchase.
        """
        if not self.check_sufficient_funds(access_token, price_cents):
            return {
                "error": {
                    "code": 402,
                    "message": "Insufficient funds in wallet"
                }
            }
        
        # Mock successful purchase - replace with real API call
        purchase_id = str(uuid.uuid4())
        
        # Simulate wallet deduction
        self.mock_balance -= price_cents / 100
        
        return {
            "id": purchase_id,
            "content_id": content_id,
            "buyer_id": f"mock_buyer_{uuid.uuid4().hex[:8]}",
            "seller_id": f"mock_seller_{uuid.uuid4().hex[:8]}",
            "amount_cents": price_cents,
            "timestamp": datetime.now().isoformat(),
            "status": "completed"
        }
    
    def verify_purchase(self, access_token: str, content_id: str) -> Dict[str, Any]:
        """
        GET /v1/purchase/verify?content_id=X
        Verify if user has purchased specific content.
        """
        # Mock verification - in production, this checks actual purchase history
        return {
            "has_purchased": True,  # Always true for mock
            "purchase_details": {
                "purchase_id": f"mock_purchase_{uuid.uuid4().hex[:8]}",
                "purchase_date": datetime.now().isoformat()
            },
            "checkout_readiness": {
                "is_authenticated": True,
                "has_sufficient_funds": self.check_sufficient_funds(access_token, 100)  # $1.00 example
            }
        }
    
    # Content Access Methods
    
    def get_content_access_info(self, access_token: str, content_id: str) -> Dict[str, Any]:
        """
        GET /v1/content/{id}/with-access
        Get content access information for user.
        """
        balance = self.get_wallet_balance(access_token)
        
        return {
            "user_id": f"mock_user_{uuid.uuid4().hex[:8]}",
            "has_purchased": False,  # Default to false, check purchase history
            "has_sufficient_funds": balance["balance_cents"] >= 100,  # $1.00 minimum
            "wallet_balance_cents": balance["balance_cents"],
            "next_required_action": "purchase"  # Could be: authenticate, fund_wallet, purchase, none
        }

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