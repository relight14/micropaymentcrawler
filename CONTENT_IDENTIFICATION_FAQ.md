# Content Identification FAQ

## How are we identifying if content has already been registered?

### The Short Answer

We use a **deterministic hash** (cache_key) based on three components:
1. **Research query** (the question/topic)
2. **Source IDs** (list of article identifiers used)
3. **Price** (in cents)

Same query + same sources + same price = Same content_id (always!)

---

## Detailed Explanation

### What is a Source ID?

A **source ID** is a unique identifier for each article/webpage that's analyzed in a research report.

**Examples:**
- `src_abc123` → An article from TechCrunch
- `src_def456` → An article from Wired
- `src_xyz789` → An article from The Verge

Each source has:
- **ID**: Unique identifier (generated when source is discovered)
- **URL**: The actual webpage URL (e.g., `https://techcrunch.com/article-title`)
- **Title**: Article title
- **Content**: The article text
- **Metadata**: Publication date, author, etc.

### How Does Content Identification Work?

When someone requests a research report, we:

1. **Extract the sources** from their outline/request
   ```
   Query: "AI trends in 2024"
   Sources: [
     { id: "src_001", url: "https://techcrunch.com/ai-article" },
     { id: "src_002", url: "https://wired.com/ai-news" },
     { id: "src_003", url: "https://verge.com/ai-story" }
   ]
   Price: $5.00 (500 cents)
   ```

2. **Generate a cache_key** (content fingerprint)
   ```python
   # Step 1: Normalize the query
   query_normalized = "ai trends in 2024"  # lowercase, trimmed
   
   # Step 2: Sort source IDs for consistency
   source_ids_sorted = "src_001,src_002,src_003"
   
   # Step 3: Combine with price
   key_input = "ai trends in 2024:src_001,src_002,src_003:500"
   
   # Step 4: Hash it
   cache_key = SHA256(key_input)[:32]
             = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
   ```

3. **Check if this cache_key was seen before**
   - Look in `content_id_cache` table
   - Look in `purchases` table
   - If found → Reuse existing content_id
   - If not found → Register new content

### What Gets Stored?

We store the **relationship** between cache_key and content_id:

**content_id_cache table:**
```
┌────────────────────┬──────────────┬────────┐
│ cache_key          │ content_id   │ price  │
├────────────────────┼──────────────┼────────┤
│ a1b2c3d4e5f6...    │ CONTENT_001  │ 500    │
│ x9y8z7w6v5u4...    │ CONTENT_002  │ 500    │
└────────────────────┴──────────────┴────────┘
```

**purchases table:**
```
┌────┬───────────────┬─────────┬──────────────┐
│ id │ query         │ user_id │ content_id   │
├────┼───────────────┼─────────┼──────────────┤
│ 1  │ AI trends...  │ user_A  │ CONTENT_001  │
│ 2  │ Blockchain... │ user_A  │ CONTENT_002  │
└────┴───────────────┴─────────┴──────────────┘
```

**What we DON'T store:**
- ❌ Full article URLs in the cache_key
- ❌ Full article content in the cache_key
- ❌ Article metadata in the cache_key

**What we DO store:**
- ✅ Source IDs (references to articles)
- ✅ Query text (normalized)
- ✅ Price
- ✅ The mapping: cache_key → content_id

---

## Common Questions

### Q: Are we storing the URL of the page where the content lives?

**A:** No, we don't store URLs directly in the cache_key. We store **source IDs** which are identifiers that reference the articles.

The full source information (including URLs) is stored separately in the research packet and outline structure. The cache_key only contains the source IDs, which act as references.

**Think of it like:**
- Source ID = ISBN number for a book
- URL = Full book details (title, author, publisher)
- Cache key = List of ISBN numbers + query + price

### Q: Are we using metadata from the content?

**A:** No, the cache_key doesn't include article metadata (publication date, author, etc.). It only includes:
1. The research query
2. The list of source IDs
3. The price

