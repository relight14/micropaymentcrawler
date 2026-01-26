# Licensing Protocol Capabilities Research

**Date:** January 25, 2026  
**Purpose:** Fact-finding mission to understand data access capabilities of integrated licensing protocols

---

## Executive Summary

This document details the capabilities of three licensing protocols integrated into the micropayment crawler application: **Cloudflare Pay-per-Crawl**, **Tollbit**, and **RSL (Really Simple Licensing)**. 

**Key Finding:** All three protocols support **full article/paper access**, not just crawling traffic. Each protocol provides different mechanisms for content licensing, authentication, and access control.

---

## 1. Cloudflare Pay-per-Crawl

### Status & Documentation
- **Launch Date:** July 2025 (Private Beta)
- **Official Documentation:** https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/
- **Blog Announcement:** https://blog.cloudflare.com/introducing-pay-per-crawl/
- **Current Status:** In closed beta with major publishers (Condé Nast, The Atlantic, Time, Fortune)

### Full Article Access Capabilities

**YES - Full article access is supported:**

1. **Access Model:**
   - AI crawlers that pay the per-crawl fee receive **full article content**
   - Uses HTTP 402 (Payment Required) status code to gate content
   - Authenticated requests with valid tokens get complete page/article access
   - No content limitation - full HTML/text is returned

2. **Technical Implementation:**
   - **Authentication:** Ed25519 cryptographic signatures via Web Bot Auth Protocol
   - **Payment Required:** Unauthenticated requests receive 402 status with pricing info
   - **Token-based Access:** After payment, crawler receives signed token for content retrieval
   - **Enforcement:** Cannot be bypassed with proxies - enforced at HTTP layer

3. **Content Types:**
   - Full news articles (WSJ, NYT, Economist, Reuters, Financial Times)
   - Long-form journalism (The Atlantic, Wired)
   - Financial reports and analysis (Fortune, FT)
   - Any web page protected by Cloudflare

4. **Access Granularity:**
   - **Per-page/per-crawl pricing** - flat rate per article accessed
   - Single access = full article content
   - No snippet or summary-only access - it's full article or nothing

### Crawling vs. Article Access

**Distinction:**
- **Traditional crawling** (pre-AI era): Bots would crawl to index, but users had to visit the publisher's site
- **Cloudflare model**: AI crawlers read the **entire article** and can summarize elsewhere, eliminating referral traffic
- **Problem solved**: Publishers get compensated for full article access since AI eliminates the need for users to visit their site
- **Traffic impact**: For every 1,200-39,000 AI crawls, only 1 user visits the original site (vs 6:1 for traditional search)

### Pricing Structure
- **Per-crawl fee:** Set by publisher (typically $0.05-$0.25 per article)
- **Intent-based:** Different pricing for training vs. inference vs. search
- **Flat rate:** Same price regardless of content value (a noted limitation)

### Current Limitations
- **Closed Beta:** Not yet publicly available - requires publisher partnership
- **Flat pricing model:** Cannot vary price by article value/length
- **Publisher-controlled:** Publishers must opt-in and configure via Cloudflare dashboard

### Integration Status in Our App
- ✅ Domain-based detection for known Cloudflare publishers
- ✅ HTTP 402 detection
- ✅ Header detection (`cf-license-available`, `cloudflare-licensing`)
- ✅ Mock pricing ($0.07 AI access, $0.25 human reader)
- ⏳ **Waiting for:** Public API access for real implementation

---

## 2. Tollbit

### Status & Documentation
- **Official Website:** https://www.tollbit.com/
- **API Documentation:** https://docs.tollbit.com/
- **Current Status:** Production-ready with 1,400+ publisher partners
- **API Base:** https://api.tollbit.com

### Full Article Access Capabilities

**YES - Full article/paper access is fully supported and documented:**

1. **Content API:**
   ```
   GET https://gateway.tollbit.com/dev/v2/content/<content_path>
   ```
   
   **Headers Required:**
   - `Tollbit-Token`: One-time access token (obtained via minting)
   - `User-Agent`: Your registered Agent ID
   - `Tollbit-Accept-Content`: `text/html` or `text/markdown` (defaults to markdown)

