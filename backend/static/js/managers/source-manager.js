import { AppEvents, EVENT_TYPES } from '../utils/event-bus.js';
import { analytics } from '../utils/analytics.js';
import { projectStore } from '../state/project-store.js';
import { logger } from '../utils/logger.js';

// Budget thresholds for sanity checks
const BUDGET_THRESHOLDS = {
    pro: 10.00,  // High cost warning at $10
    warningThreshold: 0.75  // Warning at 75% of budget
};

export class SourceManager extends EventTarget {
    constructor({ appState, apiService, authService, toastManager, uiManager, modalController }) {
        super();
        this.appState = appState;
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.uiManager = uiManager;
        this.modalController = modalController;
        this.isUnlockInProgress = false;
        this.sourceCardComponent = null;
        
        // Set up global event listeners for source card actions
        // These persist across all projects since SourceManager is a singleton
        this._setupGlobalEventListeners();
    }
    
    _setupGlobalEventListeners() {
        logger.debug('🎯 SourceManager: Setting up global event listeners');
        
        document.addEventListener('sourceUnlockRequested', (e) => {
            logger.debug('🔓 UNLOCK: Event received in SourceManager!', e.detail);
            this.unlockSource(null, e.detail.source.id, e.detail.source.unlock_price);
        });
        
        document.addEventListener('sourceDownloadRequested', (e) => {
            logger.debug('📥 DOWNLOAD: Event received in SourceManager!', e.detail);
            window.open(e.detail.source.url, '_blank');
        });
        
        // NOTE: sourceSummarizeRequested and sourceFullAccessRequested are now handled by app.js
        // with the new PurchaseConfirmationModal component. Removed duplicate listener to prevent
        // double modals from appearing.
    }