This is intentional - we want to identify content based on **what was analyzed** (which sources) not **when or by whom** it was written.

### Q: What if someone uses the same sources but in a different order?

**A:** Order doesn't matter! We **sort** the source IDs before hashing, so:

```
Request 1: sources = ["src_003", "src_001", "src_002"]
Request 2: sources = ["src_001", "src_002", "src_003"]

After sorting: both become "src_001,src_002,src_003"
→ SAME cache_key ✅
```

### Q: What if the price changes?

**A:** Different price = different cache_key = different content registration.

```
Request 1: query="AI trends", sources=[...], price=500
Request 2: query="AI trends", sources=[...], price=700

→ DIFFERENT cache_key
→ Different content_id
→ Correct: price is part of the content definition
```

### Q: What if someone adds one more source?

**A:** Different sources = different content = different cache_key.

```
Request 1: query="AI trends", sources=["src_001", "src_002"]
Request 2: query="AI trends", sources=["src_001", "src_002", "src_003"]

→ DIFFERENT cache_key (different source list)
→ Different content_id
→ Correct: different sources = different report
```

### Q: Can two users share the same content_id?

**A:** YES! This is a key feature.

```
User A (Day 1): Requests "AI trends" with sources [A, B, C]
→ Registers content_id "CONTENT_001"
→ Purchases "CONTENT_001"

User B (Day 5): Requests "AI trends" with sources [A, B, C]
→ Same cache_key!
→ Reuses content_id "CONTENT_001"
→ Purchases "CONTENT_001"

User A (Day 10): Requests same report again
→ Same cache_key!
→ Finds they already own "CONTENT_001"
→ "Already purchased" ✅
```

Both users purchased the same content (identified by the same cache_key).

---

## Visual Examples

### Example 1: Exact Match

```
┌─────────────────────────────────────────────────────┐
│ Request 1 (Monday)                                   │
├─────────────────────────────────────────────────────┤
│ Query: "AI trends in 2024"                          │
│ Sources: [src_001, src_002, src_003]               │
│ Price: $5.00                                        │
│                                                      │
│ cache_key = hash("ai trends in 2024:src_001,src_002,src_003:500")
│           = "a1b2c3..."                             │
│                                                      │
│ Result: Register content_id "CONTENT_001"           │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Request 2 (Friday) - SAME USER                      │
├─────────────────────────────────────────────────────┤
│ Query: "AI trends in 2024"                          │
│ Sources: [src_001, src_002, src_003]               │
│ Price: $5.00                                        │
│                                                      │
│ cache_key = hash("ai trends in 2024:src_001,src_002,src_003:500")
│           = "a1b2c3..." [SAME!]                     │
│                                                      │
│ Result: Reuse "CONTENT_001" → Already purchased ✅  │
└─────────────────────────────────────────────────────┘
```

### Example 2: Different Query

```
┌─────────────────────────────────────────────────────┐
│ Request 1                                            │
├─────────────────────────────────────────────────────┤
│ Query: "AI trends in 2024"                          │
│ Sources: [src_001, src_002, src_003]               │
│ Price: $5.00                                        │
│                                                      │
│ cache_key = "a1b2c3..."                             │
│ Result: content_id "CONTENT_001"                    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Request 2                                            │
├─────────────────────────────────────────────────────┤
│ Query: "Blockchain trends in 2024" [DIFFERENT!]     │
│ Sources: [src_001, src_002, src_003] [SAME]        │
│ Price: $5.00                                        │
│                                                      │
│ cache_key = "x9y8z7..." [DIFFERENT!]                │
│ Result: content_id "CONTENT_002" (new)              │
└─────────────────────────────────────────────────────┘
```

### Example 3: Different Sources

