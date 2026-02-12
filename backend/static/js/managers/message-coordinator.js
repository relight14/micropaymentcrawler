import { MessageRenderer } from '../components/message-renderer.js';
import { analytics } from '../utils/analytics.js';
import { AppEvents, EVENT_TYPES } from '../utils/event-bus.js';

export class MessageCoordinator {
    constructor({ appState, apiService, authService, uiManager, toastManager, sourceManager }) {
        this.appState = appState;
        this.apiService = apiService;
        this.authService = authService;
        this.uiManager = uiManager;
        this.toastManager = toastManager;
        this.sourceManager = sourceManager;
        
        // Report/Enrichment Status State Machine
        // States: idle → pricing → generating → complete → error
        this.reportStatus = 'idle';
        
        // Shared SourceCard instance for building interactive source cards
        // Singleton pattern prevents accumulating global enrichmentComplete listeners
        this._sourceCardFactory = null;
    }
    
    /**
     * Get or create the shared SourceCard factory
     * Lazy initialization prevents issues when SourceCard isn't loaded yet
     * @private
     * @returns {SourceCard} Shared SourceCard instance
     */
    _getSourceCardFactory() {
        if (!this._sourceCardFactory && window.SourceCard) {
            this._sourceCardFactory = new window.SourceCard(this.appState);
        }
        return this._sourceCardFactory;
    }
    
