"""Domain models and entities"""

from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from enum import Enum


class TierType(str, Enum):
    BASIC = "basic"
    RESEARCH = "research"
    PRO = "pro"


class SourceCard(BaseModel):
    """Source card model for research results"""
    id: str
    title: str
    url: str
    excerpt: str
    domain: str
    is_academic: bool = False
    published_date: Optional[str] = None
    licensing_protocol: Optional[str] = None
    licensing_cost: Optional[float] = None
    license_cost: Optional[float] = None  # Alternative naming
    publisher_name: Optional[str] = None
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