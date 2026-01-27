# Purchase Flow Fix - LedeWire API Compliance

## Problem Statement

The original implementation had a critical flaw in the purchase flow:

**INCORRECT FLOW (Old):**
1. User clicks "Generate Report" → Frontend
2. Get pricing quote → `GET /api/purchase/quote`
3. Show confirmation modal → Frontend
4. **Check checkout-state → `POST /api/purchase/checkout-state` (content_id=None)** ❌
5. User clicks "Confirm" → `POST /api/purchase`
6. Inside purchase endpoint: Register content → Generate report → Complete purchase

**ISSUE:** The checkout-state was called BEFORE content was registered with LedeWire, meaning:
- No `content_id` existed yet
- The "already purchased" check couldn't work properly
- This violated LedeWire API expectations

## Solution

**CORRECT FLOW (New):**
1. User clicks "Generate Report" → Frontend
2. **Register content → `POST /api/purchase/register-content` (returns content_id)** ✅
3. Get pricing quote → `GET /api/purchase/quote` (optional, for display)
4. **Check checkout-state → `POST /api/purchase/checkout-state` (with content_id)** ✅
5. Show confirmation modal → Frontend
6. User clicks "Confirm" → `POST /api/purchase` (with content_id)
7. Inside purchase endpoint: Generate report → Complete purchase (content already registered)

## Changes Made

### Backend Changes

#### 1. New Endpoint: `/api/purchase/register-content`
**Location:** `backend/app/api/routes/purchase.py`

```python
@router.post("/register-content", response_model=RegisterContentResponse)
async def register_content(
    request: Request,
    content_request: RegisterContentRequest,
    authorization: str = Header(None, alias="Authorization")
)
```

**Purpose:** Register content with LedeWire BEFORE the checkout-state check
**Returns:** `{success: true, content_id: "...", price_cents: 500, message: "..."}`

**Flow:**
1. Extract sources from outline structure
2. Calculate pricing (incremental based on previous purchases)
3. Register content with LedeWire (or use cached content_id)
4. Return content_id and price_cents to frontend

#### 2. Updated Purchase Endpoint
**Location:** `backend/app/api/routes/purchase.py`

**Changes:**
- Now accepts `content_id` parameter in `PurchaseRequest`
- Uses provided `content_id` instead of registering during purchase
- Falls back to inline registration for backwards compatibility (deprecated)

**Before:**
```python
# Always registered content inline during purchase
registration_result = ledewire.register_content(...)
content_id = registration_result.get("id")
```

**After:**
```python
# Use content_id from frontend (already registered)
content_id = purchase_request.content_id

# Fallback only if not provided (backwards compatibility)
if not content_id:
    logger.warning("⚠️ No content_id provided - deprecated flow")
    # ... inline registration fallback
```

#### 3. New Schemas
**Location:** `backend/schemas/api.py`

```python
class RegisterContentRequest(BaseModel):
    query: str
    outline_structure: Optional[Dict[str, Any]] = None

class RegisterContentResponse(BaseModel):
    success: bool
    content_id: str
    price_cents: int
    message: str

class PurchaseRequest(BaseModel):
    # ... existing fields ...
    content_id: Optional[str] = None  # NEW: from register-content endpoint
```

### Frontend Changes

#### 1. New API Method: `registerContent()`
**Location:** `backend/static/js/services/api.js`

```javascript
async registerContent(query, outlineStructure) {
    const response = await this._fetchWithRetry(
        `${this.baseURL}/api/purchase/register-content`,
        {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                query: query,
                outline_structure: outlineStructure
            })
        },
        'Failed to register content'
    );
    return response;
}
```

#### 2. Updated `showReportConfirmation()`
**Location:** `backend/static/js/components/purchase-confirmation-modal.js`

**Before:**
```javascript
async showReportConfirmation(query, sources, outlineStructure, onConfirm) {
    // Get pricing quote
    const quoteResult = await this._getPricingQuote(query, outlineStructure);
    
    // Show modal with contentId: null
    await this._showModal({
        ...
        contentId: null  // ❌ No content_id yet
    });
}
```

