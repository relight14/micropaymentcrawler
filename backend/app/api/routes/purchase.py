"""Purchase and transaction routes"""

import uuid
from fastapi import APIRouter, HTTPException, Header
from slowapi import Limiter
from typing import Dict, Any

from schemas.api import PurchaseRequest, PurchaseResponse
from schemas.domain import TierType
from services.research.packet_builder import PacketBuilder
from services.research.crawler import ContentCrawlerStub
from data.ledger_repository import ResearchLedger
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import get_user_or_ip_key

router = APIRouter()

# Initialize services
packet_builder = PacketBuilder()
crawler = ContentCrawlerStub()
ledger = ResearchLedger()
ledewire = LedeWireAPI()


def extract_bearer_token(authorization: str) -> str:
    """Extract and validate Bearer token from Authorization header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")
    
    access_token = authorization.split(" ", 1)[1].strip()
    
    if not access_token:
        raise HTTPException(status_code=401, detail="Bearer token cannot be empty")
    
    return access_token


def validate_user_token(access_token: str):
    """Validate JWT token with LedeWire API."""
    try:
        balance_result = ledewire.get_wallet_balance(access_token)
        
        if "error" in balance_result:
            error_message = ledewire.handle_api_error(balance_result)
            raise HTTPException(status_code=401, detail=f"Invalid token: {error_message}")
        
        return balance_result
        
    except HTTPException:
        raise
    except Exception as e:
        import requests
        if isinstance(e, requests.HTTPError) and hasattr(e, 'response'):
            if e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Authentication service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Authentication service error")
        else:
            raise HTTPException(status_code=503, detail="Authentication service unavailable")


def extract_user_id_from_token(access_token: str) -> str:
    """Extract user ID from JWT token for session isolation"""
    try:
        response = ledewire.get_wallet_balance(access_token)
        if response.get('balance_cents') is not None:
            wallet_id = response.get('wallet_id', 'mock_wallet')
            return f"user_{wallet_id}"
        else:
            import hashlib
            return f"user_{hashlib.sha256(access_token.encode()).hexdigest()[:12]}"
    except Exception:
        import hashlib  
        return f"anon_{hashlib.sha256(access_token.encode()).hexdigest()[:12]}"


@router.post("", response_model=PurchaseResponse)
# @limiter.limit("10/minute")
async def purchase_research(request: PurchaseRequest, authorization: str = Header(None, alias="Authorization")):
    """Process a research purchase request using LedeWire API with server-enforced licensing costs."""
    try:
        # Extract and validate Bearer token
        access_token = extract_bearer_token(authorization)
        validate_user_token(access_token)
        user_id = extract_user_id_from_token(access_token)
        
        # Calculate pricing
        tier_base_prices = {
            TierType.BASIC: 0.00,
            TierType.RESEARCH: 0.99,  
            TierType.PRO: 1.99
        }
        base_price = tier_base_prices[request.tier]
        
        # Generate stable idempotency key if not provided
        import hashlib
        if not request.idempotency_key:
            request_signature = f"{user_id}:{request.query}:{request.tier.value}:{base_price}"
            request.idempotency_key = hashlib.sha256(request_signature.encode()).hexdigest()[:24]
        
        # Check for existing response
        existing_response = ledger.check_idempotency(user_id, request.idempotency_key, "purchase")
        if existing_response:
            return PurchaseResponse(**existing_response)
        
        # Reserve this operation
        if not ledger.reserve_idempotency(user_id, request.idempotency_key, "purchase"):
            import time
            time.sleep(0.2)
            existing_response = ledger.check_idempotency(user_id, request.idempotency_key, "purchase")
            if existing_response:
                return PurchaseResponse(**existing_response)
            else:
                raise HTTPException(status_code=409, detail="Duplicate request processing - please retry")
        
        # Tier configurations
        tier_configs = {
            TierType.BASIC: {"price": 0.00, "max_sources": 10},
            TierType.RESEARCH: {"price": 0.99, "max_sources": 20}, 
            TierType.PRO: {"price": 1.99, "max_sources": 40}
        }
        
        config = tier_configs[request.tier]
        
        # Handle FREE TIER
        if config["price"] == 0.00:
            packet = packet_builder.build_packet(request.query, request.tier)
            
            free_transaction_id = f"free_{uuid.uuid4().hex[:12]}"
            purchase_id = ledger.record_purchase(
                query=request.query,
                tier=request.tier,
                price=0.00,
                wallet_id=None,
                transaction_id=free_transaction_id,
                packet=packet
            )
            
            response_data = PurchaseResponse(
                success=True,
                message="Free research unlocked! Enjoy your Basic tier research.",
                packet=packet,
                wallet_deduction=0.0
            )
            
            ledger.store_idempotency(user_id, request.idempotency_key, "purchase", response_data.dict())
            return response_data
        
        # PAID TIERS: Continue with payment processing
        budget_limit = config["price"] * 0.60
        max_sources = config["max_sources"]
        
        # Generate sources and build packet
        sources = crawler.generate_sources(request.query, max_sources, budget_limit)
        packet = packet_builder.build_packet_with_sources(request.query, request.tier, sources)
        
        # Process payment with LedeWire
        payment_result = ledewire.process_payment(
            access_token=access_token,
            amount_cents=int(config["price"] * 100),
            description=f"{request.tier.value.title()} Research: {request.query[:50]}...",
            idempotency_key=request.idempotency_key
        )
        
        if "error" in payment_result:
            error_msg = ledewire.handle_api_error(payment_result)
            if "insufficient" in error_msg.lower():
                raise HTTPException(status_code=402, detail=f"Insufficient funds: {error_msg}")
            else:
                raise HTTPException(status_code=402, detail=f"Payment failed: {error_msg}")
        
        # Record successful purchase
        purchase_id = ledger.record_purchase(
            query=request.query,
            tier=request.tier,
            price=config["price"],
            wallet_id=payment_result.get("wallet_id"),
            transaction_id=payment_result.get("transaction_id"),
            packet=packet
        )
        
        response_data = PurchaseResponse(
            success=True,
            message=f"Research purchased successfully! Your {request.tier.value.title()} tier research is ready.",
            packet=packet,
            wallet_deduction=config["price"]
        )
        
        # Store for idempotency
        ledger.store_idempotency(user_id, request.idempotency_key, "purchase", response_data.dict())
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Purchase error: {e}")
        raise HTTPException(status_code=500, detail="Purchase processing failed")