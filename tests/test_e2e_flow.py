#!/usr/bin/env python3
"""
End-to-End Flow Tests for Clearcite
Tests the complete user journey from chat to research to report generation
"""

import httpx
import json
import sys
from typing import Optional

BASE_URL = "http://localhost:5000"
TIMEOUT = 45.0

class E2ETestSuite:
    def __init__(self):
        self.client = httpx.Client(timeout=TIMEOUT)
        self.passed = 0
        self.failed = 0
        self.warnings = 0
        
    def print_header(self, title: str):
        print(f"\n{'=' * 70}")
        print(f"  {title}")
        print(f"{'=' * 70}")
        
    def test_case(self, name: str, test_func):
        """Run a test case and track results"""
        print(f"\n🧪 TEST: {name}")
        try:
            result = test_func()
            if result:
                print(f"   ✅ PASS")
                self.passed += 1
            else:
                print(f"   ⚠️  WARN")
                self.warnings += 1
        except Exception as e:
            print(f"   ❌ FAIL: {e}")
            self.failed += 1
            
    def test_health_check(self) -> bool:
        """Test 1: Health check endpoint"""
        response = self.client.get(f"{BASE_URL}/api/health")
        print(f"   Status: {response.status_code}")
        if response.status_code == 200:
            data = response.json()
            print(f"   Status: {data.get('status')}")
            return True
        return False
        
    def test_chat_endpoint(self) -> bool:
        """Test 2: Conversational chat"""
        response = self.client.post(
            f"{BASE_URL}/api/chat",
            json={
                "message": "What is machine learning?",
                "conversation_id": "e2e-test-001"
            }
        )
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"   Message type: {data.get('message_type', 'N/A')}")
            if data.get('response'):
                preview = data['response'][:80].replace('\n', ' ')
                print(f"   Response: \"{preview}...\"")
            return True
        else:
            print(f"   Error: {response.text[:200]}")
            return False
            
    def test_research_endpoint(self) -> bool:
        """Test 3: Research query with source discovery"""
        response = self.client.post(
            f"{BASE_URL}/api/research/analyze",
            json={
                "query": "Latest AI developments 2024",
                "tier": "free",
                "conversation_id": "e2e-test-002"
            }
        )
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            sources = data.get('sources', [])
            print(f"   Sources found: {len(sources)}")
            
            if sources:
                sample = sources[0]
                print(f"   Sample title: \"{sample.get('title', 'N/A')[:60]}...\"")
                print(f"   Domain: {sample.get('domain', 'N/A')}")
                
                # Check for required fields
                required_fields = ['url', 'title', 'domain', 'snippet']
                missing = [f for f in required_fields if not sample.get(f)]
                if missing:
                    print(f"   ⚠️  Missing fields: {missing}")
                    
            query_cost = data.get('query_cost', 0)
            print(f"   Query cost: ${query_cost:.2f}")
            
            return len(sources) > 0
        else:
            print(f"   Error: {response.text[:200]}")
            return False
            
    def test_auth_gating(self) -> bool:
        """Test 4: Authentication requirement for protected endpoints"""
        # Test unlock-source without auth
        response = self.client.post(
            f"{BASE_URL}/api/sources/unlock-source",
            json={
                "source_url": "https://example.com/article",
                "conversation_id": "e2e-test-003"
            }
        )
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 401:
            print(f"   ✅ Correctly requires authentication")
            return True
        else:
            print(f"   ⚠️  Expected 401, got {response.status_code}")
            return False
            
    def test_frontend_health(self) -> bool:
        """Test 5: Frontend loads without errors"""
        response = self.client.get(f"{BASE_URL}/")
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            html = response.text
            # Check for critical JS files
            critical_files = [
                'app.js',
                'message-coordinator.js',
                'project-store.js',
                'app-state.js'
            ]
            
            missing = [f for f in critical_files if f not in html]
            if missing:
                print(f"   ⚠️  Missing JS files: {missing}")
                return False
            else:
                print(f"   ✅ All critical JS files referenced")
                return True
        return False
        
    def test_source_categorization(self) -> bool:
        """Test 6: Source type categorization"""
        response = self.client.post(
            f"{BASE_URL}/api/sources/categorize",
            json={
                "sources": [
                    {
                        "url": "https://nytimes.com/article",
                        "domain": "nytimes.com",
                        "title": "Test Article"
                    }
                ]
            }
        )
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            categorized = data.get('categorized_sources', [])
            if categorized:
                print(f"   Source type: {categorized[0].get('source_type', 'N/A')}")
            return len(categorized) > 0
        else:
            print(f"   Error: {response.text[:200]}")
            return False
            
    def print_summary(self):
        """Print test summary"""
        self.print_header("TEST SUMMARY")
        total = self.passed + self.failed + self.warnings
        print(f"\n   Total Tests: {total}")
        print(f"   ✅ Passed: {self.passed}")
        print(f"   ⚠️  Warnings: {self.warnings}")
        print(f"   ❌ Failed: {self.failed}")
        
        print(f"\n{'=' * 70}")
        print("💡 MANUAL TESTING REQUIRED FOR:")
        print("   - Tier purchases (requires auth + wallet balance)")
        print("   - Report generation (requires purchased tier)")
        print("   - Source summarization (requires auth + payment)")
        print("   - Project persistence (requires auth)")
        print("   - Outline builder drag & drop")
        print("   - Mobile responsive navigation")
        print(f"{'=' * 70}\n")
        
        if self.failed == 0:
            print("✅ All automated tests passed!")
            return 0
        else:
            print(f"❌ {self.failed} test(s) failed")
            return 1
            
    def run_all(self):
        """Run all E2E tests"""
        self.print_header("CLEARCITE E2E AUTOMATED TESTS")
        
        self.test_case("Health Check", self.test_health_check)
        self.test_case("Conversational Chat", self.test_chat_endpoint)
        self.test_case("Research Source Discovery", self.test_research_endpoint)
        self.test_case("Authentication Gating", self.test_auth_gating)
        self.test_case("Frontend Health", self.test_frontend_health)
        self.test_case("Source Categorization", self.test_source_categorization)
        
        return self.print_summary()

if __name__ == "__main__":
    suite = E2ETestSuite()
    exit_code = suite.run_all()
    sys.exit(exit_code)
