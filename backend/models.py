from pydantic import BaseModel
from typing import List, Optional
from enum import Enum

class TierType(str, Enum):
    BASIC = "basic"
    RESEARCH = "research"
    PRO = "pro"

class TierInfo(BaseModel):
    tier: TierType
    price: float
    sources: int
    includes_outline: bool
    includes_insights: bool
    description: str

class TiersRequest(BaseModel):
    query: str

class TiersResponse(BaseModel):
    query: str
    tiers: List[TierInfo]

class PurchaseRequest(BaseModel):
    query: str
    tier: TierType
    user_wallet_id: Optional[str] = None

class SourceCard(BaseModel):
    id: str
    title: str
    excerpt: str
    domain: str
    unlock_price: float
    is_unlocked: bool = False

class ResearchPacket(BaseModel):
    query: str
    tier: TierType
    summary: str
    outline: Optional[str] = None
    insights: Optional[str] = None
    sources: List[SourceCard]
    total_sources: int
    content_id: Optional[str] = None  # LedeWire content identifier

class PurchaseResponse(BaseModel):
    success: bool
    message: str
    wallet_deduction: float
    packet: Optional[ResearchPacket] = None

class WalletDeductRequest(BaseModel):
    wallet_id: str
    amount: float
    description: str

class WalletDeductResponse(BaseModel):
    success: bool
    remaining_balance: float
    transaction_id: str

class SourceUnlockRequest(BaseModel):
    source_id: str
    price: float
    title: str
    user_wallet_id: Optional[str] = None

class SourceUnlockResponse(BaseModel):
    success: bool
    message: str
    wallet_deduction: float
    unlocked_content: Optional[str] = None