# Overview

This project is an AI-powered research tool MVP designed to deliver dynamic research services with per-source pricing. It enables users to submit complex queries and receive personalized research packages, with costs adjusted based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The core mission is to provide "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a responsive, modern Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It features tier selection cards, dynamic content loading, story cards with quotes and descriptions for source articles, and professional presentation of search results with transparent licensing badges (RSL 🔒, Tollbit ⚡, Cloudflare ☁️, Web 🌐 for sources without specific licensing). UI includes intelligent scroll behavior: AI responses scroll to the message top, while user messages scroll to the bottom.

## Technical Implementations
- **Frontend**: Modular layered architecture with separation of concerns:
  - **Application Controller** (`js/app.js`) - Lightweight orchestrator (reduced from 2,018 → 622 lines, **69% reduction**) coordinating all components via dependency injection
  - **Infrastructure Managers** - Dedicated managers for cross-cutting concerns:
    - `ToastManager` - Centralized toast notification lifecycle
    - `ModalController` - Auth & funding modal orchestration with callback-based integration
    - `EventRouter` - Single point of event listener registration and delegation
  - **Domain Managers** - Business logic components with AppEvents bus integration:
    - `SourceManager` (355 lines) - Source card rendering, selection, unlocking, and filtering
    - `TierManager` (150 lines) - Tier analysis, display, and report generation coordination
    - `MessageCoordinator` (216 lines) - Loading states, feedback collection, and polling logic
    - `InteractionHandler` (72 lines) - UI event handlers for citations, suggestions, and user actions
  - **Core Services** - API communication, authentication, state management
  - **UI Components** - Message rendering, source cards, UI updates
  - All components follow single-responsibility principle with clean interfaces and event-driven coordination
- **Backend**: Developed with FastAPI, employing a unified service architecture for AI processing, content licensing, and research operations. `schemas/domain.py` is the single source of truth for data models. Includes a domain credibility penalty system to downrank low-credibility sources and prioritizes authoritative content, with defensive URL validation. External API calls use async httpx with timeouts and exponential backoff retry logic.
- **Content Generation**: Employs a hybrid pipeline using Tavily for URL discovery and Anthropic Claude for content refinement and report generation, incorporating licensing detection and graceful API fallbacks. Excerpts are expanded to 1,500-2,000 characters for deep AI analysis.
- **AI-Powered Query Optimization**: Uses Claude Haiku to optimize search queries based on full conversation context before sending to Tavily API. Features strict no-injection constraints that prevent Claude from adding entities, geographies, or dates not explicitly present in the user query or conversation context. Includes post-generation entity validation guard that detects and rejects unauthorized proper noun additions, reverting to raw query on injection attempts. Uses temperature=0.1 for stability without deterministic brittleness. Pipeline debug logging traces raw → enhanced → final query transformations.
- **Claude Relevance Filtering**: Implements universal AI-powered post-processing of all Tavily search results using Claude Haiku for cost-efficient relevance validation. This method evaluates each search result against user query intent, filtering out tangentially related content. Includes graceful fallback to unfiltered results on API errors.
- **Premium Report Quality**: Research and Pro tier paid reports utilize Claude Sonnet 4 for superior analytical quality. The `report_generator.py` service generates all research reports, using AI prompts that instruct Claude to include numbered citations [1], [2], [3] and emphasize evidence-based themes and cross-source synthesis.
- **Authentication**: Secure JWT token management, LedeWire integration, and robust 401 handling.
- **Research Brief Extraction System**: Uses regex-based pattern matching to extract structured research briefs from conversation context, including topic, entity, temporal frame, subtask decomposition, and output bias detection.
- **Dual Classification Pipeline (Intent × Temporal)**: Classifies queries into intent types (e.g., news_event, policy_analysis) with tailored recency weights, ensuring proper source distribution.
- **Recency-Weighted Reranking**: Implements a composite scoring algorithm (recency + topicality + authority) that prioritizes fresh content for breaking news while maintaining authority for academic research, using temporal decay curves.
- **Premium Source Authority System**: Features a tiered domain authority hierarchy with premium sources (0.7 authority score) including Economist, Time, NYT, WSJ, FT, The Atlantic, Foreign Affairs/Policy, HBR, and top academic sources (arXiv, Nature, Science, JSTOR). Premium sources receive ranking boost while still requiring relevance for high placement, ensuring quality without sacrificing search flexibility.
- **Source Type Classification & Blending**: Classifies sources by type (Academic, Journalism, Business, Government) and uses weighted sampling to blend results based on research intent. Frontend filter chips enable instant source type filtering.
- **Hybrid Publication Search**: Allows users to search within specific publications using a two-tier approach: exact domain filtering for major publications and keyword boosting for others, while preserving conversation context and using deterministic cache isolation.
- **Dual-Mode AI Experience**: Supports both conversational AI and deep research modes, including access to licensed sources and dynamic pricing.
- **Tiered Research Reports**: The `report_generator.py` service generates AI-powered research reports with numbered citations. Features intelligent in-memory caching for improved hit rates and citation metadata extraction for inline purchase badges. Progressive loading messages ("Compiling sources" → "Analyzing content" → "Building your report") provide UX feedback during 15-second report generation.
- **User-Selected Source Reports**: The `/generate-report` endpoint supports generating reports from user-selected sources, ensuring proper citations and unique cache keys per selection.
- **Shared Crawler Singleton**: Both research and purchase routes use a shared crawler instance (via `backend/shared_services.py`) to ensure cache visibility across requests. When users select sources in the analyze flow, those selections are retrieved from the shared cache when purchasing a tier, enabling true user-curated research reports.
- **Inline Citation Badges**: AI-generated reports feature contextual purchase badges next to locked source citations, showing unlock pricing and linking to the unlock modal.
- **Token Expiry Handling**: Automatic JWT token validation and a centralized logout callback system for consistent UI updates.
- **Tab State Persistence After Login**: Preserves user intent by saving desired actions (e.g., mode switch) before authentication and executing them post-login.
- **Chat-to-Research Transition**: Intelligent mode switching suggests transitioning to research mode for research-worthy conversations after at least 3 user messages (third exchange), leveraging intent classification and providing topic hints for query prefilling.
- **Feedback System**: User feedback collection for research result quality using thumbs up/down UI after source cards. Features event delegation for dynamically created buttons, duplicate submission prevention, SQLite persistence with JSON source tracking, and confirmation toasts. Supports both authenticated (user ID) and anonymous feedback. Database migration ensures backward compatibility with existing deployments.
- **Report Download**: Research reports include a download button that exports the full markdown content as a .md file. Filenames are auto-generated from the query and date (e.g., "nuclear-power-expansion-2024-10-14.md") with sanitization for safe filesystem usage. Uses browser's Blob API for client-side download without server round-trip.

