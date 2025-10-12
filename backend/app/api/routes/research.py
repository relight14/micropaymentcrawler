"""Dynamic query-based research routes"""

from fastapi import APIRouter, HTTPException, Header, Depends, Request
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import re
import html
import os
import anthropic
import logging
from datetime import datetime, timedelta

# Setup structured logging
logger = logging.getLogger(__name__)

from schemas.api import ResearchRequest, DynamicResearchResponse
from schemas.domain import TierType, ResearchPacket, SourceCard
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
        logger.warning(f"Error extracting response text: {e}")
        return str(response)


# ============================================================================
# NEW: Research Brief Extraction System
# ============================================================================

def _extract_timeframe(text: str, output_bias: str = 'general') -> str:
    """Detect temporal bucket from conversation text."""
    
    # T0 signals (last 24h)
    t0_patterns = [
        r'\btoday\b', r'\bthis morning\b', r'\bthis afternoon\b', 
        r'\bjust announced\b', r'\bbreaking\b', r'\bcurrent\b',
        r'\brecent\b', r'\blast (few )?hours?\b', r'\bnow\b'
    ]
    
    # T1 signals (last 3 days)
    t1_patterns = [
        r'\byesterday\b', r'\bthis week\b', r'\brecently\b',
        r'\blast (few )?days?\b', r'\bpast (few )?days?\b'
    ]
    
    # T7 signals (last 7 days)
    t7_patterns = [
        r'\bpast week\b', r'\blast week\b', r'\bthis month\b'
    ]
    
    # TH signals (historical)
    th_patterns = [
        r'\bhistory of\b', r'\bhistorical\b', r'\bover the years\b',
        r'\bsince \d{4}\b', r'\bbackground\b', r'\bevolution of\b',
        r'\blast (year|decade)\b', r'\bpast (year|decade)\b'
    ]
    
    # Check patterns in order (most recent first)
    for pattern in t0_patterns:
        if re.search(pattern, text):
            return "T0"  # 24 hours
    
    for pattern in t1_patterns:
        if re.search(pattern, text):
            return "T1"  # 3 days
    
    for pattern in t7_patterns:
        if re.search(pattern, text):
            return "T7"  # 7 days
    
    for pattern in th_patterns:
        if re.search(pattern, text):
            return "TH"  # Historical
    
    # Default based on output bias (academic gets T7, others get T1)
    if output_bias == "academic":
        return "T7"
    return "T1"


def _extract_entities(text: str) -> List[str]:
    """Extract key entities (places, organizations, people)."""
    entities = []
    
    # Common entities to look for (expandable)
    entity_patterns = {
        # Gaza/Israel related
        r'\b(gaza|israel|hamas|egypt|qatar|un|united nations)\b': ['Gaza', 'Israel', 'Hamas', 'Egypt', 'Qatar', 'UN'],
        
        # Organizations
        r'\b(fed|federal reserve|ecb|imf|world bank)\b': ['Federal Reserve', 'ECB', 'IMF', 'World Bank'],
        
        # Countries
        r'\b(china|russia|ukraine|iran|us|usa|united states)\b': ['China', 'Russia', 'Ukraine', 'Iran', 'United States'],
        
        # Tech companies
        r'\b(openai|anthropic|google|meta|microsoft|apple)\b': ['OpenAI', 'Anthropic', 'Google', 'Meta', 'Microsoft', 'Apple']
    }
    
    for pattern, entity_list in entity_patterns.items():
        if re.search(pattern, text):
            entities.extend(entity_list)
    
    # Remove duplicates, keep order
    seen = set()
    unique_entities = []
    for e in entities:
        if e not in seen:
            seen.add(e)
            unique_entities.append(e)
    
    return unique_entities[:5]  # Top 5 most relevant