    async unlockSource(button, sourceId, price) {
        logger.debug('🔓 UNLOCK: unlockSource() called!', { button, sourceId, price });
        
        let sourceToUpdate = null;
        const researchResults = this.appState.getCurrentResearchData();
        if (researchResults && researchResults.sources) {
            sourceToUpdate = researchResults.sources.find(s => s.id === sourceId);
        }

        if (sourceToUpdate?.is_unlocked || this.appState.isPurchased(sourceId)) {
            logger.debug('🔓 UNLOCK: Source already unlocked, opening directly');
            if (sourceToUpdate?.url) {
                // Track source view
                const domain = new URL(sourceToUpdate.url).hostname;
                analytics.trackSourceView(sourceId, domain);
                window.open(sourceToUpdate.url, '_blank');
            }
            return;
        }

        if (this.appState.isEnrichmentPending()) {
            this.toastManager.show('⏳ Pricing is still loading... please wait', 'info', 3000);
            logger.debug('🔓 UNLOCK: Blocked - enrichment still pending');
            return;
        }

        if (this.isUnlockInProgress) {
            logger.debug('🔓 UNLOCK: Already in progress, ignoring duplicate request');
            return;
        }

        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'source_unlock', 
                button, 
                sourceId, 
                price 
            });
            this.modalController.showAuthModal();
            return;
        }
        
        try {
            logger.debug('🔓 UNLOCK: Fetching fresh pricing from server...');
            const freshPricing = await this.apiService.getFreshSourcePricing(sourceId);
            
            if (sourceToUpdate) {
                sourceToUpdate.unlock_price = freshPricing.unlock_price;
                sourceToUpdate.licensing_protocol = freshPricing.licensing_protocol;
            }
            
            price = freshPricing.unlock_price;
            logger.debug('✅ UNLOCK: Fresh pricing fetched:', freshPricing);
            
        } catch (error) {
            console.error('❌ UNLOCK: Failed to fetch fresh pricing:', error);
            this.toastManager.show('Failed to load pricing. Please try again.', 'error');
            return;
        }

        const purchaseDetails = {
            tier: 'source_unlock',
            price: price,
            titleOverride: 'Unlock Source',
            customDescription: price === 0 
                ? 'This source is free to unlock. Click confirm to access.'
                : `Unlock this ${sourceToUpdate?.license_type || 'licensed'} source for $${Number(price).toFixed(2)}`,
            selectedSources: sourceToUpdate ? [sourceToUpdate] : [],
            query: sourceToUpdate?.title || 'Source Access'
        };

        const userConfirmed = await this.uiManager.showPurchaseConfirmationModal(purchaseDetails);
        
        if (!userConfirmed) {
            logger.debug('🔓 UNLOCK: User cancelled purchase');
            if (button) {
                button.innerHTML = '🔓 <span>Unlock</span>';
                button.disabled = false;
            }
            return;
        }

        this.isUnlockInProgress = true;

        const originalButtonContent = button?.innerHTML;
        if (button) {
            button.innerHTML = '🔄 <span>Unlocking...</span>';
            button.disabled = true;
        }

        try {
            const result = await this.apiService.unlockSource(sourceId, price);
            
            if (sourceToUpdate) {
                sourceToUpdate.is_unlocked = true;
            }
            this.appState.addPurchasedItem(sourceId);
            
            // Track source unlock
            const domain = sourceToUpdate?.url ? new URL(sourceToUpdate.url).hostname : 'unknown';
            analytics.trackSourceUnlock(sourceId, price, domain);
            
            await this.authService.updateWalletBalance();
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }

            this.toastManager.show('✅ Source unlocked! Redirecting you now…', 'success', 4000);

            if (button) {
                button.innerHTML = '📄 <span>View Source</span>';
                button.disabled = false;
                const newHandler = () => {
                    if (sourceToUpdate?.url) {
                        window.open(sourceToUpdate.url, '_blank');
                    }
                };
                button.removeEventListener('click', button._currentHandler);
                button.addEventListener('click', newHandler);
                button._currentHandler = newHandler;
            }

            setTimeout(() => {
                if (sourceToUpdate?.url) {
                    // Track source view (already unlocked)
                    const domain = new URL(sourceToUpdate.url).hostname;
                    analytics.trackSourceView(sourceId, domain);
                    window.open(sourceToUpdate.url, '_blank');
                } else {
                    console.warn('Source URL not found for redirect');
                }
            }, 1800);

            if (researchResults && researchResults.sources) {
                this.appState.setCurrentResearchData({
                    ...researchResults,
                    sources: [...researchResults.sources]
                });
            }

            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.SOURCE_UNLOCKED, {
                detail: { sourceId, unlockData: result }
            }));

        } catch (error) {
            console.error('Error unlocking source:', error);
            
            if (error.message.includes('422') || error.message.includes('Unprocessable Entity')) {
                console.warn('⚠️ Unlock schema validation error - check payload structure:', {
                    sourceId,
                    price,
                    error: error.message
                });
            }
            
            this.toastManager.show('⚠️ Unlock failed. Please try again.', 'error');
            
            if (button && originalButtonContent) {
                button.innerHTML = originalButtonContent;
                button.disabled = false;
            }

            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.SOURCE_UNLOCK_ERROR, {
                detail: { error, sourceId }
            }));
        } finally {
            this.isUnlockInProgress = false;
        }
    }

    /**
     * @deprecated This method is no longer called from event listeners.
     * Summary purchases are now handled by PurchaseConfirmationModal in app.js.
     * Kept for backwards compatibility but should not be used in new code.
     */
    async summarizeSource(source, price, buttonElement) {
        logger.debug('✨ SUMMARIZE: summarizeSource() called!', { source, price });
        
        // Check if already cached
        const cached = this.appState.getCachedSummary(source.id);
        if (cached) {
            logger.debug('✨ SUMMARIZE: Using cached summary');
            this.showSummaryPopover(source, cached.summary, cached.price, cached.summary_type || 'full');
            analytics.trackSummaryViewed(source.id, new URL(source.url).hostname, cached.price, true);
            return;
        }
        
        // Check authentication
        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'source_summarize', 
                source, 
                price 
            });
            this.modalController.showAuthModal();
            return;
        }
        
        // Show purchase confirmation modal (matching tier purchase UX)
        const purchaseDetails = {
            tier: 'summary',
            price: price,
            titleOverride: 'Confirm Summary Purchase',
            customDescription: `Get an AI-generated summary of this article for $${Number(price).toFixed(2)}`,
            selectedSources: [],
            query: source.title || 'Article Summary'
        };

        const userConfirmed = await this.uiManager.showPurchaseConfirmationModal(purchaseDetails);
        
        if (!userConfirmed) {
            logger.debug('✨ SUMMARIZE: User cancelled purchase');
            return;
        }
        
        // Show loading state on button
        const originalButtonContent = buttonElement?.innerHTML;
        if (buttonElement) {
            buttonElement.innerHTML = '⏳ <span>Summarizing...</span>';
            buttonElement.disabled = true;
        }
        
        try {
            // Call API to generate summary (mock purchase already confirmed)
            const result = await this.apiService.summarizeSource(
                source.id,
                source.url,
                source.title,
                source.excerpt || '',  // Pass Tavily excerpt for paywall fallback
                source.license_cost || 0
            );
            
            logger.debug('✨ SUMMARIZE: API response:', result);
            
            // Cache the summary with type for transparency
            this.appState.cacheSummary(source.id, result.summary, result.price, result.summary_type);
            
            // Update wallet
            await this.authService.updateWalletBalance();
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }
            
            // Show summary popover with transparency badge
            this.showSummaryPopover(source, result.summary, result.price, result.summary_type);
            
            // Update button text to "Review Summary"
            if (buttonElement) {
                const textSpan = buttonElement.querySelector('span');
                if (textSpan) {
                    textSpan.textContent = 'Review Summary';
                }
                buttonElement.disabled = false;
            }
            
            // Track analytics
            const domain = new URL(source.url).hostname;
            analytics.trackSummaryPurchased(source.id, domain, result.price);
            analytics.trackSummaryViewed(source.id, domain, result.price, false);
            
            this.toastManager.show('✅ Article summarized successfully!', 'success');
            
        } catch (error) {
            console.error('✨ SUMMARIZE: Error:', error);
            this.toastManager.show('⚠️ Summarization failed. Please try again.', 'error');
            
            // Restore button state only on error
            if (buttonElement && originalButtonContent) {
                buttonElement.innerHTML = originalButtonContent;
                buttonElement.disabled = false;
            }
        }
    }

    showSummaryPopover(source, summary, price, summaryType = 'full') {
        // Dynamically import and show the popover
        if (window.summaryPopover) {
            // Escape source ID to handle potential special characters in CSS selectors
            const escapedId = CSS.escape(source.id);
            const sourceCard = document.querySelector(`[data-source-id="${escapedId}"]`);
            window.summaryPopover.show({
                anchorElement: sourceCard,
                summary: summary,
                price: price,
                summaryType: summaryType,  // "full" or "excerpt" for transparency badge
                sourceTitle: source.title,
                sourceUrl: source.url
            });
        } else {
            console.error('✨ SUMMARIZE: Summary popover not loaded');
        }
    }

    toggleSelection(sourceId, sourceData) {
        const isSelected = this.appState.toggleSourceSelection(sourceId, sourceData);
        
        // Sync to ProjectStore (canonical source of truth for UI/reports)
        const selectedSources = this.appState.getSelectedSources();
        projectStore.setSelectedSources(selectedSources);
        console.log(`[Sync] selectedSources count: ${selectedSources.length}`);
        
        this.updateSelectionUI();
        
        AppEvents.dispatchEvent(new CustomEvent(
            isSelected ? EVENT_TYPES.SOURCE_SELECTED : EVENT_TYPES.SOURCE_DESELECTED,
            { detail: { sourceId, sourceData } }
        ));
        
        return isSelected;
    }

    updateSelectionUI() {
        const selectedSources = this.appState.getSelectedSources();
        const selectedIds = new Set(selectedSources.map(s => s.id));
        
        const allCheckboxes = document.querySelectorAll('.source-selection-checkbox');
        allCheckboxes.forEach(checkbox => {
            const sourceCard = checkbox.closest('[data-source-id]');
            if (sourceCard) {
                const sourceId = sourceCard.getAttribute('data-source-id');
                const isSelected = selectedIds.has(sourceId);
                checkbox.checked = isSelected;
                
                if (isSelected) {
                    sourceCard.style.borderColor = 'var(--primary)';
                    sourceCard.style.backgroundColor = 'var(--primary-light, #f0f9ff)';
                } else {
                    sourceCard.style.borderColor = '';
                    sourceCard.style.backgroundColor = '';
                }
            }
        });
        
        console.log(`Sources selected: ${selectedSources.length}`);
    }

    async displayCards(sources) {
        logger.debug('🎨 DISPLAY METHOD: displayCards() ENTRY POINT');
        logger.debug('🎨 DISPLAY METHOD: Sources parameter received:', sources);
        
        if (!sources || sources.length === 0) {
            logger.debug('❌ DISPLAY METHOD: Early return - no sources');
            return null;
        }
        
        logger.debug('✅ DISPLAY METHOD: Validation passed, proceeding to create cards');
        
        if (!window.SourceCard) {
            logger.debug('Waiting for SourceCard to load...');
            await new Promise(resolve => {
                if (window.SourceCard) {
                    resolve();
                    return;
                }
                document.addEventListener('SourceCardReady', resolve, { once: true });
            });
        }
        
        if (!this.sourceCardComponent) {
            this.sourceCardComponent = new window.SourceCard(this.appState);
        }
        
        const container = document.createElement('div');
        container.className = 'sources-preview-section';
        
        const header = document.createElement('div');
        header.className = 'preview-header';
        
        const title = document.createElement('h3');
        title.textContent = 'Sources Found';
        
        const subtitle = document.createElement('p');
        subtitle.textContent = `Found ${sources.length} sources for your research`;
        
        header.appendChild(title);
        header.appendChild(subtitle);
        container.appendChild(header);
        
        sources.forEach((source, index) => {
            const sourceData = { ...source };
            const sourceCard = this.sourceCardComponent.create(sourceData, {
                showCheckbox: true,
                showActions: true
            });
            container.appendChild(sourceCard);
        });
        
        return {
            element: container,
            metadata: {
                type: 'source_cards',
                sources: sources,
                query: this.appState.getCurrentQuery()
            }
        };
    }

    updateCards(enrichedSources) {
        if (!enrichedSources || enrichedSources.length === 0) return;
        
        logger.debug('📊 Updating source cards with enriched data:', enrichedSources.length);
        
        enrichedSources.forEach(source => {
            // Escape source ID to handle potential special characters in CSS selectors
            const escapedId = CSS.escape(source.id);
            const sourceCard = document.querySelector(`[data-source-id="${escapedId}"]`);
            if (!sourceCard) return;
            
            const excerptEl = sourceCard.querySelector('.source-excerpt');
            if (excerptEl && source.excerpt) excerptEl.textContent = source.excerpt;
            
            const priceEl = sourceCard.querySelector('.source-price');
            if (priceEl && source.unlock_price) {
                const safePrice = Number(source.unlock_price) || 0;
                priceEl.textContent = `$${safePrice.toFixed(2)}`;
            }
            
            if (source.licensing_protocol) {
                const metadataDiv = sourceCard.querySelector('.source-metadata');
                if (metadataDiv && !metadataDiv.querySelector('.licensing-badge')) {
                    const licensingBadge = document.createElement('span');
                    licensingBadge.className = 'licensing-badge';
                    licensingBadge.textContent = source.licensing_protocol;
                    metadataDiv.appendChild(licensingBadge);
                }
            }
        });
        
        this.toastManager.show('Source enrichment complete! Updated with enhanced details.', 'success');
    }

    checkBudget(totalCost) {
        const { pro: proBudget, warningThreshold } = BUDGET_THRESHOLDS;
        
        // With per-source pricing, budget warnings are less relevant
        // but we keep them for very high totals as a sanity check
        if (totalCost >= proBudget) {
            const warning = `⚠️ Selected sources cost is very high ($${Number(totalCost || 0).toFixed(2)})`;
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.BUDGET_WARNING, {
                detail: { warning, totalCost }
            }));
            return warning;
        } else if (totalCost >= proBudget * warningThreshold) {
            const warning = `⚠️ Selected sources approaching high cost ($${Number(totalCost || 0).toFixed(2)})`;
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.BUDGET_WARNING, {
                detail: { warning, totalCost }
            }));
            return warning;
        }
        
        return null;
    }
}
