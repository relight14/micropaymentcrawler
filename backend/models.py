from pydantic import BaseModel
from typing import List, Optional
from enum import Enum

class SourceCard(BaseModel):
    id: str
    title: str
    excerpt: str
    domain: str
    url: str  # Real URL for clickable links
    unlock_price: float
    is_unlocked: bool = False
    
    # Multi-protocol licensing support
    licensing_protocol: Optional[str] = None  # "rsl", "tollbit", "cloudflare"
    license_cost: Optional[float] = None  # Cost for ai-include license
    publisher_name: Optional[str] = None  # Publisher name from license terms
    license_type: Optional[str] = None  # Type of license available
    protocol_badge: Optional[str] = None  # UI badge text
    requires_attribution: bool = False  # Whether attribution is required

class ResearchPacket(BaseModel):
    query: str
    tier: Optional[str] = None  # For backward compatibility, but not used in dynamic system
    summary: str
    outline: Optional[str] = None
    insights: Optional[str] = None
    sources: List[SourceCard]
    total_sources: int
    total_cost: Optional[float] = None  # Dynamic cost of the package
    content_id: Optional[str] = None  # LedeWire content identifier

class PurchaseResponse(BaseModel):
    success: bool
    message: str
    wallet_deduction: float
    packet: Optional[ResearchPacket] = None
    licensing_summary: Optional[dict] = None  # Licensing cost breakdown
    license_tokens: Optional[List[dict]] = None  # Issued protocol tokens

# WalletDeduct models removed - handled directly through LedeWire API

class SourceUnlockRequest(BaseModel):
    source_id: str
    price: float
    title: str
    user_wallet_id: Optional[str] = None
    idempotency_key: Optional[str] = None  # Prevent double-spending

class SourceUnlockResponse(BaseModel):
    success: bool
    message: str
    wallet_deduction: float
    unlocked_content: Optional[str] = None

# Authentication Models
class LoginRequest(BaseModel):
    email: str
    password: str

class SignupRequest(BaseModel):
    email: str
    password: str
    name: str

class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_at: str

class WalletBalanceResponse(BaseModel):
    balance_cents: int