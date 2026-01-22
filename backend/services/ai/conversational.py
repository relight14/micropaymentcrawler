"""
AI Service for Conversational Research Experience
Integrates Anthropic Claude for both conversational and deep research modes.
"""
import os
import json
import re
import time
from typing import List, Dict, Any, Optional
from datetime import datetime
import anthropic
from services.licensing.content_licensing import ContentLicenseService
from services.research.crawler import ContentCrawlerStub
# TierType removed - all reports are now Pro Package

class AIResearchService:
    """Unified AI service for conversational and deep research modes"""
    
    # Maximum number of messages to keep per user (prevents memory bloat)
    MAX_CONVERSATION_HISTORY = 50
    # Maximum number of active users to track
    MAX_ACTIVE_USERS = 1000
    
    def __init__(self):
        self.client = anthropic.Anthropic(
            api_key=os.environ.get('ANTHROPIC_API_KEY')
        )
        self.license_service = ContentLicenseService()
        self.crawler = ContentCrawlerStub()
        # Store conversations per user to prevent cross-user data leakage
        self.user_conversations: Dict[str, List[Dict[str, Any]]] = {}
        # Track whether we've suggested research mode for each user
        self.suggested_research: Dict[str, bool] = {}
        # Track last access time for each user (for cleanup)
        self.user_last_access: Dict[str, float] = {}
    
    async def filter_search_results_by_relevance(self, query: str, results: List[Dict[str, Any]], publication: Optional[str] = None, conversation_context: Optional[List[Dict[str, Any]]] = None, enhanced_context: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Use Claude to filter search results for conversation-aware relevance.
        
        Args:
            query: User's research query
            results: List of search results from Tavily with 'title', 'content', 'url'
            publication: Optional specific publication name (e.g., "Wall Street Journal", "WSJ")
            conversation_context: Optional conversation history to evaluate relevance against
            enhanced_context: Optional enhanced_context from research brief extraction
        
        Returns:
            Filtered list of relevant results with reasoning
        """
        print(f"🔎 Claude filtering STARTED - Query: '{query}', Results: {len(results)}, Publication: {publication}, Has Conversation: {conversation_context is not None}, Has Enhanced Context: {enhanced_context is not None}")
        
        if not results:
            print("⚠️  No results to filter, returning empty list")
            return []
        
        # Build conversation context for filtering
        conversation_summary = ""
        if conversation_context:
            # Build summary of last 8-10 messages
            recent_messages = conversation_context[-10:] if len(conversation_context) > 10 else conversation_context
            for msg in recent_messages:
                role = msg.get('sender', msg.get('role', 'user'))
                content = msg.get('content', '').strip()
                if content and len(content) > 5:
                    conversation_summary += f"{role.upper()}: {content}\n"
        
        # Build enhanced context summary
        context_details = ""
        if enhanced_context:
            geographic = enhanced_context.get("geographic_scope", "").strip()
            temporal = enhanced_context.get("temporal_scope", "").strip()
            aspects = enhanced_context.get("specific_aspects", [])
            exclusions = enhanced_context.get("exclusions", [])
            
            if geographic and geographic.lower() not in ["none", "global"]:
                context_details += f"\n- Geographic focus: {geographic}"
            if temporal and temporal.lower() != "none":
                context_details += f"\n- Time period: {temporal}"
            if aspects:
                context_details += f"\n- Specific aspects: {', '.join(aspects[:3])}"
            if exclusions:
                context_details += f"\n- EXCLUDE topics: {', '.join(exclusions)}"
        
        # Build evaluation prompt
        publication_context = ""
        if publication:
            publication_context = f"\n\nIMPORTANT: User specifically requested sources from '{publication}'. Heavily prioritize results from this publication and filter out results from other publications unless they are highly relevant to the core query."
        
        # Enhanced system prompt with conversation context
        if conversation_summary or context_details:
            system_prompt = f"""You are a research relevance expert. Your job is to evaluate whether search results match what the user discussed in their conversation.

User's Research Query: "{query}"{context_details}

Conversation Context:
{conversation_summary if conversation_summary else "(No conversation history)"}

Evaluate each result against these factors:
1. **Conversation Alignment**: Does the source address what the user discussed and cared about in the conversation?
2. **Geographic/Temporal Match**: If the user specified geographic or time constraints, does the article match?
3. **Specific Aspects**: Does it cover the specific aspects or angles the user mentioned?
4. **Exclusions**: If the user mentioned topics to EXCLUDE, reject sources about those topics
5. **Topic Match**: Does the article genuinely discuss the core topic?
6. **Publication Focus**: If a specific publication was requested, is this from that publication?

Be VERY strict - only mark results as relevant if they genuinely address what the user discussed in the conversation. Consider the full context of the conversation, not just the query string.{publication_context}

For each result, respond with JSON:
{{"relevant": true/false, "reason": "brief explanation based on conversation context"}}"""
        else:
            # Fallback to query-only filtering (original behavior)
            system_prompt = f"""You are a research relevance expert. Your job is to evaluate whether search results match a user's research query.

Consider these factors:
1. **Topic Match**: Does the article actually discuss the core topic?
2. **Geographic Scope**: If query mentions a specific country/region, does the article focus on that geography?
3. **Contextual Relevance**: Does the article address the user's specific question or need?
4. **Tangential vs Core**: Reject results that are only tangentially related
5. **Publication Focus**: If a specific publication was requested, is this from that publication?

Be strict - only mark results as relevant if they genuinely address the user's query. When in doubt, filter it out.

User Query: "{query}"{publication_context}

For each result, respond with JSON:
{{"relevant": true/false, "reason": "brief explanation"}}"""

        try:
            # Prepare results summary for Claude
            results_text = "\n\n".join([
                f"Result {i+1}:\nTitle: {r.get('title', 'No title')}\nURL: {r.get('url', '')}\nSummary: {r.get('content', '')[:300]}..."
                for i, r in enumerate(results[:15])  # Limit to 15 to stay under token limits
            ])
            
            user_message = f"Evaluate these search results for relevance:\n\n{results_text}\n\nRespond with a JSON array of evaluations, one per result."
            
            print(f"📡 Calling Claude API for relevance filtering...")
            response = self.client.messages.create(
                model="claude-sonnet-4-20250514",  # High-quality filtering with current knowledge
                max_tokens=2000,
                temperature=0.0,  # Deterministic for consistency
                system=system_prompt,
                messages=[{
                    "role": "user",
                    "content": user_message
                }]
            )
            print(f"✅ Claude API response received")
            
            response_text = self._extract_response_text(response)
            
            # Parse Claude's evaluation
            try:
                # Extract JSON from response (handle markdown code blocks)
                import re
                json_match = re.search(r'```json\s*(.*?)\s*```', response_text, re.DOTALL)
                if json_match:
                    evaluations = json.loads(json_match.group(1))
                else:
                    # Try parsing directly
                    evaluations = json.loads(response_text)
                
                # Filter results based on Claude's evaluation
                filtered_results = []
                filtered_reasons = []
                
                for i, (result, evaluation) in enumerate(zip(results, evaluations)):
                    if evaluation.get('relevant', False):
                        filtered_results.append(result)
                    else:
                        reason = evaluation.get('reason', 'Not relevant')
                        filtered_reasons.append(f"  • {result.get('title', 'Unknown')[:60]}... - {reason}")
                
                # Log filtering results
                if filtered_reasons:
                    print(f"🔍 Claude filtered out {len(filtered_reasons)} irrelevant results:")
                    for reason in filtered_reasons[:5]:  # Show first 5
                        print(reason)
                    if len(filtered_reasons) > 5:
                        print(f"  ... and {len(filtered_reasons) - 5} more")
                
                print(f"✅ Claude relevance filtering: {len(results)} → {len(filtered_results)} results")
                return filtered_results
                
            except json.JSONDecodeError as e:
                print(f"⚠️  Failed to parse Claude evaluation (using all results): {e}")
                print(f"Response was: {response_text[:200]}...")
                return results  # Return all results if parsing fails
                
        except Exception as e:
            print(f"⚠️  Claude filtering error (using all results): {e}")
            return results  # Fallback to all results on error
    
    async def optimize_search_query(self, raw_query: str, conversation_context: List[Dict[str, Any]], pinned_topic: str = None) -> str:
        """
        Use Claude to optimize a search query based on conversation context.
        
        Args:
            raw_query: User's raw query string
            conversation_context: List of conversation messages for context
            pinned_topic: Optional pinned research topic to anchor the query
        
        Returns:
            Optimized query string for Tavily search API
        """
        print(f"🎯 Query optimization STARTED - Raw query: '{raw_query}'")
        
        # Build conversation summary (last 6 messages)
        context_summary = ""
        if conversation_context:
            for msg in conversation_context[-6:]:
                # Frontend sends 'sender' field, not 'role'
                role = msg.get('sender', msg.get('role', 'unknown'))
                content = msg.get('content', '')[:200]  # Limit length
                context_summary += f"{role.upper()}: {content}\n"
        
        # Build system prompt with topic constraint if available
        if pinned_topic:
            system_prompt = f"""You are a query optimizer. Your job is to rewrite a user's search query for precision by incorporating relevant context from the conversation.

CRITICAL CONSTRAINT: The user is researching "{pinned_topic}". ALL queries must remain anchored to this topic. Do NOT change topics.

Hard rules (must obey):
1) Keep the topic "{pinned_topic}" in your optimized query. This is MANDATORY.
2) Treat all queries as refinements of "{pinned_topic}" (e.g., adding publication filters, requesting more sources).
3) Extract key entities and topics from the conversation context that are relevant to the user's query.
4) Do NOT add entities that are unrelated to both the query and conversation context.
5) Keep it 5–15 words. No punctuation unless needed for operators.
6) Remove filler words like "I want to understand", "really", "help me", "can we", "find", but preserve all substantive terms.

