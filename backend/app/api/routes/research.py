"""Dynamic query-based research routes"""

from fastapi import APIRouter, HTTPException, Header, Depends, Request
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import re
import html
import os
import anthropic

from schemas.api import ResearchRequest, DynamicResearchResponse
from schemas.domain import TierType, ResearchPacket
from services.research.crawler import ContentCrawlerStub
from services.ai.report_generator import ReportGeneratorService
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter

router = APIRouter()

# Initialize services
ledewire = LedeWireAPI()

# Initialize crawler for dynamic research
crawler = ContentCrawlerStub()

# Initialize report generator for AI reports
report_generator = ReportGeneratorService()

# Initialize Anthropic client for context-aware query refinement
claude_client = anthropic.Anthropic(
    api_key=os.environ.get('ANTHROPIC_API_KEY')
)


class GenerateReportRequest(BaseModel):
    """Request model for report generation"""
    query: str = Field(..., min_length=3, max_length=500, description="Research query between 3-500 characters")
    tier: TierType
    selected_source_ids: Optional[List[str]] = None  # User's selected sources for report


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


def _extract_response_text(response) -> str:
    """Safely extract text from Anthropic response (handles SDK dict/object formats)."""
    try:
        if hasattr(response, 'content') and response.content and len(response.content) > 0:
            # Handle both dict and object formats from Anthropic SDK
            content_block = response.content[0]
            
            # Try dict access first (common SDK format)
            if isinstance(content_block, dict):
                if content_block.get('type') == 'text' and 'text' in content_block:
                    return content_block['text']
            
            # Try object attribute access
            if hasattr(content_block, 'text'):
                return content_block.text
            
            # Fallback: stringify
            return str(content_block)
        else:
            return str(response)
    except Exception as e:
        print(f"⚠️ Error extracting response text: {e}")
        return str(response)


def _detect_publication_constraint(query: str) -> Optional[Dict[str, str]]:
    """Detect if user specified a publication constraint in their query.
    
    Returns dict with:
    - type: "domain_filter" (Tier 1) or "keyword_boost" (Tier 2)
    - value: domain string or publication name
    - original_query: query with publication name removed
    
    Tier 1: Major publications → exact domain filtering (include_domains)
    Tier 2: Other publications → keyword boosting (add to search query)
    """
    # Tier 1: Hardcoded major publication patterns (use exact domain filtering)
    publication_patterns = {
        r'\b(ny times|nyt|new york times)\b': 'nytimes.com',
        r'\b(washington post|wapo|wash post)\b': 'washingtonpost.com',
        r'\b(wall street journal|wsj)\b': 'wsj.com',
        r'\b(bloomberg)\b': 'bloomberg.com',
        r'\b(reuters)\b': 'reuters.com',
        r'\b(guardian)\b': 'theguardian.com',
        r'\b(bbc)\b': 'bbc.com',
        r'\b(cnn)\b': 'cnn.com',
        r'\b(forbes)\b': 'forbes.com',
        r'\b(time magazine|time)\b': 'time.com',
        r'\b(atlantic)\b': 'theatlantic.com',
        r'\b(economist)\b': 'economist.com',
    }
    
    query_lower = query.lower()
    
    # Try Tier 1: Hardcoded patterns (exact domain filtering)
    for pattern, domain in publication_patterns.items():
        match = re.search(pattern, query_lower, re.IGNORECASE)
        if match:
            # Remove publication name from query to get clean topic
            clean_query = re.sub(pattern, '', query, flags=re.IGNORECASE).strip()
            clean_query = re.sub(r'\b(on|about|regarding|covering)\b', '', clean_query, flags=re.IGNORECASE).strip()
            print(f"📰 Tier 1 - Major publication detected: {domain}")
            return {
                "type": "domain_filter",
                "value": domain,
                "original_query": clean_query
            }
    
    # Tier 2: Generic pattern detection "[Publication] on/about [Topic]"
    # Use simple keyword boosting instead of domain filtering
    generic_pattern = r'^([A-Za-z\s]+?)\s+(?:on|about|regarding|covering)\s+(.+)$'
    match = re.match(generic_pattern, query.strip(), re.IGNORECASE)
    
    if match:
        publication_name = match.group(1).strip()
        topic = match.group(2).strip()
        
        # Blacklist: Skip if publication name starts with generic research terms
        generic_terms = [
            'research', 'studies', 'articles', 'papers', 'reports', 'analysis', 
            'information', 'data', 'findings', 'evidence', 'insights',
            'content', 'material', 'sources', 'documents'
        ]
        
        first_word = publication_name.lower().split()[0] if publication_name else ""
        if first_word in generic_terms:
            print(f"📰 Tier 2 - Skipped generic term: '{publication_name}'")
            return None
        
        # Valid publication name detected - use keyword boosting
        if len(publication_name) >= 3:
            print(f"📰 Tier 2 - Publication keyword boost: '{publication_name}' for topic '{topic}'")
            return {
                "type": "keyword_boost",
                "value": publication_name,
                "original_query": topic
            }
    
    # No publication detected
    return None

