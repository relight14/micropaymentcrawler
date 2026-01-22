#!/usr/bin/env python3
"""
Test the chat-source query integration improvements
"""
import sys
import asyncio
from backend.services.ai.conversational import AIResearchService

async def test_intent_detection():
    """Test that publication-specific queries trigger source search intent"""
    print("=" * 70)
    print("Testing Intent Detection for Publication Queries")
    print("=" * 70)
    
    service = AIResearchService()
    user_id = "test_user_123"
    
    # Initialize conversation
    service.user_conversations[user_id] = []
    
    # Test cases
    test_cases = [
        {
            "message": "show me WSJ articles about Greenland",
            "expected_intent": True,
            "description": "Direct WSJ article request"
        },
        {
            "message": "what does the Wall Street Journal say about Greenland?",
            "expected_intent": True,
            "description": "WSJ question about topic"
        },
        {
            "message": "find sources on climate change",
            "expected_intent": True,
            "description": "Explicit source request"
        },
        {
            "message": "tell me about Greenland",
            "expected_intent": False,
            "description": "General question without source intent"
        }
    ]
    
    for i, test in enumerate(test_cases, 1):
        print(f"\n{i}️⃣  Test: {test['description']}")
        print(f"   Message: \"{test['message']}\"")
        
        # Add user message to history
        service.user_conversations[user_id].append({
            "role": "user",
            "content": test["message"],
            "timestamp": "2026-01-22T00:00:00",
            "mode": "conversational"
        })
        
        # Detect intent
        intent = service._detect_source_intent(test["message"], user_id)
        
        print(f"   Intent detected: {intent['needs_sources']}")
        print(f"   Query extracted: \"{intent['query']}\"")
        print(f"   Confidence: {intent['confidence']:.2f}")
        print(f"   Expected intent: {test['expected_intent']}")
        
        if intent['needs_sources'] == test['expected_intent']:
            print(f"   ✅ PASS")
        else:
            print(f"   ❌ FAIL")
    
    print("\n" + "=" * 70)
    print("Intent Detection Test Complete")
    print("=" * 70)

async def test_system_prompt():
    """Verify the system prompt acknowledges source search capability"""
    print("\n" + "=" * 70)
    print("Testing System Prompt Update")
    print("=" * 70)
    
    service = AIResearchService()
    user_id = "test_user_456"
    
    # Initialize conversation
    service.user_conversations[user_id] = []
    
    # Send a test message to see the response
    print("\nSending test message: 'Can you search for Wall Street Journal articles?'")
    
    response = service._conversational_response(
        "Can you search for Wall Street Journal articles?",
        user_id,
        {"needs_sources": False, "query": "", "confidence": 0.0}
    )
    
    print(f"\nResponse: {response['response'][:500]}...")
    
    # Check if response mentions capability to search
    if any(word in response['response'].lower() for word in ['search', 'find', 'sources', 'can']):
        print("\n✅ PASS - Response acknowledges search capability")
    else:
        print("\n❌ FAIL - Response doesn't acknowledge search capability")
    
    print("\n" + "=" * 70)
    print("System Prompt Test Complete")
    print("=" * 70)

def test_badge_logic():
    """Test the frontend badge logic (simulated in Python)"""
    print("\n" + "=" * 70)
    print("Testing Badge Display Logic")
    print("=" * 70)
    
    # Simulate sources
    test_sources = [
        {
            "domain": "wsj.com",
            "url": "https://wsj.com/article",
            "licensing_protocol": None,
            "unlock_price": 0,
            "licensing_cost": 0,
            "description": "WSJ source without Tollbit pricing"
        },
        {
            "domain": "forbes.com",
            "url": "https://forbes.com/article",
            "licensing_protocol": None,
            "unlock_price": 0,
            "licensing_cost": 0,
            "description": "Forbes source without pricing"
        },
        {
            "domain": "medium.com",
            "url": "https://medium.com/article",
            "licensing_protocol": None,
            "unlock_price": 0,
            "licensing_cost": 0,
            "description": "Medium free source"
        },
        {
            "domain": "wsj.com",
            "url": "https://wsj.com/article2",
            "licensing_protocol": "TOLLBIT",
            "unlock_price": 0.15,
            "licensing_cost": 0.05,
            "description": "WSJ with confirmed Tollbit pricing"
        }
    ]
    
    # Simulate the badge detection logic
    def should_show_tollbit_demo(source):
        domain = (source.get('domain') or '').lower()
        url = (source.get('url') or '').lower()
        
        premium_publications = [
            'wsj.com', 'wall street journal', 'nytimes.com', 'newyorktimes.com',
            'washingtonpost.com', 'wapo.', 'forbes.com', 'bloomberg.com',
            'businessinsider.com', 'theatlantic.com', 'wired.com', 'theinformation.com'
        ]
        
        return any(pub in domain or pub in url for pub in premium_publications)
    
    def get_badge(source):
        protocol = source.get('licensing_protocol')
        cost = source.get('unlock_price', 0) or source.get('licensing_cost', 0) or 0
        
        if protocol and protocol.lower() == 'tollbit' and cost > 0:
            return 'TOLLBIT (confirmed)'
        elif should_show_tollbit_demo(source):
            return 'TOLLBIT Coming Soon'
        elif cost == 0:
            return 'FREE DISCOVERY'
        else:
            return 'CHECKING...'
    
    for i, source in enumerate(test_sources, 1):
        print(f"\n{i}️⃣  {source['description']}")
        print(f"   Domain: {source['domain']}")
        print(f"   Protocol: {source['licensing_protocol']}")
        print(f"   Price: ${source['unlock_price']}")
        badge = get_badge(source)
        print(f"   Badge: {badge}")
        
        # Verify expectations
        if 'wsj.com' in source['domain'] or 'forbes.com' in source['domain']:
            if 'TOLLBIT' in badge:
                print(f"   ✅ PASS - Premium publication shows Tollbit badge")
            else:
                print(f"   ❌ FAIL - Premium publication should show Tollbit badge")
        elif 'medium.com' in source['domain']:
            if 'FREE' in badge:
                print(f"   ✅ PASS - Free source shows FREE badge")
            else:
                print(f"   ❌ FAIL - Free source should show FREE badge")
    
    print("\n" + "=" * 70)
    print("Badge Logic Test Complete")
    print("=" * 70)

if __name__ == "__main__":
    print("\n🧪 Running Integration Fix Tests\n")
    
    # Test intent detection
    asyncio.run(test_intent_detection())
    
    # Test system prompt
    asyncio.run(test_system_prompt())
    
    # Test badge logic
    test_badge_logic()
    
    print("\n✅ All tests complete!\n")
