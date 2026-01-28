"""Source unlock and summarization routes"""

import hashlib
import httpx
import logging
from fastapi import APIRouter, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List
import time

from schemas.api import SourceUnlockRequest, SourceUnlockResponse
from data.ledger_repository import ResearchLedger
from integrations.ledewire import LedeWireAPI
from services.ai.conversational import AIResearchService
from services.ai.outline_suggester import get_outline_suggester
from utils.rate_limit import get_user_or_ip_key, limiter
from utils.auth import extract_bearer_token, validate_user_token, extract_user_id_from_token

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize services
ledger = ResearchLedger()
ledewire = LedeWireAPI()
ai_service = AIResearchService()


class SummarizeRequest(BaseModel):
    source_id: str
    url: str
    title: str
    excerpt: Optional[str] = None  # Tavily excerpt for fallback
    license_cost: Optional[float] = None
    idempotency_key: Optional[str] = None


class SummarizeResponse(BaseModel):
    source_id: str
    summary: str
    summary_type: str  # "full" or "excerpt" - for transparency badge
    price_cents: int
    price: float  # Price in dollars for frontend compatibility
    transaction_id: str


async def scrape_article_content(url: str, timeout: int = 10) -> str:
    """Scrape article content from URL using httpx."""
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.get(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; ClearciteBot/1.0; +https://clearcite.ai)'
            })
            response.raise_for_status()
            
            # Extract text content (basic implementation)
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove script and style elements
            for script in soup(["script", "style", "nav", "header", "footer"]):
                script.decompose()
            
            # Get text
            text = soup.get_text()
            
            # Clean up whitespace
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text = ' '.join(chunk for chunk in chunks if chunk)
            
            # Limit to reasonable length (first ~5000 chars for summarization)
            return text[:5000]
            
    except httpx.HTTPStatusError as e:
        logger.warning(f"Failed to scrape {url}: HTTP {e.response.status_code}")
        # Detect paywall/authentication errors
        if e.response.status_code in [401, 403]:
            raise HTTPException(
                status_code=403, 
                detail="This article is behind a paywall and cannot be summarized. Please visit the publisher's website to read the full article."
            )
        else:
            raise HTTPException(status_code=400, detail=f"Could not fetch article: HTTP {e.response.status_code}")
    except Exception as e:
        logger.warning(f"Failed to scrape {url}: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Could not fetch article content: {str(e)}")


def calculate_summary_price(license_cost: Optional[float]) -> int:
    """
    Calculate summary price in cents.
    - If license_cost > 0: license_cost × 1.25 (25% platform fee)
    - If license_cost = 0 or None: $0.02 flat fee
    """
    if license_cost and license_cost > 0:
        # License cost is in dollars, add 25% platform fee
        price_dollars = license_cost * 1.25
        return int(price_dollars * 100)  # Convert to cents
    else:
        # Flat $0.02 fee for unlicensed content
        return 2  # 2 cents


