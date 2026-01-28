"""Dynamic query-based research routes"""

from fastapi import APIRouter, HTTPException, Header, Depends, Request
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
import re
import html
import os
import anthropic
import logging
import traceback
from datetime import datetime, timedelta

# Setup structured logging
logger = logging.getLogger(__name__)

from schemas.api import ResearchRequest, DynamicResearchResponse
from schemas.domain import ResearchPacket, SourceCard
from services.ai.report_generator import ReportGeneratorService
from services.ai.query_classifier import query_classifier  # Import query classification service
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter
from config import Config
from middleware.auth_dependencies import get_current_token, get_authenticated_user
# Import shared crawler instance without sys.path manipulation
from shared_services import crawler

router = APIRouter()

# Initialize services
ledewire = LedeWireAPI()
report_generator = ReportGeneratorService()

# NOTE: Query classification logic has been moved to services/ai/query_classifier.py
# The functions below are thin wrappers for backwards compatibility

# Initialize Anthropic client for context-aware query refinement
claude_client = anthropic.Anthropic(
    api_key=os.environ.get('ANTHROPIC_API_KEY')
)

# Conversation state storage: {conversation_id: {"topic": str, "first_query": str}}
# In-memory storage - cleared on server restart
conversation_topics: Dict[str, Dict[str, str]] = {}


class GenerateReportRequest(BaseModel):
    """Request model for report generation"""
    query: str = Field(..., min_length=3, max_length=500, description="Research query between 3-500 characters")
    selected_sources: Optional[List[Dict[str, Any]]] = None  # Full source objects (preferred)
    selected_source_ids: Optional[List[str]] = Field(None, min_length=1)  # DEPRECATED: Use selected_sources instead
    outline_structure: Optional[Dict[str, Any]] = None  # Custom outline structure from project outline builder


class FeedbackRequest(BaseModel):
    """Request model for user feedback on research results"""
    query: str = Field(..., min_length=1, max_length=500)
    source_ids: List[str] = Field(..., min_length=1)
    rating: str = Field(..., pattern="^(up|down)$")  # thumbs up or down
    mode: str = Field(default="research")


# Auth helper functions removed - now using centralized auth_dependencies module


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


def extract_topic_from_query(query: str, sources: List[SourceCard] = None) -> str:
    """
    Extract main research topic from the first query.
    Uses the query itself as the topic (cleaned up).
    """
    # Clean up the query to get the core topic
    topic = query.strip().lower()
    
    # Remove common query prefixes
    prefixes_to_remove = [
        "i want to research",
        "i want to know about",
        "tell me about",
        "show me",
        "find me",
        "search for",
        "looking for",
        "i need information on",
    ]
    
    for prefix in prefixes_to_remove:
        if topic.startswith(prefix):
            topic = topic[len(prefix):].strip()
    
    # Remove trailing question marks and punctuation
    topic = topic.rstrip("?!.,")
    
    # If sources available, use most common keywords from top source titles
    if sources and len(sources) >= 3:
        # Extract keywords from top 3 source titles
        from collections import Counter
        keywords = []
        for source in sources[:3]:
            # Extract words longer than 3 chars from title
            words = re.findall(r'\b[a-z]{4,}\b', source.title.lower())
            keywords.extend(words)
        
        # Get most common keyword that's also in the query
        common_keywords = [word for word, count in Counter(keywords).most_common(5) if word in query.lower()]
        if common_keywords:
            # Use the top common keyword as the core topic
            topic = common_keywords[0]
    
    logger.info(f"📌 Extracted topic: '{topic}' from query: '{query}'")
    return topic


