# Tollbit Integration Testing Guide

## Overview
This guide explains how to test the Tollbit licensing integration with your API key.

## Fixed Issues
- ✅ Removed invalid `format` parameter from token requests
- ✅ Added required `currency` parameter to all API requests
- ✅ Fixed API parameter validation

## Prerequisites
1. You need a Tollbit API key from https://hack.tollbit.com/
2. The API key should be set as an environment variable

## Running Tests

### 1. Set Your API Key
```bash
export TOLLBIT_API_KEY='your-api-key-here'
```

### 2. Run Parameter Validation Test (No API Key Required)
This test verifies that we're sending the correct parameters:
```bash
python3 test_tollbit_api_params.py
```

Expected output:
```
✅ All required parameters present
✅ No invalid 'format' parameter
✅ Currency parameter is correct: USD
```

### 3. Run Integration Test (Requires API Key)
This test makes actual API calls to Tollbit:
```bash
python3 test_tollbit_integration.py
```

This will test:
- Pricing discovery for Forbes, TIME, and USA Today
- AI-tier license token requests
- Full-access tier license token requests
- ContentLicenseService integration

### 4. Run E2E Purchase Flow Test
```bash
python3 test_e2e_purchase_flow.py
```

## Testing with the Web Application

### Test Tollbit Detection and Pricing
1. Start the application
2. Search for content from Tollbit publishers (e.g., Forbes, TIME, USA Today)
3. You should see:
   - Tollbit badge on supported articles
   - Pricing information displayed
   - "Full Access" button available

### Test Full Access Purchase Flow
1. Click "Full Access" on a Tollbit article
2. The system should:
   - Show the price for full-access tier (higher than AI tier)
   - Request license from Tollbit API
   - Charge your LedeWire wallet
   - Grant access to full article content

## Expected Behavior

### Successful Integration
- ✅ Pricing displayed for Tollbit articles
- ✅ No "license tier not found" errors
- ✅ Tokens successfully minted for both AI and full-access tiers
- ✅ Content successfully fetched with token

### Common Issues
1. **"TOLLBIT_API_KEY not available"**
   - Solution: Set the API key environment variable

2. **"No licensing detected"**
   - The URL may not be in Tollbit's network
   - Try URLs from known Tollbit publishers (Forbes, TIME, etc.)

3. **HTTP errors from API**
   - Check that your API key is valid
   - Verify network connectivity

## API Parameters

The integration now sends these correct parameters to Tollbit API:
```json
{
  "url": "https://www.forbes.com/article",
  "userAgent": "micropaymentcrawler",
  "licenseType": "ON_DEMAND_LICENSE",  // or "ON_DEMAND_FULL_USE_LICENSE"
  "maxPriceMicros": 1000000,
  "currency": "USD"
}
```

Note: `format` is NOT sent in token requests (this was the bug causing "license tier not found")

## License Tiers

### AI Tier (ON_DEMAND_LICENSE)
- Price: ~$0.05
- Used for: AI inference, search results, snippets
- Endpoint: `/dev/v2/tokens/content` with `licenseType: "ON_DEMAND_LICENSE"`

### Full Access Tier (ON_DEMAND_FULL_USE_LICENSE)
- Price: ~$0.12 (2.4x AI tier)
- Used for: Full human reader access to article
- Endpoint: `/dev/v2/tokens/content` with `licenseType: "ON_DEMAND_FULL_USE_LICENSE"`

## LedeWire Integration

The purchase flow:
1. User clicks "Full Access" on article
2. App checks Tollbit pricing
3. App shows price confirmation modal
4. User confirms purchase
5. LedeWire wallet is charged
6. Tollbit license token is obtained
7. Full article content is fetched
8. User can read the full article

## Support

If you encounter issues:
1. Check the console logs for detailed error messages
2. Run the test suite to verify configuration
3. Verify your Tollbit API key is valid
4. Check that the URL is from a Tollbit-supported publisher

## Next Steps

After verifying the integration works:
1. Test with multiple publisher domains
2. Verify pricing is correct for both tiers
3. Test the full purchase flow with LedeWire wallet
4. Verify attribution and content display
