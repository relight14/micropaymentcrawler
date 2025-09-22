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
        total_queries = ledger.get_total_queries()
        total_revenue = ledger.get_total_revenue()
        active_users = ledger.get_active_users()
        
        return {
            "total_queries": total_queries,
            "total_revenue_cents": total_revenue,
            "total_revenue_display": f"${total_revenue / 100:.2f}",
            "active_users": active_users,
            "status": "operational"
        }
    except Exception as e:
        return {"error": str(e), "status": "degraded"}


@router.post("/unlock-source", response_model=SourceUnlockResponse)
# @limiter.limit("20/minute")
async def unlock_source(request: Request, unlock_request: SourceUnlockRequest):
    """Mock source unlocking for development - in production would integrate with licensing APIs"""
    try:
        # In production, this would:
        # 1. Validate user authentication
        # 2. Check user's wallet balance
        # 3. Process payment for source unlock
        # 4. Request license token from appropriate protocol (RSL, Tollbit, etc.)
        # 5. Return unlocked content
        
        # For development, return mock success
        mock_content = f"""
        <h3>Unlocked Content for: {unlock_request.source_title}</h3>
        <p><strong>Source:</strong> {unlock_request.source_url}</p>
        <p><strong>Cost:</strong> ${unlock_request.cost:.2f}</p>
        <div class="unlocked-content">
            <p>This is the full content of the licensed source. In production, this would be the actual article content retrieved through the licensing protocol.</p>
            <p>The content would include the complete article text, proper attribution, and any media assets covered by the license.</p>
        </div>
        """
        
        return SourceUnlockResponse(
            success=True,
            message=f"Source unlocked for ${unlock_request.cost:.2f}",
            unlocked_content=mock_content,
            remaining_balance=999.99  # Mock balance
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