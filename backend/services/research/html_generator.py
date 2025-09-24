"""
HTML Research Packet Generator
Creates clean, academic-style HTML reports with LedeWire branding.
"""
from schemas.domain import ResearchPacket, SourceCard
from typing import List
import html

class HTMLPacketGenerator:
    """
    Generates clean, academic-style HTML research packets with LedeWire branding.
    """
    
    def __init__(self):
        pass
    
    def generate_html_packet(self, packet: ResearchPacket) -> str:
        """
        Generate complete HTML research packet.
        """
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Research Report: {html.escape(packet.query)}</title>
    {self._get_css_styles()}
</head>
<body>
    {self._get_header(packet)}
    {self._get_summary_section(packet)}
    {self._get_outline_section(packet) if packet.outline else ''}
    {self._get_insights_section(packet) if packet.insights else ''}
    {self._get_sources_section(packet)}
    {self._get_footer()}
</body>
</html>"""
    
    def _get_css_styles(self) -> str:
        """
        Clean, academic-style CSS with LedeWire branding.
        """
        return """<style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Georgia', 'Times New Roman', serif;
            line-height: 1.6;
            color: #333;
            max-width: 1000px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #fafafa;
        }
        
        .header {
            text-align: center;
            border-bottom: 2px solid #e0e0e0;
            padding-bottom: 30px;
            margin-bottom: 40px;
        }
        
        .logo {
            max-width: 200px;
            margin-bottom: 20px;
            opacity: 0.8;
        }
        
        .title {
            font-size: 2.2em;
            color: #2c3e50;
            margin-bottom: 10px;
            font-weight: 300;
        }
        
        .tier-badge {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 20px;
            border-radius: 25px;
            font-size: 0.9em;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 1px;
            display: inline-block;
        }
        
        .content-section {
            background: white;
            margin-bottom: 35px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            padding: 35px;
        }
        
        .section-title {
            font-size: 1.6em;
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
            margin-bottom: 25px;
            font-weight: 400;
        }
        
        .summary-text, .outline-text, .insights-text {
            font-size: 1.1em;
            text-align: justify;
            white-space: pre-line;
        }
        
        .source-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-top: 25px;
        }
        
        .source-card {
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            padding: 20px;
            background: #f9f9f9;
            transition: transform 0.2s ease;
        }
        
        .source-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        
        .source-title {
            font-size: 1.1em;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 8px;
        }
        
        .source-domain {
            color: #7f8c8d;
            font-size: 0.9em;
            margin-bottom: 10px;
        }
        
        .source-excerpt {
            font-size: 0.95em;
            color: #555;
            margin-bottom: 15px;
        }
        
        .source-price {
            background: #e8f5e8;
            color: #27ae60;
            padding: 5px 12px;
            border-radius: 15px;
            font-size: 0.85em;
            font-weight: 600;
            display: inline-block;
        }
        
        .footer {
            text-align: center;
            padding-top: 30px;
            border-top: 1px solid #e0e0e0;
            color: #7f8c8d;
            font-size: 0.9em;
        }
        
        .content-id {
            font-family: 'Courier New', monospace;
            background: #ecf0f1;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
        }
        
        @media (max-width: 768px) {
            body {
                padding: 20px 15px;
            }
            .title {
                font-size: 1.8em;
            }
            .content-section {
                padding: 25px;
            }
        }
        </style>"""
    
    def _get_header(self, packet: ResearchPacket) -> str:
        """Generate header with logo, title, and tier information."""
        return f"""<div class="header">
        <img src="/static/ledewire-logo.png" alt="LedeWire" class="logo">
        <h1 class="title">{html.escape(packet.query)}</h1>
        <div class="tier-badge">{packet.tier.value} Research</div>
        {f'<div class="content-id">Content ID: {packet.content_id}</div>' if packet.content_id else ''}
    </div>"""
    
    def _get_summary_section(self, packet: ResearchPacket) -> str:
        """Generate summary section."""
        return f"""<div class="content-section">
        <h2 class="section-title">Research Summary</h2>
        <div class="summary-text">{html.escape(packet.summary)}</div>
    </div>"""
    
    def _get_outline_section(self, packet: ResearchPacket) -> str:
        """Generate outline section (Research and Pro tiers only)."""
        if not packet.outline:
            return ""
        
        return f"""<div class="content-section">
        <h2 class="section-title">Research Outline</h2>
        <div class="outline-text">{html.escape(packet.outline)}</div>
    </div>"""
    
    def _get_insights_section(self, packet: ResearchPacket) -> str:
        """Generate strategic insights section (Pro tier only)."""
        if not packet.insights:
            return ""
        
        return f"""<div class="content-section">
        <h2 class="section-title">Strategic Insights</h2>
        <div class="insights-text">{html.escape(packet.insights)}</div>
    </div>"""
    
    def _get_sources_section(self, packet: ResearchPacket) -> str:
        """Generate sources section with individual source cards."""
        sources_html = ""
        
        for source in packet.sources[:12]:  # Show first 12 sources in HTML
            sources_html += f"""<div class="source-card">
            <div class="source-title">{html.escape(source.title)}</div>
            <div class="source-domain">{html.escape(source.domain)}</div>
            <div class="source-excerpt">{html.escape(source.excerpt)}</div>
            <div class="source-price">Unlock: ${source.unlock_price:.2f}</div>
        </div>"""
        
        return f"""<div class="content-section">
        <h2 class="section-title">Research Sources ({packet.total_sources} total)</h2>
        <p>Each source can be unlocked individually for detailed access via your LedeWire wallet.</p>
        <div class="source-grid">
            {sources_html}
        </div>
    </div>"""
    
    def _get_footer(self) -> str:
        """Generate footer with LedeWire attribution."""
        return f"""<div class="footer">
        <p>Research report generated by AI-powered search • Powered by LedeWire</p>
        <p>Individual sources require separate purchase for full access</p>
    </div>"""

# Convenience function
def generate_html_packet(packet: ResearchPacket) -> str:
    """
    Generate HTML research packet.
    """
    generator = HTMLPacketGenerator()
    return generator.generate_html_packet(packet)