2. **Response Structure - Full Article Components:**
   - **`header`**: Page navigation, breadcrumbs, auxiliary info
   - **`body`**: **Complete article content in markdown or HTML**
   - **`footer`**: Additional links, terms, related articles
   - **`metadata`**: Author, description, image, publish date, timestamps
   - **`rate`**: Pricing and licensing information

3. **Content Format Options:**
   - **HTML:** Full original markup
   - **Markdown:** Cleaned, structured text (default)
   - Includes all text, images references, formatting

4. **License Types:**
   - **`ON_DEMAND_LICENSE`**: AI scraping/inference access (read full article)
   - **`ON_DEMAND_FULL_USE_LICENSE`**: Full human reader access (republishing rights)
   - Both provide **complete article content**, just different usage rights

### Technical Implementation

1. **Rate Discovery API:**
   ```
   GET https://api.tollbit.com/dev/v1/rate/{url}
   Headers:
     Authorization: Bearer {TOLLBIT_API_KEY}
     X-Tollbit-AgentId: {TOLLBIT_AGENT_ID}
   ```
   
   **Returns:**
   - Pricing for both license types
   - License path information
   - Currency (USD)
   - Example: Forbes articles ~$0.015 (AI), ~$0.036 (human)

2. **Token Minting API:**
   ```
   POST https://api.tollbit.com/v1/mint
   Body: {
     "agent": "ResearchTool-1.0",
     "target": "https://forbes.com/article",
     "orgCuid": "{TOLLBIT_ORG_CUID}",
     "agentId": "{TOLLBIT_AGENT_ID}",
     "maxPriceMicros": "120000",
     "licenseType": "ON_DEMAND_FULL_USE_LICENSE"
   }
   ```
   
   **Returns:**
   - Access token valid for 6 hours
   - Actual cost charged
   - Token for Content API authentication

3. **Content Retrieval:**
   - Use minted token in Content API
   - Receive full article in chosen format
   - Includes all metadata and licensing info

### Publishers & Content Types

**1,400+ publishers including:**
- **News:** Forbes, TIME, AP News, USA Today, Newsweek, HuffPost, Washington Post, Bloomberg, Business Insider
- **Analysis:** The Information
- **Breadth:** Major media outlets, news agencies, business publications

**Content accessible:**
- News articles (full text)
- Investigative journalism
- Business analysis
- Breaking news
- Opinion pieces
- Any licensed content from partner publishers

### Pricing Model
- **Microdollar system:** 1,000,000 microdollars = $1 USD
- **AI License:** ~$0.01-$0.05 per article
- **Full Use License:** ~$0.02-$0.15 per article
- **Token validity:** 6 hours

### Integration Status in Our App
- ✅ Real API integration implemented
- ✅ Rate discovery working (requires `TOLLBIT_API_KEY`)
- ✅ Token minting implemented
- ✅ Retry logic with exponential backoff
- ✅ Pricing fallback (estimate missing prices)
- ⚠️ **Requires:** API credentials to be configured (TOLLBIT_API_KEY, TOLLBIT_ORG_CUID)
- ⏳ **Missing:** Content API integration (fetching with token)

---

## 3. RSL (Really Simple Licensing)

### Status & Documentation
- **Official Specification:** https://rslstandard.org/rsl (Version 1.0)
- **Official Website:** https://rslstandard.org/
- **Current Status:** Production standard (launched late 2025, 1,500+ adopters)
- **Standard Type:** Open XML-based specification

### Full Article Access Capabilities

**YES - Full article/paper access with granular control:**

1. **Access Control Mechanisms:**
   - **Machine-readable licensing:** XML format specifying exact access permissions
   - **Granular permissions:** Can specify different rules for full articles vs. snippets
   - **Token-based access:** OAuth 2.0 integration via Open Licensing Protocol (OLP)
   - **Crawler Authorization Protocol (CAP):** Automated enforcement at CDN/edge level

2. **Content Access Models:**
   
   **a) Full Article Access:**
   - Publishers can require payment/licensing for full article downloads
   - Gated access enforced through token validation
   - Support for per-article, per-crawl, or subscription pricing
   
   **b) Snippet/Summary Access:**
   - Can allow free snippet access while gating full articles
   - Different pricing tiers for different access levels
   
   **c) Protected Content:**
   - Encrypted Media Standard (EMS) for premium content
   - Decryption keys only provided to licensed users/bots
   - Suitable for: academic papers, book chapters, proprietary datasets

