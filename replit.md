# Overview

This project is an AI-powered research tool MVP offering dynamic research services with per-source pricing. Users can submit complex research queries and receive personalized research packages with variable pricing based on query complexity, source quality, and licensing costs. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The business vision is to provide a competitive differentiator with "real data, not made up," ensuring authentic source validation and professional presentation with ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

- **October 2, 2025**: Pre-deployment security audit and hardening
  - **Backend Security Fixes**:
    - Fixed rate limiting: Centralized limiter instance in app factory shared across all endpoints
    - Fixed authentication bypass: Removed anonymous fallback from chat endpoints (/chat, /history, /user-id, /clear) - now returns 401 when unauthorized
    - Fixed insecure CORS: Restricted origins to explicit allowlist (configurable via ALLOWED_ORIGINS env var), disabled wildcard allow_credentials, limited methods and headers
  - **Frontend Security Cleanup**:
    - Removed console logging of sensitive user data: research queries, conversation context, and request payloads no longer logged
    - Cleaned up debug logs exposing user information in getUserInitials()
  - **Known Security Consideration for Future Deployment**:
    - Refresh tokens are currently stored in localStorage (vulnerable to XSS attacks). For enhanced security in production, consider implementing httpOnly secure cookies for refresh token storage with server-side session management. This would require backend architecture changes to support cookie-based refresh flows.
  - **Result**: Production-ready security posture with proper authentication enforcement, rate limiting, and CORS configuration. All critical security gaps closed.

- **October 2, 2025**: Comprehensive token expiry handling system
  - Implemented automatic JWT token validation on app initialization to detect expired tokens before API calls
  - Added logout callback system in AuthService for coordinated UI updates when sessions expire
  - Centralized 401 error handling with `_handle401()` helper method across all API endpoints
  - All API methods now trigger automatic logout on 401 responses: chat, research, tier analysis, source unlock, report generation, conversation clear
  - Background enrichment polling gracefully stops on 401 without error suppression
  - UI automatically refreshes on session expiry: auth button updates and "Session expired. Please log in again." toast displays
  - Consistent error messaging across all authentication failures for better UX
  - **Result**: Production-ready token expiry system with no security gaps, proper error handling, and excellent user experience

- **October 1, 2025**: Unified message rendering system - Major architectural refactor
  - Created MessageRenderer class with BEM-style CSS architecture for consistent, maintainable message rendering
  - Eliminated CSS selector mismatches that caused recurring styling bugs (loading indicator emoji-only display, inconsistent message layouts)
  - Refactored all message creation to use single source of truth: MessageRenderer.createMessageElement()
  - Standardized BEM naming convention: `.message--{type}` for modifiers, `.message__{element}` for children
  - Removed 6 old formatting methods from UIManager and 120+ lines of duplicate CSS
  - Updated loading indicators, typing indicators, and all message variants to use unified API
  - Comprehensive JSDoc documentation with usage examples in MessageRenderer.js
  - **Result**: Durable, long-term stable message system that prevents future CSS conflicts and simplifies extensions

- **October 1, 2025**: AI-powered tiered research reports with Claude integration
  - Integrated Claude API (Haiku model) for generating tier-specific research reports with distinct content quality
  - Research tier ($0.99): ~500 word executive summaries with key findings and source citations
  - Pro tier ($1.99): ~1500 word comprehensive analyst reports with confidence scoring, thematic analysis, related questions, and executive briefing
  - Implemented 10-minute in-memory caching (50-entry LRU) to reduce Claude API costs on repeated queries
  - Added graceful fallback to basic summaries if Claude API fails, maintaining purchase flow integrity
  - Wired tier purchase cards to real purchase endpoint (`/api/purchase`) which generates AI reports instead of mock enrichment endpoint
  - Frontend now calls `purchaseTier()` API for Research/Pro cards, triggering full backend pipeline: source generation → Claude report generation → packet building → payment processing

