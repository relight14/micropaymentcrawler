"""
AI Service for Conversational Research Experience
Integrates Anthropic Claude for both conversational and deep research modes.
"""
import os
import json
import re
from typing import List, Dict, Any, Optional
from datetime import datetime
import anthropic
from services.licensing.content_licensing import ContentLicenseService
from services.research.crawler import ContentCrawlerStub
from schemas.domain import TierType

class AIResearchService:
    """Unified AI service for conversational and deep research modes"""
    
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
    
    async def filter_search_results_by_relevance(self, query: str, results: List[Dict[str, Any]], publication: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Use Claude to filter search results for query relevance.
        
        Args:
            query: User's research query
            results: List of search results from Tavily with 'title', 'content', 'url'
            publication: Optional specific publication name (e.g., "Wall Street Journal", "WSJ")
        
        Returns:
            Filtered list of relevant results with reasoning
        """
        print(f"🔎 Claude filtering STARTED - Query: '{query}', Results: {len(results)}, Publication: {publication}")
        
        if not results:
            print("⚠️  No results to filter, returning empty list")
            return []
        
        # Build evaluation prompt
        publication_context = ""
        if publication:
            publication_context = f"\n\nIMPORTANT: User specifically requested sources from '{publication}'. Heavily prioritize results from this publication and filter out results from other publications unless they are highly relevant to the core query."
        
        system_prompt = f"""You are a research relevance expert. Your job is to evaluate whether search results match a user's research query.

Consider these factors:
1. **Topic Match**: Does the article actually discuss the core topic?
2. **Geographic Scope**: If query mentions a specific country/region, does the article focus on that geography?
3. **Contextual Relevance**: Does the article address the user's specific question or need?
4. **Tangential vs Core**: Reject results that are only tangentially related (e.g., international nuclear treaties when user asked about US nuclear power)
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
                model="claude-3-haiku-20240307",  # Fast and cheap for filtering
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
    
    async def optimize_search_query(self, raw_query: str, conversation_context: List[Dict[str, Any]]) -> str:
        """
        Use Claude to optimize a search query based on conversation context.
        
        Args:
            raw_query: User's raw query string
            conversation_context: List of conversation messages for context
        
        Returns:
            Optimized query string for Tavily search API
        """
        print(f"🎯 Query optimization STARTED - Raw query: '{raw_query}'")
        
        # Build conversation summary (last 6 messages)
        context_summary = ""
        if conversation_context:
            for msg in conversation_context[-6:]:
                role = msg.get('role', 'unknown')
                content = msg.get('content', '')[:200]  # Limit length
                context_summary += f"{role.upper()}: {content}\n"
        
        system_prompt = """You are a search query optimization expert. Your job is to convert user queries into highly effective web search queries.

Given a conversation context and user's query, create an optimized search query that:

1. **Prioritizes Specific Entities**: Use specific names (e.g., "US Federal Reserve" not "central banks")
2. **Geographic Precision**: Put geographic constraints first (e.g., "US" before topic)
3. **Temporal Anchoring**: Use specific dates/periods instead of vague terms like "recent"
4. **Complete Thoughts**: Never truncate mid-word or leave incomplete phrases
5. **Signal Analysis Depth**: Add hints like "analysis", "expert commentary", "news coverage" based on user intent
6. **Eliminate Filler**: Remove conversational words like "I want to understand", "really"

Examples:
- Bad: "the role of central banks in setting policy, specifically in the us. really understand this recent uptick in inflation"
- Good: "US Federal Reserve delayed inflation response 2024 post-COVID - why Fed was slow to raise interest rates"

- Bad: "what's happening with tech stocks recently"
- Good: "US tech stock market performance October 2025 analysis"

Return ONLY the optimized query (max 120 characters). No explanation."""

        try:
            user_message = f"""Conversation Context:
{context_summary}

User Query: "{raw_query}"

Generate an optimized search query (max 120 chars):"""

            print(f"📡 Calling Claude API for query optimization...")
            response = self.client.messages.create(
                model="claude-3-haiku-20240307",  # Fast and cheap
                max_tokens=150,
                temperature=0.0,  # Deterministic
                system=system_prompt,
                messages=[{
                    "role": "user",
                    "content": user_message
                }]
            )
            
            optimized_query = self._extract_response_text(response).strip()
            
            # Remove any quotes if Claude added them
            optimized_query = optimized_query.strip('"\'')
            
            # Truncate to 120 chars if needed
            if len(optimized_query) > 120:
                optimized_query = optimized_query[:120].rsplit(' ', 1)[0]
            
            print(f"✅ Query optimized: '{raw_query}' → '{optimized_query}'")
            return optimized_query
            
        except Exception as e:
            print(f"⚠️  Query optimization failed (using raw query): {e}")
            return raw_query  # Fallback to raw query on error
    
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
        
        # Need at least 2 USER messages for context (meaning second exchange)
        user_history = self.user_conversations.get(user_id, [])
        user_messages = [msg for msg in user_history if msg["role"] == "user"]
        print(f"📊 Checking research suggestion - User {user_id} has {len(user_messages)} user messages ({len(user_history)} total)")
        if len(user_messages) < 2:
            print(f"⏳ Not enough user messages yet ({len(user_messages)} < 2), not suggesting research")
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
        
    async def chat(self, user_message: str, mode: str = "conversational", user_id: str = "anonymous") -> Dict[str, Any]:
        """
        Main chat interface supporting both conversational and deep research modes
        """
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
        
        if mode == "chat" or mode == "conversational":
            return self._conversational_response(user_message, user_id)
        else:  # research or deep_research
            return await self._deep_research_response(user_message, user_id)
    
    def _conversational_response(self, user_message: str, user_id: str) -> Dict[str, Any]:
        """Generate conversational response to help explore research interests"""
        
        system_prompt = """You are an expert research assistant helping users explore and refine their research interests. Your role is to:

1. Ask thoughtful follow-up questions to understand their research needs
2. Suggest related areas of investigation they might not have considered
3. Help them narrow down broad topics into specific, researchable questions
4. Provide context about why certain research directions might be valuable
5. Prepare them for productive deep research by understanding their goals

Be curious, engaging, and intellectually stimulating. Help them think deeper about their topic.
When they seem ready for deep research, you can suggest they switch to "Deep Research" mode to find specific sources and data."""
        
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
                model="claude-3-haiku-20240307",
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
                "suggest_research": should_suggest
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
                model="claude-3-haiku-20240307",
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
                model="claude-3-haiku-20240307",
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
                model="claude-3-haiku-20240307",
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