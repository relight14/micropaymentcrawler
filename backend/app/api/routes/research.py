"""Dynamic query-based research routes"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List, Optional

from schemas.api import ResearchRequest, DynamicResearchResponse
from services.research.crawler import ContentCrawlerStub

router = APIRouter()

# Initialize crawler for dynamic research
crawler = ContentCrawlerStub()


@router.post("/analyze", response_model=DynamicResearchResponse)
async def analyze_research_query(request: ResearchRequest):
    """Analyze a research query and return dynamic pricing with source preview."""
    try:
        # Generate sources based on query and budget
        max_sources = min(request.preferred_source_count or 15, 30)  # Cap at 30
        budget_limit = (request.max_budget_dollars or 10.0) * 0.75  # 75% for licensing
        
        # Use progressive search for faster initial response
        result = await crawler.generate_sources_progressive(request.query, max_sources, budget_limit)
        sources = result["sources"]
        
        # Calculate costs and create response
        total_cost = sum(source.unlock_price or 0.0 for source in sources if source.unlock_price)
        premium_sources = [s for s in sources if s.unlock_price and s.unlock_price > 0.15]
        
        # Create licensing breakdown
        licensing_breakdown = {}
        for source in sources:
            if source.licensing_protocol and source.licensing_cost:
                protocol = source.licensing_protocol
                if protocol not in licensing_breakdown:
                    licensing_breakdown[protocol] = {
                        "count": 0,
                        "total_cost": 0.0,
                        "avg_cost": 0.0
                    }
                licensing_breakdown[protocol]["count"] += 1
                licensing_breakdown[protocol]["total_cost"] += source.licensing_cost
        
        # Calculate averages
        for protocol_data in licensing_breakdown.values():
            if protocol_data["count"] > 0:
                protocol_data["avg_cost"] = protocol_data["total_cost"] / protocol_data["count"]
        
        # Generate research summary
        summary = _generate_research_preview(request.query, sources)
        
        # Convert sources to response format
        sources_response = []
        for source in sources:
            sources_response.append({
                "id": source.id,
                "title": source.title,
                "domain": source.domain,
                "excerpt": source.excerpt,
                "url": source.url,
                "unlock_price": source.unlock_price,
                "licensing_protocol": source.licensing_protocol,
                "licensing_cost": source.licensing_cost,
                "quality_score": getattr(source, 'quality_score', 0.8)
            })
        
        return DynamicResearchResponse(
            query=request.query,
            total_estimated_cost=round(total_cost, 2),
            source_count=len(sources),
            premium_source_count=len(premium_sources),
            research_summary=summary,
            sources=sources_response,
            licensing_breakdown=licensing_breakdown,
            enrichment_status=result.get("stage", "complete"),
            enrichment_needed=result.get("enrichment_needed", False)
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing research query: {str(e)}")


def _generate_research_preview(query: str, sources: List[Any]) -> str:
    """Generate a preview of what the full research package would contain."""
    academic_count = len([s for s in sources if any(domain in s.domain.lower() 
                         for domain in ['arxiv', 'nature', 'science', 'ieee', 'pubmed', 'ncbi', '.edu'])])
    tech_count = len([s for s in sources if any(domain in s.domain.lower() 
                     for domain in ['microsoft', 'google', 'ibm', 'amazon', 'openai', 'apple'])])
    
    premium_count = len([s for s in sources if s.unlock_price and s.unlock_price > 0.15])
    avg_price = sum(s.unlock_price or 0 for s in sources) / len(sources) if sources else 0
    
    return f"""**Research Preview: {query}**

This dynamic research package analyzes {len(sources)} carefully selected sources, including {academic_count} academic publications and {tech_count} industry research documents. Our AI-powered analysis identifies the most relevant and valuable sources based on your specific query.

**Source Quality Overview:**
• {premium_count} premium sources with enhanced licensing and full-text access
• Average source value: ${avg_price:.2f} (reflecting content quality and exclusivity)
• Multi-protocol licensing ensuring ethical publisher compensation
• Real-time relevance scoring and quality assessment

**What You'll Receive:**
• Comprehensive analysis synthesizing all unlocked sources
• Professional research summary with key findings
• Direct access to licensed content with proper citations
• Publisher-approved excerpts and insights
• Dynamic pricing based on actual source value and licensing costs

*This preview represents a fraction of the insights available in the full research package. Unlock sources to access complete analysis and citations.*"""


@router.get("/sources/{source_id}")
async def get_source_details(source_id: str):
    """Get detailed information about a specific source for unlocking."""
    try:
        # In a real implementation, this would fetch from a database or cache
        # For now, return a generic response structure
        return {
            "source_id": source_id,
            "status": "available",
            "unlock_price": None,  # Would be calculated dynamically
            "preview_available": True,
            "licensing_info": {
                "protocol": "unknown",
                "cost": None,
                "publisher": "unknown"
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching source details: {str(e)}")