# Overview

This project is an AI-powered research tool MVP offering dynamic research services with per-source pricing. It enables users to submit complex queries and receive personalized research packages, with costs adjusted based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. Its core mission is to provide "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a responsive, modern Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It features tier selection cards, dynamic content loading, story cards with quotes and descriptions for source articles, and professional presentation of search results with transparent licensing badges. UI includes intelligent scroll behavior: AI responses scroll to the message top, while user messages scroll to the bottom. Dark mode has improved contrast.

## Technical Implementations
- **Frontend**: Modular layered architecture with an Application Controller, Infrastructure Managers (Toast, Modal, EventRouter), Domain Managers (Source, Tier, Message, Interaction), Core Services, and UI Components.
- **Analytics & Instrumentation**: Production-grade Google Analytics 4 integration with a centralized tracking utility (`analytics.js`), lazy gtag loading, and comprehensive event coverage across all user interactions with rich metadata.
- **Backend**: Developed with FastAPI, employing a unified service architecture for AI processing, content licensing, and research operations. `schemas/domain.py` is the single source of truth for data models. Includes a domain credibility penalty system and defensive URL validation. External API calls use async httpx with timeouts and exponential backoff. Comprehensive structured logging is implemented.
- **Content Generation**: Employs a hybrid pipeline using Tavily for URL discovery and Anthropic Claude for content refinement and report generation, incorporating licensing detection and graceful API fallbacks.
- **AI-Powered Query Optimization**: Uses Claude Haiku to optimize search queries based on full conversation context, with strict no-injection constraints and post-generation entity validation. Features topic persistence system that anchors follow-up queries to the initial research topic, preventing AI hallucination during generic refinements like "anything from time magazine". Uses Claude-based topic change detection with fail-safe fallback and post-optimization guards.
- **Claude Relevance Filtering**: Implements universal AI-powered post-processing of all Tavily search results using Claude Haiku for cost-efficient relevance validation.
- **Premium Report Quality**: Research and Pro tier paid reports utilize Claude Sonnet 4 for superior analytical quality, generating reports with numbered citations.
- **Authentication**: Secure JWT token management, LedeWire integration, and robust 401 handling, including tab state persistence after login. Features are authentication-gated.
- **Research Brief Extraction System**: Uses regex-based pattern matching to extract structured research briefs from conversation context.
- **Dual Classification Pipeline (Intent × Temporal)**: Classifies queries into intent types with tailored recency weights.
- **Recency-Weighted Reranking**: Implements a composite scoring algorithm (recency + topicality + authority) that prioritizes fresh content.
- **Premium Source Authority System**: Features a tiered domain authority hierarchy with premium sources receiving ranking boosts.
- **Source Type Classification & Blending**: Classifies sources by type and uses weighted sampling to blend results based on research intent, with frontend filter chips.
- **Hybrid Publication Search**: Allows users to search within specific publications using a two-tier approach.
- **Dual-Mode AI Experience**: Supports both conversational AI and deep research modes, including access to licensed sources and dynamic pricing.
- **Tiered Research Reports**: The `report_generator.py` service generates AI-powered research reports with numbered citations, intelligent in-memory caching, and progressive loading messages.
- **User-Selected Source Reports**: The `/generate-report` endpoint supports generating reports from user-selected sources.
- **Shared Crawler Singleton**: Both research and purchase routes use a shared crawler instance to ensure cache visibility across requests.
- **Inline Citation Badges**: AI-generated reports feature contextual purchase badges next to locked source citations.
- **Chat-to-Research Transition**: Intelligent mode switching suggests transitioning to research mode for research-worthy conversations after at least 3 user messages.
- **Feedback System**: User feedback collection for research result quality using thumbs up/down UI, with SQLite persistence and support for authenticated and anonymous feedback.
- **Report Download**: Research reports include a download button that exports the full markdown content as a .md file with auto-generated filenames.
- **Input Field**: Features an auto-expanding multi-line textarea with an inline send button.
- **Conversation Management**: Implements conversation-scoped source selection to prevent cross-topic pollution and a "Start a New Search" button for clearer conversation resets. Report Builder queries automatically switch to Chat mode for context.
- **Smart Summary Button**: Dynamic button text changes from "Summarize for $X" to "Review Summary" after purchase, with persistent cache checks to avoid duplicate purchases.

## Feature Specifications
- **Dynamic Research Services**: Provides query-based research packages with variable pricing ($0.10-$10.00), determined by source count, quality, and licensing complexity.
- **Dynamic Pricing**: Source unlocking costs are calculated based on AI relevance, quality factors, and licensing protocols, with a budget allocation strategy.
- **Content Licensing**: Utilizes a multi-protocol abstraction layer supporting RSL, Tollbit, and Cloudflare, with server-authoritative pricing and real license token issuance.
- **Mock Mode**: A robust mock mode (`LEDEWIRE_USE_MOCK=true`) for development.
- **Wallet Integration**: Securely integrates with LedeWire for real-time wallet balance checks, purchase processing, and content access.

## System Design Choices
- **Data Storage**: Uses PostgreSQL for production and SQLite for development, tracking purchases, source unlocks, audit trails, and API usage/budgets.
- **Simulation Layer**: A `ContentCrawlerStub` simulates content crawling and pricing algorithms for testing.
- **API-First Architecture**: All pricing decisions are backend-centric.
- **Production Readiness**: Comprehensive production-grade infrastructure including security (CORS, configuration validation), cost controls (per-user daily budgets, global spending caps, API cost tracking), reliability (global error handling, structured logging), scalability (PostgreSQL, rate limiting), and operations (environment validation, deployment checklist). Frontend is the source of truth for source selection to prevent cache invalidation issues.

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