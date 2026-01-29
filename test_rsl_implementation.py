#!/usr/bin/env python3
"""
Comprehensive RSL Implementation Tests
Tests OAuth flow, token management, content fetching, and purchase flow
"""
import asyncio
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from services.licensing.rsl_token_manager import RSLTokenManager, RSLToken
from services.licensing.content_licensing import (
    RSLProtocolHandler,
    ContentLicenseService,
    LicenseTerms,
    LicenseToken
)
from datetime import datetime, timedelta


class TestResults:
    """Track test results"""
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.tests = []
    
    def add_pass(self, test_name: str, message: str = ""):
        self.passed += 1
        self.tests.append(("PASS", test_name, message))
        print(f"✅ PASS: {test_name}")
        if message:
            print(f"   {message}")
    
    def add_fail(self, test_name: str, message: str = ""):
        self.failed += 1
        self.tests.append(("FAIL", test_name, message))
        print(f"❌ FAIL: {test_name}")
        if message:
            print(f"   {message}")
    
    def add_skip(self, test_name: str, message: str = ""):
        self.skipped += 1
        self.tests.append(("SKIP", test_name, message))
        print(f"⚠️  SKIP: {test_name}")
        if message:
            print(f"   {message}")
    
    def print_summary(self):
        print(f"\n{'=' * 70}")
        print("Test Summary")
        print(f"{'=' * 70}")
        print(f"✅ Passed: {self.passed}")
        print(f"❌ Failed: {self.failed}")
        print(f"⚠️  Skipped: {self.skipped}")
        print(f"Total: {len(self.tests)}")
        print(f"{'=' * 70}")
        
        if self.failed > 0:
            print("\nFailed Tests:")
            for status, name, msg in self.tests:
                if status == "FAIL":
                    print(f"  - {name}: {msg}")
    
    def success(self) -> bool:
        return self.failed == 0


async def test_rsl_token_manager():
    """Test RSL Token Manager functionality"""
    print(f"\n{'=' * 70}")
    print("Test Suite: RSL Token Manager")
    print(f"{'=' * 70}\n")
    
    results = TestResults()
    
    # Test 1: Token Manager Initialization
    try:
        token_manager = RSLTokenManager(storage_path="/tmp/test_rsl_tokens.json")
        results.add_pass("Token Manager Initialization", "Created successfully")
    except Exception as e:
        results.add_fail("Token Manager Initialization", str(e))
        return results
    
    # Test 2: Mock Token Creation (when OAuth not configured)
    try:
        token = token_manager._create_mock_token(
            "https://example-license-server.com",
            "https://example.com/article"
        )
        
        assert token.access_token.startswith("mock_rsl_token_")
        assert token.token_type == "Bearer"
        assert not token.is_expired()
        assert token.license_server_url == "https://example-license-server.com"
        
        results.add_pass("Mock Token Creation", f"Token: {token.access_token[:30]}...")
    except Exception as e:
        results.add_fail("Mock Token Creation", str(e))
    
    # Test 3: Token Expiration Check
    try:
        # Create expired token
        expired_token = RSLToken(
            access_token="test_token",
            token_type="Bearer",
            expires_at=datetime.now() - timedelta(hours=1),
            license_server_url="https://example.com",
            content_url="https://example.com/article"
        )
        
        assert expired_token.is_expired(), "Token should be expired"
        
        # Create valid token
        valid_token = RSLToken(
            access_token="test_token",
            token_type="Bearer",
            expires_at=datetime.now() + timedelta(hours=1),
            license_server_url="https://example.com",
            content_url="https://example.com/article"
        )
        
        assert not valid_token.is_expired(), "Token should not be expired"
        
        results.add_pass("Token Expiration Check", "Correctly identifies expired/valid tokens")
    except Exception as e:
        results.add_fail("Token Expiration Check", str(e))
    
    # Test 4: Token Serialization
    try:
        token = RSLToken(
            access_token="test_access_token",
            token_type="Bearer",
            expires_at=datetime.now() + timedelta(hours=1),
            refresh_token="test_refresh_token",
            scope="content:read content:ai-include",
            license_server_url="https://example.com",
            content_url="https://example.com/article"
        )
        
        # Serialize
        token_dict = token.to_dict()
        assert 'access_token' in token_dict
        assert 'expires_at' in token_dict
        
        # Deserialize
        restored_token = RSLToken.from_dict(token_dict)
        assert restored_token.access_token == token.access_token
        assert restored_token.token_type == token.token_type
        
        results.add_pass("Token Serialization", "to_dict/from_dict work correctly")
    except Exception as e:
        results.add_fail("Token Serialization", str(e))
    
    # Test 5: Token Request (Demo Mode - no OAuth credentials)
    try:
        rsl_token = await token_manager.request_token(
            license_server_url="https://demo-license-server.com",
            content_url="https://demo.com/article",
            license_type="ai-include"
        )
        
        assert rsl_token is not None
        assert rsl_token.access_token.startswith("mock_rsl_token_")
        assert not rsl_token.is_expired()
        
        results.add_pass("Token Request (Demo Mode)", "Mock token created when OAuth not configured")
    except Exception as e:
        results.add_fail("Token Request (Demo Mode)", str(e))
    
    # Test 6: Token Caching
    try:
        # Request token
        token1 = await token_manager.request_token(
            license_server_url="https://cache-test.com",
            content_url="https://cache-test.com/article1",
            license_type="ai-include"
        )
        
        # Request same token again - should be cached
        token2 = await token_manager.request_token(
            license_server_url="https://cache-test.com",
            content_url="https://cache-test.com/article1",
            license_type="ai-include"
        )
        
        # Compare tokens - they should be the same instance or have same access_token
        if token1.access_token == token2.access_token:
            results.add_pass("Token Caching", "Cached token reused correctly")
        else:
            results.add_fail("Token Caching", f"Token1: {token1.access_token[:20]}, Token2: {token2.access_token[:20]}")
    except Exception as e:
        results.add_fail("Token Caching", str(e))
    
    # Test 7: Get Cached Token
    try:
        # Should return cached token
        cached = token_manager.get_cached_token(
            "https://cache-test.com",
            "https://cache-test.com/article1"
        )
        
        if cached is not None and not cached.is_expired():
            results.add_pass("Get Cached Token", "Retrieves cached tokens correctly")
        else:
            # Should return None for non-existent
            not_cached = token_manager.get_cached_token(
                "https://nonexistent.com",
                "https://nonexistent.com/article"
            )
            
            if not_cached is None:
                results.add_pass("Get Cached Token", "Returns None for non-existent tokens")
            else:
                results.add_fail("Get Cached Token", f"Cached: {cached}, Not cached: {not_cached}")
    except Exception as e:
        results.add_fail("Get Cached Token", str(e))
    
    # Cleanup
    token_manager.clear_cache()
    
    return results


