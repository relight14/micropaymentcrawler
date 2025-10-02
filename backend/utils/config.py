"""Configuration utilities"""

import os
from typing import Optional


def get_env_var(name: str, default: Optional[str] = None) -> Optional[str]:
    """Get environment variable with optional default"""
    return os.environ.get(name, default)


def is_mock_mode() -> bool:
    """Check if application is running in mock mode"""
    value = get_env_var("LEDEWIRE_USE_MOCK", "false")
    return value.lower() == "true" if value else False


def get_anthropic_api_key() -> Optional[str]:
    """Get Anthropic API key from environment"""
    return get_env_var("ANTHROPIC_API_KEY")


def get_tavily_api_key() -> Optional[str]:
    """Get Tavily API key from environment"""
    return get_env_var("TAVILY_API_KEY")