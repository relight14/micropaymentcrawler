# Content ID Reuse - Visual Guide

## The Risk You Identified

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROBLEM SCENARIO                              │
└─────────────────────────────────────────────────────────────────┘

Day 1, 10:00 AM
================
User: "Generate report on AI trends"
System: 
  ├─ Register content → content_id = "ABC123"
  ├─ Store in cache (expires in 24 hours)
  └─ User purchases → Paid for content_id "ABC123"

Day 2, 11:00 AM (cache expired!)
=================================
User: "Generate report on AI trends" (SAME content)
System:
  ├─ Cache expired! No content_id found
  ├─ Register content AGAIN → content_id = "XYZ789" ❌
  ├─ Store in cache
  └─ Check already purchased?
      → LedeWire checks: "Does user own XYZ789?"
      → LedeWire says: "No" (they own ABC123, not XYZ789)
      → System charges user AGAIN! 💸💸

Result: User charged twice for the same content! 😱
```

## Our Solution

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOLUTION FLOW                                 │
└─────────────────────────────────────────────────────────────────┘

Day 1, 10:00 AM
================
User: "Generate report on AI trends"
System:
  ├─ Generate cache_key = hash(query + sources + price)
  ├─ Check: Has this cache_key ever been registered?
  │   └─ No
  ├─ Register content → content_id = "ABC123"
  ├─ Store PERMANENTLY: cache_key → "ABC123" (NO expiration!)
  └─ User purchases → Record: "ABC123" purchased

Day 2, 11:00 AM
===============
User: "Generate report on AI trends" (SAME content)
System:
  ├─ Generate cache_key = hash(query + sources + price) [SAME]
  ├─ Check: Has this cache_key ever been registered?
  │   └─ Yes! Found "ABC123" in database
  ├─ Reuse content_id = "ABC123" ✅
  └─ Check already purchased?
      → LedeWire checks: "Does user own ABC123?"
      → LedeWire says: "Yes!" ✅
      → System shows: "You already own this content"

Result: User protected from double charge! 🎉
```

## Cache Key Consistency

```
┌─────────────────────────────────────────────────────────────────┐
│              HOW CACHE KEYS ENSURE CONSISTENCY                   │
└─────────────────────────────────────────────────────────────────┘

cache_key = SHA256(query + sorted_source_ids + price_cents)

Example 1: First Request
=========================
Input:
  query = "AI trends"
  sources = ["src_001", "src_002", "src_003"]
  price = 500 cents

cache_key = SHA256("ai trends:src_001,src_002,src_003:500")
          = "a1b2c3d4e5f6..." (32 chars)

Store: cache_key → content_id "CONTENT_001"


Example 2: Same Request (any time later)
=========================================
Input:
  query = "AI trends"
  sources = ["src_001", "src_002", "src_003"]  [SAME]
  price = 500 cents                             [SAME]

cache_key = SHA256("ai trends:src_001,src_002,src_003:500")
          = "a1b2c3d4e5f6..." [IDENTICAL!]

Lookup: cache_key → content_id "CONTENT_001" ✅
Reuse "CONTENT_001" (no new registration)


Example 3: Different Content
=============================
Input:
  query = "Blockchain trends"                   [DIFFERENT]
  sources = ["src_001", "src_002", "src_003"]
  price = 500 cents

cache_key = SHA256("blockchain trends:src_001,src_002,src_003:500")
          = "x9y8z7w6v5u4..." [DIFFERENT!]

Lookup: cache_key → Not found
Register NEW content → "CONTENT_002"
Store: cache_key → "CONTENT_002"


Example 4: Price Changed
=========================
Input:
  query = "AI trends"                           [SAME]
  sources = ["src_001", "src_002", "src_003"]  [SAME]
  price = 700 cents                             [DIFFERENT]

cache_key = SHA256("ai trends:src_001,src_002,src_003:700")
          = "p9o8i7u6y5t4..." [DIFFERENT!]

Lookup: cache_key → Not found
Register NEW content → "CONTENT_003"
(Correct: different price = different content)
```

## Database Storage Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                   PERMANENT STORAGE                              │
└─────────────────────────────────────────────────────────────────┘

content_id_cache table:
┌────────────┬────────────┬────────────┬────────────┐
│ cache_key  │ content_id │ price_cents│ expires_at │
├────────────┼────────────┼────────────┼────────────┤
│ a1b2c3...  │ CONTENT_001│ 500        │ NULL       │ ← Never expires!
│ x9y8z7...  │ CONTENT_002│ 500        │ NULL       │ ← Never expires!
│ p9o8i7...  │ CONTENT_003│ 700        │ NULL       │ ← Never expires!
└────────────┴────────────┴────────────┴────────────┘