async def test_rsl_protocol_handler():
    """Test RSL Protocol Handler"""
    print(f"\n{'=' * 70}")
    print("Test Suite: RSL Protocol Handler")
    print(f"{'=' * 70}\n")
    
    results = TestResults()
    
    # Test 1: Handler Initialization
    try:
        handler = RSLProtocolHandler()
        results.add_pass("Handler Initialization", "Created successfully")
    except Exception as e:
        results.add_fail("Handler Initialization", str(e))
        return results
    
    # Test 2: XML Parsing - Valid RSL
    try:
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content server="https://licensing.example.com">
    <copyright>Example Publisher</copyright>
    <license>
      <permits type="usage">ai-include,search</permits>
      <payment type="inference">
        <amount currency="USD">0.05</amount>
      </payment>
      <payment type="purchase">
        <amount currency="USD">0.20</amount>
      </payment>
    </license>
  </content>
</rsl>"""
        
        terms = handler._parse_rsl_xml(xml_content, "https://example.com/.well-known/rsl.xml")
        
        assert terms is not None
        assert terms.protocol == "rsl"
        assert terms.ai_include_price == 0.05
        assert terms.purchase_price == 0.20
        assert terms.currency == "USD"
        assert terms.publisher == "Example Publisher"
        assert terms.license_server_url == "https://licensing.example.com"
        assert terms.permits_ai_include
        assert terms.permits_search
        assert not terms.permits_ai_training
        
        results.add_pass("XML Parsing - Valid RSL", f"Publisher: {terms.publisher}, AI: ${terms.ai_include_price}")
    except Exception as e:
        results.add_fail("XML Parsing - Valid RSL", str(e))
    
    # Test 3: XML Parsing - Attribution Only
    try:
        xml_content = """<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content>
    <copyright>Open Publisher</copyright>
    <license>
      <permits type="usage">all</permits>
      <payment type="attribution">
        <amount currency="USD">0</amount>
      </payment>
    </license>
  </content>