def _extract_topic(query: str, context: str) -> str:
    """Extract main topic - use query as primary, context for refinement."""
    
    # Start with the query itself
    topic = query.strip()
    
    # If query is very short or generic ("ok let's find..."), look in context
    if len(topic) < 20 and context:
        # Find last question or substantive noun phrase
        sentences = re.split(r'[.?!]', context)
        for sent in reversed(sentences[-5:]):
            # Look for sentence with actual content (nouns > 3 words)
            if len(sent.split()) > 3 and re.search(r'\b(deal|peace|treaty|policy|market|research|analysis|impact|study)\b', sent):
                topic = sent.strip()
                break
    
    # Clean up temporal/action words to get core topic
    topic = re.sub(r'\b(let\'s|please|can you|i want to|find|search for|dig into)\b', '', topic, flags=re.IGNORECASE)
    topic = topic.strip()
    
    return topic[:150]  # Max 150 chars


def _detect_subtasks(text: str) -> List[str]:
    """Detect what aspects user wants to explore."""
    subtasks = []
    
    if re.search(r'\b(terms?|details?|specifics?|what.{0,20}agreed)\b', text):
        subtasks.append("terms_and_details")
    
    if re.search(r'\b(who|parties|actors|stakeholders?|supporters?|opponents?)\b', text):
        subtasks.append("actors_and_stakeholders")
    
    if re.search(r'\b(impact|consequences?|effects?|implications?)\b', text):
        subtasks.append("impact_analysis")
    
    if re.search(r'\b(prospects?|future|lasting|sustain|likelihood|chances?)\b', text):
        subtasks.append("future_outlook")
    
    if re.search(r'\b(background|context|history|lead.{0,10}up)\b', text):
        subtasks.append("background_context")
    
    return subtasks


def _detect_output_bias(text: str) -> str:
    """Detect preferred source type."""
    
    # News signals
    if re.search(r'\b(news|stories|reporting|coverage|articles?|breaking)\b', text):
        return "news"
    
    # Academic signals
    if re.search(r'\b(research|study|studies|academic|papers?|scholarly)\b', text):
        return "academic"
    
    # Business signals
    if re.search(r'\b(business|market|economic|financial|industry)\b', text):
        return "business"
    
    # Policy/analysis signals
    if re.search(r'\b(policy|analysis|think tank|assessment|strategic)\b', text):
        return "policy"
    
    # Data signals
    if re.search(r'\b(data|statistics|numbers|figures|metrics)\b', text):
        return "data"
    
    return "general"


def _build_research_brief(conversation_context: List[Dict], user_query: str) -> Dict[str, Any]:
    """
    Extract structured research brief from conversation + current query.
    Returns: {topic, entities, timeframe, subtasks, output_bias}
    """
    
    # Combine recent conversation for context (last 6 messages)
    context_text = ""
    if conversation_context:
        for msg in conversation_context[-6:]:
            content = msg.get('content', '').strip()
            if len(content) > 10:
                context_text += content + " "
    
    # Add current query
    full_text = (context_text + user_query).lower()
    
    # Extract output bias first (needed for temporal defaults)
    output_bias = _detect_output_bias(full_text)
    
    # Extract components
    timeframe = _extract_timeframe(full_text, output_bias)
    entities = _extract_entities(full_text)
    topic = _extract_topic(user_query, context_text)
    subtasks = _detect_subtasks(full_text)
    
    brief = {
        "topic": topic,
        "entities": entities,
        "timeframe": timeframe,
        "subtasks": subtasks,
        "output_bias": output_bias,
        "raw_query": user_query
    }
    
    logger.info("📋 Research Brief extracted", extra={
        "topic": topic[:50],
        "timeframe": timeframe,
        "output_bias": output_bias,
        "entity_count": len(entities)
    })
    
    return brief


