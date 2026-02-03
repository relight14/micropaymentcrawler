# Quick Start - Testing Tollbit Fix

## The Fix
✅ Removed invalid `format` parameter from Tollbit API requests
✅ Added required `currency` parameter
✅ All tests passing

## Test It Now

### 1. Set Your API Key
```bash
export TOLLBIT_API_KEY='your-api-key-from-hack.tollbit.com'
```

### 2. Run the Integration Test
```bash
cd /home/runner/work/micropaymentcrawler/micropaymentcrawler
python3 test_tollbit_integration.py
```

### 3. Expected Output
```
✅ Pricing discovered
✅ AI-tier token obtained
✅ Full-access token obtained
✅ Service integration working
```

## What Was Fixed

**Before (caused "license tier not found" error):**
```python
{
    'url': 'https://www.forbes.com/article',
    'userAgent': 'micropaymentcrawler',
    'licenseType': 'ON_DEMAND_LICENSE',
    'maxPriceMicros': 1000000,
    'format': 'html'  # ❌ INVALID - caused the error
}
```

**After (works correctly):**
```python
{
    'url': 'https://www.forbes.com/article',
    'userAgent': 'micropaymentcrawler',
    'licenseType': 'ON_DEMAND_LICENSE',
    'maxPriceMicros': 1000000,
    'currency': 'USD'  # ✅ CORRECT
}
```

## Full Documentation
- `TOLLBIT_FIX_SUMMARY.md` - Complete implementation details
- `TOLLBIT_TESTING_GUIDE.md` - Comprehensive testing guide

## Support
If you see errors, check:
1. Is `TOLLBIT_API_KEY` set correctly?
2. Is the URL from a Tollbit-supported publisher? (Forbes, TIME, etc.)
3. Check console logs for detailed error messages
