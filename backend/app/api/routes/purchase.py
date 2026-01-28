"""Purchase and transaction routes"""

import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException, Header, Request, Depends
from fastapi.responses import JSONResponse
from typing import Dict, Any
import time

from schemas.api import PurchaseRequest, PurchaseResponse, CheckoutStateRequest, CheckoutStateResponse
from schemas.domain import ResearchPacket
from services.ai.report_generator import ReportGeneratorService
from services.pricing_service import PricingService
from services.source_service import SourceService
from data.ledger_repository import ResearchLedger
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter
from middleware.auth_dependencies import get_current_token, get_authenticated_user_with_id
from utils.auth import extract_user_id_from_token

router = APIRouter()

# Import shared crawler instance after router to avoid circular imports
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
from shared_services import crawler

# Initialize services
report_generator = ReportGeneratorService()
pricing_service = PricingService()
source_service = SourceService()
ledger = ResearchLedger()
ledewire = LedeWireAPI()


# Business logic functions moved to services - import them for backwards compatibility
def extract_sources_from_outline(outline_structure: Dict[str, Any]) -> list:
    """DEPRECATED: Use SourceService.extract_sources_from_outline instead"""
    return source_service.extract_sources_from_outline(outline_structure)


def calculate_incremental_pricing(user_id: str, query: str, sources: list, logger) -> dict:
    """DEPRECATED: Use PricingService.calculate_incremental_pricing instead"""
    return pricing_service.calculate_incremental_pricing(user_id, query, sources)


