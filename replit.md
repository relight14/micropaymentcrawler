# Overview

This project is an AI-powered research tool MVP that provides dynamic research services with per-source pricing. It allows users to submit complex research queries and receive personalized research packages, with costs varying based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The core vision is to offer "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It offers a responsive, modern interface featuring tier selection cards and dynamic content loading. UI elements include story cards with quotes and descriptions for source articles, professional presentation of search results, and transparent licensing badges (RSL 🔒, Tollbit ⚡, Cloudflare ☁️).

## Technical Implementations
- **Frontend**: Features a consolidated architecture with `js/app.js` as the main controller, dedicated services for API communication (`js/services/api.js`), authentication (`js/services/auth.js`), centralized state management (`js/state/app-state.js`), and a `MessageRenderer` class for consistent UI message rendering. All source card generation logic and styling are unified within `js/components/source-card.js` and `styles/components/source-card.css`.
- **Backend**: Developed with FastAPI, employing a unified service architecture under the `services/` directory for AI processing, content licensing, and research operations. `schemas/domain.py` serves as the single source of truth for data models. Source cards include rich metadata (author, published_date, relevance_score) for enhanced analysis. All external API calls use async httpx with proper timeouts (5-30s) and exponential backoff retry logic (3 attempts, 1-10s delays) for resilience against transient failures. Implements domain credibility penalty system (-0.35 score) to downrank low-credibility sources (Wikipedia, Reddit, Facebook, Twitter, LinkedIn posts, Quora, Medium) while prioritizing authoritative research content. Defensive URL validation ensures full path information is preserved for accurate penalty application.
- **Content Generation**: Employs a hybrid pipeline using Tavily for URL discovery and Anthropic Claude for content refinement and report generation, incorporating licensing detection and graceful API fallbacks. Excerpts are expanded to 1,500-2,000 characters to provide substantial content for deep AI analysis.
- **Claude Relevance Filtering**: Implements universal AI-powered post-processing of all Tavily search results using Claude Haiku for cost-efficient relevance validation (~$0.01/search). The `AIResearchService.filter_search_results_by_relevance()` method evaluates each search result against user query intent, filtering out tangentially related content (e.g., international treaties when query asks for US domestic policy). Filtering runs between Tavily API calls and source card creation, with strict "when in doubt, filter it out" guidance. Handles both publication-specific queries (with enhanced publication-matching logic) and general queries. Includes comprehensive logging of filtered sources with reasons for debugging visibility. Features graceful fallback to unfiltered results on API errors to preserve baseline functionality.
- **Premium Report Quality**: Both Research and Pro tier paid reports use Claude Sonnet 4 (configurable via `REPORT_MODEL` env var) for superior analytical quality. The `report_generator.py` service is the single source of truth for all research report generation, using AI prompts that instruct Claude to include numbered citations [1], [2], [3] throughout reports. Reports emphasize evidence-based themes, cross-source synthesis, and specific numbered citations. Comprehensive token usage and cost logging enables production monitoring.
- **Authentication**: Implements secure JWT token management, LedeWire integration, and robust 401 handling for authentication flows.
- **Research Brief Extraction System**: Uses regex-based pattern matching (no LLM calls) to extract structured research briefs from conversation context, including: topic identification, entity extraction (organizations, locations, people), temporal frame detection (T0=24h, T1=3d, T7=7d, TH=historical), subtask decomposition, and output bias detection. Defaults to T7 for academic queries, T1 for others.
- **Dual Classification Pipeline (Intent × Temporal)**: Classifies queries into intent types (news_event, policy_analysis, academic_causal, market_analysis, historical_explainer, technical_review) each with tailored recency weights (news_event: 50% recency, academic_causal: 10% recency). Rail allocation ensures proper source distribution across query types.
- **Recency-Weighted Reranking**: Implements composite scoring algorithm (recency + topicality + authority, weights normalized to 1.0) that prioritizes fresh content for breaking news while maintaining authority signals for academic research. Domain authority weights favor credible sources (Reuters 0.6, NYT 0.45). Temporal decay curves adjust recency scoring based on detected time buckets.
- **Source Type Classification & Blending**: Implements intelligent source type classification (🎓 Academic, 📰 Journalism, 💼 Business, 🏛️ Government) based on domain patterns. Uses weighted source sampling to blend results by detected research intent: academic queries get 60% academic + 40% journalism sources, business queries get 50% journalism + 30% business + 20% academic, news queries get 70% journalism + 30% analysis. Frontend-only filter chips with live counts enable instant source type filtering without refetching, with session persistence for user preferences.
- **Hybrid Publication Search**: Enables users to search within ANY publication using a two-tier approach:
  - **Tier 1 (Domain Filtering)**: For 12 major publications (NY Times, WSJ, Bloomberg, Reuters, Guardian, BBC, CNN, Forbes, Time, Atlantic, Economist, Washington Post), the system uses exact domain filtering via Tavily's `include_domains` parameter for guaranteed precision.
  - **Tier 2 (Keyword Boosting)**: For any other publication (TechCrunch, The Verge, Wired, etc.), extracts the publication name from queries like "[Publication] on [Topic]" and boosts it as a keyword in the search (e.g., '"TechCrunch" AI advancements'), providing flexible publication-specific results without false positives from domain guessing.
  - Both tiers preserve conversation context synthesis and use deterministic cache isolation to prevent cross-tier result leakage.
- **Dual-Mode AI Experience**: Supports both conversational AI and deep research modes, including access to licensed sources and dynamic pricing.
- **Tiered Research Reports**: The `report_generator.py` service generates AI-powered research reports (executive summaries to comprehensive analyst reports) using Claude with numbered citation format [1], [2], [3]. Includes intelligent in-memory caching (10-minute TTL, 100-entry limit) with query normalization for improved hit rates, cache statistics logging (hit/miss tracking), and citation metadata extraction for inline purchase badges.
- **User-Selected Source Reports**: The `/generate-report` endpoint supports optional `selected_source_ids` parameter, allowing users to build reports from their chosen sources in the Report Builder. The system filters sources by ID, generates reports with proper citations from selected materials, and maintains unique cache keys per source selection to prevent report collision. Backward compatible with legacy mode when no sources are selected.
- **Inline Citation Badges**: AI-generated reports feature contextual purchase badges next to locked source citations. Claude generates reports with numbered citations [1], [2], [3] where each number corresponds to a specific source. The system automatically injects protocol-specific badges (🔒 RSL, ⚡ Tollbit, ☁️ Cloudflare) showing unlock pricing next to each citation. Clicking a badge opens the unlock modal pre-filled with that specific source. The `report_generator.py` service extracts citation metadata during generation using regex pattern matching, mapping citation numbers to source IDs, lock status, protocols, and prices. Frontend `MessageRenderer` injects badges inline without disrupting layout. Badges remain muted (opacity 0.7) until hover, maintaining professional report aesthetics while enabling contextual upsell at the point of maximum engagement.
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