"""AI-powered outline suggestion service"""

import os
import logging
from typing import List, Dict, Any, Optional
from anthropic import Anthropic
import json

logger = logging.getLogger(__name__)

# Use Haiku for cost-efficient outline suggestions
OUTLINE_MODEL = "claude-3-haiku-20240307"


class OutlineSuggestion:
    """A suggested outline section with AI rationale"""
    def __init__(self, title: str, rationale: str, order_index: int):
        self.title = title
        self.rationale = rationale
        self.order_index = order_index
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "rationale": self.rationale,
            "order_index": self.order_index
        }


class SourceCategorization:
    """Result of source categorization showing which sections are relevant"""
    def __init__(self, relevant_section_indices: List[int], confidence: str = "medium"):
        self.relevant_section_indices = relevant_section_indices
        self.confidence = confidence
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "relevant_section_indices": self.relevant_section_indices,
            "confidence": self.confidence
        }


class OutlineSuggester:
    """Service for generating AI-powered outline suggestions and source categorization"""
    
    def __init__(self):
        anthropic_key: str = os.environ.get('ANTHROPIC_API_KEY', '')
        if not anthropic_key:
            self.client = None
            self.enabled = False
            logger.warning("ANTHROPIC_API_KEY not found, outline suggestions disabled")
        else:
            try:
                self.client = Anthropic(api_key=anthropic_key)
                self.enabled = True
                logger.info(f"Outline Suggester initialized with model: {OUTLINE_MODEL}")
            except Exception as e:
                logger.error(f"Failed to initialize Anthropic client: {e}")
                self.client = None
                self.enabled = False
    
    def suggest_outline(
        self,
        research_topic: str,
        conversation_context: Optional[List[Dict[str, str]]] = None
    ) -> List[OutlineSuggestion]:
        """
        Generate AI-powered outline section suggestions for a research topic.
        
        Args:
            research_topic: The main research topic or query
            conversation_context: Optional conversation history for context
            
        Returns:
            List of OutlineSuggestion objects with titles and rationales
        """
        if not self.enabled or not self.client:
            return self._fallback_outline(research_topic)
        
        try:
            prompt = self._build_prompt(research_topic, conversation_context)
            
            response = self.client.messages.create(
                model=OUTLINE_MODEL,
                max_tokens=1500,
                temperature=0.7,
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            
            # Parse AI response
            content_block = response.content[0]
            if hasattr(content_block, 'text') and content_block.text:
                response_text = content_block.text
            else:
                logger.error("No text content in AI response")
                return self._fallback_outline(research_topic)
            
            suggestions = self._parse_response(response_text)
            logger.info(f"Generated {len(suggestions)} outline suggestions for topic: {research_topic[:50]}...")
            
            return suggestions
            
        except Exception as e:
            logger.error(f"Error generating outline suggestions: {e}")
            return self._fallback_outline(research_topic)
    
    def _build_prompt(
        self,
        research_topic: str,
        conversation_context: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Build the prompt for outline generation"""
        
        context_section = ""
        if conversation_context and len(conversation_context) > 0:
            # Include recent conversation for context
            recent_messages = conversation_context[-4:]  # Last 4 messages
            context_lines = []
            for msg in recent_messages:
                role = msg.get('sender', 'user')
                content = msg.get('content', '')[:200]  # Limit length
                context_lines.append(f"{role}: {content}")
            context_section = f"\n\nRecent conversation context:\n{chr(10).join(context_lines)}\n"
        
        prompt = f"""You are an expert research assistant helping organize academic and professional research. 

The user is researching: "{research_topic}"{context_section}

Generate 3-5 smart outline sections that would help organize sources and information for this research topic. Each section should:
- Have a clear, descriptive title (4-8 words max)
- Serve a distinct purpose in the research narrative
- Be appropriate for academic or professional research
- Help the user organize sources logically

Return your response as a JSON array of objects, where each object has:
- "title": The section title
- "rationale": A brief 1-sentence explanation of why this section is important (for display to user)

Example format:
[
  {{"title": "Background & Historical Context", "rationale": "Establish foundational understanding of the topic's evolution"}},
  {{"title": "Current Developments", "rationale": "Track recent news, trends, and emerging developments"}},
  ...
]

Provide 3-5 sections that create a logical research narrative. Return ONLY the JSON array, no additional text."""

        return prompt
    
    def _parse_response(self, response_text: str) -> List[OutlineSuggestion]:
        """Parse Claude's JSON response into OutlineSuggestion objects"""
        try:
            # Clean up response - sometimes Claude adds markdown code blocks
            cleaned = response_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            
            # Parse JSON
            sections = json.loads(cleaned)
            
            # Validate and convert to OutlineSuggestion objects
            suggestions = []
            for idx, section in enumerate(sections):
                if isinstance(section, dict) and 'title' in section and 'rationale' in section:
                    suggestions.append(OutlineSuggestion(
                        title=section['title'][:200],  # Limit length
                        rationale=section['rationale'][:300],  # Limit length
                        order_index=idx
                    ))
            
            # Ensure we have at least 3 sections
            if len(suggestions) < 3:
                logger.warning("AI returned fewer than 3 sections, using fallback")
                return self._fallback_outline("")
            
            return suggestions
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {e}")
            logger.debug(f"Response was: {response_text[:200]}")
            return self._fallback_outline("")
        except Exception as e:
            logger.error(f"Error parsing outline suggestions: {e}")
            return self._fallback_outline("")
    
    def categorize_source(
        self,
        source_title: str,
        source_description: str,
        section_titles: List[str]
    ) -> SourceCategorization:
        """
        Determine which outline sections a source is relevant to.
        
        Args:
            source_title: Title of the source article
            source_description: Description or excerpt from the source
            section_titles: List of section titles to categorize against
            
        Returns:
            SourceCategorization with list of relevant section indices
        """
        if not self.enabled or not self.client or len(section_titles) == 0:
            # Fallback: add to first section only
            return SourceCategorization(relevant_section_indices=[0] if len(section_titles) > 0 else [])
        
        try:
            prompt = self._build_categorization_prompt(
                source_title,
                source_description,
                section_titles
            )
            
            response = self.client.messages.create(
                model=OUTLINE_MODEL,
                max_tokens=300,  # Short response needed
                temperature=0.3,  # Lower temp for more consistent categorization
                messages=[{
                    "role": "user",
                    "content": prompt
                }]
            )
            
            # Parse AI response
            content_block = response.content[0]
            if hasattr(content_block, 'text') and content_block.text:
                response_text = content_block.text
            else:
                logger.error("No text content in categorization response")
                return SourceCategorization(relevant_section_indices=[0] if len(section_titles) > 0 else [])
            
            categorization = self._parse_categorization(response_text, len(section_titles))
            logger.info(f"Categorized source '{source_title[:50]}' to {len(categorization.relevant_section_indices)} sections")
            
            return categorization
            
        except Exception as e:
            logger.error(f"Error categorizing source: {e}")
            # Fallback: add to first section
            return SourceCategorization(relevant_section_indices=[0] if len(section_titles) > 0 else [])
    
    def _build_categorization_prompt(
        self,
        source_title: str,
        source_description: str,
        section_titles: List[str]
    ) -> str:
        """Build prompt for source categorization"""
        
        sections_list = "\n".join([f"{idx}. {title}" for idx, title in enumerate(section_titles)])
        
        prompt = f"""You are organizing research sources into outline sections.

Source to categorize:
Title: "{source_title}"
Description: "{source_description[:400]}"

Available outline sections:
{sections_list}

Determine which section(s) this source is relevant to. A source can be relevant to multiple sections if it contains information applicable to different parts of the research.

Return ONLY a JSON object with this format:
{{
  "relevant_indices": [0, 1, 2],
  "confidence": "high"
}}

Where:
- "relevant_indices" is an array of section numbers (0-indexed) where this source should be added
- "confidence" is "high", "medium", or "low" based on how well the source fits

Return ONLY the JSON object, no additional text."""

        return prompt
    
    def _parse_categorization(self, response_text: str, num_sections: int) -> SourceCategorization:
        """Parse Claude's categorization response"""
        try:
            # Clean up response
            cleaned = response_text.strip()
            if cleaned.startswith("```json"):
                cleaned = cleaned[7:]
            if cleaned.startswith("```"):
                cleaned = cleaned[3:]
            if cleaned.endswith("```"):
                cleaned = cleaned[:-3]
            cleaned = cleaned.strip()
            
            # Parse JSON
            result = json.loads(cleaned)
            
            # Extract and validate indices
            indices = result.get("relevant_indices", [])
            confidence = result.get("confidence", "medium")
            
            # Validate indices are within range
            valid_indices = [idx for idx in indices if isinstance(idx, int) and 0 <= idx < num_sections]
            
            # If no valid indices, default to first section
            if len(valid_indices) == 0:
                valid_indices = [0] if num_sections > 0 else []
            
            return SourceCategorization(
                relevant_section_indices=valid_indices,
                confidence=confidence
            )
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse categorization response as JSON: {e}")
            logger.debug(f"Response was: {response_text[:200]}")
            return SourceCategorization(relevant_section_indices=[0] if num_sections > 0 else [])
        except Exception as e:
            logger.error(f"Error parsing categorization: {e}")
            return SourceCategorization(relevant_section_indices=[0] if num_sections > 0 else [])
    
    def _fallback_outline(self, topic: str = "") -> List[OutlineSuggestion]:
        """Return generic fallback outline sections"""
        return [
            OutlineSuggestion(
                title="Background & Context",
                rationale="Establish foundational understanding and historical context",
                order_index=0
            ),
            OutlineSuggestion(
                title="Key Findings & Evidence",
                rationale="Organize primary sources and data",
                order_index=1
            ),
            OutlineSuggestion(
                title="Analysis & Perspectives",
                rationale="Collect expert analysis and different viewpoints",
                order_index=2
            ),
            OutlineSuggestion(
                title="Implications & Future Outlook",
                rationale="Synthesize insights and explore future directions",
                order_index=3
            )
        ]


# Global singleton instance
_outline_suggester = None

def get_outline_suggester() -> OutlineSuggester:
    """Get or create the global OutlineSuggester instance"""
    global _outline_suggester
    if _outline_suggester is None:
        _outline_suggester = OutlineSuggester()
    return _outline_suggester