def _refine_query_with_context(conversation_context: List[Dict], user_query: str) -> str:
    """Use Claude to intelligently synthesize conversation context into a refined research query.
    
    Note: Publication constraint detection happens in the parent function, not here.
    This function only focuses on context synthesis.
    """
    try:
        # Extract recent messages from conversation context (include all messages, even short ones)
        context_messages = []
        for msg in conversation_context[-8:]:  # Last 8 messages for context
            sender = msg.get('sender', 'unknown')
            content = msg.get('content', '').strip()
            
            # Include all messages with any content (removed length filter to avoid skipping)
            if content:
                role = "user" if sender == "user" else "assistant"
                # Sanitize and limit message length
                sanitized_content = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', content)
                context_messages.append(f"{role}: {sanitized_content[:200]}")
        
        if not context_messages:
            print("⚠️ No conversation context available, using original query")
            return user_query  # No context to use
        
        context_text = "\n".join(context_messages)
        
        # Build prompt for Claude to synthesize context
        system_prompt = f"""You are an expert research analyst. Based on this conversation history:

{context_text}

The user is now requesting research. Your task is to:
1. Generate a comprehensive research query that captures their specific interests from the conversation
2. Create search terms that will find the most valuable and relevant sources
3. Focus on the key themes and questions that emerged in the conversation
4. **CRITICAL**: If the user specifies a publication or source (e.g., "NY Times", "Washington Post", "Bloomberg", "Reuters"), you MUST preserve this requirement and include a domain constraint

Be specific and targeted based on the conversation. Don't be generic.

Publication Detection Examples:
- "ny times on climate" → "climate change site:nytimes.com"
- "washington post about elections" → "elections site:washingtonpost.com" 
- "bloomberg on markets" → "financial markets site:bloomberg.com"
- "reuters nuclear" → "nuclear power site:reuters.com"

If a publication is mentioned, always include the "site:" operator in your refined query."""
        
        # Call Claude to refine the query
        response = claude_client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=300,
            temperature=0.3,
            system=system_prompt,
            messages=[{"role": "user", "content": f"Generate a targeted research query for: {user_query}"}]
        )
        
        refined_query = _extract_response_text(response).strip()
        
        # Validate refined query
        if not refined_query or len(refined_query) < 10:
            print(f"⚠️ Refinement produced invalid query (too short or empty), using original: '{user_query}'")
            return user_query
        
        print(f"✅ Query refined from '{user_query}' to '{refined_query}'")
        return refined_query
        
    except Exception as e:
        print(f"❌ Query refinement FAILED with error: {type(e).__name__}: {str(e)}")
        print(f"   Falling back to original query: '{user_query}'")
        return user_query


