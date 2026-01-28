"""
Unit tests for PricingService
"""

import unittest
import sys
import os
from unittest.mock import Mock, patch, MagicMock

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from services.pricing_service import PricingService
from schemas.domain import SourceCard


class TestPricingService(unittest.TestCase):
    """Test cases for PricingService"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.pricing_service = PricingService()
        
        # Create sample source cards
        self.source1 = SourceCard(
            id="source1",
            title="Test Source 1",
            url="https://example.com/1",
            excerpt="Test excerpt 1",
            domain="example.com",
            unlock_price=0.05,
            is_unlocked=False
        )
        
        self.source2 = SourceCard(
            id="source2",
            title="Test Source 2",
            url="https://example.com/2",
            excerpt="Test excerpt 2",
            domain="example.com",
            unlock_price=0.05,
            is_unlocked=False
        )
        
        self.source3 = SourceCard(
            id="source3",
            title="Test Source 3",
            url="https://example.com/3",
            excerpt="Test excerpt 3",
            domain="example.com",
            unlock_price=0.05,
            is_unlocked=False
        )
    
    @patch('services.pricing_service.ResearchLedger')
    def test_calculate_incremental_pricing_no_previous_purchases(self, mock_ledger_class):
        """Test pricing calculation when user has no previous purchases"""
        # Mock the ledger to return no previous purchases
        mock_ledger = Mock()
        mock_ledger.get_previous_purchase_sources.return_value = []
        self.pricing_service.ledger = mock_ledger
        
        sources = [self.source1, self.source2, self.source3]
        result = self.pricing_service.calculate_incremental_pricing(
            user_id="user_test123",
            query="test query",
            sources=sources
        )
        
        # All 3 sources should be new
        self.assertEqual(result['new_source_count'], 3)
        self.assertEqual(result['previous_source_count'], 0)
        self.assertEqual(result['total_source_count'], 3)
        self.assertEqual(result['calculated_price'], 0.15)  # 3 * 0.05
        
        # Verify ledger was called correctly
        mock_ledger.get_previous_purchase_sources.assert_called_once_with("user_test123", "test query")
    
    @patch('services.pricing_service.ResearchLedger')
    def test_calculate_incremental_pricing_with_previous_purchases(self, mock_ledger_class):
        """Test pricing calculation when user has some previous purchases"""
        # Mock the ledger to return some previous purchases
        mock_ledger = Mock()
        mock_ledger.get_previous_purchase_sources.return_value = ["source1", "source2"]
        self.pricing_service.ledger = mock_ledger
        
        sources = [self.source1, self.source2, self.source3]
        result = self.pricing_service.calculate_incremental_pricing(
            user_id="user_test123",
            query="test query",
            sources=sources
        )
        
        # Only source3 should be new
        self.assertEqual(result['new_source_count'], 1)
        self.assertEqual(result['previous_source_count'], 2)
        self.assertEqual(result['total_source_count'], 3)
        self.assertEqual(result['calculated_price'], 0.05)  # 1 * 0.05
    
    @patch('services.pricing_service.ResearchLedger')
    def test_calculate_incremental_pricing_all_previously_purchased(self, mock_ledger_class):
        """Test pricing calculation when all sources were previously purchased"""
        # Mock the ledger to return all sources as previously purchased
        mock_ledger = Mock()
        mock_ledger.get_previous_purchase_sources.return_value = ["source1", "source2", "source3"]
        self.pricing_service.ledger = mock_ledger
        
        sources = [self.source1, self.source2, self.source3]
        result = self.pricing_service.calculate_incremental_pricing(
            user_id="user_test123",
            query="test query",
            sources=sources
        )
        
        # No new sources
        self.assertEqual(result['new_source_count'], 0)
        self.assertEqual(result['previous_source_count'], 3)
        self.assertEqual(result['total_source_count'], 3)
        self.assertEqual(result['calculated_price'], 0.0)
    
    @patch('services.pricing_service.ResearchLedger')
    def test_calculate_incremental_pricing_empty_sources(self, mock_ledger_class):
        """Test pricing calculation with empty sources list"""
        mock_ledger = Mock()
        mock_ledger.get_previous_purchase_sources.return_value = []
        self.pricing_service.ledger = mock_ledger
        
        result = self.pricing_service.calculate_incremental_pricing(
            user_id="user_test123",
            query="test query",
            sources=[]
        )
        
        # Everything should be 0
        self.assertEqual(result['new_source_count'], 0)
        self.assertEqual(result['previous_source_count'], 0)
        self.assertEqual(result['total_source_count'], 0)
        self.assertEqual(result['calculated_price'], 0.0)
    
    @patch('services.pricing_service.ResearchLedger')
    def test_calculate_incremental_pricing_partial_overlap(self, mock_ledger_class):
        """Test pricing calculation with partial overlap of sources"""
        # Mock ledger with some overlap
        mock_ledger = Mock()
        mock_ledger.get_previous_purchase_sources.return_value = ["source1", "source4", "source5"]
        self.pricing_service.ledger = mock_ledger
        
        sources = [self.source1, self.source2, self.source3]
        result = self.pricing_service.calculate_incremental_pricing(
            user_id="user_test123",
            query="test query",
            sources=sources
        )
        
        # source1 is owned, source2 and source3 are new
        self.assertEqual(result['new_source_count'], 2)
        self.assertEqual(result['previous_source_count'], 1)
        self.assertEqual(result['total_source_count'], 3)
        self.assertEqual(result['calculated_price'], 0.10)  # 2 * 0.05
    
    def test_get_price_per_source(self):
        """Test getting the current price per source"""
        price = self.pricing_service.get_price_per_source()
        self.assertEqual(price, 0.05)
    
    def test_set_price_per_source(self):
        """Test updating the price per source"""
        self.pricing_service.set_price_per_source(0.10)
        self.assertEqual(self.pricing_service.price_per_source, 0.10)
        self.assertEqual(self.pricing_service.get_price_per_source(), 0.10)
    
    def test_set_price_per_source_negative_value(self):
        """Test that negative price raises ValueError"""
        with self.assertRaises(ValueError) as context:
            self.pricing_service.set_price_per_source(-0.05)
        
        self.assertIn("cannot be negative", str(context.exception))
    
    def test_set_price_per_source_zero(self):
        """Test that zero price is allowed"""
        self.pricing_service.set_price_per_source(0.0)
        self.assertEqual(self.pricing_service.price_per_source, 0.0)
    
    @patch('services.pricing_service.ResearchLedger')
    def test_calculate_incremental_pricing_with_custom_price(self, mock_ledger_class):
        """Test pricing calculation with custom price per source"""
        mock_ledger = Mock()
        mock_ledger.get_previous_purchase_sources.return_value = []
        self.pricing_service.ledger = mock_ledger
        
        # Set custom price
        self.pricing_service.set_price_per_source(0.25)
        
        sources = [self.source1, self.source2]
        result = self.pricing_service.calculate_incremental_pricing(
            user_id="user_test123",
            query="test query",
            sources=sources
        )
        
        # 2 sources at 0.25 each
        self.assertEqual(result['new_source_count'], 2)
        self.assertEqual(result['calculated_price'], 0.50)


if __name__ == '__main__':
    unittest.main()
