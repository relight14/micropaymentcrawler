#!/usr/bin/env python3
"""
Test to verify Tollbit API parameters are correct
This test verifies that we're not sending invalid parameters like 'format'
"""
import asyncio
import sys
import os
from unittest.mock import AsyncMock, patch, MagicMock
from backend.services.licensing.content_licensing import TollbitProtocolHandler

async def test_api_parameters():
    """Test that API requests use correct parameters"""
    
    print("=" * 70)
    print("Tollbit API Parameters Test")
    print("=" * 70)
    
    # Set a mock API key
    os.environ['TOLLBIT_API_KEY'] = 'test_key_12345'
    
    handler = TollbitProtocolHandler()
    
    test_url = "https://www.forbes.com/test-article"
    
    passed = 0
    failed = 0
    
    # Test _check_pricing parameters
    print("\n1. Testing _check_pricing API parameters...")
    
    with patch.object(handler, '_get_client') as mock_get_client:
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'token': 'test_token_abc123'}
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client
        
        await handler._check_pricing(test_url)
        
        # Verify the API was called
        if mock_client.post.called:
            call_args = mock_client.post.call_args
            payload = call_args.kwargs.get('json', {})
            
            print(f"   Payload sent: {payload}")
            
            # Check required parameters
            required_params = ['url', 'userAgent', 'licenseType', 'maxPriceMicros', 'currency']
            missing_params = [p for p in required_params if p not in payload]
            
            if missing_params:
                print(f"   ❌ Missing required parameters: {missing_params}")
                failed += 1
            else:
                print(f"   ✅ All required parameters present")
                passed += 1
            
            # Check for invalid parameters
            if 'format' in payload:
                print(f"   ❌ Invalid 'format' parameter found in payload!")
                failed += 1
            else:
                print(f"   ✅ No invalid 'format' parameter")
                passed += 1
            
            # Verify currency is present
            if payload.get('currency') == 'USD':
                print(f"   ✅ Currency parameter is correct: USD")
                passed += 1
            else:
                print(f"   ❌ Currency parameter missing or incorrect: {payload.get('currency')}")
                failed += 1
        else:
            print(f"   ❌ API was not called")
            failed += 1
    
    # Test _mint_token parameters
    print("\n2. Testing _mint_token API parameters...")
    
    with patch.object(handler, '_get_client') as mock_get_client:
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'token': 'test_token_xyz789'}
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client
        
        await handler._mint_token(test_url, "ON_DEMAND_LICENSE")
        
        # Verify the API was called
        if mock_client.post.called:
            call_args = mock_client.post.call_args
            payload = call_args.kwargs.get('json', {})
            
            print(f"   Payload sent: {payload}")
            
            # Check required parameters
            required_params = ['url', 'userAgent', 'licenseType', 'maxPriceMicros', 'currency']
            missing_params = [p for p in required_params if p not in payload]
            
            if missing_params:
                print(f"   ❌ Missing required parameters: {missing_params}")
                failed += 1
            else:
                print(f"   ✅ All required parameters present")
                passed += 1
            
            # Check for invalid parameters
            if 'format' in payload:
                print(f"   ❌ Invalid 'format' parameter found in payload!")
                failed += 1
            else:
                print(f"   ✅ No invalid 'format' parameter")
                passed += 1
            
            # Verify currency is present
            if payload.get('currency') == 'USD':
                print(f"   ✅ Currency parameter is correct: USD")
                passed += 1
            else:
                print(f"   ❌ Currency parameter missing or incorrect: {payload.get('currency')}")
                failed += 1
        else:
            print(f"   ❌ API was not called")
            failed += 1
    
    # Test full-access tier
    print("\n3. Testing _mint_token with full-access tier...")
    
    with patch.object(handler, '_get_client') as mock_get_client:
        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'token': 'test_token_full_123'}
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_get_client.return_value = mock_client
        
        await handler._mint_token(test_url, "ON_DEMAND_FULL_USE_LICENSE")
        
        # Verify the API was called
        if mock_client.post.called:
            call_args = mock_client.post.call_args
            payload = call_args.kwargs.get('json', {})
            
            print(f"   Payload sent: {payload}")
            
            # Verify license type
            if payload.get('licenseType') == 'ON_DEMAND_FULL_USE_LICENSE':
                print(f"   ✅ License type is correct: ON_DEMAND_FULL_USE_LICENSE")
                passed += 1
            else:
                print(f"   ❌ License type incorrect: {payload.get('licenseType')}")
                failed += 1
            
            # Check for invalid parameters
            if 'format' in payload:
                print(f"   ❌ Invalid 'format' parameter found in payload!")
                failed += 1
            else:
                print(f"   ✅ No invalid 'format' parameter")
                passed += 1
        else:
            print(f"   ❌ API was not called")
            failed += 1
    
    # Summary
    print(f"\n{'=' * 70}")
    print("Test Summary")
    print(f"{'=' * 70}")
    print(f"✅ Passed: {passed}")
    print(f"❌ Failed: {failed}")
    print(f"{'=' * 70}")
    
    return failed == 0

if __name__ == "__main__":
    success = asyncio.run(test_api_parameters())
    sys.exit(0 if success else 1)