**After:**
```javascript
async showReportConfirmation(query, sources, outlineStructure, onConfirm) {
    // STEP 1: Register content FIRST
    const registrationResult = await this.apiService.registerContent(query, outlineStructure);
    const contentId = registrationResult.content_id;
    const priceCents = registrationResult.price_cents;
    
    // STEP 2: Get pricing quote (optional)
    const quoteResult = await this._getPricingQuote(query, outlineStructure);
    
    // STEP 3: Show modal with content_id
    await this._showModal({
        ...
        contentId: contentId  // ✅ Content already registered
    });
}
```

#### 3. Updated `generateReport()` API Method
**Location:** `backend/static/js/services/api.js`

**Before:**
```javascript
async generateReport(query, selectedSources = null, outlineStructure = null) {
    const requestBody = {
        query,
        idempotency_key: idempotencyKey
        // ... no content_id
    };
}
```

**After:**
```javascript
async generateReport(query, selectedSources = null, outlineStructure = null, contentId = null) {
    const requestBody = {
        query,
        idempotency_key: idempotencyKey,
        content_id: contentId  // ✅ Pass content_id to backend
    };
}
```

#### 4. Updated `_executePurchase()` in Modal
**Location:** `backend/static/js/components/purchase-confirmation-modal.js`

**Before:**
```javascript
result = await this.apiService.generateReport(
    this.currentPurchase.query,
    this.currentPurchase.sources,
    this.currentPurchase.outlineStructure
);
```

**After:**
```javascript
result = await this.apiService.generateReport(
    this.currentPurchase.query,
    this.currentPurchase.sources,
    this.currentPurchase.outlineStructure,
    this.currentPurchase.contentId  // ✅ Pass content_id from registration
);
```

## Benefits

1. **LedeWire API Compliance:** Now follows the expected flow per LedeWire specification
2. **Proper "Already Purchased" Detection:** The `content_id` exists when `checkout-state` is called
3. **Better Error Handling:** Content registration can fail early before showing the modal
4. **Clearer Separation of Concerns:** Registration, validation, and purchase are distinct steps
5. **Backwards Compatible:** Purchase endpoint falls back to inline registration if no `content_id` provided

## Testing

To test the new flow:

1. **Start the application** and log in as a user
2. **Generate a report** - this will trigger the new flow:
   - Content is registered automatically
   - Checkout state is checked with the content_id
   - Modal shows purchase options
3. **Try purchasing the same report again** - should detect "already purchased"
4. **Check logs** for the flow:
   ```
   📝 [REGISTER] Registering content for query: '...'
   📝 [REGISTER] Content registered: content_id=abc123
   ✅ [CHECKOUT] Checking state with content_id=abc123
   💳 [PURCHASE] Processing with content_id=abc123
   ```

## Migration Notes

### For Developers

- The new flow is **automatically used** when generating reports
- No code changes needed in other parts of the application
- The purchase endpoint maintains backwards compatibility

### For Production Deployment

1. Deploy the updated backend code
2. Deploy the updated frontend code
3. Monitor logs for any "deprecated flow" warnings
4. If warnings appear, investigate why content_id is not being passed

### Known Limitations

- The fallback to inline registration adds latency if frontend doesn't provide content_id
- Content registration caching is 24 hours - may need adjustment based on usage patterns
- Mock mode generates random content_ids - consider using deterministic IDs for testing

## Related Files

- `backend/app/api/routes/purchase.py` - Main purchase logic
- `backend/schemas/api.py` - Request/response schemas
- `backend/static/js/services/api.js` - Frontend API service
- `backend/static/js/components/purchase-confirmation-modal.js` - Purchase modal UI
- `attached_assets/ledewire_1758117324971.yml` - LedeWire API specification

## References

- [LedeWire API Documentation](https://api-staging.ledewire.com/v1)
- Original issue discussion: See problem statement in PR description