async def check_topic_change(new_query: str, stored_topic: str) -> bool:
    """
    Use Claude to check if user wants to change research topics.
    Returns True if user is pivoting to a NEW topic, False if refining current topic.
    """
    try:
        system_prompt = """You are a topic change detector. Your job is to determine if the user wants to research a DIFFERENT topic or is just refining their current research.

Return ONLY "YES" if the user is explicitly changing topics to something unrelated.
Return ONLY "NO" if the user is refining, adding details, or asking follow-up questions about the same topic.

Examples:
- Current topic: "renewable energy"
  Query: "anything from time magazine" → NO (refinement - still about renewable energy)
  Query: "can we find paid sources?" → NO (refinement - still about renewable energy)
  Query: "what about solar panels?" → NO (subtopic of renewable energy)
  Query: "let's look at electric cars instead" → YES (completely different topic)
  Query: "I want to research cryptocurrency now" → YES (completely different topic)

Be conservative: only return YES for clear topic switches."""

        user_message = f"""Current research topic: "{stored_topic}"
New query from user: "{new_query}"

Is this a topic change? (YES/NO only):"""

        logger.info(f"🔍 Checking if '{new_query}' changes topic from '{stored_topic}'")
        
        response = claude_client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=10,
            temperature=0.0,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}]
        )
        
        answer = response.content[0].text.strip().upper()
        is_topic_change = answer == "YES"
        
        logger.info(f"{'🔄' if is_topic_change else '✅'} Topic change detection: {answer}")
        return is_topic_change
        
    except Exception as e:
        logger.warning(f"⚠️  Topic change detection failed: {e}, assuming NO change")
        return False  # Fail safe - assume no topic change


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
    """REMOVED: Entity extraction was causing false positives (injecting China/Russia into US queries).
    Now returns empty list - user intent is preserved through direct query pass-through."""
    return []


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


def _extract_enhanced_context_with_claude(conversation_context: List[Dict], user_query: str) -> Optional[Dict[str, Any]]:
    """
    Use Claude to intelligently extract rich research context from conversation.
    Returns enhanced context dict or None if extraction fails.
    """
    
    # Build conversation history (last 8-10 messages)
    recent_messages = conversation_context[-10:] if len(conversation_context) > 10 else conversation_context
    
    conversation_text = ""
    for msg in recent_messages:
        role = msg.get('sender', msg.get('role', 'user'))
        content = msg.get('content', '').strip()
        if content and len(content) > 5:
            conversation_text += f"{role.upper()}: {content}\n"
    
    # Build Claude prompt for context extraction
    system_prompt = """You are a research assistant analyzing conversations to extract detailed research context.

Your task: Analyze this conversation and extract structured research context to help find the most relevant sources.

Extract:
1. **core_topic**: The main research topic (concise, 3-10 words)
2. **key_entities**: Specific people, organizations, places, events mentioned (list of strings)
3. **geographic_scope**: Geographic focus if mentioned (e.g., "United States", "Europe", "global", "none")
4. **temporal_scope**: Time period of interest (e.g., "recent", "2020-present", "historical", "last 24 hours", "none")
5. **source_preferences**: Preferred source types mentioned (e.g., ["academic", "journalistic", "government"], or empty list)
6. **specific_aspects**: Specific aspects/angles the user wants to focus on (list of strings)
7. **exclusions**: Topics/aspects explicitly NOT wanted (list of strings, very important!)
8. **research_intent**: Why they're researching this (e.g., "understanding policy implications", "tracking current developments")

Be precise. Extract ONLY what's explicitly mentioned in the conversation. Don't infer or add context.

Return ONLY valid JSON:
{
  "core_topic": "string",
  "key_entities": ["entity1", "entity2"],
  "geographic_scope": "string or none",
  "temporal_scope": "string or none",
  "source_preferences": ["type1", "type2"],
  "specific_aspects": ["aspect1", "aspect2"],
  "exclusions": ["exclude1", "exclude2"],
  "research_intent": "string"
}"""

    user_message = f"""Conversation history:
{conversation_text}

Latest query: {user_query}

Extract the research context."""

    try:
        response = claude_client.messages.create(
            model="claude-sonnet-4-20250514",  # Fast, accurate
            max_tokens=800,
            temperature=0.1,  # Low temperature for precise extraction
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}]
        )
        
        response_text = _extract_response_text(response).strip()
        
        # Parse JSON (handle markdown code blocks)
        import json
        response_text = response_text.replace("```json", "").replace("```", "").strip()
        enhanced_context = json.loads(response_text)
        
        logger.info("✨ Claude extracted enhanced research context", extra={
            "core_topic": enhanced_context.get("core_topic", "")[:50],
            "geographic_scope": enhanced_context.get("geographic_scope"),
            "temporal_scope": enhanced_context.get("temporal_scope"),
            "exclusions_count": len(enhanced_context.get("exclusions", []))
        })
        
        return enhanced_context
        
    except Exception as e:
        logger.warning(f"⚠️ Enhanced context extraction failed, using fallback: {e}")
        return None


