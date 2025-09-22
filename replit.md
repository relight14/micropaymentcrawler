# Overview

This project is an AI-powered research tool MVP offering tiered research services with dynamic pricing. Users can submit complex research queries and purchase different levels of research packets (Basic, Research, Pro), which include varying numbers of sources, outlines, and insights. The application simulates content crawling and source unlocking, integrated with a wallet-based payment system. The business vision is to provide a competitive differentiator with "real data, not made up," ensuring authentic source validation and professional presentation.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## UI/UX Decisions
The frontend is a Single Page Application built with vanilla HTML/CSS/JavaScript, utilizing a component-based, event-driven design. It features a responsive, clean, and modern interface with tier selection cards and dynamic content loading. UI elements include story cards with quotes and descriptions for source articles, professional presentation for search results, and transparent licensing badges (RSL 🔒, Tollbit ⚡, Cloudflare ☁️).

## Technical Implementations
- **Frontend**: Vanilla HTML/CSS/JavaScript with a `ResearchApp` controller for interactions. It dynamically fetches pricing from the backend, uses cache-busting headers for static assets, and implements an optimistic authentication system with robust 401 handling for a superior user experience.
- **Backend**: Built with FastAPI, using a modular design for API routes, Pydantic schemas for validation, and separate modules for simulated crawling, ledger tracking, and packet building. It supports CORS and integrates a budget-constrained pricing model for source generation.
- **Content Generation**: A hybrid pipeline uses Tavily for discovering real, clickable URLs and Claude for polishing raw search snippets into professional excerpts and titles. It includes licensing detection and graceful fallbacks for API unavailability.
- **Authentication**: Implemented an optimistic authentication approach that handles 401 errors gracefully, resumes transactions, and clears tokens securely. It supports both email/password login and signup via LedeWire.
- **Dual-Mode AI Experience**: Offers both a conversational AI mode (Anthropic Claude integration with state persistence) for research discovery and a deep research mode with licensed source access and dynamic pricing.

## Feature Specifications
- **Tiered Research Services**: Basic (Free), Research ($2), and Pro ($4) tiers with varying numbers of sources and features. The Basic tier is free and bypasses payment processing but requires authentication.
- **Dynamic Pricing**: Source unlocking costs are dynamically simulated and determined by AI relevance, with a 60/40 budget allocation for licensing and corporate margin.
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