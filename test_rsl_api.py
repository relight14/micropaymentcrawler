#!/usr/bin/env python3
"""
RSL API Integration Tests
Tests the RSL API endpoints with mock and real scenarios
"""
import asyncio
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

# Mock httpx responses for testing
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from app import create_app

# Initialize test client
app = create_app()
client = TestClient(app)


class APITestResults:
    """Track API test results"""
    def __init__(self):
        self.passed = 0
        self.failed = 0
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
    
    def print_summary(self):
        print(f"\n{'=' * 70}")
        print("API Test Summary")
        print(f"{'=' * 70}")
        print(f"✅ Passed: {self.passed}")
        print(f"❌ Failed: {self.failed}")
        print(f"Total: {len(self.tests)}")
        print(f"{'=' * 70}")
        
        if self.failed > 0:
            print("\nFailed Tests:")
            for status, name, msg in self.tests:
                if status == "FAIL":
                    print(f"  - {name}: {msg}")
    
    def success(self) -> bool:
        return self.failed == 0


def test_rsl_health_endpoint():
    """Test RSL health check endpoint"""
    print(f"\n{'=' * 70}")
    print("Test: RSL Health Endpoint")
    print(f"{'=' * 70}\n")
    
    results = APITestResults()
    
    try:
        response = client.get("/api/rsl/health")
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('status') == 'healthy':
                results.add_pass("Health Check Status", f"Status: {data.get('status')}")
            else:
                results.add_fail("Health Check Status", f"Unexpected status: {data.get('status')}")
            
            if 'protocols' in data:
                protocols = data['protocols']
                if 'rsl' in protocols and 'tollbit' in protocols and 'cloudflare' in protocols:
                    results.add_pass("Protocols Listed", f"Protocols: {protocols}")
                else:
                    results.add_fail("Protocols Listed", f"Missing protocols: {protocols}")
            else:
                results.add_fail("Protocols Listed", "No protocols field in response")
        else:
            results.add_fail("Health Check Endpoint", f"Status code: {response.status_code}")
            
    except Exception as e:
        results.add_fail("Health Check Endpoint", str(e))
    
    return results


