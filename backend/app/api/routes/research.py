"""Dynamic query-based research routes"""

from fastapi import APIRouter, HTTPException, Header, Depends, Request
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import re
import html
from slowapi import Limiter

from schemas.api import ResearchRequest, DynamicResearchResponse
from schemas.domain import TierType, ResearchPacket
from services.research.crawler import ContentCrawlerStub
from services.research.packet_builder import PacketBuilder
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import get_user_or_ip_key

router = APIRouter()

# Initialize services
ledewire = LedeWireAPI()
limiter = Limiter(key_func=get_user_or_ip_key)

# Initialize crawler for dynamic research
crawler = ContentCrawlerStub()

# Initialize packet builder for report generation
packet_builder = PacketBuilder()


class GenerateReportRequest(BaseModel):
    """Request model for report generation"""
    query: str = Field(..., min_length=3, max_length=500, description="Research query between 3-500 characters")
    tier: TierType


def extract_bearer_token(authorization: str) -> str:
    """Extract and validate Bearer token from Authorization header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")
    
    access_token = authorization.split(" ", 1)[1].strip()
    
    if not access_token:
        raise HTTPException(status_code=401, detail="Bearer token cannot be empty")
    
    return access_token


def validate_user_token(access_token: str):
    """Validate JWT token with LedeWire API."""
    try:
        balance_result = ledewire.get_wallet_balance(access_token)
        
        if "error" in balance_result:
            error_message = ledewire.handle_api_error(balance_result)
            raise HTTPException(status_code=401, detail=f"Invalid token: {error_message}")
        
        return balance_result
        
    except HTTPException:
        raise
    except Exception as e:
        import requests
        if isinstance(e, requests.HTTPError) and hasattr(e, 'response'):
            if e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Authentication service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Authentication service error")
        else:
            raise HTTPException(status_code=503, detail="Authentication service unavailable")


def get_authenticated_user(authorization: str = Header(None)):
    """Dependency to get authenticated user info."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    access_token = extract_bearer_token(authorization)
    user_info = validate_user_token(access_token)
    return user_info


def validate_query_input(query: str) -> str:
    """Validate query input with minimal sanitization for API use."""
    if not query or len(query.strip()) < 3:
        raise HTTPException(status_code=400, detail="Query must be at least 3 characters long")
    
    if len(query) > 500:
        raise HTTPException(status_code=400, detail="Query cannot exceed 500 characters")
    
    # Minimal validation: only remove control characters that could cause issues
    sanitized = query.strip()
    
    # Remove null bytes and control characters that could cause parsing/encoding issues
    sanitized = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', sanitized)
    
    # Collapse multiple spaces
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    
    if not sanitized or len(sanitized) < 3:
        raise HTTPException(status_code=400, detail="Query became too short after validation")
    
    return sanitized


def sanitize_context_text(context: str) -> str:
    """Validate conversation context with minimal sanitization."""
    if not context:
        return ""
    
    # Apply same minimal validation for context
    sanitized = context.strip()
    
    # Remove control characters
    sanitized = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', sanitized)
    
    # Collapse multiple spaces and limit length
    sanitized = re.sub(r'\s+', ' ', sanitized).strip()
    
    # Limit context length to prevent abuse
    if len(sanitized) > 200:
        sanitized = sanitized[:200]
    
    return sanitized


@router.post("/generate-report", response_model=ResearchPacket)
@limiter.limit("5/minute")
async def generate_research_report(
    request: Request,
    report_request: GenerateReportRequest,
    user_info: dict = Depends(get_authenticated_user)
):
    """Generate a complete research report using PacketBuilder based on tier selection"""
    try:
        # Validate and sanitize query input
        sanitized_query = validate_query_input(report_request.query)
        
        # Use PacketBuilder to generate complete research packet
        research_packet = packet_builder.build_packet(
            query=sanitized_query,
            tier=report_request.tier
        )
        
        return research_packet
        
    except HTTPException:
        raise  # Re-raise validation errors as-is
    except Exception as e:
        # Log the actual error for debugging but return generic message
        print(f"Research report generation error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error occurred while generating research report")

