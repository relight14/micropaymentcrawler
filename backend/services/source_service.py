"""
Source service for managing and extracting research sources
"""

import logging
from typing import List, Dict, Any, Optional
from schemas.domain import SourceCard

logger = logging.getLogger(__name__)


class SourceService:
    """Service for managing research sources"""
    
    @staticmethod
    def extract_sources_from_outline(outline_structure: Dict[str, Any]) -> List[SourceCard]:
        """
        Extract all unique sources from outline structure.
        The outline is the single source of truth for what goes in the report.
        
        Args:
            outline_structure: Dictionary containing sections with nested sources
            
        Returns:
            List of unique SourceCard objects
            
        Example outline structure:
            {
                "sections": [
                    {
                        "title": "Section 1",
                        "sources": [
                            {"source_data": {...sourcecard data...}},
                            ...
                        ]
                    },
                    ...
                ]
            }
        """
        if not outline_structure or 'sections' not in outline_structure:
            logger.warning("No outline structure or sections provided")
            return []
        
        seen_ids = set()
        unique_sources = []
        
        for section in outline_structure.get('sections', []):
            for source_wrapper in section.get('sources', []):
                # Handle both wrapped and unwrapped source data
                source_data = source_wrapper.get('source_data', source_wrapper)
                source_id = source_data.get('id')
                
                if source_id and source_id not in seen_ids:
                    seen_ids.add(source_id)
                    try:
                        # Convert dict to SourceCard instance
                        unique_sources.append(SourceCard(**source_data))
                    except Exception as e:
                        logger.warning(
                            f"Failed to parse source {source_id} from outline: {e}. "
                            f"Source data keys: {list(source_data.keys())}"
                        )
                        continue
        
        logger.info(f"📚 Extracted {len(unique_sources)} unique sources from outline with {len(outline_structure.get('sections', []))} sections")
        return unique_sources
    
    @staticmethod
    def deduplicate_sources(sources: List[SourceCard]) -> List[SourceCard]:
        """
        Remove duplicate sources from a list based on source ID.
        
        Args:
            sources: List of SourceCard objects that may contain duplicates
            
        Returns:
            List of unique SourceCard objects (preserves order of first occurrence)
        """
        seen_ids = set()
        unique_sources = []
        
        for source in sources:
            if source.id not in seen_ids:
                seen_ids.add(source.id)
                unique_sources.append(source)
        
        if len(sources) != len(unique_sources):
            logger.info(f"📚 Deduplicated {len(sources)} sources down to {len(unique_sources)}")
        
        return unique_sources
    
    @staticmethod
    def filter_sources_by_ids(sources: List[SourceCard], source_ids: List[str]) -> List[SourceCard]:
        """
        Filter a list of sources to only include those with specified IDs.
        
        Args:
            sources: List of all available SourceCard objects
            source_ids: List of source IDs to keep
            
        Returns:
            Filtered list of SourceCard objects
        """
        id_set = set(source_ids)
        filtered = [source for source in sources if source.id in id_set]
        
        if len(filtered) != len(source_ids):
            logger.warning(
                f"📚 Requested {len(source_ids)} sources but only found {len(filtered)} matches"
            )
        
        return filtered
    
    @staticmethod
    def get_source_ids(sources: List[SourceCard]) -> List[str]:
        """
        Extract just the IDs from a list of sources.
        
        Args:
            sources: List of SourceCard objects
            
        Returns:
            List of source ID strings
        """
        return [source.id for source in sources]
