# Full Article Access Implementation Plan

**Date:** January 25, 2026  
**Goal:** Enable readers to access full licensed articles and build research reports with full article content

---

## Executive Summary

Based on the research findings, all three licensing protocols (Tollbit, Cloudflare, RSL) support full article access. This document outlines the implementation plan to deliver two key use cases:

1. **Reader Access:** Allow users to unlock and read full articles through the app
2. **Research Reports:** Summarize multiple licensed articles with key findings

**Current Status:** 80% complete for Tollbit, 60% for RSL, waiting on Cloudflare public API

---

## Implementation Phases

### Phase 1: Tollbit Full Article Access ✅ (Ready to Deploy)

**Priority:** HIGHEST - Production API available, 1,400+ publishers

**What's Been Added:**
- ✅ `TollbitProtocolHandler.fetch_content()` method
- ✅ `ContentLicenseService.fetch_licensed_content()` unified workflow
- ✅ Complete integration: discover → license → fetch

**Technical Implementation:**

```python
# New method in TollbitProtocolHandler
async def fetch_content(self, url: str, license_token: LicenseToken) -> Dict:
    """
    Fetch full article using Tollbit Content API
    
    Endpoint: https://gateway.tollbit.com/dev/v2/content/{url}
    Headers:
      - Tollbit-Token: {minted_token}
      - Tollbit-Accept-Content: text/markdown
    
    Returns:
      {
        "header": "navigation",
        "body": "COMPLETE ARTICLE IN MARKDOWN",
        "footer": "related links",
        "metadata": {"author", "date", "description", "image"}
      }
    """
```

**Integration Points:**

1. **For Reader Access (UI):**
   ```python
   # When user clicks "Read Full Article"
   content = await license_service.fetch_licensed_content(article_url, "ai-include")
   if content:
       article_text = content['content']['body']  # Markdown
       metadata = content['content']['metadata']
       display_article(article_text, metadata)
   ```

2. **For Research Reports (AI):**
   ```python
   # When building research report
   for source in selected_sources:
       if source.requires_license:
           content = await license_service.fetch_licensed_content(source.url)
           if content:
               full_articles.append(content['content']['body'])
   
   # Pass full articles to AI for synthesis
   report = report_generator.generate_report(query, full_articles)
   ```

**Next Steps:**
1. Add API route `/api/articles/fetch` for fetching licensed content
2. Update frontend to display full article modal
3. Track article fetches in budget/ledger
4. Add article caching to avoid duplicate licensing costs

---

### Phase 2: Article Viewer UI (1-2 days)

**Create article reading experience in the app**

**Components Needed:**

1. **Article Fetch Button**
   - Location: Source card in sources panel
   - Label: "Read Full Article" or "Unlock Article"
   - Shows price: "$0.015 to read"
   - Triggers: License + Fetch workflow

2. **Article Modal/Panel**
   - Display markdown-rendered article
   - Show metadata (author, date, publication)
   - Include source attribution
   - Print/save options

3. **Budget Integration**
   - Deduct article cost from user wallet
   - Track licensed articles in ledger
   - Show running total of article costs
   - Prevent duplicate charges (cache fetched articles)

**UI Flow:**

```
┌─────────────────────────────────────┐
│  Source Card: Forbes Article        │
│  --------------------------------    │
│  Summary: 3 key points...           │
│                                     │
│  [Read Full Article - $0.015]      │ ← New button
└─────────────────────────────────────┘
              ↓ (user clicks)
┌─────────────────────────────────────┐
│  Confirm Purchase                   │
│  --------------------------------   │
│  Unlock full Forbes article?        │
│  Cost: $0.015 (via Tollbit)        │
│                                     │
│  [Cancel]  [Unlock & Read]         │
└─────────────────────────────────────┘
              ↓ (user confirms)
┌─────────────────────────────────────┐
│  📰 Full Article                    │
│  --------------------------------   │
│  Title: [Article Title]             │
│  Author: [Name] | Date: [Date]      │
│                                     │
│  [Full markdown-rendered content]   │
│  [All paragraphs visible]           │
│                                     │
│  Source: Forbes (Licensed)          │
│  [Close]  [Print]  [Save]          │
└─────────────────────────────────────┘
```

**API Endpoints:**