@router.post("/summarize", response_model=SummarizeResponse)
@limiter.limit("20/minute")
async def summarize_source(
    request: Request,
    summarize_request: SummarizeRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """
    Summarize a source article using Claude Haiku.
    
    Pricing:
    - Licensed content: license_cost × 1.25 (25% platform fee)
    - Unlicensed content: $0.02 flat fee
    """
    user_id = None
    try:
        # Extract and validate Bearer token
        access_token = extract_bearer_token(authorization)
        validate_user_token(access_token)
        user_id = extract_user_id_from_token(access_token)
        
        # Generate stable idempotency key if not provided
        if not summarize_request.idempotency_key:
            request_signature = f"{user_id}:{summarize_request.source_id}:{summarize_request.url}"
            summarize_request.idempotency_key = hashlib.sha256(request_signature.encode()).hexdigest()[:24]
        
        # Check idempotency status
        idem_status = ledger.get_idempotency_status(user_id, summarize_request.idempotency_key, "summarize")
        
        if idem_status:
            if idem_status["status"] == "completed":
                # Return cached response (idempotent 200)
                return SummarizeResponse(**idem_status["response_data"])
            
            elif idem_status["status"] == "processing":
                # Wait inline with short polling
                max_wait_seconds = 15
                poll_interval = 0.5
                attempts = int(max_wait_seconds / poll_interval)
                
                for attempt in range(attempts):
                    time.sleep(poll_interval)
                    updated_status = ledger.get_idempotency_status(user_id, summarize_request.idempotency_key, "summarize")
                    
                    if updated_status and updated_status["status"] == "completed":
                        return SummarizeResponse(**updated_status["response_data"])
                
                # Still processing after max wait - return 202
                return JSONResponse(
                    status_code=202,
                    content={"status": "processing", "message": "Summary is still being generated. Please try again in a moment."},
                    headers={"Retry-After": "2"}
                )
            
            elif idem_status["status"] == "failed":
                # Retry failed request
                pass
        
        # Mark as processing
        ledger.set_idempotency_status(
            user_id=user_id,
            idempotency_key=summarize_request.idempotency_key,
            operation_type="summarize",
            status="processing",
            response_data={}
        )
        
        # Calculate price for summarization
        price_cents = calculate_summary_price(summarize_request.license_cost)
        
        # Try to scrape full article, fallback to excerpt if paywalled
        article_content = None
        summary_type = "full"
        
        try:
            logger.info(f"Attempting to scrape full article: {summarize_request.url}")
            article_content = await scrape_article_content(summarize_request.url)
            logger.info(f"Successfully scraped full article content")
            summary_type = "full"
        except HTTPException as e:
            if e.status_code == 403:
                # Paywall detected - use Tavily excerpt instead
                logger.info(f"Paywall detected, falling back to Tavily excerpt")
                if summarize_request.excerpt:
                    article_content = summarize_request.excerpt
                    summary_type = "excerpt"
                else:
                    raise HTTPException(
                        status_code=400, 
                        detail="Article is paywalled and no preview content available"
                    )
            else:
                raise
        
        # Generate summary using Claude Haiku
        logger.info(f"Generating summary with Claude Haiku (type: {summary_type})...")
        
        if summary_type == "full":
            prompt = f"""Please provide a concise summary of the following article in 2-3 sentences. Focus on the main points and key takeaways.

Article Title: {summarize_request.title}

Article Content:
{article_content}

Summary:"""
        else:
            prompt = f"""Please provide a concise summary based on this article preview in 2-3 sentences. Focus on the main points visible in the excerpt.

Article Title: {summarize_request.title}

Article Preview:
{article_content}

Summary:"""
        
        response = ai_service.client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}]
        )
        
        # Extract text from response
        summary = ""
        if response.content:
            for block in response.content:
                if hasattr(block, 'text'):
                    summary += block.text
        
        if not summary or len(summary) < 10:
            raise HTTPException(status_code=500, detail="Failed to generate summary")
        
        # Mock purchase processing (matching research report flow)
        # Frontend shows confirmation modal before calling this endpoint
        transaction_id = f"summary_{summarize_request.source_id}_{int(time.time())}"
        logger.info(f"Mock purchase processed: ${price_cents / 100:.2f} - {transaction_id}")
        
        # Record summary purchase in ledger
        ledger.record_summary_purchase(
            user_id=user_id,
            source_id=summarize_request.source_id,
            url=summarize_request.url,
            price_cents=price_cents,
            transaction_id=transaction_id,
            summary=summary
        )
        
        # Prepare response
        response_data = {
            "source_id": summarize_request.source_id,
            "summary": summary,
            "summary_type": summary_type,  # "full" or "excerpt" for transparency
            "price_cents": price_cents,
            "price": price_cents / 100.0,  # Convert cents to dollars for frontend
            "transaction_id": transaction_id
        }
        
        # Mark as completed
        ledger.set_idempotency_status(
            user_id=user_id,
            idempotency_key=summarize_request.idempotency_key,
            operation_type="summarize",
            status="completed",
            response_data=response_data
        )
        
        logger.info(f"Summary generated and cached for source {summarize_request.source_id}")
        return SummarizeResponse(**response_data)
        
    except HTTPException as http_exc:
        # Clean up idempotency status before re-raising
        logger.error(f"HTTP error during summarization: {http_exc.status_code} - {http_exc.detail}")
        if user_id and summarize_request.idempotency_key:
            ledger.set_idempotency_status(
                user_id=user_id,
                idempotency_key=summarize_request.idempotency_key,
                operation_type="summarize",
                status="failed",
                response_data={"error": http_exc.detail}
            )
        raise
    except Exception as e:
        logger.error(f"Summarization failed: {str(e)}")
        if user_id and summarize_request.idempotency_key:
            ledger.set_idempotency_status(
                user_id=user_id,
                idempotency_key=summarize_request.idempotency_key,
                operation_type="summarize",
                status="failed",
                response_data={"error": str(e)}
            )
        raise HTTPException(status_code=500, detail=f"Summarization failed: {str(e)}")


class FullAccessRequest(BaseModel):
    source_id: str
    url: str
    purchase_price: Optional[float] = None
    idempotency_key: Optional[str] = None


class FullAccessResponse(BaseModel):
    source_id: str
    content: str
    price_cents: int
    price: float
    transaction_id: str