Examples with topic constraint:
- Topic: "renewable energy", Query: "anything from time magazine" → Output: "renewable energy time magazine"
- Topic: "renewable energy", Query: "can we find paid sources?" → Output: "renewable energy credible paid sources"
- Topic: "federal reserve", Query: "more from wsj" → Output: "federal reserve WSJ"

Return ONLY the optimized query. No explanation."""
        else:
            system_prompt = """You are a query optimizer. Your job is to rewrite a user's search query for precision by incorporating relevant context from the conversation.

Hard rules (must obey):
1) When the user asks a follow-up question (e.g., "more sources about...", "what about...", "from publications like..."), incorporate the main topic from the conversation context.
2) Extract key entities and topics from the conversation context that are relevant to the user's query.
3) Do NOT add entities that are unrelated to both the query and conversation context.
4) Keep it 5–15 words. No punctuation unless needed for operators.
5) Remove filler words like "I want to understand", "really", "help me", "can we", "find", but preserve all substantive terms.

Examples with context:
- Context: "USER: federal reserve policy... ASSISTANT: sources about fed policy"
  Query: "can we find more sources from wsj and nyt?"
  Output: "federal reserve policy WSJ NYT economist"

- Context: "USER: climate change solutions... ASSISTANT: renewable energy sources"
  Query: "what about solar panels?"
  Output: "climate change solar panels"

