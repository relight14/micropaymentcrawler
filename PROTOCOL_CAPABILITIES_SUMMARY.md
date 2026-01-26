# Quick Summary: Licensing Protocol Capabilities

**Date:** January 25, 2026

---

## The Big Question

**Can we access full articles/papers, or just crawling traffic?**

## The Answer

✅ **YES - All three protocols support full article and paper access.**

Not just crawling metadata - you get the complete article content.

---

## Protocol Breakdown

### 🌩️ Cloudflare Pay-per-Crawl

**Full Article Access:** ✅ YES

- **How it works:** Pay per article → get complete HTML/text
- **Status:** Closed beta (not publicly available yet)
- **Content:** Premium news (WSJ, NYT, Economist, Reuters, FT)
- **Pricing:** ~$0.07 per article (AI), ~$0.25 (human reader)
- **Format:** Full HTML page content
- **Our integration:** Detection ready, waiting for public API

**Key Point:** It's called "Pay-per-Crawl" but you get the ENTIRE article, not just metadata. The name reflects the per-page pricing model.

---

### ⚡ Tollbit

**Full Article Access:** ✅ YES (Production Ready!)

- **How it works:** Mint token → fetch from Content API → receive full article
- **Status:** Production, 1,400+ publishers
- **Content:** Forbes, TIME, AP News, Bloomberg, Washington Post, etc.
- **Pricing:** $0.01-$0.05 (AI), $0.02-$0.15 (full use)
- **Format:** Markdown or HTML (your choice)
- **Our integration:** Rate discovery + token minting ✅, Content API ⏳

**Content API Response Includes:**
```json
{
  "header": "page navigation, breadcrumbs",
  "body": "COMPLETE ARTICLE CONTENT IN MARKDOWN/HTML",
  "footer": "related links, terms",
  "metadata": "author, date, description, images"
}
```

**Key Point:** This is the most mature API - ready to fetch full articles right now if we implement the Content API endpoint.

---

### 🔒 RSL (Really Simple Licensing)

**Full Article Access:** ✅ YES (with flexibility)

- **How it works:** Check rsl.xml → request license token → fetch content
- **Status:** Open standard, 1,500+ adopters
- **Content:** Academic papers, research, news (AP, Guardian, Vox, USA Today)
- **Pricing:** Varies ($0.05-$0.25 typical), publisher-defined
- **Format:** Publisher-dependent
- **Our integration:** XML discovery + parsing ✅, License server ⏳

**Unique Feature:** Can specify different access levels
- Allow free snippets but charge for full articles
- Or allow full article access with attribution
- Or require payment for any access

**Key Point:** Most flexible system - supports multiple licensing models and can differentiate access levels. Great for academic content.

---

## What "Crawling" Actually Means

### Traditional Web Crawling (Pre-AI):
- Bots index pages for search
- Users click search results → visit publisher site
- Publisher gets traffic, ads, subscriptions
- **Model:** Crawl for indexing → drive human traffic

### Modern AI Crawling (What These Protocols Address):
- AI bots read ENTIRE article
- AI summarizes it elsewhere
- Users never visit publisher site
- Publishers lose traffic and revenue
- **Problem:** Crawl for content → no traffic back

### These Protocols Fix This:
- AI bots must pay for full article access
- Publishers compensated directly
- **New Model:** Pay for full content → licensed access

**Why it's confusing:** It's called "crawling" but the AI actually gets the full article to read and use.

---

## Practical Example: Getting a WSJ Article

### Cloudflare (once public):
```
1. Check WSJ article → 402 Payment Required
2. Authenticate with Cloudflare → pay $0.07
3. Receive signed token
4. Fetch article with token → get full WSJ article HTML
5. AI can now read, summarize, use the content
```

### Tollbit (available now):
```
1. Check Forbes article → Tollbit API shows $0.015 price
2. Mint token → pay $0.015
3. Call Content API with token
4. Receive: {body: "full article in markdown", metadata: {...}}
5. Display article in your app
```

### RSL (if publisher implements):
```
1. Check MIT research paper → rsl.xml shows $0.05 for ai-include
2. Request license from license server → OAuth flow
3. Receive access token
4. Fetch paper with token → get full PDF or HTML
5. Can use in research, with attribution as required
```

---

## Current Implementation Status

| Protocol | Detection | Pricing | Token Minting | Content Fetching |
|----------|-----------|---------|---------------|------------------|
| Cloudflare | ✅ | ✅ (mock) | ⏳ (waiting for API) | ⏳ |
| Tollbit | ✅ | ✅ (real) | ✅ (real) | ⏳ (need to add) |
| RSL | ✅ | ✅ (from XML) | ⏳ (need to add) | ⏳ |

**Closest to full integration:** Tollbit - just need to add the Content API call

---

## Next Steps for Full Article Access

### 1. Complete Tollbit Integration (Easiest)
```python
# We already have the token, just need to fetch:
async def fetch_article(url: str, token: str):
    response = await client.get(
        f"https://gateway.tollbit.com/dev/v2/content/{url}",
        headers={
            "Tollbit-Token": token,
            "Tollbit-Accept-Content": "text/markdown"
        }
    )
    return response.json()  # Full article!
```

### 2. Implement RSL License Server (Medium)
- Parse `server` attribute from rsl.xml
- Implement OAuth 2.0 flow
- Request and store tokens
- Fetch content with authorization

### 3. Wait for Cloudflare Public API (Later)
- Monitor beta progress
- Implement when documentation available
- Similar flow to Tollbit

---

## Cost Estimates

**For 100 full articles:**

| Use Case | Cost Range |
|----------|------------|
| AI summaries (cheapest licenses) | $1 - $5 |
| Mixed content (news + research) | $5 - $10 |
| Premium full licenses | $15 - $25 |

**Typical single article:**
- News article (AI use): $0.01 - $0.07
- Research paper: $0.05 - $0.15
- Premium article (full rights): $0.15 - $0.25

---

## Bottom Line

✅ **Full article access is available through all three protocols**

✅ **Not limited to crawling metadata**

✅ **Structured content delivery (HTML/Markdown)**

✅ **Legal, transparent, compensated access**

⏳ **We have most of the infrastructure - just need to implement the final fetch step**

🎯 **Recommendation:** Start with Tollbit Content API - it's production-ready and well-documented

---

**For detailed technical documentation, see:** `LICENSING_PROTOCOL_CAPABILITIES_RESEARCH.md`
