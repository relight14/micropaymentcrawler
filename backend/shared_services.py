"""
Shared service instances across the application.

This module provides singleton instances of services that need to share state
across different API routes, particularly for caching purposes.
"""

import logging
from services.research.crawler import ContentCrawlerStub

logger = logging.getLogger(__name__)

# Shared crawler instance - lazy loaded to avoid requiring TAVILY_API_KEY at import time
_crawler = None

def get_crawler():
    """
    Get or create shared crawler instance.
    Lazy loads to avoid failing at import time if TAVILY_API_KEY is missing.
    """
    global _crawler
    if _crawler is None:
        try:
            _crawler = ContentCrawlerStub()
        except Exception as e:
            logger.warning(f"Failed to initialize ContentCrawlerStub: {e}")
            _crawler = None
    return _crawler

# For backward compatibility
crawler = None  # Will be None if not initialized
