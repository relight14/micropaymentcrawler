# Overview

This project is an AI-powered research tool MVP designed to deliver dynamic research services with per-source pricing. It enables users to submit complex queries and receive personalized research packages, with costs adjusted based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The core mission is to provide "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a responsive, modern Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It features tier selection cards, dynamic content loading, story cards with quotes and descriptions for source articles, and professional presentation of search results with transparent licensing badges (RSL 🔒, Tollbit ⚡, Cloudflare ☁️). UI includes intelligent scroll behavior: AI responses scroll to the message top, while user messages scroll to the bottom.

## Technical Implementations
- **Frontend**: Consolidated architecture with `js/app.js` as the main controller, dedicated services for API communication, authentication, centralized state management, and consistent UI message rendering. Source card generation logic and styling are unified.
- **Backend**: Developed with FastAPI, employing a unified service architecture for AI processing, content licensing, and research operations. `schemas/domain.py` is the single source of truth for data models. Includes a domain credibility penalty system to downrank low-credibility sources and prioritizes authoritative content, with defensive URL validation. External API calls use async httpx with timeouts and exponential backoff retry logic.
- **Content Generation**: Employs a hybrid pipeline using Tavily for URL discovery and Anthropic Claude for content refinement and report generation, incorporating licensing detection and graceful API fallbacks. Excerpts are expanded to 1,500-2,000 characters for deep AI analysis.
- **AI-Powered Query Optimization**: Uses Claude Haiku to optimize search queries based on full conversation context before sending to Tavily API. This method analyzes conversation history and user queries to build precision-targeted search strings by prioritizing specific entities, applying geographic and temporal precision, completing truncated thoughts, and signaling analysis depth.
- **Claude Relevance Filtering**: Implements universal AI-powered post-processing of all Tavily search results using Claude Haiku for cost-efficient relevance validation. This method evaluates each search result against user query intent, filtering out tangentially related content. Includes graceful fallback to unfiltered results on API errors.
- **Premium Report Quality**: Research and Pro tier paid reports utilize Claude Sonnet 4 for superior analytical quality. The `report_generator.py` service generates all research reports, using AI prompts that instruct Claude to include numbered citations [1], [2], [3] and emphasize evidence-based themes and cross-source synthesis.
- **Authentication**: Secure JWT token management, LedeWire integration, and robust 401 handling.
- **Research Brief Extraction System**: Uses regex-based pattern matching to extract structured research briefs from conversation context, including topic, entity, temporal frame, subtask decomposition, and output bias detection.
- **Dual Classification Pipeline (Intent × Temporal)**: Classifies queries into intent types (e.g., news_event, policy_analysis) with tailored recency weights, ensuring proper source distribution.
- **Recency-Weighted Reranking**: Implements a composite scoring algorithm (recency + topicality + authority) that prioritizes fresh content for breaking news while maintaining authority for academic research, using temporal decay curves.
- **Source Type Classification & Blending**: Classifies sources by type (Academic, Journalism, Business, Government) and uses weighted sampling to blend results based on research intent. Frontend filter chips enable instant source type filtering.
- **Hybrid Publication Search**: Allows users to search within specific publications using a two-tier approach: exact domain filtering for major publications and keyword boosting for others, while preserving conversation context and using deterministic cache isolation.
- **Dual-Mode AI Experience**: Supports both conversational AI and deep research modes, including access to licensed sources and dynamic pricing.
- **Tiered Research Reports**: The `report_generator.py` service generates AI-powered research reports with numbered citations. Features intelligent in-memory caching for improved hit rates and citation metadata extraction for inline purchase badges.
- **User-Selected Source Reports**: The `/generate-report` endpoint supports generating reports from user-selected sources, ensuring proper citations and unique cache keys per selection.
- **Inline Citation Badges**: AI-generated reports feature contextual purchase badges next to locked source citations, showing unlock pricing and linking to the unlock modal.
- **Token Expiry Handling**: Automatic JWT token validation and a centralized logout callback system for consistent UI updates.
- **Tab State Persistence After Login**: Preserves user intent by saving desired actions (e.g., mode switch) before authentication and executing them post-login.
- **Chat-to-Research Transition**: Intelligent mode switching suggests transitioning to research mode for research-worthy conversations, leveraging intent classification and providing topic hints for query prefilling.

## Feature Specifications
- **Dynamic Research Services**: Provides query-based research packages with variable pricing ($0.10-$10.00), determined by source count, quality, and licensing complexity.
- **Dynamic Pricing**: Source unlocking costs are calculated based on AI relevance, quality factors, and licensing protocols, with a budget allocation strategy.
- **Content Licensing**: Utilizes a multi-protocol abstraction layer supporting RSL, Tollbit, and Cloudflare, with server-authoritative pricing and real license token issuance. Includes a dual-pricing model for Tollbit.
- **Mock Mode**: A robust mock mode (`LEDEWIRE_USE_MOCK=true`) for development, bypassing external API calls.
- **Wallet Integration**: Securely integrates with LedeWire for real-time wallet balance checks, purchase processing, and content access, including idempotency keys.

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