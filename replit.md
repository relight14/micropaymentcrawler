# Overview

This project is an AI-powered research tool MVP that provides dynamic research services with per-source pricing. It enables users to submit complex queries and receive personalized research packages, with costs adjusted based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. Its core mission is to provide "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a responsive, modern Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It features a single-button report generation interface, dynamic content loading, story cards with quotes and descriptions, and professional presentation of search results with transparent licensing badges. The UI features a clean **three-column layout (Chat | Sources | Outline)** with a projects dropdown menu accessible via a layers icon button in the top-left header. It includes responsive adjustments for various devices, with a **mobile-specific 4-tab navigation bar (Projects, Chat, Sources, Outline)**. All reports use the **Pro Package-only model** with simplified pricing at $0.05 per source.

## Technical Implementations
The frontend uses a modular layered architecture with an Application Controller, Infrastructure Managers, Controllers, Domain Managers, Core Services, and UI Components. It supports anonymous users with conversation history persistence upon login. Project management includes loading and displaying saved messages, and report status management uses a five-state machine. Research queries persist with projects, and Google Analytics 4 is integrated.

The backend is developed with FastAPI, employing a unified service architecture for AI processing, content licensing, and research operations. It uses a hybrid content generation pipeline with Tavily for URL discovery and Anthropic Claude for content refinement and report generation, including licensing detection. AI-powered query optimization uses Claude Haiku to refine searches, and Claude also provides relevance filtering. Premium reports utilize Claude Sonnet 4. Authentication features secure JWT token management, LedeWire integration, and robust error handling. The system includes a research brief extraction system, a dual classification pipeline for query intent and temporal recency, and a recency-weighted reranking algorithm. A premium source authority system prioritizes paid sources. Source type classification and blending, hybrid publication search, and a dual-mode AI experience (conversational and deep research) are implemented. AI-powered research reports are generated with numbered citations, caching, and progressive loading. The system supports user-selected source reports and includes a shared crawler singleton. Inline citation badges indicate locked sources in reports. Intelligent mode switching suggests transitioning to research mode, and a feedback system collects user input. Reports can be downloaded as Markdown files. The input field is an auto-expanding textarea, and conversation management prevents cross-topic pollution. A smart summary button indicates purchase status. File upload functionality allows users to upload .doc/.docx/.md/.pdf files for AI processing, integrating them into the outline and report generation.

## Feature Specifications
The project provides dynamic research services with **simplified Pro Package-only pricing** at **$0.05 per source**. Dynamic pricing is calculated client-side using `sources × $0.05` and verified by backend API quotes. The Report Builder displays both the calculated price in the card header and the dynamic price in the button text. Content licensing utilizes a multi-protocol abstraction layer (RSL, Tollbit, Cloudflare) with server-authoritative pricing. A robust mock mode is available for development. Secure integration with LedeWire handles wallet balance checks, purchase processing, and content access.

## System Design Choices
Data storage uses PostgreSQL for production and SQLite for development. A `ContentCrawlerStub` simulates crawling and pricing for testing. The architecture is API-first, with all pricing decisions handled by the backend. Production readiness includes comprehensive security (CORS, configuration validation), cost controls (per-user budgets, global caps), reliability (error handling, logging), scalability (PostgreSQL, rate limiting), and operational considerations. The frontend is the source of truth for source selection.

## Security Implementations
- **SafeRenderer utility** (`backend/static/js/utils/safe-renderer.js`): XSS protection for all content from LLM, backend, and crawlers. Features HTML escaping, sanitization with tag/attribute whitelists, and hardened URL validation that blocks javascript:/data:/vbscript: schemes including whitespace/control-character bypass attempts and entity-encoded payloads.
- **MessageRenderer integration**: All HTML content rendered via `parseHtml()` is sanitized through SafeRenderer before DOM insertion.
- **Logger utility** (`backend/static/js/utils/logger.js`): Debug logging gated behind `DEBUG_MODE` flag to keep production console clean; warnings and errors still visible.

## LedeWire Wallet Integration
The application integrates with LedeWire for all payment processing, including Stripe. This app does not directly integrate with payment providers - all payment flows go through LedeWire APIs.

**Pre-Purchase Checkout State Verification:**
- `POST /api/purchase/checkout-state` - Checks authentication, wallet balance, and purchase status
- Returns `next_required_action`: authenticate | fund_wallet | purchase | none
- Includes `shortfall_cents` for insufficient balance scenarios
- Supports `content_id` for already-purchased detection

**Wallet Funding Flow:**
- Stripe Elements integration via LedeWire's `POST /v1/wallet/payment-session`
- Payment status polling: `GET /api/wallet/payment-status/{session_id}` - 15 attempts at 2-second intervals
- Dynamic funding modal with recommended amounts (rounded up to nearest $5)

**LedeWire API Endpoints Used:**
- `POST /v1/purchases` - Create purchase with idempotency
- `GET /v1/purchase/verify?content_id=X` - Check if already purchased
- `GET /v1/wallet/payment-status/{session_id}` - Poll for payment completion
- `POST /v1/wallet/payment-session` - Create Stripe session
- `GET /v1/wallet/balance` - Get current balance
- `POST /v1/auth/login/api-key` - Seller authentication (Clearcite as seller)
- `POST /v1/seller/content` - Register research reports as purchasable content

**Content Registration Flow (Clearcite as Seller):**
Clearcite acts as the seller, registering AI-generated research reports with LedeWire before users (buyers) can purchase them.

1. User generates a research report
2. Backend authenticates as seller using `LEDEWIRE_SELLER_API_KEY` and `LEDEWIRE_SELLER_API_SECRET`
3. Seller JWT is cached for 1 hour with auto-refresh
4. Research report is registered via `POST /v1/seller/content` with:
   - `content_type`: "markdown"
   - `visibility`: "private" (reports) or "public" (individual sources - future)
   - `content_body`: Base64-encoded stub/reference (not full content)
   - `price_cents`: Calculated price
5. Returned `content_id` is cached locally (24 hours) to avoid duplicate registrations
6. Cache key includes query + source_ids + price_cents for correct pricing
7. Purchase is completed via `POST /v1/purchases` with the registered `content_id`

**Content ID Caching:**
- Table: `content_id_cache` in ledger database
- Cache key: SHA256(query + sorted_source_ids + price_cents)
- Expiry: 24 hours
- Ensures same report with same price reuses existing content_id

**Implementation Files:**
- Backend: `backend/integrations/ledewire.py`, `backend/app/api/routes/purchase.py`, `backend/app/api/routes/wallet.py`
- Content ID Cache: `backend/data/ledger_repository.py`
- Frontend: `backend/static/js/services/api.js`, `backend/static/js/app/modal-controller.js`

# External Dependencies

- **FastAPI**: Python web framework.
- **Pydantic**: Data validation and serialization.
- **SQLite3**: Local database.
- **UUID**: Unique identifiers.
- **CORS Middleware**: Cross-origin requests.
- **Uvicorn**: ASGI server.
- **Tavily API**: Web search and URL discovery.
- **Anthropic Claude API**: AI-powered content and report generation.
- **LedeWire Wallet API**: User authentication, wallet management, purchases.
- **Tollbit API**: Content licensing and dynamic source pricing.
- **pypdf**: PDF text extraction.