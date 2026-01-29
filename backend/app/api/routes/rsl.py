"""
RSL (Really Simple Licensing) API routes
Handles RSL protocol operations: discovery, licensing, and content fetching
"""
import logging
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

from services.licensing.content_licensing import ContentLicenseService
from utils.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter()

# Initialize services
license_service = ContentLicenseService()


# Request/Response Models
class RSLDiscoveryRequest(BaseModel):
    """Request for RSL discovery"""
    url: str = Field(..., description="URL to check for RSL licensing")


class RSLDiscoveryResponse(BaseModel):
    """Response from RSL discovery"""
    protocol: Optional[str] = Field(None, description="Detected protocol (rsl, tollbit, cloudflare)")
    has_licensing: bool = Field(..., description="Whether licensing was found")
    ai_include_price: Optional[float] = Field(None, description="AI inference price")
    purchase_price: Optional[float] = Field(None, description="Full purchase price")
    currency: str = Field(default="USD", description="Currency code")
    publisher: Optional[str] = Field(None, description="Publisher name")
    requires_attribution: bool = Field(default=False, description="Whether attribution is required")
    permits_ai_include: bool = Field(default=False, description="Permits AI inference")
    permits_ai_training: bool = Field(default=False, description="Permits AI training")
    license_server_url: Optional[str] = Field(None, description="OAuth license server URL")


class RSLLicenseRequest(BaseModel):
    """Request for RSL license"""
    url: str = Field(..., description="URL to license")
    license_type: str = Field(default="ai-include", description="License type (ai-include, ai-train, search)")


class RSLLicenseResponse(BaseModel):
    """Response from RSL license request"""
    success: bool = Field(..., description="Whether license was obtained")
    token: Optional[str] = Field(None, description="Access token")
    cost: Optional[float] = Field(None, description="Cost of license")
    currency: str = Field(default="USD", description="Currency code")
    expires_at: Optional[str] = Field(None, description="Token expiration time (ISO format)")
    error: Optional[str] = Field(None, description="Error message if failed")


class RSLContentRequest(BaseModel):
    """Request for licensed content"""
    url: str = Field(..., description="URL to fetch")
    license_type: str = Field(default="ai-include", description="License type")


class RSLContentResponse(BaseModel):
    """Response with licensed content"""
    success: bool = Field(..., description="Whether content was fetched")
    title: Optional[str] = Field(None, description="Content title")
    body: Optional[str] = Field(None, description="Content body text")
    html: Optional[str] = Field(None, description="Content HTML (if requested)")
    publisher: Optional[str] = Field(None, description="Publisher name")
    requires_attribution: bool = Field(default=False, description="Attribution required")
    source_url: str = Field(..., description="Source URL")
    protocol: Optional[str] = Field(None, description="Protocol used")
    cost: Optional[float] = Field(None, description="Cost incurred")
    currency: str = Field(default="USD", description="Currency code")
    error: Optional[str] = Field(None, description="Error message if failed")


@router.post("/discover", response_model=RSLDiscoveryResponse)
@limiter.limit("60/minute")
async def discover_rsl_licensing(
    request: Request,
    discovery_request: RSLDiscoveryRequest
):
    """
    Discover RSL (or other protocol) licensing for a URL
    
    Checks for:
    - RSL XML at standard paths
    - Tollbit API availability
    - Cloudflare Pay-per-Crawl
    
    Returns licensing terms if found.
    """
    try:
        url = discovery_request.url
        logger.info(f"Discovering RSL licensing for {url}")
        
        # Discover licensing using multi-protocol service
        license_info = await license_service.discover_licensing(url)
        
        if not license_info:
            return RSLDiscoveryResponse(
                has_licensing=False,
                protocol=None
            )
        
        terms = license_info['terms']
        
        return RSLDiscoveryResponse(
            protocol=license_info['protocol'],
            has_licensing=True,
            ai_include_price=terms.ai_include_price,
            purchase_price=terms.purchase_price,
            currency=terms.currency,
            publisher=terms.publisher,
            requires_attribution=terms.requires_attribution,
            permits_ai_include=terms.permits_ai_include,
            permits_ai_training=terms.permits_ai_training,
            license_server_url=terms.license_server_url
        )
        
    except Exception as e:
        logger.error(f"Error discovering RSL licensing for {discovery_request.url}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to discover licensing: {str(e)}")


@router.post("/request-license", response_model=RSLLicenseResponse)
@limiter.limit("30/minute")
async def request_rsl_license(
    request: Request,
    license_request: RSLLicenseRequest
):
    """
    Request a license for content access
    
    Steps:
    1. Discover licensing terms
    2. Request OAuth token from license server
    3. Return token and cost information
    """
    try:
        url = license_request.url
        license_type = license_request.license_type
        
        logger.info(f"Requesting RSL license for {url} (type: {license_type})")
        
        # Step 1: Discover licensing
        license_info = await license_service.discover_licensing(url)
        
        if not license_info:
            return RSLLicenseResponse(
                success=False,
                error="No licensing protocol found for this URL"
            )
        
        # Step 2: Request license token
        license_token = await license_service.request_license(license_info, license_type)
        
        if not license_token:
            return RSLLicenseResponse(
                success=False,
                error="Failed to obtain license token"
            )
        
        return RSLLicenseResponse(
            success=True,
            token=license_token.token,
            cost=license_token.cost,
            currency=license_token.currency,
            expires_at=license_token.expires_at.isoformat()
        )
        
    except Exception as e:
        logger.error(f"Error requesting RSL license for {license_request.url}: {e}")
        return RSLLicenseResponse(
            success=False,
            error=str(e)
        )


@router.post("/fetch-content", response_model=RSLContentResponse)
@limiter.limit("20/minute")
async def fetch_rsl_content(
    request: Request,
    content_request: RSLContentRequest
):
    """
    Fetch licensed content
    
    Complete workflow:
    1. Discover licensing
    2. Request license token  
    3. Fetch content with authorization
    4. Return content with attribution info
    """
    try:
        url = content_request.url
        license_type = content_request.license_type
        
        logger.info(f"Fetching licensed content from {url}")
        
        # Use the integrated fetch method that handles the full workflow
        result = await license_service.fetch_licensed_content(url, license_type)
        
        if not result:
            return RSLContentResponse(
                success=False,
                source_url=url,
                error="Failed to fetch licensed content"
            )
        
        content = result.get('content', {})
        
        return RSLContentResponse(
            success=True,
            title=content.get('title'),
            body=content.get('body'),
            html=content.get('html'),
            publisher=content.get('publisher'),
            requires_attribution=content.get('requires_attribution', False),
            source_url=url,
            protocol=result.get('protocol'),
            cost=result.get('cost'),
            currency=result.get('currency', 'USD')
        )
        
    except Exception as e:
        logger.error(f"Error fetching RSL content from {content_request.url}: {e}")
        return RSLContentResponse(
            success=False,
            source_url=content_request.url,
            error=str(e)
        )


@router.get("/health")
async def rsl_health_check():
    """Health check endpoint for RSL service"""
    return {
        "status": "healthy",
        "service": "rsl",
        "protocols": ["rsl", "tollbit", "cloudflare"],
        "version": "1.0.0"
    }
