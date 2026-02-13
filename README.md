# Clearcite — AI Research Tool with Ethical Micropayment Licensing

## What This App Is

Clearcite (working title; branded "LedeWire AI Research Tool" in-code) is a **chat-driven research assistant** that lets users ask a question, discover relevant sources from the open web, **pay publishers micro-amounts** to legally access full articles, curate those sources into a project, and generate a structured research report — all inside a single interface.

The core value proposition: **real data, not made-up data.** Every source is a real URL. Every premium article is paid for through industry licensing protocols. The output is a professional, cited research document.

---

## How the App Flows Today

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER JOURNEY                                 │
└─────────────────────────────────────────────────────────────────────┘

1. CHAT                2. DISCOVER             3. LICENSE
   User asks a            Tavily web search       Protocol detection
   research question      returns real URLs.       (Tollbit / RSL /
   in natural language.   Claude classifies        Cloudflare) checks
   Claude determines      and ranks results.       each source for
   intent (casual vs.     Sources appear in        pricing and access
   deep research).        the Sources panel.       terms.

4. PURCHASE            5. CURATE               6. REPORT
   User chooses            User selects sources    Claude Sonnet
   "Summarize" (AI         and adds them to an     synthesizes the
   tier ≈ $0.01–0.07)     outline inside a        licensed content
   or "Full Access"        project. Outline        into a numbered-
   (human tier ≈           builder lets them       citation research
   $0.12–0.25).            structure sections.     report. Report can
   Wallet debited                                  be downloaded as
   via LedeWire.                                   Markdown.
