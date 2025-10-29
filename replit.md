# Overview

This project is an AI-powered research tool MVP designed to deliver dynamic research services with per-source pricing. It enables users to submit complex queries and receive personalized research packages, with costs adjusted based on query complexity, source quality, and licensing. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The core mission is to provide "real data, not made up," ensuring authentic source validation, professional presentation, and ethical micropayment compensation to publishers.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

## October 29, 2025

### UX Clarity Improvements
- ✅ **Clear Conversation Button Renamed**: Changed "Clear All" to "Start a New Search" to make purpose clearer and encourage users to reset between different research topics
- ✅ **Conversation-Scoped Source Selection**: Implemented automatic source scoping to prevent contamination across research topics
  - Each conversation gets unique ID; sources tagged with conversation ID
  - Stale sources from previous conversations auto-cleaned on initialization
  - User can refine queries and accumulate sources within same conversation
  - "Start a New Search" generates fresh conversation ID, preventing cross-topic pollution

### Smart Summary Button State (New Feature)
- ✅ **Dynamic Button Text**: Summary buttons change from "Summarize for $X" to "Review Summary" after purchase
- ✅ **Persistent Cache Check**: Buttons check cached summaries on render to show correct state immediately
- ✅ **Instant UI Update**: Button text updates without page refresh after successful summary purchase
- ✅ **No Duplicate Purchases**: Clicking "Review Summary" shows cached content, avoiding re-purchase

### Conversation Context Fix for Follow-Up Queries
- ✅ **Field Mismatch Fix**: Backend now correctly reads 'sender' field from frontend conversation context (was looking for 'role')
- ✅ **Enhanced Query Optimization**: AI prompt now explicitly incorporates conversation topics into follow-up queries (e.g., "more sources from WSJ" after discussing "federal reserve policy" becomes "federal reserve policy WSJ NYT")
- ✅ **Secure Case-Insensitive Validation**: Entity injection validator extracts all words from raw query/context (case-insensitive), allows context-based entities, blocks truly new entities without security bypass