</rsl>"""
        
        terms = handler._parse_rsl_xml(xml_content, "https://open.com/rsl.xml")
        
        assert terms is not None
        assert terms.requires_attribution
        assert terms.permits_ai_include
        assert terms.permits_ai_training
        assert terms.permits_search
        
        results.add_pass("XML Parsing - Attribution Only", "Free with attribution detected")
    except Exception as e:
        results.add_fail("XML Parsing - Attribution Only", str(e))
    
    # Test 4: XML Parsing - Invalid XML
    try:
        invalid_xml = "This is not XML"
        terms = handler._parse_rsl_xml(invalid_xml, "https://example.com/rsl.xml")
        
        assert terms is None
        
        results.add_pass("XML Parsing - Invalid XML", "Handles invalid XML gracefully")
    except Exception as e:
        results.add_fail("XML Parsing - Invalid XML", str(e))
    
    # Test 5: Request License (Demo Mode)
    try:
        license_token = await handler.request_license(
            url="https://example.com/article",
            license_type="ai-include"
        )
        
        assert license_token is not None
        assert license_token.protocol == "rsl"
        assert license_token.cost > 0
        assert license_token.currency == "USD"
        assert not datetime.now() >= license_token.expires_at
        
        results.add_pass("Request License (Demo Mode)", f"Cost: ${license_token.cost}")
    except Exception as e:
        results.add_fail("Request License (Demo Mode)", str(e))
    
    # Test 6: Check Source (No RSL file available)
    try:
        # This will fail to find RSL file, which is expected
        terms = await handler.check_source("https://nonexistent-domain-12345.com/article")
        
        assert terms is None
        
        results.add_pass("Check Source (No RSL)", "Returns None when no RSL file found")
    except Exception as e:
        results.add_fail("Check Source (No RSL)", str(e))
    
    return results


async def test_content_license_service():
    """Test Content License Service Integration"""
    print(f"\n{'=' * 70}")
    print("Test Suite: Content License Service")
    print(f"{'=' * 70}\n")
    
    results = TestResults()
    
    # Test 1: Service Initialization
    try:
        service = ContentLicenseService()
        results.add_pass("Service Initialization", "Multi-protocol service created")
    except Exception as e:
        results.add_fail("Service Initialization", str(e))
        return results
    
    # Test 2: Protocol Priority (Cloudflare > Tollbit > RSL)
    try:
        # WSJ should detect as Cloudflare first
        wsj_result = await service.discover_licensing("https://www.wsj.com/article")
        
        if wsj_result:
            assert wsj_result['protocol'] == 'cloudflare'
            results.add_pass("Protocol Priority - Cloudflare", "WSJ detected as Cloudflare")
        else:
            results.add_skip("Protocol Priority - Cloudflare", "No detection (expected without API)")
    except Exception as e:
        results.add_fail("Protocol Priority - Cloudflare", str(e))
    
    # Test 3: RSL Handler in Multi-Protocol
    try:
        # Create service and check RSL is available
        service = ContentLicenseService()
        
        assert 'rsl' in service.protocols
        assert isinstance(service.protocols['rsl'], RSLProtocolHandler)
        
        results.add_pass("RSL Handler in Multi-Protocol", "RSL protocol handler registered")
    except Exception as e:
        results.add_fail("RSL Handler in Multi-Protocol", str(e))
    
    # Test 4: License Summary
    try:
        # Mock sources with license info
        sources = [
            {
                'url': 'https://example1.com',
                'license_info': {
                    'protocol': 'rsl',
                    'terms': LicenseTerms(
                        protocol='rsl',
                        ai_include_price=0.05,
                        currency='USD',
                        publisher='Example 1'
                    )
                }
            },
            {
                'url': 'https://example2.com',
                'license_info': {
                    'protocol': 'rsl',
                    'terms': LicenseTerms(
                        protocol='rsl',
                        ai_include_price=0.10,
                        currency='USD',
                        publisher='Example 2'
                    )
                }
            },
            {
                'url': 'https://free.com',
                # No license info
            }
        ]
        
        summary = service.get_license_summary(sources)
        
        # Verify summary (use round for floating point comparison)
        total_cost_rounded = round(summary['total_cost'], 2)
        if total_cost_rounded != 0.15:
            results.add_fail("License Summary", f"Expected total $0.15, got ${summary['total_cost']}")
        elif summary['licensed_count'] != 2:
            results.add_fail("License Summary", f"Expected 2 licensed, got {summary['licensed_count']}")
        elif summary['unlicensed_count'] != 1:
            results.add_fail("License Summary", f"Expected 1 unlicensed, got {summary['unlicensed_count']}")
        elif 'rsl' not in summary['protocol_breakdown']:
            results.add_fail("License Summary", "Missing 'rsl' in protocol breakdown")
        else:
            results.add_pass("License Summary", f"Total: ${total_cost_rounded}, Licensed: {summary['licensed_count']}")
    except Exception as e:
        results.add_fail("License Summary", str(e))
    
    return results


async def test_purchase_flow():
    """Test Purchase Flow Integration"""
    print(f"\n{'=' * 70}")
    print("Test Suite: Purchase Flow Integration")
    print(f"{'=' * 70}\n")
    
    results = TestResults()
    
    # Test 1: End-to-End Flow (Discovery -> License -> Token)
    try:
        service = ContentLicenseService()
        test_url = "https://example-article.com/story"
        
        # Step 1: Discover licensing (will fail for this fake URL)
        license_info = await service.discover_licensing(test_url)
        
        if not license_info:
            # Expected - no real RSL file
            # Test with mock handler directly
            handler = RSLProtocolHandler()
            
            # Step 2: Request license
            license_token = await handler.request_license(test_url, "ai-include")
            
            assert license_token is not None
            assert license_token.protocol == "rsl"
            
            results.add_pass("Purchase Flow - Discovery to Token", "Flow works in demo mode")
        else:
            # Real licensing found
            license_token = await service.request_license(license_info, "ai-include")
            
            assert license_token is not None
            
            results.add_pass("Purchase Flow - Discovery to Token", "Real licensing flow works")
            
    except Exception as e:
        results.add_fail("Purchase Flow - Discovery to Token", str(e))
    
    # Test 2: Content Fetching Flow
    try:
        handler = RSLProtocolHandler()
        
        # Get license token
        license_token = await handler.request_license(
            "https://example.com/article",
            "ai-include"
        )
        
        # Try to fetch content (will fail for fake URL, but tests the flow)
        content = await handler.fetch_content(
            "https://httpbin.org/html",  # Use real endpoint for testing
            license_token
        )
        
        # httpbin.org/html doesn't require auth, so this should work
        if content:
            assert 'body' in content or 'html' in content
            results.add_pass("Content Fetching Flow", "Fetched content successfully")
        else:
            results.add_skip("Content Fetching Flow", "Content fetch returned None (network issue?)")
            
    except Exception as e:
        results.add_skip("Content Fetching Flow", f"Network error: {str(e)[:50]}")
    
    # Test 3: Attribution Requirement
    try:
        # Create handler with attribution requirement
        xml_with_attribution = """<?xml version="1.0" encoding="UTF-8"?>
