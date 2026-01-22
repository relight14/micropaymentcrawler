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
    constructor(appState, projectStore = null) {
        this.appState = appState;
        this.projectStore = projectStore;
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
        sourceCard.setAttribute('data-source-type', source.source_type || 'journalism');
        
        console.log(`✅ SOURCE CARD: Main container created with class '${className}' and ID '${source.id}'`);

        // Compact layout: [Checkbox] Title + Metadata + Actions [Icons]
        const compactLayout = this._createCompactLayout(source, { showCheckbox, showActions });
        sourceCard.appendChild(compactLayout);

        // Source excerpt (hidden by default, shows on hover)
        if (source.excerpt || source.content_preview) {
            const excerpt = this._createExcerpt(source);
            sourceCard.appendChild(excerpt);
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
            } else if (action === 'summarize') {
                e.preventDefault();
                this._handleSummarize(sourceId, actionBtn);
            } else if (action === 'dismiss') {
                e.preventDefault();
                this._handleDismiss(sourceId, sourceCard);
            } else if (action === 'add-to-outline') {
                e.preventDefault();
                this._handleAddToOutline(sourceId, actionBtn);
            }
            // view-external opens naturally via href, no handler needed
        };
        
        sourceCard.addEventListener('click', cardClickHandler);
        this.eventListeners.set(sourceCard, { type: 'click', handler: cardClickHandler });
        console.log('🎯 EVENT DELEGATION: Attached single click handler to card:', source.id);
        
        return sourceCard;
    }
    
    /**
     * Create compact layout with checkbox, title, metadata, and icon-only actions
     */
    _createCompactLayout(source, options = {}) {
        const { showCheckbox = true, showActions = true } = options;
        
        const container = document.createElement('div');
        container.className = 'source-card-compact';
        
        // Top-right: Dismiss button
        const dismissBtn = this._createDismissButton();
        container.appendChild(dismissBtn);
        
        // Top row: Checkbox + Content (title + metadata)
        const topRow = document.createElement('div');
        topRow.className = 'source-card-top-row';
        
        // Left: Checkbox
        if (showCheckbox) {
            const checkbox = this._createCompactCheckbox(source);
            topRow.appendChild(checkbox);
        }
        
        // Middle: Content (title + metadata)
        const content = document.createElement('div');
        content.className = 'source-card-content';
        
        const title = document.createElement('h4');
        title.className = 'source-title';
        title.textContent = source.title || 'Untitled Source';
        
        const metadata = this._createMetadataLine(source);
        
        content.appendChild(title);
        content.appendChild(metadata);
        topRow.appendChild(content);
        
        container.appendChild(topRow);
        
        // Bottom row: Icon-only action buttons (below title/metadata)
        if (showActions) {
            const actions = this._createIconActions(source);
            container.appendChild(actions);
        }
        
        return container;
    }
    
    /**
     * Create dismiss button (X) for removing source from panel
     */
    _createDismissButton() {
        const btn = document.createElement('button');
        btn.className = 'source-dismiss-btn';
        btn.setAttribute('data-action', 'dismiss');
        btn.setAttribute('title', 'Remove source');
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>`;
        return btn;
    }
    
    /**
     * Create single-line metadata: domain • LICENSE • ★ rating
     */
    _createMetadataLine(source) {
        const meta = document.createElement('div');
        meta.className = 'source-metadata-line';
        
        const parts = [];
        
        // Domain - safely extract from URL or use provided domain
        const domain = this._extractDomain(source);
        if (domain) {
            parts.push(`<span class="meta-domain">${domain}</span>`);
        }
        
        // License badge showing licensing protocol (FREE, TOLLBIT, RSL, CLOUDFLARE)
        const licenseBadge = this._getLicenseText(source);
        parts.push(`<span class="meta-license ${licenseBadge.className}" data-license-type="${licenseBadge.className}">${licenseBadge.text}</span>`);
        
        // Rating
        const rating = this._getRatingText(source);
        if (rating) {
            parts.push(`<span class="meta-rating">★ ${rating}</span>`);
        }
        
        meta.innerHTML = parts.join(' <span class="meta-separator">•</span> ');
        
        return meta;
    }
    
    /**
     * Safely extract domain from source (handles malformed URLs)
     */
    _extractDomain(source) {
        // If domain is already provided, use it
        if (source.domain) {
            return source.domain;
        }
        
        // Try to parse URL safely
        if (source.url) {
            try {
                // Handle absolute URLs
                if (source.url.startsWith('http://') || source.url.startsWith('https://')) {
                    return new URL(source.url).hostname;
                }
                // Handle URLs without protocol
                return new URL('https://' + source.url).hostname;
            } catch (e) {
                // Fallback to raw URL string if parsing fails
                return source.url.replace(/^https?:\/\//, '').split('/')[0];
            }
        }
        
        return '';
    }
    
    /**
     * Get license text for compact display
     * Shows which licensing protocol is available for accessing this source
     * 
     * Protocol badges (TOLLBIT, RSL, CLOUDFLARE) indicate paywalled content is accessible
     * through these licensing systems, highlighting the app's ability to access
     * high-quality information behind paywalls.
     * 
     * Priority: Protocol badges > Free > Checking
     */
    _getLicenseText(source) {
        const protocol = source.licensing_protocol;
        const cost = source.unlock_price || source.licensing_cost || 0;
        
        // Show protocol badge when licensing system is detected (Tollbit, RSL, Cloudflare)
        // This highlights paywalled content that's accessible through licensed protocols
        if (protocol && protocol.toLowerCase() === 'tollbit') {
            return { text: 'TOLLBIT', className: 'license-paid' };
        } else if (protocol && protocol.toLowerCase() === 'rsl') {
            return { text: 'RSL', className: 'license-demo' };
        } else if (protocol && protocol.toLowerCase() === 'cloudflare') {
            return { text: 'CLOUDFLARE', className: 'license-demo' };
        } else if (cost === 0) {
            // No protocol detected and free - show FREE badge
            return { text: 'FREE', className: 'license-free' };
        } else {
            // Cost > 0 but no protocol detected yet - still checking
            return { text: 'CHECKING...', className: 'license-loading' };
        }
    }
    
    /**
     * Get rating text for compact display
     */
    _getRatingText(source) {
        const rawScore = source.relevance_score || source.rating || source.quality_score;
        if (!rawScore) return null;
        
        let normalizedScore;
        if (rawScore <= 1.0) {
            normalizedScore = Math.max(1.0, rawScore * 5);
        } else if (rawScore <= 5.0) {
            normalizedScore = Math.max(1.0, rawScore);
        } else {
            normalizedScore = Math.max(1.0, (rawScore / 100) * 5);
        }
        
        return normalizedScore.toFixed(1);
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
            
            // Update metadata line with new licensing information (compact layout)
            const metadataLine = cardElement.querySelector('.source-metadata-line');
            if (metadataLine) {
                // Update license badge within metadata line
                const licenseBadge = metadataLine.querySelector('.meta-license');
                if (licenseBadge) {
                    const newLicenseInfo = this._getLicenseText(enrichedSource);
                    licenseBadge.textContent = newLicenseInfo.text;
                    licenseBadge.className = `meta-license ${newLicenseInfo.className}`;
                    licenseBadge.setAttribute('data-license-type', newLicenseInfo.className);
                    licenseBadge.classList.add('badge-updated'); // Visual feedback
                }
            }
            
            // Update unlock/download icon button with fresh state
            this._updateIconActionButton(cardElement, enrichedSource);
        });
        
        console.log(`✅ Card updated: ${enrichedSource.title}`);
    }
    
    /**
     * Update icon action button with fresh state (for compact layout)
     */
    _updateIconActionButton(cardElement, freshSource) {
        const unlockBtn = cardElement.querySelector('.unlock-icon-btn');
        if (!unlockBtn || !freshSource) return;
        
        const cost = freshSource.unlock_price || 0;
        const isUnlocked = freshSource.is_unlocked || false;
        
        // Update data-action attribute
        unlockBtn.setAttribute('data-action', isUnlocked ? 'download' : 'unlock');
        
        // Update icon, tooltip, and visibility
        if (isUnlocked) {
            unlockBtn.setAttribute('title', 'Download source');
            unlockBtn.style.display = '';
            unlockBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>`;
        } else if (cost > 0) {
            unlockBtn.setAttribute('title', `Unlock for $${cost.toFixed(2)}`);
            unlockBtn.style.display = '';
            unlockBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
            </svg>`;
        } else {
            // Free source - hide the button
            unlockBtn.setAttribute('title', 'Free source');
            unlockBtn.style.display = 'none';
        }
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

        // Domain tier badge (premium/standard)
        if (source.domain_tier === 'premium') {
            const tierBadge = this._createDomainTierBadge(source);
            badges.appendChild(tierBadge);
        }

        // Source type badge with emoji
        const typeBadge = this._createSourceTypeBadge(source);
        badges.appendChild(typeBadge);

        // License badge - ALWAYS show a badge (Free, Coming Soon, or Paid)
        const licenseBadge = this._createLicenseBadge(source);
        badges.appendChild(licenseBadge);

        return badges;
    }
    
    /**
     * Create domain tier badge for premium sources
     */
    _createDomainTierBadge(source) {
        const badge = document.createElement('span');
        badge.className = 'domain-tier-badge premium';
        badge.textContent = '⭐ Premium';
        badge.setAttribute('title', 'High-quality source from major publication, academic institution, or government agency');
        badge.setAttribute('data-domain-tier', 'premium');
        
        // Inline styles for premium badge
        badge.style.cssText = `
            background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
            color: #000;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            display: inline-block;
            margin-right: 4px;
        `;
        
        return badge;
    }
    
    /**
     * Create source type badge with emoji and tooltip
     */
    _createSourceTypeBadge(source) {
        const badge = document.createElement('span');
        badge.className = 'source-type-badge';
        
        const sourceType = source.source_type || 'journalism';
        const typeMap = {
            'academic': { emoji: '🎓', label: 'Academic' },
            'journalism': { emoji: '📰', label: 'Journalism' },
            'business': { emoji: '💼', label: 'Business' },
            'government': { emoji: '🏛️', label: 'Government' }
        };
        
        const typeInfo = typeMap[sourceType] || typeMap['journalism'];
        badge.textContent = typeInfo.emoji;
        badge.setAttribute('title', typeInfo.label);
        badge.setAttribute('data-source-type', sourceType);
        
        return badge;
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

        // View Source button (always show for publisher traffic)
        if (source.url) {
            const viewBtn = this._createViewButton(source);
            rightSide.appendChild(viewBtn);
        }

        // Summarize button (replaces unlock button for quick article summaries)
        const summarizeBtn = this._createSummarizeButton(source);
        rightSide.appendChild(summarizeBtn);

        actions.appendChild(leftSide);
        actions.appendChild(rightSide);

        return actions;
    }

    /**
     * Create compact checkbox (no label, just checkbox)
     */
    _createCompactCheckbox(source) {
        const container = document.createElement('div');
        container.className = 'source-checkbox-compact';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'source-selection-checkbox';
        checkbox.setAttribute('aria-label', 'Select source');
        checkbox.setAttribute('title', 'Add to Outline');
        
        // Use appState as single source of truth
        checkbox.checked = this.appState?.isSourceSelected(source.id) || false;
        
        // Create stable event handler
        const changeHandler = (e) => {
            const cardElement = e.target.closest('[data-source-id]');
            this._handleSelectionChange(source, e.target.checked, cardElement);
        };
        
        checkbox.addEventListener('change', changeHandler);
        
        // Track listener for cleanup
        this.eventListeners.set(checkbox, {
            type: 'change',
            handler: changeHandler
        });
        
        container.appendChild(checkbox);
        
        return container;
    }
    
    /**
     * Create icon-only action buttons
     */
    _createIconActions(source) {
        const actions = document.createElement('div');
        actions.className = 'source-icon-actions';
        
        // External link icon
        if (source.url) {
            const linkBtn = document.createElement('a');
            linkBtn.className = 'icon-action-btn';
            linkBtn.href = source.url;
            linkBtn.target = '_blank';
            linkBtn.rel = 'noopener noreferrer';
            linkBtn.setAttribute('title', 'View source');
            linkBtn.setAttribute('data-action', 'view-external');
            linkBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>`;
            actions.appendChild(linkBtn);
        }
        
        // Add to outline icon
        const outlineBtn = document.createElement('button');
        outlineBtn.className = 'icon-action-btn add-to-outline-btn';
        outlineBtn.setAttribute('data-action', 'add-to-outline');
        
        // Set initial state based on whether source is selected
        const isSelected = this.appState?.isSourceSelected(source.id) || false;
        if (isSelected) {
            outlineBtn.classList.add('active');
            outlineBtn.setAttribute('title', 'Added to outline');
        } else {
            outlineBtn.setAttribute('title', 'Add to outline');
        }
        
        outlineBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 3h7v7H3z"></path>
            <path d="M14 3h7v7h-7z"></path>
            <path d="M14 14h7v7h-7z"></path>
            <path d="M3 14h7v7H3z"></path>
        </svg>`;
        actions.appendChild(outlineBtn);
        
        // Summarize article icon
        const addBtn = document.createElement('button');
        addBtn.className = 'icon-action-btn';
        addBtn.setAttribute('title', 'Summarize article');
        addBtn.setAttribute('data-action', 'summarize');
        addBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="12" y1="18" x2="12" y2="12"></line>
            <line x1="9" y1="15" x2="15" y2="15"></line>
        </svg>`;
        actions.appendChild(addBtn);
        
        // Unlock/download icon (always render, hide if pending/free)
        const cost = source.unlock_price || 0;
        const isUnlocked = source.is_unlocked || false;
        
        const unlockBtn = document.createElement('button');
        unlockBtn.className = 'icon-action-btn unlock-icon-btn';
        unlockBtn.setAttribute('data-action', isUnlocked ? 'download' : 'unlock');
        
        if (isUnlocked) {
            unlockBtn.setAttribute('title', 'Download source');
            unlockBtn.style.display = '';
            unlockBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>`;
        } else if (cost > 0) {
            unlockBtn.setAttribute('title', `Unlock for $${cost.toFixed(2)}`);
            unlockBtn.style.display = '';
            unlockBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
            </svg>`;
        } else {
            // Pending enrichment or free source - hide but keep in DOM
            unlockBtn.setAttribute('title', 'Checking pricing...');
            unlockBtn.style.display = 'none';
            unlockBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
            </svg>`;
        }
        
        // Always append unlock button (visibility controlled via display style)
        actions.appendChild(unlockBtn);
        
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
            const cardElement = e.target.closest('[data-source-id]');
            this._handleSelectionChange(source, e.target.checked, cardElement);
        };
        
        checkbox.addEventListener('change', changeHandler);
        
        // Track listener for cleanup
        this.eventListeners.set(checkbox, {
            type: 'change',
            handler: changeHandler
        });
        
        const text = document.createElement('span');
        text.className = 'selection-text';
        text.textContent = 'Add to Outline';
        
        label.appendChild(checkbox);
        label.appendChild(text);
        selection.appendChild(label);
        
        return selection;
    }

    /**
     * Handle checkbox selection change - sync with appState and update outline button
     * @param cardElement - The card element (passed from event handler to avoid global queries)
     */
    _handleSelectionChange(source, isSelected, cardElement = null) {
        if (!source || !source.id) {
            console.error('Invalid source in selection change:', source);
            return;
        }
        
        // Use passed cardElement or fallback to query (for backwards compatibility)
        const sourceCard = cardElement || document.querySelector(`[data-source-id="${source.id}"]`);
        
        if (isSelected) {
            if (sourceCard) {
                sourceCard.classList.add('selected');
                // Update outline button state
                this._updateOutlineButtonState(sourceCard, true);
            }
            // Use appState as single source of truth
            if (this.appState?.toggleSourceSelection) {
                this.appState.toggleSourceSelection(source.id, source);
            }
        } else {
            if (sourceCard) {
                sourceCard.classList.remove('selected');
                // Update outline button state
                this._updateOutlineButtonState(sourceCard, false);
            }
            // Remove from appState
            if (this.appState?.removeSelectedSource) {
                this.appState.removeSelectedSource(source.id);
            }
        }

        // CRITICAL: Sync to ProjectStore so OutlineBuilder receives the update
        if (this.projectStore && this.appState) {
            const selectedSources = this.appState.getSelectedSources();
            this.projectStore.setSelectedSources(selectedSources);
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
     * Update outline button visual state
     */
    _updateOutlineButtonState(cardElement, isSelected) {
        if (!cardElement) return;
        
        const outlineBtn = cardElement.querySelector('.add-to-outline-btn');
        if (!outlineBtn) return;
        
        if (isSelected) {
            outlineBtn.classList.add('active');
            outlineBtn.setAttribute('title', 'Added to outline');
        } else {
            outlineBtn.classList.remove('active');
            outlineBtn.setAttribute('title', 'Add to outline');
        }
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
     * Calculate summary price from license cost
     * Price = license_cost × 1.25 OR $0.02 minimum
     */
    _calculateSummaryPrice(source) {
        const licenseCost = source.license_cost || 0;
        const platformFee = 1.25;
        const calculatedPrice = licenseCost * platformFee;
        const minimumPrice = 0.02;
        
        return Math.max(calculatedPrice, minimumPrice);
    }

    /**
     * Create summarize button
     */
    _createSummarizeButton(source) {
        const button = document.createElement('button');
        button.className = 'summarize-btn';
        button.setAttribute('data-action', 'summarize');
        
        const licenseCost = source.license_cost || 0;
        const price = this._calculateSummaryPrice(source);
        
        // Check if summary is already cached
        const hasCachedSummary = this.appState.hasCachedSummary(source.id);
        
        // Track pricing analytics (only if not cached)
        if (!hasCachedSummary && window.analytics && source.url) {
            try {
                const domain = new URL(source.url).hostname;
                const pricingTier = (licenseCost * 1.25 >= 0.02) ? 'markup' : 'minimum';
                window.analytics.trackSummaryPricing(source.id, domain, licenseCost, price, pricingTier);
            } catch (e) {
                // Silently fail if URL parsing fails
                console.warn('Failed to track summary pricing:', e);
            }
        }
        
        const icon = document.createElement('span');
        icon.textContent = '✨';
        
        const text = document.createElement('span');
        // Change button text based on whether summary is cached
        text.textContent = hasCachedSummary 
            ? 'Review Summary' 
            : `Summarize for $${price.toFixed(2)}`;
        
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
     * Handle article summarize request
     */
    async _handleSummarize(sourceId, buttonElement) {
        console.log('✨ SUMMARIZE: Button clicked! SourceID:', sourceId);
        
        // Lookup source from appState
        const researchData = this.appState?.getCurrentResearchData();
        if (!researchData || !researchData.sources) {
            console.error('✨ SUMMARIZE: No research data available');
            return;
        }
        
        const source = researchData.sources.find(s => s.id === sourceId);
        if (!source) {
            console.error('✨ SUMMARIZE: Source not found for ID:', sourceId);
            return;
        }
        
        console.log('✨ SUMMARIZE: Source found:', source.title);
        
        try {
            // Calculate price
            const price = this._calculateSummaryPrice(source);
            
            // Dispatch event for app to handle
            const event = new CustomEvent('sourceSummarizeRequested', {
                detail: { 
                    source, 
                    price,
                    buttonElement // Pass button for potential loading state
                }
            });
            console.log('✨ SUMMARIZE: Dispatching event with detail:', event.detail);
            document.dispatchEvent(event);
            console.log('✨ SUMMARIZE: Event dispatched successfully');
        } catch (error) {
            console.error('✨ SUMMARIZE: ERROR in _handleSummarize:', error);
        }
    }

    /**
     * Handle adding source to outline - just click the checkbox
     */
    _handleAddToOutline(sourceId, buttonElement) {
        // Find the checkbox and click it - let existing logic handle everything
        const cardElement = buttonElement.closest('[data-source-id]');
        if (!cardElement) return;
        
        const checkbox = cardElement.querySelector('.source-selection-checkbox');
        if (checkbox) {
            checkbox.click();
        }
    }

    /**
     * Handle source dismissal (removal from panel)
     */
    _handleDismiss(sourceId, cardElement) {
        console.log('🗑️ DISMISS: Removing source:', sourceId);
        
        // Fade out animation
        cardElement.style.opacity = '0';
        cardElement.style.transform = 'translateX(-20px)';
        cardElement.style.transition = 'opacity 0.2s, transform 0.2s';
        
        setTimeout(() => {
            // Remove from DOM
            cardElement.remove();
            
            // Dispatch event so SourcesPanel can update its state
            const event = new CustomEvent('sourceDismissed', {
                detail: { sourceId }
            });
            document.dispatchEvent(event);
            
            console.log('✅ DISMISS: Source removed from panel');
        }, 200);
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