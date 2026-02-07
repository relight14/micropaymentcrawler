#!/usr/bin/env python3
"""
Tollbit Flow Simulation Test
Simulates the complete purchase flow to identify the issue without network access
"""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from backend.services.licensing.content_licensing import ContentLicenseService, TollbitProtocolHandler

async def simulate_successful_ai_tier_but_failed_full_tier():
    """
    Simulate scenario where:
    1. Pricing discovery works (ON_DEMAND_LICENSE succeeds)
    2. Full-access token request fails (ON_DEMAND_FULL_USE_LICENSE returns "rate not found")
    """
    print("=" * 70)
    print("SIMULATION: Publisher has AI tier rate but NO full-access tier rate")
    print("=" * 70)
    
    service = ContentLicenseService()
    handler = TollbitProtocolHandler()
    
    # Mock the API key
    with patch.dict('os.environ', {'TOLLBIT_API_KEY': 'test_key'}):
        handler = TollbitProtocolHandler()
        
        # Mock _get_client to simulate API responses
        mock_client = AsyncMock()
        
        def create_mock_response(status_code, data=None, text=""):
            response = MagicMock()
            response.status_code = status_code
            if data:
                response.json.return_value = data
            response.text = text
            return response
        
        # Scenario: AI tier works, full-access tier fails
        call_count = [0]
        
        async def mock_post(*args, **kwargs):
            call_count[0] += 1
            payload = kwargs.get('json', {})
            license_type = payload.get('licenseType')
            
            print(f"\n[Call {call_count[0]}] Mock API Call:")
            print(f"  License Type: {license_type}")
            print(f"  Payload: {payload}")
            
            if license_type == 'ON_DEMAND_LICENSE':
                # AI tier succeeds
                print("  ✅ Returning success (token available for AI tier)")
                return create_mock_response(200, {'token': 'mock_ai_token_12345'})
            elif license_type == 'ON_DEMAND_FULL_USE_LICENSE':
                # Full-access tier fails - publisher hasn't set a rate
                print("  ❌ Returning error (NO rate configured for full-access tier)")
                return create_mock_response(
                    400, 
                    text='{"errorMessage":"rate not found for license type"}'
                )
            else:
                return create_mock_response(400, text='{"errorMessage":"unknown license type"}')
        
        mock_client.post = mock_post
        
        with patch.object(handler, '_get_client', return_value=mock_client):
            # Test 1: Check pricing (uses AI tier to discover)
            print("\n\n" + "=" * 70)
            print("Step 1: Pricing Discovery (check_source)")
            print("=" * 70)
            terms = await handler.check_source("https://time.com/article")
            
            if terms:
                print(f"\n✅ Pricing discovered:")
                print(f"   AI tier: ${terms.ai_include_price}")
                print(f"   Full-access tier: ${terms.purchase_price}")
                print(f"\n⚠️  NOTE: App shows full-access price but hasn't verified it's actually available!")
            else:
                print("\n❌ No pricing found")
                return
            
            # Test 2: Try to get full-access token (this should fail)
            print("\n\n" + "=" * 70)
            print("Step 2: Request Full-Access License Token")
            print("=" * 70)
            full_token = await handler.request_license("https://time.com/article", license_type="full-access")
            
            if full_token:
                print("\n✅ Full-access token obtained (unexpected!)")
            else:
                print("\n❌ Full-access token request FAILED")
                print("   This is the problem! The app shows the price and charges the user,")
                print("   but Tollbit returns 'rate not found for license type'")
                print("   The publisher (Time Magazine) hasn't configured a rate for full-access tier.")
    
    print("\n\n" + "=" * 70)
    print("ANALYSIS")
    print("=" * 70)
    print("""
The issue is a timing problem in the purchase flow:

CURRENT FLOW (PROBLEMATIC):
1. User sees article with "Full Access" button showing $0.12
2. User clicks "Full Access"
3. App charges LedeWire wallet $0.12  ← Payment happens here
4. App tries to get Tollbit license
5. Tollbit returns "rate not found for license type" ← Fails here
6. App falls back to scraping
7. User paid but got scraped content, not licensed content

PROBLEM:
- The app displays the full-access price ($0.12) based on a calculation
  (AI tier × 2.4), not an actual Tollbit API response
- It doesn't verify that full-access tier is ACTUALLY available
  before charging the user
- If the publisher hasn't configured full-access rates, the purchase
  will fail after payment

SOLUTION:
We need to verify full-access availability BEFORE showing the price
or at least BEFORE charging the user.
    """)

if __name__ == "__main__":
    asyncio.run(simulate_successful_ai_tier_but_failed_full_tier())
