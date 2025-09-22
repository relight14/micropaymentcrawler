"""Static file utilities with cache control"""

from fastapi.staticfiles import StaticFiles
from fastapi import Response
from typing import Any


class NoCacheStaticFiles(StaticFiles):
    """Static file server with no-cache headers to prevent browser caching issues"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
    
    def file_response(self, *args, **kwargs) -> Response:
        """Override to add no-cache headers"""
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache" 
        response.headers["Expires"] = "0"
        return response