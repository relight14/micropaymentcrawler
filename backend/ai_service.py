"""
AI Service for Conversational Research Experience
Integrates Anthropic Claude for both conversational and deep research modes.
"""
import os
import json
from typing import List, Dict, Any, Optional
from datetime import datetime
import anthropic
from content_licensing import ContentLicenseService
from crawler_stub import ContentCrawlerStub
from models import TierType

class AIResearchService:
    """Unified AI service for conversational and deep research modes"""
    
    def __init__(self):
        self.client = anthropic.Anthropic(
            api_key=os.environ.get('ANTHROPIC_API_KEY')
        )
        self.license_service = ContentLicenseService()
        self.crawler = ContentCrawlerStub()
        self.conversation_history = []
        
    def chat(self, user_message: str, mode: str = "conversational") -> Dict[str, Any]:
        """
        Main chat interface supporting both conversational and deep research modes
        """
        # Add user message to conversation history
        self.conversation_history.append({
            "role": "user", 
            "content": user_message,
            "timestamp": datetime.now().isoformat(),
            "mode": mode
        })
        
        if mode == "conversational":
            return self._conversational_response(user_message)
        else:  # deep_research
            return self._deep_research_response(user_message)
    
    def _conversational_response(self, user_message: str) -> Dict[str, Any]:
        """Generate conversational response to help explore research interests"""
        
        system_prompt = """You are an expert research assistant helping users explore and refine their research interests. Your role is to:

1. Ask thoughtful follow-up questions to understand their research needs
2. Suggest related areas of investigation they might not have considered
3. Help them narrow down broad topics into specific, researchable questions
4. Provide context about why certain research directions might be valuable
5. Prepare them for productive deep research by understanding their goals

Be curious, engaging, and intellectually stimulating. Help them think deeper about their topic.
When they seem ready for deep research, you can suggest they switch to "Deep Research" mode to find specific sources and data."""
        
        # Create conversation context for Claude
        messages = [
            {"role": msg["role"], "content": msg["content"]} 
            for msg in self.conversation_history[-10:]  # Last 10 messages for context
        ]
        
        try:
            response = self.client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=1000,
                temperature=0.7,
                system=system_prompt,
                messages=messages
            )
            
            ai_response = response.content[0].text
            
            # Add AI response to conversation history
            self.conversation_history.append({
                "role": "assistant",
                "content": ai_response,
                "timestamp": datetime.now().isoformat(),
                "mode": "conversational"
            })
            
            return {
                "response": ai_response,
                "mode": "conversational",
                "conversation_length": len(self.conversation_history)
            }
            
        except Exception as e:
            return {
                "response": f"I'm having trouble connecting right now. Let me help you explore your research interests anyway - what specific aspect of your topic are you most curious about?",
                "mode": "conversational", 
                "error": str(e)
            }
    
    def _deep_research_response(self, user_message: str) -> Dict[str, Any]:
        """Generate deep research with context-aware source selection"""
        
        # Analyze conversation history to understand research focus
        conversation_context = self._extract_research_context()
        
        system_prompt = f"""You are an expert research analyst. Based on this conversation history about the user's research interests:

{conversation_context}

The user is now requesting deep research. Your task is to:
1. Generate a comprehensive research query that captures their specific interests from our conversation
2. Create relevant search terms that will find the most valuable sources
3. Focus on finding both free and premium licensed sources that directly address their research goals

Be specific and targeted based on our conversation. Don't be generic."""

        try:
            # Get research strategy from Claude
            response = self.client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=500,
                temperature=0.3,
                system=system_prompt,
                messages=[{"role": "user", "content": f"Generate a targeted research query for: {user_message}"}]
            )
            
            research_query = response.content[0].text.strip()
            
            # Execute deep research with the refined query
            return self._execute_deep_research(research_query, user_message)
            
        except Exception as e:
            # Fallback: use original user message as query
            return self._execute_deep_research(user_message, user_message)
    
    def _extract_research_context(self) -> str:
        """Extract key research themes from conversation history"""
        recent_messages = [
            msg["content"] for msg in self.conversation_history[-8:] 
            if msg["role"] == "user"
        ]
        return "\n".join([f"- {msg}" for msg in recent_messages])
    
    def _execute_deep_research(self, refined_query: str, original_query: str) -> Dict[str, Any]:
        """Execute deep research with intelligent source selection"""
        
        try:
            # Generate sources using the refined query
            sources = self.crawler.generate_sources(refined_query, 15)  # Get more to select from
            
            # Convert to dicts and discover licensing
            sources_dicts = []
            for source in sources:
                source_dict = source.dict()
                
                # Check for licensing
                if source.licensing_protocol:
                    source_dict['license_info'] = {
                        'protocol': source.licensing_protocol,
                        'terms': {
                            'protocol': source.licensing_protocol,
                            'ai_include_price': source.license_cost,
                            'publisher': source.publisher_name
                        }
                    }
                
                sources_dicts.append(source_dict)
            
            # Intelligently select the 10 most relevant sources
            selected_sources = self._select_relevant_sources(sources_dicts, refined_query, 10)
            
            # Calculate dynamic pricing based on selected sources
            licensing_summary = self.license_service.get_license_summary(selected_sources)
            
            # Generate AI-powered research outline
            outline = self._generate_research_outline(selected_sources, refined_query)
            
            # Create the research response
            ai_response = f"Based on our conversation, I've found {len(selected_sources)} highly relevant sources for your research on this topic. Here's what I discovered:\n\n{outline}"
            
            # Add to conversation history
            self.conversation_history.append({
                "role": "assistant",
                "content": ai_response,
                "timestamp": datetime.now().isoformat(),
                "mode": "deep_research"
            })
            
            return {
                "response": ai_response,
                "mode": "deep_research",
                "sources": selected_sources,
                "licensing_summary": licensing_summary,
                "refined_query": refined_query,
                "total_cost": licensing_summary.get('total_cost', 0.0),
                "conversation_length": len(self.conversation_history)
            }
            
        except Exception as e:
            return {
                "response": f"I encountered an issue during deep research, but I can still help you explore this topic conversationally. What specific aspect would you like to discuss?",
                "mode": "deep_research",
                "error": str(e)
            }
    
    def _select_relevant_sources(self, all_sources: List[Dict], query: str, count: int) -> List[Dict]:
        """Use AI to select the most relevant sources based on conversation context"""
        
        try:
            # Create source summaries for Claude to evaluate
            source_summaries = []
            for i, source in enumerate(all_sources[:20]):  # Limit to first 20 for efficiency
                summary = f"{i}: {source['title']} - {source['excerpt'][:200]}..."
                if source.get('license_info'):
                    summary += f" [Licensed: {source['license_info']['terms']['protocol']}]"
                source_summaries.append(summary)
            
            prompt = f"""Based on this research query: "{query}"

And these available sources:
{chr(10).join(source_summaries)}

Select the {count} most relevant and valuable source numbers (0-{len(source_summaries)-1}). 
Prioritize sources that directly address the research question, come from authoritative publishers, and provide unique insights.
Include a mix of free and licensed sources when licensed sources offer significantly higher value.

Return only the numbers separated by commas, like: 0,3,7,12"""

            response = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=100,
                temperature=0.1,
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Parse selected indices
            selected_indices = [int(x.strip()) for x in response.content[0].text.strip().split(',') if x.strip().isdigit()]
            
            # Return selected sources
            return [all_sources[i] for i in selected_indices if i < len(all_sources)][:count]
            
        except Exception as e:
            # Fallback: return first N sources
            return all_sources[:count]
    
    def _generate_research_outline(self, sources: List[Dict], query: str) -> str:
        """Generate AI-powered research outline based on selected sources"""
        
        try:
            source_summaries = [
                f"• {source['title']} ({source['domain']})"
                for source in sources
            ]
            
            prompt = f"""Based on this research query: "{query}"

And these selected sources:
{chr(10).join(source_summaries)}

Create a compelling research outline that shows:
1. Key themes and insights you can explore
2. What unique perspectives these sources offer
3. How they connect to answer the research question
4. The most interesting findings or trends

Keep it concise but compelling - make the user excited about what they'll discover."""

            response = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=400,
                temperature=0.6,
                messages=[{"role": "user", "content": prompt}]
            )
            
            return response.content[0].text
            
        except Exception:
            return "Here are the most relevant sources I found for your research. Each offers unique insights that will help answer your questions."
    
    def get_conversation_history(self) -> List[Dict]:
        """Get the current conversation history"""
        return self.conversation_history
    
    def clear_conversation(self) -> None:
        """Clear conversation history for a fresh start"""
        self.conversation_history = []