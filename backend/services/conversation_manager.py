"""
Unified Conversation Manager - Database-backed conversation history
Replaces in-memory conversation storage with proper persistence.
"""

import json
from typing import List, Dict, Any, Optional
from datetime import datetime
from data.db_wrapper import db_instance as db, normalize_query
from config import Config


class ConversationManager:
    """
    Manages conversation history with database persistence.
    Every conversation is tied to a project (context window).
    """
    
    def __init__(self):
        pass
    
    def get_or_create_default_project(self, user_id: str) -> int:
        """
        Get user's default project or create one if it doesn't exist.
        The default project is the most recently updated active project.
        
        Args:
            user_id: User identifier
            
        Returns:
            project_id of the default project
        """
        # Try to find the most recent active project
        query = normalize_query("""
            SELECT id FROM projects 
            WHERE user_id = ? AND is_active = TRUE
            ORDER BY updated_at DESC
            LIMIT 1
        """)
        
        result = db.execute_query(query, (user_id,))
        
        if result:
            project_id = result['id']
            # Update the project's timestamp
            update_query = normalize_query("""
                UPDATE projects 
                SET updated_at = ? 
                WHERE id = ?
            """)
            if Config.USE_POSTGRES:
                db.execute_write(update_query, (datetime.now(), project_id))
            else:
                db.execute_write(update_query, (datetime.now().isoformat(), project_id))
            
            return project_id
        
        # No active project found - create a default one
        title = "My Research"
        if Config.USE_POSTGRES:
            query = """
                INSERT INTO projects (user_id, title, created_at, updated_at, is_active)
                VALUES (%s, %s, NOW(), NOW(), TRUE)
                RETURNING id
            """
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, (user_id, title))
                    result = cursor.fetchone()
                    conn.commit()
                    return result['id']
        else:
            query = """
                INSERT INTO projects (user_id, title, created_at, updated_at, is_active)
                VALUES (?, ?, datetime('now'), datetime('now'), 1)
            """
            project_id = db.execute_write(query, (user_id, title))
            return project_id
    
    def add_message(
        self, 
        project_id: int, 
        user_id: str, 
        sender: str, 
        content: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> int:
        """
        Add a message to the conversation history.
        
        Args:
            project_id: Project (context window) ID
            user_id: User identifier
            sender: 'user' or 'assistant'
            content: Message content
            metadata: Optional metadata (sources, costs, etc.)
            
        Returns:
            message_id of the created message
        """
        message_data_json = json.dumps(metadata) if metadata else None
        
        if Config.USE_POSTGRES:
            query = """
                INSERT INTO messages (project_id, user_id, sender, content, message_data, created_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                RETURNING id
            """
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, (project_id, user_id, sender, content, message_data_json))
                    result = cursor.fetchone()
                    conn.commit()
                    return result['id']
        else:
            query = """
                INSERT INTO messages (project_id, user_id, sender, content, message_data, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            """
            message_id = db.execute_write(query, (project_id, user_id, sender, content, message_data_json))
            return message_id
    
    def get_conversation_history(
        self, 
        project_id: int, 
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get conversation history for a project.
        
        Args:
            project_id: Project (context window) ID
            limit: Optional limit on number of messages (most recent)
            
        Returns:
            List of messages in chronological order
        """
        if limit:
            query = normalize_query("""
                SELECT sender, content, message_data, created_at
                FROM messages
                WHERE project_id = ?
                ORDER BY created_at DESC
                LIMIT ?
            """)
            results = db.execute_many(query, (project_id, limit))
            # Reverse to get chronological order
            results = list(reversed(results))
        else:
            query = normalize_query("""
                SELECT sender, content, message_data, created_at
                FROM messages
                WHERE project_id = ?
                ORDER BY created_at ASC
            """)
            results = db.execute_many(query, (project_id,))
        
        messages = []
        for row in results:
            message = {
                'sender': row['sender'],
                'content': row['content'],
                'timestamp': row['created_at']
            }
            if row.get('message_data'):
                try:
                    message['metadata'] = json.loads(row['message_data'])
                except json.JSONDecodeError:
                    # Skip invalid metadata
                    pass
            messages.append(message)
        
        return messages
    
    def get_context_window(
        self,
        project_id: int,
        window_size: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Get the most recent N messages as context window for AI.
        
        Args:
            project_id: Project (context window) ID
            window_size: Number of recent messages to include
            
        Returns:
            List of recent messages in chronological order
        """
        return self.get_conversation_history(project_id, limit=window_size)
    
    def clear_conversation(self, project_id: int, user_id: str):
        """
        Clear conversation history for a project.
        Verifies user owns the project.
        
        Args:
            project_id: Project ID
            user_id: User identifier (for verification)
        """
        # Verify ownership
        verify_query = normalize_query("""
            SELECT id FROM projects WHERE id = ? AND user_id = ?
        """)
        result = db.execute_query(verify_query, (project_id, user_id))
        
        if not result:
            raise ValueError("Project not found or access denied")
        
        # Delete messages
        delete_query = normalize_query("""
            DELETE FROM messages WHERE project_id = ?
        """)
        db.execute_write(delete_query, (project_id,))
    
    def get_user_projects(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Get all active projects for a user.
        
        Args:
            user_id: User identifier
            limit: Maximum number of projects to return
            
        Returns:
            List of projects ordered by most recently updated
        """
        query = normalize_query("""
            SELECT id, title, research_query, created_at, updated_at
            FROM projects
            WHERE user_id = ? AND is_active = TRUE
            ORDER BY updated_at DESC
            LIMIT ?
        """)
        
        results = db.execute_many(query, (user_id, limit))
        
        projects = []
        for row in results:
            projects.append({
                'id': row['id'],
                'title': row['title'],
                'research_query': row.get('research_query'),
                'created_at': row['created_at'],
                'updated_at': row['updated_at']
            })
        
        return projects
    
    def set_active_project(self, project_id: int, user_id: str):
        """
        Mark a project as the active one by updating its timestamp.
        
        Args:
            project_id: Project ID
            user_id: User identifier (for verification)
        """
        # Verify ownership
        verify_query = normalize_query("""
            SELECT id FROM projects WHERE id = ? AND user_id = ?
        """)
        result = db.execute_query(verify_query, (project_id, user_id))
        
        if not result:
            raise ValueError("Project not found or access denied")
        
        # Update timestamp to make it "most recent"
        update_query = normalize_query("""
            UPDATE projects 
            SET updated_at = ? 
            WHERE id = ?
        """)
        if Config.USE_POSTGRES:
            db.execute_write(update_query, (datetime.now(), project_id))
        else:
            db.execute_write(update_query, (datetime.now().isoformat(), project_id))


# Global instance
conversation_manager = ConversationManager()
