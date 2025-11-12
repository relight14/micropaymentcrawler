"""Purchase and transaction routes"""

import uuid
from fastapi import APIRouter, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from typing import Dict, Any, Optional
import time
import json
import base64

from schemas.api import PurchaseRequest, PurchaseResponse
from schemas.domain import TierType, ResearchPacket
from services.ai.report_generator import ReportGeneratorService
from data.ledger_repository import ResearchLedger
from integrations.ledewire import LedeWireAPI
from utils.rate_limit import limiter

router = APIRouter()


class StructuredHTTPException(HTTPException):
    """HTTPException with structured error metadata for frontend"""
    
    def __init__(
        self,
        status_code: int,
        error_type: str,
        message: str,
        retry_guidance: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None
    ):
        # Store structured data in detail as JSON-serializable dict
        detail = {
            "type": error_type,
            "message": message,
            "retry_guidance": retry_guidance or "Please try again later.",
            "details": details or {}
        }
        super().__init__(status_code=status_code, detail=detail)

# Import shared crawler instance after router to avoid circular imports
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent))
from shared_services import crawler
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
    """
    Extract user ID from JWT token by decoding the payload.
    Uses email or sub claim as the unique user identifier.
    """
    try:
        # JWT format: header.payload.signature
        parts = access_token.split('.')
        if len(parts) != 3:
            raise ValueError("Invalid JWT format")
        
        # Decode the payload (middle part)
        payload = parts[1]
        # Add padding if needed for base64 decoding
        padding = 4 - (len(payload) % 4)
        if padding != 4:
            payload += '=' * padding
        
        decoded_bytes = base64.urlsafe_b64decode(payload)
        decoded_payload = json.loads(decoded_bytes)
        
        # Extract user identifier from token claims
        # Prefer email, fall back to sub (subject), then user_id
        user_identifier = (
            decoded_payload.get('email') or 
            decoded_payload.get('sub') or 
            decoded_payload.get('user_id')
        )
        
        if not user_identifier:
            raise ValueError("No user identifier found in JWT")
        
        return f"user_{user_identifier}"
        
    except Exception as e:
        # Fallback: hash the token itself (should rarely happen)
        import hashlib
        print(f"⚠️ Failed to decode JWT, using hash fallback: {e}")
        return f"user_{hashlib.sha256(access_token.encode()).hexdigest()[:16]}"


def extract_sources_from_outline(outline_structure: Dict[str, Any]) -> list:
    """
    Extract all unique sources from outline structure.
    Outline is the single source of truth for what goes in the report.
    """
    from schemas.domain import SourceCard
    
    if not outline_structure or 'sections' not in outline_structure:
        return []
    
    seen_ids = set()
    unique_sources = []
    
    for section in outline_structure.get('sections', []):
        for source_wrapper in section.get('sources', []):
            source_data = source_wrapper.get('source_data', source_wrapper)
            source_id = source_data.get('id')
            
            if source_id and source_id not in seen_ids:
                seen_ids.add(source_id)
                # Convert dict to SourceCard instance
                try:
                    unique_sources.append(SourceCard(**source_data))
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"Failed to parse source from outline: {e}")
                    continue
    
    return unique_sources


def calculate_incremental_pricing(user_id: str, query: str, sources: list, logger) -> dict:
    """
    Calculate incremental pricing for a purchase.
    Returns dict with calculated_price, new_source_count, previous_source_count, total_source_count.
    
    previous_source_count = sources in current outline that user already owns (intersection)
    new_source_count = sources in current outline that are new (set difference)
    total_source_count = all sources in current outline
    """
    previous_source_ids = ledger.get_previous_purchase_sources(user_id, query)
    current_source_ids = set([s.id for s in sources]) if sources else set()
    
    if previous_source_ids:
        previous_ids_set = set(previous_source_ids)
        
        # Intersection: sources in current outline that were previously purchased
        owned_source_ids = current_source_ids & previous_ids_set
        previous_count = len(owned_source_ids)
        
        # Set difference: sources in current outline that are new
        new_source_ids = current_source_ids - previous_ids_set
        new_source_count = len(new_source_ids)
        
        logger.info(f"💰 [PRICING] Current outline: {len(current_source_ids)} sources | Already owned: {previous_count} | New: {new_source_count}")
    else:
        new_source_count = len(current_source_ids)
        previous_count = 0
        logger.info(f"💰 [PRICING] First purchase: {new_source_count} sources")
    
    # Simple pricing: $0.05 per new source
    calculated_price = new_source_count * 0.05
    
    return {
        "calculated_price": calculated_price,
        "new_source_count": new_source_count,
        "previous_source_count": previous_count,
        "total_source_count": len(current_source_ids)
    }


