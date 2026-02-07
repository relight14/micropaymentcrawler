"""Project management and outline builder routes"""

from fastapi import APIRouter, HTTPException, Header, Request, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import logging
import json
import os
from datetime import datetime
from anthropic import Anthropic
from utils.rate_limit import limiter
from config import Config
from services.ai.outline_suggester import get_outline_suggester
from middleware.auth_dependencies import get_current_token, get_current_user_id
from utils.auth import extract_user_id_from_token
# Use centralized database wrapper instead of conditional imports
from data.db_wrapper import db_instance as db, normalize_query

# Setup logging
logger = logging.getLogger(__name__)

# Initialize Anthropic client for title generation
anthropic_client = None
try:
    anthropic_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if anthropic_key:
        anthropic_client = Anthropic(api_key=anthropic_key)
        logger.info("AI title generation enabled")
except Exception as e:
    logger.warning(f"AI title generation disabled: {e}")

router = APIRouter()

# Database is now imported via db_wrapper - no need for conditional logic


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
    research_query: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    is_active: bool = True


class CreateProjectRequest(BaseModel):
    """Request to create a new project"""
    title: str = Field(..., min_length=1, max_length=500)
    research_query: Optional[str] = None


class UpdateOutlineRequest(BaseModel):
    """Request to update project outline"""
    sections: List[OutlineSection]


class ProjectSource(BaseModel):
    """Source in the sources panel"""
    id: Optional[int] = None
    source_data: Dict[str, Any]  # Full source card data
    order_index: int


class UpdateSourcesRequest(BaseModel):
    """Request to update project sources"""
    sources: List[ProjectSource]


# Auth helper functions removed - now using centralized auth_dependencies module


def generate_smart_title(research_query: str, fallback_title: str) -> str:
    """
    Generate a professional project title from a research query using AI.
    Falls back to the provided title if AI is unavailable or fails.
    
    Examples:
    - "investigative journalism" → "Investigative Journalism Analysis"
    - "climate change" → "Climate Change Research"
    - "medieval castles" → "Medieval Castles Study"
    """
    if not anthropic_client:
        logger.warning(f"⚠️  AI title generation unavailable (Anthropic client not initialized), using fallback: {fallback_title}")
        return fallback_title
    
    if not research_query:
        return fallback_title
    
    try:
        response = anthropic_client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=50,
            temperature=0.7,
            messages=[{
                "role": "user",
                "content": f"""Generate a professional 2-5 word project title for this research topic: "{research_query}"

Requirements:
- Make it professional and descriptive
- Keep it concise (2-5 words maximum)
- Capitalize properly
- Add a relevant suffix like "Analysis", "Research", "Study", or "Investigation" if appropriate
- Return ONLY the title, no explanation

Examples:
- "dogs" → "Canine Behavior Study"
- "investigative journalism" → "Investigative Journalism Analysis"  
- "climate change impacts" → "Climate Change Impact Research"

Title:"""
            }]
        )
        
        generated_title = response.content[0].text.strip().strip('"\'')
        
        # Validate the generated title
        if generated_title and len(generated_title) > 3 and len(generated_title) < 100:
            logger.info(f"✨ Generated title: '{generated_title}' from query: '{research_query}'")
            return generated_title
        else:
            logger.warning(f"Invalid AI-generated title, using fallback: {generated_title}")
            return fallback_title
            
    except Exception as e:
        logger.warning(f"Title generation failed, using fallback: {e}")
        return fallback_title


# extract_user_id_from_token removed - now using utils.auth module


