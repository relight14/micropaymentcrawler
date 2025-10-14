"""Purchase and transaction routes"""

import uuid
from fastapi import APIRouter, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from typing import Dict, Any
import time

from schemas.api import PurchaseRequest, PurchaseResponse
from schemas.domain import TierType, ResearchPacket
from services.research.crawler import ContentCrawlerStub
from services.ai.report_generator import ReportGeneratorService
from data.ledger_repository import ResearchLedger
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter

router = APIRouter()

# Initialize services
crawler = ContentCrawlerStub()
report_generator = ReportGeneratorService()
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
@limiter.limit("10/minute")
async def purchase_research(request: Request, purchase_request: PurchaseRequest, authorization: str = Header(None, alias="Authorization")):
    """Process a research purchase request using LedeWire API with server-enforced licensing costs."""
    # Extract user_id at function start for exception handler access
    user_id = None
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
        base_price = tier_base_prices[purchase_request.tier]
        
        # Generate stable idempotency key if not provided
        import hashlib
        if not purchase_request.idempotency_key:
            request_signature = f"{user_id}:{purchase_request.query}:{purchase_request.tier.value}:{base_price}"
            purchase_request.idempotency_key = hashlib.sha256(request_signature.encode()).hexdigest()[:24]
        
        # Check idempotency status
        idem_status = ledger.get_idempotency_status(user_id, purchase_request.idempotency_key, "purchase")
        
        if idem_status:
            if idem_status["status"] == "completed":
                # Return cached response (idempotent 200)
                return PurchaseResponse(**idem_status["response_data"])
            
            elif idem_status["status"] == "processing":
                # Wait inline with short polling (simpler than 202 + polling endpoint)
                max_wait_seconds = 15
                poll_interval = 0.5
                attempts = int(max_wait_seconds / poll_interval)
                
                for attempt in range(attempts):
                    time.sleep(poll_interval)
                    updated_status = ledger.get_idempotency_status(user_id, purchase_request.idempotency_key, "purchase")
                    
                    if updated_status and updated_status["status"] == "completed":
                        return PurchaseResponse(**updated_status["response_data"])
                
                # Still processing after max wait - return 202
                return JSONResponse(
                    status_code=202,
                    content={"status": "processing", "message": "Purchase is still being processed. Please try again in a moment."},
                    headers={"Retry-After": "2"}
                )
            
            elif idem_status["status"] == "failed":
                raise HTTPException(status_code=500, detail="Previous purchase attempt failed. Please retry with a new request.")
        
        # Reserve this operation (first time seeing this key)
        if not ledger.reserve_idempotency(user_id, purchase_request.idempotency_key, "purchase"):
            # Race condition - another request just reserved it, treat as processing
            time.sleep(0.5)
            retry_status = ledger.get_idempotency_status(user_id, purchase_request.idempotency_key, "purchase")
            if retry_status and retry_status["status"] == "completed":
                return PurchaseResponse(**retry_status["response_data"])
            return JSONResponse(
                status_code=202,
                content={"status": "processing", "message": "Purchase is being processed by another request."},
                headers={"Retry-After": "2"}
            )
        
        # Tier configurations
        tier_configs = {
            TierType.BASIC: {"price": 0.00, "max_sources": 10},
            TierType.RESEARCH: {"price": 0.99, "max_sources": 20}, 
            TierType.PRO: {"price": 1.99, "max_sources": 40}
        }
        
        config = tier_configs[purchase_request.tier]
        
        # Handle FREE TIER
        if config["price"] == 0.00:
            #DEBUG: Check for selected sources
            print(f"🔍 [PURCHASE FREE] Crawler instance ID: {id(crawler)}, cache entries: {len(crawler._cache)}")
            
            # If user selected specific sources, retrieve them from cache
            if purchase_request.selected_source_ids and len(purchase_request.selected_source_ids) > 0:
                print(f"📊 FREE TIER: Using {len(purchase_request.selected_source_ids)} selected sources")
                
                # Retrieve selected sources from crawler cache
                selected_sources = []
                for cache_key in crawler._cache:
                    cached_sources, timestamp = crawler._cache[cache_key]
                    if crawler._is_cache_valid(timestamp):
                        for source in cached_sources:
                            if source.id in purchase_request.selected_source_ids:
                                selected_sources.append(source)
                
                if len(selected_sources) > 0:
                    sources = selected_sources
                    print(f"✅ Retrieved {len(sources)} sources from cache")
                else:
                    print(f"⚠️ No sources found in cache, generating fresh")
                    sources = await crawler.generate_sources(purchase_request.query, config["max_sources"])
            else:
                # No selected sources - generate fresh
                sources = await crawler.generate_sources(purchase_request.query, config["max_sources"])
            
            # Generate AI report
            report, citation_metadata = report_generator.generate_report(purchase_request.query, sources, purchase_request.tier)
            
            # Build packet directly
            packet = ResearchPacket(
                query=purchase_request.query,
                tier=purchase_request.tier,
                summary=report,
                outline=None,
                insights=None,
                sources=sources,
                total_sources=len(sources),
                citation_metadata=citation_metadata
            )
            
            free_transaction_id = f"free_{uuid.uuid4().hex[:12]}"
            purchase_id = ledger.record_purchase(
                query=purchase_request.query,
                tier=purchase_request.tier,
                price=0.00,
                wallet_id=None,
                transaction_id=free_transaction_id,
                packet=packet
            )
            
            response_data = PurchaseResponse(
                success=True,
                message="Free research unlocked! Enjoy your Basic tier research.",
                packet=packet.model_dump(),
                wallet_deduction=0.0
            )
            
            ledger.store_idempotency(user_id, purchase_request.idempotency_key, "purchase", response_data.model_dump(), "completed")
            return response_data
        
        # PAID TIERS: Continue with payment processing
        budget_limit = config["price"] * 0.60
        max_sources = config["max_sources"]
        
        # DEBUG: Check for selected sources
        print(f"🔍 [PURCHASE PAID] Crawler instance ID: {id(crawler)}, cache entries: {len(crawler._cache)}")
        
        # If user selected specific sources, retrieve them from cache
        if purchase_request.selected_source_ids and len(purchase_request.selected_source_ids) > 0:
            print(f"📊 PAID TIER: Using {len(purchase_request.selected_source_ids)} selected sources")
            
            # Retrieve selected sources from crawler cache
            selected_sources = []
            for cache_key in crawler._cache:
                cached_sources, timestamp = crawler._cache[cache_key]
                if crawler._is_cache_valid(timestamp):
                    for source in cached_sources:
                        if source.id in purchase_request.selected_source_ids:
                            selected_sources.append(source)
            
            if len(selected_sources) > 0:
                sources = selected_sources
                print(f"✅ Retrieved {len(sources)} sources from cache")
            else:
                print(f"⚠️ No sources found in cache, generating fresh")
                sources = await crawler.generate_sources(purchase_request.query, max_sources, budget_limit)
        else:
            # No selected sources - generate fresh
            sources = await crawler.generate_sources(purchase_request.query, max_sources, budget_limit)
        
        # Generate AI report (with fallback handling built-in)
        report, citation_metadata = report_generator.generate_report(purchase_request.query, sources, purchase_request.tier)
        
        # Build packet directly with AI-generated report
        packet = ResearchPacket(
            query=purchase_request.query,
            tier=purchase_request.tier,
            summary=report,
            outline=None,
            insights=None,
            sources=sources,
            total_sources=len(sources),
            citation_metadata=citation_metadata
        )
        
        # Selective Mock: Check if payments should be mocked
        import os
        if os.getenv("LEDEWIRE_MOCK_PAYMENTS") == "true":
            # MOCK MODE: Skip real payment, generate fake transaction
            transaction_id = f"mock_txn_{uuid.uuid4().hex[:12]}"
            wallet_id = None  # No real wallet involved in mock
            
        else:
            # REAL MODE: Process actual LedeWire payment
            content_id = packet.content_id or f"research_{uuid.uuid4().hex[:8]}"
            payment_result = ledewire.create_purchase(
                access_token=access_token,
                content_id=content_id,
                price_cents=int(config["price"] * 100),
                idempotency_key=purchase_request.idempotency_key
            )
            
            if "error" in payment_result:
                error_msg = ledewire.handle_api_error(payment_result)
                if "insufficient" in error_msg.lower():
                    raise HTTPException(status_code=402, detail=f"Insufficient funds: {error_msg}")
                else:
                    raise HTTPException(status_code=402, detail=f"Payment failed: {error_msg}")
            
            transaction_id = payment_result.get("transaction_id") or f"fallback_txn_{uuid.uuid4().hex[:12]}"
            wallet_id = payment_result.get("wallet_id")
        
        # Record successful purchase (both mock and real paths)
        purchase_id = ledger.record_purchase(
            query=purchase_request.query,
            tier=purchase_request.tier,
            price=config["price"],
            wallet_id=wallet_id,
            transaction_id=transaction_id,
            packet=packet
        )
        
        response_data = PurchaseResponse(
            success=True,
            message=f"Research purchased successfully! Your {purchase_request.tier.value.title()} tier research is ready.",
            packet=packet.model_dump(),
            wallet_deduction=config["price"]
        )
        
        # Store for idempotency with completed status
        ledger.store_idempotency(user_id, purchase_request.idempotency_key, "purchase", response_data.model_dump(), "completed")
        return response_data
        
    except HTTPException:
        # Mark as failed for non-recoverable errors
        try:
            if purchase_request.idempotency_key and user_id:
                ledger.store_idempotency(user_id, purchase_request.idempotency_key, "purchase", {"error": "failed"}, "failed")
        except:
            pass
        raise
    except Exception as e:
        print(f"Purchase error: {e}")
        # Mark as failed
        try:
            if purchase_request.idempotency_key and user_id:
                ledger.store_idempotency(user_id, purchase_request.idempotency_key, "purchase", {"error": str(e)}, "failed")
        except:
            pass
        raise HTTPException(status_code=500, detail="Purchase processing failed")