```

### Step-by-step detail

| Step | What Happens | Key Backend Code | Key Frontend Code |
|------|-------------|------------------|-------------------|
| **1. Chat** | User types a query. Backend classifies it (casual → conversational reply; research → source search). | `routes/chat.py`, `routes/research.py`, `services/ai/query_classifier.py`, `services/ai/conversational.py` | `managers/interaction-handler.js`, `managers/message-coordinator.js` |
| **2. Source Discovery** | Tavily API searches the web. Results are enriched by Claude (relevance scoring, description polishing). Licensing protocols are checked. | `services/research/crawler.py` (Tavily + `ContentCrawlerStub`), `services/ai/polishing.py` | `managers/source-manager.js`, `components/source-card.js` |
| **3. License Detection** | Each URL is checked against Cloudflare → Tollbit → RSL (first match wins). Badge and price are returned. | `services/licensing/content_licensing.py` (`CloudflareProtocolHandler`, `TollbitProtocolHandler`, `RSLProtocolHandler`) | `components/source-card.js` (badge rendering) |
| **4. Purchase** | User confirms in a modal. Backend validates wallet balance, mints a license token, fetches content, and records the transaction. | `routes/purchase.py`, `routes/sources.py`, `integrations/ledewire.py`, `services/pricing_service.py` | `components/purchase-confirmation-modal.js`, `app/modal-controller.js` |
| **5. Project Curation** | Sources are saved to a project. Outline builder lets the user drag sections and sources. | `routes/projects.py`, `services/conversation_manager.py` | `components/outline-builder.js`, `components/project-sidebar.js`, `controllers/projects-controller.js` |
| **6. Report Generation** | Backend calculates incremental pricing (only new sources cost money). Claude Sonnet generates a structured report with numbered citations. | `routes/purchase.py`, `services/ai/report_generator.py`, `services/ai/outline_suggester.py` | `components/report-builder.js` |

---

## Current Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3.11, FastAPI, Uvicorn |
| **Frontend** | Vanilla JS (ES6 modules), single-page HTML served as static files |
| **Database** | SQLite (dev) / PostgreSQL (prod) via `db_wrapper.py` |
| **AI** | Anthropic Claude (Haiku for classification, Sonnet for reports) |
| **Web Search** | Tavily Search API |
| **Payments** | LedeWire API (wraps Stripe for wallet top-ups) |
| **Content Licensing** | Tollbit API, RSL XML standard, Cloudflare Pay-per-Crawl (beta) |
| **Web Scraping** | BeautifulSoup4 + LXML (fallback for free/non-licensed sources) |
| **Rate Limiting** | SlowAPI |

---

## Architecture at a Glance

```
backend/
├── main.py                          # Uvicorn entry point
├── config.py                        # Env-var config with validation
├── app/
│   ├── __init__.py                  # FastAPI factory (create_app)
│   └── api/routes/                  # Thin route handlers
│       ├── chat.py                  #   conversational + source-search endpoints
│       ├── research.py              #   deep research pipeline
│       ├── purchase.py              #   checkout-state, quote, buy
│       ├── sources.py               #   summarize, full-access
│       ├── projects.py              #   CRUD for projects & outlines
│       ├── wallet.py                #   balance, funding via LedeWire
│       ├── auth.py                  #   login / register (JWT via LedeWire)
│       ├── files.py                 #   PDF/DOCX upload → AI processing
│       ├── rsl.py                   #   RSL protocol endpoints
│       └── health.py                #   liveness/readiness
├── services/
│   ├── ai/                          # AI service layer
│   │   ├── query_classifier.py      #   intent + temporal classification
│   │   ├── conversational.py        #   casual chat responses
│   │   ├── outline_suggester.py     #   auto-outline from sources
│   │   ├── report_generator.py      #   long-form report synthesis
│   │   └── polishing.py             #   source description refinement
│   ├── licensing/
│   │   ├── content_licensing.py     #   multi-protocol abstraction layer
│   │   └── rsl_token_manager.py     #   RSL token lifecycle
│   ├── research/
│   │   ├── crawler.py               #   Tavily search + scraping
│   │   └── domain_classifier.py     #   free vs licensed domain heuristics
│   ├── conversation_manager.py      #   DB-backed conversation history
│   ├── pricing_service.py           #   incremental cost calculation
│   ├── source_service.py            #   source extraction & dedup
│   └── budget_tracker.py            #   per-user / global spend caps
├── integrations/
│   ├── ledewire.py                  #   wallet, auth, purchases
│   ├── tavily.py                    #   search API wrapper
│   └── anthropic_client.py          #   Claude API wrapper
├── data/
│   ├── db_wrapper.py                #   SQLite/Postgres switch
│   ├── ledger_repository.py         #   purchases, idempotency, cache
│   ├── db.py                        #   SQLite implementation
│   └── postgres_db.py               #   PostgreSQL implementation
├── middleware/
│   ├── auth_dependencies.py         #   FastAPI Depends() for auth
│   └── error_handler.py             #   global error middleware
├── schemas/
│   ├── api.py                       #   Pydantic request/response models
│   └── domain.py                    #   SourceCard, LicenseTerms, etc.
└── static/                          # SPA frontend
    ├── chat.html                    #   single HTML shell
    ├── js/
    │   ├── app.js                   #   application controller
    │   ├── services/                #   API client, auth service
    │   ├── state/                   #   app-state, project-store
    │   ├── managers/                #   source, message, interaction
    │   ├── controllers/             #   projects controller
    │   ├── components/              #   UI components (14 modules)
    │   ├── app/                     #   modal controller, toast, event router
    │   └── utils/                   #   event bus, logger, safe-renderer, dom
    └── styles/                      #   component CSS
