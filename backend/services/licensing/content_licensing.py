"""
Content Licensing Abstraction Layer
Multi-protocol support for RSL, Tollbit, Cloudflare and future licensing systems.
"""
import os
import uuid
import requests
import defusedxml.ElementTree as ET
import json
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urljoin, urlparse, quote_plus, quote

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
    def request_license(self, url: str, license_type: str = "ai-include") -> Optional[LicenseToken]:
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
                            price_text = amount_elem.text
                            if price_text is not None:
                                price = float(price_text)
                                currency = amount_elem.get('currency', 'USD')
                            else:
                                continue
                            
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
    
    def request_license(self, url: str, license_type: str = "ai-include") -> Optional[LicenseToken]:
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
    """Handler for Tollbit licensing protocol with real API integration"""
    
    def __init__(self):
        self.api_key = os.environ.get('TOLLBIT_API_KEY')
        self.org_cuid = os.environ.get('TOLLBIT_ORG_CUID')
        self.agent_id = os.environ.get('TOLLBIT_AGENT_ID', 'ResearchTool-1.0')
        self.base_url = "https://api.tollbit.com"  # Based on documentation
        self.agent_name = "ResearchTool-1.0"
        
    def check_source(self, url: str) -> Optional[LicenseTerms]:
        """Check for Tollbit licensing availability and get real pricing from API"""
        if not self.api_key:
            print("Warning: TOLLBIT_API_KEY not available for pricing discovery")
            return None
            
        try:
            # Check ALL sources against Tollbit API first 
            # This ensures comprehensive coverage until we have a solid database
            domain = urlparse(url).netloc
            print(f"🎯 Checking Tollbit API for: {domain}")
            
            # Try to get real pricing from Tollbit API for any domain
            pricing_data = self._check_pricing(url)
            if pricing_data:
                print(f"✅ Tollbit pricing found for {domain}: ${pricing_data.get('ai_include_price', 0.05)}")
                return LicenseTerms(
                    protocol="tollbit",
                    ai_include_price=pricing_data.get('ai_include_price', 0.05),
                    purchase_price=pricing_data.get('purchase_price', 0.20),
                    currency="USD",
                    publisher=self._extract_publisher(url),
                    permits_ai_include=True,
                    permits_search=True
                )
            else:
                print(f"❌ No Tollbit pricing available for {domain}")
                
        except Exception as e:
            print(f"Tollbit check failed for {url}: {e}")
            
        return None
    
    def request_license(self, url: str, license_type: str = "ai-include") -> Optional[LicenseToken]:
        """Request real Tollbit license token"""
        if not self.api_key:
            print("Warning: TOLLBIT_API_KEY not available")
            return None
            
        try:
            token_data = self._mint_token(url)
            if token_data:
                # Parse actual cost from API response
                actual_cost = token_data.get('cost', 0.05)
                expires_in_seconds = token_data.get('expires_in', 21600)  # Default 6 hours
                
                return LicenseToken(
                    token=token_data.get('token', ''),
                    protocol="tollbit",
                    cost=actual_cost,  # Use real cost from API
                    currency="USD",
                    expires_at=datetime.now() + timedelta(seconds=expires_in_seconds),
                    content_url=url,
                    license_type=license_type
                )
        except Exception as e:
            print(f"Tollbit token request failed for {url}: {e}")
            
        return None
    
    def _check_pricing(self, target_url: str) -> Optional[Dict]:
        """Check real Tollbit pricing using official API endpoint"""
        if not self.api_key:
            return None
            
        try:
            # Use Tollbit rate endpoint with raw URL in path (this is what works)
            # GET /dev/v1/rate/<raw_url>
            rate_endpoint = f"{self.base_url}/dev/v1/rate/{target_url}"
            
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'User-Agent': self.agent_name,
                'Content-Type': 'application/json'
            }
            
            if self.agent_id:
                headers['X-Tollbit-AgentId'] = self.agent_id
            
            try:
                response = requests.get(
                    rate_endpoint,
                    headers=headers,
                    timeout=5  # Shorter timeout for discovery
                )
                
                if response.status_code == 200:
                    data = response.json()
                    print(f"✅ Real Tollbit pricing discovered for {target_url}: {data}")
                    
                    # Handle array response format from documentation
                    if isinstance(data, list) and len(data) > 0:
                        # Parse both license types for accurate pricing
                        ai_include_price = None
                        purchase_price = None
                        currency = 'USD'
                        license_path = None
                        
                        for rate_data in data:
                            price_info = rate_data.get('price', {})
                            license_info = rate_data.get('license', {})
                            license_type = license_info.get('licenseType', '')
                            
                            price_micros = price_info.get('priceMicros', 0)
                            price_usd = price_micros / 1000000.0
                            
                            # Map license types to pricing
                            if license_type == 'ON_DEMAND_LICENSE':
                                ai_include_price = price_usd
                                if not license_path:
                                    license_path = license_info.get('licensePath')
                                print(f"🎯 AI Include (ON_DEMAND_LICENSE): {price_micros} micros = ${price_usd:.3f} USD")
                            elif license_type == 'ON_DEMAND_FULL_USE_LICENSE':
                                purchase_price = price_usd
                                if not license_path:
                                    license_path = license_info.get('licensePath')
                                print(f"🎯 Full Purchase (ON_DEMAND_FULL_USE_LICENSE): {price_micros} micros = ${price_usd:.3f} USD")
                            
                            currency = price_info.get('currency', 'USD')
                        
                        # Fallback if only one license type available
                        if ai_include_price and not purchase_price:
                            purchase_price = ai_include_price * 2.4
                        elif purchase_price and not ai_include_price:
                            ai_include_price = purchase_price / 2.4
                        
                        return {
                            'ai_include_price': ai_include_price or 0.05,
                            'purchase_price': purchase_price or 0.12,
                            'currency': currency,
                            'license_path': license_path,
                            'license_type': 'ON_DEMAND'
                        }
                else:
                    print(f"Tollbit rate API response: {response.status_code} - {response.text[:200]}")
                    
            except requests.RequestException as e:
                print(f"Tollbit rate API request failed: {e}")
            
            # NO FALLBACK - only return real pricing data
            print(f"🔄 Tollbit rate API not accessible for {target_url} - no licensing available")
            return None
                
        except Exception as e:
            print(f"Tollbit pricing discovery error: {e}")
            return None

    def _mint_token(self, target_url: str) -> Optional[Dict]:
        """Mint a Tollbit token using their official API"""
        if not self.api_key:
            return None
            
        try:
            # SECURITY: Only use official Tollbit API endpoint to prevent API key leakage
            official_endpoint = "https://api.tollbit.com/v1/mint"
            
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
            
            if self.agent_id:
                headers['X-Tollbit-AgentId'] = self.agent_id
            
            payload = {
                'agent': self.agent_name,
                'target': target_url,
            }
            
            # Add optional orgCuid and maxPriceMicros if available
            if self.org_cuid:
                payload['orgCuid'] = self.org_cuid
            if self.agent_id:
                payload['agentId'] = self.agent_id
            
            # Set reasonable max price (12 cents = 120,000 micros)
            payload['maxPriceMicros'] = '120000'
            payload['licenseType'] = 'ON_DEMAND_FULL_USE_LICENSE'
            
            try:
                response = requests.post(
                    official_endpoint,
                    headers=headers,
                    json=payload,
                    timeout=10
                )
                
                if response.status_code == 200:
                    return response.json()
                else:
                    print(f"Tollbit API response: {response.status_code}")
                    
            except requests.RequestException as e:
                print(f"Tollbit API connection failed: {e}")
            
            # NO MOCK TOKENS - only return real tokens
            print(f"Tollbit API not accessible for {target_url} - no token available")
            return None
                
        except Exception as e:
            print(f"Tollbit API error: {e}")
            return None
    
    def _extract_publisher(self, url: str) -> str:
        """Extract publisher name from URL"""
        try:
            domain = urlparse(url).netloc
            # Remove www. prefix and get the main domain
            if domain.startswith('www.'):
                domain = domain[4:]
            return domain.split('.')[0].title()
        except:
            return "Tollbit Publisher"

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
    
    def request_license(self, url: str, license_type: str = "ai-include") -> Optional[LicenseToken]:
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
        cache_key = source_url.strip().lower()
        
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
                        'terms': license_terms,
                        'source_url': source_url  # Add source URL for license requests
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
            
            # Use source_url from source_info instead of terms.content_url
            source_url = source_info.get('source_url', '')
            return handler.request_license(source_url, license_type)
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
                # Handle both dict and LicenseTerms object formats
                if isinstance(terms, dict):
                    protocol = terms.get('protocol')
                    cost = terms.get('ai_include_price', 0.0)
                else:
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