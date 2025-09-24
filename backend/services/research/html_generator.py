"""
HTML Research Packet Generator
Creates clean, academic-style HTML reports with LedeWire branding.
"""
from schemas.domain import ResearchPacket, SourceCard
from typing import List, Optional
import html

class HTMLPacketGenerator:
    """
    Generates clean, academic-style HTML research packets with LedeWire branding.
    """
    
    def __init__(self):
        pass
    
    def generate_html_packet(self, packet: ResearchPacket, selected_sources: Optional[List[SourceCard]] = None) -> str:
        """
        Generate complete HTML research packet with optional selectedSources for citations.
        If selected_sources is provided, uses those for inline citations and Sources Appendix.
        """
        # Use selected sources if provided, otherwise fall back to packet sources
        sources_to_use = selected_sources if selected_sources else packet.sources
        
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
    {self._get_summary_section(packet, sources_to_use)}
    {self._get_outline_section(packet, sources_to_use) if packet.outline else ''}
    {self._get_insights_section(packet, sources_to_use) if packet.insights else ''}
    {self._get_sources_appendix(sources_to_use)}
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
        
        .sources-appendix {
            margin-top: 25px;
        }
        
        .source-citation {
            display: flex;
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid #e0e0e0;
            border-radius: 6px;
            background: #f9f9f9;
        }
        
        .citation-number {
            font-weight: 600;
            color: #2c3e50;
            margin-right: 15px;
            font-size: 1.1em;
            min-width: 30px;
        }
        
        .citation-details {
            flex: 1;
        }
        
        .citation {
            color: #3498db;
            font-weight: 600;
            font-size: 0.9em;
            text-decoration: none;
        }
        
        .citation:hover {
            text-decoration: underline;
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
        <div class="tier-badge">{packet.tier.value if packet.tier else "Dynamic"} Research</div>
        {f'<div class="content-id">Content ID: {packet.content_id}</div>' if packet.content_id else ''}
    </div>"""
    
    def _get_summary_section(self, packet: ResearchPacket, sources: Optional[List[SourceCard]] = None) -> str:
        """Generate summary section with inline citations."""
        summary_with_citations = self._add_inline_citations(packet.summary, sources, 1) if sources else html.escape(packet.summary)
        
        return f"""<div class="content-section">
        <h2 class="section-title">Research Summary</h2>
        <div class="summary-text">{summary_with_citations}</div>
    </div>"""
    
    def _get_outline_section(self, packet: ResearchPacket, sources: Optional[List[SourceCard]] = None) -> str:
        """Generate outline section (Research and Pro tiers only) with inline citations."""
        if not packet.outline:
            return ""
        
        outline_with_citations = self._add_inline_citations(packet.outline, sources) if sources else html.escape(packet.outline)
        
        return f"""<div class="content-section">
        <h2 class="section-title">Research Outline</h2>
        <div class="outline-text">{outline_with_citations}</div>
    </div>"""
    
    def _get_insights_section(self, packet: ResearchPacket, sources: Optional[List[SourceCard]] = None) -> str:
        """Generate strategic insights section (Pro tier only) with inline citations."""
        if not packet.insights:
            return ""
        
        insights_with_citations = self._add_inline_citations(packet.insights, sources) if sources else html.escape(packet.insights)
        
        return f"""<div class="content-section">
        <h2 class="section-title">Strategic Insights</h2>
        <div class="insights-text">{insights_with_citations}</div>
    </div>"""
    
    def _get_sources_appendix(self, sources: Optional[List[SourceCard]]) -> str:
        """Generate Sources Appendix with numbered citations."""
        if not sources:
            return ""
            
        sources_html = ""
        
        for i, source in enumerate(sources, 1):
            sources_html += f"""<div class="source-citation">
            <div class="citation-number">[{i}]</div>
            <div class="citation-details">
                <div class="source-title">{html.escape(source.title)}</div>
                <div class="source-domain">{html.escape(source.domain)}</div>
                <div class="source-excerpt">{html.escape(source.excerpt)}</div>
                <div class="source-price">License: ${source.unlock_price:.2f}</div>
            </div>
        </div>"""
        
        return f"""<div class="content-section">
        <h2 class="section-title">Sources</h2>
        <p>The following {len(sources)} sources were used in this research report:</p>
        <div class="sources-appendix">
            {sources_html}
        </div>
    </div>"""

    def _add_inline_citations(self, text: str, sources: Optional[List[SourceCard]], start_citation: int = 1) -> str:
        """Add inline citations [1], [2], [3] to text systematically."""
        if not sources or not text:
            return html.escape(text)
        
        # Escape the text first
        escaped_text = html.escape(text)
        
        # Split into sentences for systematic citation placement
        sentences = [s.strip() for s in escaped_text.replace('. ', '.|').split('|') if s.strip()]
        
        if not sentences:
            return escaped_text
        
        # Add citations systematically - distribute evenly across sentences
        cited_sentences = []
        citations_to_add = min(len(sources), 3)  # Cap at 3 citations per section
        
        if len(sentences) >= citations_to_add:
            # Distribute citations evenly across sentences
            interval = len(sentences) // citations_to_add
            for i, sentence in enumerate(sentences):
                if i > 0 and i % interval == 0 and len([s for s in cited_sentences if '[' in s]) < citations_to_add:
                    citation_num = start_citation + len([s for s in cited_sentences if '[' in s])
                    sentence += f' <span class="citation">[{citation_num}]</span>'
                cited_sentences.append(sentence)
        else:
            # More citations than sentences - add multiple per sentence
            for i, sentence in enumerate(sentences):
                citation_num = start_citation + i
                if citation_num <= start_citation + len(sources) - 1:
                    sentence += f' <span class="citation">[{citation_num}]</span>'
                cited_sentences.append(sentence)
        
        return '. '.join(cited_sentences)
    
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