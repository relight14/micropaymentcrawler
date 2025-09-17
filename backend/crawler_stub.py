import random
import uuid
import os
from typing import List
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
        
        # Fallback domains for mock data
        self.sample_domains = [
            "arxiv.org", "nature.com", "science.org", "ieee.org", "acm.org",
            "researchgate.net", "jstor.org", "springer.com", "wiley.com",
            "sciencedirect.com", "plos.org", "biorxiv.org", "ssrn.com",
            "scholar.google.com", "pubmed.ncbi.nlm.nih.gov"
        ]

    def generate_sources(self, query: str, count: int) -> List[SourceCard]:
        """Generate source cards using Tavily AI search or fallback to mock data."""
        if self.use_real_search:
            return self._generate_tavily_sources(query, count)
        else:
            return self._generate_mock_sources(query, count)
    
    def _generate_tavily_sources(self, query: str, count: int) -> List[SourceCard]:
        """Generate source cards using Tavily AI search."""
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
                
                sources.append(source)
            
            # If we have fewer results than requested, fill with mock data
            if len(sources) < count:
                remaining = count - len(sources)
                mock_sources = self._generate_mock_sources(query, remaining)
                sources.extend(mock_sources)
            
            return sources
            
        except Exception as e:
            print(f"Tavily API error: {e}")
            # Fallback to mock data on error
            return self._generate_mock_sources(query, count)
    
    def _generate_mock_sources(self, query: str, count: int) -> List[SourceCard]:
        """Generate mock source cards (original logic)."""
        sources = []
        
        for i in range(count):
            source_id = str(uuid.uuid4())
            domain = random.choice(self.sample_domains)
            
            # Generate realistic titles based on query
            title = self._generate_title(query, i)
            excerpt = self._generate_excerpt(query, title)
            
            # Calculate dynamic pricing based on simulated quality factors
            unlock_price = self._calculate_unlock_price(domain)
            
            source = SourceCard(
                id=source_id,
                title=title,
                excerpt=excerpt,
                domain=domain,
                unlock_price=unlock_price,
                is_unlocked=False
            )
            
            # For mock sources, occasionally simulate licensing (20% chance for demo)
            if random.random() < 0.2:
                mock_license_info = self._generate_mock_licensing(domain)
                if mock_license_info:
                    self._apply_licensing_info(source, mock_license_info)
            
            sources.append(source)
        
        return sources
    
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
    
    def _generate_title(self, query: str, index: int) -> str:
        """Generate realistic academic titles."""
        templates = [
            f"Advanced Research on {query}: Methods and Applications",
            f"A Comprehensive Study of {query} in Modern Context",
            f"{query}: Recent Developments and Future Perspectives",
            f"Theoretical Framework for Understanding {query}",
            f"Empirical Analysis of {query}: Case Studies",
            f"{query} and Its Implications for Scientific Research",
            f"Novel Approaches to {query}: A Systematic Review",
            f"The Impact of {query} on Contemporary Science",
            f"{query}: Methodological Innovations and Findings",
            f"Exploring {query} Through Interdisciplinary Lens"
        ]
        
        if index < len(templates):
            return templates[index]
        else:
            return f"Research Paper #{index + 1} on {query}"
    
    def _generate_excerpt(self, query: str, title: str) -> str:
        """Generate realistic academic excerpts."""
        excerpts = [
            f"This paper presents a comprehensive analysis of {query}, examining key methodologies and their applications in current research paradigms.",
            f"We investigate the fundamental principles underlying {query} and propose new theoretical frameworks for understanding its mechanisms.",
            f"Through systematic review and meta-analysis, this study explores the current state of {query} research and identifies future directions.",
            f"Our findings demonstrate significant advances in {query} research, with implications for both theoretical understanding and practical applications.",
            f"This research contributes to the growing body of literature on {query} by presenting novel empirical evidence and analytical approaches.",
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
    
    def _discover_licensing(self, url: str) -> dict:
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
    
    def _generate_mock_licensing(self, domain: str) -> dict:
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
        # Generate a sample to estimate average unlock price
        sample_sources = self.generate_sources(query, min(10, source_count))
        avg_unlock_price = sum(s.unlock_price for s in sample_sources) / len(sample_sources)
        return round(avg_unlock_price * source_count, 2)