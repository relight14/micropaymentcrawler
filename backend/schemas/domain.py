"""Domain models and entities"""

from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from enum import Enum


class TierType(str, Enum):
    BASIC = "basic"
    RESEARCH = "research"
    PRO = "pro"


class SourceCard(BaseModel):
    """Source card model for research results with Discovery Mode support"""
    id: str
    title: str
    url: str
    excerpt: str
    domain: str
    
    # Discovery Mode fields
    unlock_price: float
    is_unlocked: bool = False
    
    # Multi-protocol licensing support
    licensing_protocol: Optional[str] = None  # "rsl", "tollbit", "cloudflare"
    license_cost: Optional[float] = None  # Cost for ai-include license
    licensing_cost: Optional[float] = None  # Alternative naming for backward compatibility
    publisher_name: Optional[str] = None  # Publisher name from license terms
    license_type: Optional[str] = None  # Type of license available
    protocol_badge: Optional[str] = None  # UI badge text
    requires_attribution: bool = False  # Whether attribution is required
    
    # Additional metadata
    is_academic: bool = False
    published_date: Optional[str] = None
    relevance_score: Optional[float] = None


class ResearchPacket(BaseModel):
    """Research packet model containing sources and analysis"""
    content_id: str
    query: str
    tier: TierType
    sources: List[SourceCard]
    outline: Optional[str] = None
    insights: Optional[str] = None
    total_cost: float
    licensing_summary: Optional[Dict[str, Any]] = None
    created_at: str