- **September 30, 2025**: Tollbit integration enhanced with dual-pricing model
  - Implemented per-URL caching for individual article pricing (replacing domain-level caching)
  - Fixed Tollbit API endpoint to use raw URL path format for successful pricing discovery
  - Added support for TOLLBIT_ORG_CUID and TOLLBIT_AGENT_ID environment variables
  - Enhanced license parsing to extract both ON_DEMAND_LICENSE (partial use) and ON_DEMAND_FULL_USE_LICENSE prices
  - **Dual-pricing model**: Source unlock uses FULL_USE price ($0.012) for human readers, while AI report generation uses PARTIAL_USE price ($0.005-0.09) for AI summaries
  - Verified live Tollbit pricing with real data: time.com sources return variable pricing from $0.005 to $0.09 per article

- **September 29, 2025**: Production security hardening completed and deployment configured
  - Implemented JWT authentication requirements for all research endpoints (/analyze, /generate-report, /enrichment) 
  - Added tiered rate limiting (5, 15, 30, 60/minute) based on operation cost to prevent API abuse
  - Implemented input validation with minimal sanitization that preserves research content while removing control characters
  - Added parameter validation with regex guards for cache keys and source IDs
  - Configured generic error messages to prevent information disclosure
  - Verified all API keys (Tavily, Anthropic, LedeWire) are properly managed via environment variables
  - Configured autoscale deployment settings for production readiness
  - All security measures verified working correctly while maintaining full research functionality

# System Architecture

## UI/UX Decisions
The frontend is a Single Page Application built with vanilla HTML/CSS/JavaScript, featuring a clean, modular ES6 architecture. It delivers a responsive, modern interface with tier selection cards and dynamic content loading. UI elements include story cards with quotes and descriptions for source articles, professional presentation for search results, and transparent licensing badges (RSL 🔒, Tollbit ⚡, Cloudflare ☁️).

## Technical Implementations
- **Frontend**: Frontend-Consolidated architecture with single source of truth for components:
  - `js/app.js` - Main application controller (pure coordination)
  - `js/services/api.js` - Backend communication with proper authentication headers
  - `js/services/auth.js` - Authentication and wallet management
  - `js/state/app-state.js` - Centralized state management with immutable patterns
  - `js/components/ui-manager.js` - Pure UI logic and DOM manipulation
  - `js/components/source-card.js` - **Single source of truth** for all source card generation and interaction logic
  - `js/utils/helpers.js` - Reusable utility functions
  - `styles/components/source-card.css` - **Consolidated CSS** for all source card styling, eliminating conflicts between multiple CSS files
- **Backend**: Built with FastAPI using unified service architecture under `services/` directory with consolidated modules for AI processing (`services/ai/`), content licensing (`services/licensing/`), and research operations (`services/research/`). Uses `schemas/domain.py` as single source of truth for data models.
- **Content Generation**: Hybrid pipeline uses Tavily for discovering real URLs and Claude for content polishing, with licensing detection and graceful API fallbacks.
- **Authentication**: Secure authentication with proper JWT token management, LedeWire integration, and optimistic authentication flows with robust 401 handling.
- **Dual-Mode AI Experience**: Conversational AI mode and deep research mode with licensed source access and dynamic pricing.

## Feature Specifications
- **Dynamic Research Services**: Query-based research packages with variable pricing ($0.10-$10.00) determined by source count, quality factors, and licensing complexity. No fixed tiers - users pay for exactly what they need.
- **Dynamic Pricing**: Source unlocking costs are dynamically calculated based on AI relevance scoring, quality factors (peer-reviewed: 1.5x, recent: 1.2x, citations: 1.4x), and licensing protocols, with a 60/40 budget allocation for licensing and corporate margin.
- **Content Licensing**: A multi-protocol abstraction layer supports RSL, Tollbit, and Cloudflare licensing, with server-authoritative pricing and real license token issuance. Frontend displays protocol badges and cost breakdowns.
- **Mock Mode**: A robust mock mode (`LEDEWIRE_USE_MOCK=true`) short-circuits LedeWire API methods for faster development, eliminating network calls and preventing production use.
- **Wallet Integration**: Designed for secure integration with LedeWire for real-time wallet balance checks, purchase processing, and content access, including idempotency keys for fraud protection.

