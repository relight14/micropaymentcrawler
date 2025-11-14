"""
Domain Quality Classification System
Categorizes domains into premium, standard, and blocked tiers for source quality control.
"""
from typing import Dict, List, Set
from urllib.parse import urlparse


class DomainClassifier:
    """Classifies domains by quality tier and provides filtering utilities."""
    
    # Premium Tier: Major publications, academic institutions, government sources
    PREMIUM_DOMAINS = {
        # Major US Publications
        "nytimes.com", "www.nytimes.com",
        "wsj.com", "www.wsj.com",
        "washingtonpost.com", "www.washingtonpost.com",
        "ft.com", "www.ft.com",
        "economist.com", "www.economist.com",
        "reuters.com", "www.reuters.com",
        "apnews.com", "www.apnews.com",
        "bloomberg.com", "www.bloomberg.com",
        "npr.org", "www.npr.org",
        "pbs.org", "www.pbs.org",
        "propublica.org", "www.propublica.org",
        
        # International Publications
        "bbc.com", "www.bbc.com", "bbc.co.uk", "www.bbc.co.uk",
        "theguardian.com", "www.theguardian.com",
        "telegraph.co.uk", "www.telegraph.co.uk",
        
        # Academic Publishers
        "nature.com", "www.nature.com",
        "science.org", "www.science.org",
        "sciencedirect.com", "www.sciencedirect.com",
        "springer.com", "www.springer.com",
        "wiley.com", "www.wiley.com",
        "jstor.org", "www.jstor.org",
        "pubmed.ncbi.nlm.nih.gov",
        "ncbi.nlm.nih.gov",
        "nih.gov", "www.nih.gov",
        "cdc.gov", "www.cdc.gov",
        
        # Think Tanks & Research Institutions
        "brookings.edu", "www.brookings.edu",
        "rand.org", "www.rand.org",
        "pewresearch.org", "www.pewresearch.org",
        "cfr.org", "www.cfr.org",
        
        # Business & Tech
        "harvard.edu", "hbr.org", "www.hbr.org",
        "mckinsey.com", "www.mckinsey.com",
        "bcg.com", "www.bcg.com",
        "techcrunch.com", "www.techcrunch.com",
        "wired.com", "www.wired.com",
        "arstechnica.com", "arstechnica.com",
        "theverge.com", "www.theverge.com",
    }
    
    # Premium Domain Patterns (wildcards)
    PREMIUM_PATTERNS = [
        ".edu",  # Educational institutions
        ".gov",  # Government sites
        ".ac.uk",  # UK academic institutions
    ]
    
    # Blocked Tier: Social media, UGC, low-quality sources
    BLOCKED_DOMAINS = {
        # Social Media
        "twitter.com", "www.twitter.com",
        "x.com", "www.x.com",
        "facebook.com", "www.facebook.com",
        "instagram.com", "www.instagram.com",
        "tiktok.com", "www.tiktok.com",
        "linkedin.com", "www.linkedin.com",
        "reddit.com", "www.reddit.com",
        
        # User-Generated Q&A
        "quora.com", "www.quora.com",
        "answers.yahoo.com",
        
        # Video Platforms
        "youtube.com", "www.youtube.com",
        
        # General Encyclopedia (not suitable for premium research)
        "wikipedia.org", "en.wikipedia.org", "www.wikipedia.org",
        
        # Content Farms & Low Quality
        "buzzfeed.com", "www.buzzfeed.com",
        "listverse.com", "www.listverse.com",
        "ehow.com", "www.ehow.com",
    }
    
    def __init__(self):
        """Initialize the domain classifier."""
        pass
    
    @classmethod
    def get_domain_tier(cls, url: str) -> str:
        """
        Classify a URL into premium, standard, or blocked tier.
        
        Args:
            url: Full URL to classify
            
        Returns:
            Tier string: "premium", "standard", or "blocked"
        """
        domain = cls._extract_domain(url)
        
        # Check blocked first
        if domain in cls.BLOCKED_DOMAINS:
            return "blocked"
        
        # Check premium exact matches
        if domain in cls.PREMIUM_DOMAINS:
            return "premium"
        
        # Check premium patterns
        for pattern in cls.PREMIUM_PATTERNS:
            if domain.endswith(pattern):
                return "premium"
        
        # Default to standard tier
        return "standard"
    
    @classmethod
    def _extract_domain(cls, url: str) -> str:
        """Extract normalized domain from URL."""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            # Remove port if present
            domain = domain.split(':')[0]
            return domain
        except Exception:
            return url.lower()
    
    @classmethod
    def get_exclude_list(cls) -> List[str]:
        """Get list of domains to exclude from Tavily searches."""
        return sorted(list(cls.BLOCKED_DOMAINS))
    
    @classmethod
    def is_premium(cls, url: str) -> bool:
        """Check if URL is from a premium source."""
        return cls.get_domain_tier(url) == "premium"
    
    @classmethod
    def is_blocked(cls, url: str) -> bool:
        """Check if URL should be blocked."""
        return cls.get_domain_tier(url) == "blocked"
    
    @classmethod
    def filter_sources(cls, sources: List[Dict]) -> List[Dict]:
        """
        Filter out blocked sources from a list.
        
        Args:
            sources: List of source dicts with 'url' key
            
        Returns:
            Filtered list excluding blocked domains
        """
        return [s for s in sources if not cls.is_blocked(s.get('url', ''))]
    
    @classmethod
    def rank_sources_by_quality(cls, sources: List[Dict], has_licensing: Set[str] = None) -> List[Dict]:
        """
        Rank sources by quality: premium + licensed > premium > standard.
        
        Args:
            sources: List of source dicts with 'url' key
            has_licensing: Set of URLs that have Tollbit/RSL licensing
            
        Returns:
            Sorted list with highest quality sources first
        """
        has_licensing = has_licensing or set()
        
        def quality_score(source: Dict) -> tuple:
            url = source.get('url', '')
            tier = cls.get_domain_tier(url)
            has_license = url in has_licensing
            
            # Return tuple for sorting (higher is better)
            # Priority: (tier_score, has_license)
            tier_score = {
                "premium": 2,
                "standard": 1,
                "blocked": 0
            }.get(tier, 1)
            
            return (tier_score, has_license)
        
        return sorted(sources, key=quality_score, reverse=True)