- Query without context: "green energy" → Output: "green energy"

Return ONLY the optimized query. No explanation."""

        try:
            user_message = f"""Conversation Context:
{context_summary}

User Query: "{raw_query}"

Generate an optimized search query (max 120 chars):"""

            print(f"📡 Calling Claude API for query optimization...")
            response = self.client.messages.create(
                model="claude-sonnet-4-20250514",  # Fast and cheap
                max_tokens=150,
                temperature=0.1,  # Low but not 0.0 - stable without brittleness
                system=system_prompt,
                messages=[{
                    "role": "user",
                    "content": user_message
                }]
            )
            
            optimized_query = self._extract_response_text(response).strip()
            
            # Remove any quotes if Claude added them
            optimized_query = optimized_query.strip('"\'')
            
            # Safety: Fallback to raw query if Claude returns empty/whitespace
            if not optimized_query or optimized_query.isspace():
                print(f"⚠️  Claude returned empty query, using raw query")
                return raw_query
            
            # POST-GENERATION GUARD: Check if Claude introduced new entities
            if not self._validate_no_entity_injection(raw_query, optimized_query, context_summary):
                print(f"⚠️  Entity injection detected - reverting to raw query")
                return raw_query
            
            # Truncate to 120 chars if needed
            if len(optimized_query) > 120:
                optimized_query = optimized_query[:120].rsplit(' ', 1)[0]
            
            print(f"✅ Query optimized: '{raw_query}' → '{optimized_query}'")
            return optimized_query
            
        except Exception as e:
            print(f"⚠️  Query optimization failed (using raw query): {e}")
            return raw_query  # Fallback to raw query on error
    
    def _validate_no_entity_injection(self, raw_query: str, optimized_query: str, context_summary: str) -> bool:
        """
        Check if optimized query introduces new proper nouns/entities not in raw query or context.
        Returns True if valid (no injection), False if entities were added.
        
        Case-insensitive validation that supports:
        - Acronyms in any case (wsj, WSJ, Wsj all match)
        - Multi-word topics from context (federal reserve policy)
        - Context-aware follow-up queries
        """
        import re
        
        def extract_all_words(text: str) -> set:
            """Extract ALL words (case-insensitive) including potential entities and acronyms."""
            if not text:
                return set()
            # Get all words (2+ chars), normalize to lowercase
            all_words = re.findall(r'\b[a-zA-Z]{2,}\b', text)
            return {w.lower() for w in all_words}
        
        def extract_entities(text: str) -> set:
            """Extract likely entities: proper nouns and all-caps acronyms."""
            if not text:
                return set()
            # Pattern 1: Capitalized words (proper nouns)
            proper_nouns = set(re.findall(r'\b[A-Z][a-zA-Z]{1,}\b', text))
            # Pattern 2: All-caps acronyms (2+ letters)
            acronyms = set(re.findall(r'\b[A-Z]{2,}\b', text))
            # Normalize to lowercase for case-insensitive comparison
            return {e.lower() for e in (proper_nouns | acronyms)}
        
        # Get ALL words from raw query (case-insensitive) - includes lowercase acronyms like "wsj"
        raw_words = extract_all_words(raw_query)
        
        # Get entities from context
        context_entities = extract_entities(context_summary)
        
        # Also extract ALL words from context (for multi-word topics)
        context_words = extract_all_words(context_summary)
        
        # Allowed words/entities = anything from raw query OR context
        allowed_words = raw_words | context_words | context_entities
        
        # Get entities from optimized query
        optimized_entities = extract_entities(optimized_query)
        
        # Check for introduced entities (not in allowed set)
        introduced = optimized_entities - allowed_words
        
        # Filter out common non-entity words that might be capitalized
        common_words = {'october', 'november', 'december', 'january', 'february', 'march', 
                       'april', 'may', 'june', 'july', 'august', 'september', 'monday', 
                       'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
                       'today', 'yesterday', 'tomorrow', 'morning', 'evening', 'night',
                       # Geographic abbreviations and common pronouns
                       'us', 'uk', 'eu', 'usa', 'uae', 'ussr', 'un', 'nato', 'asean'}
        introduced = introduced - common_words
        
        if introduced:
            print(f"🚨 Entity injection detected: {introduced}")
            print(f"   Raw words: {raw_words}")
            print(f"   Context words (sampled): {list(context_words)[:10]}")
            print(f"   Optimized entities: {optimized_entities}")
            return False
        
        return True
    
    def _extract_response_text(self, response) -> str:
        """Safely extract text from Anthropic response."""
        try:
            if hasattr(response, 'content') and response.content and len(response.content) > 0:
                content_block = response.content[0]
                if hasattr(content_block, 'text') and content_block.text:
                    return content_block.text
                else:
                    return str(content_block)
            else:
                return str(response)
        except Exception:
            return str(response)
    
    def _should_suggest_research(self, user_id: str) -> tuple[bool, Optional[str]]:
        """
        Determine if we should suggest switching to research mode.
        Returns: (should_suggest: bool, topic_hint: Optional[str])
        """
        # Don't suggest if we already have
        if self.suggested_research.get(user_id, False):
            print(f"🚫 Research already suggested for user {user_id}, skipping")
            return False, None
        
        # Need at least 3 USER messages for context (meaning third exchange)
        user_history = self.user_conversations.get(user_id, [])
        user_messages = [msg for msg in user_history if msg["role"] == "user"]
        print(f"📊 Checking research suggestion - User {user_id} has {len(user_messages)} user messages ({len(user_history)} total)")
        if len(user_messages) < 3:
            print(f"⏳ Not enough user messages yet ({len(user_messages)} < 3), not suggesting research")
            return False, None
        
        # Build research brief from conversation
        try:
            from app.api.routes.research import _build_research_brief, _classify_intent_and_temporal
            
            # Get recent messages for context
            context_messages = user_history[-6:]
            last_user_message = next((msg["content"] for msg in reversed(user_history) if msg["role"] == "user"), "")
            
            # Extract research brief
            brief = _build_research_brief(context_messages, last_user_message)
            
            # Classify intent
            classification = _classify_intent_and_temporal(brief)
            intent = classification.get("intent", "general_research")
            
            # Research-worthy intents
            research_intents = ["news_event", "policy_analysis", "academic_causal", "business_trends", "historical_explainer"]
            
            if intent in research_intents:
                # Extract topic hint for prefill
                topic_hint = brief.get("topic") or (brief["entities"][0] if brief.get("entities") else None)
                return True, topic_hint
            
        except Exception as e:
            print(f"⚠️ Research suggestion detection error: {e}")
        
        return False, None
    
    def _detect_source_intent(self, user_message: str, user_id: str) -> Dict[str, Any]:
        """
        Detect if user is explicitly requesting source/research search.
        Returns: {needs_sources: bool, query: str, confidence: float}
        """
        # Get recent conversation context (last assistant + user turns)
        user_history = self.user_conversations.get(user_id, [])
        recent_messages = user_history[-4:] if len(user_history) >= 4 else user_history
        
        # Build context for Claude
        context = "\n".join([
            f"{msg['role'].upper()}: {msg['content'][:200]}"
            for msg in recent_messages
        ])
        
        system_prompt = """You are an intent classifier. Analyze if the user is explicitly requesting to search for sources, articles, or research.

