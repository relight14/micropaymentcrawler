"""Unified database wrapper - automatically uses PostgreSQL in production, SQLite in dev"""

from config import config


def get_db():
    """Get appropriate database connection based on environment"""
    if config.USE_POSTGRES:
        from data.postgres_db import postgres_db
        return postgres_db
    else:
        from data.db import db
        return db


def normalize_query(query: str) -> str:
    """
    Normalize SQL query placeholders for current database.
    Converts ? (SQLite style) to %s (PostgreSQL style) when using PostgreSQL.
    
    Args:
        query: SQL query with ? placeholders
        
    Returns:
        Query with appropriate placeholders for current database
    """
    if config.USE_POSTGRES:
        # Replace ? with %s for PostgreSQL
        return query.replace('?', '%s')
    return query


# Global database instance
db_instance = get_db()