@router.get("/quote")
@limiter.limit("30/minute")
async def get_pricing_quote(
    request: Request,
    tier: str,
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
        
        logger.info(f"💵 [QUOTE] User {user_id[:8]}... | Query: '{query}' | Tier: {tier}")
        logger.info(f"💵 [QUOTE] Price: ${pricing_info['calculated_price']:.2f} ({pricing_info['new_source_count']} new sources)")
        
        return {
            "success": True,
            "tier": tier,
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
    """Process a research purchase request using LedeWire API with server-enforced licensing costs."""
    # Extract user_id at function start for exception handler access
    user_id = None
    try:
        # Log the incoming query value for debugging
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"🔍 [PURCHASE] Received research query: '{purchase_request.query}' | Tier: {purchase_request.tier}")
        
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
            request_signature = f"{user_id}:{purchase_request.query}:{purchase_request.tier.value}:{source_ids_str}"
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
        
        # Extract sources from outline structure first (needed for pricing calculation)
        sources = extract_sources_from_outline(purchase_request.outline_structure or {})
        
        if not sources:
            # No sources in outline - will be handled per-tier below
            pass
        
        # Calculate incremental pricing using shared function
        pricing_info = calculate_incremental_pricing(user_id, purchase_request.query, sources, logger)
        calculated_price = pricing_info["calculated_price"]
        new_source_count = pricing_info["new_source_count"]
        
        # Tier configurations - now just for max_sources limits
        tier_configs = {
            TierType.BASIC: {"max_sources": 10},
            TierType.RESEARCH: {"max_sources": 20}, 
            TierType.PRO: {"max_sources": 40}
        }
        
        config = tier_configs[purchase_request.tier]
        
        # Handle FREE TIER (no new sources)
        if calculated_price == 0.00:
            if not sources:
                # No sources in outline - generate fresh
                sources = await crawler.generate_sources(purchase_request.query, config["max_sources"])
            
            # Log outline structure before report generation
            if purchase_request.outline_structure:
                sections = purchase_request.outline_structure.get('sections', [])
                logger.info(f"📋 [PURCHASE] Outline structure received: {len(sections)} sections")
                for i, section in enumerate(sections, 1):
                    logger.info(f"   Section {i}: '{section.get('title', 'NO TITLE')}' ({len(section.get('sources', []))} sources)")
            else:
                logger.info(f"⚠️ [PURCHASE] No outline_structure provided - will use generic topics")
            
            # Generate AI report
            report_data = report_generator.generate_report(
                purchase_request.query, 
                sources, 
                purchase_request.tier,
                outline_structure=purchase_request.outline_structure
            )
            
            # Build packet directly
            packet = ResearchPacket(
                query=purchase_request.query,
                tier=purchase_request.tier,
                summary=report_data.get("summary", ""),
                outline=None,
                insights=None,
                sources=sources,
                total_sources=len(sources),
                citation_metadata=report_data.get("citation_metadata"),
                table_data=report_data.get("table_data")
            )
            
            free_transaction_id = f"free_{uuid.uuid4().hex[:12]}"
            purchase_id = ledger.record_purchase(
                query=purchase_request.query,
                tier=purchase_request.tier,
                price=0.00,
                wallet_id=None,
                transaction_id=free_transaction_id,
                packet=packet,
                source_ids=[s.id for s in sources],
                user_id=user_id
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
        max_sources = config["max_sources"]
        
        if not sources:
            # No sources in outline - generate fresh
            sources = await crawler.generate_sources(purchase_request.query, max_sources)
        
        # Log outline structure before report generation (PAID TIER)
        if purchase_request.outline_structure:
            sections = purchase_request.outline_structure.get('sections', [])
            logger.info(f"📋 [PURCHASE PAID] Outline structure received: {len(sections)} sections")
            for i, section in enumerate(sections, 1):
                logger.info(f"   Section {i}: '{section.get('title', 'NO TITLE')}' ({len(section.get('sources', []))} sources)")
        else:
            logger.info(f"⚠️ [PURCHASE PAID] No outline_structure provided - will use generic topics")
        
        # Generate AI report (with fallback handling built-in)
        report_data = report_generator.generate_report(
            purchase_request.query, 
            sources, 
            purchase_request.tier,
            outline_structure=purchase_request.outline_structure
        )
        
        # Build packet directly with AI-generated report
        packet = ResearchPacket(
            query=purchase_request.query,
            tier=purchase_request.tier,
            summary=report_data.get("summary", ""),
            outline=None,
            insights=None,
            sources=sources,
            total_sources=len(sources),
            citation_metadata=report_data.get("citation_metadata"),
            table_data=report_data.get("table_data")
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
                price_cents=int(calculated_price * 100),
                idempotency_key=purchase_request.idempotency_key
            )
            
            if "error" in payment_result:
                error_msg = ledewire.handle_api_error(payment_result)
                if "insufficient" in error_msg.lower():
                    raise StructuredHTTPException(
                        status_code=402,
                        error_type="insufficient_funds",
                        message="Insufficient wallet balance",
                        retry_guidance="Please add funds to your wallet and try again.",
                        details={"error_detail": error_msg}
                    )
                else:
                    raise StructuredHTTPException(
                        status_code=402,
                        error_type="payment_failed",
                        message="Payment processing failed",
                        retry_guidance="Please check your wallet status and try again, or contact support.",
                        details={"error_detail": error_msg}
                    )
            
            transaction_id = payment_result.get("transaction_id") or f"fallback_txn_{uuid.uuid4().hex[:12]}"
            wallet_id = payment_result.get("wallet_id")
        
        # Record successful purchase (both mock and real paths)
        purchase_id = ledger.record_purchase(
            query=purchase_request.query,
            tier=purchase_request.tier,
            price=calculated_price,
            wallet_id=wallet_id,
            transaction_id=transaction_id,
            packet=packet,
            source_ids=[s.id for s in sources],
            user_id=user_id
        )
        
        response_data = PurchaseResponse(
            success=True,
            message=f"Research purchased successfully! ${calculated_price:.2f} for {new_source_count} new source(s).",
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
        
        raise StructuredHTTPException(
            status_code=500,
            error_type="server_error",
            message="Report generation failed",
            retry_guidance="Please try again in a moment. If the issue persists, contact support.",
            details={"error_detail": str(e)}
        )