def _classify_intent_and_temporal(brief: Dict[str, Any]) -> Dict[str, str]:
    """
    Classify research intent and temporal bucket.
    Returns: {intent, temporal_bucket, rails, rail_weights, recency_weight}
    """
    
    timeframe = brief["timeframe"]
    output_bias = brief["output_bias"]
    subtasks = brief["subtasks"]
    
    # ===== INTENT CLASSIFICATION =====
    
    # News Event: Breaking news, current events, recent developments
    if timeframe in ["T0", "T1"] and output_bias in ["news", "general"]:
        intent = "news_event"
    
    # Policy Analysis: Think tank analysis, strategic assessment
    elif output_bias == "policy" or "future_outlook" in subtasks:
        intent = "policy_analysis"
    
    # Academic/Causal: Research, studies, deep understanding
    elif output_bias == "academic" or "background_context" in subtasks:
        intent = "academic_causal"
    
    # Historical: Background, evolution over time
    elif timeframe == "TH":
        intent = "historical_explainer"
    
    # Business Trends: Market analysis, economic impact
    elif output_bias == "business":
        intent = "business_trends"
    
    # Data/Stats: Numbers, metrics, datasets
    elif output_bias == "data":
        intent = "data_statistics"
    
    else:
        intent = "general_research"
    
    # ===== RAIL ALLOCATION (Budget split) =====
    
    rail_config = {
        "news_event": {
            "rails": ["news", "policy"],
            "weights": [0.70, 0.30],
            "recency_weight": 0.50
        },
        "policy_analysis": {
            "rails": ["policy", "news", "academic"],
            "weights": [0.50, 0.30, 0.20],
            "recency_weight": 0.25
        },
        "academic_causal": {
            "rails": ["academic", "policy"],
            "weights": [0.70, 0.30],
            "recency_weight": 0.10
        },
        "historical_explainer": {
            "rails": ["academic", "policy", "news"],
            "weights": [0.50, 0.30, 0.20],
            "recency_weight": 0.05
        },
        "business_trends": {
            "rails": ["news", "business"],
            "weights": [0.60, 0.40],
            "recency_weight": 0.35
        },
        "data_statistics": {
            "rails": ["data", "academic"],
            "weights": [0.60, 0.40],
            "recency_weight": 0.15
        },
        "general_research": {
            "rails": ["news", "policy", "academic"],
            "weights": [0.40, 0.35, 0.25],
            "recency_weight": 0.30
        }
    }
    
    config = rail_config.get(intent, rail_config["general_research"])
    
    result = {
        "intent": intent,
        "temporal_bucket": timeframe,
        "rails": config["rails"],
        "rail_weights": config["weights"],
        "recency_weight": config["recency_weight"]
    }
    
    logger.info("🎯 Classification complete", extra={
        "intent": intent,
        "temporal": timeframe,
        "recency_weight": config["recency_weight"]
    })
    
    return result


def _build_query_with_brief(brief: Dict[str, Any], classification: Dict[str, Any]) -> str:
    """Build targeted Tavily query from research brief."""
    
    topic = brief["topic"]
    entities = brief["entities"]
    timeframe = brief["timeframe"]
    
    # Start with core topic
    query_parts = [topic]
    
    # Add entities for precision
    if entities:
        query_parts.extend(entities[:3])  # Top 3 entities
    
    # Add temporal keywords based on bucket
    temporal_keywords = {
        "T0": ["today", "current", "latest", "breaking", "announced"],
        "T1": ["recent", "this week", "latest developments"],
        "T7": ["recent weeks", "current situation"],
        "TH": ["history", "background", "evolution", "context"]
    }
    
    if timeframe in temporal_keywords:
        # Add one temporal keyword
        query_parts.append(temporal_keywords[timeframe][0])
    
    # Join into coherent query
    query = " ".join(query_parts)
    
    # Clean up
    query = re.sub(r'\s+', ' ', query).strip()
    
    logger.info(f"🔍 Built query: '{query}'")
    
    return query


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

