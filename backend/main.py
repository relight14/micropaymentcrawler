import uuid
import requests
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, HTMLResponse
import uvicorn

from pydantic import BaseModel
from typing import Dict, Any, Optional
from models import (
    TiersRequest, TiersResponse, TierInfo, TierType,
    PurchaseRequest, PurchaseResponse, 
    SourceUnlockRequest, SourceUnlockResponse,
    LoginRequest, SignupRequest, AuthResponse, WalletBalanceResponse
)

class ChatRequest(BaseModel):
    message: str
    mode: str = "conversational"  # "conversational" or "deep_research"

class ChatResponse(BaseModel):
    response: str
    mode: str
    conversation_length: int
    sources: Optional[list] = None
    licensing_summary: Optional[dict] = None
    total_cost: Optional[float] = None
    refined_query: Optional[str] = None
from crawler_stub import ContentCrawlerStub
from ledger import ResearchLedger
from packet_builder import PacketBuilder
from ledewire_api import LedeWireAPI
from html_generator import generate_html_packet
from ai_service import AIResearchService

app = FastAPI(title="AI Research Tool MVP", version="1.0.0")

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend files
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

# Initialize components
crawler = ContentCrawlerStub()
ledger = ResearchLedger()
packet_builder = PacketBuilder()
ledewire = LedeWireAPI()  # Production LedeWire API integration
ai_service = AIResearchService()  # AI conversational and research service

# Authentication Helper Functions

