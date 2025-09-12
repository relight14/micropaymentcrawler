from typing import List, Optional
from models import TierType, ResearchPacket, SourceCard
from crawler_stub import ContentCrawlerStub

class PacketBuilder:
    """
    Composes research packets with summaries, outlines, insights, and source cards.
    Simulates intelligent content organization for MVP.
    """
    
    def __init__(self):
        self.crawler = ContentCrawlerStub()
    
    def build_packet(self, query: str, tier: TierType) -> ResearchPacket:
        """Build a complete research packet based on the selected tier."""
        # Get tier configuration
        config = self._get_tier_config(tier)
        
        # Generate sources
        sources = self.crawler.generate_sources(query, config["sources"])
        
        # Generate summary
        summary = self._generate_summary(query, tier)
        
        # Generate optional components based on tier
        outline = self._generate_outline(query) if config["includes_outline"] else None
        insights = self._generate_insights(query) if config["includes_insights"] else None
        
        return ResearchPacket(
            query=query,
            tier=tier,
            summary=summary,
            outline=outline,
            insights=insights,
            sources=sources,
            total_sources=len(sources)
        )
    
    def _get_tier_config(self, tier: TierType) -> dict:
        """Get configuration for each tier."""
        configs = {
            TierType.BASIC: {
                "sources": 10,
                "includes_outline": False,
                "includes_insights": False
            },
            TierType.RESEARCH: {
                "sources": 20,
                "includes_outline": True,
                "includes_insights": False
            },
            TierType.PRO: {
                "sources": 40,
                "includes_outline": True,
                "includes_insights": True
            }
        }
        return configs[tier]
    
    def _generate_summary(self, query: str, tier: TierType) -> str:
        """Generate a comprehensive summary based on the query and tier."""
        base_summary = f"""
Research Summary: {query}

This comprehensive analysis examines the current state of research on "{query}" through systematic review of academic literature and authoritative sources. The investigation reveals several key areas of development and ongoing research initiatives.

Key findings indicate that this field has experienced significant advancement in recent years, with multiple research groups contributing novel methodologies and theoretical frameworks. The literature demonstrates both established principles and emerging paradigms that continue to shape our understanding.

Current research directions focus on addressing fundamental questions while exploring practical applications. The evidence suggests continued growth in research activity, with increasing interdisciplinary collaboration and technological integration.
        """.strip()
        
        if tier == TierType.PRO:
            base_summary += """

Advanced Analysis:
The research landscape shows clear patterns of evolution, with early foundational work establishing core principles that current investigations build upon. Recent developments have introduced sophisticated methodological approaches that enhance both theoretical understanding and practical implementation.

Cross-disciplinary perspectives have enriched the field significantly, bringing insights from related domains that inform new research directions. The integration of modern analytical tools and computational methods has expanded the scope of possible investigations.

Future research trajectories appear promising, with identified gaps in current knowledge providing clear opportunities for advancement. The field demonstrates strong potential for continued growth and practical application.
            """.strip()
        
        return base_summary
    
    def _generate_outline(self, query: str) -> str:
        """Generate a structured research outline."""
        return f"""
Research Outline: {query}

I. Introduction and Background
   A. Historical context and development
   B. Key definitions and terminology
   C. Scope and significance of current research

II. Methodology and Approach
   A. Research design and framework
   B. Data collection and analysis methods
   C. Quality assurance and validation

III. Current State of Research
   A. Established findings and consensus areas
   B. Active research initiatives
   C. Leading institutions and researchers

IV. Key Findings and Developments
   A. Major breakthroughs and innovations
   B. Emerging trends and patterns
   C. Technological advances and applications

V. Critical Analysis
   A. Strengths and limitations of current approaches
   B. Methodological considerations
   C. Areas of debate and controversy

VI. Future Directions
   A. Identified research gaps
   B. Promising avenues for investigation
   C. Potential applications and implications

VII. Conclusion
   A. Summary of key insights
   B. Recommendations for further research
   C. Broader significance and impact
        """.strip()
    
    def _generate_insights(self, query: str) -> str:
        """Generate deep insights and analysis (Pro tier only)."""
        return f"""
Strategic Insights: {query}

Market and Research Dynamics:
The research ecosystem surrounding "{query}" demonstrates several strategic patterns that inform both academic and commercial development. Current funding trends indicate sustained interest from both government agencies and private sector organizations, suggesting long-term viability and practical relevance.

Competitive Landscape:
Analysis of research output reveals distinct clusters of activity, with certain institutions and research groups establishing leadership positions through consistent high-quality contributions. The presence of international collaboration networks indicates global recognition and cross-border knowledge transfer.

Innovation Opportunities:
Several under-explored areas present significant opportunities for breakthrough research. The convergence of this field with emerging technologies creates potential for novel applications and methodological innovations. Early indicators suggest that researchers who position themselves at these intersections may achieve disproportionate impact.

Risk Assessment:
Current research faces several challenges including methodological limitations, resource constraints, and regulatory considerations. However, the fundamental robustness of core principles provides confidence in continued progress despite these obstacles.

Strategic Recommendations:
1. Focus on interdisciplinary collaboration to accelerate innovation
2. Invest in methodological improvements to enhance research quality
3. Develop practical applications to demonstrate real-world value
4. Build strategic partnerships with leading institutions
5. Monitor emerging technologies for integration opportunities

Long-term Outlook:
The field shows strong indicators for sustained growth and increasing practical relevance. The combination of solid theoretical foundations and expanding application domains positions this research area for significant future impact.
        """.strip()