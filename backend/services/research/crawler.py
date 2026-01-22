import random
import uuid
import os
import asyncio
import time
import httpx
import logging
from typing import List, Optional, Dict, Any
from functools import wraps
from schemas.domain import SourceCard
from services.licensing.content_licensing import ContentLicenseService
from services.ai.polishing import ContentPolishingService
from services.research.domain_classifier import DomainClassifier

# Setup structured logging
logger = logging.getLogger(__name__)

def async_retry(max_attempts=3, base_delay=1.0, max_delay=10.0, exponential_base=2):
    """
    Simple retry decorator with exponential backoff for async functions.
    
    Args:
        max_attempts: Maximum number of retry attempts
        base_delay: Initial delay between retries in seconds
        max_delay: Maximum delay between retries in seconds
        exponential_base: Base for exponential backoff calculation
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return await func(*args, **kwargs)
                except httpx.HTTPError as e:
                    if attempt == max_attempts - 1:
                        raise
                    
                    delay = min(base_delay * (exponential_base ** attempt), max_delay)
                    print(f"⚠️  API call failed (attempt {attempt + 1}/{max_attempts}): {str(e)[:100]}. Retrying in {delay:.1f}s...")
                    await asyncio.sleep(delay)
        
        return wrapper
    return decorator

class ContentCrawlerStub:
    """
    AI-powered content crawler using Tavily search API.
    Provides real-time research results with dynamic pricing.
    """
    
    def __init__(self):
        # Initialize Tavily API key for direct REST calls
        self.tavily_api_key = os.environ.get("TAVILY_API_KEY")
        if not self.tavily_api_key:
            raise ValueError("TAVILY_API_KEY environment variable is required")
        
        self.tavily_api_url = "https://api.tavily.com/search"
        self.use_real_search = True
        
        # Initialize content licensing service and AI research service
        self.license_service = ContentLicenseService()
        self.ai_service = ContentPolishingService()
        
        # Simple in-memory cache with TTL (5 minutes)
        self._cache = {}
        self._cache_ttl = 300  # 5 minutes
        self._last_cache_cleanup = time.time()
        self._cache_cleanup_interval = 60  # Clean up every minute
        
        # Content quality factors that influence pricing
        self.quality_factors = {
            "peer_reviewed": 1.5,
            "recent": 1.2,
            "high_citations": 1.4,
            "full_text": 1.3,
            "premium_journal": 1.6
        }
        
        # Async HTTP client for non-blocking requests
        self._http_client = None
        
        # Simplified domain authority weights - use broader categories instead of many hardcoded domains
        # The DomainClassifier provides more detailed tier classification
        self.domain_weights = {
            # Academic/research patterns - high authority for scholarly work
            '.edu': 0.6,
            '.ac.uk': 0.6,
            '.gov': 0.6,
            # Major academic publishers
            'arxiv.org': 0.7, 'nature.com': 0.7, 'science.org': 0.7, 'jstor.org': 0.7,
            # Major established news/analysis - moderate authority
            'nytimes.com': 0.6, 'wsj.com': 0.6, 'economist.com': 0.6, 'ft.com': 0.6,
            'reuters.com': 0.5, 'apnews.com': 0.5, 'bloomberg.com': 0.5,
            'theguardian.com': 0.5, 'bbc.com': 0.5,
        }
        
        # Ranking weights for composite scoring
        # These can be adjusted to tune the balance between relevance, authority, and recency
        # Note: The actual weights are normalized at runtime, so MAX_RECENCY_WEIGHT serves as a ceiling
        # for dynamic recency weighting based on query type (e.g., news vs. historical research)
        self.RELEVANCE_WEIGHT = 0.50  # Primary signal for matching conversation context
        self.AUTHORITY_WEIGHT = 0.30  # Secondary signal for source credibility
        self.MAX_RECENCY_WEIGHT = 0.20  # Maximum weight for time-sensitive queries (actual weight is min(requested, 0.20))
        
        # Domain tier boosts and scoring parameters
        self.PREMIUM_TIER_BOOST = 0.20  # Boost for premium domains (.edu, major publishers)
        self.RANDOM_VARIANCE_RANGE = 0.05  # Random factor range for score variety (±5%)
    
    def _calculate_recency_score(self, published_date: Optional[str], timeframe: str = "T1") -> float:
        """Calculate recency score based on publication date and temporal bucket."""
        if not published_date:
            return 0.5  # Neutral score if no date
        
        try:
            from datetime import datetime
            import dateutil.parser
            
            # Parse the date
            pub_date = dateutil.parser.parse(published_date)
            now = datetime.now(pub_date.tzinfo or None)
            hours_ago = (now - pub_date).total_seconds() / 3600
            
            # Apply decay based on timeframe
            if timeframe == "T0":  # 24h - exponential decay
                return max(0.1, min(1.0, 2 ** (-hours_ago / 24)))
            elif timeframe == "T1":  # 3 days - moderate decay
                return max(0.1, min(1.0, 1 - (hours_ago / (72 * 2))))
            elif timeframe == "T7":  # 7 days - linear decay
                return max(0.1, min(1.0, 1 - (hours_ago / (168 * 2))))
            else:  # TH - minimal decay
                days_ago = hours_ago / 24
                return max(0.1, min(1.0, 1 - (days_ago / 365)))
        except:
            return 0.5
    
    def _get_domain_authority(self, domain: str) -> float:
        """
        Get authority weight for domain.
        Returns 0.0 for unknown domains (rely on DomainClassifier tier boost instead).
        """
        # Normalize domain by removing www. prefix for consistent matching
        normalized_domain = domain.lower().removeprefix('www.')
        
        # Check exact matches
        if normalized_domain in self.domain_weights:
            return self.domain_weights[normalized_domain]
        
        # Check suffix matches (e.g., .edu)
        for pattern, weight in self.domain_weights.items():
            if pattern.startswith('.') and normalized_domain.endswith(pattern):
                return weight
        
        return 0.0  # Unknown domain - let DomainClassifier tier boost handle it
    
    def _rerank_with_recency(self, sources: List[SourceCard], classification: Optional[Dict[str, Any]] = None) -> List[SourceCard]:
        """Rerank sources using recency, relevance, domain tier, and licensing based on classification."""
        if not classification:
            # No classification - just sort by relevance
            sources.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
            return sources
        
        recency_weight = classification.get("recency_weight", 0.3)
        temporal_bucket = classification.get("temporal_bucket", "T1")
        
        # Determine actual weights (before normalization, for logging)
        relevance_weight = self.RELEVANCE_WEIGHT
        authority_weight = self.AUTHORITY_WEIGHT
        actual_recency_weight = min(recency_weight, self.MAX_RECENCY_WEIGHT)
        
        # Normalize weights to sum to 1.0
        total_weight = actual_recency_weight + relevance_weight + authority_weight
        if total_weight > 0:
            normalized_recency = actual_recency_weight / total_weight
            normalized_relevance = relevance_weight / total_weight
            normalized_authority = authority_weight / total_weight
        else:
            # Fallback if total is 0 (shouldn't happen)
            normalized_recency = 0.0
            normalized_relevance = 1.0
            normalized_authority = 0.0
        
        # Calculate composite scores
        for source in sources:
            relevance = source.relevance_score or 0.5
            recency = self._calculate_recency_score(
                getattr(source, 'published_date', None),
                temporal_bucket
            )
            
            # Base authority from legacy domain_weights
            base_authority = self._get_domain_authority(source.domain)
            
            # Enhanced authority with domain tier classification
            domain_tier = DomainClassifier.get_domain_tier(source.url)
            tier_boost = {
                "premium": self.PREMIUM_TIER_BOOST,  # Moderate boost for .edu, major publishers
                "standard": 0.0,  # No boost
                "blocked": -0.5   # Should never happen (filtered by Tavily), but penalize if present
            }.get(domain_tier, 0.0)
            
            authority = min(1.0, base_authority + tier_boost)
            
            # REMOVED: Licensing boost - prioritize relevance over payment status
            # Sources should rank by how well they match the conversation context,
            # not whether they're paid or free
            
            # Use normalized weights for composite score
            composite_score = (
                normalized_recency * recency +
                normalized_relevance * relevance +
                normalized_authority * authority
            )
            
            # Store composite score for sorting
            source.composite_score = composite_score
        
        # Sort by composite score
        sources.sort(key=lambda x: getattr(x, 'composite_score', 0.0), reverse=True)
        
        # Log relevance-first ranking results (top 3 sources) with actual normalized weights
        if sources:
            print(f"🏆 Relevance-First Ranking (Relevance={normalized_relevance:.2f}, Authority={normalized_authority:.2f}, Recency={normalized_recency:.2f}):")
            for i, src in enumerate(sources[:3]):
                domain = src.url.split('/')[2] if src.url else 'unknown'
                print(f"   {i+1}. {domain} - Score: {getattr(src, 'composite_score', 0.0):.3f}")
        
        return sources
    
    def _get_cache_key(self, query: str, count: int, budget_limit: Optional[float] = None, domain_filter: Optional[List[str]] = None) -> str:
        """Generate cache key for query results including domain filter for cache isolation"""
        # Use deterministic serialization for domain filter to ensure uniqueness
        # Treat None (no filter) and empty list distinctly
        if domain_filter is None:
            domain_key = "NO_FILTER"
        elif len(domain_filter) == 0:
            domain_key = "EMPTY_FILTER"
        else:
            # Join sorted domains with pipe separator for deterministic key
            domain_key = "|".join(sorted(domain_filter))
        
        return f"search:{hash(query)}:{count}:{budget_limit or 0}:{domain_key}"
    
    def _is_cache_valid(self, timestamp: float) -> bool:
        """Check if cached result is still valid"""
        return time.time() - timestamp < self._cache_ttl
    
    def _cleanup_expired_cache(self):
        """Periodically clean up expired cache entries to prevent memory bloat"""
        current_time = time.time()
        
        # Only cleanup if interval has passed
        if current_time - self._last_cache_cleanup < self._cache_cleanup_interval:
            return
        
        # Remove expired entries
        expired_keys = [
            key for key, (_, timestamp) in self._cache.items()
            if not self._is_cache_valid(timestamp)
        ]
        
        for key in expired_keys:
            del self._cache[key]
        
        if expired_keys:
            print(f"🧹 Cleaned up {len(expired_keys)} expired cache entries")
        
        self._last_cache_cleanup = current_time
    
    def _get_from_cache(self, cache_key: str) -> Optional[List[SourceCard]]:
        """Retrieve results from cache if valid"""
        # Periodic cleanup
        self._cleanup_expired_cache()
        
        if cache_key in self._cache:
            cached_data, timestamp = self._cache[cache_key]
            if self._is_cache_valid(timestamp):
                return cached_data
            else:
                # Clean up expired cache entry
                del self._cache[cache_key]
        return None
    
    def _store_in_cache(self, cache_key: str, data: List[SourceCard]):
        """Store results in cache with timestamp"""
        self._cache[cache_key] = (data, time.time())
    
    async def generate_sources_progressive(self, query: str, count: int, budget_limit: Optional[float] = None, domain_filter: Optional[List[str]] = None, classification: Optional[Dict[str, Any]] = None, publication_name: Optional[str] = None, research_brief: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Generate sources with progressive loading - returns immediate results + enrichment promise
        
        Args:
            query: Search query
            count: Number of sources to generate
            budget_limit: Optional budget limit for licensing
            domain_filter: Optional list of domains to filter results (e.g., ['nytimes.com'])
            classification: Optional classification dict with intent, temporal_bucket, recency_weight
            publication_name: Optional publication name for Claude relevance filtering (e.g., 'Wall Street Journal')
            research_brief: Optional research brief with enhanced_context for query enhancement
        """
        cache_key = self._get_cache_key(query, count, budget_limit, domain_filter)
        print(f"🔑 Cache key generated: {cache_key}")
        print(f"📦 Current cache size: {len(self._cache)} entries")
        
        # Check cache first
        cached_result = self._get_from_cache(cache_key)
        if cached_result:
            print(f"✅ CACHE HIT for query: '{query}' - Returning {len(cached_result)} cached sources")
            # Apply recency-based reranking even to cached results
            if classification:
                cached_result = self._rerank_with_recency(cached_result, classification)
            
            return {
                "sources": cached_result,
                "stage": "complete",
                "enrichment_needed": False
            }
        
        print(f"❌ CACHE MISS for query: '{query}' - Will call Tavily API")
        return await self._generate_tavily_sources_progressive(query, count, budget_limit, cache_key, domain_filter, classification, publication_name, research_brief)
    
    async def _get_http_client(self) -> httpx.AsyncClient:
        """Get or create async HTTP client"""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=30.0)
        return self._http_client
    
    async def close(self):
        """Close async HTTP client on shutdown"""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
    
    def _classify_source_type(self, domain: str, url: str) -> str:
        """
        Classify source type based on domain and URL patterns.
        
        Returns:
            Source type: "academic", "journalism", "business", "government"
        """
        domain_lower = domain.lower()
        url_lower = url.lower()
        
        # Academic sources
        academic_patterns = [
            '.edu', 'scholar.google', 'arxiv.org', 'researchgate.net', 
            'jstor.org', 'pubmed', 'ieee.org', 'sciencedirect.com',
            'springer.com', 'nature.com', 'science.org', 'plos.org',
            'nber.org', 'ssrn.com', 'academic.oup.com'
        ]
        
        # Journalism sources
        journalism_patterns = [
            'nytimes.com', 'washingtonpost.com', 'wsj.com', 'bloomberg.com',
            'reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'theguardian.com',
            'ft.com', 'economist.com', 'forbes.com', 'time.com', 'theatlantic.com',
            'npr.org', 'politico.com', 'axios.com', 'propublica.org'
        ]
        
        # Business/industry sources
        business_patterns = [
            'hbr.org', 'mckinsey.com', 'bcg.com', 'deloitte.com', 'pwc.com',
            'gartner.com', 'forrester.com', 'fortune.com', 'businessinsider.com',
            'cnbc.com', 'marketwatch.com', 'investopedia.com'
        ]
        
        # Government sources
        government_patterns = [
            '.gov', 'census.gov', 'bls.gov', 'fed.gov', 'whitehouse.gov',
            'congress.gov', 'europa.eu', 'oecd.org', 'worldbank.org',
            'imf.org', 'who.int', 'un.org'
        ]
        
        # Check patterns
        if any(pattern in domain_lower or pattern in url_lower for pattern in academic_patterns):
            return 'academic'
        elif any(pattern in domain_lower for pattern in journalism_patterns):
            return 'journalism'
        elif any(pattern in domain_lower for pattern in business_patterns):
            return 'business'
        elif any(pattern in domain_lower for pattern in government_patterns):
            return 'government'
        else:
            # Default to journalism for general news/credible sources
            return 'journalism'
    
    def _get_credibility_penalty(self, url: str) -> float:
        """
        Apply credibility penalty to low-quality sources (social media, Wikipedia, etc.).
        Returns a negative score adjustment for less credible domains.
        
        Args:
            url: Full URL to check for low-credibility patterns
        """
        # Low-credibility patterns (checked against full URL for path-specific matches)
        low_credibility_patterns = [
            'reddit.com', 'www.reddit.com',
            'facebook.com', 'www.facebook.com', 'm.facebook.com',
            'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com',
            'instagram.com', 'www.instagram.com',
            'tiktok.com', 'www.tiktok.com',
            'linkedin.com/posts', 'www.linkedin.com/posts',  # LinkedIn posts, not articles
            'wikipedia.org', 'en.wikipedia.org',
            'quora.com', 'www.quora.com',
            'medium.com', 'www.medium.com',  # Varies in quality
            'answers.yahoo.com',
        ]
        
        # Check if URL matches any low-credibility pattern
        url_lower = url.lower()
        for pattern in low_credibility_patterns:
            if pattern in url_lower:
                return -0.35  # Significant penalty to push below credible sources
        
        return 0.0  # No penalty for other URLs
    
    @async_retry(max_attempts=3, base_delay=1.0, max_delay=10.0)
    async def _call_tavily_api(self, query: str, max_results: int = 20, include_domains: Optional[List[str]] = None) -> Dict[str, Any]:
        """Make async REST API call to Tavily search endpoint with retry logic."""
        
        # Get blocked domains from DomainClassifier (social media, UGC, low-quality sources)
        exclude_domains = DomainClassifier.get_exclude_list()
        
        payload = {
            "api_key": self.tavily_api_key,
            "query": query,
            "search_depth": "advanced",
            "max_results": max_results,
            "include_answer": False,
            "include_images": False,
            "include_raw_content": False,
            "exclude_domains": exclude_domains  # Block social media and UGC sources upfront
        }
        
        # Add domain filter if provided (for specific publication searches)
        if include_domains:
            payload["include_domains"] = include_domains
            print(f"📰 Tavily REST API call with domain filter: {include_domains}")
        
        print(f"🚫 Excluding {len(exclude_domains)} blocked domains (social media, UGC, low-quality)")
        
        try:
            client = await self._get_http_client()
            response = await client.post(self.tavily_api_url, json=payload)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPError as e:
            print(f"❌ Tavily API request failed: {str(e)}")
            raise
    
    def _extract_domain_filter(self, query: str) -> tuple[str, Optional[List[str]]]:
        """Extract site: domain filter from query and return clean query + domain list for Tavily."""
        import re
        
        # Match site:domain.com patterns
        site_pattern = r'site:([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'
        matches = re.findall(site_pattern, query)
        
        if matches:
            # Remove site: operators from query
            clean_query = re.sub(site_pattern, '', query).strip()
            # Remove extra whitespace
            clean_query = ' '.join(clean_query.split())
            print(f"🔍 Extracted domain filter: {matches} from query")
            return clean_query, matches
        
        return query, None
    
    def _build_enhanced_tavily_query(self, base_query: str, research_brief: Optional[Dict[str, Any]] = None) -> str:
        """
        Build enhanced Tavily query using conversation context from research brief.
        Adds geographic, temporal, and domain-specific keywords to improve relevance.
        
        Args:
            base_query: Original user query
            research_brief: Research brief with enhanced_context from Claude extraction
        
        Returns:
            Enhanced query string optimized for Tavily search
        """
        if not research_brief or not research_brief.get("enhanced_context"):
            # No enhanced context, use base query
            return base_query
        
        enhanced_context = research_brief["enhanced_context"]
        query_parts = [base_query]
        
        # Add geographic scope if specified
        geographic_scope = enhanced_context.get("geographic_scope", "").strip()
        if geographic_scope and geographic_scope.lower() not in ["none", "global"]:
            # Add geographic constraint to query
            query_parts.append(geographic_scope)
            print(f"🌍 Adding geographic scope to query: {geographic_scope}")
        
        # Add temporal keywords if specified
        temporal_scope = enhanced_context.get("temporal_scope", "").strip()
        if temporal_scope and temporal_scope.lower() != "none":
            # Add temporal constraint to query
            if "2020" in temporal_scope or "2021" in temporal_scope or "2022" in temporal_scope or "2023" in temporal_scope or "2024" in temporal_scope:
                # Specific year - add it
                query_parts.append(temporal_scope)
                print(f"📅 Adding temporal scope to query: {temporal_scope}")
            elif "recent" in temporal_scope.lower() or "last" in temporal_scope.lower():
                # Recent time period - add keyword
                query_parts.append("recent")
                print(f"📅 Adding temporal keyword: recent")
        
        # Add source type keywords if academic/scholarly preferred
        source_prefs = enhanced_context.get("source_preferences", [])
        if source_prefs:
            pref_lower = [p.lower() for p in source_prefs]
            if "academic" in pref_lower or "scholarly" in pref_lower:
                query_parts.append("research study")
                print(f"📚 Adding academic keywords to query")
            elif "government" in pref_lower:
                query_parts.append("government policy")
                print(f"🏛️ Adding government keywords to query")
        
        # Combine all parts
        enhanced_query = " ".join(query_parts)
        
        # Log the enhancement
        if enhanced_query != base_query:
            print(f"✨ Enhanced query: '{base_query}' → '{enhanced_query}'")
        
        return enhanced_query[:350]  # Tavily has a character limit
    
    async def _generate_tavily_sources_progressive(self, query: str, count: int, budget_limit: Optional[float], cache_key: str, domain_filter: Optional[List[str]] = None, classification: Optional[Dict[str, Any]] = None, publication_name: Optional[str] = None, research_brief: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Generate sources progressively: immediate raw results + background enrichment
        
        Args:
            query: Search query (may contain site: operators for backward compatibility)
            count: Number of sources
            budget_limit: Budget limit
            cache_key: Cache key
            domain_filter: Optional domain filter from publication detection (takes precedence)
            classification: Optional classification for recency-weighted reranking
            publication_name: Optional publication name for Claude relevance filtering
            research_brief: Optional research brief with enhanced_context for query enhancement
        """
        if not self.tavily_api_key:
            return await self.generate_sources_progressive(query, count, budget_limit)
        
        try:
            # Step 1: Extract domain filter from query if not already provided
            clean_query = query
            extracted_filter = None
            
            if not domain_filter:
                # Only extract from query if not explicitly provided
                clean_query, extracted_filter = self._extract_domain_filter(query)
                domain_filter = extracted_filter
            
            # Step 1.5: Build enhanced query using conversation context
            enhanced_query = self._build_enhanced_tavily_query(clean_query, research_brief)
            if research_brief and enhanced_query != clean_query:
                print(f"🔍 Context-Enhanced Query:")
                print(f"   Original: {clean_query}")
                print(f"   Enhanced: {enhanced_query}")
            
            # Step 2: Get raw Tavily results immediately (this is fast)
            tavily_query = enhanced_query[:350] if len(enhanced_query) > 350 else enhanced_query
            
            # Make async REST API call (non-blocking)
            # Request more results (30) to give Claude filtering more options
            max_results_count = min(count * 2, 30)
            print(f"🌐 Calling Tavily API - Query: '{tavily_query}', Max Results: {max_results_count}, Domains: {domain_filter}")
            response = await self._call_tavily_api(
                query=tavily_query,
                max_results=max_results_count,
                include_domains=domain_filter
            )
            
            raw_results = response.get('results', [])
            print(f"📥 Tavily returned {len(raw_results)} results")
            
            # Step 2.5: Apply Claude relevance filtering to all results using full conversation context
            # Lazy import to avoid circular dependency
            from services.ai.conversational import AIResearchService
            ai_filter = AIResearchService()
            
            # Extract conversation context and enhanced context from research brief
            conversation_context = None
            enhanced_context = None
            if research_brief:
                # Get conversation_context if it was stored in the brief
                conversation_context = research_brief.get("conversation_context")
                # Get enhanced_context from Claude extraction
                enhanced_context = research_brief.get("enhanced_context")
            
            results = await ai_filter.filter_search_results_by_relevance(
                query=clean_query,
                results=raw_results,
                publication=publication_name,  # Pass publication if available, None otherwise
                conversation_context=conversation_context,  # Pass full conversation for context-aware filtering
                enhanced_context=enhanced_context  # Pass enhanced context with geographic/temporal constraints
            )
            
            # Log context-aware filtering results
            if conversation_context or enhanced_context:
                filtered_count = len([r for r in results if r.get("is_relevant", True)])
                print(f"🎯 Claude Context Filter: {len(raw_results)} → {filtered_count} sources (conversation-aware)")
            
            # Step 3: Create basic source cards immediately with filtered Tavily data
            immediate_sources = []
            for i, result in enumerate(results[:count]):
                # Extract URL first (Tavily should always provide this)
                url = result.get('url')
                if not url:
                    print(f"⚠️  Warning: Tavily result missing URL, skipping")
                    continue
                
                try:
                    domain = url.split('/')[2]
                except:
                    domain = "unknown.com"
                
                source_id = str(uuid.uuid4())
                title = result.get('title', f'Research Source {i+1}')
                
                # Generate relevance score immediately for star ratings
                base_score = max(0.2, 1.0 - (i * 0.08))  # Position decay
                random_factor = random.uniform(-self.RANDOM_VARIANCE_RANGE, self.RANDOM_VARIANCE_RANGE)
                query_bonus = 0.2 if query.lower() in title.lower() else 0.0  # Query matching
                # Removed domain bonus - let DomainClassifier tier handle this instead
                credibility_penalty = self._get_credibility_penalty(url)  # Downrank social media/Wikipedia
                relevance_score = max(0.2, min(1.0, base_score + query_bonus + credibility_penalty + random_factor))
                
                # Classify source type based on domain
                source_type = self._classify_source_type(domain, url)
                
                # Start with free pricing - real licensing discovery will set authentic prices
                source = SourceCard(
                    id=source_id,
                    title=title,
                    excerpt=result.get('content', 'Loading enhanced summary...')[:2000],  # Expanded for rich report analysis
                    domain=domain,
                    url=url,
                    unlock_price=0.0,  # Will be set by licensing discovery
                    is_unlocked=False,
                    licensing_protocol=None,  # Will be set by licensing discovery 
                    licensing_cost=None,
                    relevance_score=relevance_score,  # Add relevance score immediately
                    source_type=source_type,  # Add source type for blended results
                    domain_tier=DomainClassifier.get_domain_tier(url)  # Premium/standard/blocked classification
                )
                
                # Check budget constraint
                current_cost = sum(s.unlock_price or 0 for s in immediate_sources)
                if budget_limit is None or (current_cost + source.unlock_price) <= budget_limit:
                    immediate_sources.append(source)
                else:
                    break
            
            # Step 3: Return skeleton cards immediately (NO BLOCKING)
            print(f"🚀 Returning {len(immediate_sources)} skeleton cards immediately...")
            
            # Cache skeleton sources IMMEDIATELY so they're available for purchase
            self._store_in_cache(cache_key, immediate_sources)
            print(f"💾 Skeleton sources cached (will be updated after enrichment)")
            
            # Step 4: Start background enrichment (licensing + content polishing) 
            asyncio.create_task(self._enrich_sources_progressive(
                immediate_sources, query, cache_key, classification
            ))
            
            return {
                "sources": immediate_sources,
                "stage": "skeleton",
                "enrichment_needed": True,
                "cache_key": cache_key,  # Frontend can poll for updates
                "timestamp": int(time.time())  # Fix #3: Force frontend refresh
            }
            
        except Exception as e:
            print(f"Progressive Tavily generation error: {e}")
            # Return empty results on error
            return {
                "sources": [],
                "stage": "error",
                "enrichment_needed": False
            }
    
    # Removed _calculate_basic_price - now using real licensing discovery only
    
    async def _enrich_sources_progressive(self, sources: List[SourceCard], query: str, cache_key: str, classification: Optional[Dict[str, Any]] = None):
        """Progressive enrichment: pricing discovery only (fast ~3s)"""
        try:
            print(f"🔍 Starting progressive enrichment for {len(sources)} sources...")
            
            # Licensing discovery (fast ~2-3s) - Tavily excerpts are already good enough!
            await self._add_licensing_async(sources)
            
            # Rerank sources with recency weighting (if classification available)
            sources = self._rerank_with_recency(sources, classification)
            print(f"🔄 Sources reranked (top 3: {[f'{s.title[:30]}... ({s.relevance_score:.2f})' for s in sources[:3]]})")
            
            # Cache pricing results - Tavily content is already compelling!
            self._store_in_cache(cache_key, sources)
            print(f"✅ Progressive enrichment completed - pricing cached in ~3 seconds")
            
        except Exception as e:
            print(f"❌ Progressive enrichment error: {e}")
            # Sources are still usable with basic Tavily data
    
    async def _polish_sources_claude(self, sources: List[SourceCard], query: str):
        """Polish sources with Claude summarization (free discovery phase)"""
        try:
            # Prepare raw sources for polishing  
            raw_sources = []
            for source in sources:
                raw_sources.append({
                    'url': source.url,
                    'domain': source.domain, 
                    'title': source.title,
                    'snippet': source.excerpt
                })
            
            print(f"🎨 Starting free Claude discovery summaries...")
            
            # Fix #1: Use run_in_executor to prevent blocking the event loop
            loop = asyncio.get_event_loop()
            polished_sources = await loop.run_in_executor(
                None,  # Use default threadpool
                self.ai_service.polish_sources,
                query,
                raw_sources
            )
            
            # Fix #2: Match by URL instead of index to prevent mismatch
            for polished in polished_sources:
                matching = next((s for s in sources if s.url == polished.get('url')), None)
                if matching and polished:
                    matching.title = polished.get('title', matching.title)
                    matching.excerpt = polished.get('excerpt', matching.excerpt)
            
            print(f"✅ Free Claude summarization completed")
            
        except Exception as e:
            print(f"❌ Claude polishing error: {e}")
            # Continue anyway - licensing is more important
    
    async def _add_licensing_async(self, sources: List[SourceCard]):
        """Add licensing info to sources asynchronously"""
        try:
            # Process licensing for all sources concurrently (up to 5 at once to avoid rate limits)
            async def add_single_license(source):
                try:
                    license_info = await self._discover_licensing(source.url)
                    if license_info:
                        # Boost is now applied in _apply_licensing_info for both async and sync paths
                        self._apply_licensing_info(source, license_info)
                except Exception as e:
                    print(f"Licensing error for {source.url}: {e}")
            
            # Process in batches of 5 to avoid overwhelming the licensing service
            for i in range(0, len(sources), 5):
                batch = sources[i:i+5]
                await asyncio.gather(*[add_single_license(source) for source in batch], return_exceptions=True)
                
        except Exception as e:
            print(f"Batch licensing error: {e}")

    async def generate_sources(self, query: str, count: int, budget_limit: Optional[float] = None) -> List[SourceCard]:
        """Generate source cards using Tavily AI search or fallback to mock data.
        
        Args:
            query: Research query
            count: Maximum number of sources to generate
            budget_limit: Maximum budget for licensing costs (60% of tier price)
        """
        return await self._generate_tavily_sources(query, count, budget_limit)
    
    async def _generate_tavily_sources(self, query: str, count: int, budget_limit: Optional[float] = None) -> List[SourceCard]:
        """Generate source cards using hybrid Tavily discovery + Claude polish approach."""
        if not self.tavily_api_key:
            return []
            
        try:
            # Step 1: Extract domain filter if present (for publication-specific searches)
            clean_query, domain_filter = self._extract_domain_filter(query)
            
            # Step 2: Tavily URL Discovery with query length truncation
            # Tavily has a 400 character limit, so truncate to 350 to be safe
            tavily_query = clean_query[:350] if len(clean_query) > 350 else clean_query
            
            # Make async REST API call with domain filter support
            # Request more results (30) to give Claude filtering more options
            response = await self._call_tavily_api(
                query=tavily_query,
                max_results=min(count * 2, 30),  # 2x requested count, max 30
                include_domains=domain_filter
            )
            
            results = response.get('results', [])
            
            # Step 2: Prepare raw source data for Claude polishing
            raw_sources = []
            for result in results[:count]:
                # Extract URL first (Tavily should always provide this)
                url = result.get('url')
                if not url:
                    print(f"⚠️  Warning: Tavily result missing URL in sync path, skipping")
                    continue
                
                try:
                    domain = url.split('/')[2]
                except:
                    domain = "unknown.com"
                    
                raw_sources.append({
                    'url': url,
                    'domain': domain,
                    'title': result.get('title', ''),
                    'snippet': result.get('content', '')[:150],  # Truncate for efficiency
                })
            
            # Step 3: Claude Content Polish (batch processing)
            polished_sources = self.ai_service.polish_sources(query, raw_sources)
            
            # Step 4: Create SourceCard objects with licensing and pricing
            sources = []
            for i, polished in enumerate(polished_sources):
                # Extract URL (should always be present from polishing)
                url = polished.get('url')
                if not url:
                    print(f"⚠️  Warning: Polished source missing URL, skipping")
                    continue
                
                source_id = str(uuid.uuid4())
                domain = polished.get('domain', 'unknown.com')
                title = polished.get('title', f'Research Source {i+1}')
                
                # Generate relevance score (0.2-1.0 range for better distribution)
                base_score = max(0.2, 1.0 - (i * 0.08))  # More aggressive position decay
                
                # Add some randomness for variety (±0.15)
                random_factor = random.uniform(-0.15, 0.15)
                
                # Bonuses for quality indicators
                query_bonus = 0.2 if query.lower() in title.lower() else 0.0
                domain_bonus = 0.15 if any(term in domain for term in ['edu', 'gov', 'research']) else 0.0
                credibility_penalty = self._get_credibility_penalty(url)  # Downrank social media/Wikipedia
                
                # Calculate final score with more spread
                relevance_score = max(0.2, min(1.0, base_score + query_bonus + domain_bonus + credibility_penalty + random_factor))
                
                # Start with free source - real licensing will set authentic price
                source = SourceCard(
                    id=source_id,
                    title=title,
                    excerpt=polished.get('excerpt', 'No preview available'),
                    domain=domain,
                    url=url,
                    unlock_price=0.0,  # Free by default, real licensing sets authentic price
                    is_unlocked=False,
                    relevance_score=relevance_score,
                    domain_tier=DomainClassifier.get_domain_tier(url)  # Premium/standard/blocked classification
                )
                
                # Step 5: Real licensing detection on actual URL
                license_info = await self._discover_licensing(url)
                print(f"🔍 License discovery for {url}: {license_info is not None}")
                if license_info:
                    print(f"📋 Applying licensing: protocol={license_info['terms'].protocol}, price={license_info['terms'].ai_include_price}")
                    self._apply_licensing_info(source, license_info)
                    print(f"✅ Source updated: protocol={source.licensing_protocol}, unlock_price={source.unlock_price}")
                
                # Check budget constraint before adding source
                if budget_limit is None or (self._calculate_total_cost(sources) + source.unlock_price) <= budget_limit:
                    sources.append(source)
                else:
                    break  # Budget exceeded, stop generating sources
            
            # CRITICAL: Sort sources by relevance AFTER paid source boost is applied
            sources.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
            print(f"🔄 Sync path: Sources sorted by relevance (top 3: {[f'{s.title[:30]}... ({s.relevance_score:.2f})' for s in sources[:3]] if sources else 'none'})")
            
            return sources
            
        except Exception as e:
            print(f"Hybrid Tavily+Claude generation error: {e}")
            # Return empty list on error - no mock fallback
            return []
    
    
    # Removed _calculate_unlock_price_by_type - real licensing APIs determine authentic pricing
    
    # Removed _get_licensing_protocol - real licensing discovery determines protocols
    
    # Removed _generate_new_mock_licensing - now using real ContentLicenseService
    
    def _get_publisher_name(self, domain: str) -> str:
        """Generate publisher name from domain."""
        # Extract main domain name for publisher
        if '.' in domain:
            name_part = domain.split('.')[0]
            return f"{name_part.capitalize()} Publishing"
        return "Unknown Publisher"
    
    def _truncate_content(self, content: str, max_length: int = 2000) -> str:
        """Truncate content to excerpt length for report analysis."""
        if len(content) <= max_length:
            return content
        return content[:max_length].rsplit(' ', 1)[0] + "..."
    
    # Removed fake pricing - now using real licensing discovery via ContentLicenseService
    
    # Removed fake free source detection - real licensing handles this
    
    # Removed fake premium domain detection - real licensing handles this
    
    # Removed fake academic domain detection - real licensing handles this
    
    # Removed fake quality multiplier - real licensing APIs determine authentic pricing
    
    def _extract_key_topics(self, query: str) -> List[str]:
        """Extract key topics from long query text."""
        import re
        
        # Remove overly generic wrappers like "Please research..." but preserve core terms
        clean_query = re.sub(r'(please research|search for|find information about)', '', query.lower())
        
        # Extract quoted terms and key phrases
        quoted_terms = re.findall(r'"([^"]+)"', query)
        
        # If we have quoted terms, use those as primary topics
        if quoted_terms:
            return [term.strip() for term in quoted_terms[:3]]  # Take first 3
        
        # Fallback: extract key noun phrases
        words = query.split()
        key_terms = []
        for i, word in enumerate(words[:20]):  # Look at first 20 words
            if len(word) > 4 and word.lower() not in ['based', 'used', 'improve', 'materials', 'research', 'writing', 'report']:
                key_terms.append(word)
                if len(key_terms) >= 3:
                    break
        
        # Default fallback
        if not key_terms:
            key_terms = ['advanced materials', 'emerging technologies', 'innovation']
        
        return key_terms[:3]
    
    def _generate_title(self, query: str, index: int) -> str:
        """Generate diverse, compelling titles based on source type."""
        topics = self._extract_key_topics(query)
        main_topic = topics[0] if topics else 'emerging technologies'
        
        # Define different source types with unique title patterns
        source_types = [
            # Academic Research Papers
            {
                'templates': [
                    f"Breakthrough Advances in {main_topic}: A Systematic Review",
                    f"Novel {main_topic} Applications: Performance Analysis and Future Outlook",
                    f"Optimizing {main_topic}: Computational Models and Experimental Validation",
                    f"Next-Generation {main_topic}: Materials Science Perspectives"
                ]
            },
            # Industry Reports
            {
                'templates': [
                    f"Market Analysis: {main_topic} Industry Trends and Forecasts 2024",
                    f"Commercial Deployment of {main_topic}: Case Studies and ROI Analysis",
                    f"Industry Insight: Scaling {main_topic} for Mass Production",
                    f"Technical Brief: {main_topic} Implementation Strategies"
                ]
            },
            # Case Studies
            {
                'templates': [
                    f"Real-World Success: {main_topic} Implementation at Global Tech Company",
                    f"Case Study: Transforming Infrastructure with {main_topic}",
                    f"Pilot Project Results: {main_topic} Performance in Live Environment",
                    f"Field Trial Analysis: {main_topic} Deployment Outcomes"
                ]
            },
            # News & Analysis
            {
                'templates': [
                    f"Breaking: Major {main_topic} Breakthrough Changes Industry Landscape",
                    f"Expert Analysis: Why {main_topic} is the Future of Technology",
                    f"Industry Leaders Bet Big on {main_topic} Innovation",
                    f"Emerging Trends: How {main_topic} is Disrupting Traditional Markets"
                ]
            }
        ]
        
        # Cycle through source types to ensure variety
        source_type = source_types[index % len(source_types)]
        template_index = (index // len(source_types)) % len(source_type['templates'])
        
        return source_type['templates'][template_index]
    
    def _generate_excerpt(self, query: str, title: str) -> str:
        """Generate compelling, diverse excerpts based on source type."""
        topics = self._extract_key_topics(query)
        main_topic = topics[0] if topics else 'emerging technologies'
        
        # Determine source type from title pattern
        title_lower = title.lower()
        
        if any(word in title_lower for word in ['breakthrough', 'systematic review', 'novel', 'optimizing']):
            # Academic research excerpts
            excerpts = [
                f"This groundbreaking study reveals how {main_topic} can achieve 40% efficiency improvements over conventional approaches, with experimental validation across three independent test facilities.",
                f"Our research team discovered a novel mechanism in {main_topic} that could revolutionize current industry standards, offering both cost reduction and performance enhancement.",
                f"Through rigorous testing and peer review, we demonstrate that {main_topic} applications show consistent performance gains of 25-50% in real-world deployment scenarios.",
                f"This comprehensive analysis of {main_topic} identifies three critical breakthrough areas that promise to transform how the industry approaches next-generation solutions."
            ]
        elif any(word in title_lower for word in ['market', 'industry', 'commercial', 'technical brief']):
            # Industry report excerpts
            excerpts = [
                f"Industry analysis shows {main_topic} market growing at 23% CAGR, with major corporations investing $2.3B in R&D and commercial deployment initiatives.",
                f"Leading manufacturers report 35% cost reduction and 60% performance improvement after implementing {main_topic} solutions in their production lines.",
                f"Market research indicates {main_topic} adoption will reach 45% of enterprise customers by 2025, driven by compelling ROI and regulatory advantages.",
                f"Executive survey reveals 78% of industry leaders consider {main_topic} a strategic priority, with 67% planning major investments within 18 months."
            ]
        elif any(word in title_lower for word in ['case study', 'real-world', 'pilot project', 'field trial']):
            # Case study excerpts
            excerpts = [
                f"Fortune 500 company reports 42% efficiency gain and $3.2M annual savings after implementing {main_topic} across their global infrastructure.",
                f"Six-month pilot program demonstrates {main_topic} reduces operational costs by 38% while improving system reliability to 99.7% uptime.",
                f"Multi-site deployment shows {main_topic} delivers consistent 30-45% performance improvements across diverse environmental conditions and usage patterns.",
                f"Customer testimonials highlight dramatic improvements in both efficiency and user satisfaction following {main_topic} implementation."
            ]
        else:
            # News/analysis excerpts
            excerpts = [
                f"Industry experts predict {main_topic} will disrupt the $150B market within five years, with early adopters already reporting significant competitive advantages.",
                f"Major breakthrough in {main_topic} technology promises to address critical industry challenges while creating new opportunities for innovation and growth.",
                f"Recent developments in {main_topic} are attracting attention from venture capitalists, with three startups raising $89M in Series A funding this quarter.",
                f"Technology leaders describe {main_topic} as a 'game-changer' that could fundamentally alter industry dynamics and create new market categories."
            ]
        
        return random.choice(excerpts)
    
    def _calculate_unlock_price(self, domain: str) -> float:
        """Calculate dynamic pricing based on source characteristics."""
        base_price = 0.10  # Minimum price
        max_price = 2.00   # Maximum price
        
        # Domain-based pricing factors
        premium_domains = ["nature.com", "science.org", "ieee.org", "jstor.org"]
        mid_tier_domains = ["springer.com", "wiley.com", "researchgate.net"]
        
        price_multiplier = 1.0
        
        if domain in premium_domains:
            price_multiplier = 1.8
        elif domain in mid_tier_domains:
            price_multiplier = 1.4
        else:
            price_multiplier = random.uniform(1.0, 1.6)
        
        # Add random quality factors
        if random.random() > 0.7:  # 30% chance of peer-reviewed bonus
            price_multiplier *= 1.2
        
        if random.random() > 0.8:  # 20% chance of recent publication bonus
            price_multiplier *= 1.1
        
        # Calculate final price
        final_price = base_price * price_multiplier
        
        # Ensure price is within bounds and rounded to cents
        final_price = min(max_price, max(base_price, final_price))
        return round(final_price, 2)
    
    async def _discover_licensing(self, url: str):
        """Discover content licensing for a given URL"""
        try:
            return await self.license_service.discover_licensing(url)
        except Exception as e:
            print(f"License discovery failed for {url}: {e}")
            return None
    
    def _apply_licensing_info(self, source: SourceCard, license_info: dict):
        """Apply licensing information to a source card"""
        if not license_info:
            return
            
        terms = license_info['terms']
        protocol = terms.protocol
        
        source.licensing_protocol = protocol.upper() if protocol else None
        source.licensing_cost = terms.ai_include_price  # PARTIAL_USE price for AI summaries
        source.publisher_name = terms.publisher
        source.license_type = "ai-include"
        source.requires_attribution = terms.requires_attribution
        
        # Use FULL_USE price for human readers unlocking sources
        # Use PARTIAL_USE price (licensing_cost) for AI report generation
        full_use_price = terms.purchase_price
        if full_use_price and full_use_price > 0:
            source.unlock_price = full_use_price
            
            # Boost relevance score for paid sources to prioritize credible content
            # This makes the platform feel more premium when paid sources are available
            paid_source_boost = 0.20  # Significant boost for licensed content
            old_score = source.relevance_score or 0.5
            source.relevance_score = min(1.0, old_score + paid_source_boost)
            print(f"💰 Boosted paid source '{source.title[:50]}...' from {old_score:.2f} to {source.relevance_score:.2f}")
        else:
            # If no full-use price, this should be a free source
            source.unlock_price = 0.0
    
    # Removed fake licensing generation - now using real ContentLicenseService
    
    async def get_estimated_cost(self, query: str, source_count: int) -> float:
        """Estimate total unlock cost for sources (for tier pricing)."""
        # Generate a sample to estimate average unlock price (without budget constraints for estimation)
        sample_sources = await self.generate_sources(query, min(10, source_count), budget_limit=None)
        if not sample_sources:
            return 0.0
        avg_unlock_price = sum(s.unlock_price for s in sample_sources) / len(sample_sources)
        return round(avg_unlock_price * source_count, 2)
    
    def _calculate_total_cost(self, sources: List[SourceCard]) -> float:
        """Calculate total licensing cost for a list of sources."""
        return sum(source.unlock_price for source in sources)