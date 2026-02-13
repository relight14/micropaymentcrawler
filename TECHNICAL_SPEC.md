# Clearcite — Technical Specification for Rebuild

**Version:** 1.0  
**Date:** February 2026  
**Purpose:** Provide a complete integration guide for all third-party services so an engineer can rebuild this application from scratch.

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [Architecture Summary](#2-architecture-summary)
3. [Anthropic Claude Integration](#3-anthropic-claude-integration)
4. [Tavily Search Integration](#4-tavily-search-integration)
5. [Content Licensing — Tollbit](#5-content-licensing--tollbit)
6. [Content Licensing — RSL (Really Simple Licensing)](#6-content-licensing--rsl-really-simple-licensing)
7. [Content Licensing — Cloudflare Pay-per-Crawl](#7-content-licensing--cloudflare-pay-per-crawl)
8. [LedeWire Wallet & Payments](#8-ledewire-wallet--payments)
9. [Protocol Adapter Pattern](#9-protocol-adapter-pattern)
10. [Environment Variables](#10-environment-variables)
11. [Improvement Recommendations](#11-improvement-recommendations)

---

## 1. Application Overview

Clearcite is a **chat-driven research assistant**. The user asks a question in natural language, the app discovers relevant sources from the open web, checks each source against content licensing protocols, lets the user pay micro-amounts to legally unlock full articles, curates those sources into a project, and generates a structured research report with numbered citations.

### Core Flow

```
User Question
  → Claude classifies intent (casual chat vs. deep research)
  → Tavily searches the web for real URLs
  → Each URL is checked against Cloudflare → Tollbit → RSL (first match wins)
  → User pays via LedeWire wallet to unlock content
  → Claude Sonnet synthesizes a cited research report
```

### Roles in the System

| Component | Role |
|-----------|------|
| **Claude** | Intent classification, source ranking, report generation |
| **Tavily** | Real-time web search returning actual URLs |
| **Tollbit** | Content licensing marketplace (1,400+ publishers) |
| **RSL** | Open XML licensing standard (1,500+ publishers) |
| **Cloudflare** | Pay-per-crawl protocol for premium publishers |
| **LedeWire** | Wallet, auth, content registration, micropayment processing |

---

## 2. Architecture Summary

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (SPA)                     │
│  Vanilla JS / ES6 modules served as static files     │
│  chat.html → js/app.js → managers, components, etc.  │
└────────────────────────┬────────────────────────────┘
                         │ HTTP / JSON
┌────────────────────────▼────────────────────────────┐
│                   BACKEND (FastAPI)                   │
│                                                      │
│  Routes:   chat, research, purchase, sources,        │
│            projects, wallet, auth, files, rsl         │
│                                                      │
│  Services: AI (classifier, conversational, report),  │
│            Licensing (Tollbit, RSL, Cloudflare),      │
│            Pricing, Source, Conversation, Budget       │
│                                                      │
│  Integrations:                                       │
│    ├── anthropic_client.py  (Claude API)             │
│    ├── tavily.py            (Tavily Search API)      │
│    └── ledewire.py          (LedeWire Wallet API)    │
│                                                      │
│  Data: SQLite (dev) / PostgreSQL (prod)              │
└─────────────────────────────────────────────────────┘
```

---

## 3. Anthropic Claude Integration

### What It Does

Claude powers all AI capabilities: classifying user intent, scoring/ranking search results, generating conversational responses, polishing source descriptions, suggesting outlines, and synthesizing full research reports.

### Models Used

| Model | Purpose | Approx. Cost |
|-------|---------|-------------|
| `claude-3-haiku-20240307` | Intent classification, conversational replies, context extraction, source polishing | ~$0.05/call |
| `claude-sonnet-4-20250514` | Report generation (structured output with tool use) | ~$1.00/call |

### How to Integrate

**1. Install the SDK**

```bash
pip install anthropic
```

**2. Initialize the client**

```python
from anthropic import Anthropic

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
```

**3. Intent classification (Haiku)**

Send the user's message to Haiku with a system prompt that distinguishes between casual conversation and research queries. Return a classification like `casual`, `research`, or `publication_specific`.

```python
response = client.messages.create(
    model="claude-3-haiku-20240307",
    max_tokens=300,
    system="You are a research assistant. Classify the user's intent...",
    messages=[{"role": "user", "content": user_query}]
)
```

**4. Report generation (Sonnet with tool use)**

Use Anthropic's tool-use feature to get structured JSON output. Define a tool schema that specifies the expected report shape (table data, summary, conflicts, research directions). Claude will return a `tool_use` block with structured data instead of freeform prose.

```python
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    system="You are a research analyst. Extract structured findings...",
    messages=[{"role": "user", "content": source_context}],
    tools=[{
        "name": "extract_research_data",
        "description": "Extract structured research data with analysis",
        "input_schema": {
            "type": "object",
            "properties": {
                "table_data": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "topic": {"type": "string"},
                            "source": {"type": "string"},
                            "content": {"type": "string"},
                            "takeaway": {"type": "string"},
                            "link": {"type": "string"}
                        },
                        "required": ["topic", "source", "content", "takeaway", "link"]
                    }
                },
                "summary": {"type": "string"},
                "conflicts": {"type": "string"},
                "research_directions": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            },
            "required": ["table_data", "summary", "conflicts", "research_directions"]
        }
    }],
    tool_choice={"type": "tool", "name": "extract_research_data"}
)
```

### Key Files

- `backend/integrations/anthropic_client.py` — Client factory
- `backend/services/ai/query_classifier.py` — Intent classification + context extraction
- `backend/services/ai/conversational.py` — Casual chat responses
- `backend/services/ai/report_generator.py` — Structured report generation (tool use)
- `backend/services/ai/polishing.py` — Source description refinement
- `backend/services/ai/outline_suggester.py` — Auto-outline from sources

### Environment Variables

```
ANTHROPIC_API_KEY=sk-ant-...    # Required
```

---

## 4. Tavily Search Integration

### What It Does

Tavily provides real-time web search. When a user submits a research query, Tavily returns actual URLs with titles, snippets, relevance scores, and publication dates. These become the "source cards" in the UI.

### How to Integrate

**1. Install the SDK**

```bash
pip install tavily-python
```

**2. Initialize and search**

```python
from tavily import TavilyClient

client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"])

results = client.search(
    query="impact of AI on journalism",
    search_depth="basic",       # "basic" or "advanced"
    max_results=10,
    include_answer=False,
    include_images=False,
    include_raw_content=False
)
```

**3. Response format**

```json
{
  "results": [
    {
      "title": "How AI Is Transforming Journalism",
      "url": "https://forbes.com/article-about-ai-journalism",
      "content": "Snippet of the article text...",
      "score": 0.92,
      "published_date": "2026-01-15"
    }
  ]
}
```

**4. Post-processing pipeline**

After Tavily returns results:
1. Deduplicate by URL
2. Send to Claude Haiku for relevance scoring and description polishing
3. Check each URL against licensing protocols (Cloudflare → Tollbit → RSL)
4. Render as source cards with badges in the UI

### Search Depth Options

- `basic` — Fast, lower cost, suitable for most queries
- `advanced` — Slower, higher quality, use for deep research queries

### Key Files

- `backend/integrations/tavily.py` — API wrapper with mock fallback
- `backend/services/research/crawler.py` — Tavily search + enrichment pipeline

### Environment Variables

```
TAVILY_API_KEY=tvly-...    # Required
```

---

## 5. Content Licensing — Tollbit

### What It Does

Tollbit is a licensing marketplace connecting AI applications with 1,400+ publishers (Forbes, TIME, AP News, USA Today, Bloomberg, Newsweek, etc.). It provides token-based licensing for two tiers:

- **ON_DEMAND_LICENSE** — AI scraping/inference access (~$0.01–0.05/article)
- **ON_DEMAND_FULL_USE_LICENSE** — Full human reader access (~$0.02–0.15/article)

### API Reference

**Base URL:** `https://gateway.tollbit.com`

#### Step 1: Pricing Discovery (Token Minting)

The Tollbit v2 API combines pricing discovery and token minting into a single call. If the publisher supports the requested license type, the API returns a JWT token. If not, it returns an error.

```
POST https://gateway.tollbit.com/dev/v2/tokens/content
Headers:
  TollbitKey: {TOLLBIT_API_KEY}
  Content-Type: application/json

Body:
{
  "url": "https://forbes.com/some-article",
  "userAgent": "micropaymentcrawler",
  "licenseType": "ON_DEMAND_LICENSE",      // or "ON_DEMAND_FULL_USE_LICENSE"
  "maxPriceMicros": 1000000,               // max you'll pay (microdollars)
  "currency": "USD"
}
```

**Success Response (200):**
```json
{
  "token": "eyJhbGciOi..."     // JWT token for content access
}
```

**Note:** The v2 API does not return explicit pricing. The current implementation uses fixed base cost ($0.025) with a 2× markup for AI tier ($0.05) and 2.4× on top for human tier ($0.12). Adjust these constants when Tollbit provides per-request pricing.

#### Step 2: Content Fetch

Use the minted token to retrieve full article content. Two delivery mechanisms:

**Primary — Gateway endpoint:**
```
GET https://gateway.tollbit.com/dev/v2/content/{domain}/{path}
Headers:
  Tollbit-Token: {minted_token}
  User-Agent: micropaymentcrawler
  Tollbit-Accept-Content: text/markdown
```

**Fallback — Publisher subdomain (if gateway returns 403):**
```
GET https://tollbit.{domain}/{path}
Headers:
  Tollbit-Token: {fresh_token}       // tokens are single-use; mint a new one
  User-Agent: micropaymentcrawler
  Tollbit-Accept-Content: text/markdown
```

### Pricing Constants (Current Implementation)

```python
TOLLBIT_BASE_COST = 0.025        # Estimated Tollbit base cost per article
MARKUP_MULTIPLIER = 2.0          # Markup for AI tier: $0.025 × 2.0 = $0.05
HUMAN_TIER_MULTIPLIER = 2.4      # Full-access: $0.05 × 2.4 = $0.12
```

### Integration Sequence

```
1. User searches → Tavily returns URLs
2. For each URL, POST to /dev/v2/tokens/content with ON_DEMAND_LICENSE
   → If 200 + token: publisher supports Tollbit AI tier
3. Optionally POST again with ON_DEMAND_FULL_USE_LICENSE
   → If 200 + token: full-access tier is available
4. Display badge + pricing on source card
5. When user clicks "Unlock":
   a. Mint a fresh token for the selected tier
   b. Fetch content via gateway (or subdomain fallback)
   c. Debit wallet via LedeWire
```

### Key Files

- `backend/services/licensing/content_licensing.py` → `TollbitProtocolHandler`

### Environment Variables

```
TOLLBIT_API_KEY=your_api_key     # Required for Tollbit integration
```

---

## 6. Content Licensing — RSL (Really Simple Licensing)

### What It Does

RSL is an open XML standard for machine-readable content licensing, similar in concept to `robots.txt` but for AI content usage rights and pricing. It is supported by 1,500+ publishers including AP, The Guardian, Reddit, Medium, Stack Overflow, and many academic institutions.

**Official Spec:** https://rslstandard.org/rsl

### Discovery

RSL files are served at well-known paths on each domain:

```
https://{domain}/.well-known/rsl.xml    (preferred)
https://{domain}/rsl.xml
https://{domain}/robots/rsl.xml
```

Iterate through these paths with a `GET` request. The first one that returns HTTP 200 with valid XML is the RSL document.

### XML Format

```xml
<rsl xmlns="https://rslstandard.org/rsl">
  <content server="https://licensing.example.com">
    <copyright>Example Publisher</copyright>
    <license>
      <permits type="usage">ai-include,search</permits>
      <payment type="inference">
        <amount currency="USD">0.05</amount>
      </payment>
      <payment type="purchase">
        <amount currency="USD">0.20</amount>
      </payment>
    </license>
  </content>
</rsl>
```

### Parsing Logic

| XML Element | Purpose |
|-------------|---------|
| `<permits type="usage">` | Comma-separated allowed uses: `ai-include`, `ai-train`, `search`, `all` |
| `<payment type="inference">` | AI tier price |
| `<payment type="crawl">` | Alternative AI tier price |
| `<payment type="purchase">` | Full human-reader price |
| `<payment type="attribution">` | Free with credit |
| `<amount currency="USD">` | Price in the specified currency |
| `<copyright>` | Publisher name (use for attribution) |
| `server` attribute on `<content>` | OAuth 2.0 license server URL |

### Integration Sequence

```
1. Extract domain from source URL
2. Try GET /.well-known/rsl.xml, /rsl.xml, /robots/rsl.xml
3. Parse XML with namespace "https://rslstandard.org/rsl"
4. Extract: permissions, AI price, purchase price, publisher, license server URL
5. Display RSL badge + pricing on source card
6. When user clicks "Unlock":
   a. POST to license server's /oauth/token (Client Credentials flow)
   b. Use returned Bearer token to GET full content from the source URL
   c. Debit wallet via LedeWire
```

### OAuth 2.0 License Acquisition

When a license server URL is present in the RSL XML, use the OAuth 2.0 Client Credentials flow:

```
POST {license_server_url}/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&scope=content:read content:ai-include
&resource={content_url}                     # RFC 8707 resource indicator

Auth: Basic {client_id}:{client_secret}
```

**Response:**
```json
{
  "access_token": "rsl_token_abc123",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "rsl_refresh_xyz",
  "scope": "content:read content:ai-include"
}
```

Then fetch the content:
```
GET {content_url}
Authorization: Bearer {access_token}
Accept: text/html,application/xhtml+xml
User-Agent: RSL-Research-Crawler/1.0
```

### Current Implementation Status

- ✅ XML discovery and parsing
- ✅ Permission and pricing extraction
- ✅ Publisher identification
- ⏳ OAuth 2.0 license acquisition (scaffolded, not connected to live servers)
- ⏳ Content fetching with token (scaffolded)

### Key Files

- `backend/services/licensing/content_licensing.py` → `RSLProtocolHandler`
- `backend/services/licensing/rsl_token_manager.py` → Token lifecycle management

### Environment Variables

```
RSL_CLIENT_ID=your_client_id          # Required for OAuth flow
RSL_CLIENT_SECRET=your_client_secret  # Required for OAuth flow
```

---

## 7. Content Licensing — Cloudflare Pay-per-Crawl

### What It Does

Cloudflare Pay-per-Crawl lets publishers behind Cloudflare's CDN monetize AI crawler access using the HTTP 402 Payment Required status code and custom headers. Target publishers include WSJ, NYT, The Economist, Reuters, Financial Times, and Condé Nast properties.

**Blog Post:** https://blog.cloudflare.com/introducing-pay-per-crawl/  
**Status:** Private beta (as of early 2026). There is no public API yet.

### Detection Methods

The current implementation detects Cloudflare licensing via real protocol signals only:

```python
# 1. Make a HEAD request to the URL
response = await client.head(url, timeout=5.0, follow_redirects=True)

# 2. Check for Cloudflare licensing signals
if ('cf-license-available' in response.headers or
    'cloudflare-licensing' in response.headers or
    response.status_code == 402):
    # This source uses Cloudflare licensing
```

### Expected Future Handshake (When Public API Ships)

```
1. HEAD request → detect 402 or cf-license-available header
2. Read pricing from response headers or a discovery endpoint
3. POST to Cloudflare licensing API with payment credentials
4. Receive signed token
5. GET content with Authorization: Bearer {signed_token}
```

### Pricing Estimates

- **AI Include:** ~$0.07/article
- **Full Access:** ~$0.25/article

### Priority

Cloudflare is checked **first** in the protocol chain because its target publishers (WSJ, NYT) are among the highest-value sources. If Cloudflare doesn't match, the system falls through to Tollbit, then RSL.

### Key Files

- `backend/services/licensing/content_licensing.py` → `CloudflareProtocolHandler`

### Environment Variables

None required currently. Will need Cloudflare API credentials when the public API launches.

---

## 8. LedeWire Wallet & Payments

### What It Does

LedeWire is the payment infrastructure layer. It provides:

- **User authentication** (email/password, Google OAuth, API key/secret)
- **Wallet management** (balance queries, Stripe-powered funding)
- **Content registration** (Clearcite registers research reports as sellable content)
- **Purchase processing** (wallet debit for content access)
- **Purchase verification** (check if user already owns specific content)

Clearcite acts as **both seller and buyer-proxy**: it registers generated reports as content (seller role), and facilitates user purchases of that content (buyer role).

### API Reference

**Base URLs:**
- Staging: `https://api-staging.ledewire.com/v1`
- Production: `https://api.ledewire.com/v1`

**Authentication:** All authenticated endpoints require `Authorization: Bearer {jwt_token}`

---

### 8.1 Authentication

#### Email/Password Login

```
POST /v1/auth/login/email
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "userpassword"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "c2a0e1f8a7e...",
  "expires_at": "2026-02-13T16:39:33Z"
}
```

#### User Signup

```
POST /v1/auth/signup
Content-Type: application/json

{
  "email": "newuser@example.com",
  "password": "strongpassword",
  "name": "Jane Doe"
}
```

Returns the same `AuthenticationResponse` shape.

#### API Key Login (Seller Authentication)

Used for server-to-server auth when Clearcite registers content as a seller.

```
POST /v1/auth/login/api-key
Content-Type: application/json

{
  "key": "your_seller_api_key",
  "secret": "your_seller_api_secret"
}
```

Returns the same `AuthenticationResponse` shape. The JWT will have `role: "seller"` in its claims.

#### Google OAuth Login

```
POST /v1/auth/login/google
Content-Type: application/json

{
  "id_token": "eyJhbGciOi..."    // Google-issued ID token
}
```

#### Token Refresh

```
POST /v1/auth/token/refresh
Content-Type: application/json

{
  "refresh_token": "c2a0e1f8a7e..."
}
```

#### JWT Claims Structure

```json
{
  "sub": "user-uuid",
  "role": "buyer",                         // or "seller"
  "buyer_claims": {
    "user_id": "user-uuid",
    "email": "user@example.com"
  },
  "iss": "LedeWire API",
  "aud": "web",
  "exp": 1747499973,
  "iat": 1747498173,
  "token_metadata": {
    "created_at": "2026-02-13T16:09:33Z",
    "expires_at": "2026-02-13T16:39:33Z",
    "token_id": "uuid"
  }
}
```

---

### 8.2 Wallet

#### Get Balance

```
GET /v1/wallet/balance
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "balance_cents": 12500
}
```

#### Create Payment Session (Fund Wallet)

Creates a Stripe payment intent. The frontend uses the returned `client_secret` with Stripe.js to collect payment.

```
POST /v1/wallet/payment-session
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "amount_cents": 500,
  "currency": "usd"
}
```

**Response (200):**
```json
{
  "client_secret": "pi_3MkLpg..._secret_pCFpWj...",
  "session_id": "pi_3MkLpgHxoRklNe0j1W96LQcG",
  "public_key": "pk_test_..."
}
```

#### Poll Payment Status

After the user completes Stripe payment, poll this endpoint until status is `succeeded` or `completed`.

```
GET /v1/wallet/payment-status/{session_id}
Authorization: Bearer {access_token}
```

**Response (200):**
```json
{
  "status": "succeeded",          // pending | succeeded | completed | failed | canceled
  "updated_at": "2026-02-13T16:15:00Z",
  "balance_cents": 13000
}
```

#### Webhook (Server-to-Server)

LedeWire receives Stripe webhooks and credits the wallet automatically:

```
POST /v1/wallet/payment-webhook       // or /v1/webhooks/payment
```

Your app does not need to handle this directly — LedeWire processes it server-side. However, if you need to self-host, implement webhook signature verification using the Stripe webhook secret.

---

### 8.3 Content Registration (Seller Flow)

Before a user can purchase a report, Clearcite must register it as content with LedeWire.

#### Register Content

```
POST /v1/seller/content
Authorization: Bearer {seller_jwt}
Content-Type: application/json

{
  "content_type": "markdown",
  "title": "Research Report: Impact of AI on Journalism",
  "content_body": "base64_encoded_markdown_content",
  "price_cents": 12,
  "visibility": "unlisted",
  "metadata": {
    "author": "Clearcite",
    "source_count": 8,
    "generated_at": "2026-02-13T16:00:00Z"
  }
}
```

**Response (201):**
```json
{
  "id": "b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e",
  "content_type": "markdown",
  "title": "Research Report: Impact of AI on Journalism",
  "price_cents": 12,
  "visibility": "unlisted"
}
```

The returned `id` is the `content_id` used in purchase requests.

#### Other Seller Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/seller/content` | GET | List all content |
| `/v1/seller/content/{id}` | GET | Get specific content |
| `/v1/seller/content/{id}` | PATCH | Update content |
| `/v1/seller/content/{id}` | DELETE | Delete content |
| `/v1/seller/sales` | GET | Sales data per content |
| `/v1/seller/sales/summary` | GET | Revenue + sales totals |
| `/v1/seller/config` | GET | Store configuration (e.g., Google client ID) |

---

### 8.4 Purchases (Buyer Flow)

#### Create Purchase

```
POST /v1/purchases
Authorization: Bearer {buyer_jwt}
Idempotency-Key: {unique_key}
Content-Type: application/json

{
  "content_id": "b1c2d3e4-f5a6-...",
  "price_cents": 12
}
```

**Response (200):**
```json
{
  "id": "3f7b9a8c-1d2e-...",
  "content_id": "b1c2d3e4-f5a6-...",
  "buyer_id": "09357c22-389a-...",
  "seller_id": "87654321-dcba-...",
  "amount_cents": 12,
  "timestamp": "2026-02-13T16:27:45Z",
  "status": "completed"
}
```

**Important:** Always send an `Idempotency-Key` header to prevent double charges on retries.

#### Verify Purchase

```
GET /v1/purchase/verify?content_id={content_id}
Authorization: Bearer {buyer_jwt}
```

**Response (200):**
```json
{
  "purchased": true,
  "purchase_details": {
    "purchase_id": "3f7b9a8c-...",
    "purchase_date": "2026-02-13T16:27:45Z"
  }
}
```

#### Get Content with Access Info

```
GET /v1/content/{id}/with-access
Authorization: Bearer {buyer_jwt}
```

Returns content metadata plus access control status (has_purchased, has_sufficient_funds, next_required_action).

---

### 8.5 Complete Purchase Flow (How It Works End-to-End)

#### Current Flow (Coupled — Steps 4-6 in Single Request)

```
┌─────────────────────────────────────────────────────────────────────┐
│                CURRENT PURCHASE SEQUENCE (COUPLED)                    │
│                                                                      │
│  1. CHECKOUT STATE                                                   │
│     POST /checkout-state  { price_cents, content_id }                │
│     → Returns: authenticate | fund_wallet | purchase | none          │
│                                                                      │
│  2. AUTHENTICATE (if needed)                                         │
│     POST /v1/auth/login/email  { email, password }                   │
│     → Returns: access_token, refresh_token                           │
│                                                                      │
│  3. FUND WALLET (if needed)                                          │
│     POST /v1/wallet/payment-session  { amount_cents }                │
│     → Returns: client_secret for Stripe.js                           │
│     → User completes Stripe payment                                  │
│     → Poll /v1/wallet/payment-status/{session_id} until succeeded    │
│                                                                      │
│  4. GENERATE REPORT + REGISTER + PURCHASE  (all in one request)      │
│     a. Generate AI report (Claude Sonnet, 10-30s)                    │
│     b. POST /v1/auth/login/api-key  → seller_jwt                    │
│     c. POST /v1/seller/content  → content_id                        │
│     d. POST /v1/purchases  { content_id, price_cents }              │
│     → Returns: report + purchase confirmation                        │
│                                                                      │
│  Problem: If step 4d fails, the expensive report (4a) is lost.       │
│  Problem: ~15-35 seconds blocking in a single HTTP request.          │
└─────────────────────────────────────────────────────────────────────┘
```

#### Recommended Flow (Decoupled — See Section 11.1 for Details)

```
┌─────────────────────────────────────────────────────────────────────┐
│              RECOMMENDED PURCHASE SEQUENCE (DECOUPLED)                │
│                                                                      │
│  PHASE 1: GENERATE + REGISTER  (user clicks "Generate Report")       │
│  ─────────────────────────────────────────────────────────────────    │
│  1a. Generate AI report (Claude Sonnet, 10-30s)                      │
│  1b. POST /v1/auth/login/api-key  → seller_jwt  (cached)            │
│  1c. POST /v1/seller/content  → content_id                          │
│  1d. Store { report_id, content_id, report_data } in reports table   │
│  → Returns: report preview + report_id + price_cents                 │
│                                                                      │
│  PHASE 2: CHECKOUT  (user reviews report, clicks "Buy")              │
│  ─────────────────────────────────────────────────────────────────    │
│  2a. CHECKOUT STATE  { price_cents, content_id }                     │
│      → authenticate | fund_wallet | purchase | none                  │
│  2b. AUTHENTICATE (if needed)                                        │
│  2c. FUND WALLET (if needed)                                         │
│  2d. POST /v1/purchases  { content_id, price_cents }                │
│      Headers: Idempotency-Key: {unique_key}                          │
│      → Returns: purchase confirmation                                │
│                                                                      │
│  Benefit: Purchase is a single API call (<1s).                       │
│  Benefit: Report survives purchase failures — user can retry.        │
│  Benefit: Price changes handled via PATCH /v1/seller/content/{id}.   │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Files

- `backend/integrations/ledewire.py` — Full API wrapper
- `backend/app/api/routes/purchase.py` — Purchase orchestration
- `backend/app/api/routes/wallet.py` — Wallet funding endpoints
- `backend/app/api/routes/auth.py` — Login/register routes
- `backend/data/ledger_repository.py` — Local purchase ledger + idempotency cache

### Environment Variables

```
LEDEWIRE_API_URL=https://api-staging.ledewire.com   # or production URL
LEDEWIRE_API_KEY=your_buyer_api_key                  # Optional (for API key auth)
LEDEWIRE_API_SECRET=your_buyer_api_secret            # Optional
LEDEWIRE_SELLER_API_KEY=your_seller_api_key          # Required for content registration
LEDEWIRE_SELLER_API_SECRET=your_seller_api_secret    # Required for content registration
```

---

## 9. Protocol Adapter Pattern

All three licensing protocols (Cloudflare, Tollbit, RSL) implement a common interface. This makes adding future protocols trivial.

### Interface

```python
class ProtocolHandler(ABC):
    @abstractmethod
    async def check_source(self, url: str) -> Optional[LicenseTerms]:
        """Detect protocol support and return pricing/permissions"""
        pass

    @abstractmethod
    async def request_license(self, url: str, license_type: str) -> Optional[LicenseToken]:
        """Acquire a license token for content access"""
        pass
```

### Shared Data Models

```python
@dataclass
class LicenseTerms:
    protocol: str                       # "cloudflare", "tollbit", or "rsl"
    ai_include_price: Optional[float]   # AI summarization cost ($)
    purchase_price: Optional[float]     # Full human-reader cost ($)
    currency: str                       # "USD"
    publisher: Optional[str]            # Publisher name
    license_server_url: Optional[str]   # OAuth server (RSL)
    permits_ai_training: bool
    permits_ai_include: bool
    permits_search: bool
    requires_attribution: bool

@dataclass
class LicenseToken:
    token: str                          # JWT or Bearer token
    protocol: str
    cost: float
    currency: str
    expires_at: datetime
    content_url: str
    license_type: str                   # "ai-include" or "full-access"
```

### Protocol Priority Chain

```python
class ContentLicenseService:
    def __init__(self):
        self.protocols = {
            'cloudflare': CloudflareProtocolHandler(),   # Check first
            'tollbit': TollbitProtocolHandler(),          # Check second
            'rsl': RSLProtocolHandler()                   # Check last
        }

    async def discover_licensing(self, url: str):
        for name, handler in self.protocols.items():
            terms = await handler.check_source(url)
            if terms:
                return {'protocol': name, 'handler': handler, 'terms': terms}
        return None
```

### Adding a New Protocol

1. Create a class that extends `ProtocolHandler`
2. Implement `check_source()` and `request_license()`
3. Optionally implement `fetch_content()`
4. Add it to the `self.protocols` dict in `ContentLicenseService.__init__()`

---

## 10. Environment Variables

Complete list for a working deployment:

```bash
# ── Required ──────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...              # Claude AI
TAVILY_API_KEY=tvly-...                   # Web search

# ── Content Licensing ─────────────────────────────────
TOLLBIT_API_KEY=...                       # Tollbit marketplace
RSL_CLIENT_ID=...                         # RSL OAuth (when live)
RSL_CLIENT_SECRET=...                     # RSL OAuth (when live)

# ── LedeWire ──────────────────────────────────────────
LEDEWIRE_API_URL=https://api-staging.ledewire.com
LEDEWIRE_SELLER_API_KEY=...               # For content registration
LEDEWIRE_SELLER_API_SECRET=...            # For content registration

# ── Database ──────────────────────────────────────────
USE_POSTGRES=true
DATABASE_URL=postgresql://...

# ── App Config ────────────────────────────────────────
ENVIRONMENT=production
ALLOWED_ORIGINS=https://yourdomain.com
LOG_LEVEL=INFO
STRUCTURED_LOGGING=true

# ── Rate Limiting ─────────────────────────────────────
RATE_LIMIT_ENABLED=true
DEFAULT_RATE_LIMIT=60/minute
RESEARCH_RATE_LIMIT=10/minute
REPORT_RATE_LIMIT=5/minute

# ── Budget Controls ───────────────────────────────────
DAILY_USER_BUDGET_CENTS=1000              # $10/user/day
GLOBAL_DAILY_BUDGET_CENTS=100000          # $1000/day total
MAX_API_CALLS_PER_USER_PER_DAY=100
```

---

## 11. Improvement Recommendations

### 11.1 LedeWire Integration — Decoupled Content Registration

#### The Problem

The current purchase handler (`purchase.py`) does everything in a single synchronous HTTP request:

```
purchase_research()
  ├─ 1. Calculate pricing
  ├─ 2. Generate AI report              ← 10-30 seconds (Claude Sonnet)
  ├─ 3. Authenticate as seller           ← network call
  ├─ 4. POST /v1/seller/content          ← network call (registration)
  ├─ 5. POST /v1/purchases               ← network call (payment)
  └─ 6. Return report
```

Content registration (step 4) is coupled to the purchase transaction (step 5). If registration fails, the whole purchase fails — even though the expensive report has already been generated. If the same user retries, the report is regenerated from scratch.

#### LedeWire API Conformance Check

The decoupled approach uses three LedeWire endpoints. All are tagged `Implemented` in the OpenAPI spec:

| Step | Endpoint | When | Purpose |
|------|----------|------|---------|
| Register | `POST /v1/seller/content` | After report generation | Create content, get `content_id` |
| Update | `PATCH /v1/seller/content/{id}` | After report finalization (optional) | Update price or metadata |
| Purchase | `POST /v1/purchases` | When user clicks "Buy" | Debit wallet, complete transaction |

The spec imposes no ordering constraint between content creation and purchase beyond the obvious: the `content_id` must exist before it can be purchased. There is no time limit between registration and purchase — content lives until explicitly deleted via `DELETE /v1/seller/content/{id}`.

#### The Decoupled Flow

Split the work into two phases: **report generation** (which includes registration) and **purchase** (which is now a single API call).

```
PHASE 1: GENERATE + REGISTER (happens when the user clicks "Generate Report")
──────────────────────────────────────────────────────────────────────────────
  1. Calculate pricing (local)
  2. Generate AI report (Claude Sonnet, 10-30s)
  3. Authenticate as seller (cached JWT, ~0ms if warm)
  4. POST /v1/seller/content → get content_id
  5. Store { report_id, content_id, report_data, price_cents } in reports table
  6. Return report + content_id to frontend

PHASE 2: PURCHASE (happens when the user clicks "Buy" — fast, <1s)
──────────────────────────────────────────────────────────────────────────────
  1. Look up content_id from reports table (local DB query)
  2. POST /v1/purchases { content_id, price_cents }
  3. Record transaction in local ledger
  4. Return confirmation
```

**Key differences from the current flow:**
- Report generation and content registration happen **before** the user commits to purchasing.
- The purchase endpoint is a single LedeWire API call — no seller auth, no content registration.
- If the user abandons the purchase, the registered content sits in LedeWire as `unlisted` (invisible to other users, no cost to Clearcite). Stale entries can be cleaned up with a nightly `DELETE` job.
- If the purchase fails (insufficient funds, network error), the user can retry without re-generating the report — the `content_id` is already stored locally.

#### Database Schema: `reports` Table

Replace the fragile `content_id_cache` table with a proper `reports` table that ties together the report, the LedeWire content record, and the pricing.

```sql
CREATE TABLE IF NOT EXISTS reports (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    query           TEXT NOT NULL,
    query_hash      TEXT NOT NULL,           -- SHA-256 of normalized query
    source_ids      TEXT NOT NULL,            -- JSON array of source IDs
    source_ids_hash TEXT NOT NULL,            -- SHA-256 of sorted source IDs
    report_data     TEXT NOT NULL,            -- JSON blob: {summary, table_data, ...}
    price_cents     INTEGER NOT NULL,
    content_id      TEXT,                     -- LedeWire content_id (NULL until registered)
    registered_at   TIMESTAMP,               -- When content was registered with LedeWire
    purchased_at    TIMESTAMP,               -- When user completed purchase (NULL until purchased)
    transaction_id  TEXT,                     -- LedeWire purchase transaction ID
    user_id         TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Uniqueness: same user + same query + same sources + same price = same report
    UNIQUE(user_id, query_hash, source_ids_hash, price_cents)
);

CREATE INDEX idx_reports_content_id ON reports(content_id);
CREATE INDEX idx_reports_user_query ON reports(user_id, query_hash);
```

#### Report Registration Logic

The `content_id` lookup-or-register pattern moves out of the purchase handler and into a standalone function that runs during report generation:

```python
# services/content_registration.py

async def register_report_with_ledewire(
    report_id: str,
    query: str,
    sources: List[SourceCard],
    price_cents: int,
    report_data: Dict,
    user_id: str
) -> str:
    """
    Register a generated report with LedeWire and return the content_id.
    
    1. Check if a report with the same fingerprint already has a content_id.
    2. If yes, return the existing content_id (skip re-registration).
    3. If no, POST /v1/seller/content and store the returned content_id.
    
    If price changed since last registration, PATCH the existing content.
    
    Returns: content_id (LedeWire UUID)
    """
    db = get_database()
    source_ids = sorted([s.id for s in sources])
    query_hash = hashlib.sha256(query.strip().lower().encode()).hexdigest()
    source_ids_hash = hashlib.sha256(",".join(source_ids).encode()).hexdigest()
    
    # Step 1: Check for existing registration
    existing = db.execute("""
        SELECT id, content_id, price_cents FROM reports
        WHERE user_id = ? AND query_hash = ? AND source_ids_hash = ?
        AND content_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1
    """, (user_id, query_hash, source_ids_hash)).fetchone()
    
    if existing and existing["content_id"]:
        # Same query + same sources — reuse the content_id
        if existing["price_cents"] != price_cents:
            # Price changed (e.g., different incremental pricing) — update in LedeWire
            ledewire.update_content(existing["content_id"], price_cents=price_cents)
            db.execute("""
                UPDATE reports SET price_cents = ? WHERE id = ?
            """, (price_cents, existing["id"]))
        return existing["content_id"]
    
    # Step 2: Register new content with LedeWire
    report_title = f"Research Report: {query[:100]}"
    content_stub = f"# {report_title}\n\nResearch report with {len(sources)} sources."
    
    registration = ledewire.register_content(
        title=report_title,
        content_body=content_stub,
        price_cents=price_cents,
        visibility="unlisted",
        metadata={
            "query": query,
            "source_count": len(sources),
            "generated_at": datetime.now().isoformat(),
            "report_id": report_id
        }
    )
    
    content_id = registration["id"]
    
    # Step 3: Store in reports table
    db.execute("""
        INSERT INTO reports (id, query, query_hash, source_ids, source_ids_hash,
                            report_data, price_cents, content_id, registered_at, user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT (user_id, query_hash, source_ids_hash, price_cents)
        DO UPDATE SET content_id = ?, registered_at = CURRENT_TIMESTAMP, report_data = ?
    """, (report_id, query, query_hash, json.dumps(source_ids), source_ids_hash,
          json.dumps(report_data), price_cents, content_id, user_id,
          content_id, json.dumps(report_data)))
    
    return content_id
```

#### Simplified Purchase Handler

After decoupling, the purchase endpoint shrinks dramatically:

```python
# routes/purchase.py — after decoupling

@router.post("", response_model=PurchaseResponse)
async def purchase_research(request: Request, purchase_request: PurchaseRequest, ...):
    user_id = extract_user_id_from_token(access_token)
    
    # Step 1: Look up the pre-registered content_id
    report = db.execute("""
        SELECT id, content_id, price_cents, report_data FROM reports
        WHERE id = ? AND user_id = ? AND content_id IS NOT NULL
    """, (purchase_request.report_id, user_id)).fetchone()
    
    if not report:
        raise HTTPException(404, "Report not found or not yet registered")
    
    # Step 2: Single LedeWire API call — just the purchase
    payment_result = ledewire.create_purchase(
        access_token=access_token,
        content_id=report["content_id"],
        price_cents=report["price_cents"],
        idempotency_key=purchase_request.idempotency_key
    )
    
    if "error" in payment_result:
        raise HTTPException(402, ledewire.handle_api_error(payment_result))
    
    # Step 3: Mark purchased locally
    db.execute("""
        UPDATE reports SET purchased_at = CURRENT_TIMESTAMP,
                          transaction_id = ?
        WHERE id = ?
    """, (payment_result.get("id"), report["id"]))
    
    # Step 4: Return the report
    return PurchaseResponse(
        success=True,
        message=f"Report purchased for ${report['price_cents']/100:.2f}",
        packet=json.loads(report["report_data"]),
        wallet_deduction=report["price_cents"] / 100
    )
```

#### Handling Price Changes with `PATCH`

If the user adds/removes sources between report generation and purchase, the price may change. The LedeWire `PATCH /v1/seller/content/{id}` endpoint (tagged `Implemented` in the spec) supports updating `price_cents`:

```python
# integrations/ledewire.py — new method

def update_content(self, content_id: str, price_cents: int = None,
                   title: str = None, metadata: Dict = None) -> Dict[str, Any]:
    """
    PATCH /v1/seller/content/{id}
    Update an existing content item. Only sends fields that changed.
    """
    seller_token = self.authenticate_as_seller()
    
    update_data = {}
    if price_cents is not None:
        update_data["price_cents"] = price_cents
    if title is not None:
        update_data["title"] = title
    if metadata is not None:
        update_data["metadata"] = metadata
    
    response = self.session.patch(
        f"{self.api_base}/seller/content/{content_id}",
        headers={"Authorization": f"Bearer {seller_token}"},
        json=update_data,
        timeout=10
    )
    response.raise_for_status()
    return response.json()
```

This means if the user modifies their outline after the report is generated:
1. Recalculate `price_cents` locally.
2. `PATCH /v1/seller/content/{content_id}` with the new price.
3. Update the local `reports` row.
4. The `POST /v1/purchases` call uses the same `content_id` at the updated price.

#### Stale Content Cleanup

Registered-but-never-purchased content accumulates in LedeWire over time. Since all Clearcite content is `visibility: "unlisted"`, it's invisible to other users, but it should still be cleaned up.

```python
# tasks/cleanup_stale_content.py — run nightly via cron or scheduler

async def cleanup_stale_registrations(max_age_hours: int = 72):
    """
    Delete LedeWire content registrations that were never purchased.
    Safe because visibility=unlisted means no external buyers can access them.
    """
    stale_reports = db.execute("""
        SELECT id, content_id FROM reports
        WHERE content_id IS NOT NULL
        AND purchased_at IS NULL
        AND created_at < datetime('now', '-' || ? || ' hours')
    """, (max_age_hours,)).fetchall()
    
    for report in stale_reports:
        try:
            ledewire.delete_content(report["content_id"])  # DELETE /v1/seller/content/{id}
        except Exception:
            pass  # Already deleted or network error — skip
        
        db.execute("""
            UPDATE reports SET content_id = NULL, registered_at = NULL
            WHERE id = ?
        """, (report["id"],))
```

#### Seller Token Persistence

The seller JWT (used for `POST /v1/seller/content` and `PATCH`) is currently cached in-memory and lost on restart. Fix:

```python
# Store in database alongside the reports table
CREATE TABLE IF NOT EXISTS seller_tokens (
    id          INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
    token       TEXT NOT NULL,
    expires_at  TIMESTAMP NOT NULL,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

On startup, load the cached seller token from the database. If expired or missing, re-authenticate via `POST /v1/auth/login/api-key` and store the new token. This saves a network round-trip on the first request after a restart.

#### Buyer Token Refresh

The `refresh_token` from buyer auth responses is currently unused. Implement proactive refresh to avoid 401 errors mid-purchase:

```python
async def ensure_valid_buyer_token(self, access_token: str, refresh_token: str) -> str:
    """Refresh the buyer's access token if near expiry."""
    import jwt  # PyJWT — decode without verification to read exp claim
    claims = jwt.decode(access_token, options={"verify_signature": False})
    if claims["exp"] - time.time() < 300:  # less than 5 min remaining
        result = self.session.post(
            f"{self.api_base}/auth/token/refresh",
            json={"refresh_token": refresh_token}
        )
        result.raise_for_status()
        return result.json()["access_token"]
    return access_token
```

#### Wallet Funding Webhooks

The current app polls `GET /v1/wallet/payment-status/{session_id}` after Stripe payment. Improvement: implement a webhook receiver that LedeWire calls when the wallet is credited:

```python
# routes/webhooks.py

@router.post("/ledewire/wallet-funded")
async def wallet_funded_webhook(request: Request):
    """LedeWire calls this when a wallet payment completes."""
    body = await request.json()
    # Verify webhook signature (LedeWire-specific header)
    # Update local state, notify frontend via WebSocket/SSE
```

This eliminates polling and gives the user instant feedback when their wallet is funded.

---

### 11.2 Tollbit Integration — Stability Improvements

**Problem: Two API calls for pricing discovery (AI tier + full-access tier).**  
Each URL requires two `POST` calls to verify both tier availability. This doubles latency.

- **Batch the checks.** Run both tier requests concurrently with `asyncio.gather()`. The current implementation does them sequentially.
- **Cache results aggressively.** If a domain supports Tollbit for one article, it likely supports it for all articles on that domain. Cache at the domain level with a 1-hour TTL.

**Problem: Fixed pricing constants instead of dynamic pricing.**  
The v2 API doesn't return explicit prices, so the app uses hardcoded multipliers.

- **Add a pricing configuration table** or env var for per-publisher overrides. As Tollbit evolves its API, this makes it easy to slot in real pricing without code changes.

**Problem: Token single-use constraint causes fallback complexity.**  
When the gateway fails, the code mints a fresh token for the subdomain fallback. This is correct but fragile.

- **Consolidate the fetch logic** into a single method with automatic retry that handles token re-minting internally, rather than requiring callers to understand the fallback mechanism.

---

### 11.3 RSL Integration — Completion Path

**Problem: OAuth flow is scaffolded but not connected.**  
The `RSLTokenManager` creates mock tokens when credentials aren't configured.

- **Implement the full Client Credentials flow** as described in Section 6. This is ~4–6 hours of work and unlocks 1,500+ publishers.
- **Store RSL tokens in the database** (not `/tmp/rsl_tokens.json`). The current file-based storage is lost on container restart and doesn't work across multiple workers.

**Problem: No attribution display.**  
RSL requires attribution for some content (`requires_attribution` field). The frontend doesn't render this.

- **Add an attribution footer** to source cards and reports when `requires_attribution` is true. Include the publisher name from the `<copyright>` element.

---

### 11.4 Cloudflare Integration — Readiness

**Problem: No real API exists yet (private beta).**  
The current implementation only detects Cloudflare signals (402 status, headers). It cannot acquire licenses or fetch content.

- **Keep the detection code** but clearly mark it as "detection only" in the UI (the current "Coming Soon" badge is appropriate).
- **Register for the Cloudflare beta** to get early API access.
- **Design the adapter now** so that when the API ships, you only need to implement `request_license()` and `fetch_content()` — the detection and display code is already done.

---

### 11.5 Claude Integration — Performance & Cost

**Problem: Report generation blocks the HTTP request.**  
Claude Sonnet calls can take 10–30 seconds. The current implementation blocks the FastAPI endpoint for the entire duration.

- **Move report generation to a background job queue** (Celery + Redis, or BullMQ if rebuilding in TypeScript). Return a job ID immediately; the frontend polls or subscribes via SSE.
- **Stream intermediate progress** (e.g., "Analyzing source 3 of 8...") to keep the user informed.

**Problem: No streaming for chat responses.**  
The app waits for Claude's full response before sending it to the frontend.

- **Use SSE (Server-Sent Events)** to stream tokens in real time. Anthropic's SDK supports streaming natively:
  ```python
  with client.messages.stream(...) as stream:
      for text in stream.text_stream:
          yield f"data: {json.dumps({'text': text})}\n\n"
  ```

**Problem: Model selection is hardcoded.**  
The default model is `claude-3-haiku-20240307`. Newer models (Haiku 3.5, Sonnet 4) may offer better price/performance.

- **Make model names configurable via environment variables** (`CLAUDE_FAST_MODEL`, `CLAUDE_POWER_MODEL`) so you can upgrade without code changes.

---

### 11.6 Tavily Integration — Resilience

**Problem: No retry logic on Tavily API calls.**  
If the API times out or returns a 5xx error, the search fails silently and falls back to mock results.

- **Add retry with exponential backoff** (the licensing handlers already have `@async_retry`; apply the same pattern to Tavily).
- **Set a reasonable timeout** (10 seconds for basic search, 20 for advanced).

---

### 11.7 Cross-Cutting Architecture Improvements

**1. Purchase state machine.** With the decoupled flow (Section 11.1), the state machine simplifies because registration happens in Phase 1:

```
Phase 1 (Generate):  IDLE → GENERATING → REGISTERING → REPORT_READY
Phase 2 (Purchase):  REPORT_READY → CHECKING_WALLET → INSUFFICIENT_FUNDS → FUNDING → FUNDED
                                                     → SUFFICIENT_FUNDS → PURCHASING → COMPLETE
                                                                        → FAILED → RETRY
```

`REGISTERING_CONTENT` is no longer in the purchase path — it's part of report generation.

**2. Idempotency.** The current implementation uses SHA-256 of `user_id + query + source_ids` as the idempotency key. This is good but should be extended:

- Send the idempotency key to LedeWire's `Idempotency-Key` header (already done ✅).
- Also persist idempotency status in PostgreSQL (not just SQLite) for durability.

**3. Budget enforcement.** The `budget_tracker.py` tracks daily spend per user and globally. Make sure this is checked **before** registering content with LedeWire, not after. Currently, the budget check happens at the route level, which is correct.

**4. Licensing result caching.** Protocol checks involve network calls to external APIs. Cache results:

- **In-memory** (already done): First check for a URL is cached for the lifetime of the process.
- **Redis** (recommended): Share cache across workers with a 1-hour TTL.
- **Database** (for persistence): Store confirmed protocol + pricing per domain for long-term reuse.

**5. Error boundaries.** If any single integration fails (LedeWire down, Tollbit timeout, Claude overloaded), the app should degrade gracefully:

- LedeWire down → Show "payments temporarily unavailable" but still allow browsing and unlicensed content
- Tollbit down → Skip Tollbit in the protocol chain, try RSL
- Claude down → Return an error for AI features but keep search and browsing working
- Tavily down → Show "search temporarily unavailable" message

---

*This document should give an engineer everything needed to rebuild Clearcite's integration layer from scratch. The core abstractions (protocol adapter pattern, purchase state machine, streaming AI responses) are designed to scale as new protocols and publishers come online.*