def _blend_sources_by_intent(sources: List[SourceCard], intent: str) -> List[SourceCard]:
    """
    Blend sources based on research intent using weighted sampling.
    
    Args:
        sources: List of source cards with source_type field
        intent: Research intent ('academic', 'business', 'news', 'general')
    
    Returns:
        Reordered list of sources with optimal mix for the intent
    """
    import random
    
    # Define intent-based weights
    intent_weights = {
        'academic': {'academic': 0.6, 'business': 0.2, 'journalism': 0.15, 'government': 0.05},
        'business': {'business': 0.5, 'journalism': 0.3, 'academic': 0.15, 'government': 0.05},
        'news': {'journalism': 0.7, 'business': 0.15, 'academic': 0.1, 'government': 0.05},
        'general': {'journalism': 0.4, 'academic': 0.3, 'business': 0.2, 'government': 0.1}
    }
    
    weights = intent_weights.get(intent, intent_weights['general'])
    
    # Group sources by type
    sources_by_type = {'academic': [], 'business': [], 'journalism': [], 'government': []}
    for source in sources:
        source_type = source.source_type or 'journalism'
        if source_type in sources_by_type:
            sources_by_type[source_type].append(source)
    
    # Sample sources proportionally based on weights
    blended_sources = []
    total_sources = len(sources)
    
    for source_type, weight in weights.items():
        target_count = int(total_sources * weight)
        available = sources_by_type[source_type]
        
        if available:
            # Sort by relevance within type
            available.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
            # Take top N from this type
            blended_sources.extend(available[:target_count])
    
    # If we haven't filled all slots, add remaining high-relevance sources
    if len(blended_sources) < total_sources:
        remaining = [s for s in sources if s not in blended_sources]
        remaining.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
        blended_sources.extend(remaining[:total_sources - len(blended_sources)])
    
    # Final sort by relevance while maintaining diversity
    blended_sources.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
    
    return blended_sources


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
        
        # NEW: Build research brief and classify intent
        classification = None
        enhanced_query = base_query
        
        if research_request.conversation_context and len(research_request.conversation_context) > 0:
            # Build research brief from conversation context
            brief = _build_research_brief(
                research_request.conversation_context,
                base_query
            )
            
            # Classify intent and temporal bucket
            classification = _classify_intent_and_temporal(brief)
            
            # Build targeted query from brief (regex-based)
            enhanced_query = _build_query_with_brief(brief, classification)
            
            # AI-POWERED: Optimize query using Claude with full conversation context
            from services.ai.conversational import AIResearchService
            ai_service = AIResearchService()
            enhanced_query = await ai_service.optimize_search_query(
                raw_query=enhanced_query,
                conversation_context=research_request.conversation_context
            )
        
        # Apply publication constraint based on type
        final_query = enhanced_query
        domain_filter = None
        publication_name = None
        
        if publication_info:
            if publication_info["type"] == "domain_filter":
                # Tier 1: Use exact domain filtering
                domain_filter = [publication_info["value"]]
                # Extract publication name from domain for Claude filtering
                domain = publication_info["value"]
                publication_name = domain.replace('.com', '').replace('the', '').replace('www.', '').title()
                print(f"📰 Using domain filter: {domain_filter} with Claude filtering for: {publication_name}")
            elif publication_info["type"] == "keyword_boost":
                # Tier 2: Boost publication name as keyword
                publication_name = publication_info["value"]
                final_query = f'"{publication_name}" {enhanced_query}'
                print(f"📰 Boosting keyword: {publication_name} with Claude filtering")
        
        # Use progressive search for faster initial response with fallback
        try:
            result = await crawler.generate_sources_progressive(
                final_query, 
                max_sources, 
                budget_limit, 
                domain_filter=domain_filter,
                classification=classification,
                publication_name=publication_name
            )
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
        
        # Apply weighted source sampling based on classification
        if classification:
            # Map our new intent types to old blending logic (temporary compatibility)
            intent_map = {
                "news_event": "news",
                "policy_analysis": "general",
                "academic_causal": "academic",
                "historical_explainer": "academic",
                "business_trends": "business",
                "data_statistics": "academic",
                "general_research": "general"
            }
            legacy_intent = intent_map.get(classification["intent"], "general")
            sources = _blend_sources_by_intent(sources, legacy_intent)
            logger.info(f"🎨 Blended sources for {classification['intent']} intent: {len(sources)} total")
        else:
            # No context - just sort by relevance
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
        # Map stage to enrichment_status: skeleton->processing, complete->complete, error->error
        stage = result.get("stage", "complete")
        enrichment_status = "processing" if stage == "skeleton" else stage
        
        response = DynamicResearchResponse(
            query=sanitized_query,
            total_estimated_cost=round(total_cost, 2),
            source_count=len(sources),
            premium_source_count=len(premium_sources),
            research_summary=summary,
            sources=sources_response,
            licensing_breakdown=licensing_breakdown,
            enrichment_status=enrichment_status,
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