def _build_research_brief(conversation_context: List[Dict], user_query: str) -> Dict[str, Any]:
    """
    Extract structured research brief from conversation + current query.
    Uses Claude for enhanced context extraction, falls back to regex-based extraction.
    Returns: {topic, entities, timeframe, subtasks, output_bias, enhanced_context}
    """
    
    # Try enhanced Claude-based extraction first
    enhanced_context = None
    if claude_client:
        enhanced_context = _extract_enhanced_context_with_claude(conversation_context, user_query)
    
    # Combine recent conversation for fallback context (last 6 messages)
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
    
    # If we have enhanced context, use it; otherwise use fallback extraction
    if enhanced_context:
        # Map enhanced context to brief structure
        topic = enhanced_context.get("core_topic", user_query)[:150]
        entities = enhanced_context.get("key_entities", [])
        
        # Map temporal_scope to timeframe bucket
        temporal_scope = enhanced_context.get("temporal_scope", "").lower()
        if "24" in temporal_scope or "today" in temporal_scope or "current" in temporal_scope:
            timeframe = "T0"
        elif "recent" in temporal_scope or "last week" in temporal_scope or "days" in temporal_scope:
            timeframe = "T1"
        elif "month" in temporal_scope:
            timeframe = "T7"
        elif "historical" in temporal_scope or "years" in temporal_scope:
            timeframe = "TH"
        else:
            timeframe = _extract_timeframe(full_text, output_bias)
        
        # Map specific_aspects to subtasks
        specific_aspects = enhanced_context.get("specific_aspects", [])
        subtasks = []
        for aspect in specific_aspects:
            aspect_lower = aspect.lower()
            if any(word in aspect_lower for word in ["terms", "details", "specifics"]):
                subtasks.append("terms_and_details")
            elif any(word in aspect_lower for word in ["who", "actors", "stakeholders"]):
                subtasks.append("actors_and_stakeholders")
            elif any(word in aspect_lower for word in ["impact", "consequences", "effects"]):
                subtasks.append("impact_analysis")
            elif any(word in aspect_lower for word in ["future", "prospects", "outlook"]):
                subtasks.append("future_outlook")
            elif any(word in aspect_lower for word in ["background", "context", "history"]):
                subtasks.append("background_context")
        
        # Override output_bias if source preferences are specified
        source_prefs = enhanced_context.get("source_preferences", [])
        if source_prefs:
            pref_lower = [p.lower() for p in source_prefs]
            if "academic" in pref_lower or "scholarly" in pref_lower:
                output_bias = "academic"
            elif "journalistic" in pref_lower or "news" in pref_lower:
                output_bias = "news"
            elif "government" in pref_lower or "policy" in pref_lower:
                output_bias = "policy"
    else:
        # Fallback to regex-based extraction
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
        "raw_query": user_query,
        "enhanced_context": enhanced_context,  # Include full enhanced context
        "conversation_context": conversation_context  # Include conversation for filtering
    }
    
    logger.info("📋 Research Brief extracted", extra={
        "topic": topic[:50],
        "timeframe": timeframe,
        "output_bias": output_bias,
        "entity_count": len(entities),
        "has_enhanced_context": enhanced_context is not None,
        "has_conversation": conversation_context is not None and len(conversation_context) > 0
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
    """Build targeted Tavily query from research brief - simplified to preserve user intent."""
    
    topic = brief["topic"]
    timeframe = brief["timeframe"]
    
    # Start with user's topic (their actual query) - no entity injection
    query = topic
    
    # Optionally add minimal temporal keyword for breaking news only
    # Don't pollute the query with temporal keywords unless it's truly breaking news
    if timeframe == "T0":
        # Breaking news - add "latest" to prioritize very recent content
        query = f"{query} latest"
    
    # Clean up whitespace
    query = re.sub(r'\s+', ' ', query).strip()
    
    logger.info(f"🔍 Built query (user intent preserved): '{query}'")
    
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
        if report_request.selected_sources:
            print(f"📊 Generating report with {len(report_request.selected_sources)} provided sources")
            
            # Use provided sources directly (frontend is source of truth)
            # Convert dict objects to SourceCard instances
            selected_sources = [SourceCard(**source_dict) for source_dict in report_request.selected_sources]
            
        elif report_request.selected_source_ids:
            print(f"📊 Generating report with {len(report_request.selected_source_ids)} selected sources (legacy mode)")
            
            # Legacy fallback: try cache lookup for backward compatibility
            selected_sources = []
            
            # Try to find sources in cache by checking all cached results
            cache_size = len(crawler._cache)
            print(f"🔍 Searching for {len(report_request.selected_source_ids)} sources in cache (cache has {cache_size} entries)")
            
            for cache_key, (cached_sources, timestamp) in crawler._cache.items():
                if isinstance(cached_sources, list):
                    for source in cached_sources:
                        if source.id in report_request.selected_source_ids:
                            selected_sources.append(source)
            
            print(f"✅ Found {len(selected_sources)} sources in cache")
            
            if not selected_sources:
                raise HTTPException(
                    status_code=422, 
                    detail="Selected sources not available. Please refresh your search and select sources again."
                )
            
        if report_request.selected_sources or report_request.selected_source_ids:
            # Generate AI report with selected sources
            report_data = report_generator.generate_report(
                sanitized_query, 
                selected_sources,
                outline_structure=report_request.outline_structure
            )
            
            # Build packet directly with structured report data
            research_packet = ResearchPacket(
                query=sanitized_query,
                summary=report_data.get('summary', ''),
                outline=None,  # Table data is now in table_data field
                research_directions=report_data.get('research_directions', None),  # Research directions list
                sources=selected_sources,
                total_sources=len(selected_sources),
                citation_metadata=report_data.get('citation_metadata', {}),
                table_data=report_data.get('table_data', []),  # New structured table data
                conflicts=report_data.get('conflicts', None)  # Conflicts analysis
            )
            
        else:
            # No sources selected - generate sources and report (legacy behavior)
            print(f"📊 Generating report without selected sources (legacy mode)")
            
            # Generate sources with fixed limit (unified tier)
            max_sources = 20
            
            # Generate sources
            generated_sources = await crawler.generate_sources(sanitized_query, max_sources)
            
            # Generate AI report
            report_data = report_generator.generate_report(
                sanitized_query,
                generated_sources,
                outline_structure=report_request.outline_structure
            )
            
            # Build packet directly with structured report data
            research_packet = ResearchPacket(
                query=sanitized_query,
                summary=report_data.get('summary', ''),
                outline=None,
                research_directions=report_data.get('research_directions', None),  # Research directions list
                sources=generated_sources,
                total_sources=len(generated_sources),
                citation_metadata=report_data.get('citation_metadata', {}),
                table_data=report_data.get('table_data', []),
                conflicts=report_data.get('conflicts', None)
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
        
        # DEBUG: Log pipeline start
        print(f"\n🔍 QUERY PIPELINE DEBUG:")
        print(f"   Raw base_query: '{base_query}'")
        print(f"   Conversation context: {len(research_request.conversation_context) if research_request.conversation_context else 0} messages")
        
        # TOPIC PERSISTENCE: Manage conversation topic
        user_id = user_info.get('user_id', 'anonymous')
        stored_topic = None
        
        # Topic key includes project_id to scope topics per project
        topic_key = f"{user_id}:{research_request.project_id}" if research_request.project_id else user_id
        
        # Handle topic reset (from "Start a New Search" button)
        if research_request.reset_topic:
            if topic_key in conversation_topics:
                logger.info(f"🔄 Resetting topic for user {user_id}")
                del conversation_topics[topic_key]
        
        # Check if we have a stored topic for this user/project
        if topic_key in conversation_topics:
            stored_topic = conversation_topics[topic_key].get('topic')
            logger.info(f"📌 Found stored topic for user: '{stored_topic}'")
            
            # Check if user wants to change topics
            topic_changed = await check_topic_change(base_query, stored_topic)
            if topic_changed:
                logger.info(f"🔄 Topic change detected - clearing old topic")
                del conversation_topics[topic_key]
                stored_topic = None
        
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
            print(f"   After regex enhancement: '{enhanced_query}'")
            
            # AI-POWERED: Optimize query using Claude with full conversation context
            from services.ai.conversational import AIResearchService
            ai_service = AIResearchService()
            enhanced_query = await ai_service.optimize_search_query(
                raw_query=enhanced_query,
                conversation_context=research_request.conversation_context,
                pinned_topic=stored_topic  # Pass stored topic as constraint
            )
            print(f"   After Claude optimization: '{enhanced_query}'")
            
            # POST-OPTIMIZATION GUARD: Ensure topic is anchored
            if stored_topic and stored_topic.lower() not in enhanced_query.lower():
                logger.info(f"⚠️  Claude dropped topic - prepending '{stored_topic}'")
                enhanced_query = f"{stored_topic} {enhanced_query}"
                print(f"   After topic guard: '{enhanced_query}'")
        else:
            print(f"   No conversation context - skipping enhancement")
        
        # Apply publication constraint based on type
        final_query = enhanced_query
        domain_filter = None
        publication_name = None
        
        print(f"   Final query for search: '{final_query}'\n")
        
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
            # DEBUG: Verify crawler instance
            print(f"🔍 [ANALYZE] Crawler instance ID: {id(crawler)}, cache entries: {len(crawler._cache)}")
            
            result = await crawler.generate_sources_progressive(
                final_query, 
                max_sources, 
                budget_limit, 
                domain_filter=domain_filter,
                classification=classification,
                publication_name=publication_name,
                research_brief=brief  # Pass research brief with enhanced_context
            )
            sources = result["sources"]
            
            # TOPIC PERSISTENCE: Store topic after first successful search
            if not stored_topic and sources and len(sources) > 0:
                # Extract topic from first query
                topic = extract_topic_from_query(base_query, sources)
                conversation_topics[topic_key] = {
                    "topic": topic,
                    "first_query": base_query
                }
                logger.info(f"💾 Stored topic for project {topic_key}: '{topic}'")
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
        
        # QUERY PERSISTENCE: Save query to project if this is the first search
        if research_request.project_id:
            try:
                # Check if project exists and has no query yet
                project_query = normalize_query("""SELECT id, research_query FROM projects WHERE id = ? AND user_id = ?""")
                
                from data.db_wrapper import db_instance, normalize_query
                
                project_result = db_instance.execute_query(project_query, (research_request.project_id, user_id))
                
                # Only save if project exists and has no query yet (preserve first search)
                if project_result and len(project_result) > 0:
                    project = project_result[0]
                    if not project.get('research_query'):
                        # Update query
                        update_query = normalize_query("""UPDATE projects SET research_query = ? WHERE id = ?""")
                        db_instance.execute_query(update_query, (sanitized_query, research_request.project_id))
                        logger.info(f"💾 Saved first research query to project {research_request.project_id}: '{sanitized_query}'")
            except Exception as e:
                # Don't fail the search if query save fails
                logger.warning(f"⚠️ Failed to save query to project: {e}")
            
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


@router.post("/feedback")
@limiter.limit("30/minute")
async def submit_feedback(
    request: Request,
    feedback: FeedbackRequest,
    authorization: str = Header(None)
):
    """Submit user feedback on research results quality."""
    try:
        logger.info("📊 FEEDBACK ENDPOINT HIT")
        logger.info(f"  Request body: query={feedback.query[:50]}, rating={feedback.rating}, mode={feedback.mode}, source_count={len(feedback.source_ids)}")
        logger.info(f"  Authorization header present: {bool(authorization)}")
        
        # Extract user ID from token if provided, otherwise use anonymous
        user_id = "anonymous"
        if authorization:
            try:
                logger.info("  Extracting bearer token...")
                access_token = extract_bearer_token(authorization)
                logger.info("  Fetching user ID from LedeWire...")
                balance_result = ledewire.get_wallet_balance(access_token)
                if "user_id" in balance_result:
                    user_id = balance_result["user_id"]
                    logger.info(f"  User ID extracted: {user_id}")
                else:
                    logger.warning("  No user_id in balance result, using anonymous")
            except Exception as auth_error:
                logger.warning(f"  Auth extraction failed: {str(auth_error)}, using anonymous")
        
        logger.info(f"  Final user_id for feedback: {user_id}")
        
        # Import database connection
        from data.db import db
        
        # Store source_ids as JSON string
        import json
        source_ids_json = json.dumps(feedback.source_ids)
        logger.info(f"  Source IDs JSON: {source_ids_json}")
        
        # Insert feedback into database
        logger.info("  Inserting feedback into database...")
        db.execute_write(
            """
            INSERT INTO feedback (user_id, query, source_ids, rating, mode, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, feedback.query, source_ids_json, feedback.rating, feedback.mode, datetime.now().isoformat())
        )
        
        logger.info(f"✅ Feedback recorded successfully: user={user_id}, query={feedback.query[:50]}, rating={feedback.rating}, sources={len(feedback.source_ids)}")
        
        return {
            "success": True,
            "message": "Thank you for your feedback!"
        }
        
    except Exception as e:
        logger.error(f"❌ FEEDBACK SUBMISSION ERROR: {type(e).__name__}: {str(e)}")
        logger.error(f"   Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to submit feedback: {str(e)}")