def extract_bearer_token(authorization: str) -> str:
    """
    Extract and validate Bearer token from Authorization header.
    Returns the JWT token string or raises HTTPException if invalid.
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")
    
    access_token = authorization.split(" ", 1)[1].strip()
    
    if not access_token:
        raise HTTPException(status_code=401, detail="Bearer token cannot be empty")
    
    return access_token

def validate_user_token(access_token: str):
    """
    Validate JWT token with LedeWire API.
    Raises HTTPException if token is invalid or expired.
    """
    try:
        # Verify token is valid by checking wallet balance
        # This also confirms the user exists and token is not expired
        balance_result = ledewire.get_wallet_balance(access_token)
        
        # Check for API errors
        if "error" in balance_result:
            error_message = ledewire.handle_api_error(balance_result)
            raise HTTPException(status_code=401, detail=f"Invalid token: {error_message}")
            
        return True
        
    except HTTPException:
        # Re-raise HTTP exceptions (auth failures)
        raise
    except Exception as e:
        # Distinguish network errors from auth errors
        import requests
        if isinstance(e, requests.HTTPError) and hasattr(e, 'response'):
            if e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Authentication service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Authentication service error")
        else:
            # Network error or other connection issue
            raise HTTPException(status_code=503, detail="Authentication service unavailable")

@app.get("/")
async def root():
    """Root endpoint - redirect to chat interface."""
    return RedirectResponse(url="/static/chat.html")

@app.post("/tiers", response_model=TiersResponse)
async def get_tiers(request: TiersRequest):
    """
    Get pricing tiers for a research query.
    Returns estimated costs and features for Basic, Research, and Pro tiers.
    """
    try:
        # Generate tier information with dynamic pricing considerations
        tiers = [
            TierInfo(
                tier=TierType.BASIC,
                price=1.00,
                sources=10,
                includes_outline=False,
                includes_insights=False,
                description="10 research sources with summary"
            ),
            TierInfo(
                tier=TierType.RESEARCH,
                price=2.00,
                sources=20,
                includes_outline=True,
                includes_insights=False,
                description="20 research sources with summary and structured outline"
            ),
            TierInfo(
                tier=TierType.PRO,
                price=4.00,
                sources=40,
                includes_outline=True,
                includes_insights=True,
                description="40 research sources with summary, outline, and strategic insights"
            )
        ]
        
        return TiersResponse(query=request.query, tiers=tiers)
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating tiers: {str(e)}")

# Licensing Summary Models
class LicensingSummaryRequest(BaseModel):
    query: str
    tier: TierType

class LicensingSummaryResponse(BaseModel):
    query: str
    tier: TierType
    total_cost: float
    currency: str
    licensed_count: int
    unlicensed_count: int
    protocol_breakdown: Dict[str, Dict[str, Any]]

@app.post("/licensing-summary", response_model=LicensingSummaryResponse)
async def get_licensing_summary(request: LicensingSummaryRequest):
    """
    Get licensing cost summary for a research query and tier.
    Analyzes sources to determine multi-protocol licensing costs.
    """
    try:
        # Map tier to source count
        tier_source_counts = {
            TierType.BASIC: 10,
            TierType.RESEARCH: 20, 
            TierType.PRO: 40
        }
        
        source_count = tier_source_counts[request.tier]
        
        # Generate sources with licensing discovery
        sources = crawler.generate_sources(request.query, source_count)
        
        # Convert SourceCard objects to dictionaries for license service
        sources_dicts = []
        for source in sources:
            source_dict = source.dict()  # Convert Pydantic model to dict
            # Add license_info if available
            if source.licensing_protocol:
                source_dict['license_info'] = {
                    'protocol': source.licensing_protocol,
                    'terms': {
                        'protocol': source.licensing_protocol,
                        'ai_include_price': source.license_cost,
                        'publisher': source.publisher_name
                    }
                }
            sources_dicts.append(source_dict)
        
        # Get licensing summary from crawler's license service
        licensing_summary = crawler.license_service.get_license_summary(sources_dicts)
        
        return LicensingSummaryResponse(
            query=request.query,
            tier=request.tier,
            total_cost=licensing_summary['total_cost'],
            currency=licensing_summary['currency'],
            licensed_count=licensing_summary['licensed_count'],
            unlicensed_count=licensing_summary['unlicensed_count'],
            protocol_breakdown=licensing_summary['protocol_breakdown']
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error calculating licensing summary: {str(e)}")

@app.post("/purchase", response_model=PurchaseResponse)
async def purchase_research(request: PurchaseRequest, authorization: str = Header(None, alias="Authorization")):
    """
    Process a research purchase request using LedeWire API with server-enforced licensing costs.
    Requires valid Bearer token authentication for all purchases.
    Server-side pricing is authoritative to ensure publisher compensation.
    """
    try:
        # SECURITY: Extract and validate Bearer token from Authorization header
        access_token = extract_bearer_token(authorization)
        
        # SECURITY: Validate JWT token and get user info
        validate_user_token(access_token)
        user_info = ledewire.get_user_info(access_token)
        user_id = user_info["user_id"]
        
        # SERVER-SIDE PRICING: Calculate licensing costs (authoritative pricing)
        tier_source_counts = {
            TierType.BASIC: 10,
            TierType.RESEARCH: 20, 
            TierType.PRO: 40
        }
        
        # Generate sources with licensing discovery (server-side)
        sources = crawler.generate_sources(request.query, tier_source_counts[request.tier])
        
        # Convert to dicts and calculate licensing summary
        sources_dicts = []
        license_tokens = []
        for source in sources:
            source_dict = source.dict()
            if source.licensing_protocol:
                source_dict['license_info'] = {
                    'protocol': source.licensing_protocol,
                    'terms': {
                        'protocol': source.licensing_protocol,
                        'ai_include_price': source.license_cost,
                        'publisher': source.publisher_name
                    }
                }
                # REQUEST LICENSE TOKENS for licensed sources (publisher compensation!)
                try:
                    license_info = crawler.license_service.discover_licensing(source_dict.get('url', ''))
                    if license_info:
                        token = crawler.license_service.request_license(license_info, "ai-include")
                        if token:
                            license_tokens.append({
                                'source_id': source.id,
                                'protocol': token.protocol,
                                'cost': token.cost,
                                'token': token.token
                            })
                except Exception as e:
                    print(f"License token request failed for {source.id}: {e}")
            sources_dicts.append(source_dict)
        
        # Get server-authoritative licensing summary 
        licensing_summary = crawler.license_service.get_license_summary(sources_dicts)
        
        # Calculate TOTAL price (base + licensing costs)
        tier_base_prices = {
            TierType.BASIC: 1.00,
            TierType.RESEARCH: 2.00,  
            TierType.PRO: 4.00
        }
        
        base_price = tier_base_prices[request.tier]
        licensing_cost = licensing_summary['total_cost']
        total_price_dollars = base_price + licensing_cost
        price_cents = int(total_price_dollars * 100)  # Convert to cents for LedeWire
        
        # Generate unique content ID for this research packet
        content_id = f"research_{uuid.uuid4().hex[:12]}"
        
        # Create purchase through LedeWire
        purchase_result = ledewire.create_purchase(
            access_token=access_token,
            content_id=content_id,
            price_cents=price_cents
        )
        
        # Check for purchase errors
        if "error" in purchase_result:
            error_message = ledewire.handle_api_error(purchase_result)
            return PurchaseResponse(
                success=False,
                message=error_message,
                wallet_deduction=0.0
            )
        
        # Generate research packet with content ID
        packet = packet_builder.build_packet(request.query, request.tier)
        packet.content_id = content_id  # Add LedeWire content ID
        
        # Record the purchase in ledger with user ID (not raw token)
        purchase_id = ledger.record_purchase(
            query=request.query,
            tier=request.tier,
            price=total_price_dollars,  # Use total price including licensing
            wallet_id=user_id,  # SECURITY: Use user ID instead of raw access token
            transaction_id=purchase_result["id"],
            packet=packet
        )
        
        return PurchaseResponse(
            success=True,
            message=f"Research packet generated successfully (ID: {purchase_id}) - {len(license_tokens)} licenses purchased",
            wallet_deduction=total_price_dollars,
            packet=packet,
            licensing_summary=licensing_summary,  # Include licensing breakdown in response
            license_tokens=license_tokens  # Include issued tokens
        )
    
    except HTTPException:
        # Re-raise HTTP exceptions (including 401 auth failures) with original status
        raise
    except requests.HTTPError as e:
        # Handle LedeWire API errors with correct status codes
        if hasattr(e, 'response') and e.response is not None:
            if e.response.status_code == 402:
                raise HTTPException(status_code=402, detail="Insufficient funds in wallet")
            elif e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code == 400:
                raise HTTPException(status_code=400, detail="Invalid purchase request")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Purchase service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Purchase service error")
        else:
            raise HTTPException(status_code=503, detail="Purchase service unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Purchase failed: {str(e)}")

# Wallet deduction handled directly through LedeWire API in purchase endpoint

@app.get("/stats")
async def get_stats():
    """Get basic usage statistics for the MVP."""
    try:
        stats = ledger.get_purchase_stats()
        return {"success": True, "stats": stats}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/unlock-source", response_model=SourceUnlockResponse)
async def unlock_source(request: SourceUnlockRequest, authorization: str = Header(None, alias="Authorization")):
    """
    Process a source unlock request using LedeWire API.
    Requires valid Bearer token authentication for all source purchases.
    """
    try:
        # SECURITY: Extract and validate Bearer token from Authorization header
        access_token = extract_bearer_token(authorization)
        
        # SECURITY: Validate JWT token and get user info
        validate_user_token(access_token)
        user_info = ledewire.get_user_info(access_token)
        user_id = user_info["user_id"]
        
        # Convert price to cents for LedeWire API
        price_cents = int(request.price * 100)
        
        # Generate content ID for this source
        source_content_id = f"source_{request.source_id}"
        
        # Create purchase through LedeWire
        purchase_result = ledewire.create_purchase(
            access_token=access_token,
            content_id=source_content_id,
            price_cents=price_cents
        )
        
        # Check for purchase errors
        if "error" in purchase_result:
            error_message = ledewire.handle_api_error(purchase_result)
            return SourceUnlockResponse(
                success=False,
                message=error_message,
                wallet_deduction=0.0
            )
        
        # Simulate generating unlocked content
        unlocked_content = f"""**Full Content for: {request.title}**

