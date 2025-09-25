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
        console.log(`✅ SOURCE CARD: Main container created with class '${className}' and ID '${source.id}'`);

        // Source header with title and badges
        const header = this._createHeader(source);
        sourceCard.appendChild(header);

        // Rating (if available)
        if (source.rating || source.quality_score) {
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
        
        return sourceCard;
    }
    
    /**
     * Handle progressive enrichment updates
     */
    handleEnrichmentUpdate(enrichmentData) {
        const { cacheKey, sources } = enrichmentData;
        console.log(`🎨 Updating ${sources.length} cards with enriched content...`);
        
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
                if (enrichedSource.licensing_protocol || enrichedSource.unlock_price > 0) {
                const newLicenseBadge = this._createLicenseBadge(enrichedSource);
                newLicenseBadge.classList.add('badge-updated'); // Visual feedback
                badgesContainer.appendChild(newLicenseBadge);
            }
        }
        
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

        // License badge
        if (source.licensing_protocol || (source.unlock_price && source.unlock_price > 0)) {
            const licenseBadge = this._createLicenseBadge(source);
            badges.appendChild(licenseBadge);
        }

        return badges;
    }

    /**
     * Create license badge with HYBRID strategy:
     * - Tollbit: Real pricing when confirmed, otherwise no badge
     * - RSL/Cloudflare: Always "Coming Soon" for demo potential  
     * - Free sources: Show as FREE
     */
    _createLicenseBadge(source) {
        const badge = document.createElement('span');
        badge.className = 'license-badge';
        
        const protocol = source.licensing_protocol;
        const cost = source.unlock_price || source.licensing_cost || 0;
        
        // HYBRID BADGE STRATEGY
        if (protocol === 'tollbit' && cost > 0) {
            // Real Tollbit pricing confirmed
            badge.classList.add('license-paid');
            badge.textContent = `⚡ TOLLBIT $${Number(cost || 0).toFixed(2)}`;
            
        } else if (protocol === 'rsl' || this._shouldShowRSLDemo(source)) {
            // RSL demo badge for platform potential
            badge.classList.add('license-demo');
            badge.textContent = '🔒 RSL Coming Soon';
            
        } else if (protocol === 'cloudflare' || this._shouldShowCloudflareDemo(source)) {
            // Cloudflare demo badge for platform potential
            badge.classList.add('license-demo');
            badge.textContent = '☁️ Cloudflare Coming Soon';
            
        } else if (cost === 0) {
            // Free discovery content
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

        const score = source.rating || source.relevance_score || source.quality_score || 0;
        const maxStars = 5;
        const roundedScore = Math.round(score * 2) / 2; // Round to nearest 0.5
        
        // Create star elements with half-star support
        for (let i = 0; i < maxStars; i++) {
            const star = document.createElement('span');
            
            if (i < Math.floor(roundedScore)) {
                star.className = 'star filled';
                star.textContent = '★';
            } else if (i === Math.floor(roundedScore) && roundedScore % 1 === 0.5) {
                star.className = 'star half';
                star.textContent = '⭐'; // Half star emoji
            } else {
                star.className = 'star empty';
                star.textContent = '☆';
            }
            
            rating.appendChild(star);
        }

        // Rating text
        const ratingText = document.createElement('span');
        ratingText.className = 'rating-text';
        ratingText.textContent = `${Number(roundedScore || 0).toFixed(1)}/5`;
        rating.appendChild(ratingText);

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
            button.innerHTML = '📄 <span>Download</span>';
            const downloadHandler = () => this._handleDownload(source);
            button.addEventListener('click', downloadHandler);
            this.eventListeners.set(button, { type: 'click', handler: downloadHandler });
        } else {
            button.className = 'unlock-btn';
            const costText = cost > 0 ? ` $${Number(cost || 0).toFixed(2)}` : '';
            button.innerHTML = `🔓 <span>Unlock${costText}</span>`;
            const unlockHandler = () => this._handleUnlock(source);
            button.addEventListener('click', unlockHandler);
            this.eventListeners.set(button, { type: 'click', handler: unlockHandler });
        }
        
        return button;
    }
    
    /**
     * Update action button with fresh state data
     */
    _updateActionButton(cardElement, freshSource) {
        const actionBtn = cardElement.querySelector('.unlock-btn');
        if (!actionBtn || !freshSource) return;
        
        const cost = freshSource.unlock_price || 0;
        const isUnlocked = freshSource.is_unlocked || false;
        
        if (isUnlocked) {
            actionBtn.className = 'download-btn unlock-btn';
            actionBtn.innerHTML = '📄 <span>Download</span>';
        } else {
            actionBtn.className = 'unlock-btn';
            const costText = cost > 0 ? ` $${Number(cost || 0).toFixed(2)}` : '';
            actionBtn.innerHTML = `🔓 <span>Unlock${costText}</span>`;
        }
    }

    /**
     * Handle source unlock
     */
    async _handleUnlock(source) {
        try {
            // Dispatch event for app to handle
            const event = new CustomEvent('sourceUnlockRequested', {
                detail: { source }
            });
            document.dispatchEvent(event);
        } catch (error) {
            console.error('Failed to unlock source:', error);
        }
    }

    /**
     * Handle source download
     */
    async _handleDownload(source) {
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

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SourceCard;
}

// Global reference for backward compatibility
window.SourceCard = SourceCard;