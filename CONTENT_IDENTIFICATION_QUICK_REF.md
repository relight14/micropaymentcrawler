# Content Identification - Quick Reference

## The Simple Answer

**Q: How do we identify if content has already been registered?**

**A:** We create a unique "fingerprint" (cache_key) by combining:

```
cache_key = hash(query + source_ids + price)
```

**Example:**
```
Query: "AI trends in 2024"
Sources: [src_001, src_002, src_003]  ← Source IDs, not URLs!
Price: $5.00 (500 cents)

cache_key = SHA256("ai trends in 2024:src_001,src_002,src_003:500")
          = "a1b2c3d4e5f6..."  (32-character hash)
```

If this cache_key exists in our database → **Content already registered!**
If not → **Register new content with LedeWire**

---

## What Are Source IDs?

**Source IDs are NOT URLs!**

They are **unique identifiers** for each article/source, like ISBN numbers for books.

```
Source ID: "src_abc123"
   │
   └─ References a Source Object:
      {
        "id": "src_abc123",
        "url": "https://techcrunch.com/article",
        "title": "The Future of AI",
        "content": "Full article text...",
        "author": "John Smith",
        ...
      }
```

**Why use IDs instead of URLs?**
- URLs can change (redirects, rewrites)
- IDs are stable references
- Faster to process (shorter strings)
- More reliable for comparison

---

## Visual Example

```
┌─────────────────────────────────────────────────┐
│ USER REQUEST                                     │
├─────────────────────────────────────────────────┤
│ "Research AI trends using these 3 articles:"    │
│                                                  │
│ 1. TechCrunch article (src_abc123)              │
│ 2. Wired article      (src_def456)              │
│ 3. The Verge article  (src_xyz789)              │
│                                                  │
│ Price: $5.00                                     │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│ GENERATE CACHE_KEY                              │
├─────────────────────────────────────────────────┤
│ Input: "ai trends in 2024:src_abc123,src_def456,src_xyz789:500"
│                                                  │
│ Hash (SHA256):                                  │
│ "3f7a8c2e9d1b6f4c8e5a7d3f9c1e8b4a..."         │
│                                                  │
│ Truncate to 32 chars:                           │
│ cache_key = "a1b2c3d4e5f6g7h8i9j0k1l2..."      │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│ CHECK DATABASE                                   │
├─────────────────────────────────────────────────┤
│ Query: "Does cache_key exist?"                  │
│                                                  │
│ Found? → Reuse content_id "CONTENT_001" ✅      │
│ Not found? → Register new content ⚙️            │
└─────────────────────────────────────────────────┘
```

---

## What Makes Content Different?

| Scenario | Query | Sources | Price | Result |
|----------|-------|---------|-------|--------|
| Request 1 | "AI trends" | [A, B, C] | $5 | cache_key: abc123... |
| Request 2 | "AI trends" | [A, B, C] | $5 | **SAME** cache_key ✅ |
| Request 3 | "AI trends" | [A, B, D] | $5 | **DIFFERENT** (different sources) |
| Request 4 | "Blockchain" | [A, B, C] | $5 | **DIFFERENT** (different query) |
| Request 5 | "AI trends" | [A, B, C] | $7 | **DIFFERENT** (different price) |

**Key Insight:** Request 1 and Request 2 will share the same `content_id` because they have identical cache_keys!

---

## Why This Approach?

### ✅ Advantages

1. **Deterministic** - Same inputs always produce same cache_key
2. **Fast** - Quick hash computation and database lookup
3. **Reliable** - Not affected by URL changes or formatting
4. **Semantic** - Identifies content by what it IS (query + sources)
5. **Efficient** - Works before generating the content
6. **Shareable** - Multiple users can share same content_id

### ❌ What We Don't Store in cache_key

- Full URLs (just source IDs)
- Article content (just references)
- Metadata (author, date, etc.)
- User information
- Generation timestamp

---

## Common Questions

### Q: What if the article URLs change?

**A:** Doesn't matter! We use source IDs, not URLs. The source ID remains the same even if the URL changes.

### Q: What if someone requests sources in different order?

**A:** We **sort** the source IDs before hashing, so order doesn't matter:
- `[C, A, B]` → sorted to `[A, B, C]`
- `[A, B, C]` → stays as `[A, B, C]`
- Result: **SAME** cache_key ✅

### Q: Can two users share the same content_id?

**A:** **YES!** This is intentional and beneficial:
- User A requests "AI trends" with sources [A, B, C] → content_id "CONTENT_001"
- User B requests "AI trends" with sources [A, B, C] → Reuses "CONTENT_001"
- Both users analyzed the same content, so they share the same content_id

### Q: How long does this mapping last?

**A:** **Forever!** We store the cache_key → content_id mapping permanently (no expiration). This ensures "already purchased" detection works across all time periods.

---

## Security

### Is the cache_key secure?

**Yes:**
- ✅ One-way hash (cannot reverse to get original inputs)
- ✅ Collision-resistant (different inputs = different hashes)
- ✅ Doesn't reveal sensitive information
- ✅ Attackers can't forge cache_keys

### What if someone sees the cache_key?

**Not a problem:**
- They can't reverse it to get the query or sources
- They still can't access the content without purchasing
- LedeWire controls content access based on purchase records

---

## Code Reference

```python
# From: backend/data/ledger_repository.py

def generate_content_cache_key(self, query: str, source_ids: List[str], price_cents: int) -> str:
    """
    Generate a consistent cache key for content identification.
    
    Args:
        query: Research query (e.g., "AI trends in 2024")
        source_ids: List of source IDs (e.g., ["src_001", "src_002"])
        price_cents: Price in cents (e.g., 500 for $5.00)
    
    Returns:
        32-character hash string
    """
    import hashlib
    
    # Normalize query
    query_normalized = query.strip().lower()
    
    # Sort source IDs for consistency
    source_ids_sorted = sorted(source_ids)
    source_ids_str = ",".join(source_ids_sorted)
    
    # Combine all components
    key_input = f"{query_normalized}:{source_ids_str}:{price_cents}"
    
    # Hash and truncate
    hash_full = hashlib.sha256(key_input.encode()).hexdigest()
    return hash_full[:32]
```

---

## Related Documentation

For more detailed information, see:

1. **CONTENT_IDENTIFICATION_FAQ.md** - Comprehensive Q&A (13KB)
2. **CONTENT_IDENTIFICATION_ARCHITECTURE.md** - System diagrams (12KB)
3. **CONTENT_ID_REUSE_SOLUTION.md** - Implementation details (9KB)
4. **CONTENT_ID_REUSE_VISUAL_GUIDE.md** - Visual scenarios (9KB)

---

## TL;DR

**How we identify content:**
```
cache_key = hash(query + source_ids + price)
```

**What are source IDs:**
- Unique identifiers for articles (NOT URLs)
- Like ISBNs for books
- Stable references that don't change

**Result:**
- Same content = Same cache_key = Same content_id
- "Already purchased" detection works forever
- No duplicate registrations
- Multiple users can share same content