EXPLICIT source requests include:
- "find sources on this"
- "search for sources about X"
- "show me sources/articles/research"
- "I'd like to see sources on X"
- "get me sources/articles about this"
- "that's interesting, find sources on this aspect"
- Natural variations expressing intent to search for authoritative content

DO NOT flag as source requests:
- General research questions without explicit search intent
- Asking for explanations or opinions
- Continuing normal conversation

Respond with ONLY valid JSON (no markdown):
{"needs_sources": true/false, "query": "extracted search query", "confidence": 0.0-1.0}

If needs_sources is true, extract a clear search query from the context."""

        try:
            # Use Claude to detect intent
            response = self.client.messages.create(
                model="claude-sonnet-4-20250514",  # Fast and cheap
                max_tokens=200,
                temperature=0.0,  # Deterministic
                system=system_prompt,
                messages=[{
                    "role": "user",
                    "content": f"Recent conversation:\n{context}\n\nLatest message: {user_message}\n\nDoes the user want to search for sources?"
                }]
            )
            
            response_text = self._extract_response_text(response).strip()
            
            # Parse JSON response
            try:
                result = json.loads(response_text)
                needs_sources = result.get("needs_sources", False)
                query = result.get("query", user_message)
                confidence = result.get("confidence", 0.0)
                
                if needs_sources:
                    print(f"🔍 Intent Detection: Source search requested (confidence: {confidence:.2f})")
                    print(f"   Extracted query: {query}")
                
                return {
                    "needs_sources": needs_sources,
                    "query": query,
                    "confidence": confidence
                }
                
            except json.JSONDecodeError:
                print(f"⚠️ Intent detection JSON parse failed: {response_text}")
                # Default to no intent detected
                return {"needs_sources": False, "query": user_message, "confidence": 0.0}
                
        except Exception as e:
            print(f"⚠️ Intent detection error: {e}")
            # Default to no intent detected
            return {"needs_sources": False, "query": user_message, "confidence": 0.0}
        
    def _cleanup_old_users(self):
        """Remove inactive users to prevent memory bloat"""
        # Only cleanup if we have too many users
        if len(self.user_conversations) <= self.MAX_ACTIVE_USERS:
            return
        
        current_time = time.time()
        # Remove users inactive for more than 1 hour
        inactive_threshold = 3600  # 1 hour in seconds
        
        users_to_remove = [
            user_id for user_id, last_access in self.user_last_access.items()
            if current_time - last_access > inactive_threshold
        ]
        
        for user_id in users_to_remove:
            if user_id in self.user_conversations:
                del self.user_conversations[user_id]
            if user_id in self.suggested_research:
                del self.suggested_research[user_id]
            if user_id in self.user_last_access:
                del self.user_last_access[user_id]
        
        if users_to_remove:
            print(f"🧹 Cleaned up {len(users_to_remove)} inactive users")
    
    async def chat(self, user_message: str, mode: str = "conversational", user_id: str = "anonymous") -> Dict[str, Any]:
        """
        Main chat interface supporting both conversational and deep research modes
        """
        # Update last access time and cleanup old users
        self.user_last_access[user_id] = time.time()
        self._cleanup_old_users()
        
        # Initialize user conversation if not exists
        if user_id not in self.user_conversations:
            self.user_conversations[user_id] = []
        
        # Add user message to user-specific conversation history
        self.user_conversations[user_id].append({
            "role": "user", 
            "content": user_message,
            "timestamp": datetime.now().isoformat(),
            "mode": mode
        })
        
        # Trim conversation history to prevent unbounded growth
        if len(self.user_conversations[user_id]) > self.MAX_CONVERSATION_HISTORY:
            # Keep only the most recent messages
            self.user_conversations[user_id] = self.user_conversations[user_id][-self.MAX_CONVERSATION_HISTORY:]
            print(f"📝 Trimmed conversation history for {user_id} to {self.MAX_CONVERSATION_HISTORY} messages")
        
        if mode == "chat" or mode == "conversational":
            # Detect if user is explicitly requesting sources
            intent_result = self._detect_source_intent(user_message, user_id)
            return self._conversational_response(user_message, user_id, intent_result)
        else:  # research or deep_research
            return await self._deep_research_response(user_message, user_id)
    
    def _conversational_response(self, user_message: str, user_id: str, intent_result: Dict[str, Any] = None) -> Dict[str, Any]:
        """Generate conversational response to help explore research interests"""
        
        if intent_result is None:
            intent_result = {"needs_sources": False, "query": "", "confidence": 0.0}
        
        current_date = datetime.now().strftime("%B %d, %Y")
        
        system_prompt = f"""You are an expert research guidance assistant helping users refine their research process through thoughtful conversation.

