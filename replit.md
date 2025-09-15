# Overview

This is an AI-powered research tool MVP that provides tiered research services with dynamic pricing. Users can input complex research queries and purchase different levels of research packets (Basic, Research, Pro) that include varying numbers of sources, outlines, and insights. The application simulates content crawling and source unlocking functionality while integrating with a wallet-based payment system.

# User Preferences

Preferred communication style: Simple, everyday language.

# Recent Changes

- **September 15, 2025**: Completed full API integration for LedeWire wallet readiness
  - Added `/unlock-source` backend endpoint with proper wallet deduction simulation
  - Updated frontend to call backend API for all payment operations (both tier purchases and source unlocks)
  - All payment flows now go through backend with LedeWire-compatible API structure
  - Ready for production LedeWire integration - just needs API endpoint swapping in `simulate_wallet_deduction()`
  - Maintains complete transaction audit trail and proper error handling
  - **September 12, 2025**: Complete MVP implementation deployed and tested
  - Built FastAPI backend with all required modules (main.py, models.py, crawler_stub.py, ledger.py, packet_builder.py)
  - Implemented tier-based research system with correct pricing (Basic $1, Research $2, Pro $4)
  - Created simulated content crawler with dynamic source unlock pricing ($0.10-$2.00 per source)
  - Developed clean frontend interface with search, tier selection, and payment flow
  - Set up SQLite ledger for tracking purchases and research packet deliveries
  - Configured and tested workflow running successfully on port 5000
  - Verified end-to-end functionality with API testing

# System Architecture

## Frontend Architecture
- **Single Page Application**: Built with vanilla HTML/CSS/JavaScript for simplicity and direct control
- **Component-based Design**: Uses a JavaScript class-based approach with the ResearchApp controller managing all user interactions
- **Responsive UI**: Clean, modern interface with tier selection cards and dynamic content loading
- **Event-driven Architecture**: Handles user interactions through event listeners for search, tier selection, and purchases

## Backend Architecture
- **FastAPI Framework**: Python-based REST API with automatic OpenAPI documentation and type validation
- **Modular Design**: Separated concerns across multiple modules:
  - `main.py`: API routes and request handling
  - `models.py`: Pydantic schemas for request/response validation
  - `crawler_stub.py`: Simulated content crawling with dynamic pricing
  - `ledger.py`: Transaction and research packet tracking
  - `packet_builder.py`: Research content composition and organization
- **Simulation Layer**: ContentCrawlerStub simulates real content crawling with realistic pricing algorithms
- **CORS Support**: Configured for cross-origin requests to support frontend-backend communication

## Data Storage
- **SQLite Database**: Lightweight file-based database for MVP persistence
- **Transaction Tracking**: Dedicated tables for purchases and source unlocks
- **Ledger System**: Maintains audit trail of all financial transactions and research deliveries
- **JSON Serialization**: Complex data structures stored as JSON in database fields

## Pricing and Payment Architecture
- **Tiered Pricing Model**: Three distinct service levels with different feature sets and pricing
  - Basic: $1 for 10 sources
  - Research: $2 for 20 sources + outline
  - Pro: $4 for 40 sources + outline + insights
- **Dynamic Pricing Engine**: Simulates variable source unlock costs based on quality factors
- **Wallet Integration**: Designed to integrate with LedeWire wallet API for payment processing
- **Future Monetization**: Supports per-source unlocking with micro-transactions

## Content Management
- **Research Packet System**: Structured delivery of research materials with summaries, outlines, and insights
- **Source Card Architecture**: Locked content preview system with individual unlock pricing
- **Content Simulation**: Generates realistic academic and research content for testing
- **Quality-based Pricing**: Simulates pricing variations based on source quality factors

# External Dependencies

## Planned Integrations (Not Yet Implemented)
- **LedeWire Wallet API**: Payment processing and wallet deduction system for user transactions
- **Cloudflare Pay-Per-Crawl API**: Live content crawling and source material retrieval (currently stubbed)

## Current Dependencies
- **FastAPI**: Web framework for building the REST API backend
- **Pydantic**: Data validation and serialization using Python type annotations
- **SQLite3**: Built-in Python database interface for local persistence
- **UUID**: Python standard library for generating unique identifiers
- **CORS Middleware**: FastAPI middleware for handling cross-origin requests

## Development Dependencies
- **Uvicorn**: ASGI server for running the FastAPI application
- **Static File Serving**: FastAPI's StaticFiles for serving frontend assets

The architecture is designed for easy integration of real services while maintaining a functional MVP with simulated data and pricing.