```

---

## Licensing Protocols Explained

The app's differentiator is **legal, paid access** to premium content. Three protocols are integrated:

| Protocol | Status | Publishers | How It Works | Typical Cost |
|----------|--------|-----------|--------------|-------------|
| **Tollbit** | Production ready (token minting works; content fetch ⏳) | 1,400+ (Forbes, TIME, AP, Bloomberg …) | REST API → rate discovery → mint token → fetch markdown/HTML | $0.01–0.05 (AI) / $0.02–0.15 (full) |
| **RSL** | XML discovery works; OAuth license server ⏳ | 1,500+ (AP, Guardian, Reddit, .edu …) | Fetch `/.well-known/rsl.xml` → parse terms → OAuth → fetch content | $0.05–0.25 |
| **Cloudflare** | Domain detection only; API in private beta | WSJ, NYT, Economist, FT … | HTTP 402 → pay → signed token → fetch content | ~$0.07 (AI) / ~$0.25 (full) |

**Priority order:** Cloudflare → Tollbit → RSL (first match wins).

---

## What's Working vs. What's Incomplete

| Feature | Status |
|---------|--------|
| Chat interface (conversational + research mode) | ✅ Working |
| Tavily web search → source cards | ✅ Working |
| License protocol detection + badge display | ✅ Working |
| Tollbit rate discovery + token minting | ✅ Working |
| Tollbit full content fetch | ⏳ Endpoint coded, not wired to UI |
| RSL XML parsing + pricing | ✅ Working |
| RSL OAuth license acquisition | ⏳ Not implemented |
| Cloudflare content access | ⏳ Waiting on public API |
| LedeWire wallet / auth / purchases | ✅ Working |
| Purchase confirmation modal (summarize, full access, report) | ✅ Working |
| Project management + outline builder | ✅ Working |
| Report generation with numbered citations | ✅ Working |
| File upload (PDF, DOCX, MD) | ✅ Working |
| Budget tracking + rate limiting | ✅ Working |

---

## If You Were Building This From Scratch

Below is an opinionated blueprint from the perspective of a senior full-stack engineer, keeping the same grand vision:

> **Natural chat → source query → license for full read → curate into a project → structured research output.**

### Guiding Principles

1. **Type safety end-to-end.** Shared types between front and back eliminate an entire class of bugs.
2. **Real-time by default.** Research is slow (search, scrape, AI generation). Stream everything.
3. **Event-driven purchase flow.** Purchases are inherently async (wallet check → payment → content delivery). Model them as state machines, not imperative code.
4. **Separate the AI pipeline from the web app.** AI calls are expensive and slow. Run them as background jobs so the API stays fast.
5. **Protocol adapters as plug-ins.** New licensing protocols will appear. Make them hot-swappable.

### Recommended Tech Stack

```
┌───────────────────────────────────────────────────────────┐
│                       FRONTEND                            │
│                                                           │
│  Next.js 14+ (App Router)                                 │
│  ├── React Server Components for initial page loads       │
│  ├── Streaming UI (React Suspense) for AI responses       │
│  ├── Tailwind CSS + shadcn/ui for rapid, consistent UI    │
│  ├── TanStack Query for server-state caching              │
│  ├── Zustand for lightweight client state                 │
│  └── Vercel AI SDK (useChat / useCompletion hooks)        │
│      ↳ token-by-token streaming out of the box            │
│                                                           │
│  Why Next.js over vanilla JS:                             │
│  • File-based routing, no manual SPA wiring               │
│  • Server actions for mutations (no REST boilerplate)     │
│  • Built-in streaming support for LLM responses           │
│  • First-class TypeScript                                 │
└────────────────────────┬──────────────────────────────────┘
                         │  HTTP / WebSocket / Server-Sent Events
┌────────────────────────▼──────────────────────────────────┐
│                        BACKEND                            │
│                                                           │
│  Option A — TypeScript (recommended for shared types)     │
│  ├── tRPC or Hono for type-safe API layer                 │
│  ├── Drizzle ORM (PostgreSQL)                             │
│  ├── BullMQ + Redis for background jobs (AI, scraping)    │
│  ├── Zod schemas shared with frontend via monorepo        │
│  └── Stripe SDK (direct) for wallet / micropayments       │
│                                                           │
│  Option B — Python (if team prefers Python AI ecosystem)  │
│  ├── FastAPI (keep) + Pydantic v2                         │
│  ├── Celery + Redis for background AI tasks               │
│  ├── SQLAlchemy 2.0 (async) + Alembic migrations         │
│  └── Stripe Python SDK for payments                       │
│                                                           │
│  Either way:                                              │
│  • Streaming responses via SSE for all AI endpoints       │
│  • Protocol adapter interface for licensing plug-ins      │
│  • Idempotent purchase pipeline (state machine)           │
└────────────────────────┬──────────────────────────────────┘
                         │
