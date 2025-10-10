#!/usr/bin/env python3
"""
Regression test for chat-to-research suggestion with no topic hint
Tests that suggestion flag is set even when topic extraction fails
"""
import requests
import json

BASE_URL = "http://localhost:5000"

def test_suggestion_without_topic():
    print("=" * 60)
    print("Testing Suggestion Logic (No Topic Hint Scenario)")
    print("=" * 60)
    
    # Message 1 - generic, no research intent
    print("\n1️⃣  Sending FIRST message (generic)...")
    resp1 = requests.post(f"{BASE_URL}/api/chat", 
                         json={"message": "Hello, how are you?"},
                         headers={"Content-Type": "application/json"})
    data1 = resp1.json()
    print(f"   Suggest research: {data1.get('suggest_research', False)}")
    print(f"   Result: {'✅ PASS' if not data1.get('suggest_research') else '❌ FAIL'}")
    
    # Message 2 - research-worthy but may not extract clean topic
    print("\n2️⃣  Sending SECOND message (research-worthy, unclear topic)...")
    resp2 = requests.post(f"{BASE_URL}/api/chat",
                         json={"message": "What's new?"},  # Vague, may fail topic extraction
                         headers={"Content-Type": "application/json"})
    data2 = resp2.json()
    suggest = data2.get('suggest_research', False)
    topic = data2.get('research_topic', '') or data2.get('topic_hint', '')
    print(f"   Suggest research: {suggest}")
    print(f"   Topic hint: {topic if topic else '(none)'}")
    print(f"   Note: Suggestion may or may not appear based on intent detection")
    
    # Message 3 - DEFINITE research intent
    print("\n3️⃣  Sending THIRD message (clear research intent)...")
    resp3 = requests.post(f"{BASE_URL}/api/chat",
                         json={"message": "Tell me about climate policy developments"},
                         headers={"Content-Type": "application/json"})
    data3 = resp3.json()
    suggest3 = data3.get('suggest_research', False)
    topic3 = data3.get('research_topic', '') or data3.get('topic_hint', '')
    print(f"   Suggest research: {suggest3}")
    print(f"   Topic hint: {topic3 if topic3 else '(none)'}")
    
    # Message 4 - should NOT suggest (already suggested)
    print("\n4️⃣  Sending FOURTH message...")
    resp4 = requests.post(f"{BASE_URL}/api/chat",
                         json={"message": "What about renewable energy?"},
                         headers={"Content-Type": "application/json"})
    data4 = resp4.json()
    suggest4 = data4.get('suggest_research', False)
    print(f"   Suggest research: {suggest4}")
    print(f"   Expected: False (already suggested)")
    print(f"   Result: {'✅ PASS' if not suggest4 else '❌ FAIL - DUPLICATE BUG!'}")
    
    print("\n" + "=" * 60)
    
    if suggest4:
        print("❌ CRITICAL: Duplicate suggestion detected!")
        print("   This means the flag was not set properly.")
        return False
    else:
        print("✅ Test Complete: No duplicate suggestions!")
        return True

if __name__ == "__main__":
    success = test_suggestion_without_topic()
    exit(0 if success else 1)
