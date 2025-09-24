"""API request and response schemas"""

from pydantic import BaseModel, EmailStr
from typing import Dict, Any, Optional, List
from enum import Enum


# Authentication schemas
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: str


class AuthResponse(BaseModel):
    access_token: str
    user_id: str
    success: bool
    message: str


class WalletBalanceResponse(BaseModel):
    balance_cents: int
    balance_display: str
    currency: str = "USD"


# Dynamic Research schemas
class ResearchRequest(BaseModel):
    query: str
    max_budget_dollars: Optional[float] = 10.0  # User budget limit
    preferred_source_count: Optional[int] = 15  # Desired number of sources
    conversation_context: Optional[List[Dict[str, str]]] = None  # Chat history for context


class DynamicResearchResponse(BaseModel):
    query: str
    total_estimated_cost: float
    source_count: int
    premium_source_count: int
    research_summary: str
    sources: List[Dict[str, Any]]
    licensing_breakdown: Dict[str, Any]
    # Progressive loading fields
    enrichment_status: Optional[str] = "complete"  # "immediate", "complete"
    enrichment_needed: Optional[bool] = False


# Purchase schemas
class PurchaseRequest(BaseModel):
    query: str
    selected_source_ids: Optional[List[str]] = None  # Specific sources to unlock
    budget_limit_dollars: Optional[float] = None  # Total budget for research
    idempotency_key: Optional[str] = None


class PurchaseResponse(BaseModel):
    success: bool
    message: str
    research_package: Optional[Dict[str, Any]] = None
    total_cost: float
    sources_unlocked: int
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