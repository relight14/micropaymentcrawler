import uuid
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from models import (
    TiersRequest, TiersResponse, TierInfo, TierType,
    PurchaseRequest, PurchaseResponse, 
    WalletDeductRequest, WalletDeductResponse
)
from crawler_stub import ContentCrawlerStub
from ledger import ResearchLedger
from packet_builder import PacketBuilder

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

@app.get("/")
async def root():
    """Root endpoint - redirect to frontend."""
    return {"message": "AI Research Tool MVP API", "frontend": "/static/index.html"}

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
    Process a research purchase request.
    Simulates wallet deduction and generates research packet.
    """
    try:
        # Get tier pricing
        tier_prices = {
            TierType.BASIC: 1.00,
            TierType.RESEARCH: 2.00,
            TierType.PRO: 4.00
        }
        
        price = tier_prices[request.tier]
        
        # Simulate wallet deduction
        wallet_response = await simulate_wallet_deduction(
            wallet_id=request.user_wallet_id or "demo_wallet",
            amount=price,
            description=f"Research: {request.query} ({request.tier.value} tier)"
        )
        
        if not wallet_response.success:
            return PurchaseResponse(
                success=False,
                message="Insufficient wallet balance or wallet error",
                wallet_deduction=0.0
            )
        
        # Generate research packet
        packet = packet_builder.build_packet(request.query, request.tier)
        
        # Record the purchase in ledger
        purchase_id = ledger.record_purchase(
            query=request.query,
            tier=request.tier,
            price=price,
            wallet_id=request.user_wallet_id,
            transaction_id=wallet_response.transaction_id,
            packet=packet
        )
        
        return PurchaseResponse(
            success=True,
            message=f"Research packet generated successfully (ID: {purchase_id})",
            wallet_deduction=price,
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

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "AI Research Tool MVP"}

if __name__ == "__main__":
    # For production deployment
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)