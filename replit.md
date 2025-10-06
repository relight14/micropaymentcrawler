# Overview

This project is an AI-powered research tool MVP that provides dynamic research services with per-source pricing. It allows users to submit complex research queries and receive personalized research packages, with costs varying based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The core vision is to offer "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It offers a responsive, modern interface featuring tier selection cards and dynamic content loading. UI elements include story cards with quotes and descriptions for source articles, professional presentation of search results, and transparent licensing badges (RSL 🔒, Tollbit ⚡, Cloudflare ☁️).

## Technical Implementations
- **Frontend**: Features a consolidated architecture with `js/app.js` as the main controller, dedicated services for API communication (`js/services/api.js`), authentication (`js/services/auth.js`), centralized state management (`js/state/app-state.js`), and a `MessageRenderer` class for consistent UI message rendering. All source card generation logic and styling are unified within `js/components/source-card.js` and `styles/components/source-card.css`.
- **Backend**: Developed with FastAPI, employing a unified service architecture under the `services/` directory for AI processing, content licensing, and research operations. `schemas/domain.py` serves as the single source of truth for data models.
- **Content Generation**: Employs a hybrid pipeline using Tavily for URL discovery and Anthropic Claude for content refinement and report generation, incorporating licensing detection and graceful API fallbacks.
- **Authentication**: Implements secure JWT token management, LedeWire integration, and robust 401 handling for authentication flows.
- **AI Query Refinement**: Integrates Claude AI to synthesize conversation history into targeted research queries, enhancing search relevance.
- **Hybrid Publication Search**: Enables users to search within ANY publication using a two-tier approach:
  - **Tier 1 (Domain Filtering)**: For 12 major publications (NY Times, WSJ, Bloomberg, Reuters, Guardian, BBC, CNN, Forbes, Time, Atlantic, Economist, Washington Post), the system uses exact domain filtering via Tavily's `include_domains` parameter for guaranteed precision.
  - **Tier 2 (Keyword Boosting)**: For any other publication (TechCrunch, The Verge, Wired, etc.), extracts the publication name from queries like "[Publication] on [Topic]" and boosts it as a keyword in the search (e.g., '"TechCrunch" AI advancements'), providing flexible publication-specific results without false positives from domain guessing.
  - Both tiers preserve conversation context synthesis and use deterministic cache isolation to prevent cross-tier result leakage.
- **Dual-Mode AI Experience**: Supports both conversational AI and deep research modes, including access to licensed sources and dynamic pricing.
- **Tiered Research Reports**: Generates AI-powered research reports (executive summaries to comprehensive analyst reports) using Claude, with in-memory caching to optimize API costs.
- **User-Selected Source Reports**: The `/generate-report` endpoint supports optional `selected_source_ids` parameter, allowing users to build reports from their chosen sources in the Report Builder. The system filters sources by ID, generates reports with proper citations from selected materials, and maintains unique cache keys per source selection to prevent report collision. Backward compatible with legacy mode when no sources are selected.
- **Token Expiry Handling**: Implements automatic JWT token validation and a centralized logout callback system for consistent UI updates and user experience upon session expiry.

## Feature Specifications
- **Dynamic Research Services**: Provides query-based research packages with variable pricing ($0.10-$10.00), determined by source count, quality, and licensing complexity, ensuring users pay only for what they need.
- **Dynamic Pricing**: Source unlocking costs are calculated based on AI relevance, quality factors (e.g., peer-reviewed, recency, citations), and licensing protocols, with a budget allocation strategy for licensing and corporate margin.
- **Content Licensing**: Utilizes a multi-protocol abstraction layer supporting RSL, Tollbit, and Cloudflare, with server-authoritative pricing and real license token issuance. It also implements a dual-pricing model for Tollbit, differentiating between full-use and partial-use licenses.
- **Mock Mode**: A robust mock mode (`LEDEWIRE_USE_MOCK=true`) is available for development, bypassing external API calls.
- **Wallet Integration**: Securely integrates with LedeWire for real-time wallet balance checks, purchase processing, and content access, including idempotency keys for fraud protection.

## System Design Choices
- **Data Storage**: Uses SQLite for lightweight persistence, tracking purchases, source unlocks, and audit trails, storing complex data structures as JSON.
- **Simulation Layer**: A `ContentCrawlerStub` simulates content crawling and pricing algorithms for testing.
- **API-First Architecture**: All pricing decisions are backend-centric, making the frontend a pure presentation layer.
- **Production Readiness**: Architect-approved implementations ensure robust error handling, security, and scalability.

# External Dependencies

- **FastAPI**: Python web framework for the backend API.
- **Pydantic**: For data validation and serialization.
- **SQLite3**: For local database persistence.
- **UUID**: For generating unique identifiers.
- **CORS Middleware**: For handling cross-origin requests.
- **Uvicorn**: ASGI server for running FastAPI.
- **Tavily API**: For discovering real, clickable URLs from live web search.
- **Anthropic Claude API**: For AI-powered content polishing, conversational AI, and report generation.
- **LedeWire Wallet API**: Integrated for user authentication, wallet balance management, and purchase processing.
- **Tollbit API**: For content licensing and dynamic pricing of sources.