#!/usr/bin/env python3
"""
Comprehensive automated test suite for LedeWire Research Assistant
Tests: Chat suggestion, Research search, Report generation, Wallet integration
"""
import requests
import json
import time
from typing import Dict, Any, List
import sys

BASE_URL = "http://localhost:5000"
HEADERS = {"Content-Type": "application/json"}

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def log_test(msg: str):
    print(f"{Colors.BLUE}[TEST]{Colors.RESET} {msg}")

def log_success(msg: str):
    print(f"{Colors.GREEN}✓{Colors.RESET} {msg}")

def log_error(msg: str):
    print(f"{Colors.RED}✗{Colors.RESET} {msg}")

def log_warning(msg: str):
    print(f"{Colors.YELLOW}⚠{Colors.RESET} {msg}")

def log_section(msg: str):
    print(f"\n{Colors.BOLD}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{msg}{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*60}{Colors.RESET}\n")

# Test results tracking
test_results = {"passed": 0, "failed": 0, "warnings": 0}

def assert_test(condition: bool, success_msg: str, error_msg: str):
    if condition:
        log_success(success_msg)
        test_results["passed"] += 1
        return True
    else:
        log_error(error_msg)
        test_results["failed"] += 1
        return False

def test_chat_suggestion_logic():
    """Test 1: Chat-to-Research Suggestion Logic"""
    log_section("TEST 1: Chat-to-Research Suggestion Logic")
    
    # First message - should NOT suggest research
    log_test("Sending first user message...")
    payload = {
        "message": "What are the latest developments in renewable energy?",
        "user_id": "test_user_1"
    }
    
    resp = requests.post(f"{BASE_URL}/api/chat", json=payload, headers=HEADERS)
    assert_test(resp.status_code == 200, 
                "First message sent successfully",
                f"Failed to send first message: {resp.status_code}")
    
    data = resp.json()
    has_suggestion = data.get("suggest_research", False)
    assert_test(not has_suggestion,
                "✓ No research suggestion on first message (correct!)",
                "✗ Research suggested on first message (BUG!)")
    
    # Second message - should suggest research
    log_test("Sending second user message...")
    payload = {
        "message": "Tell me more about solar and wind power trends",
        "user_id": "test_user_1"
    }
    
    resp = requests.post(f"{BASE_URL}/api/chat", json=payload, headers=HEADERS)
    data = resp.json()
    has_suggestion = data.get("suggest_research", False)
    
    assert_test(has_suggestion,
                "✓ Research suggestion appears on second message (correct!)",
                "✗ No research suggestion on second message (BUG!)")
    
    if has_suggestion:
        topic = data.get("research_topic", "")
        assert_test(len(topic) > 0,
                    f"✓ Topic hint extracted: '{topic[:50]}...'",
                    "✗ No topic hint extracted")
    
    # Third message - should NOT suggest again
    log_test("Sending third user message...")
    payload = {
        "message": "What about hydrogen energy?",
        "user_id": "test_user_1"
    }
    
    resp = requests.post(f"{BASE_URL}/api/chat", json=payload, headers=HEADERS)
    data = resp.json()
    has_suggestion = data.get("suggest_research", False)
    
    assert_test(not has_suggestion,
                "✓ No duplicate suggestion on third message (correct!)",
                "✗ Duplicate suggestion on third message (BUG!)")
    
    # Clear conversation
    log_test("Clearing conversation...")
    resp = requests.post(f"{BASE_URL}/api/chat/clear", 
                        json={"user_id": "test_user_1"}, 
                        headers=HEADERS)
    assert_test(resp.status_code == 200,
                "✓ Conversation cleared successfully",
                "✗ Failed to clear conversation")

def test_research_search_flow():
    """Test 2: Research Search with Cache & Filtering"""
    log_section("TEST 2: Research Search Flow")
    
    # Test simple research query
    log_test("Executing research query: 'renewable energy innovations'...")
    payload = {
        "query": "renewable energy innovations",
        "context": "",
        "tier": "explore"
    }
    
    resp = requests.post(f"{BASE_URL}/api/research/analyze", json=payload, headers=HEADERS)
    assert_test(resp.status_code == 200,
                "✓ Research search executed successfully",
                f"✗ Research search failed: {resp.status_code}")
    
    data = resp.json()
    sources = data.get("sources", [])
    
    assert_test(len(sources) > 0,
                f"✓ Retrieved {len(sources)} sources",
                "✗ No sources returned")
    
    # Verify source structure
    if len(sources) > 0:
        first_source = sources[0]
        required_fields = ["id", "title", "url", "excerpt", "relevance_score"]
        
        for field in required_fields:
            assert_test(field in first_source,
                       f"✓ Source has '{field}' field",
                       f"✗ Source missing '{field}' field")
        
        # Check relevance score
        score = first_source.get("relevance_score", 0)
        assert_test(0 <= score <= 1,
                   f"✓ Relevance score valid: {score:.2f}",
                   f"✗ Invalid relevance score: {score}")
    
    # Test cache behavior
    log_test("Re-executing same query (should hit cache)...")
    start_time = time.time()
    resp2 = requests.post(f"{BASE_URL}/api/research/analyze", json=payload, headers=HEADERS)
    cache_time = time.time() - start_time
    
    assert_test(cache_time < 1.0,
                f"✓ Cache hit (response in {cache_time:.2f}s)",
                f"✗ Possible cache miss (took {cache_time:.2f}s)")
    
    data2 = resp2.json()
    sources2 = data2.get("sources", [])
    
    assert_test(len(sources) == len(sources2),
                "✓ Cache returns same source count",
                f"✗ Cache mismatch: {len(sources)} vs {len(sources2)}")