@router.post("", response_model=Project)
@limiter.limit("20/minute")
async def create_project(
    request: Request,
    project_request: CreateProjectRequest,
    user_id: str = Depends(get_current_user_id)
):
    """Create a new project with AI-enhanced title generation"""
    try:
        
        # Generate smart title if research_query is provided
        final_title = project_request.title
        if project_request.research_query:
            final_title = generate_smart_title(
                project_request.research_query,
                project_request.title
            )
        
        # Insert project into database
        if Config.USE_POSTGRES:
            query = """
                INSERT INTO projects (user_id, title, research_query, created_at, updated_at, is_active)
                VALUES (%s, %s, %s, NOW(), NOW(), TRUE)
                RETURNING id, user_id, title, research_query, created_at, updated_at, is_active
            """
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, (user_id, final_title, project_request.research_query))
                    result = cursor.fetchone()
                    conn.commit()
                    
                    return Project(
                        id=result['id'],
                        user_id=result['user_id'],
                        title=result['title'],
                        research_query=result.get('research_query'),
                        created_at=result['created_at'],
                        updated_at=result['updated_at'],
                        is_active=result['is_active']
                    )
        else:
            query = """
                INSERT INTO projects (user_id, title, research_query, created_at, updated_at, is_active)
                VALUES (?, ?, ?, datetime('now'), datetime('now'), 1)
            """
            project_id = db.execute_write(query, (user_id, final_title, project_request.research_query))
            
            # Fetch the created project
            result = db.execute_query(
                "SELECT id, user_id, title, research_query, created_at, updated_at, is_active FROM projects WHERE id = ?",
                (project_id,)
            )
            
            return Project(
                id=result['id'],
                user_id=result['user_id'],
                title=result['title'],
                research_query=result.get('research_query'),
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
    token: str = Depends(get_current_token)
):
    """Get all projects for the authenticated user"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        query = normalize_query("""SELECT id, user_id, title, research_query, created_at, updated_at, is_active
            FROM projects
            WHERE user_id = ? AND is_active = TRUE
            ORDER BY updated_at DESC""")
        
        results = db.execute_many(query, (user_id,))
        
        projects = []
        for row in results:
            if Config.USE_POSTGRES:
                projects.append(Project(
                    id=row['id'],
                    user_id=row['user_id'],
                    title=row['title'],
                    research_query=row['research_query'] if 'research_query' in row.keys() else None,
                    created_at=row['created_at'],
                    updated_at=row['updated_at'],
                    is_active=row['is_active']
                ))
            else:
                projects.append(Project(
                    id=row['id'],
                    user_id=row['user_id'],
                    title=row['title'],
                    research_query=row['research_query'] if 'research_query' in row.keys() else None,
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
    token: str = Depends(get_current_token)
):
    """Get a specific project with its outline structure"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        # Fetch project
        project_query = normalize_query("""SELECT id, user_id, title, research_query, created_at, updated_at, is_active
            FROM projects
            WHERE id = ? AND user_id = ?""")
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Fetch outline sections
        sections_query = normalize_query("""SELECT id, project_id, title, order_index, created_at
            FROM outline_sections
            WHERE project_id = ?
            ORDER BY order_index""")
        
        sections_results = db.execute_many(sections_query, (project_id,))
        
        # Fetch sources for each section
        sections = []
        for section_row in sections_results:
            section_id = section_row['id']
            
            sources_query = normalize_query("""SELECT id, section_id, source_data_json, order_index
                FROM outline_sources
                WHERE section_id = ?
                ORDER BY order_index""")
            
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
                research_query=project_result.get('research_query'),
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
    token: str = Depends(get_current_token)
):
    """Update the outline structure for a project"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        # Verify project ownership
        project_query = normalize_query("""SELECT id FROM projects WHERE id = ? AND user_id = ?""")
        
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
                        
                        section_id = cursor.fetchone()['id']
                        
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


@router.get("/{project_id}/sources")
@limiter.limit("30/minute")
async def get_project_sources(
    request: Request,
    project_id: int,
    token: str = Depends(get_current_token)
):
    """Get sources for a project"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        # Verify project ownership
        project_query = normalize_query("""SELECT id FROM projects WHERE id = ? AND user_id = ?""")
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Fetch sources
        sources_query = normalize_query("""SELECT id, project_id, source_data_json, order_index, created_at
            FROM project_sources
            WHERE project_id = ?
            ORDER BY order_index""")
        
        sources_results = db.execute_many(sources_query, (project_id,))
        
        sources = []
        for source_row in sources_results:
            sources.append(ProjectSource(
                id=source_row['id'],
                source_data=json.loads(source_row['source_data_json']),
                order_index=source_row['order_index']
            ))
        
        return {"sources": sources}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching project sources: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch sources: {str(e)}")