3. **Technical Implementation:**

   **Discovery Methods:**
   - `/rsl.xml` (root of domain)
   - `/.well-known/rsl.xml` (standard well-known URI)
   - `/robots/rsl.xml` (alongside robots.txt)
   - HTTP response headers
   - HTML metadata tags
   - RSS/Atom feed links

   **XML Format Example:**
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

4. **License Enforcement:**
   - **Automated enforcement:** Not honor-based like robots.txt
   - **Token validation:** Crawlers must present valid tokens
   - **Real-time gating:** Enforced at CDN/edge, not just policy
   - **OAuth 2.0:** Standard authentication flows

### Use Cases & Content Types

**Academic Content:**
- Research papers from institutions (.edu domains)
- Journal articles
- Thesis and dissertations
- Datasets

**News & Media:**
- Associated Press, Vox Media, USA Today, BuzzFeed, The Guardian, Slate
- Full article text
- Multimedia content
- Archives

**Community Content:**
- Reddit posts
- Yahoo content
- Medium articles
- Quora answers
- Stack Overflow technical content

**Infrastructure Support:**
- Cloudflare, Akamai, Fastly (CDN support for enforcement)

### Permission Types in RSL

1. **`ai-include`**: Allow AI to read and summarize (full article access for inference)
2. **`ai-train`**: Allow use in training data (full article access for model training)
3. **`search`**: Allow search indexing (full article for search engines)
4. **`all`**: Allow all uses
5. **Custom combinations:** Publishers can mix/match

### Pricing Models Supported

1. **Per-crawl:** Pay per access
2. **Per-article:** Pay per content piece
3. **Per-inference:** Pay each time AI uses the content
4. **Subscription:** Ongoing access
5. **Attribution-only:** Free with credit
6. **Free:** Open access

### RSL Collective

For smaller publishers:
- **Collective bargaining:** Pool negotiation power
- **Rights management:** Like ASCAP for music
- **Standard licenses:** Pre-negotiated terms
- **Royalty distribution:** Automated payment splitting

### Integration Status in Our App
- ✅ XML discovery at standard paths
- ✅ XML parsing with proper namespace handling
- ✅ Permission detection (ai-include, ai-train, search)
- ✅ Multiple payment type support (inference, purchase, attribution)
- ✅ Publisher extraction
- ⏳ **Missing:** License server integration for token-based access
- ⏳ **Missing:** Real license requests to RSL servers

---

## Comparison Summary

| Feature | Cloudflare | Tollbit | RSL |
|---------|-----------|---------|-----|
| **Full Article Access** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Snippet/Summary Only** | ❌ No | ❌ No | ✅ Optional |
| **Public API** | ❌ Closed Beta | ✅ Production | ✅ Open Standard |
| **Authentication** | Ed25519 Signatures | Bearer Token + Agent ID | OAuth 2.0 / Token |
| **Content Format** | HTML | HTML or Markdown | Publisher-dependent |
| **Pricing Model** | Per-crawl (flat) | Per-license (two tiers) | Flexible (multiple models) |
| **Adoption** | Major news (closed) | 1,400+ publishers | 1,500+ adopters |
| **Enforcement** | HTTP layer | API gateway | CDN/Edge + Token |
| **Use Cases** | Premium news | News + AI marketplace | Academic + Open content |
| **Integration Difficulty** | ⏳ Waiting for API | ✅ API ready | ✅ Standard ready |

---

## Key Findings

### 1. All Three Protocols Support Full Article Access

**NOT just crawling traffic:**
- All protocols provide complete article/paper content
- Not limited to metadata, snippets, or summaries
- Authentication required, but full content is delivered upon licensing

### 2. Different Access Philosophies

**Cloudflare:** 
- Binary access model (pay per page, get full article)
- Best for: Premium news publishers with valuable individual articles
- Current limitation: Closed beta

**Tollbit:**
- Marketplace model with clear license tiers
- Content API provides structured full articles (markdown/HTML)
- Best for: AI applications needing licensed content at scale
- **Production ready** with comprehensive API

**RSL:**
- Most flexible - supports multiple access levels
- Can differentiate snippet vs. full article pricing
- Best for: Academic institutions, research content, diverse publishers
- **Open standard** - anyone can implement

### 3. Current Implementation Status

**What We Have:**
- Protocol detection for all three systems
- Mock pricing for Cloudflare and RSL
- Real Tollbit API integration (rate discovery + token minting)
- Badge display showing licensing requirements

