"""Pricing and tiers routes"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any

from schemas.api import TiersRequest, TiersResponse, TierInfo, TierType
from services.research.crawler import ContentCrawlerStub

router = APIRouter()

# Initialize crawler for pricing calculations
crawler = ContentCrawlerStub()


class LicensingSummaryRequest(BaseModel):
    query: str
    tier: TierType


class LicensingSummaryResponse(BaseModel):
    query: str
    tier: TierType
    total_cost: float
    currency: str
    licensed_count: int
    unlicensed_count: int
    protocol_breakdown: Dict[str, Dict[str, Any]]


@router.post("/tiers", response_model=TiersResponse)
async def get_tiers(request: TiersRequest):
    """Get pricing tiers for a research query."""
    try:
        # Generate tier information with dynamic pricing considerations
        tiers = [
            TierInfo(
                tier=TierType.BASIC,
                price=0.00,
                sources=10,
                includes_outline=False,
                includes_insights=False,
                description="Free research with quality sources and professional analysis"
            ),
            TierInfo(
                tier=TierType.RESEARCH,
                price=0.99,
                sources=20,
                includes_outline=True,
                includes_insights=False,
                description="Craving clarity on this topic? For $0.99, we'll ethically license and distill the web's most relevant sources into a single, powerful summary."
            ),
            TierInfo(
                tier=TierType.PRO,
                price=1.99,
                sources=40,
                includes_outline=True,
                includes_insights=True,
                description="Serious about answers? Our Pro tier delivers full-spectrum research — licensed sources, competitive intelligence, and strategic framing."
            )
        ]
        
        return TiersResponse(query=request.query, tiers=tiers)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating tiers: {str(e)}")


@router.post("/licensing-summary", response_model=LicensingSummaryResponse)
async def get_licensing_summary(request: LicensingSummaryRequest):
    """Get licensing cost summary for a research query and tier."""
    try:
        # Define budget constraints: 60% for licensing, 40% for margin
        tier_configs = {
            TierType.BASIC: {"price": 0.00, "max_sources": 10},
            TierType.RESEARCH: {"price": 0.99, "max_sources": 20}, 
            TierType.PRO: {"price": 1.99, "max_sources": 40}
        }
        
        config = tier_configs[request.tier]
        budget_limit = config["price"] * 0.60  # 60% for licensing
        max_sources = config["max_sources"]
        
        # Generate sources with budget constraints
        sources = crawler.generate_sources(request.query, max_sources, budget_limit)
        
        # Calculate licensing summary
        licensed_sources = [s for s in sources if s.licensing_protocol]
        unlicensed_sources = [s for s in sources if not s.licensing_protocol]
        
        # Group by protocol and calculate totals
        protocol_breakdown = {}
        total_cost = 0.0
        
        for source in licensed_sources:
            protocol = source.licensing_protocol
            cost = source.licensing_cost or 0.0  # Handle None cost
            
            if protocol not in protocol_breakdown:
                protocol_breakdown[protocol] = {
                    "count": 0,
                    "total_cost": 0.0,
                    "sources": []
                }
            
            protocol_breakdown[protocol]["count"] += 1
            protocol_breakdown[protocol]["total_cost"] += cost
            protocol_breakdown[protocol]["sources"].append({
                "domain": source.domain,
                "cost": cost
            })
            total_cost += cost
        
        return LicensingSummaryResponse(
            query=request.query,
            tier=request.tier,
            total_cost=total_cost,
            currency="USD",
            licensed_count=len(licensed_sources),
            unlicensed_count=len(unlicensed_sources),
            protocol_breakdown=protocol_breakdown
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating licensing costs: {str(e)}")