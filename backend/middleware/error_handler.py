"""Global error handling middleware for production"""

import logging
import traceback
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Callable

logger = logging.getLogger(__name__)


class ErrorHandlerMiddleware(BaseHTTPMiddleware):
    """Catch unhandled exceptions and return user-friendly errors"""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        try:
            response = await call_next(request)
            return response
        
        except ValueError as e:
            # Bad request errors
            logger.warning(f"ValueError in {request.url.path}: {str(e)}")
            return JSONResponse(
                status_code=400,
                content={
                    "detail": str(e),
                    "type": "validation_error"
                }
            )
        
        except ConnectionError as e:
            # External API failures
            logger.error(f"Connection error in {request.url.path}: {str(e)}")
            return JSONResponse(
                status_code=503,
                content={
                    "detail": "External service temporarily unavailable. Please try again.",
                    "type": "service_unavailable"
                }
            )
        
        except Exception as e:
            # Catch-all for unexpected errors
            error_id = traceback.format_exc()[-50:]  # Last 50 chars as error ID
            logger.error(
                f"Unhandled exception in {request.url.path}: {type(e).__name__}: {str(e)}\n"
                f"Traceback:\n{traceback.format_exc()}"
            )
            
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "An unexpected error occurred. Please try again later.",
                    "type": "internal_error",
                    "error_id": error_id[-12:]  # Short error ID for support
                }
            )


class BudgetExceededError(Exception):
    """Raised when user or global budget is exceeded"""
    pass


class APIKeyMissingError(Exception):
    """Raised when required API key is missing"""
    pass
