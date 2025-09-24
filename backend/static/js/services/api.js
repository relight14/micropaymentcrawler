/**
 * API Service - Handles all backend communication
 * Extracted from the monolithic ChatResearchApp
 */
export class APIService {
    constructor(authService) {
        this.baseURL = window.location.origin;
        this.authService = authService;
    }

    getAuthHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        const token = this.authService?.getToken();
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        return headers;
    }

    async sendMessage(message, mode, conversationContext = null) {
        // Use optimized research endpoint for research mode
        if (mode === 'research') {
            return await this.analyzeResearchQuery(message, conversationContext);
        }
        
        // Use chat endpoint for other modes
        const response = await fetch(`${this.baseURL}/api/chat`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ message, mode })
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }
        
        const result = await response.json();
        
        // Transform chat response to match expected frontend format
        return {
            content: result.response, // Chat endpoint returns 'response', frontend expects 'content'
            metadata: {
                mode: result.mode,
                conversation_length: result.conversation_length,
                sources: result.sources,
                licensing_summary: result.licensing_summary,
                total_cost: result.total_cost,
                refined_query: result.refined_query
            }
        };
    }
    
    async analyzeResearchQuery(query, conversationContext = null) {
        // Call the optimized research endpoint with progressive loading
        const requestBody = {
            query,
            max_budget_dollars: 10.0,
            preferred_source_count: 15
        };
        
        // Include conversation context if available to make research context-aware
        if (conversationContext && conversationContext.length > 0) {
            requestBody.conversation_context = conversationContext;
        }
        
        const response = await fetch(`${this.baseURL}/api/research/analyze`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`Research analysis failed: ${response.statusText}`);
        }

        const result = await response.json();
        
        // Transform research response to match expected chat format
        return {
            content: result.research_summary,
            research_data: {
                sources: result.sources,
                total_cost: result.total_estimated_cost,
                enrichment_status: result.enrichment_status,
                enrichment_needed: result.enrichment_needed
            },
            metadata: {
                source_count: result.source_count,
                premium_source_count: result.premium_source_count,
                licensing_breakdown: result.licensing_breakdown
            }
        };
    }

    async clearConversation() {
        const response = await fetch(`${this.baseURL}/api/chat/clear`, {
            method: 'POST',
            headers: this.getAuthHeaders()
        });
        
        if (!response.ok) {
            throw new Error('Failed to clear conversation');
        }
        
        return await response.json();
    }

    async analyzeQueryForTier(query, maxBudget, preferredSourceCount, tierType) {
        const response = await fetch(`${this.baseURL}/api/research/analyze`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                query,
                max_budget_dollars: maxBudget,
                preferred_source_count: preferredSourceCount
            })
        });

        if (!response.ok) {
            throw new Error(`Tier analysis failed: ${response.statusText}`);
        }

        return await response.json();
    }

    async unlockSource(sourceId, price) {
        const response = await fetch(`${this.baseURL}/api/sources/unlock-source`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                source_id: sourceId,
                price_cents: Math.round(price * 100)
            })
        });

        if (!response.ok) {
            throw new Error(`Source unlock failed: ${response.statusText}`);
        }

        return await response.json();
    }

    async purchaseTier(tierId, price, query = "Research Query") {
        const response = await fetch(`${this.baseURL}/api/purchase`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                query,
                tier: tierId,
                idempotency_key: null
            })
        });

        if (!response.ok) {
            throw new Error(`Tier purchase failed: ${response.statusText}`);
        }

        return await response.json();
    }
}