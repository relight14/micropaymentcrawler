# Overview

This project is an AI-powered research tool MVP offering dynamic research services with per-source pricing. Users can submit complex research queries and receive personalized research packages with variable pricing based on query complexity, source quality, and licensing costs. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The business vision is to provide a competitive differentiator with "real data, not made up," ensuring authentic source validation and professional presentation with ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

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