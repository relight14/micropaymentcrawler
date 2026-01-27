import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict
from schemas.domain import ResearchPacket

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
                    status TEXT NOT NULL DEFAULT 'processing',
                    response_data TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (user_id, idempotency_key, operation_type)
                )
            """)
            
            # Table for tracking summaries
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS summaries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    source_id TEXT NOT NULL,
                    url TEXT NOT NULL,
                    price_cents INTEGER NOT NULL,
                    transaction_id TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, source_id)
                )
            """)
            
            # Add source_ids_used column to purchases table if it doesn't exist
            try:
                cursor.execute("ALTER TABLE purchases ADD COLUMN source_ids_used TEXT")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            
            # Add user_id column for better purchase lookups
            try:
                cursor.execute("ALTER TABLE purchases ADD COLUMN user_id TEXT")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            
            # Add content_id column to track LedeWire content IDs in purchases
            # This enables proper content_id reuse across purchases
            try:
                cursor.execute("ALTER TABLE purchases ADD COLUMN content_id TEXT")
            except sqlite3.OperationalError:
                # Column already exists
                pass
            
            # Table for caching LedeWire content_id mappings
            # Prevents duplicate content registration for the same report
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS content_id_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cache_key TEXT NOT NULL UNIQUE,
                    content_id TEXT NOT NULL,
                    price_cents INTEGER NOT NULL,
                    visibility TEXT NOT NULL DEFAULT 'private',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME
                )
            """)
            
            conn.commit()
    
    def record_purchase(self, 
                       query: str, 
                       price: float, 
                       wallet_id: Optional[str], 
                       transaction_id: str,
                       packet: ResearchPacket,
                       source_ids: Optional[List[str]] = None,
                       user_id: Optional[str] = None,
                       content_id: Optional[str] = None) -> int:
        """Record a successful purchase and research packet delivery."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # Convert source IDs list to JSON string
            source_ids_json = json.dumps(source_ids) if source_ids else None
            
            # Note: tier column remains in DB for historical data but always stores "pro"
            cursor.execute("""
                INSERT INTO purchases (query, tier, price, wallet_id, transaction_id, packet_data, source_ids_used, user_id, content_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                query,
                "pro",  # All reports are now Pro Package
                price,
                wallet_id,
                transaction_id,
                json.dumps(packet.model_dump()),
                source_ids_json,
                user_id,
                content_id
            ))
            
            return cursor.lastrowid or 0
    
    def get_content_id_from_purchases(self, cache_key: str) -> Optional[str]:
        """
        Get content_id from previous purchases by cache_key.
        This ensures we reuse the same content_id for identical content,
        enabling proper "already purchased" detection.
        
        Returns content_id if found in any previous purchase, None otherwise.
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            # First, try to get from content_id_cache (faster lookup)
            cursor.execute("""
                SELECT content_id FROM content_id_cache
                WHERE cache_key = ?
                LIMIT 1
            """, (cache_key,))
            
            result = cursor.fetchone()
            if result:
                return result[0]
            
            # If not in cache, check if we have it in any purchase
            # This handles cases where cache expired but purchase exists
            cursor.execute("""
                SELECT DISTINCT p.content_id
                FROM purchases p
                JOIN content_id_cache c ON p.content_id = c.content_id
                WHERE c.cache_key = ?
                AND p.content_id IS NOT NULL
                ORDER BY p.timestamp DESC
                LIMIT 1
            """, (cache_key,))
            
            result = cursor.fetchone()
            return result[0] if result else None
    
    def get_previous_purchase_sources(self, user_id: str, query: str) -> Optional[List[str]]:
        """
        Get source IDs from the most recent purchase for this user/query.
        Used for incremental pricing to determine which sources are new.
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT source_ids_used FROM purchases 
                WHERE user_id = ? AND query = ? 
                ORDER BY timestamp DESC 
                LIMIT 1
            """, (user_id, query))
            
            result = cursor.fetchone()
            if result and result[0]:
                return json.loads(result[0])
            return None

    def get_idempotency_status(self, user_id: str, idempotency_key: str, operation_type: str) -> Optional[Dict]:
        """Get current status of an idempotent operation. Returns dict with status and response_data, or None."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT status, response_data, created_at, updated_at FROM idempotency_keys 
                WHERE user_id = ? AND idempotency_key = ? AND operation_type = ?
            """, (user_id, idempotency_key, operation_type))
            
            result = cursor.fetchone()
            if result:
                status, response_data, created_at, updated_at = result
                return {
                    "status": status,
                    "response_data": json.loads(response_data) if response_data else {},
                    "created_at": created_at,
                    "updated_at": updated_at
                }
            return None

    def reserve_idempotency(self, user_id: str, idempotency_key: str, operation_type: str) -> bool:
        """Atomically reserve an idempotency key. Returns True if reserved, False if already exists."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            try:
                # Try to insert with "processing" status
                cursor.execute("""
                    INSERT INTO idempotency_keys 
                    (user_id, idempotency_key, operation_type, status, response_data)
                    VALUES (?, ?, ?, 'processing', ?)
                """, (user_id, idempotency_key, operation_type, json.dumps({})))
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
    
    def store_idempotency(self, user_id: str, idempotency_key: str, operation_type: str, response_data: Dict, status: str = "completed"):
        """Store operation result for idempotency protection with status."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO idempotency_keys 
                (user_id, idempotency_key, operation_type, status, response_data, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (user_id, idempotency_key, operation_type, status, json.dumps(response_data)))
    
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
    
    def set_idempotency_status(self, user_id: str, idempotency_key: str, operation_type: str, status: str, response_data: Dict):
        """Update or create idempotency status."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO idempotency_keys 
                (user_id, idempotency_key, operation_type, status, response_data, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (user_id, idempotency_key, operation_type, status, json.dumps(response_data)))
            conn.commit()
    
    def record_summary_purchase(self, user_id: str, source_id: str, url: str, price_cents: int, transaction_id: str, summary: str):
        """Record a summary purchase."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT OR REPLACE INTO summaries 
                (user_id, source_id, url, price_cents, transaction_id, summary, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (user_id, source_id, url, price_cents, transaction_id, summary))
            conn.commit()
    
    def get_summary(self, user_id: str, source_id: str) -> Optional[Dict]:
        """Get cached summary for a source."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT summary, price_cents, transaction_id, timestamp 
                FROM summaries 
                WHERE user_id = ? AND source_id = ?
            """, (user_id, source_id))
            
            result = cursor.fetchone()
            if result:
                return {
                    "summary": result[0],
                    "price_cents": result[1],
                    "transaction_id": result[2],
                    "timestamp": result[3]
                }
            return None
    
    # Content ID Caching (LedeWire content registration)
    
    def get_cached_content_id(self, cache_key: str) -> Optional[Dict]:
        """
        Get cached LedeWire content_id for a report.
        Cache key is typically: hash(query + source_ids)
        
        Returns dict with content_id, price_cents, visibility if found.
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT content_id, price_cents, visibility, created_at, expires_at
                FROM content_id_cache
                WHERE cache_key = ?
                AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
            """, (cache_key,))
            
            result = cursor.fetchone()
            if result:
                return {
                    "content_id": result[0],
                    "price_cents": result[1],
                    "visibility": result[2],
                    "created_at": result[3],
                    "expires_at": result[4]
                }
            return None
    
    def store_content_id(self, cache_key: str, content_id: str, price_cents: int, visibility: str = "private", expires_hours: Optional[int] = None) -> None:
        """
        Store a LedeWire content_id for future lookups.
        Avoids duplicate content registration for the same report.
        
        Args:
            cache_key: Unique key for this content (hash of query + source_ids)
            content_id: LedeWire content ID returned from registration
            price_cents: Price in cents
            visibility: "public" or "private"
            expires_hours: Hours until cache expires (None = never expires, used for purchases)
        """
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            
            if expires_hours is None:
                # Never expires - used for purchase tracking
                cursor.execute("""
                    INSERT OR REPLACE INTO content_id_cache
                    (cache_key, content_id, price_cents, visibility, expires_at)
                    VALUES (?, ?, ?, ?, NULL)
                """, (cache_key, content_id, price_cents, visibility))
            else:
                # Expires after specified hours - used for temporary caching
                cursor.execute("""
                    INSERT OR REPLACE INTO content_id_cache
                    (cache_key, content_id, price_cents, visibility, expires_at)
                    VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))
                """, (cache_key, content_id, price_cents, visibility, expires_hours))
            
            conn.commit()
    
    def generate_content_cache_key(self, query: str, source_ids: List[str], price_cents: int) -> str:
        """
        Generate a consistent cache key for content based on query, sources, and price.
        This ensures the same report (same query + same sources + same price) reuses the same content_id.
        
        CONTENT IDENTIFICATION METHOD:
        ===============================
        We identify identical content using a deterministic hash of:
        
        1. QUERY TEXT (normalized)
           - The research query/question (e.g., "AI trends in 2024")
           - Normalized: trimmed whitespace and lowercased
           - Example: "AI Trends  " → "ai trends"
        
        2. SOURCE IDS (sorted)
           - List of source identifiers used in the report
           - Each source has a unique ID (e.g., "src_abc123", "src_def456")
           - Sources represent the articles/URLs analyzed
           - Sorted to ensure consistent ordering
           - Example: ["src_003", "src_001", "src_002"] → "src_001,src_002,src_003"
        
        3. PRICE (in cents)
           - The price of the content
           - Included so price changes create new content registrations
           - Example: 500 (represents $5.00)
        
        WHY THIS WORKS:
        ===============
        - Same query + same sources + same price = IDENTICAL content
        - Different sources = DIFFERENT content (even if same query)
        - Same sources but different price = DIFFERENT content registration
        - Source order doesn't matter (we sort them)
        
        EXAMPLES:
        =========
        Request 1: query="AI trends", sources=["src_001", "src_002"], price=500
        Request 2: query="AI trends", sources=["src_001", "src_002"], price=500
        → SAME cache_key → Reuse content_id ✅
        
        Request 3: query="AI trends", sources=["src_001", "src_003"], price=500
        → DIFFERENT cache_key → New content_id (different sources)
        
        Request 4: query="Blockchain trends", sources=["src_001", "src_002"], price=500
        → DIFFERENT cache_key → New content_id (different query)
        
        Args:
            query: The research query/question
            source_ids: List of source IDs (article identifiers) used in the report
            price_cents: Price in cents
        
        Returns:
            32-character hash string (first 32 chars of SHA256 hash)
        """
        import hashlib
        source_ids_str = ",".join(sorted(source_ids))
        key_input = f"{query.strip().lower()}:{source_ids_str}:{price_cents}"
        return hashlib.sha256(key_input.encode()).hexdigest()[:32]