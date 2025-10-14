"""
Shared service instances across the application.
These singletons ensure data sharing (like caches) between different route modules.
"""

from services.research.crawler import ContentCrawlerStub

# Shared crawler instance - ensures cache is shared across all route modules
crawler = ContentCrawlerStub()

# Debug: Log crawler instance ID for verification
print(f"🔧 Shared crawler initialized with instance ID: {id(crawler)}")