```
┌─────────────────────────────────────────────────────┐
│ Request 1                                            │
├─────────────────────────────────────────────────────┤
│ Query: "AI trends in 2024"                          │
│ Sources: [src_001, src_002, src_003]               │
│ Price: $5.00                                        │
│                                                      │
│ cache_key = "a1b2c3..."                             │
│ Result: content_id "CONTENT_001"                    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Request 2                                            │
├─────────────────────────────────────────────────────┤
│ Query: "AI trends in 2024" [SAME]                   │
│ Sources: [src_004, src_005, src_006] [DIFFERENT!]  │
│ Price: $5.00                                        │
│                                                      │
│ cache_key = "p9o8i7..." [DIFFERENT!]                │
│ Result: content_id "CONTENT_003" (new)              │
└─────────────────────────────────────────────────────┘
```

---

## Technical Details

### Cache Key Generation Algorithm

```python
def generate_content_cache_key(query: str, source_ids: List[str], price_cents: int) -> str:
    """
    1. Normalize query: strip whitespace, lowercase
    2. Sort source IDs: consistent ordering
    3. Combine: "query:source_ids:price"
    4. Hash with SHA256
    5. Take first 32 characters
    """
    import hashlib
    
    # Normalize
    query_normalized = query.strip().lower()
    
    # Sort for consistency
    source_ids_sorted = sorted(source_ids)
    source_ids_str = ",".join(source_ids_sorted)
    
    # Combine
    key_input = f"{query_normalized}:{source_ids_str}:{price_cents}"
    
    # Hash
    hash_full = hashlib.sha256(key_input.encode()).hexdigest()
    cache_key = hash_full[:32]  # First 32 chars
    
    return cache_key
```

### Why SHA256?

- **Deterministic**: Same input always produces same output
- **One-way**: Can't reverse engineer the inputs from the hash
- **Collision-resistant**: Extremely unlikely two different inputs produce same hash
- **Fast**: Quick computation
- **Standard**: Widely used and trusted

### Why 32 characters?

- **Collision probability**: ~1 in 10^48 (astronomically low)
- **Database efficiency**: 32 chars is reasonable for indexing
- **Readability**: Not too long for logs/debugging

---

## Security & Privacy

### Q: Can someone guess the content from the cache_key?

**A:** No. The cache_key is a one-way hash. You cannot reverse it to get:
- The original query
- The source IDs
- The price

### Q: Is the cache_key sensitive information?

**A:** No. The cache_key itself doesn't reveal what the content is. It's just a fingerprint that says "this specific combination of query+sources+price".

### Q: What if someone tries to brute-force guess cache_keys?

**A:** Even if they guessed a cache_key, they would only learn:
- A content_id exists (public info)
- They still can't access the content without purchasing it
- LedeWire controls access based on purchase records

---

## Comparison to Other Systems

### Traditional URL-based identification

❌ **Problem:** Different users might request the same content from different URLs
❌ **Problem:** URLs can change (redirects, rewrites)
❌ **Problem:** URL doesn't capture which sources were analyzed

### Content-hash identification (e.g., git SHA)

❌ **Problem:** Requires full content to generate hash
❌ **Problem:** Minor changes (formatting, whitespace) change the hash
❌ **Problem:** Can't check before generating the content

### Our approach: Semantic identification

✅ **Benefit:** Identifies content by what it IS (query + sources)
✅ **Benefit:** Works before content is generated
✅ **Benefit:** Robust to formatting changes
✅ **Benefit:** Intentional - different sources = different content

---

## Summary

**How we identify content:**
- Generate cache_key = hash(query + source_ids + price)
- Check if cache_key exists in database
- If exists → Reuse content_id
- If not → Register new content

**Why this works:**
- Deterministic: Same inputs = same cache_key
- Comprehensive: Captures all aspects of the content
- Efficient: Fast lookup, no need to store full content
- Reliable: Works across users, across time

**What makes content unique:**
1. The research question (query)
2. Which sources were analyzed (source IDs)
3. The price point

Same combination = same content_id = proper "already purchased" detection!
