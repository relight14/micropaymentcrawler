"""Project management and outline builder routes"""

from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import logging
import json
from datetime import datetime
from utils.rate_limit import limiter
from config import Config

# Setup logging
logger = logging.getLogger(__name__)

router = APIRouter()

# Determine which database to use
if Config.USE_POSTGRES:
    from data.postgres_db import postgres_db as db
else:
    from data.db import db


class OutlineSource(BaseModel):
    """Source assigned to an outline section"""
    source_data: Dict[str, Any]  # Full source card data
    order_index: int


class OutlineSection(BaseModel):
    """Outline section with assigned sources"""
    id: Optional[int] = None
    title: str = Field(..., min_length=1, max_length=200)
    order_index: int
    sources: List[OutlineSource] = []


class Project(BaseModel):
    """Project model"""
    id: Optional[int] = None
    user_id: str
    title: str = Field(..., min_length=1, max_length=500)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    is_active: bool = True


class CreateProjectRequest(BaseModel):
    """Request to create a new project"""
    title: str = Field(..., min_length=1, max_length=500)


class UpdateOutlineRequest(BaseModel):
    """Request to update project outline"""
    sections: List[OutlineSection]


def extract_bearer_token(authorization: str) -> str:
    """Extract and validate Bearer token from Authorization header."""
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authorization must be Bearer token")
    
    access_token = authorization.split(" ", 1)[1].strip()
    
    if not access_token:
        raise HTTPException(status_code=401, detail="Bearer token cannot be empty")
    
    return access_token


def extract_user_id_from_token(access_token: str) -> str:
    """Extract user ID from JWT token"""
    from integrations.ledewire import LedeWireAPI
    ledewire = LedeWireAPI()
    
    try:
        response = ledewire.get_wallet_balance(access_token)
        if response.get('balance_cents') is not None:
            wallet_id = response.get('wallet_id', 'mock_wallet')
            return f"user_{wallet_id}"
        else:
            import hashlib
            return f"user_{hashlib.sha256(access_token.encode()).hexdigest()[:12]}"
    except Exception:
        import hashlib  
        return f"anon_{hashlib.sha256(access_token.encode()).hexdigest()[:12]}"


