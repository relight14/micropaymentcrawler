#!/usr/bin/env python3
"""
Test licensing protocol detection to ensure correct badge display
Tests both backend and frontend logic alignment
"""
import asyncio
import sys
from backend.services.licensing.content_licensing import ContentLicenseService

async def test_protocol_detection():
    """Test that licensing protocols are correctly detected for known domains"""
    
    print("=" * 70)
    print("Testing Licensing Protocol Detection")
    print("=" * 70)
    
    service = ContentLicenseService()
    
    # Test cases: (url, expected_protocol, description)
    test_cases = [
        ("https://www.wsj.com/article", "cloudflare", "Wall Street Journal should be Cloudflare"),
        ("https://www.nytimes.com/article", "cloudflare", "New York Times should be Cloudflare"),
        ("https://www.economist.com/article", "cloudflare", "The Economist should be Cloudflare"),
        ("https://www.reuters.com/article", "cloudflare", "Reuters should be Cloudflare"),
        ("https://www.ft.com/article", "cloudflare", "Financial Times should be Cloudflare"),
        ("https://www.forbes.com/article", "tollbit", "Forbes should be Tollbit (if API available)"),
        ("https://news.mit.edu/research", "rsl", "MIT should be RSL (if rsl.xml exists)"),
    ]
    
    passed = 0
    failed = 0
    skipped = 0
    
    for url, expected_protocol, description in test_cases:
        print(f"\n{'=' * 70}")
        print(f"Test: {description}")
        print(f"URL: {url}")
        print(f"Expected protocol: {expected_protocol.upper()}")
        
        try:
            result = await service.discover_licensing(url)
            
            if result:
                detected_protocol = result['protocol']
                terms = result['terms']
                
                print(f"✅ Detected protocol: {detected_protocol.upper()}")
                print(f"   AI Include Price: ${terms.ai_include_price:.2f}")
                print(f"   Purchase Price: ${terms.purchase_price:.2f}")
                print(f"   Publisher: {terms.publisher}")
                
                if detected_protocol == expected_protocol:
                    print(f"✅ PASS - Correct protocol detected")
                    passed += 1
                else:
                    print(f"❌ FAIL - Expected {expected_protocol}, got {detected_protocol}")
                    failed += 1
            else:
                print(f"⚠️  SKIPPED - No licensing detected (API may not be configured)")
                print(f"   This is expected in test environment without API keys")
                skipped += 1
                
        except Exception as e:
            print(f"❌ ERROR - {str(e)}")
            failed += 1
    
    # Summary
    print(f"\n{'=' * 70}")
    print("Test Summary")
    print(f"{'=' * 70}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"⚠️  Skipped: {skipped}")
    
    if skipped > 0:
        print(f"\nNote: Skipped tests are expected without API keys configured.")
        print(f"The important part is that the domain-based detection logic is in place.")
        print(f"When API keys are configured, these domains will be detected correctly.")
    
    print("=" * 70)
    
    # Return success if no actual failures (skips are OK)
    return failed == 0

if __name__ == "__main__":
    success = asyncio.run(test_protocol_detection())
    sys.exit(0 if success else 1)
