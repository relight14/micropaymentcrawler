import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict
from schemas.domain import TierType, ResearchPacket

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
            
            # Payment protection table for idempotency
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS idempotency_keys (
                    user_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    operation_type TEXT NOT NULL,
                    response_data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, idempotency_key, operation_type)
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
    
    def reserve_idempotency(self, user_id: str, idempotency_key: str, operation_type: str) -> bool:
        """Atomically reserve an idempotency key. Returns True if reserved, False if already exists."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            try:
                # Try to insert with "processing" status
                cursor.execute("""
                    INSERT INTO idempotency_keys 
                    (user_id, idempotency_key, operation_type, response_data)
                    VALUES (?, ?, ?, ?)
                """, (user_id, idempotency_key, operation_type, json.dumps({"status": "processing"})))
                return True  # Successfully reserved
            except sqlite3.IntegrityError:
                return False  # Already exists

    def check_idempotency(self, user_id: str, idempotency_key: str, operation_type: str) -> Optional[Dict]:
        """Check if operation was already processed and return cached response."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT response_data, created_at FROM idempotency_keys 
                WHERE user_id = ? AND idempotency_key = ? AND operation_type = ?
            """, (user_id, idempotency_key, operation_type))
            
            result = cursor.fetchone()
            if result:
                data = json.loads(result[0])
                created_at = result[1]
                
                # Check for stuck processing entries (timeout after 5 minutes)
                if data.get("status") == "processing":
                    from datetime import datetime, timedelta
                    created_time = datetime.fromisoformat(created_at)
                    if datetime.now() - created_time > timedelta(minutes=5):
                        # Clean up stuck entry to allow retry
                        cursor.execute("""
                            DELETE FROM idempotency_keys 
                            WHERE user_id = ? AND idempotency_key = ? AND operation_type = ?
                        """, (user_id, idempotency_key, operation_type))
                        conn.commit()
                        return None
                    return None  # Still processing, let caller handle
                return data  # Completed result
            return None
    
    def store_idempotency(self, user_id: str, idempotency_key: str, operation_type: str, response_data: Dict):
        """Store operation result for idempotency protection."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO idempotency_keys 
                (user_id, idempotency_key, operation_type, response_data)
                VALUES (?, ?, ?, ?)
            """, (user_id, idempotency_key, operation_type, json.dumps(response_data)))
    
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
    
    def get_packet_by_content_id(self, content_id: str) -> Optional[ResearchPacket]:
        """
        Retrieve research packet by content_id.
        For demo purposes - in production this would verify via LedeWire API.
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Search for packet with matching content_id in JSON data
            cursor.execute("SELECT packet_data FROM purchases ORDER BY timestamp DESC")
            results = cursor.fetchall()
            
            for (packet_json,) in results:
                if packet_json:
                    try:
                        packet_data = json.loads(packet_json)
                        if packet_data.get("content_id") == content_id:
                            # Reconstruct ResearchPacket from stored data
                            return ResearchPacket(**packet_data)
                    except (json.JSONDecodeError, Exception):
                        continue
            
            return None