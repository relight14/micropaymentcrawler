"""Database connection and utilities"""

import sqlite3
import os
from typing import Optional, Dict, Any
from contextlib import contextmanager


class DatabaseConnection:
    """SQLite database connection manager"""
    
    def __init__(self, db_path: str = "research_ledger.db"):
        self.db_path = db_path
        self._ensure_database_exists()
    
    def _ensure_database_exists(self):
        """Ensure database file exists and create if needed"""
        if not os.path.exists(self.db_path):
            self._create_database()
        else:
            # For existing databases, ensure all tables exist (migration-friendly)
            self._ensure_tables_exist()
    
    def _ensure_tables_exist(self):
        """Ensure all required tables exist (migration-friendly for existing databases)"""
        with sqlite3.connect(self.db_path) as conn:
            # Create feedback table if it doesn't exist
            conn.execute("""
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    query TEXT NOT NULL,
                    source_ids TEXT NOT NULL,
                    rating TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Create projects table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT 1
                )
            """)
            
            # Create outline_sections table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS outline_sections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """)
            
            # Create outline_sources table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS outline_sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    section_id INTEGER NOT NULL,
                    source_data_json TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (section_id) REFERENCES outline_sections(id) ON DELETE CASCADE
                )
            """)
            
            # Create messages table for conversation history
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    user_id TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    content TEXT NOT NULL,
                    message_data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """)
            
            # Create index for efficient message queries
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_project_created 
                ON messages(project_id, created_at)
            """)
            
            conn.commit()
    
    def _create_database(self):
        """Create database with initial schema"""
        with sqlite3.connect(self.db_path) as conn:
            # Create tables if they don't exist
            conn.execute("""
                CREATE TABLE IF NOT EXISTS purchases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS idempotency (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    operation_type TEXT NOT NULL,
                    response_data TEXT,
                    reserved_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    UNIQUE(user_id, idempotency_key, operation_type)
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    query TEXT NOT NULL,
                    source_ids TEXT NOT NULL,
                    rating TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Create projects table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT 1
                )
            """)
            
            # Create outline_sections table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS outline_sections (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """)
            
            # Create outline_sources table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS outline_sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    section_id INTEGER NOT NULL,
                    source_data_json TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (section_id) REFERENCES outline_sections(id) ON DELETE CASCADE
                )
            """)
            
            # Create messages table for conversation history
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    user_id TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    content TEXT NOT NULL,
                    message_data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """)
            
            # Create uploaded_files table for user documents
            conn.execute("""
                CREATE TABLE IF NOT EXISTS uploaded_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    user_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
                )
            """)
            
            # Create index for efficient message queries
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_project_created 
                ON messages(project_id, created_at)
            """)
            
            # Create index for efficient file queries
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_uploaded_files_project_created 
                ON uploaded_files(project_id, created_at)
            """)
            
            conn.commit()
    
    @contextmanager
    def get_connection(self):
        """Get database connection context manager"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row  # Enable dict-like access
        conn.execute("PRAGMA foreign_keys = ON")  # Enable foreign key constraints
        try:
            yield conn
        finally:
            conn.close()
    
    def execute_query(self, query: str, params: tuple = ()) -> Optional[sqlite3.Row]:
        """Execute a single query and return first result"""
        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            return cursor.fetchone()
    
    def execute_many(self, query: str, params: tuple = ()) -> list:
        """Execute query and return all results"""
        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            return cursor.fetchall()
    
    def execute_write(self, query: str, params: tuple = ()) -> int:
        """Execute write query and return last row id"""
        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            conn.commit()
            return cursor.lastrowid or 0
    
    def execute_update(self, query: str, params: tuple = ()) -> int:
        """Execute UPDATE/DELETE query and return number of affected rows"""
        with self.get_connection() as conn:
            cursor = conn.execute(query, params)
            affected_rows = cursor.rowcount
            conn.commit()
            return affected_rows


# Global database instance
db = DatabaseConnection()