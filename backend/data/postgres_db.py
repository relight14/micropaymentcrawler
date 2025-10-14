"""PostgreSQL database connection and utilities for production"""

import os
import psycopg2
import psycopg2.extras
from typing import Optional, Dict, Any, List
from contextlib import contextmanager
from datetime import datetime


class PostgreSQLConnection:
    """PostgreSQL database connection manager for production use"""
    
    def __init__(self):
        self.database_url = os.environ.get("DATABASE_URL")
        if not self.database_url:
            raise ValueError("DATABASE_URL environment variable is required for PostgreSQL")
        
        self._ensure_tables_exist()
    
    def _ensure_tables_exist(self):
        """Ensure all required tables exist (migration-friendly)"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                # Create purchases table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS purchases (
                        id SERIAL PRIMARY KEY,
                        content_id TEXT UNIQUE NOT NULL,
                        query TEXT NOT NULL,
                        tier TEXT NOT NULL,
                        price REAL NOT NULL,
                        wallet_id TEXT,
                        transaction_id TEXT,
                        packet_data TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create idempotency table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS idempotency (
                        id SERIAL PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        idempotency_key TEXT NOT NULL,
                        operation_type TEXT NOT NULL,
                        response_data TEXT,
                        reserved_at TIMESTAMP,
                        completed_at TIMESTAMP,
                        UNIQUE(user_id, idempotency_key, operation_type)
                    )
                """)
                
                # Create feedback table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS feedback (
                        id SERIAL PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        query TEXT NOT NULL,
                        source_ids TEXT NOT NULL,
                        rating TEXT NOT NULL,
                        mode TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create user_usage table for budget tracking
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS user_usage (
                        id SERIAL PRIMARY KEY,
                        user_id TEXT NOT NULL,
                        date DATE NOT NULL,
                        api_calls INTEGER DEFAULT 0,
                        total_cost_cents INTEGER DEFAULT 0,
                        tavily_calls INTEGER DEFAULT 0,
                        claude_calls INTEGER DEFAULT 0,
                        tollbit_calls INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_id, date)
                    )
                """)
                
                # Create rate_limit_log table for distributed rate limiting
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS rate_limit_log (
                        id SERIAL PRIMARY KEY,
                        user_key TEXT NOT NULL,
                        endpoint TEXT NOT NULL,
                        hit_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create index for fast rate limit lookups
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_rate_limit_user_endpoint_time 
                    ON rate_limit_log(user_key, endpoint, hit_at)
                """)
                
                conn.commit()
    
    @contextmanager
    def get_connection(self):
        """Get database connection context manager"""
        conn = psycopg2.connect(self.database_url)
        try:
            yield conn
        finally:
            conn.close()
    
    def execute_query(self, query: str, params: tuple = ()) -> Optional[Dict]:
        """Execute a single query and return first result as dict"""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute(query, params)
                result = cursor.fetchone()
                return dict(result) if result else None
    
    def execute_many(self, query: str, params: tuple = ()) -> List[Dict]:
        """Execute query and return all results as list of dicts"""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute(query, params)
                results = cursor.fetchall()
                return [dict(row) for row in results]
    
    def execute_write(self, query: str, params: tuple = ()) -> int:
        """Execute write query and return last row id"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                conn.commit()
                # PostgreSQL uses RETURNING to get last inserted id
                if cursor.description:
                    result = cursor.fetchone()
                    return result[0] if result else 0
                return cursor.rowcount or 0


# Global database instance
postgres_db = PostgreSQLConnection()
