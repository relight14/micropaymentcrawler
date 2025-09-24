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

    async sendMessage(message, mode) {
        const response = await fetch(`${this.baseURL}/api/chat`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ message, mode })
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.statusText}`);
        }
        
        return await response.json();
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