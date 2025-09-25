"""Dynamic query-based research routes"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List, Optional

from schemas.api import ResearchRequest, DynamicResearchResponse
from services.research.crawler import ContentCrawlerStub

router = APIRouter()

# Initialize crawler for dynamic research
crawler = ContentCrawlerStub()

@router.get("/enrichment/{cache_key}")
async def get_enrichment_status(cache_key: str):
    """Poll for enriched results after skeleton cards are returned"""
    try:
        # Check if enriched results are available in cache
        # Note: Using public method for stability (avoiding private _get_from_cache)
        try:
            enriched_sources = crawler._get_from_cache(cache_key)
        except AttributeError:
            # Fallback if internal method changes
            enriched_sources = getattr(crawler, '_cache', {}).get(cache_key)
        
        if enriched_sources:
            return {
                "status": "ready",
                "sources": [
                    {
                        "id": source.id,
                        "title": source.title,
                        "excerpt": source.excerpt,
                        "domain": source.domain,
                        "url": source.url,
                        "unlock_price": source.unlock_price,
                        "licensing_protocol": source.licensing_protocol,
                        "licensing_cost": source.licensing_cost,
                        "enrichment_status": "complete"
                    } for source in enriched_sources
                ]
            }
        else:
            return {
                "status": "processing",
                "message": "Enrichment in progress..."
            }
    except Exception as e:
        return {
            "status": "error", 
            "message": f"Enrichment failed: {str(e)}"
        }


@router.post("/analyze", response_model=DynamicResearchResponse)
async def analyze_research_query(request: ResearchRequest):
    """Analyze a research query and return dynamic pricing with source preview."""
    try:
        # Generate sources based on query and budget
        max_sources = min(request.preferred_source_count or 15, 30)  # Cap at 30
        budget_limit = (request.max_budget_dollars or 10.0) * 0.75  # 75% for licensing
        
        # Enhance query with conversation context if available
        enhanced_query = request.query
        if request.conversation_context:
            # Extract relevant context from recent conversation
            context_text = _extract_conversation_context(request.conversation_context)
            if context_text:
                enhanced_query = f"{context_text} {request.query}"
        
        # Use progressive search for faster initial response with fallback
        try:
            result = await crawler.generate_sources_progressive(enhanced_query, max_sources, budget_limit)
            sources = result["sources"]
        except Exception as crawler_error:
            print(f"⚠️ Progressive search failed: {crawler_error}")
            # Fallback: return minimal skeleton data to prevent total failure
            return DynamicResearchResponse(
                query=request.query,
                total_estimated_cost=0.0,
                source_count=0,
                premium_source_count=0,
                research_summary="Research temporarily unavailable. Please try again.",
                sources=[],
                licensing_breakdown={},
                enrichment_status="failed",
                enrichment_needed=False
            )
        
        # Calculate costs and create response
        total_cost = sum(source.unlock_price or 0.0 for source in sources if source.unlock_price)
        premium_sources = [s for s in sources if s.unlock_price and s.unlock_price > 0.15]
        
        # Create licensing breakdown with None-safe handling
        licensing_breakdown = {}
        for source in sources:
            if source.licensing_protocol and source.licensing_cost is not None:
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
        
        # Generate research summary (currently sync, but may need async if AI-enhanced)
        # TODO: Consider async if adding GPT-assisted summaries or complex processing
        summary = _generate_research_preview(request.query, sources)
        
        # Convert sources to response format
        sources_response = []
        for source in sources:
            # Format licensing data for frontend compatibility
            licensing = None
            if source.licensing_protocol:
                licensing = {
                    "protocol": source.licensing_protocol.lower(),
                    "cost": source.licensing_cost if source.licensing_cost is not None else 0.0,
                    "publisher": getattr(source, 'publisher_name', None),
                    "license_type": getattr(source, 'license_type', 'ai-include')
                }
            
            sources_response.append({
                "id": source.id,
                "title": source.title,
                "domain": source.domain,
                "excerpt": source.excerpt,
                "url": source.url,
                "unlock_price": source.unlock_price,
                "licensing_protocol": source.licensing_protocol,  # Keep for backward compatibility
                "licensing_cost": source.licensing_cost,
                "licensing": licensing,  # New format for frontend
                "quality_score": getattr(source, 'quality_score', 0.8)
            })
        
        # Create response with progressive flow information
        response = DynamicResearchResponse(
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
        
        # Add progressive flow fields to response
        if result.get("stage"):
            response.stage = result["stage"]
        if result.get("cache_key"):
            response.cache_key = result["cache_key"]
        if result.get("timestamp"):
            response.timestamp = result["timestamp"]
            
        return response
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing research query: {str(e)}")


def _extract_conversation_context(conversation_history: List[Dict[str, str]]) -> str:
    """Extract relevant context from conversation history for research enhancement."""
    if not conversation_history or len(conversation_history) == 0:
        return ""
    
    # Get recent user messages to understand the context
    recent_context = []
    for message in conversation_history[-6:]:  # Last 6 messages for context
        if message.get('sender') == 'user' and message.get('content'):
            content = message['content'].strip()
            if len(content) > 10:  # Meaningful content
                recent_context.append(content)
    
    if recent_context:
        # Join recent user messages to provide context
        context = " ".join(recent_context[-3:])  # Last 3 user messages
        return f"Context from conversation about: {context}."
    
    return ""


def _generate_research_preview(query: str, sources: List[Any]) -> str:
    """Generate a preview of what the full research package would contain."""
    # Defensive handling for empty or malformed sources
    if not sources or len(sources) == 0:
        return f"**Research Preview: {query}**\n\nNo sources found for this query. Please try a different search term or adjust your budget."
    
    try:
        academic_count = len([s for s in sources if hasattr(s, 'domain') and s.domain and
                             any(domain in s.domain.lower() for domain in ['arxiv', 'nature', 'science', 'ieee', 'pubmed', 'ncbi', '.edu'])])
        licensed_count = len([s for s in sources if hasattr(s, 'unlock_price') and s.unlock_price and s.unlock_price > 0])
        unlicensed_count = len(sources) - licensed_count
        
        # Count industry analysis and trusted reports
        industry_count = len([s for s in sources if hasattr(s, 'domain') and s.domain and
                             any(domain in s.domain.lower() for domain in ['industry', 'market', 'report', 'insights', 'research', 'news', 'tech'])])
        
    except Exception as e:
        # Fallback for any unexpected data structure issues
        academic_count = licensed_count = unlicensed_count = industry_count = 0
    
    return f"""**Research Preview: {query}**

We've pulled together {len(sources)} high-quality sources matched to your query ({licensed_count} licensed, {unlicensed_count} unlicensed) including {academic_count} academic papers, {industry_count} industry analysis, and trusted reports. Each card below includes a quote, summary, and licensing details if available.

Tap to preview. Unlock what matters."""


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