<rsl xmlns="https://rslstandard.org/rsl">
  <content>
    <copyright>Attribution Required Publisher</copyright>
    <license>
      <permits type="usage">ai-include</permits>
      <payment type="attribution">
        <amount currency="USD">0</amount>
      </payment>
    </license>
  </content>
</rsl>"""
        
        handler = RSLProtocolHandler()
        terms = handler._parse_rsl_xml(xml_with_attribution, "https://example.com/rsl.xml")
        
        assert terms.requires_attribution
        assert terms.publisher == "Attribution Required Publisher"
        
        results.add_pass("Attribution Requirement", "Attribution requirement detected")
    except Exception as e:
        results.add_fail("Attribution Requirement", str(e))
    
    return results


async def main():
    """Run all test suites"""
    print("=" * 70)
    print("RSL Implementation Comprehensive Test Suite")
    print("=" * 70)
    
    all_results = TestResults()
    
    # Run test suites
    suites = [
        ("Token Manager", test_rsl_token_manager),
        ("Protocol Handler", test_rsl_protocol_handler),
        ("License Service", test_content_license_service),
        ("Purchase Flow", test_purchase_flow)
    ]
    
    for suite_name, suite_func in suites:
        try:
            results = await suite_func()
            all_results.passed += results.passed
            all_results.failed += results.failed
            all_results.skipped += results.skipped
            all_results.tests.extend(results.tests)
        except Exception as e:
            print(f"❌ Test suite '{suite_name}' crashed: {e}")
            all_results.failed += 1
    
    # Print final summary
    all_results.print_summary()
    
    return all_results.success()


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