    /**
     * Set report/enrichment status with event emission
     * @param {string} status - 'idle' | 'pricing' | 'generating' | 'complete' | 'error'
     */
    setReportStatus(status) {
        const validStates = ['idle', 'pricing', 'generating', 'complete', 'error'];
        if (!validStates.includes(status)) {
            console.warn(`Invalid report status: ${status}`);
            return;
        }
        
        const oldStatus = this.reportStatus;
        this.reportStatus = status;
        
        // Emit event for subscribers
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.REPORT_STATUS_CHANGED, {
            detail: {
                oldStatus,
                newStatus: status
            }
        }));
        
        console.log(`📊 Report status: ${oldStatus} → ${status}`);
    }
    
    /**
     * Get current report status
     */
    getReportStatus() {
        return this.reportStatus;
    }
    
    /**
     * Check if report/pricing is pending
     */
    isReportPending() {
        return this.reportStatus === 'pricing' || this.reportStatus === 'generating';
    }
    
    /**
     * Sync status from backend enrichment_status
     * Maps backend values to frontend state machine
     */
    syncStatusFromBackend(backendStatus) {
        const statusMap = {
            'idle': 'idle',
            'processing': 'pricing',  // Backend enrichment = frontend pricing
            'generating': 'generating',  // Backend report generation
            'ready': 'complete',
            'complete': 'complete',
            'error': 'error',
            'failed': 'error'
        };
        
        const mappedStatus = statusMap[backendStatus] || 'idle';
        this.setReportStatus(mappedStatus);
    }

    /**
     * Build a message DOM element without appending to DOM
     * Used for off-DOM rendering (DocumentFragment batching)
     * @param {Object} messageRecord - Message from database/state
     * @param {Object} options - Build options
     * @returns {HTMLElement} - Message DOM element ready to append
     */
    buildMessageElement(messageRecord, options = {}) {
        // Normalize message structure
        const metadata = messageRecord.message_data?.metadata || messageRecord.metadata || null;
        const content = messageRecord.content;
        const sender = messageRecord.sender;
        
        // Special handling for source cards: recreate with live event listeners
        if (metadata?.type === 'source_cards' && metadata?.sources?.length > 0) {
            const interactiveContent = this._buildInteractiveSourceCards(metadata.sources);
            
            const message = {
                id: messageRecord.id,
                sender,
                content: interactiveContent,
                metadata,
                timestamp: messageRecord.timestamp || new Date()
            };
            
            return MessageRenderer.createMessageElement(message);
        }
        
        // Parse HTML content for UI rendering
        const uiContent = MessageRenderer.parseHtml(content);
        
        // Create normalized message object for renderer
        const message = {
            id: messageRecord.id,
            sender,
            content: uiContent,
            metadata,
            timestamp: messageRecord.timestamp || new Date()
        };
        
        // Create and return DOM element without appending
        return MessageRenderer.createMessageElement(message);
    }
    
    /**
     * Build interactive source cards with live event listeners
     * @private
     * @param {Array} sources - Array of source objects
     * @returns {HTMLElement} - Container with interactive source cards
     */
    _buildInteractiveSourceCards(sources) {
        // Get shared SourceCard factory (prevents duplicate global listeners)
        const sourceCardFactory = this._getSourceCardFactory();
        
        if (!sourceCardFactory) {
            console.error('❌ SourceCard component not available');
            const errorDiv = document.createElement('div');
            errorDiv.textContent = 'Error: Unable to load source cards';
            return errorDiv;
        }
        
        // Clean up any stale event listeners from previous project loads
        sourceCardFactory.cleanupDetachedListeners();
        
        // Create the DOM structure that CSS expects
        const container = document.createElement('div');
        container.className = 'sources-preview-section';
        
        // Create compact header
        const header = document.createElement('div');
        header.className = 'preview-header';
        
        const title = document.createElement('h3');
        title.textContent = `📄 ${sources.length} Sources Found`;
        
        const subtitle = document.createElement('p');
        subtitle.textContent = 'Select sources to add to your outline';
        
        header.appendChild(title);
        header.appendChild(subtitle);
        container.appendChild(header);
        
        // Add filter chips for source types
        const filterSection = this._createSourceTypeFilters(sources);
        container.appendChild(filterSection);
        
        // Create individual source cards with live event listeners
        sources.forEach((source) => {
            const sourceCard = sourceCardFactory.create(source, {
                showCheckbox: true,
                showActions: true
            });
            container.appendChild(sourceCard);
        });
        
        // Return the live container with event listeners intact
        return container;
    }
    
    /**
     * Create source type filter chips
     * @private
     * @param {Array} sources - Array of source objects
     * @returns {HTMLElement} - Filter section element
     */
    _createSourceTypeFilters(sources) {
        const filterSection = document.createElement('div');
        filterSection.className = 'source-type-filters';
        
        // Count sources by type
        const typeCounts = {
            'academic': 0,
            'journalism': 0,
            'business': 0,
            'government': 0
        };
        
        sources.forEach(source => {
            const type = source.source_type || 'journalism';
            if (typeCounts.hasOwnProperty(type)) {
                typeCounts[type]++;
            }
        });
        
        // Filter label
        const label = document.createElement('span');
        label.className = 'filter-label';
        label.textContent = 'Filter:';
        filterSection.appendChild(label);
        
        // Create filter chips with emojis and counts
        const filterTypes = [
            { type: 'academic', emoji: '🎓', label: 'Academic' },
            { type: 'journalism', emoji: '📰', label: 'Journalism' },
            { type: 'business', emoji: '💼', label: 'Business' },
            { type: 'government', emoji: '🏛️', label: 'Government' }
        ];
        
        filterTypes.forEach(({ type, emoji, label }) => {
            const count = typeCounts[type];
            if (count === 0) return; // Skip if no sources of this type
            
            const chip = document.createElement('button');
            chip.className = 'filter-chip';
            chip.setAttribute('data-filter-type', type);
            chip.innerHTML = `${emoji} ${label} <span class="count">${count}</span>`;
            
            // Add click handler for filtering
            chip.addEventListener('click', () => {
                this._filterSourcesByType(type, chip);
            });
            
            filterSection.appendChild(chip);
        });
        
        return filterSection;
    }
    
    /**
     * Filter source cards by type
     * @private
     * @param {string} filterType - The source type to filter by
     * @param {HTMLElement} clickedChip - The filter chip that was clicked
     */
    _filterSourcesByType(filterType, clickedChip) {
        const container = clickedChip.closest('.sources-preview-section');
        if (!container) return;
        
        const sourceCards = container.querySelectorAll('.source-card');
        const filterChips = container.querySelectorAll('.filter-chip');
        
        // Toggle active state
        const isActive = clickedChip.classList.contains('active');
        
        if (isActive) {
            // Deactivate filter - show all cards
            clickedChip.classList.remove('active');
            sourceCards.forEach(card => card.style.display = '');
        } else {
            // Deactivate all other chips
            filterChips.forEach(chip => chip.classList.remove('active'));
            
            // Activate clicked chip
            clickedChip.classList.add('active');
            
            // Show only matching cards
            sourceCards.forEach(card => {
                const cardType = card.getAttribute('data-source-type');
                card.style.display = cardType === filterType ? '' : 'none';
            });
        }
    }

    /**
     * Restore a single message from persistence
     * SINGLE SOURCE OF TRUTH for rendering persisted messages
     * @param {Object} messageRecord - Message from database/state
     * @param {Object} options - Restoration options
     * @param {boolean} options.skipPersist - Skip re-saving to AppState (for project loads)
     * @returns {Object} - Normalized message object
     */
    restoreMessage(messageRecord, options = {}) {
        const { skipPersist = false } = options;
        
        // Normalize message structure
        const metadata = messageRecord.message_data?.metadata || messageRecord.metadata || null;
        const content = messageRecord.content;
        const sender = messageRecord.sender;
        
        // Special handling for source cards: recreate with live event listeners
        let uiContent;
        if (metadata?.type === 'source_cards' && metadata?.sources?.length > 0) {
            uiContent = this._buildInteractiveSourceCards(metadata.sources);
        } else {
            // Parse HTML content for UI rendering using centralized method
            uiContent = MessageRenderer.parseHtml(content);
        }
        
        // Create normalized message object
        const message = {
            id: messageRecord.id,
            sender,
            content: uiContent,  // Interactive DOM for source cards, parsed DOM for others
            metadata,
            timestamp: messageRecord.timestamp
        };
        
        // Add to UI through proper pipeline: MessageCoordinator → UIManager → MessageRenderer
        this.uiManager.addMessageToChat(message);
        
        return message;
    }

    /**
     * Restore all messages from conversation history
     * Used when switching modes (Chat ↔ Research)
     */
    restoreMessages() {
        const messagesContainer = document.getElementById('messagesContainer');
        
        const reportBuilder = messagesContainer.querySelector('.report-builder-interface');
        if (reportBuilder) {
            reportBuilder.remove();
        }
        
        messagesContainer.innerHTML = '';
        
        const conversationHistory = this.appState.getConversationHistory();
        
        conversationHistory.forEach((message) => {
            this.restoreMessage(message, { skipPersist: true });
        });
    }

    showLoadingMessage(message) {
        const messagesContainer = document.getElementById('messagesContainer');
        
        const loadingMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: message,
            timestamp: new Date(),
            variant: 'loading'
        });
        
        messagesContainer.appendChild(loadingMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        return loadingMessage;
    }

    showProgressiveLoading() {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Transition to 'generating' state when report generation starts
        this.setReportStatus('generating');
        
        const loadingMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: '📊 Compiling sources...',
            timestamp: new Date(),
            variant: 'loading'
        });
        
        messagesContainer.appendChild(loadingMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        const steps = [
            { delay: 0, text: '📊 Compiling sources...' },
            { delay: 5000, text: '🔍 Analyzing content...' },
            { delay: 10000, text: '✍️ Building your report...' }
        ];
        
        const timers = [];
        
        steps.forEach((step, index) => {
            if (index === 0) return;
            
            const timer = setTimeout(() => {
                const messageText = loadingMessage.querySelector('.message__loading-text');
                if (messageText) {
                    messageText.textContent = step.text;
                }
            }, step.delay);
            
            timers.push(timer);
        });
        
        loadingMessage._progressTimers = timers;
        
        return loadingMessage;
    }

    removeLoading(element) {
        if (element && element.parentNode) {
            if (element._progressTimers) {
                element._progressTimers.forEach(timer => clearTimeout(timer));
            }
            element.remove();
        }
    }

    createFeedback(sources) {
        const feedbackContainer = document.createElement('div');
        feedbackContainer.className = 'feedback-section';
        feedbackContainer.style.cssText = 'margin-top: 20px; padding: 16px; background: var(--surface-secondary, #f5f5f5); border-radius: 8px; text-align: center;';
        
        const feedbackText = document.createElement('p');
        feedbackText.textContent = 'How helpful are these sources?';
        feedbackText.style.cssText = 'margin: 0 0 12px 0; color: var(--text-primary, #1a1a1a); font-weight: 500; filter: contrast(1.2);';
        
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 12px; justify-content: center; align-items: center;';
        
        const thumbsUpBtn = document.createElement('button');
        thumbsUpBtn.className = 'feedback-btn feedback-up';
        thumbsUpBtn.innerHTML = '👍 Helpful';
        thumbsUpBtn.style.cssText = 'padding: 8px 20px; border: 2px solid var(--primary, #4A90E2); background: var(--surface-primary, white); color: var(--primary, #4A90E2); border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s;';
        
        const thumbsDownBtn = document.createElement('button');
        thumbsDownBtn.className = 'feedback-btn feedback-down';
        thumbsDownBtn.innerHTML = '👎 Not helpful';
        thumbsDownBtn.style.cssText = 'padding: 8px 20px; border: 2px solid var(--text-secondary, #666); background: var(--surface-primary, white); color: var(--text-secondary, #666); border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.2s;';
        
        feedbackContainer.dataset.query = this.appState.getCurrentQuery() || '';
        feedbackContainer.dataset.sourceIds = JSON.stringify(sources.map(s => s.id));
        feedbackContainer.dataset.mode = this.appState.getMode();
        
        buttonContainer.appendChild(thumbsUpBtn);
        buttonContainer.appendChild(thumbsDownBtn);
        feedbackContainer.appendChild(feedbackText);
        feedbackContainer.appendChild(buttonContainer);
        
        return feedbackContainer;
    }

    async submitFeedback(query, sourceIds, rating, mode, feedbackSection) {
        try {
            // Track feedback
            analytics.trackFeedback(rating, mode);
            
            const token = this.authService.getToken();
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const requestBody = {
                query: query,
                source_ids: sourceIds,
                rating: rating,
                mode: mode
            };
            
            const response = await fetch('/api/research/feedback', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to submit feedback: ${response.status} - ${errorText}`);
            }
            
            const result = await response.json();
            
            feedbackSection.dataset.submitted = 'true';
            
            const feedbackText = feedbackSection.querySelector('p');
            if (feedbackText) {
                feedbackText.textContent = result.message || 'Thank you for your feedback!';
            }
            
            const buttonContainer = feedbackSection.querySelector('div');
            if (buttonContainer) {
                buttonContainer.style.display = 'none';
            }
            
            this.toastManager.show('✅ ' + (result.message || 'Feedback submitted!'), 'success', 3000);
            
        } catch (error) {
            console.error('❌ Feedback submission error:', error);
            this.toastManager.show('Failed to submit feedback. Please try again.', 'error', 3000);
        }
    }

    async pollForEnrichment(query) {
        if (!query) return;
        
        let attempts = 0;
        const maxAttempts = 6;
        
        const pollInterval = setInterval(async () => {
            attempts++;
            
            try {
                const result = await this.apiService.pollEnrichmentStatus(query, 10.0, 15);
                
                if (!result.enrichment_needed || result.enrichment_status === 'complete') {
                    this.sourceManager.updateCards(result.sources);
                    clearInterval(pollInterval);
                    return;
                }
                
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    console.log('Stopped polling for enriched results after max attempts');
                }
                
            } catch (error) {
                console.error('Error polling for enriched results:', error);
                clearInterval(pollInterval);
            }
        }, 5000);
    }
}
