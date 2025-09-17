"""
Content Licensing Abstraction Layer
Multi-protocol support for RSL, Tollbit, Cloudflare and future licensing systems.
"""
import os
import uuid
import requests
import xml.etree.ElementTree as ET
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse

@dataclass
class LicenseTerms:
    """Standard license terms across all protocols"""
    protocol: str
    ai_include_price: Optional[float] = None
    purchase_price: Optional[float] = None
    currency: str = "USD"
    publisher: Optional[str] = None
    license_server_url: Optional[str] = None
    permits_ai_training: bool = False
    permits_ai_include: bool = False
    permits_search: bool = False
    requires_attribution: bool = False

@dataclass
class LicenseToken:
    """License token from any protocol"""
    token: str
    protocol: str
    cost: float
    currency: str
    expires_at: datetime
    content_url: str
    license_type: str

class ProtocolHandler(ABC):
    """Abstract base class for content licensing protocols"""
    
    @abstractmethod
    def check_source(self, url: str) -> Optional[LicenseTerms]:
        """Check if this source supports this protocol and return license terms"""
        pass
    
    @abstractmethod
    def request_license(self, url: str, license_type: str = "ai-include") -> LicenseToken:
        """Request license through this protocol"""
        pass

class RSLProtocolHandler(ProtocolHandler):
    """Handler for RSL (Resource Specification Language) protocol"""
    
    def check_source(self, url: str) -> Optional[LicenseTerms]:
        """Check for RSL licensing at this source"""
        try:
            domain = urlparse(url).netloc
            # Check common RSL file locations
            rsl_paths = ['/rsl.xml', '/.well-known/rsl.xml', '/robots/rsl.xml']
            
            for path in rsl_paths:
                rsl_url = f"https://{domain}{path}"
                try:
                    response = requests.get(rsl_url, timeout=5)
                    if response.status_code == 200:
                        return self._parse_rsl_xml(response.text, rsl_url)
                except requests.RequestException:
                    continue
                    
            return None
        except Exception as e:
            print(f"RSL check failed for {url}: {e}")
            return None
    
    def _parse_rsl_xml(self, xml_content: str, rsl_url: str) -> Optional[LicenseTerms]:
        """Parse RSL XML and extract licensing terms"""
        try:
            root = ET.fromstring(xml_content)
            
            # Find content element that matches our URL pattern
            for content in root.findall('.//{https://rslstandard.org/rsl}content'):
                # Parse license terms
                license_elem = content.find('.//{https://rslstandard.org/rsl}license')
                if license_elem is None:
                    continue
                
                # Extract permissions
                permits = license_elem.find('.//{https://rslstandard.org/rsl}permits[@type="usage"]')
                permits_ai_include = False
                permits_ai_training = False
                permits_search = False
                
                if permits is not None:
                    permitted_uses = permits.text.split(',') if permits.text else []
                    permits_ai_include = any(use.strip() in ['all', 'ai-include'] for use in permitted_uses)
                    permits_ai_training = any(use.strip() in ['all', 'ai-train'] for use in permitted_uses)
                    permits_search = any(use.strip() in ['all', 'search'] for use in permitted_uses)
                
                # Extract pricing
                payment = license_elem.find('.//{https://rslstandard.org/rsl}payment')
                ai_include_price = None
                purchase_price = None
                currency = "USD"
                
                if payment is not None:
                    amount_elem = payment.find('.//{https://rslstandard.org/rsl}amount')
                    if amount_elem is not None:
                        try:
                            price = float(amount_elem.text)
                            currency = amount_elem.get('currency', 'USD')
                            
                            # Determine price type based on payment type
                            payment_type = payment.get('type', 'purchase')
                            if payment_type in ['inference', 'crawl']:
                                ai_include_price = price
                            else:
                                purchase_price = price
                        except (ValueError, TypeError):
                            pass
                
                # Extract publisher info
                copyright_elem = content.find('.//{https://rslstandard.org/rsl}copyright')
                publisher = copyright_elem.text if copyright_elem is not None else None
                
                # Extract license server URL
                server_url = content.get('server')
                
                return LicenseTerms(
                    protocol="rsl",
                    ai_include_price=ai_include_price,
                    purchase_price=purchase_price,
                    currency=currency,
                    publisher=publisher,
                    license_server_url=server_url,
                    permits_ai_training=permits_ai_training,
                    permits_ai_include=permits_ai_include,
                    permits_search=permits_search,
                    requires_attribution=payment.get('type') == 'attribution' if payment is not None else False
                )
                
            return None
        except ET.ParseError as e:
            print(f"Failed to parse RSL XML: {e}")
            return None
    
    def request_license(self, url: str, license_type: str = "ai-include") -> LicenseToken:
        """Request RSL license from license server"""
        # For MVP, return a mock license token
        # TODO: Implement real RSL license server communication
        return LicenseToken(
            token=f"rsl_token_{uuid.uuid4().hex[:16]}",
            protocol="rsl",
            cost=0.05,  # Mock cost
            currency="USD",
            expires_at=datetime.now() + timedelta(hours=24),
            content_url=url,
            license_type=license_type
        )

