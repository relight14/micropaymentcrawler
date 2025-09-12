import random
import uuid
from typing import List
from models import SourceCard

class ContentCrawlerStub:
    """
    Simulates content crawling with dynamic pricing.
    In production, this will interface with Cloudflare's Pay-Per-Crawl API.
    """
    
    def __init__(self):
        # Sample domains and content types for simulation
        self.sample_domains = [
            "arxiv.org", "nature.com", "science.org", "ieee.org", "acm.org",
            "researchgate.net", "jstor.org", "springer.com", "wiley.com",
            "sciencedirect.com", "plos.org", "biorxiv.org", "ssrn.com",
            "scholar.google.com", "pubmed.ncbi.nlm.nih.gov"
        ]
        
        # Content quality factors that influence pricing
        self.quality_factors = {
            "peer_reviewed": 1.5,
            "recent": 1.2,
            "high_citations": 1.4,
            "full_text": 1.3,
            "premium_journal": 1.6
        }

    def generate_sources(self, query: str, count: int) -> List[SourceCard]:
        """Generate simulated source cards with dynamic pricing."""
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
            
            sources.append(source)
        
        return sources
    
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
    
    def get_estimated_cost(self, query: str, source_count: int) -> float:
        """Estimate total unlock cost for sources (for tier pricing)."""
        # Generate a sample to estimate average unlock price
        sample_sources = self.generate_sources(query, min(10, source_count))
        avg_unlock_price = sum(s.unlock_price for s in sample_sources) / len(sample_sources)
        return round(avg_unlock_price * source_count, 2)