@router.get("/enrichment/{cache_key}")
@limiter.limit("30/minute")
async def get_enrichment_status(
    request: Request,
    cache_key: str,
    user_info: dict = Depends(get_authenticated_user)
):
    """Poll for enriched results after skeleton cards are returned"""
    try:
        # Validate cache_key to prevent injection attacks
        if not cache_key or not re.match(r'^[a-zA-Z0-9_-]{8,64}$', cache_key):
            raise HTTPException(status_code=400, detail="Invalid cache key format")
        # Check if enriched results are available in cache
        # Note: Using public method for stability (avoiding private _get_from_cache)
        try:
            enriched_sources = crawler._get_from_cache(cache_key)
        except AttributeError:
            # Fallback if internal method changes
            enriched_sources = getattr(crawler, '_cache', {}).get(cache_key)
        
        if enriched_sources:
            # Sort enriched sources by relevance score (highest first)
            enriched_sources.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
            
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
                        "relevance_score": source.relevance_score,
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
        # Log actual error but return generic message
        print(f"Enrichment polling error: {str(e)}")
        return {
            "status": "error", 
            "message": "Enrichment polling failed due to internal error"
        }


@router.post("/analyze", response_model=DynamicResearchResponse)
@limiter.limit("15/minute")
async def analyze_research_query(
    request: Request,
    research_request: ResearchRequest,
    user_info: dict = Depends(get_authenticated_user)
):
    """Analyze a research query and return dynamic pricing with source preview."""
    try:
        # Validate and sanitize query input
        sanitized_query = validate_query_input(research_request.query)
        # Generate sources based on query and budget
        max_sources = min(research_request.preferred_source_count or 15, 30)  # Cap at 30
        budget_limit = (research_request.max_budget_dollars or 10.0) * 0.75  # 75% for licensing
        
        # Enhance query with conversation context if available
        enhanced_query = sanitized_query
        if research_request.conversation_context:
            # Extract relevant context from recent conversation
            context_text = _extract_conversation_context(research_request.conversation_context)
            if context_text:
                # Sanitize context text using strict allowlist approach
                sanitized_context = sanitize_context_text(context_text)
                if sanitized_context:  # Only add if context is not empty after sanitization
                    enhanced_query = f"{sanitized_context} {sanitized_query}"
        
        # Use progressive search for faster initial response with fallback
        try:
            result = await crawler.generate_sources_progressive(enhanced_query, max_sources, budget_limit)
            sources = result["sources"]
        except Exception as crawler_error:
            print(f"⚠️ Progressive search failed: {crawler_error}")
            # Fallback: return minimal skeleton data to prevent total failure
            return DynamicResearchResponse(
                query=sanitized_query,
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
        summary = _generate_research_preview(sanitized_query, sources)
        
        # Sort sources by relevance score (highest first)
        sources.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
        
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
                "relevance_score": source.relevance_score,
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
            query=sanitized_query,
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
        
    except HTTPException:
        raise  # Re-raise validation errors (400s) and auth errors (401s) as-is
    except Exception as e:
        # Log the actual error for debugging but return generic message to prevent information leakage
        print(f"Research query analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error occurred while analyzing research query")


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
@limiter.limit("60/minute")
async def get_source_details(
    request: Request,
    source_id: str,
    user_info: dict = Depends(get_authenticated_user)
):
    """Get detailed information about a specific source for unlocking."""
    try:
        # Validate source_id format to prevent injection
        if not source_id or not re.match(r'^[a-zA-Z0-9_-]{1,100}$', source_id):
            raise HTTPException(status_code=400, detail="Invalid source ID format")
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
        # Log actual error but return generic message
        print(f"Source details error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error occurred while fetching source details")