**What We're Missing:**
- **Cloudflare:** Public API access (waiting on beta completion)
- **Tollbit:** Content API integration (fetching articles with tokens)
- **RSL:** License server integration (token acquisition + validation)

### 4. Full Article Access Workflow

**General Pattern:**
1. **Discover** licensing via protocol-specific method (headers, XML, API)
2. **Check pricing** for desired license type
3. **Authenticate** and pay (or present credentials)
4. **Receive token** with limited validity period
5. **Fetch content** with token in headers
6. **Receive full article** in structured format

**All three protocols follow this pattern**, with variations in authentication and API specifics.

---

## Recommendations

### For Immediate Development

1. **Tollbit Content API Integration** (Highest Priority)
   - Most mature, production-ready API
   - Well-documented Content API endpoint
   - Can access full articles from 1,400+ publishers
   - Just need to implement: token → content fetching

2. **RSL License Server Integration** (Medium Priority)
   - Open standard, good for academic content
   - Need to implement OAuth 2.0 flows
   - Support for license server discovery and token requests
   - Large ecosystem of potential sources

3. **Cloudflare Integration** (Lower Priority - Wait for Beta)
   - Keep monitoring beta progress
   - Continue using domain-based detection
   - Implement once public API is available

### For Full Article Access

**To actually retrieve and display articles:**

1. **Implement Tollbit Content Fetching:**
   ```python
   async def fetch_tollbit_article(url: str, token: str) -> Dict:
       response = await client.get(
           f"https://gateway.tollbit.com/dev/v2/content/{url}",
           headers={
               "Tollbit-Token": token,
               "User-Agent": AGENT_ID,
               "Tollbit-Accept-Content": "text/markdown"
           }
       )
       return response.json()  # Contains header, body, footer, metadata
   ```

2. **Implement RSL License Requests:**
   ```python
   async def request_rsl_license(license_server: str, url: str) -> str:
       # OAuth 2.0 flow with license server
       # Return access token
   ```

3. **Add Article Storage/Display:**
   - Store licensed articles in database
   - Track license expiry and usage
   - Display full article content in UI
   - Maintain attribution requirements

### Budget Considerations

**Typical costs for full article access:**
- Tollbit AI License: $0.01-$0.05 per article
- Tollbit Full License: $0.02-$0.15 per article
- Cloudflare: ~$0.07 per article (estimated)
- RSL: Varies by publisher ($0.05-$0.25 typical)

**For 100 articles:**
- Low end: $1-$5 (Tollbit AI licenses)
- High end: $15-$25 (premium full licenses)

---

## Conclusion

**YES - All three protocols support full article and paper access.**

The licensing systems are **NOT** limited to crawling traffic. They are designed to provide authenticated, paid access to complete article content for AI applications, with different models for enforcement and pricing.

**Key Takeaway:** These protocols solve the problem of AI companies accessing full content without compensating publishers. All three provide mechanisms for:
- Full article retrieval
- Structured content delivery (HTML/Markdown)
- Transparent pricing
- Legal, licensed access

**Current State:** Our application has the foundation (detection, pricing display) but needs the final step of actual content retrieval using the tokens/licenses we can already obtain from Tollbit (and will be able to obtain from Cloudflare/RSL once their APIs are accessible).

---

## Additional Resources

### Cloudflare
- Developer Documentation: https://developers.cloudflare.com/ai-crawl-control/
- Launch Blog: https://blog.cloudflare.com/introducing-pay-per-crawl/
- Technical Analysis: https://measuremindsgroup.com/cloudflare-pay-per-crawl

### Tollbit
- API Documentation: https://docs.tollbit.com/
- Content API Docs: https://docs.tollbit.com/content/
- Platform Overview: https://www.tollbit.com/

### RSL
- Official Specification: https://rslstandard.org/rsl
- Homepage: https://rslstandard.org/
- Integration Guides: https://www.fastly.com/blog/control-and-monetize-your-content-with-the-rsl-standard
- Overview: https://www.theregister.com/2025/09/11/rsl_content_grabbing_ai_digital_licensing/

---

**Research Date:** January 25, 2026  
**Researcher:** GitHub Copilot Coding Agent  
**Purpose:** Fact-finding mission for licensing protocol capabilities