```python
# New endpoint in routes/articles.py
@router.post("/fetch")
async def fetch_article(
    url: str,
    authorization: str = Header(None)
):
    """
    Fetch full licensed article content
    
    1. Discover licensing for URL
    2. Check user wallet balance
    3. Request license token (pay)
    4. Fetch full content
    5. Store in user's library
    6. Return article data
    """
    # Validate user token
    access_token = extract_bearer_token(authorization)
    user_id = extract_user_id_from_token(access_token)
    
    # Check if already fetched (cache)
    cached = ledger.get_fetched_article(user_id, url)
    if cached:
        return cached
    
    # Fetch licensed content
    content = await license_service.fetch_licensed_content(url, "ai-include")
    if not content:
        raise HTTPException(404, "Article not available or licensing failed")
    
    # Process payment
    cost = content['cost']
    payment = ledewire.create_purchase(
        access_token=access_token,
        content_id=f"article_{url_hash}",
        price_cents=int(cost * 100)
    )
    
    # Store in user library
    ledger.store_fetched_article(user_id, url, content, payment)
    
    return {
        "success": True,
        "article": content['content'],
        "cost": cost,
        "protocol": content['protocol']
    }
```

---

### Phase 3: Enhanced Research Reports (2-3 days)

**Use full article content in report generation**

**Current Flow:**
```
User query → Search → Get summaries → Generate report from summaries
```

**Enhanced Flow:**
```
User query → Search → License articles → Fetch full text → Generate report from full articles
```

**Implementation:**

```python
# In report_generator.py
async def generate_report_with_full_articles(
    query: str, 
    sources: List[SourceCard],
    license_budget: float = 1.00  # Max to spend on article licenses
) -> Dict:
    """
    Generate research report using full licensed article content
    
    Steps:
    1. Identify which sources require licensing
    2. Check total cost vs budget
    3. Fetch full article content for sources within budget
    4. Use full articles + summaries for comprehensive report
    5. Return report with cost breakdown
    """
    
    # Separate licensed vs free sources
    licensed_sources = [s for s in sources if s.license_protocol]
    free_sources = [s for s in sources if not s.license_protocol]
    
    # Calculate cost for licensed sources
    total_cost = sum(s.license_cost for s in licensed_sources)
    
    if total_cost > license_budget:
        # Prioritize by relevance/authority, fit within budget
        licensed_sources = prioritize_sources(licensed_sources, license_budget)
    
    # Fetch full article content
    full_articles = []
    for source in licensed_sources:
        content = await license_service.fetch_licensed_content(source.url)
        if content:
            full_articles.append({
                'url': source.url,
                'title': source.title,
                'full_text': content['content']['body'],
                'metadata': content['content']['metadata']
            })
    
    # Build enhanced context for AI
    context = build_report_context(
        query=query,
        full_articles=full_articles,
        free_summaries=[s.snippet for s in free_sources]
    )
    
    # Generate report with Claude
    report = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        messages=[{
            "role": "user",
            "content": f"""Generate research report on: {query}
            
            You have access to:
            - {len(full_articles)} FULL LICENSED ARTICLES (complete text)
            - {len(free_sources)} article summaries
            
            Full articles:
            {format_full_articles(full_articles)}
            
            Summaries:
            {format_summaries(free_sources)}
            
            Create comprehensive report with:
            1. Summary synthesizing ALL sources
            2. Key findings with specific quotes from full articles
            3. Conflicts/agreements analysis
            4. Research directions
            """
        }],
        tools=[REPORT_EXTRACTION_TOOL]
    )
    
    return {
        'report_data': extract_report_data(report),
        'licensing_cost': total_cost,
        'full_articles_used': len(full_articles),
        'summaries_used': len(free_sources)
    }
```

**Benefits:**
- More accurate research reports
- Specific quotes and citations
- Deeper analysis from full article text
- Transparent licensing costs

---

### Phase 4: RSL Integration (3-4 days)

**Enable academic paper and research content access**

**What's Needed:**

1. **License Server Integration**
   ```python
   # In RSLProtocolHandler
   async def request_license(self, url: str, license_type: str) -> LicenseToken:
       """
       OAuth 2.0 flow with RSL license server
       
       Steps:
       1. Parse rsl.xml to get license server URL
       2. Initiate OAuth flow
       3. Get authorization code
       4. Exchange for access token
       5. Return token for content access
       """
   ```