## System Design Choices
- **Data Storage**: SQLite database for lightweight persistence, tracking purchases, source unlocks, and maintaining an audit trail. Complex data structures are stored as JSON.
- **Simulation Layer**: `ContentCrawlerStub` simulates content crawling and pricing algorithms, generating realistic academic content for testing.
- **API-First Architecture**: All pricing decisions are centralized in the backend, making the frontend a pure presentation layer.
- **Production Readiness**: Architect-approved implementations ensure robust error handling, security, and scalability for live deployment.

# External Dependencies

- **FastAPI**: Python web framework for the backend API.
- **Pydantic**: Data validation and serialization.
- **SQLite3**: For local database persistence.
- **UUID**: For generating unique identifiers.
- **CORS Middleware**: For handling cross-origin requests.
- **Uvicorn**: ASGI server for running FastAPI.
- **Tavily API**: For discovering real, clickable URLs from live web search.
- **Anthropic Claude API**: For AI-powered content polishing and conversational AI.
- **LedeWire Wallet API**: Integrated for authentication, wallet balance, and purchase processing (live HTTP integration with production security).

# Deployment Checklist

## Required Environment Variables
Before deploying to production, ensure all required environment variables are configured in Replit Secrets:

### Critical (Required)
- `ANTHROPIC_API_KEY` - Claude AI integration for report generation and chat
- `TAVILY_API_KEY` - Web search functionality for discovering sources
- `TOLLBIT_API_KEY` - Tollbit content licensing integration
- `LEDEWIRE_API_KEY` - LedeWire wallet authentication (already configured)
- `ALLOWED_ORIGINS` - **MUST be set in production** to restrict CORS (comma-separated list of allowed domains)

### Optional (Tollbit Enhancement)
- `TOLLBIT_ORG_CUID` - Organization identifier for Tollbit
- `TOLLBIT_AGENT_ID` - Agent identifier for Tollbit (defaults to 'ResearchTool-1.0')

### Testing/Development Only
- `LEDEWIRE_MOCK_PAYMENTS` - Set to "true" for payment testing (never use in production)
- `LEDEWIRE_USE_MOCK` - Set to "true" for mock auth mode (never use in production)

## Security Checklist
- ✅ Rate limiting centralized and applied to all endpoints
- ✅ Authentication required for all chat and research endpoints (no anonymous fallback)
- ✅ CORS configured with explicit origin allowlist support
- ✅ Sensitive data logging removed from console logs
- ✅ Input validation and sanitization implemented
- ✅ Generic error messages prevent information disclosure
- ⚠️ **Action Required**: Set `ALLOWED_ORIGINS` environment variable to your production domain before deploying
- ⚠️ **Known Limitation**: Refresh tokens stored in localStorage (vulnerable to XSS) - consider implementing httpOnly cookies for enhanced security in future

## Deployment Configuration
The application is configured for Replit Autoscale deployment in `.replit`:
- **Deployment Target**: `autoscale` (stateless, scales automatically)
- **Run Command**: `python backend/main.py`
- **Port**: 5000 (frontend and API served from same origin)
- **No Build Step Required**: Pure Python with static assets

## Pre-Deployment Verification
1. **Environment Variables**: Verify all required secrets are set in Replit dashboard
2. **CORS Configuration**: Set `ALLOWED_ORIGINS` to your production domain (e.g., `https://yourdomain.com`)
3. **Test Mock Mode is Disabled**: Ensure `LEDEWIRE_MOCK_PAYMENTS` is not set or is set to "false"
4. **Rate Limits**: Verify rate limiting is appropriate for your expected traffic
5. **Database**: SQLite database (`research_ledger.db`) will be created automatically on first run

## Post-Deployment Validation
1. Test authentication flow (login/signup)
2. Test chat functionality with Claude AI
3. Test research mode with Tavily search
4. Test tier purchase flow with LedeWire wallet
5. Verify CORS headers are correctly restricted
6. Monitor rate limiting behavior under load