### Dark Mode Contrast Improvements
- ✅ **Feedback Modal Text**: Increased contrast with darker text color (#1a1a1a), added contrast filter (1.2x), and increased font weight (600)
- ✅ **CSS Variables**: Added --surface-primary and --surface-secondary with proper dark mode values (#334155 and #475569)
- ✅ **Button Styling**: Updated feedback buttons to use CSS variables for better dark mode compatibility

## October 28, 2025

### Input Field UX Refinement
- ✅ **Multi-line Textarea**: Replaced single-line input with auto-expanding textarea supporting up to 200px height
- ✅ **Cleaner Layout**: Removed redundant paperclip 📎 and microphone 🎤 buttons
- ✅ **Inline Send Button**: Moved send button to same row as textarea with proper flex alignment
- ✅ **Wider Input Container**: Increased max-width to 1400px (~70% of page width on desktop)
- ✅ **Overflow Prevention**: Text wraps to new lines instead of overlapping controls
- ✅ **Mobile Optimized**: Responsive gap and button sizing for small screens (640px breakpoint)

### Production Deployment
- ✅ **Deployment Configuration**: Set up Autoscale deployment with proper backend directory handling (`cd backend && uvicorn main:app`)
- ✅ **Google Analytics**: Integrated GA4 tracking (G-M80FVXBCSG) in header following Google's setup specifications

### Comprehensive Analytics Implementation
- ✅ **Centralized Analytics Module**: Created `analytics.js` utility with lazy gtag loading, graceful degradation, and clean API for all tracking
- ✅ **Complete Event Coverage**: Tracks all critical user interactions including:
  - Mode switches (Chat ↔ Sources ↔ Report Builder)
  - Search queries and chat messages (with query length and mode metadata)
  - Source interactions (view, unlock, purchase with domain and pricing data)
  - Report generation and downloads (with source count, tier, and filename)
  - Onboarding flow (completion, skip with slide number)
  - Authentication (login, logout)
  - User feedback (thumbs up/down with context)
- ✅ **Production-Ready**: Lazy gtag resolution ensures events fire after GA loads, proper ES6 module imports, comprehensive metadata tracking (timestamps, prices, domains, counts)

### Onboarding & UI Improvements
- ✅ **3-slide Onboarding Tutorial**: Shows on first visit with localStorage persistence, navigation dots, and Skip/Next controls
- ✅ **Tab Rename**: Renamed "Research" to "Sources" (📚 icon) for clarity across all UI components
- ✅ **Runtime Fix**: Removed non-existent `_restoreChatMessages` method call

# System Architecture

## UI/UX Decisions
The frontend is a responsive, modern Single Page Application (SPA) built with vanilla HTML/CSS/JavaScript, utilizing a modular ES6 architecture. It features tier selection cards, dynamic content loading, story cards with quotes and descriptions for source articles, and professional presentation of search results with transparent licensing badges. UI includes intelligent scroll behavior: AI responses scroll to the message top, while user messages scroll to the bottom.

## Technical Implementations
- **Frontend**: Modular layered architecture with separation of concerns, including an Application Controller, Infrastructure Managers (Toast, Modal, EventRouter), Domain Managers (Source, Tier, Message, Interaction), Core Services, and UI Components. All components follow single-responsibility principle with clean interfaces and event-driven coordination.
- **Analytics & Instrumentation**: Production-grade Google Analytics 4 integration with centralized tracking utility (`analytics.js`), lazy gtag loading for graceful degradation, and comprehensive event coverage across all user interactions. Events include rich metadata (prices, domains, source counts, timestamps) for deep behavioral analysis.
- **Backend**: Developed with FastAPI, employing a unified service architecture for AI processing, content licensing, and research operations. `schemas/domain.py` is the single source of truth for data models. Includes a domain credibility penalty system and defensive URL validation. External API calls use async httpx with timeouts and exponential backoff retry logic.
- **Content Generation**: Employs a hybrid pipeline using Tavily for URL discovery and Anthropic Claude for content refinement and report generation, incorporating licensing detection and graceful API fallbacks.
- **AI-Powered Query Optimization**: Uses Claude Haiku to optimize search queries based on full conversation context, with strict no-injection constraints and post-generation entity validation.
- **Claude Relevance Filtering**: Implements universal AI-powered post-processing of all Tavily search results using Claude Haiku for cost-efficient relevance validation.
- **Premium Report Quality**: Research and Pro tier paid reports utilize Claude Sonnet 4 for superior analytical quality, generating reports with numbered citations and emphasizing evidence-based themes.
- **Authentication**: Secure JWT token management, LedeWire integration, and robust 401 handling, including tab state persistence after login.
- **Research Brief Extraction System**: Uses regex-based pattern matching to extract structured research briefs from conversation context.
- **Dual Classification Pipeline (Intent × Temporal)**: Classifies queries into intent types with tailored recency weights.
- **Recency-Weighted Reranking**: Implements a composite scoring algorithm (recency + topicality + authority) that prioritizes fresh content.
- **Premium Source Authority System**: Features a tiered domain authority hierarchy with premium sources receiving ranking boosts.
- **Source Type Classification & Blending**: Classifies sources by type and uses weighted sampling to blend results based on research intent, with frontend filter chips for instant filtering.
- **Hybrid Publication Search**: Allows users to search within specific publications using a two-tier approach.
- **Dual-Mode AI Experience**: Supports both conversational AI and deep research modes, including access to licensed sources and dynamic pricing.
- **Tiered Research Reports**: The `report_generator.py` service generates AI-powered research reports with numbered citations, intelligent in-memory caching, and progressive loading messages.
- **User-Selected Source Reports**: The `/generate-report` endpoint supports generating reports from user-selected sources.
- **Shared Crawler Singleton**: Both research and purchase routes use a shared crawler instance to ensure cache visibility across requests, enabling user-curated research reports.
- **Inline Citation Badges**: AI-generated reports feature contextual purchase badges next to locked source citations.
- **Chat-to-Research Transition**: Intelligent mode switching suggests transitioning to research mode for research-worthy conversations after at least 3 user messages.
- **Authentication-Gated Features**: Both Sources and Report Builder tabs require user authentication, automatically triggering the login modal when accessed by unauthenticated users.
- **Feedback System**: User feedback collection for research result quality using thumbs up/down UI, with SQLite persistence and support for authenticated and anonymous feedback.
- **Report Download**: Research reports include a download button that exports the full markdown content as a .md file with auto-generated filenames.

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
- **Production Readiness**: Comprehensive production-grade infrastructure including security (CORS, configuration validation), cost controls (per-user daily budgets, global spending caps, API cost tracking), reliability (global error handling, structured logging), scalability (PostgreSQL, rate limiting), and operations (environment validation, deployment checklist).

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