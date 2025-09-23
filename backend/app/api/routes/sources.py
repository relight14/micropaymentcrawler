"""Source unlock and research packet routes"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from slowapi import Limiter

from schemas.api import SourceUnlockRequest, SourceUnlockResponse
from data.ledger_repository import ResearchLedger
from utils.rate_limit import get_user_or_ip_key
from services.research.html_generator import generate_html_packet

router = APIRouter()

# Initialize services
ledger = ResearchLedger()


@router.get("/stats")
async def get_system_stats():
    """Get system statistics for debugging and monitoring"""
    try:
        # Basic stats for now - in production would implement proper analytics
        return {
            "total_queries": 0,
            "total_revenue_cents": 0,
            "total_revenue_display": "$0.00",
            "active_users": 0,
            "status": "operational"
        }
    except Exception as e:
        return {"error": str(e), "status": "degraded"}


@router.post("/unlock-source", response_model=SourceUnlockResponse)
# @limiter.limit("20/minute")
async def unlock_source(request: Request, unlock_request: SourceUnlockRequest):
    """Secure source unlocking with server-authoritative pricing and idempotency protection"""
    try:
        # In production, this would:
        # 1. Validate JWT token from Authorization header
        # 2. Look up source pricing from source_id (server-authoritative)
        # 3. Check idempotency_key to prevent double-charging
        # 4. Verify user's wallet balance via LedeWire API
        # 5. Process payment and request license token from appropriate protocol
        # 6. Return unlocked content with updated balance
        
        # For development, simulate secure unlock flow
        source_id = unlock_request.source_id
        idempotency_key = unlock_request.idempotency_key
        
        # Simulate server-computed pricing based on source_id
        simulated_cost = 0.15  # Would be computed from source metadata
        simulated_cost_cents = int(simulated_cost * 100)
        
        # Simulate wallet balance after deduction
        simulated_remaining_balance_cents = 50000 - simulated_cost_cents  # $500 - $0.15
        
        # Return sanitized plain text content (no HTML to prevent XSS)
        safe_content = f"Full article content for source {source_id} is now available. In production, this would be the actual licensed content retrieved through the appropriate protocol (RSL, Tollbit, or Cloudflare), properly attributed to the publisher, and formatted according to the license terms."
        
        return SourceUnlockResponse(
            success=True,
            message=f"Source unlocked successfully",
            unlocked_content=safe_content,
            remaining_balance_cents=simulated_remaining_balance_cents,
            wallet_deduction=simulated_cost
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error unlocking source: {str(e)}")


@router.get("/research-packet/{content_id}", response_class=HTMLResponse)
async def get_research_packet_html(content_id: str):
    """Serve research packet as clean academic HTML report."""
    try:
        # In production, this would verify purchase via LedeWire API
        # For now, we'll retrieve from our ledger for demo purposes
        packet_data = ledger.get_packet_by_content_id(content_id)
        
        if not packet_data:
            raise HTTPException(status_code=404, detail="Research packet not found")
        
        # Generate clean HTML report
        html_content = generate_html_packet(packet_data)
        
        return HTMLResponse(content=html_content)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving research packet: {str(e)}")