@router.put("/{project_id}/sources")
@limiter.limit("20/minute")
async def update_project_sources(
    request: Request,
    project_id: int,
    sources_request: UpdateSourcesRequest,
    token: str = Depends(get_current_token)
):
    """Update sources for a project"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        # Verify project ownership
        project_query = normalize_query("""SELECT id FROM projects WHERE id = ? AND user_id = ?""")
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Delete existing sources and insert new ones
        if Config.USE_POSTGRES:
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    # Delete existing sources
                    cursor.execute(
                        "DELETE FROM project_sources WHERE project_id = %s",
                        (project_id,)
                    )
                    
                    # Insert new sources
                    for source in sources_request.sources:
                        cursor.execute("""
                            INSERT INTO project_sources (project_id, source_data_json, order_index, created_at)
                            VALUES (%s, %s, %s, NOW())
                        """, (project_id, json.dumps(source.source_data), source.order_index))
                    
                    # Update project updated_at
                    cursor.execute(
                        "UPDATE projects SET updated_at = NOW() WHERE id = %s",
                        (project_id,)
                    )
                    
                    conn.commit()
        else:
            with db.get_connection() as conn:
                # Delete existing sources
                conn.execute(
                    "DELETE FROM project_sources WHERE project_id = ?",
                    (project_id,)
                )
                
                # Insert new sources
                for source in sources_request.sources:
                    conn.execute("""
                        INSERT INTO project_sources (project_id, source_data_json, order_index, created_at)
                        VALUES (?, ?, ?, datetime('now'))
                    """, (project_id, json.dumps(source.source_data), source.order_index))
                
                # Update project updated_at
                conn.execute(
                    "UPDATE projects SET updated_at = datetime('now') WHERE id = ?",
                    (project_id,)
                )
                
                conn.commit()
        
        return {"status": "success", "message": "Sources updated successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating project sources: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update sources: {str(e)}")


@router.put("/{project_id}")
@limiter.limit("20/minute")
async def update_project(
    request: Request,
    project_id: int,
    project_request: CreateProjectRequest,
    token: str = Depends(get_current_token)
):
    """Update a project's title"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        query = normalize_query("""UPDATE projects SET title = ?, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?""")
        
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
        fetch_query = normalize_query("""SELECT id, user_id, title, created_at, updated_at, is_active
            FROM projects
            WHERE id = ? AND user_id = ?""")
        
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
    token: str = Depends(get_current_token)
):
    """Delete a project (soft delete by setting is_active to false)"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        query = normalize_query("""UPDATE projects SET is_active = 0, updated_at = datetime('now')
            WHERE id = ? AND user_id = ?""")
        
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
    token: str = Depends(get_current_token)
):
    """Get all messages for a project"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        # Verify project ownership
        project_query = normalize_query("""SELECT id FROM projects WHERE id = ? AND user_id = ?""")
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Fetch messages
        messages_query = normalize_query("""SELECT id, project_id, user_id, sender, content, message_data, created_at
            FROM messages
            WHERE project_id = ?
            ORDER BY created_at ASC""")
        
        messages_results = db.execute_many(messages_query, (project_id,))
        
        messages = []
        for row in messages_results:
            message_data = None
            if row['message_data']:
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
    token: str = Depends(get_current_token)
):
    """Create a new message in a project"""
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        # Verify project ownership
        project_query = normalize_query("""SELECT id FROM projects WHERE id = ? AND user_id = ?""")
        
        project_result = db.execute_query(project_query, (project_id, user_id))
        
        if not project_result:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Serialize message_data to JSON
        message_data_json = json.dumps(message_request.message_data) if message_request.message_data else None
        
        # Insert message
        if Config.USE_POSTGRES:
            # Postgres: Use RETURNING clause to get the created message
            insert_query = """INSERT INTO messages (project_id, user_id, sender, content, message_data, created_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                RETURNING id, created_at"""
            
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
            # SQLite: Use execute_insert and fetch the created message
            insert_query = """INSERT INTO messages (project_id, user_id, sender, content, message_data, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))"""
            
            message_id = db.execute_write(insert_query, (
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


class OutlineSuggestionResponse(BaseModel):
    """AI-generated outline suggestion"""
    title: str
    rationale: str
    order_index: int


@router.post("/{project_id}/suggest-outline", response_model=List[OutlineSuggestionResponse])
@limiter.limit("10/minute")
async def suggest_outline(
    request: Request,
    project_id: int,
    token: str = Depends(get_current_token)
):
    """
    Generate AI-powered outline suggestions for a project based on its research topic.
    Uses conversation history and project title for context.
    """
    try:
        # Token validated by dependency
        user_id = extract_user_id_from_token(token)
        
        # Get project to verify ownership and get research topic
        if Config.USE_POSTGRES:
            query = "SELECT * FROM projects WHERE id = %s AND user_id = %s"
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(query, (project_id, user_id))
                    project = cursor.fetchone()
        else:
            query = "SELECT * FROM projects WHERE id = ? AND user_id = ?"
            project = db.execute_query(query, (project_id, user_id))
        
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get conversation history for context
        conversation_context = []
        if Config.USE_POSTGRES:
            messages_query = """
                SELECT sender, content FROM messages 
                WHERE project_id = %s 
                ORDER BY created_at DESC 
                LIMIT 6
            """
            with db.get_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute(messages_query, (project_id,))
                    messages = cursor.fetchall()
                    conversation_context = [
                        {"sender": msg['sender'], "content": msg['content']}
                        for msg in messages
                    ]
        else:
            messages_query = """
                SELECT sender, content FROM messages 
                WHERE project_id = ? 
                ORDER BY created_at DESC 
                LIMIT 6
            """
            messages = db.execute_query(messages_query, (project_id,), fetch_all=True)
            conversation_context = [
                {"sender": msg['sender'], "content": msg['content']}
                for msg in messages
            ] if messages else []
        
        # Reverse to chronological order (oldest first)
        conversation_context.reverse()
        
        # Get AI suggestions
        suggester = get_outline_suggester()
        research_topic = project['title'] if isinstance(project, dict) else project.title
        suggestions = suggester.suggest_outline(research_topic, conversation_context)
        
        # Convert to response format
        return [
            OutlineSuggestionResponse(
                title=s.title,
                rationale=s.rationale,
                order_index=s.order_index
            )
            for s in suggestions
        ]
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating outline suggestions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate outline suggestions: {str(e)}")
