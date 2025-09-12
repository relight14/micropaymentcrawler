import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict
from models import TierType, ResearchPacket

class ResearchLedger:
    """
    Tracks tier selections, payments, and research packet deliveries.
    Uses SQLite for persistence in MVP.
    """
    
    def __init__(self, db_path: str = "research_ledger.db"):
        self.db_path = db_path
        self._init_database()
    
    def _init_database(self):
        """Initialize the database with required tables."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Table for tracking purchases
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS purchases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    query TEXT NOT NULL,
                    tier TEXT NOT NULL,
                    price REAL NOT NULL,
                    wallet_id TEXT,
                    transaction_id TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    packet_data TEXT
                )
            """)
            
            # Table for tracking source unlocks (future feature)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS source_unlocks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    purchase_id INTEGER,
                    source_id TEXT NOT NULL,
                    unlock_price REAL NOT NULL,
                    wallet_id TEXT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (purchase_id) REFERENCES purchases (id)
                )
            """)
            
            conn.commit()
    
    def record_purchase(self, 
                       query: str, 
                       tier: TierType, 
                       price: float, 
                       wallet_id: Optional[str], 
                       transaction_id: str,
                       packet: ResearchPacket) -> int:
        """Record a successful purchase and research packet delivery."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO purchases (query, tier, price, wallet_id, transaction_id, packet_data)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                query,
                tier.value,
                price,
                wallet_id,
                transaction_id,
                json.dumps(packet.model_dump())
            ))
            
            return cursor.lastrowid or 0
    
    def record_source_unlock(self, 
                           purchase_id: int, 
                           source_id: str, 
                           unlock_price: float, 
                           wallet_id: str) -> int:
        """Record a source unlock transaction (future feature)."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO source_unlocks (purchase_id, source_id, unlock_price, wallet_id)
                VALUES (?, ?, ?, ?)
            """, (purchase_id, source_id, unlock_price, wallet_id))
            
            return cursor.lastrowid or 0
    
    def get_purchase_history(self, wallet_id: Optional[str] = None) -> List[Dict]:
        """Get purchase history, optionally filtered by wallet_id."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            if wallet_id:
                cursor.execute("""
                    SELECT * FROM purchases WHERE wallet_id = ? ORDER BY timestamp DESC
                """, (wallet_id,))
            else:
                cursor.execute("""
                    SELECT * FROM purchases ORDER BY timestamp DESC
                """)
            
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
    
    def get_purchase_stats(self) -> Dict:
        """Get basic statistics about purchases."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Total purchases by tier
            cursor.execute("""
                SELECT tier, COUNT(*) as count, SUM(price) as total_revenue
                FROM purchases 
                GROUP BY tier
            """)
            tier_stats = {row[0]: {"count": row[1], "revenue": row[2]} 
                         for row in cursor.fetchall()}
            
            # Overall stats
            cursor.execute("""
                SELECT 
                    COUNT(*) as total_purchases,
                    SUM(price) as total_revenue,
                    AVG(price) as avg_purchase
                FROM purchases
            """)
            overall = cursor.fetchone()
            
            return {
                "tier_breakdown": tier_stats,
                "total_purchases": overall[0],
                "total_revenue": overall[1],
                "average_purchase": overall[2]
            }