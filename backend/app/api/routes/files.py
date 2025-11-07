"""
File upload routes for project documents
"""

import logging
import json
import io
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Header, UploadFile, File, Form
from pydantic import BaseModel

from config import Config
from utils.rate_limit import limiter

try:
    from docx import Document
except ImportError:
    Document = None

logger = logging.getLogger(__name__)
router = APIRouter()

if Config.USE_POSTGRES:
    from data.postgres_db import postgres_db as db
else:
    from data.db import db

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {'.md', '.doc', '.docx'}


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


class UploadedFileResponse(BaseModel):
    """Response model for uploaded file"""
    id: int
    project_id: int
    filename: str
    file_type: str
    content_preview: str
    file_size: int
    created_at: str


def parse_docx(file_content: bytes) -> str:
    """Parse .doc/.docx file and extract text content"""
    if Document is None:
        raise HTTPException(status_code=500, detail="Document parsing not available")
    
    try:
        doc = Document(io.BytesIO(file_content))
        paragraphs = []
        for para in doc.paragraphs:
            if para.text.strip():
                paragraphs.append(para.text)
        return '\n\n'.join(paragraphs)
    except Exception as e:
        logger.error(f"Error parsing DOCX file: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to parse document: {str(e)}")


def parse_markdown(file_content: bytes) -> str:
    """Parse .md file content"""
    try:
        return file_content.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid markdown file encoding (must be UTF-8)")


@router.post("/upload", response_model=UploadedFileResponse)
@limiter.limit("20/minute")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    project_id: int = Form(...),
    authorization: str = Header(None, alias="Authorization")
):
    """
    Upload a document file (.doc, .docx, .md) to a project
    """
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
        
        # Validate file extension
        filename = file.filename or "untitled"
        file_ext = '.' + filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        
        if file_ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            )
        
        # Read file content
        file_content = await file.read()
        file_size = len(file_content)
        
        # Validate file size
        if file_size > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB"
            )
        
        if file_size == 0:
            raise HTTPException(status_code=400, detail="Empty file")
        
        # Parse content based on file type
        if file_ext in ['.doc', '.docx']:
            file_type = 'docx'
            parsed_content = parse_docx(file_content)
        elif file_ext == '.md':
            file_type = 'markdown'
            parsed_content = parse_markdown(file_content)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {file_ext}")
        
        # Store in database
        if Config.USE_POSTGRES:
            query = """
                INSERT INTO uploaded_files (project_id, user_id, filename, file_type, content, file_size, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                RETURNING id, created_at
            """
            with db.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(query, (project_id, user_id, filename, file_type, parsed_content, file_size))
                result = cursor.fetchone()
                conn.commit()
                
                file_id = result['id']
                created_at = result['created_at']
        else:
            query = """
                INSERT INTO uploaded_files (project_id, user_id, filename, file_type, content, file_size, created_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            """
            file_id = db.execute_write(query, (project_id, user_id, filename, file_type, parsed_content, file_size))
            
            # Fetch created_at
            result = db.execute_query(
                "SELECT created_at FROM uploaded_files WHERE id = ?",
                (file_id,)
            )
            created_at = result['created_at']
        
        # Update project timestamp
        update_query = """
            UPDATE projects SET updated_at = datetime('now') WHERE id = ?
        """ if not Config.USE_POSTGRES else """
            UPDATE projects SET updated_at = NOW() WHERE id = %s
        """
        db.execute_write(update_query, (project_id,))
        
        # Return response with preview (first 200 characters)
        content_preview = parsed_content[:200] + '...' if len(parsed_content) > 200 else parsed_content
        
        return UploadedFileResponse(
            id=file_id,
            project_id=project_id,
            filename=filename,
            file_type=file_type,
            content_preview=content_preview,
            file_size=file_size,
            created_at=created_at.isoformat() if isinstance(created_at, datetime) else str(created_at)
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to upload file: {str(e)}")


@router.get("/project/{project_id}", response_model=list[UploadedFileResponse])
@limiter.limit("60/minute")
async def get_project_files(
    request: Request,
    project_id: int,
    authorization: str = Header(None, alias="Authorization")
):
    """Get all uploaded files for a project"""
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
        
        # Fetch files
        files_query = """
            SELECT id, project_id, filename, file_type, content, file_size, created_at
            FROM uploaded_files
            WHERE project_id = ?
            ORDER BY created_at DESC
        """ if not Config.USE_POSTGRES else """
            SELECT id, project_id, filename, file_type, content, file_size, created_at
            FROM uploaded_files
            WHERE project_id = %s
            ORDER BY created_at DESC
        """
        
        files_results = db.execute_many(files_query, (project_id,))
        
        files = []
        for row in files_results:
            content = row['content']
            content_preview = content[:200] + '...' if len(content) > 200 else content
            
            files.append(UploadedFileResponse(
                id=row['id'],
                project_id=row['project_id'],
                filename=row['filename'],
                file_type=row['file_type'],
                content_preview=content_preview,
                file_size=row['file_size'],
                created_at=row['created_at'].isoformat() if isinstance(row['created_at'], datetime) else str(row['created_at'])
            ))
        
        return files
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching files: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch files: {str(e)}")


@router.delete("/{file_id}")
@limiter.limit("30/minute")
async def delete_file(
    request: Request,
    file_id: int,
    authorization: str = Header(None, alias="Authorization")
):
    """Delete an uploaded file"""
    try:
        access_token = extract_bearer_token(authorization)
        user_id = extract_user_id_from_token(access_token)
        
        # Verify file ownership
        file_query = """
            SELECT id, project_id FROM uploaded_files WHERE id = ? AND user_id = ?
        """ if not Config.USE_POSTGRES else """
            SELECT id, project_id FROM uploaded_files WHERE id = %s AND user_id = %s
        """
        
        file_result = db.execute_query(file_query, (file_id, user_id))
        
        if not file_result:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Delete file
        delete_query = """
            DELETE FROM uploaded_files WHERE id = ?
        """ if not Config.USE_POSTGRES else """
            DELETE FROM uploaded_files WHERE id = %s
        """
        
        db.execute_write(delete_query, (file_id,))
        
        return {"status": "success", "message": "File deleted successfully"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")
