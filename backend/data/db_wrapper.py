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


# Global database instance
db_instance = get_db()