IMPORTANT CONTEXT:
- Today's date is {current_date}
- Your knowledge was last updated in April 2024
- For questions about events after April 2024, acknowledge your knowledge cutoff and suggest using Research mode for current information

Your role is to guide users toward precise, well-scoped research:

1. **Guide Scope Refinement**: Ask clarifying questions to help users narrow or expand their research focus
   - Geographic scope: "Are you interested in this globally, or focused on a specific region?"
   - Temporal scope: "Do you want recent developments, or historical context?"
   - Source preferences: "Would academic studies be helpful, or are you looking for journalism/policy analysis?"

2. **Identify Constraints**: Help users articulate what they DO and DON'T want
   - "What specific aspects are most important to you?"
   - "Is there anything you'd like to exclude from your research?"

3. **Emphasize Credibility**: Frame research as finding the most trustworthy sources
   - "When you're ready to research, I'll help you find the most credible sources on this topic—whether they're free or paywalled"
   - "Premium sources from major publications and peer-reviewed journals often provide the most authoritative analysis"

4. **Encourage Specificity**: Ask follow-up questions to understand their real information needs
   - Don't accept vague queries—help them get specific about what they're trying to learn

Be curious but not overbearing. Guide naturally through conversation, not interrogation.
When they seem ready for deep research or ask about current events, suggest they switch to "Research" mode to get specific, credible sources."""
        
        # Create conversation context for Claude using user-specific history
        user_history = self.user_conversations.get(user_id, [])
        # Convert to proper message format for Anthropic API
        from typing import cast
        messages = cast(list, [
            {"role": msg["role"], "content": msg["content"]} 
            for msg in user_history[-10:]  # Last 10 messages for context
        ])
        
        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1000,
                temperature=0.7,
                system=system_prompt,
                messages=messages
            )
            
            ai_response = self._extract_response_text(response)
            
            # Add AI response to user-specific conversation history
            self.user_conversations[user_id].append({
                "role": "assistant",
                "content": ai_response,
                "timestamp": datetime.now().isoformat(),
                "mode": "conversational"
            })
            
            # Check if we should suggest switching to research mode
            should_suggest, topic_hint = self._should_suggest_research(user_id)
            
            result = {
                "response": ai_response,
                "mode": "conversational",
                "conversation_length": len(self.user_conversations[user_id]),
                "suggest_research": should_suggest,
                # Intent detection fields
                "source_search_requested": intent_result.get("needs_sources", False),
                "source_query": intent_result.get("query", ""),
                "source_confidence": intent_result.get("confidence", 0.0)
            }
            
            # Mark that we've suggested for this user (regardless of topic_hint)
            if should_suggest:
                self.suggested_research[user_id] = True
                print(f"💡 Suggesting research mode switch{f' for topic: {topic_hint}' if topic_hint else ''}")
                
                # Add topic hint to result if available
                if topic_hint:
                    result["topic_hint"] = topic_hint
            
            return result
            
        except Exception as e:
            return {
                "response": f"I'm having trouble connecting right now. Let me help you explore your research interests anyway - what specific aspect of your topic are you most curious about?",
                "mode": "conversational", 
                "suggest_research": False,
                "source_search_requested": False,
                "source_query": "",
                "source_confidence": 0.0,
                "error": str(e)
            }
    
    async def _deep_research_response(self, user_message: str, user_id: str) -> Dict[str, Any]:
        """Generate deep research with context-aware source selection"""
        
        # Analyze conversation history to understand research focus
        conversation_context = self._extract_research_context(user_id)
        
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
                model="claude-sonnet-4-20250514",
                max_tokens=500,
                temperature=0.3,
                system=system_prompt,
                messages=[{"role": "user", "content": f"Generate a targeted research query for: {user_message}"}]
            )
            
            research_query = self._extract_response_text(response).strip()
            
            # Execute deep research with the refined query
            return await self._execute_deep_research(research_query, user_message, user_id)
            
        except Exception as e:
            print(f"⚠️ Research context extraction failed: {e}")
            # Fallback: use original user message as query
            return await self._execute_deep_research(user_message, user_message, user_id)
    
    def _extract_research_context(self, user_id: str) -> str:
        """Extract key research themes from conversation history"""
        user_history = self.user_conversations.get(user_id, [])
        
        # Debug logging
        print(f"🔍 Extracting context for user_id={user_id}, found {len(user_history)} messages")
        
        # Include both user and assistant messages for richer context
        recent_messages = [
            msg["content"] for msg in user_history[-8:] 
            if msg["role"] in ["user", "assistant"] and len(msg["content"].strip()) > 10
        ]
        
        # Debug: show message preview
        print(f"📝 Message preview: {[m[:80] + '...' if len(m) > 80 else m for m in recent_messages[:3]]}")
        
        # De-duplicate similar messages
        seen = set()
        unique_messages = []
        for msg in recent_messages:
            # Simple deduplication by content similarity
            msg_clean = msg.strip().lower()
            if msg_clean not in seen and len(msg_clean) > 10:
                unique_messages.append(msg)
                seen.add(msg_clean)
        
        print(f"✅ Final unique messages: {len(unique_messages)}")
        return "\n".join([f"- {msg}" for msg in unique_messages])
    
    async def _execute_deep_research(self, refined_query: str, original_query: str, user_id: str) -> Dict[str, Any]:
        """Execute deep research with intelligent source selection"""
        
        try:
            # Generate sources using the refined query
            sources = await self.crawler.generate_sources(refined_query, 15)  # Get more to select from
            
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
            
            # Add to user-specific conversation history
            if user_id not in self.user_conversations:
                self.user_conversations[user_id] = []
            
            self.user_conversations[user_id].append({
                "role": "assistant",
                "content": ai_response,
                "timestamp": datetime.now().isoformat(),
                "mode": "research"
            })
            
            return {
                "response": ai_response,
                "mode": "research",
                "sources": selected_sources,
                "licensing_summary": licensing_summary,
                "refined_query": refined_query,
                "total_cost": licensing_summary.get('total_cost', 0.0),
                "conversation_length": len(self.user_conversations.get(user_id, []))
            }
            
        except Exception as e:
            return {
                "response": f"I encountered an issue during research, but I can still help you explore this topic conversationally. What specific aspect would you like to discuss?",
                "mode": "research",
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
                model="claude-sonnet-4-20250514",
                max_tokens=100,
                temperature=0.1,
                messages=[{"role": "user", "content": prompt}]
            )
            
            # Parse selected indices
            selected_indices = [int(x.strip()) for x in self._extract_response_text(response).strip().split(',') if x.strip().isdigit()]
            
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
                model="claude-sonnet-4-20250514",
                max_tokens=400,
                temperature=0.6,
                messages=[{"role": "user", "content": prompt}]
            )
            
            return self._extract_response_text(response)
            
        except Exception:
            return "Here are the most relevant sources I found for your research. Each offers unique insights that will help answer your questions."
    
    def get_conversation_history(self, user_id: str) -> List[Dict]:
        """Get the current conversation history for a specific user"""
        return self.user_conversations.get(user_id, [])
    
    def migrate_conversation(self, old_user_id: str, new_user_id: str) -> bool:
        """Migrate conversation history from old user ID to new user ID during login"""
        if old_user_id not in self.user_conversations:
            return False  # No conversation to migrate
        
        if old_user_id == new_user_id:
            return False  # Same user ID, no migration needed
        
        # Move conversation history from old to new user ID
        conversation_history = self.user_conversations[old_user_id]
        if conversation_history:  # Only migrate if there's actual content
            self.user_conversations[new_user_id] = conversation_history
            del self.user_conversations[old_user_id]
            return True
        
        return False
    
    def clear_conversation(self, user_id: str) -> None:
        """Clear conversation history for a specific user"""
        if user_id in self.user_conversations:
            self.user_conversations[user_id] = []
        # Reset research suggestion flag when clearing conversation
        if user_id in self.suggested_research:
            self.suggested_research[user_id] = False