┌────────────────────────▼──────────────────────────────────┐
│                     DATA / INFRA                          │
│                                                           │
│  PostgreSQL ─── single source of truth                    │
│  Redis ──────── job queue, caching, rate limiting         │
│  S3 / R2 ────── stored reports (PDF, Markdown exports)    │
│  Vercel ─────── frontend hosting (edge, fast)             │
│  Fly.io or                                                │
│  Railway ────── backend hosting (close to DB)             │
│                                                           │
│  Auth: Clerk or NextAuth.js                               │
│  ↳ handles JWT, OAuth, MFA; wallet balance is app-level   │
│                                                           │
│  Payments: Stripe directly                                │
│  ↳ Stripe "customer balance" or a simple ledger table     │
│    replaces the LedeWire abstraction. Stripe Connect      │
│    can split revenue with publishers in the future.       │
│                                                           │
│  Monitoring: Sentry + PostHog (or Vercel Analytics)       │
└───────────────────────────────────────────────────────────┘
```

### Proposed Domain Model

```
User
 └─ has many Projects
      └─ has many Sources  (url, title, snippet, license_status, content)
      └─ has one  Outline  (ordered tree of sections → sources)
      └─ has many Reports  (generated markdown, cited sources, cost)
      └─ has many Messages (chat history scoped to project)

Wallet (per user)
 └─ balance_cents, transactions[]

LicenseToken (per source per user)
 └─ protocol, token, cost, expires_at, content_cached
```

### Proposed Application Flow

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐
│  1. CHAT │───▶│ 2. DISCOVER  │───▶│ 3. LICENSE   │───▶│ 4. CURATE  │
│          │    │              │    │              │    │            │
│ User     │    │ Search API   │    │ Check each   │    │ Add to     │
│ types    │    │ returns URLs │    │ URL against  │    │ project    │
│ question │    │ + snippets.  │    │ protocol     │    │ outline.   │
│          │    │ Stream as    │    │ adapters.    │    │ Drag/drop  │
│ Claude   │    │ they arrive. │    │ Show badge + │    │ sections.  │
│ classif- │    │              │    │ price.       │    │            │
│ ies      │    │ AI scores    │    │              │    │            │
│ intent.  │    │ relevance.   │    │ User clicks  │    │            │
│          │    │              │    │ "Unlock" →   │    │            │
│          │    │              │    │ wallet debit  │    │            │
│          │    │              │    │ → full text.  │    │            │
└──────────┘    └──────────────┘    └──────────────┘    └────────────┘
                                                              │
                                    ┌──────────────┐          │
                                    │ 5. GENERATE  │◀─────────┘
                                    │              │
                                    │ LLM reads    │
                                    │ full text of │
                                    │ unlocked     │
                                    │ sources.     │
                                    │              │
                                    │ Produces a   │
                                    │ structured   │
                                    │ report with  │
                                    │ citations.   │
                                    │              │
                                    │ Export as     │
                                    │ Markdown,    │
                                    │ PDF, or      │
                                    │ Google Doc.  │
                                    └──────────────┘
```

### Key Architectural Recommendations

#### 1. Streaming-first AI responses

The current app waits for a full Claude response before showing it to the user. In a rebuild, every AI endpoint should use **Server-Sent Events (SSE)** to stream tokens in real time. The Vercel AI SDK (`useChat`) handles this on the frontend with zero boilerplate.

#### 2. Background job queue for heavy work

Source discovery, scraping, licensing checks, and report generation should all run in **background jobs** (BullMQ/Redis or Celery). The API immediately returns a job ID; the frontend polls or subscribes via WebSocket. This keeps the HTTP layer fast and resilient to timeouts.

```
POST /api/research → 202 { jobId: "abc" }
GET  /api/jobs/abc → { status: "running", sources_found: 4 }
GET  /api/jobs/abc → { status: "complete", data: [...] }
```

#### 3. Licensing protocol adapter pattern

Define a clean interface. New protocols slot in without touching existing code:

