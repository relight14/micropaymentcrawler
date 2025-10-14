"""
Shared service instances across the application.

This module provides singleton instances of services that need to share state
across different API routes, particularly for caching purposes.
"""

from services.research.crawler import ContentCrawlerStub

# Shared crawler instance - used by both research and purchase routes
# to ensure they share the same in-memory cache
crawler = ContentCrawlerStub()
