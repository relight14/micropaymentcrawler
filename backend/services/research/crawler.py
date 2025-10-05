import random
import uuid
import os
import asyncio
import time
import requests
from typing import List, Optional, Dict, Any
from schemas.domain import SourceCard
from services.licensing.content_licensing import ContentLicenseService
from services.ai.polishing import ContentPolishingService

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
        
        # Content quality factors that influence pricing
        self.quality_factors = {
            "peer_reviewed": 1.5,
            "recent": 1.2,
            "high_citations": 1.4,
            "full_text": 1.3,
            "premium_journal": 1.6
        }
        
    
    def _get_cache_key(self, query: str, count: int, budget_limit: Optional[float] = None, domain_filter: Optional[List[str]] = None) -> str:
        """Generate cache key for query results including domain filter for cache isolation"""
        # Convert domain filter to sorted tuple for consistent hashing
        domain_key = tuple(sorted(domain_filter)) if domain_filter else None
        return f"search:{hash(query)}:{count}:{budget_limit or 0}:{hash(domain_key)}"
    
    def _is_cache_valid(self, timestamp: float) -> bool:
        """Check if cached result is still valid"""
        return time.time() - timestamp < self._cache_ttl
    
    def _get_from_cache(self, cache_key: str) -> Optional[List[SourceCard]]:
        """Retrieve results from cache if valid"""
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
    
    async def generate_sources_progressive(self, query: str, count: int, budget_limit: Optional[float] = None, domain_filter: Optional[List[str]] = None) -> Dict[str, Any]:
        """Generate sources with progressive loading - returns immediate results + enrichment promise
        
        Args:
            query: Search query
            count: Number of sources to generate
            budget_limit: Optional budget limit for licensing
            domain_filter: Optional list of domains to filter results (e.g., ['nytimes.com'])
        """
        cache_key = self._get_cache_key(query, count, budget_limit, domain_filter)
        
        # Check cache first
        cached_result = self._get_from_cache(cache_key)
        if cached_result:
            return {
                "sources": cached_result,
                "stage": "complete",
                "enrichment_needed": False
            }
        
        return await self._generate_tavily_sources_progressive(query, count, budget_limit, cache_key, domain_filter)
    
    def _call_tavily_api(self, query: str, max_results: int = 20, include_domains: Optional[List[str]] = None) -> Dict[str, Any]:
        """Make direct REST API call to Tavily search endpoint."""
        payload = {
            "api_key": self.tavily_api_key,
            "query": query,
            "search_depth": "advanced",
            "max_results": max_results,
            "include_answer": False,
            "include_images": False,
            "include_raw_content": False
        }
        
        # Add domain filter if provided
        if include_domains:
            payload["include_domains"] = include_domains
            print(f"📰 Tavily REST API call with domain filter: {include_domains}")
        
        try:
            response = requests.post(self.tavily_api_url, json=payload, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
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
    
    async def _generate_tavily_sources_progressive(self, query: str, count: int, budget_limit: Optional[float], cache_key: str, domain_filter: Optional[List[str]] = None) -> Dict[str, Any]:
        """Generate sources progressively: immediate raw results + background enrichment
        
        Args:
            query: Search query (may contain site: operators for backward compatibility)
            count: Number of sources
            budget_limit: Budget limit
            cache_key: Cache key
            domain_filter: Optional domain filter from publication detection (takes precedence)
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
            
            # Step 2: Get raw Tavily results immediately (this is fast)
            tavily_query = clean_query[:350] if len(clean_query) > 350 else clean_query
            
            # Make REST API call (run in executor to avoid blocking)
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: self._call_tavily_api(
                    query=tavily_query,
                    max_results=min(count, 20),
                    include_domains=domain_filter
                )
            )
            
            results = response.get('results', [])
            
            # Step 2: Create basic source cards immediately with Tavily data
            immediate_sources = []
            for i, result in enumerate(results[:count]):
                try:
                    domain = result['url'].split('/')[2]
                except:
                    domain = "unknown.com"
                
                source_id = str(uuid.uuid4())
                title = result.get('title', f'Research Source {i+1}')
                
                # Generate relevance score immediately for star ratings
                base_score = max(0.2, 1.0 - (i * 0.08))  # Position decay
                random_factor = random.uniform(-0.15, 0.15)  # Variety
                query_bonus = 0.2 if query.lower() in title.lower() else 0.0  # Query matching
                domain_bonus = 0.15 if any(term in domain for term in ['edu', 'gov', 'research']) else 0.0  # Authority
                relevance_score = max(0.2, min(1.0, base_score + query_bonus + domain_bonus + random_factor))
                
                # Start with free pricing - real licensing discovery will set authentic prices
                source = SourceCard(
                    id=source_id,
                    title=title,
                    excerpt=result.get('content', 'Loading enhanced summary...')[:150],
                    domain=domain,
                    url=result.get('url', f'https://{domain}'),
                    unlock_price=0.0,  # Will be set by licensing discovery
                    is_unlocked=False,
                    licensing_protocol=None,  # Will be set by licensing discovery 
                    licensing_cost=None,
                    relevance_score=relevance_score  # Add relevance score immediately
                )
                
                # Check budget constraint
                current_cost = sum(s.unlock_price or 0 for s in immediate_sources)
                if budget_limit is None or (current_cost + source.unlock_price) <= budget_limit:
                    immediate_sources.append(source)
                else:
                    break
            
            # Step 3: Return skeleton cards immediately (NO BLOCKING)
            print(f"🚀 Returning {len(immediate_sources)} skeleton cards immediately...")
            
            # Step 4: Start background enrichment (licensing + content polishing) 
            asyncio.create_task(self._enrich_sources_progressive(
                immediate_sources, query, cache_key
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
    
    async def _enrich_sources_progressive(self, sources: List[SourceCard], query: str, cache_key: str):
        """Progressive enrichment: licensing discovery + Claude polishing in parallel"""
        try:
            print(f"🔍 Starting progressive enrichment for {len(sources)} sources...")
            
            # Run licensing and Claude in parallel for maximum speed
            licensing_task = asyncio.create_task(self._add_licensing_async(sources))
            claude_task = asyncio.create_task(self._polish_sources_claude(sources, query))
            
            # Wait for both to complete
            await asyncio.gather(licensing_task, claude_task, return_exceptions=True)
            
            print(f"✅ Progressive enrichment completed")
            
            # CRITICAL: Re-sort sources by relevance score AFTER paid source boost is applied
            # This ensures paid sources with boosted scores appear at the top
            sources.sort(key=lambda x: x.relevance_score or 0.0, reverse=True)
            print(f"🔄 Sources re-sorted by relevance (top 3: {[f'{s.title[:30]}... ({s.relevance_score:.2f})' for s in sources[:3]]})")
            
            # Cache the final enriched AND sorted results 
            self._store_in_cache(cache_key, sources)
            print(f"💾 Enriched sources cached with key: {cache_key}")
            
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
                    license_info = self._discover_licensing(source.url)
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

    def generate_sources(self, query: str, count: int, budget_limit: Optional[float] = None) -> List[SourceCard]:
        """Generate source cards using Tavily AI search or fallback to mock data.
        
        Args:
            query: Research query
            count: Maximum number of sources to generate
            budget_limit: Maximum budget for licensing costs (60% of tier price)
        """
        return self._generate_tavily_sources(query, count, budget_limit)
    
    def _generate_tavily_sources(self, query: str, count: int, budget_limit: Optional[float] = None) -> List[SourceCard]:
        """Generate source cards using hybrid Tavily discovery + Claude polish approach."""
        if not self.tavily_api_key:
            return []
            
        try:
            # Step 1: Extract domain filter if present (for publication-specific searches)
            clean_query, domain_filter = self._extract_domain_filter(query)
            
            # Step 2: Tavily URL Discovery with query length truncation
            # Tavily has a 400 character limit, so truncate to 350 to be safe
            tavily_query = clean_query[:350] if len(clean_query) > 350 else clean_query
            
            # Make REST API call with domain filter support
            response = self._call_tavily_api(
                query=tavily_query,
                max_results=min(count, 20),
                include_domains=domain_filter
            )
            
            results = response.get('results', [])
            
            # Step 2: Prepare raw source data for Claude polishing
            raw_sources = []
            for result in results[:count]:
                try:
                    domain = result['url'].split('/')[2]
                except:
                    domain = "unknown.com"
                    
                raw_sources.append({
                    'url': result.get('url', f'https://{domain}'),
                    'domain': domain,
                    'title': result.get('title', ''),
                    'snippet': result.get('content', '')[:150],  # Truncate for efficiency
                })
            
            # Step 3: Claude Content Polish (batch processing)
            polished_sources = self.ai_service.polish_sources(query, raw_sources)
            
            # Step 4: Create SourceCard objects with licensing and pricing
            sources = []
            for i, polished in enumerate(polished_sources):
                source_id = str(uuid.uuid4())
                url = polished.get('url', f'https://{polished.get("domain", "unknown.com")}')
                domain = polished.get('domain', 'unknown.com')
                title = polished.get('title', f'Research Source {i+1}')
                
                # Generate relevance score (0.2-1.0 range for better distribution)
                base_score = max(0.2, 1.0 - (i * 0.08))  # More aggressive position decay
                
                # Add some randomness for variety (±0.15)
                random_factor = random.uniform(-0.15, 0.15)
                
                # Bonuses for quality indicators
                query_bonus = 0.2 if query.lower() in title.lower() else 0.0
                domain_bonus = 0.15 if any(term in domain for term in ['edu', 'gov', 'research']) else 0.0
                
                # Calculate final score with more spread
                relevance_score = max(0.2, min(1.0, base_score + query_bonus + domain_bonus + random_factor))
                
                # Start with free source - real licensing will set authentic price
                source = SourceCard(
                    id=source_id,
                    title=title,
                    excerpt=polished.get('excerpt', 'No preview available'),
                    domain=domain,
                    url=url,
                    unlock_price=0.0,  # Free by default, real licensing sets authentic price
                    is_unlocked=False,
                    relevance_score=relevance_score
                )
                
                # Step 5: Real licensing detection on actual URL
                license_info = self._discover_licensing(url)
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
    
    def _truncate_content(self, content: str, max_length: int = 200) -> str:
        """Truncate content to excerpt length."""
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
        
        # Remove common research phrases and extract core topics
        clean_query = re.sub(r'(research query|search terms|based on|comprehensive|analysis|report)', '', query.lower())
        
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
    
    def _discover_licensing(self, url: str):
        """Discover content licensing for a given URL"""
        try:
            return self.license_service.discover_licensing(url)
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
    
    def get_estimated_cost(self, query: str, source_count: int) -> float:
        """Estimate total unlock cost for sources (for tier pricing)."""
        # Generate a sample to estimate average unlock price (without budget constraints for estimation)
        sample_sources = self.generate_sources(query, min(10, source_count), budget_limit=None)
        if not sample_sources:
            return 0.0
        avg_unlock_price = sum(s.unlock_price for s in sample_sources) / len(sample_sources)
        return round(avg_unlock_price * source_count, 2)
    
    def _calculate_total_cost(self, sources: List[SourceCard]) -> float:
        """Calculate total licensing cost for a list of sources."""
        return sum(source.unlock_price for source in sources)