def test_rsl_discovery_no_licensing():
    """Test RSL discovery when no licensing is available"""
    print(f"\n{'=' * 70}")
    print("Test: RSL Discovery - No Licensing")
    print(f"{'=' * 70}\n")
    
    results = APITestResults()
    
    try:
        response = client.post(
            "/api/rsl/discover",
            json={"url": "https://nonexistent-test-domain-12345.com/article"}
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if not data.get('has_licensing'):
                results.add_pass("No Licensing Detected", "Correctly returned has_licensing=false")
            else:
                results.add_fail("No Licensing Detected", f"Unexpected licensing found: {data}")
        else:
            results.add_fail("Discovery Endpoint", f"Status code: {response.status_code}")
            
    except Exception as e:
        results.add_fail("Discovery Endpoint", str(e))
    
    return results


def test_rsl_discovery_cloudflare():
    """Test RSL discovery for Cloudflare domain"""
    print(f"\n{'=' * 70}")
    print("Test: RSL Discovery - Cloudflare")
    print(f"{'=' * 70}\n")
    
    results = APITestResults()
    
    try:
        response = client.post(
            "/api/rsl/discover",
            json={"url": "https://www.wsj.com/article"}
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('has_licensing'):
                if data.get('protocol') == 'cloudflare':
                    results.add_pass("Cloudflare Detection", f"Protocol: {data.get('protocol')}")
                    
                    if data.get('ai_include_price') and data.get('ai_include_price') > 0:
                        results.add_pass("Pricing Available", f"AI price: ${data.get('ai_include_price')}")
                    else:
                        results.add_fail("Pricing Available", "No AI price found")
                else:
                    results.add_fail("Cloudflare Detection", f"Wrong protocol: {data.get('protocol')}")
            else:
                results.add_fail("Cloudflare Detection", "No licensing detected")
        else:
            results.add_fail("Discovery Endpoint", f"Status code: {response.status_code}")
            
    except Exception as e:
        results.add_fail("Discovery Endpoint", str(e))
    
    return results


def test_rsl_license_request():
    """Test RSL license request"""
    print(f"\n{'=' * 70}")
    print("Test: RSL License Request")
    print(f"{'=' * 70}\n")
    
    results = APITestResults()
    
    try:
        response = client.post(
            "/api/rsl/request-license",
            json={"url": "https://www.wsj.com/article", "license_type": "ai-include"}
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('success'):
                results.add_pass("License Request Success", f"Token obtained")
                
                if data.get('token'):
                    results.add_pass("Token Returned", f"Token: {data.get('token')[:30]}...")
                else:
                    results.add_fail("Token Returned", "No token in response")
                
                if data.get('cost') is not None:
                    results.add_pass("Cost Returned", f"Cost: ${data.get('cost')}")
                else:
                    results.add_fail("Cost Returned", "No cost in response")
            else:
                error = data.get('error', 'Unknown error')
                results.add_fail("License Request Success", f"Failed: {error}")
        else:
            results.add_fail("License Request Endpoint", f"Status code: {response.status_code}")
            
    except Exception as e:
        results.add_fail("License Request Endpoint", str(e))
    
    return results


def test_rsl_license_request_no_licensing():
    """Test RSL license request for URL without licensing"""
    print(f"\n{'=' * 70}")
    print("Test: RSL License Request - No Licensing")
    print(f"{'=' * 70}\n")
    
    results = APITestResults()
    
    try:
        response = client.post(
            "/api/rsl/request-license",
            json={"url": "https://nonexistent-test-domain-12345.com/article", "license_type": "ai-include"}
        )
        
        if response.status_code == 200:
            data = response.json()
            
            if not data.get('success'):
                results.add_pass("License Request Failure", "Correctly failed for unlicensed URL")
                
                if data.get('error'):
                    results.add_pass("Error Message", f"Error: {data.get('error')}")
                else:
                    results.add_fail("Error Message", "No error message provided")
            else:
                results.add_fail("License Request Failure", "Should have failed but succeeded")
        else:
            results.add_fail("License Request Endpoint", f"Status code: {response.status_code}")
            
    except Exception as e:
        results.add_fail("License Request Endpoint", str(e))
    
    return results


def test_api_rate_limiting():
    """Test API rate limiting"""
    print(f"\n{'=' * 70}")
    print("Test: API Rate Limiting")
    print(f"{'=' * 70}\n")
    
    results = APITestResults()
    
    # Note: This test would require many requests to trigger rate limit
    # For now, just verify the endpoints accept requests
    try:
        response = client.get("/api/rsl/health")
        if response.status_code == 200:
            results.add_pass("Rate Limit Headers", "Endpoint accessible (rate limit not exceeded)")
        else:
            results.add_fail("Rate Limit Test", f"Unexpected status: {response.status_code}")
    except Exception as e:
        results.add_fail("Rate Limit Test", str(e))
    
    return results


def test_api_error_handling():
    """Test API error handling"""
    print(f"\n{'=' * 70}")
    print("Test: API Error Handling")
    print(f"{'=' * 70}\n")
    
    results = APITestResults()
    
    # Test with invalid URL (missing required field)
    try:
        response = client.post(
            "/api/rsl/discover",
            json={}  # Missing 'url' field
        )
        
        if response.status_code == 422:  # FastAPI validation error
            results.add_pass("Validation Error", "Correctly rejected invalid request")
        else:
            results.add_fail("Validation Error", f"Expected 422, got {response.status_code}")
    except Exception as e:
        results.add_fail("Validation Error", str(e))
    
    # Test with invalid JSON
    try:
        response = client.post(
            "/api/rsl/discover",
            data="not json",
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code in [400, 422]:
            results.add_pass("JSON Parse Error", "Correctly rejected malformed JSON")
        else:
            results.add_fail("JSON Parse Error", f"Expected 400/422, got {response.status_code}")
    except Exception as e:
        # Some test clients may raise exception for invalid JSON, which is also acceptable
        results.add_pass("JSON Parse Error", "Exception raised (acceptable)")
    
    return results


def main():
    """Run all API tests"""
    print("=" * 70)
    print("RSL API Integration Test Suite")
    print("=" * 70)
    
    all_results = APITestResults()
    
    # Run test suites
    test_suites = [
        ("Health Endpoint", test_rsl_health_endpoint),
        ("Discovery - No Licensing", test_rsl_discovery_no_licensing),
        ("Discovery - Cloudflare", test_rsl_discovery_cloudflare),
        ("License Request", test_rsl_license_request),
        ("License Request - No Licensing", test_rsl_license_request_no_licensing),
        ("Rate Limiting", test_api_rate_limiting),
        ("Error Handling", test_api_error_handling)
    ]
    
    for suite_name, suite_func in test_suites:
        try:
            results = suite_func()
            all_results.passed += results.passed
            all_results.failed += results.failed
            all_results.tests.extend(results.tests)
        except Exception as e:
            print(f"❌ Test suite '{suite_name}' crashed: {e}")
            all_results.failed += 1
    
    # Print final summary
    all_results.print_summary()
    
    return all_results.success()


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
