"""
File upload routes for project documents
"""

import logging
import json
import io
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Header, UploadFile, File, Form, Depends
from pydantic import BaseModel

from config import Config
from utils.rate_limit import limiter
from middleware.auth_dependencies import get_current_token, get_current_user_id
from utils.auth import extract_user_id_from_token
# Use centralized database wrapper instead of conditional imports
from data.db_wrapper import db_instance as db

try:
    from docx import Document
except ImportError:
    Document = None

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

logger = logging.getLogger(__name__)
router = APIRouter()

# Database is now imported via db_wrapper - no need for conditional logic

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_EXTENSIONS = {'.md', '.doc', '.docx', '.pdf'}


# Auth helper functions removed - now using centralized auth_dependencies and utils.auth modules