@router.post("", response_model=Project)
@limiter.limit("20/minute")
async def create_project(
    request: Request,
    project_request: CreateProjectRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """Create a new project"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        # Insert project into database
        if Config.USE_POSTGRES:
            query = """
                INSERT INTO projects (user_id, title, created_at, updated_at, is_active)
                VALUES (%s, %s, NOW(), NOW(), TRUE)
                RETURNING id, user_id, title, created_at, updated_at, is_active
            """
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, (user_id, project_request.title))
                    result = cursor.fetchone()
                    conn.commit()
                    
                    return Project(
                        id=result['id'],
                        user_id=result['user_id'],
                        title=result['title'],
                        created_at=result['created_at'],
                        updated_at=result['updated_at'],
                        is_active=result['is_active']
                    )
        else:
            query = """
                INSERT INTO projects (user_id, title, created_at, updated_at, is_active)
                VALUES (?, ?, datetime('now'), datetime('now'), 1)
            """
            project_id = db.execute_write(query, (user_id, project_request.title))
            
            # Fetch the created project
            result = db.execute_query(
                "SELECT id, user_id, title, created_at, updated_at, is_active FROM projects WHERE id = ?",
                (project_id,)
            )
            
            return Project(
                id=result['id'],
                user_id=result['user_id'],
                title=result['title'],
                created_at=result['created_at'],
                updated_at=result['updated_at'],
                is_active=bool(result['is_active'])
            )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create project: {str(e)}")


@router.get("", response_model=List[Project])
@limiter.limit("30/minute")
async def get_projects(
    request: Request,
    authorization: str = Header(None, alias="Authorization")
):
    """Get all projects for the authenticated user"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        query = """
            SELECT id, user_id, title, created_at, updated_at, is_active
            FROM projects
            WHERE user_id = ? AND is_active = 1
            ORDER BY updated_at DESC
        """ if not Config.USE_POSTGRES else """
            SELECT id, user_id, title, created_at, updated_at, is_active
            FROM projects
            WHERE user_id = %s AND is_active = TRUE
            ORDER BY updated_at DESC
        """
        
        results = db.execute_many(query, (user_id,))
        
        projects = []
        for row in results:
            if Config.USE_POSTGRES:
                projects.append(Project(
                    id=row['id'],
                    user_id=row['user_id'],
                    title=row['title'],
                    created_at=row['created_at'],
                    updated_at=row['updated_at'],
                    is_active=row['is_active']
                ))
            else:
                projects.append(Project(
                    id=row['id'],
                    user_id=row['user_id'],
                    title=row['title'],
                    created_at=row['created_at'],
                    updated_at=row['updated_at'],
                    is_active=bool(row['is_active'])
                ))
        
        return projects
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching projects: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch projects: {str(e)}")


@router.get("/{project_id}")
@limiter.limit("30/minute")
async def get_project_with_outline(
    request: Request,
    project_id: int,
    authorization: str = Header(None, alias="Authorization")
):
    """Get a specific project with its outline structure"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        # Fetch project
        project_query = """
            SELECT id, user_id, title, created_at, updated_at, is_active
            FROM projects
            WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            SELECT id, user_id, title, created_at, updated_at, is_active
            FROM projects
            WHERE id = %s AND user_id = %s
        """
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Fetch outline sections
        sections_query = """
            SELECT id, project_id, title, order_index, created_at
            FROM outline_sections
            WHERE project_id = ?
            ORDER BY order_index
        """ if not Config.USE_POSTGRES else """
            SELECT id, project_id, title, order_index, created_at
            FROM outline_sections
            WHERE project_id = %s
            ORDER BY order_index
        """
        
        sections_results = db.execute_many(sections_query, (project_id,))
        
        # Fetch sources for each section
        sections = []
        for section_row in sections_results:
            section_id = section_row['id']
            
            sources_query = """
                SELECT id, section_id, source_data_json, order_index
                FROM outline_sources
                WHERE section_id = ?
                ORDER BY order_index
            """ if not Config.USE_POSTGRES else """
                SELECT id, section_id, source_data_json, order_index
                FROM outline_sources
                WHERE section_id = %s
                ORDER BY order_index
            """
            
            sources_results = db.execute_many(sources_query, (section_id,))
            
            sources = []
            for source_row in sources_results:
                sources.append(OutlineSource(
                    source_data=json.loads(source_row['source_data_json']),
                    order_index=source_row['order_index']
                ))
            
            sections.append(OutlineSection(
                id=section_row['id'],
                title=section_row['title'],
                order_index=section_row['order_index'],
                sources=sources
            ))
        
        return {
            "project": Project(
                id=project_result['id'],
                user_id=project_result['user_id'],
                title=project_result['title'],
                created_at=project_result['created_at'],
                updated_at=project_result['updated_at'],
                is_active=bool(project_result['is_active']) if not Config.USE_POSTGRES else project_result['is_active']
            ),
            "outline": sections
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch project: {str(e)}")


@router.put("/{project_id}/outline")
@limiter.limit("20/minute")
async def update_project_outline(
    request: Request,
    project_id: int,
    outline_request: UpdateOutlineRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """Update the outline structure for a project"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        # Verify project ownership
        project_query = """
            SELECT id FROM projects WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            SELECT id FROM projects WHERE id = %s AND user_id = %s
        """
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Delete existing outline structure
        if Config.USE_POSTGRES:
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    # Delete sources first (foreign key constraint)
                    cursor.execute("""
                        DELETE FROM outline_sources
                        WHERE section_id IN (
                            SELECT id FROM outline_sections WHERE project_id = %s
                        )
                    """, (project_id,))
                    
                    # Delete sections
                    cursor.execute("DELETE FROM outline_sections WHERE project_id = %s", (project_id,))
                    
                    # Insert new sections and sources
                    for section in outline_request.sections:
                        cursor.execute("""
                            INSERT INTO outline_sections (project_id, title, order_index, created_at)
                            VALUES (%s, %s, %s, NOW())
                            RETURNING id
                        """, (project_id, section.title, section.order_index))
                        
                        section_id = cursor.fetchone()[0]
                        
                        for source in section.sources:
                            cursor.execute("""
                                INSERT INTO outline_sources (section_id, source_data_json, order_index, created_at)
                                VALUES (%s, %s, %s, NOW())
                            """, (section_id, json.dumps(source.source_data), source.order_index))
                    
                    # Update project updated_at
                    cursor.execute("""
                        UPDATE projects SET updated_at = NOW() WHERE id = %s
                    """, (project_id,))
                    
                    conn.commit()
        else:
            with db.get_connection() as conn:
                # Delete sources first
                conn.execute("""
                    DELETE FROM outline_sources
                    WHERE section_id IN (
                        SELECT id FROM outline_sections WHERE project_id = ?
                    )
                """, (project_id,))
                
                # Delete sections
                conn.execute("DELETE FROM outline_sections WHERE project_id = ?", (project_id,))
                
                # Insert new sections and sources
                for section in outline_request.sections:
                    cursor = conn.execute("""
                        INSERT INTO outline_sections (project_id, title, order_index, created_at)
                        VALUES (?, ?, ?, datetime('now'))
                    """, (project_id, section.title, section.order_index))
                    
                    section_id = cursor.lastrowid
                    
                    for source in section.sources:
                        conn.execute("""
                            INSERT INTO outline_sources (section_id, source_data_json, order_index, created_at)
                            VALUES (?, ?, ?, datetime('now'))
                        """, (section_id, json.dumps(source.source_data), source.order_index))
                
                # Update project updated_at
                conn.execute("""
                    UPDATE projects SET updated_at = datetime('now') WHERE id = ?
                """, (project_id,))
                
                conn.commit()
        
        return {"status": "success", "message": "Outline updated successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating outline: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update outline: {str(e)}")


@router.put("/{project_id}")
@limiter.limit("20/minute")
async def update_project(
    request: Request,
    project_id: int,
    project_request: CreateProjectRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """Update a project's title"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        query = """
            UPDATE projects SET title = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            UPDATE projects SET title = %s, updated_at = NOW()
            WHERE id = %s AND user_id = %s
        """
        
        if Config.USE_POSTGRES:
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, (project_request.title, project_id, user_id))
                    rows_affected = cursor.rowcount
                    conn.commit()
        else:
            rows_affected = db.execute_update(query, (project_request.title, project_id, user_id))
        
        if rows_affected == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Fetch and return updated project
        fetch_query = """
            SELECT id, user_id, title, created_at, updated_at, is_active
            FROM projects
            WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            SELECT id, user_id, title, created_at, updated_at, is_active
            FROM projects
            WHERE id = %s AND user_id = %s
        """
        
        result = db.execute_query(fetch_query, (project_id, user_id))
        
        if not result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        return Project(
            id=result['id'],
            user_id=result['user_id'],
            title=result['title'],
            created_at=result['created_at'],
            updated_at=result['updated_at'],
            is_active=bool(result['is_active']) if not Config.USE_POSTGRES else result['is_active']
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update project: {str(e)}")


@router.delete("/{project_id}")
@limiter.limit("10/minute")
async def delete_project(
    request: Request,
    project_id: int,
    authorization: str = Header(None, alias="Authorization")
):
    """Delete a project (soft delete by setting is_active to false)"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        query = """
            UPDATE projects SET is_active = 0, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            UPDATE projects SET is_active = FALSE, updated_at = NOW()
            WHERE id = %s AND user_id = %s
        """
        
        if Config.USE_POSTGRES:
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, (project_id, user_id))
                    rows_affected = cursor.rowcount
                    conn.commit()
        else:
            rows_affected = db.execute_update(query, (project_id, user_id))
        
        if rows_affected == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        
        return {"status": "success", "message": "Project deleted successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting project: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete project: {str(e)}")


class Message(BaseModel):
    """Message model for conversation history"""
    id: Optional[int] = None
    project_id: int
    user_id: str
    sender: str  # 'user', 'ai', 'system'
    content: str
    message_data: Optional[Dict[str, Any]] = None  # JSON metadata (sources, etc.)
    created_at: Optional[datetime] = None


class CreateMessageRequest(BaseModel):
    """Request to create a new message"""
    sender: str = Field(..., pattern="^(user|ai|system)$")
    content: str = Field(..., min_length=1)
    message_data: Optional[Dict[str, Any]] = None


@router.get("/{project_id}/messages")
@limiter.limit("60/minute")
async def get_project_messages(
    request: Request,
    project_id: int,
    authorization: str = Header(None, alias="Authorization")
):
    """Get all messages for a project"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        # Verify project ownership
        project_query = """
            SELECT id FROM projects WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            SELECT id FROM projects WHERE id = %s AND user_id = %s
        """
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Fetch messages
        messages_query = """
            SELECT id, project_id, user_id, sender, content, message_data, created_at
            FROM messages
            WHERE project_id = ?
            ORDER BY created_at ASC
        """ if not Config.USE_POSTGRES else """
            SELECT id, project_id, user_id, sender, content, message_data, created_at
            FROM messages
            WHERE project_id = %s
            ORDER BY created_at ASC
        """
        
        messages_results = db.execute_many(messages_query, (project_id,))
        
        messages = []
        for row in messages_results:
            message_data = None
            if row.get('message_data'):
                try:
                    message_data = json.loads(row['message_data'])
                except:
                    message_data = None
            
            messages.append({
                'id': row['id'],
                'project_id': row['project_id'],
                'user_id': row['user_id'],
                'sender': row['sender'],
                'content': row['content'],
                'message_data': message_data,
                'created_at': row['created_at'].isoformat() if isinstance(row['created_at'], datetime) else str(row['created_at'])
            })
        
        return {"messages": messages}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching messages: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch messages: {str(e)}")


@router.post("/{project_id}/messages")
@limiter.limit("60/minute")
async def create_message(
    request: Request,
    project_id: int,
    message_request: CreateMessageRequest,
    authorization: str = Header(None, alias="Authorization")
):
    """Create a new message in a project"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        # Verify project ownership
        project_query = """
            SELECT id FROM projects WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            SELECT id FROM projects WHERE id = %s AND user_id = %s
        """
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Serialize message_data to JSON
        message_data_json = json.dumps(message_request.message_data) if message_request.message_data else None
        
        # Insert message
        insert_query = """
            INSERT INTO messages (project_id, user_id, sender, content, message_data)
            VALUES (?, ?, ?, ?, ?)
        """ if not Config.USE_POSTGRES else """
            INSERT INTO messages (project_id, user_id, sender, content, message_data)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at
        """
        
        if Config.USE_POSTGRES:
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(insert_query, (
                        project_id,
                        user_id,
                        message_request.sender,
                        message_request.content,
                        message_data_json
                    ))
                    result = cursor.fetchone()
                    conn.commit()
                    
                    return {
                        "status": "success",
                        "message": {
                            "id": result['id'],
                            "project_id": project_id,
                            "user_id": user_id,
                            "sender": message_request.sender,
                            "content": message_request.content,
                            "message_data": message_request.message_data,
                            "created_at": result['created_at'].isoformat()
                        }
                    }
        else:
            message_id = db.execute_insert(insert_query, (
                project_id,
                user_id,
                message_request.sender,
                message_request.content,
                message_data_json
            ))
            
            # Fetch the created message
            fetch_query = "SELECT * FROM messages WHERE id = ?"
            message_result = db.execute_query(fetch_query, (message_id,))
            
            return {
                "status": "success",
                "message": {
                    "id": message_result['id'],
                    "project_id": message_result['project_id'],
                    "user_id": message_result['user_id'],
                    "sender": message_result['sender'],
                    "content": message_result['content'],
                    "message_data": json.loads(message_result['message_data']) if message_result.get('message_data') else None,
                    "created_at": message_result['created_at']
                }
            }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating message: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create message: {str(e)}")
