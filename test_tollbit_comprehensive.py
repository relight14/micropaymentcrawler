#!/usr/bin/env python3
"""
Comprehensive Tollbit Integration Test
Tests the complete Tollbit flow with real API calls and detailed debugging
"""
import asyncio
import sys
import os
import json
import httpx
from backend.services.licensing.content_licensing import TollbitProtocolHandler, ContentLicenseService
from datetime import datetime

async def test_raw_api_call(api_key: str, url: str):
    """Test raw Tollbit API call to verify basic connectivity"""
    print("\n" + "=" * 70)
    print("TEST 1: Raw Tollbit API Call (Direct)")
    print("=" * 70)
    
    base_url = "https://gateway.tollbit.com"
    endpoint = f"{base_url}/dev/v2/tokens/content"
    
    headers = {
        'TollbitKey': api_key,
        'Content-Type': 'application/json'
    }
    
    payload = {
        'url': url,
        'userAgent': 'micropaymentcrawler',
        'licenseType': 'ON_DEMAND_LICENSE',
        'maxPriceMicros': 1000000,
        'currency': 'USD'
    }
    
    print(f"\nEndpoint: {endpoint}")
    print(f"URL: {url}")
    print(f"Payload: {json.dumps(payload, indent=2)}")
    print(f"API Key: {'*' * 20}...{api_key[-10:]}")
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                endpoint,
                headers=headers,
                json=payload
            )
            
            print(f"\n✅ Response Status: {response.status_code}")
            print(f"Response Headers: {dict(response.headers)}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ SUCCESS: Token obtained")
                print(f"Token (first 50 chars): {data.get('token', '')[:50]}...")
                return True, data
            else:
                print(f"❌ FAILED: {response.status_code}")
                print(f"Response Body: {response.text}")
                return False, response.text
                
    except Exception as e:
        print(f"❌ EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
        return False, str(e)

async def test_pricing_discovery(handler: TollbitProtocolHandler, url: str):
    """Test pricing discovery"""
    print("\n" + "=" * 70)
    print("TEST 2: Pricing Discovery (via TollbitProtocolHandler)")
    print("=" * 70)
    
    try:
        terms = await handler.check_source(url)
        
        if terms:
            print(f"✅ Pricing discovered successfully")
            print(f"   Protocol: {terms.protocol}")
            print(f"   AI Include Price: ${terms.ai_include_price}")
            print(f"   Purchase Price: ${terms.purchase_price}")
            print(f"   Currency: {terms.currency}")
            print(f"   Publisher: {terms.publisher}")
            print(f"   Permits AI Include: {terms.permits_ai_include}")
            print(f"   Permits Search: {terms.permits_search}")
            return True, terms
        else:
            print(f"❌ No pricing found")
            return False, None
            
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False, None

async def test_ai_tier_token(handler: TollbitProtocolHandler, url: str):
    """Test AI-tier (ON_DEMAND_LICENSE) token request"""
    print("\n" + "=" * 70)
    print("TEST 3: AI-Tier License Token Request")
    print("=" * 70)
    
    try:
        token = await handler.request_license(url, license_type="ai-include")
        
        if token:
            print(f"✅ AI-tier token obtained successfully")
            print(f"   Token (first 50 chars): {token.token[:50]}...")
            print(f"   Protocol: {token.protocol}")
            print(f"   Cost: ${token.cost}")
            print(f"   Currency: {token.currency}")
            print(f"   Expires At: {token.expires_at}")
            print(f"   License Type: {token.license_type}")
            return True, token
        else:
            print(f"❌ Failed to obtain AI-tier token")
            return False, None
            
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False, None

async def test_full_access_token(handler: TollbitProtocolHandler, url: str):
    """Test full-access (ON_DEMAND_FULL_USE_LICENSE) token request"""
    print("\n" + "=" * 70)
    print("TEST 4: Full-Access License Token Request")
    print("=" * 70)
    
    try:
        token = await handler.request_license(url, license_type="full-access")
        
        if token:
            print(f"✅ Full-access token obtained successfully")
            print(f"   Token (first 50 chars): {token.token[:50]}...")
            print(f"   Protocol: {token.protocol}")
            print(f"   Cost: ${token.cost}")
            print(f"   Currency: {token.currency}")
            print(f"   Expires At: {token.expires_at}")
            print(f"   License Type: {token.license_type}")
            return True, token
        else:
            print(f"❌ Failed to obtain full-access token")
            return False, None
            
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False, None

async def test_content_fetch(handler: TollbitProtocolHandler, url: str, token):
    """Test fetching content with license token"""
    print("\n" + "=" * 70)
    print("TEST 5: Content Fetch with License Token")
    print("=" * 70)
    
    if not token:
        print("⚠️  Skipping - no token available")
        return False, None
    
    try:
        content = await handler.fetch_content(url, token)
        
        if content:
            print(f"✅ Content fetched successfully")
            print(f"   Content keys: {list(content.keys())}")
            
            # Try to extract meaningful info
            if isinstance(content, dict):
                if 'body' in content:
                    print(f"   Body length: {len(content['body'])} chars")
                    print(f"   Body preview: {content['body'][:200]}...")
                if 'metadata' in content:
                    print(f"   Metadata: {content['metadata']}")
                if 'rate' in content:
                    print(f"   Rate info: {content['rate']}")
            
            return True, content
        else:
            print(f"❌ Failed to fetch content")
            return False, None
            
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False, None

async def test_content_license_service(service: ContentLicenseService, url: str):
    """Test ContentLicenseService integration"""
    print("\n" + "=" * 70)
    print("TEST 6: ContentLicenseService Integration")
    print("=" * 70)
    
    try:
        # Test discovery
        print("\n6a. Testing discovery...")
        discovery = await service.discover_licensing(url)
        
        if discovery:
            print(f"✅ Discovery successful")
            print(f"   Protocol: {discovery.get('protocol')}")
            print(f"   Has terms: {discovery.get('terms') is not None}")
            if discovery.get('terms'):
                terms = discovery['terms']
                print(f"   AI Price: ${terms.ai_include_price}")
                print(f"   Purchase Price: ${terms.purchase_price}")
        else:
            print(f"❌ Discovery failed")
            return False
        
        # Test fetching licensed content (AI tier)
        print("\n6b. Testing fetch_licensed_content (AI tier)...")
        ai_content = await service.fetch_licensed_content(url, license_type="ai-include")
        
        if ai_content:
            print(f"✅ AI-tier content fetch successful")
            print(f"   Keys: {list(ai_content.keys())}")
        else:
            print(f"❌ AI-tier content fetch failed")
        
        # Test fetching licensed content (Full access)
        print("\n6c. Testing fetch_licensed_content (full-access tier)...")
        full_content = await service.fetch_licensed_content(url, license_type="full-access")
        
        if full_content:
            print(f"✅ Full-access content fetch successful")
            print(f"   Keys: {list(full_content.keys())}")
            return True
        else:
            print(f"❌ Full-access content fetch failed")
            return False
            
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    """Run comprehensive Tollbit integration tests"""
    print("\n" + "=" * 70)
    print("COMPREHENSIVE TOLLBIT INTEGRATION TEST SUITE")
    print("=" * 70)
    print(f"Start Time: {datetime.now().isoformat()}")
    
    # Check for API key
    api_key = os.environ.get('TOLLBIT_API_KEY')
    if not api_key:
        print("\n⚠️  ERROR: TOLLBIT_API_KEY not set in environment")
        print("\nTo run this test, set your Tollbit API key:")
        print("  export TOLLBIT_API_KEY='your-api-key-here'")
        print("  python3 test_tollbit_comprehensive.py")
        return False
    
    print(f"\n✅ API Key found: {'*' * 20}...{api_key[-10:]}")
    
    # Test URLs - Using real publisher domains from Tollbit network
    test_urls = [
        "https://time.com/7335417/donald-trump-mental-fitness",
        "https://www.forbes.com/sites/williamsmith/2024/technology",
        "https://www.usatoday.com/story/news/2024/example"
    ]
    
    print(f"\nTest URLs: {len(test_urls)}")
    for i, url in enumerate(test_urls, 1):
        print(f"  {i}. {url}")
    
    # Initialize handlers
    handler = TollbitProtocolHandler()
    service = ContentLicenseService()
    
    # Run tests for each URL
    results = []
    
    for url in test_urls:
        print(f"\n\n{'#' * 70}")
        print(f"# TESTING URL: {url}")
        print(f"{'#' * 70}")
        
        url_results = {
            'url': url,
            'tests': {}
        }
        
        # Test 1: Raw API call
        success, data = await test_raw_api_call(api_key, url)
        url_results['tests']['raw_api'] = success
        
        # Test 2: Pricing discovery
        success, terms = await test_pricing_discovery(handler, url)
        url_results['tests']['pricing_discovery'] = success
        
        # Test 3: AI-tier token
        success, ai_token = await test_ai_tier_token(handler, url)
        url_results['tests']['ai_tier_token'] = success
        
        # Test 4: Full-access token
        success, full_token = await test_full_access_token(handler, url)
        url_results['tests']['full_access_token'] = success
        
        # Test 5: Content fetch (only if we got a token)
        if full_token:
            success, content = await test_content_fetch(handler, url, full_token)
            url_results['tests']['content_fetch'] = success
        else:
            url_results['tests']['content_fetch'] = False
        
        # Test 6: Service integration
        success = await test_content_license_service(service, url)
        url_results['tests']['service_integration'] = success
        
        results.append(url_results)
    
    # Print summary
    print("\n\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    
    total_tests = 0
    passed_tests = 0
    
    for result in results:
        print(f"\n{result['url']}")
        for test_name, passed in result['tests'].items():
            status = "✅ PASS" if passed else "❌ FAIL"
            print(f"  {test_name}: {status}")
            total_tests += 1
            if passed:
                passed_tests += 1
    
    print(f"\n{'=' * 70}")
    print(f"OVERALL RESULTS")
    print(f"{'=' * 70}")
    print(f"Total Tests: {total_tests}")
    print(f"Passed: {passed_tests}")
    print(f"Failed: {total_tests - passed_tests}")
    print(f"Success Rate: {(passed_tests/total_tests*100):.1f}%")
    print(f"End Time: {datetime.now().isoformat()}")
    print(f"{'=' * 70}")
    
    return passed_tests == total_tests

if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\nFatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