purchases table:
┌────┬─────────────┬────────────┬─────────┬────────────┐
│ id │ query       │ user_id    │ price   │ content_id │
├────┼─────────────┼────────────┼─────────┼────────────┤
│ 1  │ AI trends   │ user_001   │ 5.00    │ CONTENT_001│
│ 2  │ Blockchain..│ user_001   │ 5.00    │ CONTENT_002│
│ 3  │ AI trends   │ user_002   │ 7.00    │ CONTENT_003│
└────┴─────────────┴────────────┴─────────┴────────────┘

Lookup process:
1. Generate cache_key from request
2. SELECT content_id FROM content_id_cache WHERE cache_key = ?
3. If found → Reuse content_id ✅
4. If NOT found → Register new content, store with expires_at = NULL
```

## Timeline Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│              BEFORE FIX (Vulnerable to Duplicates)               │
└─────────────────────────────────────────────────────────────────┘

Day 1    Day 2    Day 3    Day 4    Day 5
│        │        │        │        │
│ Register        │ Cache  │        │ Cache
│ ABC123          │ expires│        │ expires again
│                 │        │        │
│                 │ Register        │ Register
│                 │ XYZ789 ❌       │ DEF456 ❌
│                 │                 │
└─────────────────┴────────────────┴──────────────────

Problem: Every 24 hours, new content_id created!


┌─────────────────────────────────────────────────────────────────┐
│               AFTER FIX (Permanent Reuse)                        │
└─────────────────────────────────────────────────────────────────┘

Day 1    Day 30   Day 60   Day 90   Day 365
│        │        │        │        │
│ Register        │        │        │
│ ABC123          │        │        │
│ (stored         │ Reuse  │ Reuse  │ Reuse
│  forever)       │ ABC123 │ ABC123 │ ABC123
│                 │ ✅     │ ✅     │ ✅
└─────────────────┴────────┴────────┴──────────────────

Solution: Same content_id used forever!
```

## Multi-User Scenario

```
┌─────────────────────────────────────────────────────────────────┐
│         MULTIPLE USERS, SAME CONTENT                             │
└─────────────────────────────────────────────────────────────────┘

User A (Day 1)
==============
Request: "AI trends" report
System:
  ├─ cache_key = "a1b2c3..."
  ├─ Check: Not found
  ├─ Register → content_id = "CONTENT_001"
  └─ User A purchases "CONTENT_001"

User B (Day 5)
==============
Request: "AI trends" report (SAME content)
System:
  ├─ cache_key = "a1b2c3..." [SAME]
  ├─ Check: Found "CONTENT_001" ✅
  ├─ Reuse → content_id = "CONTENT_001"
  └─ User B purchases "CONTENT_001"

User A (Day 10)
===============
Request: "AI trends" report (again)
System:
  ├─ cache_key = "a1b2c3..." [SAME]
  ├─ Check: Found "CONTENT_001" ✅
  ├─ Reuse → content_id = "CONTENT_001"
  └─ Check: User A already owns "CONTENT_001" ✅
  └─ Result: "Already purchased" - no charge

Result: All users share same content_id, purchases tracked correctly
```

## Error Scenarios Handled

```
┌─────────────────────────────────────────────────────────────────┐
│               EDGE CASES & ERROR HANDLING                        │
└─────────────────────────────────────────────────────────────────┘

Scenario 1: Database Restart
=============================
Before restart: cache_key → "CONTENT_001" stored
After restart:  cache_key → Still maps to "CONTENT_001" ✅
Why: Permanent storage in SQLite database

Scenario 2: Cache Corruption
=============================
Cache entry deleted/corrupted
System:
  ├─ Check content_id_cache: Not found
  ├─ Check purchases table: Found "CONTENT_001" ✅
  └─ Restore cache entry from purchases
Why: Dual lookup (cache + purchases)

Scenario 3: Price Change
=========================
Same content, price changes from $5 → $7
System:
  ├─ cache_key includes price → Different key
  ├─ Registers NEW content with new price ✅
  └─ Both content_ids exist (correct behavior)
Why: Price included in cache_key

Scenario 4: Source Order Different
===================================
Request 1: sources = ["A", "B", "C"]
Request 2: sources = ["C", "A", "B"] (different order)
System:
  ├─ Both sorted → ["A", "B", "C"]
  ├─ Same cache_key ✅
  └─ Reuses content_id
Why: Source IDs sorted before hashing

Scenario 5: LedeWire Registration Fails
========================================
Registration attempt fails
System:
  ├─ No content_id stored in cache
  ├─ User sees error immediately
  └─ Next request tries again (no stale data)
Why: Only store on successful registration
```

## Summary

✅ **Problem Identified:** Cache expiry causes duplicate registrations

✅ **Solution:** Permanent content_id storage with cache_key lookup

✅ **Benefits:**
   - No duplicate content registrations
   - "Already purchased" works forever
   - Multiple users share same content_id
   - Price changes handled correctly

✅ **Implementation:** Production-ready and tested