```typescript
interface LicenseAdapter {
  name: string;
  detect(url: string): Promise<boolean>;
  getTerms(url: string): Promise<LicenseTerms | null>;
  acquireLicense(url: string, tier: "ai" | "full"): Promise<LicenseToken>;
  fetchContent(url: string, token: LicenseToken): Promise<string>;
}

// Registration
const adapters: LicenseAdapter[] = [
  new CloudflareAdapter(),
  new TollbitAdapter(),
  new RSLAdapter(),
];

// Usage — first match wins
for (const adapter of adapters) {
  if (await adapter.detect(url)) {
    const terms = await adapter.getTerms(url);
    // ...
  }
}
```

#### 4. Purchase state machine

Model purchases explicitly rather than as ad-hoc conditionals:

```
IDLE → CHECKING_WALLET → INSUFFICIENT_FUNDS → FUNDING → FUNDED
                       → SUFFICIENT_FUNDS → CONFIRMING → PROCESSING → COMPLETE
                                                       → FAILED → RETRY
```

This eliminates edge-case bugs around double-charges, interrupted flows, and stale UI states.

#### 5. Monorepo with shared types

Use a monorepo (Turborepo or Nx) with packages:

```
packages/
  shared/        # Zod schemas, TypeScript types, constants
  web/           # Next.js frontend
  api/           # Backend (tRPC or Hono)
  jobs/          # Background workers
  adapters/      # License protocol adapters
```

Changing a schema in `shared/` instantly type-checks every consumer.

#### 6. Simpler payment architecture

The current LedeWire integration adds a layer of indirection (register content as seller → buy as buyer). If you own both sides, simplify:

- **Stripe Customer Balance** as the wallet (top-up via Stripe Checkout, deduct via API).
- A `transactions` ledger table for auditing.
- **Stripe Connect** later when you need to split revenue with publishers.

This removes the seller-registration step entirely for AI-generated reports that the platform itself produces.

#### 7. Export versatility

Don't stop at Markdown download. Offer:

- **PDF** via Puppeteer or `react-pdf`.
- **Google Docs** via Google Docs API.
- **Notion** via Notion API.
- **Copy as HTML** to clipboard (paste into any rich-text editor).

---

### Migration Path (If Iterating Instead of Rewriting)

If a full rewrite isn't practical, the highest-leverage changes to the existing codebase:

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Add SSE streaming to `/api/chat` and `/api/research` | 1–2 days | Huge UX improvement |
| 2 | Replace vanilla JS frontend with Next.js + React | 1–2 weeks | Maintainability, DX, streaming hooks |
| 3 | Add Redis + Celery for background AI jobs | 2–3 days | Reliability, no timeouts |
| 4 | Complete Tollbit content fetch wiring | 1 day | Unlocks real licensed content |
| 5 | Add SQLAlchemy + Alembic (replace raw SQL) | 3–5 days | Safer migrations, async queries |
| 6 | Implement RSL OAuth flow | 2–3 days | Academic content access |

---

## Environment Setup

```bash
# 1. Clone and install
git clone https://github.com/relight14/micropaymentcrawler.git
cd micropaymentcrawler

# 2. Copy environment file and fill in keys
cp .env.example .env
# Required:  TAVILY_API_KEY, ANTHROPIC_API_KEY
# Optional:  TOLLBIT_API_KEY, DATABASE_URL, LEDEWIRE_*

# 3. Install dependencies (uses uv, a fast Python package manager)
pip install uv
uv sync

# 4. Run the server
cd backend
uvicorn main:app --host 0.0.0.0 --port 5000 --reload

# 5. Open in browser
# http://localhost:5000/static/chat.html
```

### Required API Keys

| Key | Purpose | Where to Get It |
|-----|---------|----------------|
| `TAVILY_API_KEY` | Web search | https://tavily.com |
| `ANTHROPIC_API_KEY` | Claude AI | https://console.anthropic.com |
| `TOLLBIT_API_KEY` | Content licensing (optional) | https://hack.tollbit.com |
| `LEDEWIRE_SELLER_API_KEY` | Payment processing (optional) | LedeWire dashboard |

---

## License

See repository license file for details.
