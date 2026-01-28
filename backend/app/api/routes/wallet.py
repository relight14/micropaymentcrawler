"""Wallet routes for payment and funding operations"""

from fastapi import APIRouter, Depends, HTTPException, Header
import requests

from integrations.ledewire import LedeWireAPI
from schemas.api import PaymentSessionRequest, PaymentSessionResponse, PaymentStatusResponse
from middleware.auth_dependencies import get_current_token

router = APIRouter()

# Initialize LedeWire API integration
ledewire = LedeWireAPI()


# Auth helper functions removed - now using centralized auth_dependencies module


@router.post("/payment-session", response_model=PaymentSessionResponse)
async def create_payment_session(
    request: PaymentSessionRequest,
    token: str = Depends(get_current_token)
):
    """Create a Stripe payment session for wallet funding via LedeWire"""
    try:
        
        # Call LedeWire to create payment session
        payment_session = ledewire.create_payment_session(
            access_token=token,
            amount_cents=request.amount_cents,
            currency=request.currency
        )
        
        if "error" in payment_session:
            error_message = ledewire.handle_api_error(payment_session)
            raise HTTPException(status_code=400, detail=f"Payment session failed: {error_message}")
        
        return PaymentSessionResponse(
            client_secret=payment_session["client_secret"],
            session_id=payment_session["session_id"],
            public_key=payment_session["public_key"]
        )
        
    except HTTPException:
        raise
    except requests.exceptions.HTTPError as e:
        if "Invalid or expired token" in str(e):
            raise HTTPException(status_code=401, detail="Authentication expired")
        print(f"Payment session error: {e}")
        raise HTTPException(status_code=503, detail="Payment service temporarily unavailable")
    except Exception as e:
        print(f"Payment session error: {e}")
        raise HTTPException(status_code=500, detail="Payment service error")


@router.get("/payment-status/{session_id}", response_model=PaymentStatusResponse)
async def get_payment_status(
    session_id: str,
    token: str = Depends(get_current_token)
):
    """Poll for payment completion status after Stripe payment"""
    try:
        
        # Call LedeWire to check payment status
        status_result = ledewire.get_payment_status(
            access_token=token,
            session_id=session_id
        )
        
        if "error" in status_result:
            error_message = ledewire.handle_api_error(status_result)
            return PaymentStatusResponse(
                status="failed",
                balance_cents=None,
                message=f"Payment status check failed: {error_message}"
            )
        
        status = status_result.get("status", "pending")
        balance_cents = status_result.get("balance_cents")
        
        # Map status to user-friendly messages
        status_messages = {
            "pending": "Payment is being processed...",
            "completed": "Payment successful! Your wallet has been funded.",
            "failed": "Payment failed. Please try again.",
            "not_found": "Payment session not found."
        }
        
        return PaymentStatusResponse(
            status=status,
            balance_cents=balance_cents,
            message=status_messages.get(status, "Unknown payment status")
        )
        
    except HTTPException:
        raise
    except requests.exceptions.HTTPError as e:
        if "Invalid or expired token" in str(e):
            raise HTTPException(status_code=401, detail="Authentication expired")
        print(f"Payment status error: {e}")
        raise HTTPException(status_code=503, detail="Payment service temporarily unavailable")
    except Exception as e:
        print(f"Payment status error: {e}")
        raise HTTPException(status_code=500, detail="Payment service error")
