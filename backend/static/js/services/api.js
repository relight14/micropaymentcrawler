/**
 * API Service - Handles all backend communication
 * Extracted from the monolithic ChatResearchApp
 */
import { generateIdempotencyKey } from '../utils/helpers.js';

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

    /**
     * Centralized 401 handler - triggers logout and throws consistent error
     * Call this in response.ok checks to ensure consistent auth handling
     */
    _handle401(response) {
        if (response.status === 401) {
            console.log('🔐 401 Unauthorized - triggering logout');
            this.authService.clearToken(); // This will trigger logout callbacks
            throw new Error("Your session has expired. Please log in again.");
        }
    }

    /**
     * Generic GET request
     * @param {string} endpoint - API endpoint (e.g., '/api/projects/83/sources')
     * @returns {Promise<any>} Response JSON
     */
    async get(endpoint) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'GET',
            headers: this.getAuthHeaders()
        });

        if (!response.ok) {
            this._handle401(response);
            throw new Error(`GET ${endpoint} failed: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Generic POST request
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request body data
     * @returns {Promise<any>} Response JSON
     */
    async post(endpoint, data = {}) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            this._handle401(response);
            throw new Error(`POST ${endpoint} failed: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Generic PUT request
     * @param {string} endpoint - API endpoint
     * @param {Object} data - Request body data
     * @returns {Promise<any>} Response JSON
     */
    async put(endpoint, data = {}) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'PUT',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            this._handle401(response);
            throw new Error(`PUT ${endpoint} failed: ${response.statusText}`);
        }

        return await response.json();
    }

    /**
     * Generic DELETE request
     * @param {string} endpoint - API endpoint
     * @returns {Promise<any>} Response JSON
     */
    async delete(endpoint) {
        const response = await fetch(`${this.baseURL}${endpoint}`, {
            method: 'DELETE',
            headers: this.getAuthHeaders()
        });

        if (!response.ok) {
            this._handle401(response);
            throw new Error(`DELETE ${endpoint} failed: ${response.statusText}`);
        }

        return await response.json();
    }

    async sendMessage(message, mode, conversationContext = null) {
        console.log(`📡 [API] sendMessage called with mode="${mode}"`);
        
        // Use optimized research endpoint for research mode
        if (mode === 'research') {
            console.log(`📡 [API] Routing to /api/research/analyze (authenticated research)`);
            return await this.analyzeResearchQuery(message, conversationContext);
        }
        
        // Use chat endpoint for other modes
        console.log(`📡 [API] Routing to /api/chat (anonymous conversational)`);
        const response = await fetch(`${this.baseURL}/api/chat`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({ message, mode })
        });
        
        if (!response.ok) {
            this._handle401(response);
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
                refined_query: result.refined_query,
                suggest_research: result.suggest_research || false,
                topic_hint: result.topic_hint || null,
                // Intent detection fields
                source_search_requested: result.source_search_requested || false,
                source_query: result.source_query || '',
                source_confidence: result.source_confidence || 0.0
            }
        };
    }
    
    async analyzeResearchQuery(query, conversationContext = null) {
        // Step 1: Get skeleton cards immediately
        const requestBody = {
            query,
            max_budget_dollars: 10.0,
            preferred_source_count: 15
        };
        
        // Include active project ID for query persistence
        const { projectStore } = await import('../state/project-store.js');
        if (projectStore.state.activeProjectId) {
            requestBody.project_id = projectStore.state.activeProjectId;
            console.log(`🔍 [API] Sending project_id ${requestBody.project_id} with search request`);
        }
        
        // Include conversation context if available to make research context-aware
        if (conversationContext && conversationContext.length > 0) {
            // Transform conversation objects to simple format expected by backend
            requestBody.conversation_context = conversationContext.map(msg => ({
                sender: msg.sender,
                content: msg.content
            }));
        }
        
        const response = await fetch(`${this.baseURL}/api/research/analyze`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(requestBody)
        });

        console.log(`🔬 Response status: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
            console.error(`🔬 API request failed: ${response.status} ${response.statusText}`);
            this._handle401(response);
            
            // Handle rate limiting specifically
            if (response.status === 429) {
                throw new Error("You've hit the research request limit. Please wait a few minutes and try again. This helps protect system integrity during high-load periods.");
            }
            
            throw new Error(`Research analysis failed: ${response.statusText}`);
        }

        const result = await response.json();
        
        // Step 2: If progressive flow, start polling for enriched results
        if (result.stage === 'skeleton' && result.cache_key) {
            console.log('🚀 Skeleton cards received, starting progressive enrichment...');
            
            // Start polling for enriched results in background
            this._pollForEnrichment(result.cache_key);
        }
        
        // Transform research response to match expected chat format
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
                    // Handle authentication - stop polling on 401
                    if (response.status === 401) {
                        console.log('🔐 401 Unauthorized during polling - triggering logout');
                        this.authService.clearToken(); // Trigger logout callbacks
                        return; // Stop polling silently (user will see toast from callback)
                    }
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
            this._handle401(response);
            throw new Error('Failed to clear conversation');
        }
        
        return await response.json();
    }

    async saveMessage(projectId, sender, content, messageData = null) {
        try {
            const response = await fetch(`${this.baseURL}/api/projects/${projectId}/messages`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({
                    sender,
                    content,
                    message_data: messageData
                })
            });
            
            if (!response.ok) {
                this._handle401(response);
                console.error('Failed to save message:', response.statusText);
                return null;
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error saving message:', error);
            return null;
        }
    }

    async getProjectMessages(projectId) {
        try {
            const response = await fetch(`${this.baseURL}/api/projects/${projectId}/messages`, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });
            
            if (!response.ok) {
                this._handle401(response);
                throw new Error('Failed to fetch messages');
            }
            
            return await response.json();
        } catch (error) {
            console.error('Error fetching messages:', error);
            throw error;
        }
    }

    async pollEnrichmentStatus(query, maxBudget, preferredSourceCount) {
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
            this._handle401(response);
            throw new Error(`Enrichment polling failed: ${response.statusText}`);
        }

        return await response.json();
    }

    async getFreshSourcePricing(sourceId) {
        const response = await fetch(`${this.baseURL}/api/sources/${sourceId}/pricing`, {
            method: 'GET',
            headers: this.getAuthHeaders()
        });
        
        if (!response.ok) {
            this._handle401(response);
            throw new Error('Failed to fetch source pricing');
        }
        
        return await response.json();
    }

    async unlockSource(sourceId, _price) {
        // _price is unused but retained for compatibility
        const userId = this.authService.getUserId();
        const idempotencyKey = generateIdempotencyKey(userId, sourceId);
        
        return await this._fetchWithRetry(`${this.baseURL}/api/sources/unlock-source`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                source_id: sourceId,
                idempotency_key: idempotencyKey
            })
        }, 'Source unlock failed');
    }

    async summarizeSource(sourceId, url, title, excerpt, licenseCost) {
        // Generate idempotency key for summary purchase
        const userId = this.authService.getUserId();
        const idempotencyKey = generateIdempotencyKey(userId, `summary_${sourceId}`);
        
        return await this._fetchWithRetry(`${this.baseURL}/api/sources/summarize`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify({
                source_id: sourceId,
                url: url,
                title: title,
                excerpt: excerpt,  // Tavily excerpt for paywall fallback
                license_cost: licenseCost,
                idempotency_key: idempotencyKey
            })
        }, 'Article summarization failed');
    }

    async getPricingQuote(query, outlineStructure = null) {
        const params = new URLSearchParams({
            query: query
        });
        
        if (outlineStructure) {
            params.append('outline_structure', JSON.stringify(outlineStructure));
        }
        
        try {
            const response = await this._fetchWithRetry(
                `${this.baseURL}/api/purchase/quote?${params.toString()}`,
                {
                    method: 'GET',
                    headers: this.getAuthHeaders()
                },
                'Failed to get pricing quote'
            );
            
            return response;
        } catch (error) {
            console.error('Error fetching pricing quote:', error);
            // Return fallback indicating quote is unavailable
            return {
                success: false,
                quote_unavailable: true,
                calculated_price: 0.50,  // Fallback estimate
                new_source_count: null,
                previous_source_count: null,
                total_source_count: null
            };
        }
    }

    async generateReport(query, selectedSources = null, outlineStructure = null) {
        // Generate stable idempotency key for this purchase attempt
        const userId = this.authService.getUserId();
        const sourceIds = selectedSources ? selectedSources.map(s => s.id).sort().join(',') : '';
        const idempotencySignature = `${userId}:${query}:${sourceIds}`;
        
        // Simple hash function for client-side idempotency key
        let hash = 0;
        for (let i = 0; i < idempotencySignature.length; i++) {
            const char = idempotencySignature.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        const idempotencyKey = `report_${userId}_${Math.abs(hash).toString(16)}`;
        
        const requestBody = {
            query,
            idempotency_key: idempotencyKey
        };
        
        // Include full source objects if provided (frontend is source of truth)
        if (selectedSources && selectedSources.length > 0) {
            requestBody.selected_sources = selectedSources;
        }
        
        // Include outline structure if provided
        if (outlineStructure && outlineStructure.sections && outlineStructure.sections.length > 0) {
            requestBody.outline_structure = outlineStructure;
            console.log(`📋 Using custom outline with ${outlineStructure.sections.length} sections for report generation`);
        }
        
        return await this._fetchWithRetry(`${this.baseURL}/api/purchase`, {
            method: 'POST',
            headers: this.getAuthHeaders(),
            body: JSON.stringify(requestBody)
        }, 'Report generation failed');
    }
    
    // Legacy alias for backward compatibility
    async purchaseTier(tierId, price, query = "Research Query", selectedSources = null, outlineStructure = null) {
        console.warn('⚠️ purchaseTier() is deprecated - use generateReport() instead');
        return this.generateReport(query, selectedSources, outlineStructure);
    }
    
    // Retry logic with exponential backoff
    async _fetchWithRetry(url, options, errorPrefix = 'Request failed') {
        for (let attempt = 1; attempt <= this.config.RETRY_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(url, options);
                
                // Handle 202 Accepted (purchase still processing) with inline retry
                if (response.status === 202) {
                    const data = await response.json();
                    const retryAfter = response.headers.get('Retry-After') || 2;
                    console.log(`⏳ Purchase processing (202). Retrying after ${retryAfter}s...`);
                    
                    // Wait and retry
                    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                    continue; // Retry the request
                }
                
                if (!response.ok) {
                    this._handle401(response);
                    
                    // Handle rate limiting specifically with user-friendly message
                    if (response.status === 429) {
                        throw new Error("You've hit the research request limit. Please wait a few minutes and try again. This helps protect system integrity during high-load periods.");
                    }
                    
                    // Handle schema validation errors with detailed logging
                    if (response.status === 422) {
                        const errorBody = await response.json();
                        console.warn("⚠️ Unlock schema validation error:", errorBody);
                        throw new Error(`${errorPrefix}: ${response.statusText}`);
                    }
                    
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
    
    async generateReport(query, selectedSources = null, outlineStructure = null) {
        try {
            console.log(`🔍 [API] generateReport called with:`, {
                query,
                selectedSourcesCount: selectedSources?.length || 0,
                outlineSections: outlineStructure?.sections?.length || 0
            });
            
            const requestBody = {
                query: query
            };
            
            // Include selected sources if provided (full objects, not just IDs)
            if (selectedSources && selectedSources.length > 0) {
                requestBody.selected_sources = selectedSources;
                console.log(`📊 Generating report with ${selectedSources.length} selected sources`);
            } else {
                console.warn(`⚠️ [API] No selectedSources provided! This will trigger legacy mode.`);
            }
            
            // Include outline structure if provided
            if (outlineStructure && outlineStructure.sections && outlineStructure.sections.length > 0) {
                requestBody.outline_structure = outlineStructure;
                console.log(`📋 Using custom outline with ${outlineStructure.sections.length} sections`);
            }
            
            const response = await fetch(`${this.baseURL}/api/research/generate-report`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                this._handle401(response);
                throw new Error(`Report generation failed: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result;
            
        } catch (error) {
            console.error('Error generating report:', error);
            throw error;
        }
    }
}