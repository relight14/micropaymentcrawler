"""
Query Classification and Enhancement Service
Handles query analysis, context extraction, and query refinement for research
"""

import logging
import re
import os
from typing import List, Dict, Any, Optional
from anthropic import Anthropic
from schemas.domain import SourceCard

logger = logging.getLogger(__name__)


class QueryClassifierService:
    """Service for classifying and enhancing research queries"""
    
    def __init__(self):
        """Initialize the query classifier with Claude client"""
        self.claude_client = Anthropic(api_key=os.environ.get('ANTHROPIC_API_KEY'))
    
    def validate_query_input(self, query: str) -> str:
        """
        Validate query input with minimal sanitization for API use.
        
        Args:
            query: Raw query string from user
            
        Returns:
            Sanitized query string
            
        Raises:
            ValueError: If query is invalid
        """
        if not query or len(query.strip()) < 3:
            raise ValueError("Query must be at least 3 characters long")
        
        if len(query) > 500:
            raise ValueError("Query cannot exceed 500 characters")
        
        # Minimal validation: only remove control characters that could cause issues
        sanitized = query.strip()
        
        # Remove null bytes and control characters that could cause parsing/encoding issues
        sanitized = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', sanitized)
        
        # Collapse multiple spaces
        sanitized = re.sub(r'\s+', ' ', sanitized).strip()
        
        if not sanitized or len(sanitized) < 3:
            raise ValueError("Query became too short after validation")
        
        return sanitized
    
    def extract_topic_from_query(self, query: str, sources: List[SourceCard] = None) -> str:
        """
        Extract main research topic from the first query.
        Uses the query itself as the topic (cleaned up).
        
        Args:
            query: User's research query
            sources: Optional list of sources (not currently used)
            
        Returns:
            Cleaned topic string
        """
        # Clean up the query to get the core topic
        topic = query.strip().lower()
        
        # Remove common query prefixes
        prefixes_to_remove = [
            "i want to research",
            "i want to know about",
            "tell me about",
            "what is",
            "what are",
            "how does",
            "how do",
            "why does",
            "why do",
            "can you explain",
            "explain",
            "research",
        ]
        
        for prefix in prefixes_to_remove:
            if topic.startswith(prefix):
                topic = topic[len(prefix):].strip()
        
        # Remove trailing question marks and punctuation
        topic = topic.rstrip('?!.,;:')
        
        return topic.strip() or query
    
    def sanitize_context_text(self, context: str) -> str:
        """
        Sanitize context text to prevent prompt injection or malformed JSON.
        
        Args:
            context: Raw context text
            
        Returns:
            Sanitized context text
        """
        if not context:
            return ""
        
        # Remove control characters
        sanitized = re.sub(r'[\x00-\x1F\x7F]', '', context)
        
        # Collapse multiple spaces/newlines
        sanitized = re.sub(r'\s+', ' ', sanitized)
        
        # Truncate if too long (Claude context limit)
        max_length = 50000
        if len(sanitized) > max_length:
            sanitized = sanitized[:max_length] + "..."
        
        return sanitized.strip()
    
    def extract_timeframe(self, text: str, output_bias: str = 'general') -> str:
        """
        Extract temporal focus from query text.
        
        Args:
            text: Query text to analyze
            output_bias: Output bias hint ('news', 'historical', etc.)
            
        Returns:
            Timeframe string ('recent', 'historical', 'current', '')
        """
        text_lower = text.lower()
        
        # Recent/current indicators
        recent_patterns = [
            r'\b(recent|latest|current|today|now|this (week|month|year))\b',
            r'\b(breaking|new|updated)\b',
            r'\b2024\b|\b2023\b'  # Recent years
        ]
        
        # Historical indicators
        historical_patterns = [
            r'\b(historical|history|ancient|medieval|classical)\b',
            r'\b(originated|evolution|development over time)\b',
            r'\b\d{4}\b.*\b\d{4}\b',  # Year ranges
        ]
        
        # Check for recent/current
        for pattern in recent_patterns:
            if re.search(pattern, text_lower):
                return 'recent'
        
        # Check for historical
        for pattern in historical_patterns:
            if re.search(pattern, text_lower):
                return 'historical'
        
        # News bias implies recency
        if output_bias == 'news':
            return 'current'
        
        return ''
    
    def extract_entities(self, text: str) -> List[str]:
        """
        Extract named entities from text (simple implementation).
        
        Args:
            text: Text to extract entities from
            
        Returns:
            List of entity strings
        """
        # Simple capitalized word extraction
        words = text.split()
        entities = []
        
        for word in words:
            # Skip common words
            if word.lower() in ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at']:
                continue
            
            # Check if capitalized (potential entity)
            if word and word[0].isupper() and len(word) > 2:
                entities.append(word.strip('.,!?;:'))
        
        return list(set(entities))[:10]  # Return up to 10 unique entities
    
    def extract_topic(self, query: str, context: str) -> str:
        """
        Extract main topic from query and context.
        
        Args:
            query: User query
            context: Conversation context
            
        Returns:
            Topic string
        """
        # Use query as primary source
        topic = self.extract_topic_from_query(query)
        
        # If topic is very short, try to enhance with context
        if len(topic) < 10 and context:
            # Extract first substantial phrase from context
            context_words = context.split()[:20]
            context_topic = ' '.join(context_words)
            if len(context_topic) > len(topic):
                topic = context_topic
        
        return topic[:100]  # Limit length
    
    def detect_subtasks(self, text: str) -> List[str]:
        """
        Detect subtasks or multi-part questions in text.
        
        Args:
            text: Text to analyze
            
        Returns:
            List of detected subtasks
        """
        subtasks = []
        
        # Split on common separators
        separators = ['; ', ' and ', ' or ', ', ']
        parts = [text]
        
        for sep in separators:
            new_parts = []
            for part in parts:
                new_parts.extend(part.split(sep))
            parts = new_parts
        
        # Filter meaningful parts
        for part in parts:
            part = part.strip()
            if len(part) > 10 and ('?' in part or part[0].isupper()):
                subtasks.append(part[:200])  # Limit length
        
        return subtasks[:5]  # Return up to 5 subtasks
    
    def detect_output_bias(self, text: str) -> str:
        """
        Detect intended output format/bias from query.
        
        Args:
            text: Query text
            
        Returns:
            Bias string ('news', 'academic', 'business', 'general')
        """
        text_lower = text.lower()
        
        # News indicators
        if any(word in text_lower for word in ['news', 'breaking', 'latest', 'headlines']):
            return 'news'
        
        # Academic indicators
        if any(word in text_lower for word in ['research', 'study', 'academic', 'scholarly', 'journal']):
            return 'academic'
        
        # Business indicators
        if any(word in text_lower for word in ['business', 'market', 'industry', 'company', 'financial']):
            return 'business'
        
        return 'general'
    
    def extract_enhanced_context_with_claude(
        self, 
        conversation_context: List[Dict], 
        user_query: str
    ) -> Optional[Dict[str, Any]]:
        """
        Use Claude to extract enhanced context from conversation.
        
        Args:
            conversation_context: List of conversation messages
            user_query: Current user query
            
        Returns:
            Dict with extracted context or None if extraction fails
        """
        if not conversation_context or len(conversation_context) < 2:
            return None
        
        try:
            # Build conversation history
            conv_text = ""
            for msg in conversation_context[-10:]:  # Last 10 messages
                role = msg.get('role', 'user')
                content = msg.get('content', '')
                conv_text += f"{role.capitalize()}: {content}\n"
            
            # Ask Claude to extract context
            prompt = f"""Based on this conversation history:

{conv_text}

Current query: {user_query}

Extract and return (in JSON format):
1. main_topic: The overarching research topic (1-3 words)
2. key_entities: Important named entities mentioned (list)
3. timeframe: Temporal focus if any ('recent', 'historical', or '')
4. intent: Research intent ('exploratory', 'specific', 'comparative')

Return only valid JSON."""
            
            response = self.claude_client.messages.create(
                model="claude-3-haiku-20240307",
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Extract and parse response
            import json
            response_text = response.content[0].text.strip()
            
            # Try to extract JSON from response
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                context_data = json.loads(json_match.group())
                return context_data
            
            return None
            
        except Exception as e:
            logger.warning(f"Failed to extract context with Claude: {e}")
            return None
    
    def build_research_brief(
        self, 
        conversation_context: List[Dict], 
        user_query: str
    ) -> Dict[str, Any]:
        """
        Build a research brief from conversation context and query.
        
        Args:
            conversation_context: Conversation history
            user_query: Current query
            
        Returns:
            Dict containing research brief
        """
        # Start with basic brief
        brief = {
            "query": user_query,
            "topic": self.extract_topic_from_query(user_query),
            "entities": self.extract_entities(user_query),
            "output_bias": self.detect_output_bias(user_query),
            "subtasks": self.detect_subtasks(user_query),
            "has_context": len(conversation_context) > 0
        }
        
        # Try to enhance with Claude if we have context
        if conversation_context:
            enhanced = self.extract_enhanced_context_with_claude(conversation_context, user_query)
            if enhanced:
                brief.update(enhanced)
        
        return brief
    
    def classify_intent_and_temporal(self, brief: Dict[str, Any]) -> Dict[str, str]:
        """
        Classify research intent and temporal focus.
        
        Args:
            brief: Research brief dict
            
        Returns:
            Dict with 'intent' and 'temporal_focus' keys
        """
        query = brief.get('query', '')
        output_bias = brief.get('output_bias', 'general')
        
        # Determine intent
        if '?' in query or any(word in query.lower() for word in ['what', 'how', 'why', 'when', 'where']):
            intent = 'exploratory'
        elif any(word in query.lower() for word in ['compare', 'difference', 'versus', 'vs']):
            intent = 'comparative'
        else:
            intent = 'specific'
        
        # Determine temporal focus
        temporal_focus = self.extract_timeframe(query, output_bias)
        
        return {
            "intent": brief.get('intent', intent),
            "temporal_focus": temporal_focus
        }
    
    def build_query_with_brief(
        self, 
        brief: Dict[str, Any], 
        classification: Dict[str, Any]
    ) -> str:
        """
        Build an enhanced query from brief and classification.
        
        Args:
            brief: Research brief
            classification: Intent and temporal classification
            
        Returns:
            Enhanced query string
        """
        query = brief.get('query', '')
        topic = brief.get('topic', '')
        entities = brief.get('entities', [])
        temporal = classification.get('temporal_focus', '')
        
        # Start with original query
        enhanced = query
        
        # Add temporal context if present
        if temporal == 'recent':
            enhanced = f"Recent developments in {topic}: {query}"
        elif temporal == 'historical':
            enhanced = f"Historical perspective on {topic}: {query}"
        
        # Add key entities if they're not already in the query
        if entities:
            entity_str = ', '.join(entities[:3])
            if entity_str.lower() not in enhanced.lower():
                enhanced = f"{enhanced} (focus: {entity_str})"
        
        # Limit length
        if len(enhanced) > 300:
            enhanced = enhanced[:297] + "..."
        
        return enhanced
    
    def detect_publication_constraint(self, query: str) -> Optional[Dict[str, str]]:
        """
        Detect if query has publication source constraints.
        
        Args:
            query: Query text
            
        Returns:
            Dict with constraint details or None
        """
        query_lower = query.lower()
        
        # Check for source constraints
        source_patterns = {
            'nytimes': ['nyt', 'new york times', 'nytimes'],
            'wsj': ['wsj', 'wall street journal'],
            'academic': ['academic', 'peer-reviewed', 'journal', 'research paper'],
            'news': ['news', 'newspaper', 'media'],
        }
        
        for source_type, patterns in source_patterns.items():
            for pattern in patterns:
                if pattern in query_lower:
                    return {
                        "type": source_type,
                        "pattern": pattern
                    }
        
        return None
    
    def blend_sources_by_intent(
        self, 
        sources: List[SourceCard], 
        intent: str
    ) -> List[SourceCard]:
        """
        Reorder sources based on research intent.
        
        Args:
            sources: List of source cards
            intent: Research intent ('exploratory', 'specific', 'comparative')
            
        Returns:
            Reordered list of sources
        """
        if not sources:
            return sources
        
        # For exploratory, prioritize diverse sources
        if intent == 'exploratory':
            # Group by domain and spread them out
            by_domain = {}
            for source in sources:
                domain = source.domain
                if domain not in by_domain:
                    by_domain[domain] = []
                by_domain[domain].append(source)
            
            # Interleave sources from different domains
            result = []
            while any(by_domain.values()):
                for domain in list(by_domain.keys()):
                    if by_domain[domain]:
                        result.append(by_domain[domain].pop(0))
                    if not by_domain[domain]:
                        del by_domain[domain]
            
            return result
        
        # For specific/comparative, keep original order (presumably by relevance)
        return sources


# Global instance for easy import
query_classifier = QueryClassifierService()
