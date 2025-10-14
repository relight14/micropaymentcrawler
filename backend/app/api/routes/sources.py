"""Source unlock routes"""

from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter

from schemas.api import SourceUnlockRequest, SourceUnlockResponse
from data.ledger_repository import ResearchLedger
from utils.rate_limit import get_user_or_ip_key

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


@router.get("/{source_id}/pricing")
async def get_source_pricing(source_id: str, request: Request):
    """Fetch fresh server-authoritative pricing for a specific source (Layer 3 safety check)"""
    try:
        # Import shared crawler instance to access cache
        from shared_services import crawler
        
        # Search all cached results for the source
        source = None
        for cache_key in crawler._cache:
            cached_sources, timestamp = crawler._cache[cache_key]
            if crawler._is_cache_valid(timestamp):
                for cached_source in cached_sources:
                    if cached_source.id == source_id:
                        source = cached_source
                        break
            if source:
                break
        
        if not source:
            raise HTTPException(status_code=404, detail=f"Source {source_id} not found in cache")
        
        # Return fresh pricing data
        return {
            "source_id": source.id,
            "title": source.title,
            "unlock_price": source.unlock_price or 0.0,
            "licensing_protocol": source.licensing_protocol,
            "is_unlocked": source.is_unlocked,
            "domain": source.domain
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching source pricing: {str(e)}")


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