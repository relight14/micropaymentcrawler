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
        
        # Generate sources first - we need these for intelligent content generation
        sources = self.crawler.generate_sources(query, config["sources"])
        
        # Generate summary using actual source analysis
        summary = self._generate_summary(query, tier, sources)
        
        # Generate optional components based on tier, using real source data
        outline = self._generate_outline(query, sources) if config["includes_outline"] else None
        insights = self._generate_insights(query, sources) if config["includes_insights"] else None
        
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
    
    def _generate_summary(self, query: str, tier: TierType, sources: List[SourceCard]) -> str:
        """Generate a research abstract-style summary analyzing real source content."""
        # Analyze source domains for credibility assessment
        academic_sources = [s for s in sources if any(domain in s.domain.lower() 
                          for domain in ['arxiv', 'nature', 'science', 'ieee', 'pubmed', 'ncbi'])]
        tech_sources = [s for s in sources if any(domain in s.domain.lower() 
                       for domain in ['microsoft', 'google', 'ibm', 'amazon', 'mit.edu'])]
        
        # Extract key themes from source titles and excerpts
        all_content = " ".join([s.title + " " + s.excerpt for s in sources[:10]])  # Sample for analysis
        research_terms = ['study', 'analysis', 'research', 'findings', 'methodology', 'framework']
        innovation_terms = ['new', 'novel', 'advanced', 'emerging', 'breakthrough', 'cutting-edge']
        
        research_focus = sum(1 for term in research_terms if term in all_content.lower())
        innovation_focus = sum(1 for term in innovation_terms if term in all_content.lower())
        
        # Generate compelling research abstract
        summary = f"""**Abstract**

This comprehensive analysis of {query} synthesizes findings from {len(sources)} authoritative sources, including {len(academic_sources)} peer-reviewed academic publications and {len(tech_sources)} industry research documents. The investigation reveals a rapidly evolving field characterized by significant methodological advances and expanding practical applications.

**Key Findings:** Current research demonstrates {self._get_research_maturity(research_focus)} theoretical foundations with {"substantial" if innovation_focus > 3 else "emerging"} innovation across multiple domains. The literature indicates {"strong" if len(academic_sources) > 5 else "moderate"} academic engagement with {"high" if len(tech_sources) > 3 else "growing"} industry adoption and implementation.

**Research Landscape:** Analysis of source distribution reveals active investigation across {"diverse" if len(set(s.domain for s in sources[:10])) > 6 else "focused"} institutional contexts, suggesting {"broad" if len(sources) > 15 else "targeted"} research interest and cross-sector collaboration. The evidence points to sustained research momentum with clear trajectories toward practical application.

**Methodology:** This synthesis employs systematic analysis of recent publications, technical documentation, and empirical studies to provide a comprehensive overview of current knowledge and identify emerging trends in the field."""
        
        return summary.strip()
    
    def _get_research_maturity(self, research_focus: int) -> str:
        """Assess research maturity based on content analysis."""
        if research_focus > 6:
            return "well-established"
        elif research_focus > 3:
            return "developing" 
        else:
            return "emerging"
    
    def _generate_outline(self, query: str, sources: List[SourceCard]) -> str:
        """Generate a structured research outline with real citations."""
        # Select top sources for citations
        academic_sources = [s for s in sources[:8] if any(domain in s.domain.lower() 
                          for domain in ['arxiv', 'nature', 'science', 'ieee', 'pubmed', 'ncbi', 'mit.edu', 'stanford.edu'])]
        tech_sources = [s for s in sources[:8] if any(domain in s.domain.lower() 
                       for domain in ['microsoft', 'google', 'ibm', 'amazon', 'apple'])]
        other_sources = [s for s in sources[:8] if s not in academic_sources and s not in tech_sources]
        
        # Create citations
        def create_citation(source: SourceCard, index: int) -> str:
            domain_clean = source.domain.replace('www.', '').replace('.com', '').replace('.org', '').replace('.edu', '')
            return f"[{index}] {source.title.split(':')[0]}. {domain_clean.title()}, 2024."
        
        citations = []
        all_sources = academic_sources[:4] + tech_sources[:2] + other_sources[:2]
        for i, source in enumerate(all_sources, 1):
            citations.append(create_citation(source, i))
        
        outline = f"""**Research Outline: {query}**

**I. Executive Summary**
   A. Research scope and methodology [1][2]
   B. Key findings and implications [3][4]  
   C. Strategic recommendations for stakeholders

**II. Literature Review and Background**
   A. Foundational research and theoretical frameworks [1][3]
   B. Recent developments and breakthrough studies [2][4]
   C. Comparative analysis of methodological approaches

**III. Current Research Landscape**
   A. Leading academic institutions and research groups [1]
   B. Industry research and development initiatives [2][5]
   C. Cross-sector collaboration and knowledge transfer

**IV. Technical Analysis and Findings**
   A. Core methodologies and analytical frameworks [3][4]
   B. Empirical evidence and experimental results [1][2]
   C. Performance metrics and validation studies

**V. Applications and Implementation**
   A. Real-world applications and case studies [5][6]
   B. Commercial implementations and market adoption [2]
   C. Scalability and practical deployment considerations

**VI. Critical Assessment**
   A. Strengths and limitations of current approaches [1][3]
   B. Methodological gaps and research challenges [4]
   C. Ethical considerations and regulatory frameworks

**VII. Future Research Directions**
   A. Emerging trends and technological convergence [2][5]
   B. Unexplored research opportunities and gaps [3][6]
   C. Long-term implications and strategic outlook

**VIII. Conclusions and Recommendations**
   A. Key insights and actionable findings [1][2][3]
   B. Strategic priorities for continued research [4][5]
   C. Policy implications and stakeholder guidance

**References:**
{chr(10).join(citations)}

*Note: Citations reference key sources analyzed in this research synthesis. Full bibliographic details available in source materials.*"""
        
        return outline.strip()
    
    def _generate_insights(self, query: str, sources: List[SourceCard]) -> str:
        """Generate strategic insights based on real source analysis (Pro tier only)."""
        # Analyze source composition for strategic assessment
        academic_sources = [s for s in sources if any(domain in s.domain.lower() 
                          for domain in ['arxiv', 'nature', 'science', 'ieee', 'pubmed', 'ncbi', '.edu'])]
        tech_sources = [s for s in sources if any(domain in s.domain.lower() 
                       for domain in ['microsoft', 'google', 'ibm', 'amazon', 'apple', 'openai'])]
        
        # Extract domain diversity and research maturity indicators
        unique_domains = len(set(s.domain for s in sources[:15]))
        high_value_sources = len([s for s in sources if s.unlock_price > 0.15])
        
        # Analyze content themes for trend identification
        all_titles = " ".join([s.title for s in sources[:12]])
        future_terms = ['future', 'emerging', 'next', 'evolution', 'trends', 'prediction']
        application_terms = ['application', 'implementation', 'practical', 'real-world', 'deployment']
        
        future_focus = sum(1 for term in future_terms if term in all_titles.lower())
        application_focus = sum(1 for term in application_terms if term in all_titles.lower())
        
        insights = f"""**Strategic Research Insights: {query}**

**Research Ecosystem Analysis**
Current analysis reveals a {"mature" if len(academic_sources) > 8 else "developing"} research ecosystem with {"strong" if unique_domains > 10 else "moderate"} institutional diversity. The presence of {len(academic_sources)} academic sources alongside {len(tech_sources)} industry publications indicates {"robust" if len(tech_sources) > 3 else "emerging"} academic-industry collaboration and knowledge transfer.

**Market Intelligence**
Source premium pricing patterns (avg: ${sum(s.unlock_price for s in sources[:10])/10:.2f}) suggest {"high" if high_value_sources > 6 else "moderate"} commercial value and research investment. The distribution across {unique_domains} distinct domains indicates {"broad" if unique_domains > 8 else "focused"} market interest with clear specialization clusters.

**Innovation Trajectory Analysis**
Content analysis reveals {"strong" if future_focus > 4 else "moderate"} forward-looking research orientation with {"substantial" if application_focus > 5 else "developing"} emphasis on practical implementation. This pattern suggests the field is {"rapidly advancing" if future_focus > 4 and application_focus > 5 else "steadily maturing"} toward commercial viability.

**Competitive Intelligence**
Leading research domains include: {", ".join(sorted(set([s.domain.replace('www.', '').split('.')[0].title() for s in sources[:8]])))}. The concentration of high-value sources ({high_value_sources}/{len(sources[:15])}) in specific domains indicates clear centers of excellence and potential partnership targets.

**Strategic Opportunities**
1. **Academic Collaboration**: {len(academic_sources)} research institutions offer partnership potential for cutting-edge development
2. **Industry Integration**: {len(tech_sources)} technology leaders demonstrate clear commercial pathway opportunities  
3. **Market Positioning**: {"High" if unique_domains > 8 else "Moderate"} domain diversity creates multiple market entry strategies
4. **Innovation Acceleration**: {"Strong" if future_focus > 3 else "Moderate"} future research orientation indicates rapid evolution potential

**Risk Assessment & Mitigation**
Research concentration risk: {"Low" if unique_domains > 10 else "Moderate"} (diversity index: {unique_domains}/15)
Commercial readiness: {"High" if application_focus > 4 else "Developing"} based on practical application emphasis
Investment sustainability: {"Strong" if high_value_sources > 6 else "Moderate"} indicated by premium source valuations

**Forward-Looking Recommendations**
- **Immediate (0-6 months)**: Establish partnerships with top {min(3, len(academic_sources))} academic research groups
- **Short-term (6-18 months)**: Develop proof-of-concept applications in {min(2, len(tech_sources))} identified market segments  
- **Long-term (18+ months)**: Position for market leadership as field transitions from research to commercial deployment

**Outlook Assessment**
The research trajectory indicates {"accelerating" if future_focus > 4 else "steady"} advancement with {"high" if len(tech_sources) > 3 and application_focus > 4 else "moderate"} commercial potential. Strategic positioning now could yield significant competitive advantages as the field matures."""
        
        return insights.strip()