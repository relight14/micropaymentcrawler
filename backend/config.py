"""Production configuration and environment settings"""

import os
from typing import List, Optional


class Config:
    """Application configuration from environment variables"""
    
    # Environment
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    IS_PRODUCTION = ENVIRONMENT == "production"
    
    # CORS Configuration
    ALLOWED_ORIGINS: List[str] = []
    allowed_origins_env = os.getenv("ALLOWED_ORIGINS")
    if allowed_origins_env:
        ALLOWED_ORIGINS = [origin.strip() for origin in allowed_origins_env.split(",")]
    elif not IS_PRODUCTION:
        # Development fallback - but warn about it
        ALLOWED_ORIGINS = ["*"]
    
    # Database Configuration
    USE_POSTGRES = os.getenv("USE_POSTGRES", "true").lower() == "true"
    DATABASE_URL = os.getenv("DATABASE_URL")
    
    # API Keys (validated at startup)
    TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
    TOLLBIT_API_KEY = os.getenv("TOLLBIT_API_KEY")
    
    # LedeWire Configuration
    LEDEWIRE_API_URL = os.getenv("LEDEWIRE_API_URL", "https://api-staging.ledewire.com")
    
    # Rate Limiting
    RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
    DEFAULT_RATE_LIMIT = os.getenv("DEFAULT_RATE_LIMIT", "60/minute")
    RESEARCH_RATE_LIMIT = os.getenv("RESEARCH_RATE_LIMIT", "10/minute")
    REPORT_RATE_LIMIT = os.getenv("REPORT_RATE_LIMIT", "5/minute")
    
    # Budget Controls
    DAILY_USER_BUDGET_CENTS = int(os.getenv("DAILY_USER_BUDGET_CENTS", "1000"))  # $10 per user per day
    GLOBAL_DAILY_BUDGET_CENTS = int(os.getenv("GLOBAL_DAILY_BUDGET_CENTS", "100000"))  # $1000 per day total
    MAX_API_CALLS_PER_USER_PER_DAY = int(os.getenv("MAX_API_CALLS_PER_USER_PER_DAY", "100"))
    
    # API Cost Estimates (in cents)
    TAVILY_COST_PER_CALL = int(os.getenv("TAVILY_COST_PER_CALL", "10"))  # $0.10
    CLAUDE_HAIKU_COST_PER_CALL = int(os.getenv("CLAUDE_HAIKU_COST_PER_CALL", "5"))  # $0.05
    CLAUDE_SONNET_COST_PER_CALL = int(os.getenv("CLAUDE_SONNET_COST_PER_CALL", "100"))  # $1.00
    
    # Logging
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    STRUCTURED_LOGGING = os.getenv("STRUCTURED_LOGGING", "true").lower() == "true"
    
    @classmethod
    def validate(cls):
        """Validate critical configuration at startup"""
        errors = []
        
        if cls.IS_PRODUCTION and not cls.ALLOWED_ORIGINS:
            errors.append("ALLOWED_ORIGINS must be set in production")
        
        if cls.USE_POSTGRES and not cls.DATABASE_URL:
            errors.append("DATABASE_URL must be set when USE_POSTGRES=true")
        
        if not cls.TAVILY_API_KEY:
            errors.append("TAVILY_API_KEY is required")
        
        if not cls.ANTHROPIC_API_KEY:
            errors.append("ANTHROPIC_API_KEY is required")
        
        return errors
    
    @classmethod
    def get_summary(cls) -> dict:
        """Get configuration summary for logging (without secrets)"""
        return {
            "environment": cls.ENVIRONMENT,
            "use_postgres": cls.USE_POSTGRES,
            "rate_limit_enabled": cls.RATE_LIMIT_ENABLED,
            "cors_origins_count": len(cls.ALLOWED_ORIGINS),
            "daily_user_budget_cents": cls.DAILY_USER_BUDGET_CENTS,
            "structured_logging": cls.STRUCTURED_LOGGING,
        }


config = Config()
