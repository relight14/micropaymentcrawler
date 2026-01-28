"""
Unit tests for SourceService
"""

import unittest
import sys
import os
from unittest.mock import Mock, patch

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from services.source_service import SourceService
from schemas.domain import SourceCard


class TestSourceService(unittest.TestCase):
    """Test cases for SourceService"""
    
    def setUp(self):
        """Set up test fixtures"""
        self.source_service = SourceService()
        
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
    
    def test_extract_sources_from_outline_valid_structure(self):
        """Test extracting sources from a valid outline structure"""
        outline = {
            "sections": [
                {
                    "title": "Section 1",
                    "sources": [
                        {
                            "source_data": {
                                "id": "source1",
                                "title": "Test Source 1",
                                "url": "https://example.com/1",
                                "excerpt": "Test excerpt 1",
                                "domain": "example.com",
                                "unlock_price": 0.05,
                                "is_unlocked": False
                            }
                        },
                        {
                            "source_data": {
                                "id": "source2",
                                "title": "Test Source 2",
                                "url": "https://example.com/2",
                                "excerpt": "Test excerpt 2",
                                "domain": "example.com",
                                "unlock_price": 0.05,
                                "is_unlocked": False
                            }
                        }
                    ]
                },
                {
                    "title": "Section 2",
                    "sources": [
                        {
                            "source_data": {
                                "id": "source3",
                                "title": "Test Source 3",
                                "url": "https://example.com/3",
                                "excerpt": "Test excerpt 3",
                                "domain": "example.com",
                                "unlock_price": 0.05,
                                "is_unlocked": False
                            }
                        }
                    ]
                }
            ]
        }
        
        result = self.source_service.extract_sources_from_outline(outline)
        
        self.assertEqual(len(result), 3)
        self.assertIsInstance(result[0], SourceCard)
        self.assertEqual(result[0].id, "source1")
        self.assertEqual(result[1].id, "source2")
        self.assertEqual(result[2].id, "source3")
    
    def test_extract_sources_from_outline_with_duplicates(self):
        """Test that duplicate sources are filtered out"""
        outline = {
            "sections": [
                {
                    "title": "Section 1",
                    "sources": [
                        {
                            "source_data": {
                                "id": "source1",
                                "title": "Test Source 1",
                                "url": "https://example.com/1",
                                "excerpt": "Test excerpt 1",
                                "domain": "example.com",
                                "unlock_price": 0.05,
                                "is_unlocked": False
                            }
                        },
                        {
                            "source_data": {
                                "id": "source1",  # Duplicate
                                "title": "Test Source 1 Duplicate",
                                "url": "https://example.com/1",
                                "excerpt": "Test excerpt 1",
                                "domain": "example.com",
                                "unlock_price": 0.05,
                                "is_unlocked": False
                            }
                        }
                    ]
                }
            ]
        }
        
        result = self.source_service.extract_sources_from_outline(outline)
        
        # Should only have 1 source (duplicate filtered)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "source1")
    
    def test_extract_sources_from_outline_empty_structure(self):
        """Test extracting sources from empty outline"""
        outline = {"sections": []}
        result = self.source_service.extract_sources_from_outline(outline)
        self.assertEqual(len(result), 0)
    
    def test_extract_sources_from_outline_no_sections_key(self):
        """Test extracting sources when 'sections' key is missing"""
        outline = {"title": "Test"}
        result = self.source_service.extract_sources_from_outline(outline)
        self.assertEqual(len(result), 0)
    
    def test_extract_sources_from_outline_none_input(self):
        """Test extracting sources from None input"""
        result = self.source_service.extract_sources_from_outline(None)
        self.assertEqual(len(result), 0)
    
    def test_extract_sources_from_outline_unwrapped_source_data(self):
        """Test extracting sources when source_data is not wrapped"""
        outline = {
            "sections": [
                {
                    "title": "Section 1",
                    "sources": [
                        {
                            # Direct source data without 'source_data' wrapper
                            "id": "source1",
                            "title": "Test Source 1",
                            "url": "https://example.com/1",
                            "excerpt": "Test excerpt 1",
                            "domain": "example.com",
                            "unlock_price": 0.05,
                            "is_unlocked": False
                        }
                    ]
                }
            ]
        }
        
        result = self.source_service.extract_sources_from_outline(outline)
        
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "source1")
    
    def test_extract_sources_from_outline_invalid_source_data(self):
        """Test that invalid source data is skipped gracefully"""
        outline = {
            "sections": [
                {
                    "title": "Section 1",
                    "sources": [
                        {
                            "source_data": {
                                "id": "source1",
                                # Missing required fields
                            }
                        },
                        {
                            "source_data": {
                                "id": "source2",
                                "title": "Valid Source",
                                "url": "https://example.com/2",
                                "excerpt": "Valid excerpt",
                                "domain": "example.com",
                                "unlock_price": 0.05,
                                "is_unlocked": False
                            }
                        }
                    ]
                }
            ]
        }
        
        result = self.source_service.extract_sources_from_outline(outline)
        
        # Should only have the valid source
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, "source2")
    
    def test_deduplicate_sources(self):
        """Test removing duplicate sources from a list"""
        sources = [self.source1, self.source2, self.source1, self.source3, self.source2]
        
        result = self.source_service.deduplicate_sources(sources)
        
        # Should only have 3 unique sources
        self.assertEqual(len(result), 3)
        source_ids = [s.id for s in result]
        self.assertEqual(source_ids, ["source1", "source2", "source3"])
    
    def test_deduplicate_sources_no_duplicates(self):
        """Test deduplication when there are no duplicates"""
        sources = [self.source1, self.source2, self.source3]
        
        result = self.source_service.deduplicate_sources(sources)
        
        self.assertEqual(len(result), 3)
        self.assertEqual(result, sources)
    
    def test_deduplicate_sources_empty_list(self):
        """Test deduplication of empty list"""
        result = self.source_service.deduplicate_sources([])
        self.assertEqual(len(result), 0)
    
    def test_deduplicate_sources_preserves_order(self):
        """Test that deduplication preserves order of first occurrence"""
        sources = [self.source3, self.source1, self.source2, self.source1]
        
        result = self.source_service.deduplicate_sources(sources)
        
        # Order should be source3, source1, source2
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0].id, "source3")
        self.assertEqual(result[1].id, "source1")
        self.assertEqual(result[2].id, "source2")
    
    def test_filter_sources_by_ids(self):
        """Test filtering sources by ID list"""
        sources = [self.source1, self.source2, self.source3]
        source_ids = ["source1", "source3"]
        
        result = self.source_service.filter_sources_by_ids(sources, source_ids)
        
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].id, "source1")
        self.assertEqual(result[1].id, "source3")
    
    def test_filter_sources_by_ids_no_matches(self):
        """Test filtering when no sources match"""
        sources = [self.source1, self.source2, self.source3]
        source_ids = ["source4", "source5"]
        
        result = self.source_service.filter_sources_by_ids(sources, source_ids)
        
        self.assertEqual(len(result), 0)
    
    def test_filter_sources_by_ids_empty_id_list(self):
        """Test filtering with empty ID list"""
        sources = [self.source1, self.source2, self.source3]
        
        result = self.source_service.filter_sources_by_ids(sources, [])
        
        self.assertEqual(len(result), 0)
    
    def test_filter_sources_by_ids_empty_sources(self):
        """Test filtering empty sources list"""
        result = self.source_service.filter_sources_by_ids([], ["source1"])
        self.assertEqual(len(result), 0)
    
    def test_get_source_ids(self):
        """Test extracting source IDs from source list"""
        sources = [self.source1, self.source2, self.source3]
        
        result = self.source_service.get_source_ids(sources)
        
        self.assertEqual(result, ["source1", "source2", "source3"])
    
    def test_get_source_ids_empty_list(self):
        """Test extracting IDs from empty list"""
        result = self.source_service.get_source_ids([])
        self.assertEqual(result, [])
    
    def test_get_source_ids_single_source(self):
        """Test extracting IDs from single source"""
        result = self.source_service.get_source_ids([self.source1])
        self.assertEqual(result, ["source1"])


if __name__ == '__main__':
    unittest.main()
