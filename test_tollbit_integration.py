#!/usr/bin/env python3
"""
Tollbit Integration Test
Tests the Tollbit licensing protocol integration with real API calls
"""
import asyncio
import sys
import os
from backend.services.licensing.content_licensing import TollbitProtocolHandler, ContentLicenseService

async def test_tollbit_integration():
    """Test Tollbit integration with real API"""
    
    print("=" * 70)
    print("Tollbit Integration Test")
    print("=" * 70)
    
    # Check if API key is available
    api_key = os.environ.get('TOLLBIT_API_KEY')
    if not api_key:
        print("\n⚠️  TOLLBIT_API_KEY not set in environment")
        print("To test Tollbit integration, set TOLLBIT_API_KEY environment variable")
        print("\nExample:")
        print("  export TOLLBIT_API_KEY='your-api-key-here'")
        print("  python3 test_tollbit_integration.py")
        return False
    
    print(f"\n✅ TOLLBIT_API_KEY found: {api_key[:10]}...")
    
    # Initialize handler
    handler = TollbitProtocolHandler()
    service = ContentLicenseService()
    
    # Test URLs
    test_urls = [
        "https://www.forbes.com/sites/example",
        "https://time.com/example-article",
        "https://www.usatoday.com/story/example"
    ]
    
    passed = 0
    failed = 0
    
    for url in test_urls:
        print(f"\n{'=' * 70}")
        print(f"Testing: {url}")
        print(f"{'=' * 70}")
        
        try:
            # Test 1: Check pricing discovery
            print("\n1. Testing pricing discovery...")
            terms = await handler.check_source(url)
            
            if terms:
                print(f"✅ Pricing discovered")
                print(f"   Protocol: {terms.protocol}")
                print(f"   AI Include Price: ${terms.ai_include_price}")
                print(f"   Purchase Price: ${terms.purchase_price}")
                print(f"   Publisher: {terms.publisher}")
                passed += 1
            else:
                print(f"❌ No pricing found - this may mean the domain is not in Tollbit's network")
                print(f"   or there's an API error")
                failed += 1
                continue
            
            # Test 2: Request AI-tier license token
            print("\n2. Testing AI-tier license token request...")
            ai_token = await handler.request_license(url, license_type="ai-include")
            
            if ai_token:
                print(f"✅ AI-tier token obtained")
                print(f"   Token: {ai_token.token[:50]}...")
                print(f"   Cost: ${ai_token.cost}")
                print(f"   Expires: {ai_token.expires_at}")
                passed += 1
            else:
                print(f"❌ Failed to obtain AI-tier token")
                failed += 1
                continue
            
            # Test 3: Request full-access license token
            print("\n3. Testing full-access license token request...")
            full_token = await handler.request_license(url, license_type="full-access")
            
            if full_token:
                print(f"✅ Full-access token obtained")
                print(f"   Token: {full_token.token[:50]}...")
                print(f"   Cost: ${full_token.cost}")
                print(f"   Expires: {full_token.expires_at}")
                passed += 1
            else:
                print(f"❌ Failed to obtain full-access token")
                failed += 1
                continue
            
            # Test 4: Verify ContentLicenseService integration
            print("\n4. Testing ContentLicenseService integration...")
            discovery = await service.discover_licensing(url)
            
            if discovery:
                print(f"✅ Service integration working")
                print(f"   Protocol: {discovery['protocol']}")
                print(f"   AI Price: ${discovery['terms'].ai_include_price}")
                passed += 1
            else:
                print(f"❌ Service integration failed")
                failed += 1
                
        except Exception as e:
            print(f"❌ ERROR: {str(e)}")
            import traceback
            traceback.print_exc()
            failed += 1
    
    # Summary
    print(f"\n{'=' * 70}")
    print("Test Summary")
    print(f"{'=' * 70}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"{'=' * 70}")
    
    return failed == 0

async def test_tollbit_error_handling():
    """Test that Tollbit integration handles errors gracefully"""
    
    print("\n" + "=" * 70)
    print("Tollbit Error Handling Test")
    print("=" * 70)
    
    handler = TollbitProtocolHandler()
    
    # Test with invalid URL
    print("\nTesting invalid URL handling...")
    try:
        result = await handler.check_source("not-a-valid-url")
        if result is None:
            print("✅ Invalid URL handled gracefully (returned None)")
            return True
        else:
            print(f"❌ Invalid URL should return None, got: {result}")
            return False
    except Exception as e:
        print(f"❌ Exception raised for invalid URL: {e}")
        return False

async def main():
    """Run all tests"""
    print("\n" + "=" * 70)
    print("Tollbit Integration Test Suite")
    print("=" * 70)
    
    # Run integration tests
    integration_success = await test_tollbit_integration()
    
    # Run error handling tests
    error_handling_success = await test_tollbit_error_handling()
    
    overall_success = integration_success and error_handling_success
    
    print("\n" + "=" * 70)
    print("Overall Result")
    print("=" * 70)
    if overall_success:
        print("✅ All tests passed")
    else:
        print("❌ Some tests failed")
    print("=" * 70)
    
    return overall_success

if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
