"""Anthropic API client factory"""

import os
from typing import Optional
import anthropic


def create_anthropic_client(api_key: Optional[str] = None) -> Optional[anthropic.Anthropic]:
    """Create Anthropic client with proper configuration"""
    key = api_key or os.environ.get('ANTHROPIC_API_KEY')
    
    if not key:
        print("Warning: ANTHROPIC_API_KEY not found")
        return None
    
    try:
        return anthropic.Anthropic(api_key=key)
    except Exception as e:
        print(f"Failed to initialize Anthropic client: {e}")
        return None


def get_default_model() -> str:
    """Get the default Claude model to use"""
    return "claude-3-haiku-20240307"