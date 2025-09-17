import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, HTMLResponse
import uvicorn

from models import (
    TiersRequest, TiersResponse, TierInfo, TierType,
    PurchaseRequest, PurchaseResponse, 
    WalletDeductRequest, WalletDeductResponse,
    SourceUnlockRequest, SourceUnlockResponse
)
from crawler_stub import ContentCrawlerStub
from ledger import ResearchLedger
from packet_builder import PacketBuilder
from ledewire_api import LedeWireAPI
from html_generator import generate_html_packet

app = FastAPI(title="AI Research Tool MVP", version="1.0.0")

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend files
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

# Initialize components
crawler = ContentCrawlerStub()
ledger = ResearchLedger()
packet_builder = PacketBuilder()
ledewire = LedeWireAPI()  # Mock implementation - ready for real API keys

@app.get("/")
async def root():
    """Root endpoint - redirect to frontend."""
    return RedirectResponse(url="/static/index.html")

@app.post("/tiers", response_model=TiersResponse)
async def get_tiers(request: TiersRequest):
    """
    Get pricing tiers for a research query.
    Returns estimated costs and features for Basic, Research, and Pro tiers.
    """
    try:
        # Generate tier information with dynamic pricing considerations
        tiers = [
            TierInfo(
                tier=TierType.BASIC,
                price=1.00,
                sources=10,
                includes_outline=False,
                includes_insights=False,
                description="10 research sources with summary"
            ),
            TierInfo(
                tier=TierType.RESEARCH,
                price=2.00,
                sources=20,
                includes_outline=True,
                includes_insights=False,
                description="20 research sources with summary and structured outline"
            ),
            TierInfo(
                tier=TierType.PRO,
                price=4.00,
                sources=40,
                includes_outline=True,
                includes_insights=True,
                description="40 research sources with summary, outline, and strategic insights"
            )
        ]
        
        return TiersResponse(query=request.query, tiers=tiers)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating tiers: {str(e)}")

@app.post("/purchase", response_model=PurchaseResponse)
async def purchase_research(request: PurchaseRequest):
    """
    Process a research purchase request using LedeWire API.
    Handles authentication, balance check, and research packet generation.
    """
    try:
        # Get tier pricing in cents (LedeWire uses cents)
        tier_prices = {
            TierType.BASIC: 100,    # $1.00
            TierType.RESEARCH: 200, # $2.00  
            TierType.PRO: 400       # $4.00
        }
        
        price_cents = tier_prices[request.tier]
        price_dollars = price_cents / 100
        
        # Generate unique content ID for this research packet
        content_id = f"research_{uuid.uuid4().hex[:12]}"
        
        # Use LedeWire API for purchase (mock implementation for now)
        access_token = request.user_wallet_id or "mock_token"  # Will be real JWT in production
        
        # Create purchase through LedeWire
        purchase_result = ledewire.create_purchase(
            access_token=access_token,
            content_id=content_id,
            price_cents=price_cents
        )
        
        # Check for purchase errors
        if "error" in purchase_result:
            error_message = ledewire.handle_api_error(purchase_result)
            return PurchaseResponse(
                success=False,
                message=error_message,
                wallet_deduction=0.0
            )
        
        # Generate research packet with content ID
        packet = packet_builder.build_packet(request.query, request.tier)
        packet.content_id = content_id  # Add LedeWire content ID
        
        # Record the purchase in ledger
        purchase_id = ledger.record_purchase(
            query=request.query,
            tier=request.tier,
            price=price_dollars,
            wallet_id=access_token,
            transaction_id=purchase_result["id"],
            packet=packet
        )
        
        return PurchaseResponse(
            success=True,
            message=f"Research packet generated successfully (ID: {purchase_id})",
            wallet_deduction=price_dollars,
            packet=packet
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Purchase failed: {str(e)}")

@app.post("/wallet/deduct", response_model=WalletDeductResponse)
async def simulate_wallet_deduction(wallet_id: str, amount: float, description: str):
    """
    Simulate LedeWire wallet deduction.
    In production, this will call the actual LedeWire API.
    """
    # Simulate wallet logic
    mock_balance = 100.00  # Demo wallet starts with $100
    
    if amount > mock_balance:
        return WalletDeductResponse(
            success=False,
            remaining_balance=mock_balance,
            transaction_id=""
        )
    
    new_balance = mock_balance - amount
    transaction_id = f"txn_{uuid.uuid4().hex[:8]}"
    
    return WalletDeductResponse(
        success=True,
        remaining_balance=round(new_balance, 2),
        transaction_id=transaction_id
    )

@app.get("/stats")
async def get_stats():
    """Get basic usage statistics for the MVP."""
    try:
        stats = ledger.get_purchase_stats()
        return {"success": True, "stats": stats}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/unlock-source", response_model=SourceUnlockResponse)
async def unlock_source(request: SourceUnlockRequest):
    """
    Process a source unlock request using LedeWire API.
    Handles authentication and individual source purchasing.
    """
    try:
        # Convert price to cents for LedeWire API
        price_cents = int(request.price * 100)
        access_token = request.user_wallet_id or "mock_token"  # Will be real JWT in production
        
        # Generate content ID for this source
        source_content_id = f"source_{request.source_id}"
        
        # Create purchase through LedeWire
        purchase_result = ledewire.create_purchase(
            access_token=access_token,
            content_id=source_content_id,
            price_cents=price_cents
        )
        
        # Check for purchase errors
        if "error" in purchase_result:
            error_message = ledewire.handle_api_error(purchase_result)
            return SourceUnlockResponse(
                success=False,
                message=error_message,
                wallet_deduction=0.0
            )
        
        # Simulate generating unlocked content
        unlocked_content = f"""**Full Content for: {request.title}**

This is the complete content that was previously locked. In a real implementation, this would be fetched from the content crawling service.

Key insights from this source:
• Detailed analysis and findings
• Supporting evidence and data
• Expert commentary and conclusions

[Content unlocked for ${request.price:.2f}]"""
        
        return SourceUnlockResponse(
            success=True,
            message=f"Source unlocked successfully",
            wallet_deduction=request.price,
            unlocked_content=unlocked_content
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Source unlock failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "AI Research Tool MVP"}

@app.get("/research-packet/{content_id}", response_class=HTMLResponse)
async def get_research_packet_html(content_id: str):
    """
    Serve research packet as clean academic HTML report.
    This would check LedeWire purchase verification in production.
    """
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

if __name__ == "__main__":
    # For production deployment
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)