## Feature Specifications
- **Dynamic Research Services**: Provides query-based research packages with variable pricing ($0.10-$10.00), determined by source count, quality, and licensing complexity.
- **Dynamic Pricing**: Source unlocking costs are calculated based on AI relevance, quality factors, and licensing protocols, with a budget allocation strategy.
- **Content Licensing**: Utilizes a multi-protocol abstraction layer supporting RSL, Tollbit, and Cloudflare, with server-authoritative pricing and real license token issuance. Includes a dual-pricing model for Tollbit.
- **Mock Mode**: A robust mock mode (`LEDEWIRE_USE_MOCK=true`) for development, bypassing external API calls.
- **Wallet Integration**: Securely integrates with LedeWire for real-time wallet balance checks, purchase processing, and content access, including idempotency keys.

## System Design Choices
- **Data Storage**: Uses PostgreSQL for production (multi-user concurrent access) and SQLite for development, tracking purchases, source unlocks, audit trails, and API usage/budgets.
- **Simulation Layer**: A `ContentCrawlerStub` simulates content crawling and pricing algorithms for testing.
- **API-First Architecture**: All pricing decisions are backend-centric, making the frontend a pure presentation layer.
- **Production Readiness**: Comprehensive production-grade infrastructure including:
  - **Security**: CORS locked down via ALLOWED_ORIGINS, configuration validation blocks unsafe deployments
  - **Cost Controls**: Per-user daily budgets ($10/100 API calls), global spending caps ($1000/day), API cost tracking for Tavily/Claude/Tollbit
  - **Reliability**: Global error handling middleware, structured JSON logging, graceful API failure handling
  - **Scalability**: PostgreSQL with proper indexes, distributed rate limiting, concurrent-safe operations
  - **Operations**: Environment validation at startup, .env.example with deployment checklist, configuration summary logging

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