This is the complete content that was previously locked. In a real implementation, this would be fetched from the content crawling service.

Key insights from this source:
• Detailed analysis and findings
• Supporting evidence and data
• Expert commentary and conclusions

[Content unlocked for ${request.price:.2f}]"""
        
        # Note: In production, would record source unlock with user_id
        # ledger.record_source_unlock(purchase_id, request.source_id, request.price, user_id)
        
        return SourceUnlockResponse(
            success=True,
            message=f"Source unlocked successfully",
            wallet_deduction=request.price,
            unlocked_content=unlocked_content
        )
    
    except HTTPException:
        # Re-raise HTTP exceptions (including 401 auth failures) with original status
        raise
    except requests.HTTPError as e:
        # Handle LedeWire API errors with correct status codes
        if hasattr(e, 'response') and e.response is not None:
            if e.response.status_code == 402:
                raise HTTPException(status_code=402, detail="Insufficient funds in wallet")
            elif e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code == 400:
                raise HTTPException(status_code=400, detail="Invalid source unlock request")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Source unlock service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Source unlock service error")
        else:
            raise HTTPException(status_code=503, detail="Source unlock service unavailable")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Source unlock failed: {str(e)}")

# Authentication Endpoints

@app.post("/auth/login", response_model=AuthResponse)
async def login_user(request: LoginRequest):
    """
    Authenticate user with email and password.
    Returns JWT access token for wallet access.
    """
    try:
        # Use LedeWire API to authenticate user
        auth_result = ledewire.authenticate_user(request.email, request.password)
        
        if "access_token" in auth_result:
            return AuthResponse(
                access_token=auth_result["access_token"],
                refresh_token=auth_result.get("refresh_token", ""),
                expires_at=auth_result.get("expires_at", "")
            )
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")
            
    except Exception as e:
        print(f"Login error: {e}")
        import requests
        # Handle LedeWire API errors with correct status codes
        if isinstance(e, requests.HTTPError) and hasattr(e, 'response'):
            if e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid email or password")
            elif e.response.status_code == 400:
                raise HTTPException(status_code=400, detail="Invalid request format")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Authentication service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Authentication service error")
        else:
            raise HTTPException(status_code=503, detail="Authentication service unavailable")

@app.post("/auth/signup", response_model=AuthResponse) 
async def signup_user(request: SignupRequest):
    """
    Create new user account and return JWT token.
    """
    try:
        # Use LedeWire API to create user account
        auth_result = ledewire.signup_user(request.email, request.password, request.name)
        
        if "access_token" in auth_result:
            return AuthResponse(
                access_token=auth_result["access_token"],
                refresh_token=auth_result.get("refresh_token", ""),
                expires_at=auth_result.get("expires_at", "")
            )
        else:
            raise HTTPException(status_code=400, detail="Account creation failed")
            
    except Exception as e:
        print(f"Signup error: {e}")
        import requests
        # Handle LedeWire API errors with correct status codes
        if isinstance(e, requests.HTTPError) and hasattr(e, 'response'):
            if e.response.status_code == 400:
                raise HTTPException(status_code=400, detail="Invalid signup data")
            elif e.response.status_code == 409:
                raise HTTPException(status_code=409, detail="Email address already registered")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Account creation service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Account creation service error")
        else:
            raise HTTPException(status_code=503, detail="Account creation service unavailable")

@app.get("/wallet/balance", response_model=WalletBalanceResponse)
async def get_wallet_balance(authorization: str = Header(None, alias="Authorization")):
    """
    Get user's current wallet balance.
    Requires Bearer token in Authorization header.
    """
    try:
        # Extract bearer token from headers
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Authorization token required")
            
        access_token = authorization.split(" ")[1]
        
        # Get wallet balance from LedeWire API
        balance_result = ledewire.get_wallet_balance(access_token)
        
        if "balance_cents" in balance_result:
            return WalletBalanceResponse(balance_cents=balance_result["balance_cents"])
        else:
            raise HTTPException(status_code=400, detail="Could not retrieve balance")
            
    except HTTPException:
        raise
    except requests.HTTPError as e:
        # Handle LedeWire API errors with correct status codes
        print(f"Wallet balance HTTP error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            if e.response.status_code == 401:
                raise HTTPException(status_code=401, detail="Invalid or expired token")
            elif e.response.status_code == 400:
                raise HTTPException(status_code=400, detail="Invalid wallet balance request")
            elif e.response.status_code in [502, 503, 504]:
                raise HTTPException(status_code=503, detail="Wallet service temporarily unavailable")
            else:
                raise HTTPException(status_code=500, detail="Wallet service error")
        else:
            raise HTTPException(status_code=503, detail="Wallet service unavailable")
    except Exception as e:
        print(f"Wallet balance error: {e}")
        raise HTTPException(status_code=500, detail="Failed to get wallet balance")

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "service": "AI Research Tool MVP"}

@app.get("/research-packet/{content_id}", response_class=HTMLResponse)
async def get_research_packet_html(content_id: str):
    """
    Serve research packet as clean academic HTML report.
    This would check LedeWire purchase verification in production.
    """
    try:
        # In production, this would verify purchase via LedeWire API
        # For now, we'll retrieve from our ledger for demo purposes
        packet_data = ledger.get_packet_by_content_id(content_id)
        
        if not packet_data:
            raise HTTPException(status_code=404, detail="Research packet not found")
        
        # Generate clean HTML report
        html_content = generate_html_packet(packet_data)
        
        return HTMLResponse(content=html_content)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error serving research packet: {str(e)}")

# AI Chat Endpoints

@app.post("/chat")
async def chat(request: ChatRequest, authorization: str = Header(None)):
    """AI chat endpoint supporting both conversational and deep research modes"""
    try:
        # Authentication check for deep research mode (optional for conversational)
        if request.mode == "deep_research" and authorization:
            validate_user_token(extract_bearer_token(authorization))
        
        # Process chat message
        response = ai_service.chat(request.message, request.mode)
        
        return ChatResponse(**response)
        
    except HTTPException:
        raise
    except Exception as e:
        return ChatResponse(
            response="I'm having trouble right now, but I'm here to help with your research questions!",
            mode=request.mode,
            conversation_length=len(ai_service.conversation_history)
        )

@app.get("/conversation-history")
async def get_conversation_history():
    """Get current conversation history"""
    return {
        "history": ai_service.get_conversation_history(),
        "length": len(ai_service.conversation_history)
    }

@app.post("/clear-conversation")
async def clear_conversation():
    """Clear conversation history for fresh start"""
    ai_service.clear_conversation()
    return {"success": True, "message": "Conversation cleared"}

if __name__ == "__main__":
    # For production deployment
    uvicorn.run("main:app", host="0.0.0.0", port=5000, reload=True)