"""
RSL Token Manager
Handles OAuth 2.0 token lifecycle for RSL protocol license servers
"""
import os
import json
import logging
import httpx
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from dataclasses import dataclass, asdict
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class RSLToken:
    """RSL OAuth 2.0 token"""
    access_token: str
    token_type: str
    expires_at: datetime
    refresh_token: Optional[str] = None
    scope: Optional[str] = None
    license_server_url: str = ""
    content_url: str = ""
    
    def is_expired(self) -> bool:
        """Check if token is expired (with 60 second buffer)"""
        return datetime.now() >= (self.expires_at - timedelta(seconds=60))
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization"""
        d = asdict(self)
        d['expires_at'] = self.expires_at.isoformat()
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'RSLToken':
        """Create from dictionary"""
        data = data.copy()
        data['expires_at'] = datetime.fromisoformat(data['expires_at'])
        return cls(**data)


class RSLTokenManager:
    """
    Manages OAuth 2.0 tokens for RSL license servers
    
    Supports:
    - Client Credentials flow (machine-to-machine)
    - Token storage and retrieval
    - Automatic token refresh
    - Multiple license servers
    """
    
    def __init__(self, storage_path: Optional[str] = None):
        """
        Initialize token manager
        
        Args:
            storage_path: Path to store tokens (default: /tmp/rsl_tokens.json)
        """
        self.storage_path = storage_path or "/tmp/rsl_tokens.json"
        self._tokens: Dict[str, RSLToken] = {}
        self._load_tokens()
        
        # OAuth credentials from environment
        self.client_id = os.environ.get('RSL_CLIENT_ID', '')
        self.client_secret = os.environ.get('RSL_CLIENT_SECRET', '')
    
    def _load_tokens(self):
        """Load tokens from storage"""
        try:
            if os.path.exists(self.storage_path):
                with open(self.storage_path, 'r') as f:
                    data = json.load(f)
                    for key, token_data in data.items():
                        try:
                            self._tokens[key] = RSLToken.from_dict(token_data)
                        except Exception as e:
                            logger.warning(f"Failed to load token for {key}: {e}")
        except Exception as e:
            logger.error(f"Failed to load tokens from {self.storage_path}: {e}")
    
    def _save_tokens(self):
        """Save tokens to storage"""
        try:
            # Create directory if it doesn't exist
            Path(self.storage_path).parent.mkdir(parents=True, exist_ok=True)
            
            # Save only non-expired tokens
            data = {}
            for key, token in self._tokens.items():
                if not token.is_expired():
                    data[key] = token.to_dict()
            
            with open(self.storage_path, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save tokens to {self.storage_path}: {e}")
    
    def _get_cache_key(self, license_server_url: str, content_url: str) -> str:
        """Generate cache key for token storage"""
        return f"{license_server_url}::{content_url}"
    
    async def request_token(
        self,
        license_server_url: str,
        content_url: str,
        license_type: str = "ai-include",
        scope: Optional[str] = None
    ) -> Optional[RSLToken]:
        """
        Request OAuth 2.0 token from RSL license server
        
        Uses Client Credentials flow:
        POST /oauth/token
        Body: grant_type=client_credentials&scope=...
        
        Args:
            license_server_url: Base URL of license server
            content_url: URL of content to license
            license_type: Type of license (ai-include, ai-train, etc.)
            scope: OAuth scope (optional)
        
        Returns:
            RSLToken if successful, None otherwise
        """
        try:
            # Check cache first
            cache_key = self._get_cache_key(license_server_url, content_url)
            if cache_key in self._tokens:
                token = self._tokens[cache_key]
                if not token.is_expired():
                    logger.info(f"Using cached RSL token for {content_url}")
                    return token
                elif token.refresh_token:
                    # Try to refresh
                    refreshed = await self._refresh_token(token)
                    if refreshed:
                        return refreshed
            
            # No cached token or refresh failed - request new token
            # Check if OAuth credentials are configured
            if not self.client_id or not self.client_secret:
                logger.warning("RSL_CLIENT_ID and RSL_CLIENT_SECRET not configured - using demo mode")
                # Create and cache mock token
                mock_token = self._create_mock_token(license_server_url, content_url)
                self._tokens[cache_key] = mock_token
                self._save_tokens()
                return mock_token
            
            token_endpoint = f"{license_server_url.rstrip('/')}/oauth/token"
            
            # Build scope
            if not scope:
                scope = f"content:read content:{license_type}"
            
            # Prepare request
            data = {
                'grant_type': 'client_credentials',
                'scope': scope,
                'resource': content_url  # RFC 8707 - resource indicator
            }
            
            auth = (self.client_id, self.client_secret)
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    token_endpoint,
                    data=data,
                    auth=auth,
                    headers={'Accept': 'application/json'}
                )
                
                if response.status_code == 200:
                    token_data = response.json()
                    
                    # Parse token response
                    access_token = token_data.get('access_token')
                    token_type = token_data.get('token_type', 'Bearer')
                    expires_in = token_data.get('expires_in', 3600)  # Default 1 hour
                    refresh_token = token_data.get('refresh_token')
                    
                    if not access_token:
                        logger.error(f"No access_token in response from {token_endpoint}")
                        return None
                    
                    # Create token
                    token = RSLToken(
                        access_token=access_token,
                        token_type=token_type,
                        expires_at=datetime.now() + timedelta(seconds=expires_in),
                        refresh_token=refresh_token,
                        scope=token_data.get('scope', scope),
                        license_server_url=license_server_url,
                        content_url=content_url
                    )
                    
                    # Cache token
                    self._tokens[cache_key] = token
                    self._save_tokens()
                    
                    logger.info(f"Successfully obtained RSL token for {content_url}")
                    return token
                else:
                    logger.error(f"Failed to get RSL token: {response.status_code} - {response.text[:200]}")
                    return None
                    
        except httpx.HTTPError as e:
            logger.error(f"HTTP error requesting RSL token: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error requesting RSL token: {e}")
            return None
    
    async def _refresh_token(self, token: RSLToken) -> Optional[RSLToken]:
        """
        Refresh expired token using refresh token
        
        Args:
            token: Expired token with refresh_token
        
        Returns:
            New RSLToken if successful, None otherwise
        """
        if not token.refresh_token:
            return None
        
        try:
            token_endpoint = f"{token.license_server_url.rstrip('/')}/oauth/token"
            
            data = {
                'grant_type': 'refresh_token',
                'refresh_token': token.refresh_token
            }
            
            auth = None
            if self.client_id and self.client_secret:
                auth = (self.client_id, self.client_secret)
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    token_endpoint,
                    data=data,
                    auth=auth,
                    headers={'Accept': 'application/json'}
                )
                
                if response.status_code == 200:
                    token_data = response.json()
                    
                    # Create new token
                    new_token = RSLToken(
                        access_token=token_data.get('access_token'),
                        token_type=token_data.get('token_type', 'Bearer'),
                        expires_at=datetime.now() + timedelta(seconds=token_data.get('expires_in', 3600)),
                        refresh_token=token_data.get('refresh_token', token.refresh_token),
                        scope=token_data.get('scope', token.scope),
                        license_server_url=token.license_server_url,
                        content_url=token.content_url
                    )
                    
                    # Update cache
                    cache_key = self._get_cache_key(token.license_server_url, token.content_url)
                    self._tokens[cache_key] = new_token
                    self._save_tokens()
                    
                    logger.info(f"Successfully refreshed RSL token for {token.content_url}")
                    return new_token
                else:
                    logger.warning(f"Failed to refresh RSL token: {response.status_code}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error refreshing RSL token: {e}")
            return None
    
    def _create_mock_token(self, license_server_url: str, content_url: str) -> RSLToken:
        """
        Create mock token for demo/testing when OAuth credentials not configured
        """
        logger.info(f"Creating mock RSL token for {content_url} (OAuth not configured)")
        return RSLToken(
            access_token=f"mock_rsl_token_{os.urandom(16).hex()}",
            token_type="Bearer",
            expires_at=datetime.now() + timedelta(hours=24),
            refresh_token=None,
            scope="content:read content:ai-include",
            license_server_url=license_server_url,
            content_url=content_url
        )
    
    def get_cached_token(self, license_server_url: str, content_url: str) -> Optional[RSLToken]:
        """Get cached token if available and not expired"""
        cache_key = self._get_cache_key(license_server_url, content_url)
        token = self._tokens.get(cache_key)
        
        if token and not token.is_expired():
            return token
        return None
    
    def clear_cache(self):
        """Clear all cached tokens"""
        self._tokens.clear()
        try:
            if os.path.exists(self.storage_path):
                os.remove(self.storage_path)
        except Exception as e:
            logger.error(f"Error clearing token cache: {e}")
