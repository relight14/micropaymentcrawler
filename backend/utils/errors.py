"""Common error classes and utilities"""

from fastapi import HTTPException
from typing import Any, Dict, Optional


class AuthenticationError(HTTPException):
    """Authentication related errors"""
    def __init__(self, detail: str = "Authentication failed"):
        super().__init__(status_code=401, detail=detail)


class PaymentError(HTTPException):
    """Payment processing errors"""
    def __init__(self, detail: str = "Payment processing failed"):
        super().__init__(status_code=402, detail=detail)


class InsufficientFundsError(PaymentError):
    """Insufficient funds for purchase"""
    def __init__(self, required: float, available: float):
        detail = f"Insufficient funds. Required: ${required:.2f}, Available: ${available:.2f}"
        super().__init__(detail=detail)


class ExternalServiceError(HTTPException):
    """External service integration errors"""
    def __init__(self, service: str, detail: str = "External service unavailable"):
        super().__init__(status_code=503, detail=f"{service}: {detail}")


class ValidationError(HTTPException):
    """Request validation errors"""
    def __init__(self, detail: str = "Invalid request"):
        super().__init__(status_code=400, detail=detail)