2. **Content Fetching**
   ```python
   async def fetch_content(self, url: str, license_token: LicenseToken) -> Dict:
       """
       Fetch content with RSL license token
       
       Format depends on publisher:
       - Academic papers: PDF or HTML
       - News articles: HTML
       - Datasets: JSON/CSV
       """
   ```

**Integration:**
- Same unified API as Tollbit
- Works through `license_service.fetch_licensed_content()`
- Transparent to frontend

---

### Phase 5: Cloudflare Integration (When API Available)

**Waiting on:** Public API release (currently closed beta)

**What We Have:**
- ✅ Domain detection for major publishers
- ✅ Mock pricing structure
- ✅ UI badge display

**What We Need:**
- ⏳ Official API documentation
- ⏳ Authentication mechanism (Ed25519 signatures)
- ⏳ Token minting endpoint
- ⏳ Content fetch protocol

**Implementation Plan:**
- Follow same pattern as Tollbit
- Add `CloudflareProtocolHandler.fetch_content()`
- Integrate with existing unified API
- Zero frontend changes needed (already abstracted)

---

## Use Cases Enabled

### Use Case 1: Individual Article Reading

**User Story:**
> "As a researcher, I want to read full articles from premium publishers through the app, so I can deeply understand the source material without leaving my research flow."

**Flow:**
1. User searches for topic
2. Sources appear with licensing badges
3. User clicks "Read Full Article"
4. System shows price (e.g., "$0.015")
5. User confirms
6. Article fetched and displayed
7. Cost deducted from wallet
8. Article saved to user's library

**Value:**
- One-click article access
- Transparent pricing
- No separate subscriptions needed
- Fair compensation to publishers

---

### Use Case 2: Comprehensive Research Reports

**User Story:**
> "As a researcher, I want to generate reports that synthesize full articles from multiple sources, so I get accurate analysis with specific quotes and citations."

**Flow:**
1. User enters research query
2. System finds relevant sources
3. User selects sources and creates outline
4. System shows licensing cost estimate
5. User confirms budget
6. System licenses and fetches full articles
7. AI generates comprehensive report using full text
8. Report includes specific quotes and deep analysis
9. Cost breakdown shown

**Value:**
- Higher quality reports
- Specific citations and quotes
- Deeper analysis from full context
- Transparent licensing costs
- Legal, ethical content use

---

## Cost Management

### Budget Tracking

```python
# Track article licensing costs
class LicensingBudgetTracker:
    def __init__(self):
        self.session_costs = {}
    
    def estimate_cost(self, sources: List[SourceCard]) -> Dict:
        """Estimate total cost for sources"""
        licensed = [s for s in sources if s.license_protocol]
        return {
            'total': sum(s.license_cost for s in licensed),
            'by_protocol': self.group_by_protocol(licensed),
            'by_source': [(s.title, s.license_cost) for s in licensed]
        }
    
    def can_afford(self, user_balance: float, sources: List[SourceCard]) -> bool:
        """Check if user can afford to license sources"""
        estimate = self.estimate_cost(sources)
        return user_balance >= estimate['total']
    
    def track_license(self, user_id: str, url: str, cost: float):
        """Track individual license purchase"""
        # Store in ledger for analytics and deduplication
```

### Cost Optimization

**Strategies:**
1. **Cache fetched articles** - Don't pay twice for same article
2. **Prioritize sources** - Use most relevant articles within budget
3. **Mix licensed + free** - Combine full articles with summaries
4. **Batch licensing** - Potentially negotiate bulk pricing
5. **User choice** - Let users select which articles to license

---

## Technical Architecture

### Data Flow

```
┌──────────────┐
│   Frontend   │ User clicks "Read Article"
└──────┬───────┘
       │
       ↓
┌──────────────┐
│  API Route   │ /api/articles/fetch
└──────┬───────┘
       │
       ↓
┌──────────────────────────────┐
│ ContentLicenseService        │
│  - discover_licensing()      │ Check protocol
│  - request_license()         │ Get token + pay
│  - fetch_licensed_content()  │ Fetch full article
└──────┬───────────────────────┘
       │
       ↓
┌──────────────────────────────┐
│ Protocol Handler             │
│  (Tollbit/RSL/Cloudflare)    │
│  - check_source()            │
│  - request_license()         │
│  - fetch_content() ← NEW!    │
└──────┬───────────────────────┘
       │
       ↓
┌──────────────┐
│ External API │ Tollbit/RSL/Cloudflare
└──────┬───────┘
       │
       ↓
┌──────────────┐
│ Full Article │ Markdown/HTML content
└──────────────┘
```

