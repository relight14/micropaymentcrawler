"""Domain models and entities"""

from pydantic import BaseModel
from typing import Dict, Any, Optional, List


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
    author: Optional[str] = None  # Article author
    is_academic: bool = False
    published_date: Optional[str] = None
    relevance_score: Optional[float] = None
    source_type: Optional[str] = None  # "academic", "journalism", "business", "government"
    composite_score: Optional[float] = None  # Recency-weighted composite ranking score
    domain_tier: Optional[str] = None  # "premium", "standard", "blocked" for quality classification
    
    # Uploaded file fields
    is_uploaded_file: bool = False  # Flag to indicate if this source is an uploaded file
    file_id: Optional[int] = None  # Database ID for uploaded files
    file_type: Optional[str] = None  # File extension/type (e.g., 'docx', 'md')
    content_preview: Optional[str] = None  # Preview text for uploaded files


class ResearchPacket(BaseModel):
    """Research packet model containing sources and analysis"""
    query: str
    summary: str  # High-level overview of research
    sources: List[SourceCard]
    total_sources: int  # For UI display
    # Optional fields
    outline: Optional[str] = None
    insights: Optional[str] = None  # Research directions
    total_cost: Optional[float] = None
    content_id: Optional[str] = None  # LedeWire content identifier
    licensing_summary: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    citation_metadata: Optional[Dict[int, Dict[str, Any]]] = None  # Maps citation [N] to source metadata for inline purchase badges
    table_data: Optional[List[Dict[str, Any]]] = None  # Structured table data: [{topic, source, content, takeaway, link}]
    conflicts: Optional[str] = None  # Agreement/conflict analysis