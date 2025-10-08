/**
 * SourceCard Component
 * OWNER: Frontend team
 * SINGLE SOURCE OF TRUTH for all source card generation and interaction logic
 * 
 * This component encapsulates:
 * - Source card HTML generation
 * - Checkbox interaction logic  
 * - Selection state management
 * - Event handling and binding
 * 
 * DO NOT add source card logic to other JS files!
 */

class SourceCard {
    constructor(appState) {
        this.appState = appState;
        this.eventListeners = new Map(); // Track listeners for cleanup
        
        // Bind enrichment handler for proper cleanup
        this.handleEnrichmentUpdate = this.handleEnrichmentUpdate.bind(this);
        
        // Listen for progressive enrichment updates
        window.addEventListener('enrichmentComplete', this.handleEnrichmentUpdate);
    }
    
    /**
     * Cleanup method to remove event listeners
     */
    destroy() {
        window.removeEventListener('enrichmentComplete', this.handleEnrichmentUpdate);
        
        // Clean up all tracked event listeners
        this.eventListeners.forEach((listener, element) => {
            element.removeEventListener(listener.type, listener.handler);
        });
        this.eventListeners.clear();
    }

    /**
     * Create a source card element with all functionality
     * @param {Object} source - Source data object
     * @param {Object} options - Configuration options
     * @returns {HTMLElement} Complete source card element
     */
    create(source, options = {}) {
        console.log(`🎨 SOURCE CARD: create() called for source:`, source);
        console.log(`🎨 SOURCE CARD: options:`, options);
        
        // Defensive check for missing source.id
        if (!source || !source.id) {
            console.error('❌ SOURCE CARD: Invalid source object - missing ID:', source);
            const errorCard = document.createElement('div');
            errorCard.className = 'source-card error';
            errorCard.textContent = 'Invalid source data';
            return errorCard;
        }
        
        console.log(`✅ SOURCE CARD: Creating card for source ID: ${source.id}`);
        
        const {
            showCheckbox = true,
            showActions = true,
            className = 'source-card'
        } = options;

        console.log(`🎨 SOURCE CARD: Creating main card container...`);
        // Main card container
        const sourceCard = document.createElement('div');
        sourceCard.className = className;
        sourceCard.setAttribute('data-source-id', source.id);
        
        // Add basic inline styles as fallback
        sourceCard.style.cssText = `
            border: 1px solid #ddd; 
            padding: 16px; 
            margin: 8px 0; 
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;
        
        console.log(`✅ SOURCE CARD: Main container created with class '${className}' and ID '${source.id}'`);

        // Source header with title and badges
        const header = this._createHeader(source);
        sourceCard.appendChild(header);

        // Rating (if available)
        if (source.rating || source.quality_score || source.relevance_score) {
            const rating = this._createRating(source);
            sourceCard.appendChild(rating);
        }

        // Source excerpt
        if (source.excerpt || source.content_preview) {
            const excerpt = this._createExcerpt(source);
            sourceCard.appendChild(excerpt);
        }

        // Actions section (buttons + checkbox)
        if (showActions) {
            const actions = this._createActions(source, { showCheckbox });
            sourceCard.appendChild(actions);
        }

        // Add skeleton loading indicator if enrichment is pending
        if (source.unlock_price === 0 && !source.licensing_protocol) {
            sourceCard.classList.add('skeleton-loading');
        }
        
        // Set up delegated event handler for all button clicks
        const cardClickHandler = (e) => {
            const actionBtn = e.target.closest('[data-action]');
            if (!actionBtn) return;
            
            const action = actionBtn.dataset.action;
            const sourceId = sourceCard.dataset.sourceId;
            
            if (action === 'unlock') {
                e.preventDefault();
                this._handleUnlock(sourceId);
            } else if (action === 'download') {
                e.preventDefault();
                this._handleDownload(sourceId);
            }
            // view-external opens naturally via href, no handler needed
        };
        
        sourceCard.addEventListener('click', cardClickHandler);
        this.eventListeners.set(sourceCard, { type: 'click', handler: cardClickHandler });
        console.log('🎯 EVENT DELEGATION: Attached single click handler to card:', source.id);
        
        return sourceCard;
    }
    
    /**
     * Handle progressive enrichment updates
     */
    handleEnrichmentUpdate(event) {
        console.log('🔍 Enrichment event received:', event);
        
        if (!event || !event.detail) {
            console.error('❌ No enrichment event detail received');
            return;
        }
        
        const { cacheKey, sources } = event.detail;
        
        if (!sources || !Array.isArray(sources)) {
            console.error('❌ Invalid sources data:', event.detail);
            return;
        }
        
        console.log(`🎨 Updating ${sources.length} cards with enriched content...`);
        
        // Update appState with enriched source data
        const currentData = this.appState.getCurrentResearchData();
        if (currentData && currentData.sources) {
            currentData.sources.forEach(existing => {
                const enriched = sources.find(s => s.id === existing.id);
                if (enriched) {
                    Object.assign(existing, enriched);
                }
            });
            this.appState.setCurrentResearchData(currentData);
            console.log('✅ AppState updated with enriched pricing data');
        }
        
        // Mark enrichment as complete (Layer 1 & 2 safety)
        this.appState.setEnrichmentStatus('complete');
        console.log('✅ Enrichment status set to complete');
        
        sources.forEach(enrichedSource => {
            this.updateCard(enrichedSource);
        });
    }
    
    /**
     * Update an existing source card with enriched data using diff-based patching
     */
    updateCard(enrichedSource) {
        // Defensive check for missing source.id
        if (!enrichedSource || !enrichedSource.id) {
            console.error('Invalid enriched source - missing ID:', enrichedSource);
            return;
        }
        
        const cardElement = document.querySelector(`[data-source-id="${enrichedSource.id}"]`);
        if (!cardElement) {
            console.log(`⚠️ Card not found for source ID: ${enrichedSource.id}`);
            return;
        }
        
        console.log(`🔄 Updating card: ${enrichedSource.title}`);
        
        // Batch DOM updates to prevent flickering
        requestAnimationFrame(() => {
            // Remove skeleton loading state
            cardElement.classList.remove('skeleton-loading');
            
            // Diff-based title update
            const titleElement = cardElement.querySelector('.source-title');
            if (titleElement && enrichedSource.title && enrichedSource.title !== titleElement.textContent) {
                titleElement.textContent = enrichedSource.title;
                titleElement.classList.add('content-updated'); // Visual feedback
            }
            
            // Diff-based excerpt update
            const excerptElement = cardElement.querySelector('.source-excerpt');
            if (excerptElement && enrichedSource.excerpt && enrichedSource.excerpt !== excerptElement.textContent) {
                excerptElement.textContent = enrichedSource.excerpt;
                excerptElement.classList.add('content-updated'); // Visual feedback
            }
            
            // Update action button with fresh state
            this._updateActionButton(cardElement, enrichedSource);
            
            // Update badges with new licensing information
            const badgesContainer = cardElement.querySelector('.source-badges');
            if (badgesContainer) {
                // Remove old license badge
                const oldLicenseBadge = badgesContainer.querySelector('.license-badge');
                if (oldLicenseBadge) {
                    oldLicenseBadge.remove();
                }
                
                // Add new license badge with enriched data
                const newLicenseBadge = this._createLicenseBadge(enrichedSource);
                newLicenseBadge.classList.add('badge-updated'); // Visual feedback
                badgesContainer.appendChild(newLicenseBadge);
            }
        });
        
        console.log(`✅ Card updated: ${enrichedSource.title}`);
    }

    /**
     * Create source header with title, meta, and badges
     */
    _createHeader(source) {
        const header = document.createElement('div');
        header.className = 'source-header';

        // Left side: title and meta
        const leftSide = document.createElement('div');
        
        const title = document.createElement('h4');
        title.className = 'source-title';
        title.textContent = source.title || 'Untitled Source';
        
        const meta = document.createElement('p');
        meta.className = 'source-meta';
        meta.textContent = source.domain || source.url || '';
        
        leftSide.appendChild(title);
        leftSide.appendChild(meta);

        // Right side: badges
        const badges = this._createBadges(source);
        
        header.appendChild(leftSide);
        header.appendChild(badges);

        return header;
    }

    /**
     * Create badges for source type and licensing
     */
    _createBadges(source) {
        const badges = document.createElement('div');
        badges.className = 'source-badges';

        // Source type badge
        if (source.source_type || source.type) {
            const typeBadge = document.createElement('span');
            typeBadge.className = 'source-type-badge';
            typeBadge.textContent = source.source_type || source.type;
            badges.appendChild(typeBadge);
        }

        // License badge - ALWAYS show a badge (Free, Coming Soon, or Paid)
        const licenseBadge = this._createLicenseBadge(source);
        badges.appendChild(licenseBadge);

        return badges;
    }

    /**
     * Create license badge with HYBRID strategy:
     * - Tollbit: Real pricing when confirmed, otherwise no badge
     * - RSL/Cloudflare: Always "Coming Soon" for demo potential  
     * - Free sources: Show as FREE
     * - Enrichment pending: Show "⏳ PRICING..." (Layer 1 safety)
     */
    _createLicenseBadge(source) {
        const badge = document.createElement('span');
        badge.className = 'license-badge';
        
        const protocol = source.licensing_protocol;
        const cost = source.unlock_price || source.licensing_cost || 0;
        const isEnrichmentPending = this.appState.isEnrichmentPending();
        
        // LAYER 1 SAFETY: Show loading state if enrichment is pending and no pricing yet
        if (isEnrichmentPending && cost === 0 && !protocol) {
            badge.classList.add('license-loading');
            badge.textContent = '⏳ PRICING...';
            badge.dataset.enrichmentPending = 'true';
            return badge;
        }
        
        // HYBRID BADGE STRATEGY
        if (protocol && protocol.toLowerCase() === 'tollbit' && cost > 0) {
            // Real Tollbit pricing confirmed
            badge.classList.add('license-paid');
            badge.textContent = `⚡ TOLLBIT $${Number(cost || 0).toFixed(2)}`;
            
        } else if (protocol && protocol.toLowerCase() === 'rsl' || this._shouldShowRSLDemo(source)) {
            // RSL demo badge for platform potential
            badge.classList.add('license-demo');
            badge.textContent = '🔒 RSL Coming Soon';
            
        } else if (protocol && protocol.toLowerCase() === 'cloudflare' || this._shouldShowCloudflareDemo(source)) {
            // Cloudflare demo badge for platform potential
            badge.classList.add('license-demo');
            badge.textContent = '☁️ Cloudflare Coming Soon';
            
        } else if (cost === 0) {
            // Free discovery content (only show if enrichment is complete)
            badge.classList.add('license-free');
            badge.textContent = 'FREE DISCOVERY';
            
        } else {
            // Loading state during skeleton phase
            badge.classList.add('license-loading');
            badge.textContent = '⏳ Checking licensing...';
        }

        return badge;
    }
    
    /**
     * Determine if source should show RSL demo badge
     */
    _shouldShowRSLDemo(source) {
        // Show RSL demo for academic/research domains
        const domain = source.domain || '';
        return domain.endsWith('.edu') || domain.endsWith('.edu/') ||
               /\b(research|journal|academic)\b/i.test(domain);
    }
    
    /**
     * Determine if source should show Cloudflare demo badge  
     */
    _shouldShowCloudflareDemo(source) {
        // Show Cloudflare demo for major publisher domains  
        const domain = source.domain || '';
        return /\b(nytimes|wsj|economist|reuters)\b/i.test(domain);
    }


    /**
     * Create rating display with half-star support
     */
    _createRating(source) {
        const rating = document.createElement('div');
        rating.className = 'source-rating';

        // Get relevance score and normalize to 1-5 scale with 1 decimal precision
        const rawScore = source.relevance_score || source.rating || source.quality_score;
        let normalizedScore;
        
        if (rawScore === null || rawScore === undefined) {
            normalizedScore = 1.0; // Default to 1.0 if no score
        } else if (rawScore <= 1.0) {
            // Assume 0-1 scale, convert to 1-5 with decimals  
            normalizedScore = Math.max(1.0, rawScore * 5);
        } else if (rawScore <= 5.0) {
            // Assume already 0-5 scale
            normalizedScore = Math.max(1.0, rawScore);
        } else {
            // Assume 0-100 scale, convert to 1-5
            normalizedScore = Math.max(1.0, (rawScore / 100) * 5);
        }
        
        const maxStars = 5;
        const filledStars = Math.floor(normalizedScore);
        const hasPartialStar = (normalizedScore % 1) >= 0.3; // Show partial star if >= 0.3
        
        // Add hover tooltip with decimal precision
        rating.title = `Relevance: ${normalizedScore.toFixed(1)}/5`;
        
        // Create star elements with partial star support
        for (let i = 0; i < maxStars; i++) {
            const star = document.createElement('span');
            
            if (i < filledStars) {
                star.className = 'star filled';
                star.textContent = '⭐️';
            } else if (i === filledStars && hasPartialStar) {
                star.className = 'star partial';
                star.textContent = '⭐'; // Different emoji for partial
            } else {
                star.className = 'star empty';
                star.textContent = '☆';
            }
            
            rating.appendChild(star);
        }
        
        // Add numeric rating display
        const ratingNumber = document.createElement('span');
        ratingNumber.className = 'rating-number';
        ratingNumber.textContent = `${normalizedScore.toFixed(1)}`;
        rating.appendChild(ratingNumber);

        return rating;
    }

    /**
     * Create source excerpt
     */
    _createExcerpt(source) {
        const excerpt = document.createElement('p');
        excerpt.className = 'source-excerpt';
        excerpt.textContent = source.excerpt || source.content_preview || '';
        return excerpt;
    }

    /**
     * Create actions section with buttons and checkbox
     */
    _createActions(source, options = {}) {
        const { showCheckbox = true } = options;
        
        const actions = document.createElement('div');
        actions.className = 'source-actions';

        // Left side: checkbox (if enabled)
        const leftSide = document.createElement('div');
        leftSide.className = 'source-actions__left';
        
        if (showCheckbox) {
            const selection = this._createCheckbox(source);
            leftSide.appendChild(selection);
        }

        // Right side: action buttons
        const rightSide = document.createElement('div');
        rightSide.className = 'source-actions__right';

        // View Source button
        if (source.url) {
            const viewBtn = this._createViewButton(source);
            rightSide.appendChild(viewBtn);
        }

        // Unlock/Download button
        const actionBtn = this._createActionButton(source);
        rightSide.appendChild(actionBtn);

        actions.appendChild(leftSide);
        actions.appendChild(rightSide);

        return actions;
    }

    /**
     * Create checkbox for report selection with proper event cleanup
     */
    _createCheckbox(source) {
        const selection = document.createElement('div');
        selection.className = 'source-selection';
        
        const label = document.createElement('label');
        label.className = 'source-selection-label';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'source-selection-checkbox';
        
        // Use appState as single source of truth (eliminate state drift)
        checkbox.checked = this.appState?.isSourceSelected(source.id) || false;
        
        // Create stable event handler
        const changeHandler = (e) => {
            this._handleSelectionChange(source, e.target.checked);
        };
        
        checkbox.addEventListener('change', changeHandler);
        
        // Track listener for cleanup
        this.eventListeners.set(checkbox, {
            type: 'change',
            handler: changeHandler
        });
        
        const text = document.createElement('span');
        text.className = 'selection-text';
        text.textContent = 'Add to Report';
        
        label.appendChild(checkbox);
        label.appendChild(text);
        selection.appendChild(label);
        
        return selection;
    }

    /**
     * Handle checkbox selection change - sync with appState only
     */
    _handleSelectionChange(source, isSelected) {
        if (!source || !source.id) {
            console.error('Invalid source in selection change:', source);
            return;
        }
        
        const sourceCard = document.querySelector(`[data-source-id="${source.id}"]`);
        
        if (isSelected) {
            if (sourceCard) {
                sourceCard.classList.add('selected');
            }
            // Use appState as single source of truth
            if (this.appState?.toggleSourceSelection) {
                this.appState.toggleSourceSelection(source.id, source);
            }
        } else {
            if (sourceCard) {
                sourceCard.classList.remove('selected');
            }
            // Remove from appState
            if (this.appState?.removeSelectedSource) {
                this.appState.removeSelectedSource(source.id);
            }
        }

        // Dispatch custom event for other components
        const event = new CustomEvent('sourceSelectionChanged', {
            detail: { 
                source, 
                isSelected, 
                totalSelected: this.appState?.getSelectedSourcesCount() || 0
            }
        });
        document.dispatchEvent(event);
    }

    /**
     * Create view source button
     */
    _createViewButton(source) {
        const button = document.createElement('a');
        button.className = 'view-source-btn';
        button.href = source.url;
        button.target = '_blank';
        button.rel = 'noopener noreferrer';
        button.setAttribute('data-action', 'view-external');
        
        const icon = document.createElement('span');
        icon.textContent = '🔗';
        
        const text = document.createElement('span');
        text.textContent = 'View Source';
        
        button.appendChild(icon);
        button.appendChild(text);
        
        return button;
    }

    /**
     * Create unlock/download action button with fresh state
     */
    _createActionButton(source) {
        const cost = source.unlock_price || 0;
        const isUnlocked = source.is_unlocked || false;
        
        const button = document.createElement('button');
        
        if (isUnlocked) {
            button.className = 'download-btn unlock-btn';
            button.setAttribute('data-action', 'download');
            button.innerHTML = '📄 <span>View Source</span>';
        } else {
            button.className = 'unlock-btn';
            button.setAttribute('data-action', 'unlock');
            const costText = cost > 0 ? ` $${Number(cost || 0).toFixed(2)}` : '';
            button.innerHTML = `🔓 <span>Unlock${costText}</span>`;
        }
        
        return button;
    }
    
    /**
     * Update action button with fresh state data
     * Uses event delegation so button can be safely updated without losing listeners
     */
    _updateActionButton(cardElement, freshSource) {
        const actionBtn = cardElement.querySelector('.unlock-btn');
        if (!actionBtn || !freshSource) return;
        
        const cost = freshSource.unlock_price || 0;
        const isUnlocked = freshSource.is_unlocked || false;
        
        // Find the span element (text container)
        const textSpan = actionBtn.querySelector('span');
        if (!textSpan) return; // Button structure not as expected
        
        if (isUnlocked) {
            actionBtn.className = 'download-btn unlock-btn';
            actionBtn.setAttribute('data-action', 'download');
            // Update only text content, not innerHTML
            actionBtn.firstChild.textContent = '📄 ';
            textSpan.textContent = 'View Source';
        } else {
            actionBtn.className = 'unlock-btn';
            actionBtn.setAttribute('data-action', 'unlock');
            const costText = cost > 0 ? ` $${Number(cost || 0).toFixed(2)}` : '';
            // Update only text content, not innerHTML
            actionBtn.firstChild.textContent = '🔓 ';
            textSpan.textContent = `Unlock${costText}`;
        }
    }

    /**
     * Handle source unlock
     */
    async _handleUnlock(sourceId) {
        console.log('🔓 UNLOCK: Button clicked! SourceID:', sourceId);
        
        // Lookup source from appState
        const researchData = this.appState?.getCurrentResearchData();
        if (!researchData || !researchData.sources) {
            console.error('🔓 UNLOCK: No research data available');
            return;
        }
        
        const source = researchData.sources.find(s => s.id === sourceId);
        if (!source) {
            console.error('🔓 UNLOCK: Source not found for ID:', sourceId);
            return;
        }
        
        console.log('🔓 UNLOCK: Source found:', source.title, 'Price:', source.unlock_price);
        
        try {
            console.log('🔓 UNLOCK: Creating CustomEvent sourceUnlockRequested');
            // Dispatch event for app to handle
            const event = new CustomEvent('sourceUnlockRequested', {
                detail: { source }
            });
            console.log('🔓 UNLOCK: Dispatching event with detail:', event.detail);
            document.dispatchEvent(event);
            console.log('🔓 UNLOCK: Event dispatched successfully');
        } catch (error) {
            console.error('🔓 UNLOCK: ERROR in _handleUnlock:', error);
        }
    }

    /**
     * Handle source download
     */
    async _handleDownload(sourceId) {
        // Lookup source from appState
        const researchData = this.appState?.getCurrentResearchData();
        if (!researchData || !researchData.sources) {
            console.error('Download: No research data available');
            return;
        }
        
        const source = researchData.sources.find(s => s.id === sourceId);
        if (!source) {
            console.error('Download: Source not found for ID:', sourceId);
            return;
        }
        
        try {
            // Dispatch event for app to handle
            const event = new CustomEvent('sourceDownloadRequested', {
                detail: { source }
            });
            document.dispatchEvent(event);
        } catch (error) {
            console.error('Failed to download source:', error);
        }
    }

    /**
     * Update all checkboxes to match appState (single source of truth)
     */
    updateSelectionStates() {
        const checkboxes = document.querySelectorAll('.source-selection-checkbox');
        
        checkboxes.forEach(checkbox => {
            const sourceCard = checkbox.closest('[data-source-id]');
            if (sourceCard) {
                const sourceId = sourceCard.getAttribute('data-source-id');
                const isSelected = this.appState?.isSourceSelected(sourceId) || false;
                
                // Prevent event firing during programmatic update
                const currentHandler = this.eventListeners.get(checkbox)?.handler;
                if (currentHandler) {
                    checkbox.removeEventListener('change', currentHandler);
                }
                
                checkbox.checked = isSelected;
                
                if (currentHandler) {
                    checkbox.addEventListener('change', currentHandler);
                }
                
                if (isSelected) {
                    sourceCard.classList.add('selected');
                } else {
                    sourceCard.classList.remove('selected');
                }
            }
        });
    }

    /**
     * Get all currently selected sources from appState
     */
    getSelectedSources() {
        return this.appState?.getSelectedSources() || [];
    }

    /**
     * Clear all selections via appState
     */
    clearSelections() {
        if (this.appState?.clearConversation) {
            this.appState.clearConversation();
        }
        this.updateSelectionStates();
    }

    /**
     * Render multiple source cards with smart updates to preserve scroll position
     */
    renderSourceGrid(sources, containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`Container not found: ${containerId}`);
            return;
        }

        // Preserve scroll position
        const scrollTop = container.scrollTop;
        
        // Smart update: only clear if sources are completely different
        const existingCards = container.querySelectorAll('[data-source-id]');
        const existingIds = Array.from(existingCards).map(card => card.getAttribute('data-source-id'));
        const newIds = sources.map(source => source.id).filter(Boolean);
        
        const needsFullRender = !this._arraysEqual(existingIds, newIds);
        
        if (needsFullRender) {
            // Full re-render needed
            container.innerHTML = '';
            
            // Create source cards
            sources.forEach(source => {
                if (source && source.id) {
                    const card = this.create(source, options);
                    container.appendChild(card);
                }
            });
            
            // Restore scroll position
            container.scrollTop = scrollTop;
        } else {
            // Update existing cards in place
            sources.forEach(source => {
                if (source && source.id) {
                    this.updateCard(source);
                }
            });
        }
    }
    
    /**
     * Helper to compare arrays for equality
     */
    _arraysEqual(a, b) {
        return a.length === b.length && a.every((val, i) => val === b[i]);
    }
}

// Ensure global availability immediately
window.SourceCard = SourceCard;

// Also expose for modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SourceCard;
}

// Dispatch ready event for modules that need to wait
document.dispatchEvent(new CustomEvent('SourceCardReady'));