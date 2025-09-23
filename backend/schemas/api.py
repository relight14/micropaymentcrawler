"""API request and response schemas"""

from pydantic import BaseModel, EmailStr
from typing import Dict, Any, Optional, List
from enum import Enum


class TierType(str, Enum):
    BASIC = "basic"
    RESEARCH = "research"
    PRO = "pro"


# Authentication schemas
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    user_id: str
    success: bool
    message: str


class WalletBalanceResponse(BaseModel):
    balance_cents: int
    balance_display: str
    currency: str = "USD"


# Pricing schemas
class TiersRequest(BaseModel):
    query: str


class TierInfo(BaseModel):
    tier: TierType
    price: float
    sources: int
    includes_outline: bool
    includes_insights: bool
    description: str


class TiersResponse(BaseModel):
    query: str
    tiers: List[TierInfo]


# Purchase schemas
class PurchaseRequest(BaseModel):
    query: str
    tier: TierType
    idempotency_key: Optional[str] = None


class PurchaseResponse(BaseModel):
    success: bool
    message: str
    packet: Optional[Dict[str, Any]] = None
    wallet_deduction: float


# Source unlock schemas
class SourceUnlockRequest(BaseModel):
    source_id: str
    idempotency_key: str


class SourceUnlockResponse(BaseModel):
    success: bool
    message: str
    unlocked_content: str
    remaining_balance_cents: int
    wallet_deduction: float