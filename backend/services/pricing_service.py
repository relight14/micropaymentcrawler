"""
Pricing service for calculating research costs
"""

import logging
from typing import List, Dict, Any
from schemas.domain import SourceCard
from data.ledger_repository import ResearchLedger

logger = logging.getLogger(__name__)


class PricingService:
    """Service for calculating pricing for research purchases"""
    
    def __init__(self):
        self.ledger = ResearchLedger()
        self.price_per_source = 0.05  # $0.05 per source
    
    def calculate_incremental_pricing(
        self, 
        user_id: str, 
        query: str, 
        sources: List[SourceCard]
    ) -> Dict[str, Any]:
        """
        Calculate incremental pricing for a purchase.
        
        Returns dict with:
        - calculated_price: Total price for new sources
        - new_source_count: Number of new sources to purchase
        - previous_source_count: Number of sources already owned
        - total_source_count: Total sources in current request
        
        Args:
            user_id: User identifier
            query: Research query
            sources: List of SourceCard objects to price
            
        Returns:
            Dictionary with pricing breakdown
        """
        previous_source_ids = self.ledger.get_previous_purchase_sources(user_id, query)
        current_source_ids = set([s.id for s in sources]) if sources else set()
        
        if previous_source_ids:
            previous_ids_set = set(previous_source_ids)
            
            # Intersection: sources in current request that were previously purchased
            owned_source_ids = current_source_ids & previous_ids_set
            previous_count = len(owned_source_ids)
            
            # Set difference: sources in current request that are new
            new_source_ids = current_source_ids - previous_ids_set
            new_source_count = len(new_source_ids)
            
            logger.info(
                f"💰 [PRICING] User {user_id}: {len(current_source_ids)} sources | "
                f"Already owned: {previous_count} | New: {new_source_count}"
            )
        else:
            new_source_count = len(current_source_ids)
            previous_count = 0
            logger.info(f"💰 [PRICING] First purchase for user {user_id}: {new_source_count} sources")
        
        # Calculate price: price_per_source * number of new sources
        calculated_price = new_source_count * self.price_per_source
        
        return {
            "calculated_price": calculated_price,
            "new_source_count": new_source_count,
            "previous_source_count": previous_count,
            "total_source_count": len(current_source_ids)
        }
    
    def get_price_per_source(self) -> float:
        """Get the current price per source"""
        return self.price_per_source
    
    def set_price_per_source(self, price: float) -> None:
        """Update the price per source (for configuration/admin purposes)"""
        if price < 0:
            raise ValueError("Price per source cannot be negative")
        self.price_per_source = price
        logger.info(f"💰 [PRICING] Updated price per source to ${price:.2f}")
