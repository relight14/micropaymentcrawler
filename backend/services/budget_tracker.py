"""Budget tracking service to prevent runaway API costs"""

from datetime import date, datetime
from typing import Optional, Dict, Any
import logging

from config import config

logger = logging.getLogger(__name__)


class BudgetTracker:
    """Track and enforce per-user and global budget limits"""
    
    def __init__(self, db_connection):
        self.db = db_connection
        self.daily_user_budget = config.DAILY_USER_BUDGET_CENTS
        self.global_daily_budget = config.GLOBAL_DAILY_BUDGET_CENTS
        self.max_calls_per_user = config.MAX_API_CALLS_PER_USER_PER_DAY
    
    def check_user_budget(self, user_id: str) -> Dict[str, Any]:
        """Check if user has budget remaining for API calls
        
        Returns:
            dict with 'allowed' (bool), 'remaining_cents' (int), 'remaining_calls' (int)
        """
        today = date.today()
        
        # Get or create user usage record for today
        usage = self.db.execute_query(
            "SELECT * FROM user_usage WHERE user_id = %s AND date = %s",
            (user_id, today)
        )
        
        if not usage:
            # First call today - create record
            self.db.execute_write(
                """INSERT INTO user_usage (user_id, date, api_calls, total_cost_cents) 
                   VALUES (%s, %s, 0, 0)""",
                (user_id, today)
            )
            return {
                "allowed": True,
                "remaining_cents": self.daily_user_budget,
                "remaining_calls": self.max_calls_per_user,
                "used_cents": 0,
                "used_calls": 0
            }
        
        # Check limits
        used_cents = usage.get('total_cost_cents', 0)
        used_calls = usage.get('api_calls', 0)
        
        remaining_cents = self.daily_user_budget - used_cents
        remaining_calls = self.max_calls_per_user - used_calls
        
        allowed = remaining_cents > 0 and remaining_calls > 0
        
        return {
            "allowed": allowed,
            "remaining_cents": max(0, remaining_cents),
            "remaining_calls": max(0, remaining_calls),
            "used_cents": used_cents,
            "used_calls": used_calls
        }
    
    def check_global_budget(self) -> Dict[str, Any]:
        """Check if global daily budget has been exceeded"""
        today = date.today()
        
        # Sum total costs across all users today
        result = self.db.execute_query(
            "SELECT COALESCE(SUM(total_cost_cents), 0) as total FROM user_usage WHERE date = %s",
            (today,)
        )
        
        total_spent = result.get('total', 0) if result else 0
        remaining = self.global_daily_budget - total_spent
        
        return {
            "allowed": remaining > 0,
            "remaining_cents": max(0, remaining),
            "used_cents": total_spent,
            "limit_cents": self.global_daily_budget
        }
    
    def record_api_call(self, user_id: str, api_type: str, cost_cents: int):
        """Record an API call and update user budget tracking
        
        Args:
            user_id: User identifier
            api_type: Type of API (tavily, claude_haiku, claude_sonnet, tollbit, etc.)
            cost_cents: Estimated cost in cents
        """
        today = date.today()
        
        # Normalize API type to database column name
        # Map all Claude variants to 'claude', all others to their base name
        api_column = api_type
        if 'claude' in api_type.lower():
            api_column = 'claude'
        elif 'tavily' in api_type.lower():
            api_column = 'tavily'
        elif 'tollbit' in api_type.lower():
            api_column = 'tollbit'
        
        # Update or insert user usage
        self.db.execute_write(
            """
            INSERT INTO user_usage (user_id, date, api_calls, total_cost_cents, {}_calls, updated_at)
            VALUES (%s, %s, 1, %s, 1, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id, date) 
            DO UPDATE SET 
                api_calls = user_usage.api_calls + 1,
                total_cost_cents = user_usage.total_cost_cents + %s,
                {}_calls = user_usage.{}_calls + 1,
                updated_at = CURRENT_TIMESTAMP
            """.format(api_column, api_column, api_column),
            (user_id, today, cost_cents, cost_cents)
        )
        
        logger.info(f"Recorded {api_type} API call for user {user_id[:8]}... (cost: ${cost_cents/100:.2f})")
    
    def get_user_usage_summary(self, user_id: str) -> Dict:
        """Get usage summary for a user"""
        today = date.today()
        
        usage = self.db.execute_query(
            "SELECT * FROM user_usage WHERE user_id = %s AND date = %s",
            (user_id, today)
        )
        
        if not usage:
            return {
                "api_calls": 0,
                "total_cost_cents": 0,
                "tavily_calls": 0,
                "claude_calls": 0,
                "tollbit_calls": 0
            }
        
        return {
            "api_calls": usage.get('api_calls', 0),
            "total_cost_cents": usage.get('total_cost_cents', 0),
            "tavily_calls": usage.get('tavily_calls', 0),
            "claude_calls": usage.get('claude_calls', 0),
            "tollbit_calls": usage.get('tollbit_calls', 0)
        }


def get_budget_tracker():
    """Get budget tracker instance with appropriate database connection"""
    if config.USE_POSTGRES:
        from data.postgres_db import postgres_db
        return BudgetTracker(postgres_db)
    else:
        # Fallback to SQLite for development
        from data.db import db
        return BudgetTracker(db)
