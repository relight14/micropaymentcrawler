# Purchase Flow Diagram

## Before (Incorrect Flow)

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER ACTION                               │
│              User clicks "Generate Report" button                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   GET /api/purchase/quote     │
         │   (Calculate pricing)          │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │  Show Confirmation Modal       │
         │  (Display pricing)             │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ POST /api/purchase/           │
         │     checkout-state             │
         │ ❌ content_id = None           │ <-- PROBLEM!
         │ (Can't detect already          │
         │  purchased)                    │
         └───────────────┬───────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                         USER ACTION                               │
│                  User clicks "Confirm" button                     │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   POST /api/purchase          │
         │   (Atomic purchase)            │
         │                                │
         │   1. Register content ────┐   │
         │   2. Generate report      │   │
         │   3. Complete purchase    │   │
         │                           │   │
         │   All in one endpoint! ───┘   │
         └───────────────────────────────┘
```

## After (Correct Flow)

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER ACTION                               │
│              User clicks "Generate Report" button                 │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ POST /api/purchase/           │
         │    register-content           │
         │ ✅ Returns content_id         │ <-- NEW STEP!
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   GET /api/purchase/quote     │
         │   (Calculate pricing)          │
         │   [Optional - for display]     │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │ POST /api/purchase/           │
         │     checkout-state             │
         │ ✅ content_id = "abc123"      │ <-- NOW WITH ID!
         │ (Can detect already            │
         │  purchased!)                   │
         └───────────────┬───────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │  Show Confirmation Modal       │
         │  (Display pricing & status)    │
         └───────────────┬───────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│                         USER ACTION                               │
│                  User clicks "Confirm" button                     │
└────────────────────────┬─────────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   POST /api/purchase          │
         │   (Focused purchase)           │
         │                                │
         │   content_id: "abc123" ────┐  │
         │                            │  │
         │   1. Generate report       │  │
         │   2. Complete purchase ────┘  │
         │   (content already             │
         │    registered!)                │
         └───────────────────────────────┘
```

## Key Differences

### 1. Content Registration Timing

| Old Flow | New Flow |
|----------|----------|
| Content registered **during** purchase | Content registered **before** checkout-state |
| No content_id available for validation | content_id available for all subsequent steps |

### 2. Checkout State Check

| Old Flow | New Flow |
|----------|----------|
| `content_id = None` | `content_id = "abc123"` |
| ❌ Can't detect "already purchased" | ✅ Can detect "already purchased" |
| ❌ Can't verify with LedeWire | ✅ Can verify with LedeWire |

### 3. Purchase Endpoint Responsibility

| Old Flow | New Flow |
|----------|----------|
| 1. Register content | 1. Generate report |
| 2. Generate report | 2. Complete purchase |
| 3. Complete purchase | (content already registered) |
| **Monolithic** | **Focused** |

## Benefits of New Flow

1. ✅ **LedeWire API Compliant**: Follows expected sequence
2. ✅ **Proper Purchase Verification**: Can detect already-purchased content
3. ✅ **Early Error Detection**: Registration errors happen before modal
4. ✅ **Separation of Concerns**: Each endpoint has a single responsibility
5. ✅ **Better UX**: Users know if they already own content before confirming

## Error Handling

### Old Flow
```
User confirms purchase
   ↓
Registration fails in purchase endpoint
   ↓
❌ User sees error AFTER clicking confirm
```

### New Flow
```
User clicks "Generate Report"
   ↓
Registration fails immediately
   ↓
✅ User sees error BEFORE seeing modal
   ↓
No wasted time or confusion
```

## Implementation Notes

- The purchase endpoint maintains backwards compatibility
- If no content_id provided, it falls back to old flow (with deprecation warning)
- Frontend automatically uses new flow for all report generations
- No migration needed for existing code - it just works better!