@router.post("/full-access", response_model=FullAccessResponse)
@limiter.limit("20/minute")
async def get_full_access(
    request: Request,
    full_access_request: FullAccessRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """
    Get full article access for human reading.
    
    This endpoint:
    1. Validates authentication and funds
    2. Scrapes the full article content
    3. Registers content with LedeWire
    4. Processes payment
    5. Returns full article HTML/markdown
    """
    user_id = None
    try:
        # Extract and validate Bearer token
        access_token = extract_bearer_token(authorization)
        validate_user_token(access_token)
        user_id = extract_user_id_from_token(access_token)
        
        # Generate stable idempotency key if not provided
        if not full_access_request.idempotency_key:
            request_signature = f"{user_id}:fullaccess:{full_access_request.source_id}:{full_access_request.url}"
            full_access_request.idempotency_key = hashlib.sha256(request_signature.encode()).hexdigest()[:24]
        
        # Check idempotency status
        idem_status = ledger.get_idempotency_status(user_id, full_access_request.idempotency_key, "full_access")
        
        if idem_status:
            if idem_status["status"] == "completed":
                # Return cached response (idempotent 200)
                return FullAccessResponse(**idem_status["response_data"])
            
            elif idem_status["status"] == "processing":
                # Wait inline with short polling
                max_wait_seconds = 15
                poll_interval = 0.5
                attempts = int(max_wait_seconds / poll_interval)
                
                for attempt in range(attempts):
                    time.sleep(poll_interval)
                    updated_status = ledger.get_idempotency_status(user_id, full_access_request.idempotency_key, "full_access")
                    
                    if updated_status and updated_status["status"] == "completed":
                        return FullAccessResponse(**updated_status["response_data"])
                
                # Still processing after max wait - return 202
                return JSONResponse(
                    status_code=202,
                    content={"status": "processing", "message": "Article is being fetched. Please try again in a moment."},
                    headers={"Retry-After": "2"}
                )
            
            elif idem_status["status"] == "failed":
                # Retry failed request
                pass
        
        # Mark as processing
        ledger.set_idempotency_status(
            user_id=user_id,
            idempotency_key=full_access_request.idempotency_key,
            operation_type="full_access",
            status="processing",
            response_data={}
        )
        
        # Calculate price
        price = full_access_request.purchase_price or 0.25
        price_cents = int(price * 100)
        
        # Scrape full article content
        try:
            logger.info(f"Fetching full article: {full_access_request.url}")
            article_content = await scrape_article_content(full_access_request.url)
            logger.info(f"Successfully fetched full article content")
        except HTTPException as e:
            if e.status_code == 403:
                raise HTTPException(
                    status_code=403,
                    detail="Article is behind a paywall and cannot be accessed directly. Please purchase through the publisher."
                )
            else:
                raise
        
        # Register content with LedeWire (for payment tracking)
        try:
            # Register the article with LedeWire
            content_title = f"Full Access: {full_access_request.url}"
            content_stub = f"Full article access for: {full_access_request.url}"
            
            registration_result = ledewire.register_content(
                title=content_title,
                content_body=content_stub,
                price_cents=price_cents,
                visibility="private",
                metadata={
                    "source_id": full_access_request.source_id,
                    "url": full_access_request.url,
                    "access_type": "full_article"
                }
            )
            
            content_id = registration_result.get("id")
            if not content_id:
                logger.error(f"Content registration returned no ID: {registration_result}")
                raise HTTPException(status_code=500, detail="Failed to register content with payment provider")
            
            # Process payment
            payment_result = ledewire.create_purchase(
                access_token=access_token,
                content_id=content_id,
                price_cents=price_cents,
                idempotency_key=full_access_request.idempotency_key
            )
            
            if "error" in payment_result:
                error_msg = ledewire.handle_api_error(payment_result)
                raise HTTPException(status_code=402, detail=f"Payment failed: {error_msg}")
            
            transaction_id = payment_result.get("id") or payment_result.get("transaction_id") or f"fullaccess_{hashlib.sha256(full_access_request.idempotency_key.encode()).hexdigest()[:12]}"
            
        except Exception as e:
            logger.error(f"Payment processing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Payment processing failed: {str(e)}")
        
        # Build response
        response_data = {
            "source_id": full_access_request.source_id,
            "content": article_content,
            "price_cents": price_cents,
            "price": price,
            "transaction_id": transaction_id
        }
        
        # Mark as completed
        ledger.set_idempotency_status(
            user_id=user_id,
            idempotency_key=full_access_request.idempotency_key,
            operation_type="full_access",
            status="completed",
            response_data=response_data
        )
        
        logger.info(f"Full access granted for source {full_access_request.source_id}")
        return FullAccessResponse(**response_data)
        
    except HTTPException as http_exc:
        # Clean up idempotency status before re-raising
        logger.error(f"HTTP error during full access: {http_exc.status_code} - {http_exc.detail}")
        if user_id and full_access_request.idempotency_key:
            ledger.set_idempotency_status(
                user_id=user_id,
                idempotency_key=full_access_request.idempotency_key,
                operation_type="full_access",
                status="failed",
                response_data={"error": http_exc.detail}
            )
        raise
    except Exception as e:
        logger.error(f"Full access failed: {str(e)}")
        if user_id and full_access_request.idempotency_key:
            ledger.set_idempotency_status(
                user_id=user_id,
                idempotency_key=full_access_request.idempotency_key,
                operation_type="full_access",
                status="failed",
                response_data={"error": str(e)}
            )
        raise HTTPException(status_code=500, detail=f"Full access failed: {str(e)}")


@router.get("/stats")
async def get_system_stats():
    """Get system statistics for debugging and monitoring"""
    try:
        # Basic stats for now - in production would implement proper analytics
        return {
            "total_queries": 0,
            "total_revenue_cents": 0,
            "total_revenue_display": "$0.00",
            "active_users": 0,
            "status": "operational"
        }
    except Exception as e:
        return {"error": str(e), "status": "degraded"}


@router.get("/{source_id}/pricing")
async def get_source_pricing(source_id: str, request: Request):
    """Fetch fresh server-authoritative pricing for a specific source (Layer 3 safety check)"""
    try:
        from shared_services import crawler
        
        # Search all cached results for the source
        source = None
        for cache_key in crawler._cache:
            cached_sources, timestamp = crawler._cache[cache_key]
            if crawler._is_cache_valid(timestamp):
                for cached_source in cached_sources:
                    if cached_source.id == source_id:
                        source = cached_source
                        break
            if source:
                break
        
        if not source:
            raise HTTPException(status_code=404, detail=f"Source {source_id} not found in cache")
        
        # Return fresh pricing data
        return {
            "source_id": source.id,
            "title": source.title,
            "unlock_price": source.unlock_price or 0.0,
            "licensing_protocol": source.licensing_protocol,
            "is_unlocked": source.is_unlocked,
            "domain": source.domain
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching source pricing: {str(e)}")


@router.post("/unlock-source", response_model=SourceUnlockResponse)
# @limiter.limit("20/minute")
async def unlock_source(request: Request, unlock_request: SourceUnlockRequest):
    """Secure source unlocking with server-authoritative pricing and idempotency protection"""
    try:
        # In production, this would:
        # 1. Validate JWT token from Authorization header
        # 2. Look up source pricing from source_id (server-authoritative)
        # 3. Check idempotency_key to prevent double-charging
        # 4. Verify user's wallet balance via LedeWire API
        # 5. Process payment and request license token from appropriate protocol
        # 6. Return unlocked content with updated balance
        
        # For development, simulate secure unlock flow
        source_id = unlock_request.source_id
        idempotency_key = unlock_request.idempotency_key
        
        # Simulate server-computed pricing based on source_id
        simulated_cost = 0.15  # Would be computed from source metadata
        simulated_cost_cents = int(simulated_cost * 100)
        
        # Simulate wallet balance after deduction
        simulated_remaining_balance_cents = 50000 - simulated_cost_cents  # $500 - $0.15
        
        # Return sanitized plain text content (no HTML to prevent XSS)
        safe_content = f"Full article content for source {source_id} is now available. In production, this would be the actual licensed content retrieved through the appropriate protocol (RSL, Tollbit, or Cloudflare), properly attributed to the publisher, and formatted according to the license terms."
        
        return SourceUnlockResponse(
            success=True,
            message=f"Source unlocked successfully",
            unlocked_content=safe_content,
            remaining_balance_cents=simulated_remaining_balance_cents,
            wallet_deduction=simulated_cost
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error unlocking source: {str(e)}")


class CategorizeSourceRequest(BaseModel):
    """Request to categorize a source into outline sections"""
    source_title: str
    source_description: str
    section_titles: List[str]


class CategorizeSourceResponse(BaseModel):
    """Response with relevant section indices"""
    relevant_section_indices: List[int]
    confidence: str


@router.post("/categorize", response_model=CategorizeSourceResponse)
@limiter.limit("30/minute")
async def categorize_source(
    request: Request,
    categorize_request: CategorizeSourceRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """
    Use AI to determine which outline sections a source is relevant to.
    This enables automatic placement of sources into multiple appropriate sections.
    """
    try:
        # Validate authentication
        access_token = extract_bearer_token(authorization)
        validate_user_token(access_token)
        
        # Get AI categorization
        suggester = get_outline_suggester()
        categorization = suggester.categorize_source(
            source_title=categorize_request.source_title,
            source_description=categorize_request.source_description,
            section_titles=categorize_request.section_titles
        )
        
        return CategorizeSourceResponse(
            relevant_section_indices=categorization.relevant_section_indices,
            confidence=categorization.confidence
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error categorizing source: {str(e)}")
        # Fallback: return first section
        return CategorizeSourceResponse(
            relevant_section_indices=[0] if len(categorize_request.section_titles) > 0 else [],
            confidence="low"
        )