### Database Schema

```sql
-- Track fetched articles to prevent duplicate charges
CREATE TABLE fetched_articles (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    article_url TEXT NOT NULL,
    protocol VARCHAR(50),
    cost DECIMAL(10,4),
    content_hash VARCHAR(64),  -- For deduplication
    fetched_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,  -- Token expiry
    content JSONB,  -- Store article data
    
    UNIQUE(user_id, article_url)
);

-- Track licensing costs in research reports
ALTER TABLE research_ledger
ADD COLUMN licensing_cost DECIMAL(10,4) DEFAULT 0.00,
ADD COLUMN licensed_articles_count INT DEFAULT 0,
ADD COLUMN licensed_articles JSONB;  -- Array of {url, protocol, cost}
```

---

## Implementation Timeline

### Week 1: Core Article Fetching
- [x] Add `fetch_content()` to TollbitProtocolHandler ✅
- [x] Add `fetch_licensed_content()` to ContentLicenseService ✅
- [ ] Create `/api/articles/fetch` endpoint
- [ ] Add database schema for fetched articles
- [ ] Implement article caching logic
- [ ] Test Tollbit content fetching end-to-end

### Week 2: UI Implementation
- [ ] Add "Read Full Article" button to source cards
- [ ] Create article viewer modal/panel
- [ ] Implement purchase confirmation dialog
- [ ] Add article cost display
- [ ] Integrate with wallet/budget tracking
- [ ] Test UI flow with real Tollbit articles

### Week 3: Research Reports Enhancement
- [ ] Modify report generator to accept full articles
- [ ] Implement article prioritization logic
- [ ] Add budget management for report generation
- [ ] Update report to show licensed vs free sources
- [ ] Test report quality with full article content

### Week 4: RSL Integration
- [ ] Implement RSL OAuth 2.0 flow
- [ ] Add `fetch_content()` for RSL
- [ ] Test with academic sources
- [ ] Update documentation

---

## Success Metrics

### User Experience
- Time to access full article: < 3 seconds
- Article fetch success rate: > 95%
- User satisfaction with article quality
- Report depth improvement (subjective)

### Cost Efficiency
- Average cost per article: $0.01-$0.05
- Average cost per research report: $0.25-$1.00
- Cache hit rate for articles: > 50%
- Duplicate charge incidents: 0

### Technical Performance
- API response time (article fetch): < 2s
- Token minting success rate: > 98%
- Content parsing accuracy: > 99%

---

## Risk Mitigation

### API Failures
**Risk:** Tollbit/RSL API unavailable
**Mitigation:** 
- Fallback to summaries
- Retry logic with exponential backoff
- User notification of degraded service

### Cost Overruns
**Risk:** User spends more than intended
**Mitigation:**
- Upfront cost display
- Budget limits per session
- Confirmation before each article
- Running total visible

### Content Quality
**Risk:** Fetched content is incomplete/malformed
**Mitigation:**
- Content validation
- Fallback to summary if parsing fails
- User refund for failed fetches

---

## Next Steps (Immediate)

### 1. Deploy Tollbit Content Fetching (This PR)
- ✅ Code changes complete
- [ ] Add API endpoint
- [ ] Test with real Tollbit API key
- [ ] Document usage

### 2. Create Article Viewer UI (Next PR)
- Design article modal
- Implement purchase flow
- Test user experience

### 3. Enhance Report Generation (Following PR)
- Modify report generator
- Add budget management
- Test report quality

---

## Conclusion

**Current State:** 
- Research complete ✅
- Core fetching logic implemented ✅
- Ready for integration ⏳

**Path to Full Implementation:**
1. Deploy article fetching API (1 day)
2. Build article viewer UI (2 days)
3. Enhance research reports (3 days)
4. Add RSL integration (4 days)
5. Monitor Cloudflare for public API

**Estimated Time to Full Production:**
- Basic article reading: 1 week
- Enhanced research reports: 2-3 weeks
- Full multi-protocol support: 4 weeks

**Value Delivered:**
- Legal access to premium content
- Higher quality research outputs
- Transparent cost structure
- Fair publisher compensation
- Seamless user experience

The infrastructure is in place. We're ready to deliver transformative research capabilities powered by licensed full article access.
