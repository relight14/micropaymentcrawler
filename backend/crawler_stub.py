import random
import uuid
import os
from typing import List, Optional
from tavily import TavilyClient
from models import SourceCard
from content_licensing import ContentLicenseService

class ContentCrawlerStub:
    """
    AI-powered content crawler using Tavily search API.
    Provides real-time research results with dynamic pricing.
    """
    
    def __init__(self):
        # Initialize Tavily client
        api_key = os.environ.get("TAVILY_API_KEY")
        if api_key:
            self.tavily_client = TavilyClient(api_key=api_key)
            self.use_real_search = True
        else:
            self.tavily_client = None
            self.use_real_search = False
            print("Warning: TAVILY_API_KEY not found, falling back to mock data")
        
        # Initialize content licensing service
        self.license_service = ContentLicenseService()
        
        # Content quality factors that influence pricing
        self.quality_factors = {
            "peer_reviewed": 1.5,
            "recent": 1.2,
            "high_citations": 1.4,
            "full_text": 1.3,
            "premium_journal": 1.6
        }
        
        # Diverse domains for realistic source variety
        self.domain_sets = {
            'academic': [
                "arxiv.org", "nature.com", "science.org", "ieee.org", "acm.org",
                "researchgate.net", "jstor.org", "springer.com", "wiley.com",
                "sciencedirect.com", "plos.org", "pubmed.ncbi.nlm.nih.gov"
            ],
            'industry': [
                "mckinsey.com", "deloitte.com", "pwc.com", "bcg.com", "accenture.com",
                "gartner.com", "forrester.com", "idc.com", "frost.com"
            ],
            'news': [
                "reuters.com", "bloomberg.com", "wsj.com", "ft.com", "economist.com",
                "techcrunch.com", "wired.com", "spectrum.ieee.org", "mit.edu"
            ],
            'government': [
                "energy.gov", "nist.gov", "nsf.gov", "doe.gov", "epa.gov"
            ]
        }
        
        # Fallback for compatibility
        self.sample_domains = self.domain_sets['academic']

    def generate_sources(self, query: str, count: int, budget_limit: Optional[float] = None) -> List[SourceCard]:
        """Generate source cards using Tavily AI search or fallback to mock data.
        
        Args:
            query: Research query
            count: Maximum number of sources to generate
            budget_limit: Maximum budget for licensing costs (60% of tier price)
        """
        if self.use_real_search:
            return self._generate_tavily_sources(query, count, budget_limit)
        else:
            return self._generate_mock_sources(query, count, budget_limit)
    
    def _generate_tavily_sources(self, query: str, count: int, budget_limit: Optional[float] = None) -> List[SourceCard]:
        """Generate source cards using Tavily AI search with budget constraints."""
        if not self.tavily_client:
            return self._generate_mock_sources(query, count)
            
        try:
            # Call Tavily API for real search results
            response = self.tavily_client.search(
                query=query,
                search_depth="advanced",
                max_results=min(count, 20),  # Tavily has limits
                include_answer=False,
                include_images=False,
                include_raw_content=False
            )
            
            sources = []
            results = response.get('results', [])
            
            for i, result in enumerate(results[:count]):
                source_id = str(uuid.uuid4())
                
                # Extract domain from URL
                try:
                    domain = result['url'].split('/')[2]
                except:
                    domain = "unknown.com"
                
                # Create source card from Tavily result
                source = SourceCard(
                    id=source_id,
                    title=result.get('title', f'Research Source {i+1}'),
                    excerpt=self._truncate_content(result.get('content', 'No preview available')),
                    domain=domain,
                    unlock_price=self._calculate_tavily_price(result, domain),
                    is_unlocked=False
                )
                
                # Check for content licensing
                license_info = self._discover_licensing(result.get('url', ''))
                if license_info:
                    self._apply_licensing_info(source, license_info)
                
                # Check budget constraint before adding source
                if budget_limit is None or (self._calculate_total_cost(sources) + source.unlock_price) <= budget_limit:
                    sources.append(source)
                else:
                    break  # Budget exceeded, stop generating sources
            
            # If we have fewer results than requested and budget allows, fill with mock data
            if len(sources) < count and (budget_limit is None or self._calculate_total_cost(sources) < budget_limit):
                remaining = count - len(sources)
                remaining_budget = budget_limit - self._calculate_total_cost(sources) if budget_limit else None
                mock_sources = self._generate_mock_sources(query, remaining, remaining_budget)
                sources.extend(mock_sources)
            
            return sources
            
        except Exception as e:
            print(f"Tavily API error: {e}")
            # Fallback to mock data on error
            return self._generate_mock_sources(query, count, budget_limit)
    
    def _generate_mock_sources(self, query: str, count: int, budget_limit: Optional[float] = None) -> List[SourceCard]:
        """Generate diverse, compelling mock source cards."""
        sources = []
        current_cost = 0.0
        
        # Ensure variety by cycling through domain types
        domain_types = list(self.domain_sets.keys())
        
        for i in range(count):
            # Cycle through domain types for variety
            domain_type = domain_types[i % len(domain_types)]
            domain = random.choice(self.domain_sets[domain_type])
            
            # Generate title and excerpt for this specific source
            title = self._generate_title(query, i)
            excerpt = self._generate_excerpt(query, title)
            
            # Calculate realistic pricing based on domain type
            unlock_price = self._calculate_unlock_price_by_type(domain, domain_type)
            
            # Check if adding this source would exceed budget
            if budget_limit is not None and (current_cost + unlock_price) > budget_limit:
                break
                
            source = SourceCard(
                id=str(uuid.uuid4()),
                title=title,
                excerpt=excerpt,
                domain=domain,
                unlock_price=unlock_price,
                is_unlocked=False
            )
            
            # Assign licensing protocols based on domain type  
            licensing_protocol = self._get_licensing_protocol(domain_type)
            if licensing_protocol:
                mock_license_info = self._generate_new_mock_licensing(domain, licensing_protocol)
                if mock_license_info:
                    self._apply_licensing_info(source, mock_license_info)
            
            sources.append(source)
            current_cost += unlock_price
        
        return sources
    
    def _calculate_unlock_price_by_type(self, domain: str, domain_type: str) -> float:
        """Calculate pricing based on domain type and prestige."""
        base_prices = {
            'academic': random.uniform(0.15, 0.35),
            'industry': random.uniform(0.20, 0.50),
            'news': random.uniform(0.10, 0.25),
            'government': random.uniform(0.05, 0.20)
        }
        
        base_price = base_prices.get(domain_type, 0.15)
        
        # Premium domain multipliers
        premium_multipliers = {
            'nature.com': 2.0, 'science.org': 1.8, 'ieee.org': 1.6,
            'mckinsey.com': 1.7, 'deloitte.com': 1.5, 'gartner.com': 1.6,
            'wsj.com': 1.4, 'economist.com': 1.3, 'bloomberg.com': 1.3
        }
        
        multiplier = premium_multipliers.get(domain, 1.0)
        final_price = base_price * multiplier
        
        # Add realistic variation
        final_price *= random.uniform(0.8, 1.2)
        
        return round(max(0.10, min(2.00, final_price)), 2)
    
    def _get_licensing_protocol(self, domain_type: str) -> Optional[str]:
        """Assign licensing protocols based on domain type."""
        protocol_weights = {
            'academic': {'rsl': 0.4, 'tollbit': 0.3, 'cloudflare': 0.2, None: 0.1},
            'industry': {'tollbit': 0.5, 'cloudflare': 0.3, 'rsl': 0.1, None: 0.1},
            'news': {'cloudflare': 0.6, 'tollbit': 0.2, 'rsl': 0.1, None: 0.1},
            'government': {None: 0.8, 'rsl': 0.1, 'tollbit': 0.1, 'cloudflare': 0.0}
        }
        
        weights = protocol_weights.get(domain_type, {'rsl': 0.3, 'tollbit': 0.3, 'cloudflare': 0.3, None: 0.1})
        
        # Use weighted random selection
        rand = random.random()
        cumulative = 0.0
        
        for protocol, weight in weights.items():
            cumulative += weight
            if rand <= cumulative:
                return protocol
        
        # Fallback
        return None
    
    def _generate_new_mock_licensing(self, domain: str, protocol: str = None) -> Optional[dict]:
        """Generate mock licensing information for sources."""
        if not protocol:
            protocol = random.choice(['rsl', 'tollbit', 'cloudflare'])
        
        base_cost = random.uniform(0.05, 0.30)
        
        # Import LicenseTerms for proper object creation
        from content_licensing import LicenseTerms
        
        terms = LicenseTerms(
            protocol=protocol,
            ai_include_price=round(base_cost, 2),
            publisher=self._get_publisher_name(domain),
            permits_ai_include=True,
            requires_attribution=random.choice([True, False])
        )
        
        return {
            'protocol': protocol,
            'terms': terms
        }
    
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
    
    def _calculate_tavily_price(self, result: dict, domain: str) -> float:
        """Calculate dynamic pricing for Tavily results based on content quality."""
        base_price = 0.10
        multiplier = 1.0
        
        # Quality factors based on content
        content = result.get('content', '').lower()
        title = result.get('title', '').lower()
        
        # Academic/research domains get higher pricing
        academic_domains = ['arxiv.org', 'nature.com', 'science.org', 'ieee.org', 'pubmed']
        if any(domain_part in domain for domain_part in academic_domains):
            multiplier *= 1.5
        
        # Longer, more detailed content
        if len(content) > 1000:
            multiplier *= 1.3
        
        # Research keywords in title
        research_keywords = ['study', 'research', 'analysis', 'findings', 'methodology']
        if any(keyword in title for keyword in research_keywords):
            multiplier *= 1.2
        
        # Calculate final price
        final_price = base_price * multiplier
        
        # Random variation for realism
        variation = random.uniform(0.8, 1.2)
        final_price *= variation
        
        # Ensure within bounds
        return round(max(0.10, min(2.00, final_price)), 2)
    
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
        
        source.licensing_protocol = protocol
        source.license_cost = terms.ai_include_price
        source.publisher_name = terms.publisher
        source.license_type = "ai-include"
        source.requires_attribution = terms.requires_attribution
        
        # Set protocol badge for UI
        protocol_badges = {
            'rsl': '🔒 RSL Licensed',
            'tollbit': '⚡ Tollbit Access',
            'cloudflare': '☁️ CF Licensed'
        }
        source.protocol_badge = protocol_badges.get(protocol, f'📋 {protocol.upper()} Licensed')
        
        # Update unlock price to include license cost if applicable
        if source.license_cost:
            source.unlock_price += source.license_cost
    
    def _generate_mock_licensing(self, domain: str):
        """Generate mock licensing info for demonstration"""
        protocols = ['rsl', 'tollbit', 'cloudflare']
        protocol = random.choice(protocols)
        
        # Mock license terms based on protocol
        from content_licensing import LicenseTerms
        
        price_ranges = {
            'rsl': (0.03, 0.08),
            'tollbit': (0.02, 0.05), 
            'cloudflare': (0.05, 0.12)
        }
        
        min_price, max_price = price_ranges[protocol]
        license_price = round(random.uniform(min_price, max_price), 2)
        
        terms = LicenseTerms(
            protocol=protocol,
            ai_include_price=license_price,
            publisher=f"{domain} Publisher",
            permits_ai_include=True,
            requires_attribution=random.choice([True, False])
        )
        
        return {
            'protocol': protocol,
            'terms': terms
        }
    
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