class TollbitProtocolHandler(ProtocolHandler):
    """Handler for Tollbit protocol"""
    
    def check_source(self, url: str) -> Optional[LicenseTerms]:
        """Check for Tollbit licensing signals"""
        try:
            # Check for Tollbit headers or metadata
            response = requests.head(url, timeout=5)
            
            # Look for Tollbit-specific headers
            if 'x-tollbit-license' in response.headers or 'tollbit-pricing' in response.headers:
                return LicenseTerms(
                    protocol="tollbit",
                    ai_include_price=0.03,  # Mock pricing for MVP
                    purchase_price=0.15,
                    currency="USD",
                    publisher="Tollbit Publisher",
                    permits_ai_include=True,
                    permits_search=True
                )
            return None
        except requests.RequestException:
            return None
    
    def request_license(self, url: str, license_type: str = "ai-include") -> LicenseToken:
        """Request Tollbit license"""
        # Mock implementation for MVP
        return LicenseToken(
            token=f"tollbit_token_{uuid.uuid4().hex[:16]}",
            protocol="tollbit",
            cost=0.03,
            currency="USD", 
            expires_at=datetime.now() + timedelta(hours=12),
            content_url=url,
            license_type=license_type
        )

class CloudflareProtocolHandler(ProtocolHandler):
    """Handler for Cloudflare licensing protocol"""
    
    def check_source(self, url: str) -> Optional[LicenseTerms]:
        """Check for Cloudflare licensing"""
        try:
            # Check for Cloudflare-specific headers
            response = requests.head(url, timeout=5)
            
            if 'cf-license-available' in response.headers or 'cloudflare-licensing' in response.headers:
                return LicenseTerms(
                    protocol="cloudflare",
                    ai_include_price=0.07,  # Mock pricing for MVP
                    purchase_price=0.25,
                    currency="USD",
                    publisher="Cloudflare Publisher",
                    permits_ai_include=True,
                    permits_ai_training=False,  # More restrictive
                    permits_search=True
                )
            return None
        except requests.RequestException:
            return None
    
    def request_license(self, url: str, license_type: str = "ai-include") -> LicenseToken:
        """Request Cloudflare license"""
        # Mock implementation for MVP  
        return LicenseToken(
            token=f"cf_token_{uuid.uuid4().hex[:16]}",
            protocol="cloudflare",
            cost=0.07,
            currency="USD",
            expires_at=datetime.now() + timedelta(hours=6),
            content_url=url,
            license_type=license_type
        )

class ContentLicenseService:
    """Unified service for multi-protocol content licensing"""
    
    def __init__(self):
        self.protocols = {
            'rsl': RSLProtocolHandler(),
            'tollbit': TollbitProtocolHandler(),
            'cloudflare': CloudflareProtocolHandler()
        }
        self._cache = {}  # Simple in-memory cache for license terms
    
    def discover_licensing(self, source_url: str) -> Optional[Dict[str, Any]]:
        """Check all supported protocols for licensing information"""
        cache_key = urlparse(source_url).netloc
        
        # Check cache first
        if cache_key in self._cache:
            return self._cache[cache_key]
        
        # Try each protocol in order of preference
        for protocol_name, handler in self.protocols.items():
            try:
                license_terms = handler.check_source(source_url)
                if license_terms:
                    result = {
                        'protocol': protocol_name,
                        'handler': handler,
                        'terms': license_terms
                    }
                    # Cache successful discovery
                    self._cache[cache_key] = result
                    return result
            except Exception as e:
                print(f"Protocol {protocol_name} check failed for {source_url}: {e}")
                continue
        
        # Cache negative result to avoid repeated lookups
        self._cache[cache_key] = None
        return None
    
    def request_license(self, source_info: Dict[str, Any], license_type: str = "ai-include") -> Optional[LicenseToken]:
        """Request license through the appropriate protocol"""
        try:
            handler = source_info['handler']
            terms = source_info['terms']
            
            # Check if the requested license type is permitted
            if license_type == "ai-include" and not terms.permits_ai_include:
                return None
            if license_type == "ai-train" and not terms.permits_ai_training:
                return None
            if license_type == "search" and not terms.permits_search:
                return None
            
            return handler.request_license(terms.content_url or "", license_type)
        except Exception as e:
            print(f"License request failed: {e}")
            return None
    
    def get_license_summary(self, sources: List[Dict]) -> Dict[str, Any]:
        """Get summary of licensing costs and protocols for sources"""
        summary = {
            'total_cost': 0.0,
            'currency': 'USD',
            'protocol_breakdown': {},
            'licensed_count': 0,
            'unlicensed_count': 0
        }
        
        for source in sources:
            if source.get('license_info'):
                terms = source['license_info']['terms']
                protocol = terms.protocol
                cost = terms.ai_include_price or 0.0
                
                summary['total_cost'] += cost
                summary['licensed_count'] += 1
                
                if protocol not in summary['protocol_breakdown']:
                    summary['protocol_breakdown'][protocol] = {
                        'count': 0,
                        'cost': 0.0
                    }
                
                summary['protocol_breakdown'][protocol]['count'] += 1
                summary['protocol_breakdown'][protocol]['cost'] += cost
            else:
                summary['unlicensed_count'] += 1
        
        return summary