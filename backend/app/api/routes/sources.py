"""Source unlock and summarization routes"""

import hashlib
import httpx
from fastapi import APIRouter, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
import time

from schemas.api import SourceUnlockRequest, SourceUnlockResponse
from data.ledger_repository import ResearchLedger
from integrations.ledewire import LedeWireAPI
from services.ai.conversational import AIResearchService
from utils.rate_limit import get_user_or_ip_key, limiter

router = APIRouter()

# Initialize services
ledger = ResearchLedger()
ledewire = LedeWireAPI()
ai_service = AIResearchService()


class SummarizeRequest(BaseModel):
    source_id: str
    url: str
    title: str
    license_cost: Optional[float] = None
    idempotency_key: Optional[str] = None


class SummarizeResponse(BaseModel):
    source_id: str
    summary: str
    price_cents: int
    price: float  # Price in dollars for frontend compatibility
    transaction_id: str


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
            return wallet_id
        raise Exception("No wallet_id in balance response")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Failed to extract user ID: {str(e)}")


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
            
    except Exception as e:
        print(f"⚠️ Failed to scrape {url}: {str(e)}")
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
        
        # Calculate price
        price_cents = calculate_summary_price(summarize_request.license_cost)
        
        # Check wallet balance
        balance_result = ledewire.get_wallet_balance(access_token)
        if balance_result.get('balance_cents', 0) < price_cents:
            ledger.set_idempotency_status(
                user_id=user_id,
                idempotency_key=summarize_request.idempotency_key,
                operation_type="summarize",
                status="failed",
                response_data={"error": "Insufficient balance"}
            )
            raise HTTPException(status_code=402, detail="Insufficient wallet balance")
        
        # Scrape article content
        print(f"📄 Scraping article: {summarize_request.url}")
        article_content = await scrape_article_content(summarize_request.url)
        
        # Generate summary using Claude Haiku
        print(f"🤖 Generating summary with Claude Haiku...")
        prompt = f"""Please provide a concise summary of the following article in 2-3 sentences. Focus on the main points and key takeaways.

Article Title: {summarize_request.title}

Article Content:
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
        
        # Process payment
        transaction_id = f"summary_{summarize_request.source_id}_{int(time.time())}"
        
        if price_cents > 0:
            print(f"💳 Processing payment: ${price_cents / 100:.2f}")
            try:
                purchase_result = ledewire.create_purchase(
                    access_token=access_token,
                    content_id=f"summary_{summarize_request.source_id}",
                    price_cents=price_cents,
                    idempotency_key=summarize_request.idempotency_key
                )
                
                if "error" in purchase_result:
                    error_message = ledewire.handle_api_error(purchase_result)
                    ledger.set_idempotency_status(
                        user_id=user_id,
                        idempotency_key=summarize_request.idempotency_key,
                        operation_type="summarize",
                        status="failed",
                        response_data={"error": error_message}
                    )
                    raise HTTPException(status_code=402, detail=error_message)
                
                transaction_id = purchase_result.get('transaction_id', transaction_id)
                print(f"✅ Payment successful: {transaction_id}")
                
            except HTTPException:
                raise
            except Exception as e:
                print(f"❌ Payment failed: {str(e)}")
                ledger.set_idempotency_status(
                    user_id=user_id,
                    idempotency_key=summarize_request.idempotency_key,
                    operation_type="summarize",
                    status="failed",
                    response_data={"error": str(e)}
                )
                raise HTTPException(status_code=500, detail=f"Payment processing failed: {str(e)}")
        
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
        
        print(f"✅ Summary generated and cached for source {summarize_request.source_id}")
        return SummarizeResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Summarization failed: {str(e)}")
        if user_id and summarize_request.idempotency_key:
            ledger.set_idempotency_status(
                user_id=user_id,
                idempotency_key=summarize_request.idempotency_key,
                operation_type="summarize",
                status="failed",
                response_data={"error": str(e)}
            )
        raise HTTPException(status_code=500, detail=f"Summarization failed: {str(e)}")


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