@router.post("/generate-report", response_model=ResearchPacket)
@limiter.limit("5/minute")
async def generate_research_report(
    request: Request,
    report_request: GenerateReportRequest,
    user_info: dict = Depends(get_authenticated_user)
):
    """Generate a complete research report based on selected sources or query"""
    try:
        # Validate and sanitize query input
        sanitized_query = validate_query_input(report_request.query)
        
        # If user selected specific sources, use those for the report
        if report_request.selected_source_ids:
            print(f"📊 Generating report with {len(report_request.selected_source_ids)} selected sources")
            
            # Fetch selected sources from the latest research results
            # Sources are stored in crawler cache or need to be retrieved
            selected_sources = []
            
            # Try to find sources in cache by checking all cached results
            for cache_key, (cached_sources, timestamp) in crawler._cache.items():
                if isinstance(cached_sources, list):
                    for source in cached_sources:
                        if source.id in report_request.selected_source_ids:
                            selected_sources.append(source)
            
            if not selected_sources:
                raise HTTPException(
                    status_code=400, 
                    detail="Selected sources not found. Please run a search first before generating a report."
                )
            
            # Generate AI report with selected sources
            ai_report, citation_metadata = report_generator.generate_report(
                sanitized_query, 
                selected_sources, 
                report_request.tier
            )
            
            # Build packet directly with AI report (no packet_builder needed)
            research_packet = ResearchPacket(
                query=sanitized_query,
                tier=report_request.tier,
                summary=ai_report,  # Full AI report with integrated outline
                outline=None,  # Integrated into summary
                insights=None,  # Pro tier insights are part of summary
                sources=selected_sources,
                total_sources=len(selected_sources),
                citation_metadata=citation_metadata
            )
            
        else:
            # No sources selected - generate sources and report (legacy behavior)
            print(f"📊 Generating report without selected sources (legacy mode)")
            
            # Generate sources based on tier
            tier_source_limits = {
                TierType.BASIC: 10,
                TierType.RESEARCH: 20,
                TierType.PRO: 40
            }
            max_sources = tier_source_limits.get(report_request.tier, 15)
            
            # Generate sources
            generated_sources = await crawler.generate_sources(sanitized_query, max_sources)
            
            # Generate AI report
            ai_report, citation_metadata = report_generator.generate_report(
                sanitized_query,
                generated_sources,
                report_request.tier
            )
            
            # Build packet directly
            research_packet = ResearchPacket(
                query=sanitized_query,
                tier=report_request.tier,
                summary=ai_report,
                outline=None,
                insights=None,
                sources=generated_sources,
                total_sources=len(generated_sources),
                citation_metadata=citation_metadata
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
        if not cache_key or not re.match(r'^[a-zA-Z0-9_:.\-]{8,64}$', cache_key):
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
        
        # CRITICAL: Detect publication constraints BEFORE any processing
        publication_info = _detect_publication_constraint(sanitized_query)
        
        # Determine base query for context refinement
        base_query = sanitized_query
        if publication_info:
            # Use the clean topic query (without publication name) for refinement
            base_query = publication_info["original_query"]
        
        # Enhance query with conversation context if available
        enhanced_query = base_query
        if research_request.conversation_context and len(research_request.conversation_context) > 0:
            # Use Claude to intelligently synthesize conversation context into refined query
            enhanced_query = _refine_query_with_context(
                research_request.conversation_context,
                base_query
            )
        
        # Apply publication constraint based on type
        final_query = enhanced_query
        domain_filter = None
        
        if publication_info:
            if publication_info["type"] == "domain_filter":
                # Tier 1: Use exact domain filtering
                domain_filter = [publication_info["value"]]
                print(f"📰 Using domain filter: {domain_filter}")
            elif publication_info["type"] == "keyword_boost":
                # Tier 2: Boost publication name as keyword
                final_query = f'"{publication_info["value"]}" {enhanced_query}'
                print(f"📰 Boosting keyword: {publication_info['value']}")
        
        # Use progressive search for faster initial response with fallback
        try:
            result = await crawler.generate_sources_progressive(final_query, max_sources, budget_limit, domain_filter=domain_filter)
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
    
    # Debug logging
    print(f"🔍 Research route extracting context from {len(conversation_history)} messages")
    
    # Get recent messages from both user and assistant for richer context
    recent_context = []
    for message in conversation_history[-8:]:  # Last 8 messages for more context
        sender = message.get('sender', '')
        content = message.get('content', '').strip()
        
        # Include both user and assistant messages
        if sender in ['user', 'assistant'] and len(content) > 10:
            recent_context.append(content)
    
    print(f"📝 Found {len(recent_context)} meaningful messages for context")
    
    if recent_context:
        # De-duplicate similar content to avoid repetition
        seen = set()
        unique_context = []
        for content in recent_context[-5:]:  # Last 5 meaningful messages
            content_clean = content.strip().lower()
            # Avoid exact duplicates and very similar content
            if content_clean not in seen and len(content_clean) > 10:
                unique_context.append(content[:200])  # Truncate very long messages
                seen.add(content_clean)
        
        if unique_context:
            # Create more natural context without repetitive joining
            context_summary = " ".join(unique_context)
            print(f"✅ Generated context summary: {context_summary[:100]}...")
            return f"Context from conversation about: {context_summary}"
    
    print("⚠️ No meaningful context found")
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