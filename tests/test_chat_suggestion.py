#!/usr/bin/env python3
"""
Manual test for chat-to-research suggestion with fresh state
"""
import requests
import json

BASE_URL = "http://localhost:5000"

def test_suggestion():
    print("=" * 60)
    print("Testing Chat-to-Research Suggestion (Fresh State)")
    print("=" * 60)
    
    # Message 1 - should NOT suggest
    print("\n1️⃣  Sending FIRST message...")
    resp1 = requests.post(f"{BASE_URL}/api/chat", 
                         json={"message": "What's happening with climate change policy?"},
                         headers={"Content-Type": "application/json"})
    data1 = resp1.json()
    print(f"   Suggest research: {data1.get('suggest_research', False)}")
    print(f"   Expected: False")
    print(f"   Result: {'✅ PASS' if not data1.get('suggest_research') else '❌ FAIL'}")
    
    # Message 2 - SHOULD suggest (if research-worthy)
    print("\n2️⃣  Sending SECOND message...")
    resp2 = requests.post(f"{BASE_URL}/api/chat",
                         json={"message": "Tell me about the latest renewable energy policies"},
                         headers={"Content-Type": "application/json"})
    data2 = resp2.json()
    suggest = data2.get('suggest_research', False)
    topic = data2.get('research_topic', '') or data2.get('topic_hint', '')
    print(f"   Suggest research: {suggest}")
    print(f"   Topic hint: {topic}")
    print(f"   Expected: True (should suggest on 2nd message)")
    print(f"   Result: {'✅ PASS' if suggest else '❌ FAIL'}")
    
    # Message 3 - should NOT suggest again
    print("\n3️⃣  Sending THIRD message...")
    resp3 = requests.post(f"{BASE_URL}/api/chat",
                         json={"message": "What about solar energy?"},
                         headers={"Content-Type": "application/json"})
    data3 = resp3.json()
    print(f"   Suggest research: {data3.get('suggest_research', False)}")
    print(f"   Expected: False (already suggested)")
    print(f"   Result: {'✅ PASS' if not data3.get('suggest_research') else '❌ FAIL'}")
    
    print("\n" + "=" * 60)
    print("Test Complete!")
    print("=" * 60)

if __name__ == "__main__":
    test_suggestion()
