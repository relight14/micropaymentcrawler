#!/usr/bin/env python3
"""
Test for Tollbit Pricing Fix
Verifies that full-access pricing is only returned when actually available
"""
import asyncio
import sys
from unittest.mock import AsyncMock, MagicMock, patch
from backend.services.licensing.content_licensing import TollbitProtocolHandler

async def test_pricing_with_full_access_available():
    """Test when publisher has configured both AI and full-access tiers"""
    print("=" * 70)
    print("TEST 1: Publisher with BOTH tiers configured")
    print("=" * 70)
    
    with patch.dict('os.environ', {'TOLLBIT_API_KEY': 'test_key'}):
        handler = TollbitProtocolHandler()
        
        mock_client = AsyncMock()
        
        # Both tiers return success
        async def mock_post(*args, **kwargs):
            response = MagicMock()
            response.status_code = 200
            response.json.return_value = {'token': 'mock_token_12345'}
            return response
        
        mock_client.post = mock_post
        
        with patch.object(handler, '_get_client', return_value=mock_client):
            result = await handler._check_pricing("https://forbes.com/article")
            
            if result:
                print(f"✅ Pricing returned:")
                print(f"   AI tier: ${result.get('ai_include_price')}")
                print(f"   Full-access: ${result.get('purchase_price')}")
                
                if result.get('purchase_price') is not None:
                    print("   ✅ Full-access price is available (as expected)")
                    return True
                else:
                    print("   ❌ Full-access price is None (unexpected!)")
                    return False
            else:
                print("❌ No pricing returned")
                return False

async def test_pricing_with_only_ai_tier():
    """Test when publisher has only AI tier (no full-access)"""
    print("\n" + "=" * 70)
    print("TEST 2: Publisher with ONLY AI tier (like Time Magazine)")
    print("=" * 70)
    
    with patch.dict('os.environ', {'TOLLBIT_API_KEY': 'test_key'}):
        handler = TollbitProtocolHandler()
        
        mock_client = AsyncMock()
        call_count = [0]
        
        # AI tier succeeds, full-access tier fails
        async def mock_post(*args, **kwargs):
            call_count[0] += 1
            payload = kwargs.get('json', {})
            license_type = payload.get('licenseType')
            
            response = MagicMock()
            if license_type == 'ON_DEMAND_LICENSE':
                # AI tier succeeds
                response.status_code = 200
                response.json.return_value = {'token': 'mock_ai_token'}
                print(f"   [Call {call_count[0]}] AI tier: SUCCESS")
            elif license_type == 'ON_DEMAND_FULL_USE_LICENSE':
                # Full-access tier fails
                response.status_code = 400
                response.text = '{"errorMessage":"rate not found for license type"}'
                print(f"   [Call {call_count[0]}] Full-access tier: FAILED (rate not found)")
            
            return response
        
        mock_client.post = mock_post
        
        with patch.object(handler, '_get_client', return_value=mock_client):
            result = await handler._check_pricing("https://time.com/article")
            
            if result:
                print(f"\n✅ Pricing returned:")
                print(f"   AI tier: ${result.get('ai_include_price')}")
                print(f"   Full-access: {result.get('purchase_price')}")
                
                if result.get('purchase_price') is None:
                    print("   ✅ Full-access price is None (correct!)")
                    print("   This prevents showing 'Full Access' button when unavailable")
                    return True
                else:
                    print(f"   ❌ Full-access price is ${result.get('purchase_price')} (should be None!)")
                    print("   This would let users try to buy unavailable access")
                    return False
            else:
                print("❌ No pricing returned")
                return False

async def test_pricing_with_no_tiers():
    """Test when publisher is not on Tollbit"""
    print("\n" + "=" * 70)
    print("TEST 3: Publisher NOT on Tollbit")
    print("=" * 70)
    
    with patch.dict('os.environ', {'TOLLBIT_API_KEY': 'test_key'}):
        handler = TollbitProtocolHandler()
        
        mock_client = AsyncMock()
        
        # Both tiers fail
        async def mock_post(*args, **kwargs):
            response = MagicMock()
            response.status_code = 404
            response.text = '{"errorMessage":"publisher not found"}'
            return response
        
        mock_client.post = mock_post
        
        with patch.object(handler, '_get_client', return_value=mock_client):
            result = await handler._check_pricing("https://example.com/article")
            
            if result is None:
                print("✅ No pricing returned (correct for non-Tollbit publisher)")
                return True
            else:
                print(f"❌ Pricing returned: {result} (should be None!)")
                return False

async def main():
    """Run all tests"""
    print("\n" + "=" * 70)
    print("TOLLBIT PRICING FIX VERIFICATION")
    print("=" * 70)
    
    results = []
    
    # Test 1: Both tiers available
    results.append(await test_pricing_with_full_access_available())
    
    # Test 2: Only AI tier available (the fix!)
    results.append(await test_pricing_with_only_ai_tier())
    
    # Test 3: No tiers available
    results.append(await test_pricing_with_no_tiers())
    
    # Summary
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    passed = sum(results)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    print(f"Failed: {total - passed}/{total}")
    
    if passed == total:
        print("\n✅ All tests passed! The fix is working correctly.")
        print("\nBehavior after fix:")
        print("- Publishers with full-access: Show 'Full Access' button")
        print("- Publishers without full-access: Hide 'Full Access' button")
        print("- Users never charged for unavailable access")
    else:
        print("\n❌ Some tests failed. Please review the implementation.")
    
    print("=" * 70)
    
    return passed == total

if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