def test_report_generation():
    """Test 3: Report Generation with Citations"""
    log_section("TEST 3: Report Generation & Citations")
    
    # First get some sources
    log_test("Getting sources for report...")
    search_payload = {
        "query": "climate change impacts",
        "context": "",
        "tier": "research"
    }
    
    search_resp = requests.post(f"{BASE_URL}/api/research/analyze", 
                                json=search_payload, 
                                headers=HEADERS)
    search_data = search_resp.json()
    sources = search_data.get("sources", [])
    
    assert_test(len(sources) > 0,
                f"✓ Retrieved {len(sources)} sources for report",
                "✗ No sources available for report")
    
    if len(sources) == 0:
        log_warning("Skipping report tests - no sources available")
        return
    
    # Generate Research tier report (requires sources from analyze response)
    log_test("Generating Research tier report...")
    report_payload = {
        "query": "climate change impacts",
        "tier": "research"
    }
    
    report_resp = requests.post(f"{BASE_URL}/api/research/generate-report",
                                json=report_payload,
                                headers=HEADERS)
    
    assert_test(report_resp.status_code == 200,
                "✓ Report generated successfully",
                f"✗ Report generation failed: {report_resp.status_code}")
    
    report_data = report_resp.json()
    report_text = report_data.get("report", "")
    
    assert_test(len(report_text) > 200,
                f"✓ Report has substantial content ({len(report_text)} chars)",
                f"✗ Report too short ({len(report_text)} chars)")
    
    # Check for numbered citations
    import re
    citations = re.findall(r'\[(\d+)\]', report_text)
    
    assert_test(len(citations) > 0,
                f"✓ Report contains {len(citations)} numbered citations",
                "✗ Report missing numbered citations")
    
    # Check citation metadata
    citation_metadata = report_data.get("citation_metadata", [])
    assert_test(len(citation_metadata) > 0,
                f"✓ Citation metadata extracted ({len(citation_metadata)} citations)",
                "✗ No citation metadata found")

def test_wallet_integration():
    """Test 4: Wallet Integration (Mock Mode)"""
    log_section("TEST 4: Wallet Integration")
    
    # Test health check
    log_test("Checking API health...")
    resp = requests.get(f"{BASE_URL}/health")
    assert_test(resp.status_code == 200,
                "✓ API health check passed",
                f"✗ Health check failed: {resp.status_code}")
    
    # Test wallet balance (should work in mock mode)
    log_test("Testing wallet balance endpoint...")
    try:
        # This will fail without auth token, but endpoint should exist
        resp = requests.get(f"{BASE_URL}/api/wallet/balance")
        # We expect 401 or 403 without token, not 404
        assert_test(resp.status_code in [401, 403, 200],
                    "✓ Wallet endpoint exists (auth required)",
                    f"✗ Wallet endpoint error: {resp.status_code}")
    except Exception as e:
        log_warning(f"Wallet test skipped: {str(e)}")

def test_error_handling():
    """Test 5: Error Handling & Edge Cases"""
    log_section("TEST 5: Error Handling")
    
    # Test empty query
    log_test("Testing empty query handling...")
    resp = requests.post(f"{BASE_URL}/api/research/analyze",
                        json={"query": "", "context": "", "tier": "explore"},
                        headers=HEADERS)
    assert_test(resp.status_code in [400, 422],
                "✓ Empty query rejected properly",
                f"✗ Empty query handling issue: {resp.status_code}")
    
    # Test invalid tier
    log_test("Testing invalid tier handling...")
    resp = requests.post(f"{BASE_URL}/api/research/analyze",
                        json={"query": "test", "context": "", "tier": "invalid_tier"},
                        headers=HEADERS)
    assert_test(resp.status_code in [400, 422],
                "✓ Invalid tier rejected properly",
                f"✗ Invalid tier handling issue: {resp.status_code}")

def print_summary():
    """Print test summary"""
    log_section("TEST SUMMARY")
    
    total = test_results["passed"] + test_results["failed"]
    passed_pct = (test_results["passed"] / total * 100) if total > 0 else 0
    
    print(f"Total Tests: {total}")
    print(f"{Colors.GREEN}Passed: {test_results['passed']}{Colors.RESET}")
    print(f"{Colors.RED}Failed: {test_results['failed']}{Colors.RESET}")
    print(f"{Colors.YELLOW}Warnings: {test_results['warnings']}{Colors.RESET}")
    print(f"\nSuccess Rate: {Colors.BOLD}{passed_pct:.1f}%{Colors.RESET}\n")
    
    if test_results["failed"] == 0:
        print(f"{Colors.GREEN}{Colors.BOLD}🎉 ALL TESTS PASSED!{Colors.RESET}")
        print(f"{Colors.GREEN}Application is ready for deployment.{Colors.RESET}\n")
        return 0
    else:
        print(f"{Colors.RED}{Colors.BOLD}⚠️  TESTS FAILED{Colors.RESET}")
        print(f"{Colors.RED}Please fix issues before deployment.{Colors.RESET}\n")
        return 1

def main():
    print(f"\n{Colors.BOLD}LedeWire Research Assistant - Automated Test Suite{Colors.RESET}")
    print(f"{Colors.BOLD}{'='*60}{Colors.RESET}\n")
    
    try:
        # Run all tests
        test_chat_suggestion_logic()
        test_research_search_flow()
        test_report_generation()
        test_wallet_integration()
        test_error_handling()
        
        # Print summary
        exit_code = print_summary()
        sys.exit(exit_code)
        
    except Exception as e:
        log_error(f"Test suite failed with exception: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
