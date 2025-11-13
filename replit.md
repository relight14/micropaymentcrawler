# Overview

This project is an AI-powered research tool MVP offering dynamic research services with per-source pricing. It enables users to submit complex queries and receive personalized research packages, with costs adjusted based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. Its core mission is to provide "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a responsive, modern Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It features tier selection cards, dynamic content loading, story cards with quotes and descriptions, and professional presentation of search results with transparent licensing badges. The UI uses a three-column flexbox layout with responsive adjustments for desktop, laptop, tablet, and mobile, including a mobile-specific tab navigation bar.

## Technical Implementations
The frontend uses a modular layered architecture with an Application Controller, Infrastructure Managers, Controllers, Domain Managers, Core Services, and UI Components. It supports anonymous users with seamless conversation history persistence upon login via a localStorage bridge pattern. A single message rendering pipeline ensures consistent formatting. Project management includes loading and displaying saved messages, and report status management uses a five-state machine (idle → pricing → generating → complete → error). State synchronization is maintained between `AppState` and `ProjectStore` via event listeners. Research queries persist with projects, and a robust analytics integration uses Google Analytics 4.

**Critical Authentication Event Flow:** AuthService dispatches `authStateChanged` events via AppEvents after successful login/signup (with `isAuthenticated: true`) and before logout (with `isAuthenticated: false`). ProjectManager listens to this event to trigger `handleLogin()`, which preserves pre-login conversation history, creates a project, loads projects via `loadProjectsWithGuard()`, and auto-loads the new project. This event-driven architecture ensures sidebars populate automatically and source search fires after login without page reload or UI clearing.

The backend is developed with FastAPI, employing a unified service architecture for AI processing, content licensing, and research operations. It uses a hybrid content generation pipeline with Tavily for URL discovery and Anthropic Claude for content refinement and report generation, including licensing detection and fallbacks. AI-powered query optimization uses Claude Haiku to refine searches based on conversation context, with strict validation and topic persistence. Claude also provides relevance filtering for search results. Premium reports utilize Claude Sonnet 4 for higher analytical quality.

Authentication features secure JWT token management, LedeWire integration, and robust error handling. The system includes a research brief extraction system, a dual classification pipeline for query intent and temporal recency, and a recency-weighted reranking algorithm. A premium source authority system prioritizes paid sources. Source type classification and blending, hybrid publication search, and a dual-mode AI experience (conversational and deep research) are implemented. AI-powered research reports are generated with numbered citations, caching, and progressive loading. The system supports user-selected source reports and includes a shared crawler singleton. Inline citation badges indicate locked sources in reports. Intelligent mode switching suggests transitioning to research mode, and a feedback system collects user input. Reports can be downloaded as Markdown files. The input field is an auto-expanding textarea, and conversation management prevents cross-topic pollution. A smart summary button indicates purchase status. File upload functionality allows users to upload .doc/.docx/.md files for AI processing, integrating them into the outline and report generation.

## Feature Specifications
The project provides dynamic research services with **simplified Pro Package-only pricing** at **$0.05 per source**. The Research Package tier has been removed to streamline the user experience. Dynamic pricing is calculated client-side using `sources × $0.05` and verified by backend API quotes. The Report Builder displays both the calculated price in the card header and the dynamic price in the button text (e.g., "Generate Pro Report — $0.40" for 8 sources). Content licensing utilizes a multi-protocol abstraction layer (RSL, Tollbit, Cloudflare) with server-authoritative pricing. A robust mock mode is available for development. Secure integration with LedeWire handles wallet balance checks, purchase processing, and content access.

**Recent Changes (2025-11-13):**
- Simplified pricing to single Pro Package tier at $0.05 per source
- Removed Research Package tier from tier catalog and UI
- Implemented dynamic pricing calculation: `calculateProPrice(sourceCount)`
- Updated Report Builder to show price in both card header and button text
- Removed tier comparison accordion (no longer needed with single tier)
- Updated budget helpers for backwards compatibility with high sentinel values (999.99)

## System Design Choices
Data storage uses PostgreSQL for production and SQLite for development. A `ContentCrawlerStub` simulates crawling and pricing for testing. The architecture is API-first, with all pricing decisions handled by the backend. Production readiness includes comprehensive security (CORS, configuration validation), cost controls (per-user budgets, global caps), reliability (error handling, logging), scalability (PostgreSQL, rate limiting), and operational considerations. The frontend is the source of truth for source selection.

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