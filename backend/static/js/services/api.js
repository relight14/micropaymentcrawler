/**
 * API Service - Handles all backend communication
 * Extracted from the monolithic ChatResearchApp
 */
export class APIService {
    constructor(authService) {
        this.baseURL = window.location.origin;
        this.authService = authService;
        
        // Configurable polling parameters (browser-safe, future: move to window.CONFIG)
        this.config = {
            POLL_INTERVAL_MS: window.CONFIG?.POLL_INTERVAL_MS || 2000,
            MAX_POLL_ATTEMPTS: window.CONFIG?.MAX_POLL_ATTEMPTS || 10,
            RETRY_ATTEMPTS: window.CONFIG?.API_RETRY_ATTEMPTS || 3,
            RETRY_BASE_DELAY: window.CONFIG?.API_RETRY_BASE_DELAY || 1000
        };
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
        console.log(`🔬 API SERVICE: analyzeResearchQuery called`);
        console.log(`🔬 Query: "${query}"`);
        console.log(`🔬 Conversation context:`, conversationContext);
        
        // Step 1: Get skeleton cards immediately
        const requestBody = {
            query,
            max_budget_dollars: 10.0,
            preferred_source_count: 15
        };
        console.log(`🔬 Base request body:`, requestBody);
        
        // Include conversation context if available to make research context-aware
        if (conversationContext && conversationContext.length > 0) {
            console.log(`🔬 Adding conversation context to request...`);
            // Transform conversation objects to simple format expected by backend
            requestBody.conversation_context = conversationContext.map(msg => ({
                sender: msg.sender,
                content: msg.content
            }));
        } else {
            console.log(`🔬 No conversation context to add`);
        }
        
        console.log(`🔬 Final request body:`, requestBody);
        console.log(`🔬 Making request to /api/research/analyze...`);
        
        const response = await fetch(`${this.baseURL}/api/research/analyze`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        console.log(`🔬 Response status: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            console.error(`🔬 API request failed: ${response.status} ${response.statusText}`);
            throw new Error(`Research analysis failed: ${response.statusText}`);
        }

        const result = await response.json();
        console.log(`🔬 API SERVICE: Raw response from backend:`, result);
        
        // Step 2: If progressive flow, start polling for enriched results
        if (result.stage === 'skeleton' && result.cache_key) {
            console.log('🚀 Skeleton cards received, starting progressive enrichment...');
            
            // Start polling for enriched results in background
            this._pollForEnrichment(result.cache_key);
        }
        
        // Transform research response to match expected chat format
        console.log(`🔬 Transforming response for frontend...`);
        const transformedResponse = {
            content: result.research_summary,
            research_data: {
                sources: result.sources,
                total_cost: result.total_estimated_cost,
                enrichment_status: result.enrichment_status,
                enrichment_needed: result.enrichment_needed,
                stage: result.stage,  // For progressive flow tracking
                cache_key: result.cache_key  // For polling
            },
            metadata: {
                source_count: result.source_count,
                premium_source_count: result.premium_source_count,
                licensing_breakdown: result.licensing_breakdown
            }
        };
        console.log(`🔬 API SERVICE: Transformed response:`, transformedResponse);
        console.log(`🔬 API SERVICE: Sources in response: ${result.sources?.length || 0}`);
        return transformedResponse;
    }
    
    // Progressive enrichment polling
    async _pollForEnrichment(cacheKey, maxAttempts = null) {
        const attempts = maxAttempts || this.config.MAX_POLL_ATTEMPTS;
        console.log(`📡 Starting enrichment polling for cache key: ${cacheKey.substring(0, 20)}...`);
        
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await new Promise(resolve => setTimeout(resolve, this.config.POLL_INTERVAL_MS));
                
                const response = await fetch(`${this.baseURL}/api/research/enrichment/${encodeURIComponent(cacheKey)}`, {
                    method: 'GET',
                    headers: this.getAuthHeaders()
                });
                
                if (!response.ok) {
                    console.log(`⚠️ Polling attempt ${attempt} failed: ${response.statusText}`);
                    continue;
                }
                
                const result = await response.json();
                
                if (result.status === 'ready' && result.sources) {
                    console.log(`✅ Enrichment complete! Updated ${result.sources.length} sources`);
                    
                    // Emit enrichment complete event for UI to handle
                    this._emitEnrichmentUpdate(cacheKey, result.sources);
                    return;
                    
                } else if (result.status === 'error') {
                    console.log(`❌ Enrichment failed: ${result.message}`);
                    return;
                    
                } else {
                    console.log(`🔄 Polling attempt ${attempt}: ${result.status}`);
                }
                
            } catch (error) {
                console.log(`❌ Polling error attempt ${attempt}: ${error.message}`);
            }
        }
        
        console.log(`⏰ Enrichment polling timed out after ${attempts} attempts`);
    }
    
    // Event system for progressive updates with error boundary
    _emitEnrichmentUpdate(cacheKey, enrichedSources) {
        try {
            const event = new CustomEvent('enrichmentComplete', {
                detail: { cacheKey, sources: enrichedSources }
            });
            window.dispatchEvent(event);
            console.log(`📢 Emitted enrichmentComplete event for ${enrichedSources.length} sources`);
        } catch (error) {
            console.error('❌ Failed to emit enrichment update event:', error);
            // Continue gracefully - don't let event dispatch failures break the flow
        }
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
        return await this._fetchWithRetry(`${this.baseURL}/api/sources/unlock-source`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                source_id: sourceId,
                price_cents: Math.round(price * 100)
            })
        }, 'Source unlock failed');
    }

    async purchaseTier(tierId, price, query = "Research Query", selectedSources = null) {
        const requestBody = {
            query,
            tier: tierId,
            idempotency_key: null
        };
        
        // Include selected sources if provided (for custom report generation)
        if (selectedSources && selectedSources.length > 0) {
            requestBody.selected_source_ids = selectedSources.map(source => source.id);
        }
        
        // DIAGNOSTIC LOG: Final request body being sent to API
        console.log('🔍 API REQUEST BODY LOG:', {
            requestBody: requestBody,
            requestBodyStringified: JSON.stringify(requestBody),
            headers: this.getAuthHeaders(),
            url: `${this.baseURL}/api/purchase`
        });
        
        return await this._fetchWithRetry(`${this.baseURL}/api/purchase`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(requestBody)
        }, 'Tier purchase failed');
    }
    
    // Retry logic with exponential backoff
    async _fetchWithRetry(url, options, errorPrefix = 'Request failed') {
        for (let attempt = 1; attempt <= this.config.RETRY_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(url, options);
                
                if (!response.ok) {
                    // Don't retry 4xx errors (client errors) except 408 (timeout)
                    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
                        throw new Error(`${errorPrefix}: ${response.statusText}`);
                    }
                    
                    // Retry on 5xx errors and 408
                    if (attempt === this.config.RETRY_ATTEMPTS) {
                        throw new Error(`${errorPrefix}: ${response.statusText}`);
                    }
                    
                    console.log(`⚠️ ${errorPrefix} attempt ${attempt} failed: ${response.statusText}. Retrying...`);
                } else {
                    return await response.json();
                }
                
            } catch (error) {
                if (attempt === this.config.RETRY_ATTEMPTS) {
                    throw error;
                }
                console.log(`❌ ${errorPrefix} attempt ${attempt} error: ${error.message}. Retrying...`);
            }
            
            // Exponential backoff: wait longer between retries
            const delay = this.config.RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}