@router.post("/checkout-state", response_model=CheckoutStateResponse)
@limiter.limit("30/minute")
async def get_checkout_state(
    request: Request,
    checkout_request: CheckoutStateRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """
    Check pre-purchase state to determine next required action.
    Returns: authenticate | fund_wallet | purchase | none
    """
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"🔍 [CHECKOUT-STATE] Starting checkout state check")
    logger.info(f"🔍 [CHECKOUT-STATE] Request: price_cents={checkout_request.price_cents}, content_id={checkout_request.content_id}")
    logger.info(f"🔍 [CHECKOUT-STATE] Has authorization header: {authorization is not None and authorization.startswith('Bearer ')}")
    
    # Check authentication
    is_authenticated = False
    balance_cents = 0
    already_purchased = False
    
    if not authorization or not authorization.startswith("Bearer "):
        # Not authenticated
        logger.info(f"🔍 [CHECKOUT-STATE] Result: NOT AUTHENTICATED - next_action=authenticate")
        return CheckoutStateResponse(
            next_required_action="authenticate",
            is_authenticated=False,
            balance_cents=0,
            required_amount_cents=checkout_request.price_cents,
            shortfall_cents=checkout_request.price_cents,
            already_purchased=False,
            message="Please log in to continue with your purchase"
        )
    
    try:
        access_token = extract_bearer_token(authorization)
        
        # Validate token and get balance
        balance_result = ledewire.get_wallet_balance(access_token)
        
        if "error" in balance_result:
            # Token invalid or expired
            logger.info(f"🔍 [CHECKOUT-STATE] Result: TOKEN INVALID - balance_result={balance_result}")
            return CheckoutStateResponse(
                next_required_action="authenticate",
                is_authenticated=False,
                balance_cents=0,
                required_amount_cents=checkout_request.price_cents,
                shortfall_cents=checkout_request.price_cents,
                already_purchased=False,
                message="Your session has expired. Please log in again."
            )
        
        is_authenticated = True
        balance_cents = balance_result.get("balance_cents") or balance_result.get("balance", 0)
        logger.info(f"🔍 [CHECKOUT-STATE] User authenticated, balance_cents={balance_cents}")
        
        # Check if content already purchased (if content_id provided)
        if checkout_request.content_id:
            try:
                verify_result = ledewire.verify_purchase(access_token, checkout_request.content_id)
                already_purchased = verify_result.get("purchased", False)
            except Exception as e:
                logger.debug(f"Purchase verification failed (content may not exist yet): {e}")
                already_purchased = False
        
        # If already purchased, no action needed
        if already_purchased:
            logger.info(f"🔍 [CHECKOUT-STATE] Result: ALREADY PURCHASED - next_action=none")
            return CheckoutStateResponse(
                next_required_action="none",
                is_authenticated=True,
                balance_cents=balance_cents,
                required_amount_cents=0,
                shortfall_cents=0,
                already_purchased=True,
                message="You already have access to this content"
            )
        
        # Check if sufficient funds
        shortfall = max(0, checkout_request.price_cents - balance_cents)
        
        if shortfall > 0:
            logger.info(f"🔍 [CHECKOUT-STATE] Result: INSUFFICIENT FUNDS - balance={balance_cents}, required={checkout_request.price_cents}, shortfall={shortfall}")
            return CheckoutStateResponse(
                next_required_action="fund_wallet",
                is_authenticated=True,
                balance_cents=balance_cents,
                required_amount_cents=checkout_request.price_cents,
                shortfall_cents=shortfall,
                already_purchased=False,
                message=f"Please add ${shortfall / 100:.2f} to your wallet to complete this purchase"
            )
        
        # Ready to purchase
        logger.info(f"🔍 [CHECKOUT-STATE] Result: READY TO PURCHASE - balance={balance_cents}, required={checkout_request.price_cents}")
        return CheckoutStateResponse(
            next_required_action="purchase",
            is_authenticated=True,
            balance_cents=balance_cents,
            required_amount_cents=checkout_request.price_cents,
            shortfall_cents=0,
            already_purchased=False,
            message="Ready to complete purchase"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Checkout state error: {e}")
        raise HTTPException(status_code=500, detail="Failed to check checkout state")


@router.get("/quote")
@limiter.limit("30/minute")
async def get_pricing_quote(
    request: Request,
    query: str,
    outline_structure: str | None = None,  # JSON string
    authorization: str = Header(None, alias="Authorization")
):
    """
    Get a pricing quote for a research purchase without committing to it.
    Returns incremental pricing based on outline sources vs previous purchases.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Extract and validate Bearer token
        access_token = extract_bearer_token(authorization)
        validate_user_token(access_token)
        user_id = extract_user_id_from_token(access_token)
        
        # Parse outline structure from JSON string
        outline = {}
        if outline_structure:
            try:
                outline = json.loads(outline_structure)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid outline_structure JSON")
        
        # Extract sources from outline
        sources = extract_sources_from_outline(outline)
        
        # Calculate incremental pricing
        pricing_info = calculate_incremental_pricing(user_id, query, sources, logger)
        
        logger.info(f"💵 [QUOTE] User {user_id[:8]}... | Query: '{query}'")
        logger.info(f"💵 [QUOTE] Price: ${pricing_info['calculated_price']:.2f} ({pricing_info['new_source_count']} new sources)")
        
        return {
            "success": True,
            "query": query,
            **pricing_info
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error calculating pricing quote: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to calculate pricing quote: {str(e)}")


@router.post("", response_model=PurchaseResponse)
@limiter.limit("10/minute")
async def purchase_research(request: Request, purchase_request: PurchaseRequest, authorization: str = Header(None, alias="Authorization")):
    """Generate research report with incremental pricing based on new sources."""
    # Extract user_id at function start for exception handler access
    user_id = None
    try:
        # Log the incoming query value for debugging
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"🔍 [PURCHASE] Received research query: '{purchase_request.query}'")
        
        # Extract and validate Bearer token
        access_token = extract_bearer_token(authorization)
        validate_user_token(access_token)
        user_id = extract_user_id_from_token(access_token)
        
        # Extract sources first to generate idempotency key with source IDs
        temp_outline = purchase_request.outline_structure or {}
        temp_sources = extract_sources_from_outline(temp_outline)
        source_ids_str = ",".join(sorted([s.id for s in temp_sources])) if temp_sources else "no_sources"
        
        # Generate stable idempotency key including source IDs (allows iterative purchases)
        import hashlib
        if not purchase_request.idempotency_key:
            request_signature = f"{user_id}:{purchase_request.query}:{source_ids_str}"
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
        
        # Extract sources from outline structure (outline is single source of truth)
        sources = extract_sources_from_outline(purchase_request.outline_structure or {})
        
        if not sources:
            # No sources in outline - this shouldn't happen in normal flow
            logger.warning(f"⚠️ [PURCHASE] No sources in outline - generating default set")
            sources = await crawler.generate_sources(purchase_request.query, 40)
        
        # Calculate incremental pricing using shared function
        pricing_info = calculate_incremental_pricing(user_id, purchase_request.query, sources, logger)
        calculated_price = pricing_info["calculated_price"]
        new_source_count = pricing_info["new_source_count"]
        
        # Log outline structure before report generation
        if purchase_request.outline_structure:
            sections = purchase_request.outline_structure.get('sections', [])
            logger.info(f"📋 [PURCHASE] Outline structure received: {len(sections)} sections")
            for i, section in enumerate(sections, 1):
                logger.info(f"   Section {i}: '{section.get('title', 'NO TITLE')}' ({len(section.get('sources', []))} sources)")
        else:
            logger.info(f"⚠️ [PURCHASE] No outline_structure provided - will use generic topics")
        
        # Generate AI report (with fallback handling built-in)
        report_data = report_generator.generate_report(
            purchase_request.query, 
            sources,
            outline_structure=purchase_request.outline_structure
        )
        
        # Build packet with AI-generated report
        packet = ResearchPacket(
            query=purchase_request.query,
            summary=report_data.get("summary", ""),
            outline=None,
            insights=None,
            sources=sources,
            total_sources=len(sources),
            citation_metadata=report_data.get("citation_metadata"),
            table_data=report_data.get("table_data")
        )
        
        # Handle payment - free if no new sources, otherwise process payment
        if calculated_price == 0.00:
            # Free report (all sources already purchased)
            transaction_id = f"free_{uuid.uuid4().hex[:12]}"
            wallet_id = None
            content_id = None
            message = "Report generated! All sources previously purchased."
        else:
            # Process payment for new sources - Register content with LedeWire first, then process purchase
            logger.info(f"💳 [PURCHASE] Starting purchase flow")
            logger.info(f"💳 [PURCHASE] User: {user_id[:20]}..., Price: ${calculated_price:.2f}, Sources: {len(sources)}")
            
            # Step 1: Check cache for existing content_id (avoid duplicate registration)
            source_ids_list = [s.id for s in sources]
            price_cents = int(calculated_price * 100)
            cache_key = ledger.generate_content_cache_key(purchase_request.query, source_ids_list, price_cents)
            logger.info(f"💳 [PURCHASE] Step 1: Checking content_id cache (key={cache_key[:40]}...)")
            cached = ledger.get_cached_content_id(cache_key)
            
            if cached:
                # Use cached content_id
                content_id = cached["content_id"]
                logger.info(f"💳 [PURCHASE] Step 1 Result: CACHE HIT - content_id={content_id}")
            else:
                # Step 2: Register the research report as content in LedeWire
                # Clearcite is the seller, we register the report before user can purchase
                logger.info(f"💳 [PURCHASE] Step 1 Result: CACHE MISS - need to register content")
                logger.info(f"💳 [PURCHASE] Step 2: Registering content with LedeWire as seller")
                try:
                    # Build content stub for LedeWire (reference only, not full content)
                    report_title = f"Research Report: {purchase_request.query[:100]}"
                    content_stub = f"# {report_title}\n\nResearch report with {len(sources)} sources.\n\nGenerated by Clearcite."
                    
                    # Build metadata
                    content_metadata = {
                        "query": purchase_request.query,
                        "source_count": len(sources),
                        "generated_at": datetime.now().isoformat(),
                        "source_ids": source_ids_list[:10]  # First 10 source IDs
                    }
                    
                    logger.info(f"💳 [PURCHASE] Step 2: Calling ledewire.register_content(title='{report_title[:50]}...', price_cents={price_cents})")
                    
                    # Register with LedeWire (visibility: unlisted for research reports)
                    registration_result = ledewire.register_content(
                        title=report_title,
                        content_body=content_stub,
                        price_cents=price_cents,
                        visibility="unlisted",
                        metadata=content_metadata
                    )
                    
                    logger.info(f"💳 [PURCHASE] Step 2 Result: registration_result={registration_result}")
                    
                    content_id = registration_result.get("id")
                    if not content_id:
                        logger.error(f"💳 [PURCHASE] Step 2 FAILED: Content registration returned no ID: {registration_result}")
                        raise HTTPException(status_code=500, detail="Failed to register content with payment provider")
                    
                    # Cache the content_id for future lookups (24 hour expiry)
                    ledger.store_content_id(
                        cache_key=cache_key,
                        content_id=content_id,
                        price_cents=price_cents,
                        visibility="unlisted",
                        expires_hours=24
                    )
                    
                    logger.info(f"💳 [PURCHASE] Step 2 SUCCESS: content_id={content_id} registered and cached")
                    
                except Exception as e:
                    logger.error(f"💳 [PURCHASE] Step 2 EXCEPTION: {type(e).__name__}: {e}")
                    raise HTTPException(status_code=500, detail=f"Failed to register content: {str(e)}")
            
            # Step 3: Process the purchase with the registered content_id
            logger.info(f"💳 [PURCHASE] Step 3: Creating purchase with LedeWire")
            logger.info(f"💳 [PURCHASE] Step 3: content_id={content_id}, price_cents={price_cents}, idempotency_key={purchase_request.idempotency_key}")
            
            payment_result = ledewire.create_purchase(
                access_token=access_token,
                content_id=content_id,
                price_cents=price_cents,
                idempotency_key=purchase_request.idempotency_key
            )
            
            logger.info(f"💳 [PURCHASE] Step 3 Result: payment_result={payment_result}")
            
            if "error" in payment_result:
                error_msg = ledewire.handle_api_error(payment_result)
                logger.error(f"💳 [PURCHASE] Step 3 FAILED: error={error_msg}")
                if "insufficient" in error_msg.lower():
                    raise HTTPException(status_code=402, detail=f"Insufficient funds: {error_msg}")
                else:
                    raise HTTPException(status_code=402, detail=f"Payment failed: {error_msg}")
            
            transaction_id = payment_result.get("id") or payment_result.get("transaction_id") or f"fallback_txn_{uuid.uuid4().hex[:12]}"
            wallet_id = payment_result.get("wallet_id")
            
            logger.info(f"💳 [PURCHASE] Step 3 SUCCESS: transaction_id={transaction_id}, wallet_id={wallet_id}")
            
            message = f"Report generated! ${calculated_price:.2f} for {new_source_count} new source(s)."
        
        # Record purchase
        purchase_id = ledger.record_purchase(
            query=purchase_request.query,
            price=calculated_price,
            wallet_id=wallet_id,
            transaction_id=transaction_id,
            packet=packet,
            source_ids=[s.id for s in sources],
            user_id=user_id
        )
        
        response_data = PurchaseResponse(
            success=True,
            message=message,
            packet=packet.model_dump(),
            wallet_deduction=calculated_price
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