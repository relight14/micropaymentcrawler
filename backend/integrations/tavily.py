"""Tavily API integration"""

import os
from typing import Optional, List, Dict, Any


class TavilyClient:
    """Tavily API client wrapper"""
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("TAVILY_API_KEY")
        self.use_mock = not self.api_key
        
        if not self.use_mock:
            try:
                # Try to import tavily client
                from tavily import TavilyClient as ActualTavilyClient
                self.client = ActualTavilyClient(api_key=self.api_key)
            except ImportError:
                print("Tavily package not installed, using mock mode")
                self.use_mock = True
    
    def search(self, query: str, max_results: int = 10, search_depth: str = "basic", 
               include_answer: bool = False, include_images: bool = False, 
               include_raw_content: bool = False) -> Dict[str, Any]:
        """Search for sources using Tavily API"""
        if self.use_mock:
            return {"results": self._mock_search_results(query, max_results)}
        
        try:
            # Use actual Tavily API with all parameters
            response = self.client.search(
                query=query, 
                search_depth=search_depth, 
                max_results=max_results,
                include_answer=include_answer,
                include_images=include_images,
                include_raw_content=include_raw_content
            )
            return response
        except Exception as e:
            print(f"Tavily API error: {e}, falling back to mock")
            return {"results": self._mock_search_results(query, max_results)}
    
    def _mock_search_results(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        """Mock search results for development"""
        # Generate mock results based on query
        mock_results = []
        for i in range(min(max_results, 5)):
            mock_results.append({
                "title": f"Research Result {i+1}: {query}",
                "url": f"https://example.com/article-{i+1}",
                "content": f"This is a mock research result about {query}. It contains relevant information for testing purposes.",
                "score": 0.9 - (i * 0.1),
                "published_date": "2024-01-01"
            })
        
        return mock_results