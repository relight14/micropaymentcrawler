import { AppEvents, EVENT_TYPES } from '../utils/event-bus.js';
import { analytics } from '../utils/analytics.js';

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
    }

    async unlockSource(button, sourceId, price) {
        console.log('🔓 UNLOCK: unlockSource() called!', { button, sourceId, price });
        
        let sourceToUpdate = null;
        const researchResults = this.appState.getCurrentResearchData();
        if (researchResults && researchResults.sources) {
            sourceToUpdate = researchResults.sources.find(s => s.id === sourceId);
        }

        if (sourceToUpdate?.is_unlocked || this.appState.isPurchased(sourceId)) {
            console.log('🔓 UNLOCK: Source already unlocked, opening directly');
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
            console.log('🔓 UNLOCK: Blocked - enrichment still pending');
            return;
        }

        if (this.isUnlockInProgress) {
            console.log('🔓 UNLOCK: Already in progress, ignoring duplicate request');
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
            console.log('🔓 UNLOCK: Fetching fresh pricing from server...');
            const freshPricing = await this.apiService.getFreshSourcePricing(sourceId);
            
            if (sourceToUpdate) {
                sourceToUpdate.unlock_price = freshPricing.unlock_price;
                sourceToUpdate.licensing_protocol = freshPricing.licensing_protocol;
            }
            
            price = freshPricing.unlock_price;
            console.log('✅ UNLOCK: Fresh pricing fetched:', freshPricing);
            
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
            console.log('🔓 UNLOCK: User cancelled purchase');
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

    async unlockFromChat(sourceId, price, title) {
        console.warn('unlockFromChat is deprecated - use unlockSource directly');
        return this.unlockSource(null, sourceId, price);
    }

    toggleSelection(sourceId, sourceData) {
        const isSelected = this.appState.toggleSourceSelection(sourceId, sourceData);
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
        console.log('🎨 DISPLAY METHOD: displayCards() ENTRY POINT');
        console.log('🎨 DISPLAY METHOD: Sources parameter received:', sources);
        
        if (!sources || sources.length === 0) {
            console.log('❌ DISPLAY METHOD: Early return - no sources');
            return null;
        }
        
        console.log('✅ DISPLAY METHOD: Validation passed, proceeding to create cards');
        
        if (!window.SourceCard) {
            console.log('Waiting for SourceCard to load...');
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
            
            document.addEventListener('sourceUnlockRequested', (e) => {
                console.log('🔓 UNLOCK: Event received in SourceManager!', e.detail);
                this.unlockSource(null, e.detail.source.id, e.detail.source.unlock_price);
            });
            
            document.addEventListener('sourceDownloadRequested', (e) => {
                window.open(e.detail.source.url, '_blank');
            });
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
        
        console.log('📊 Updating source cards with enriched data:', enrichedSources.length);
        
        enrichedSources.forEach(source => {
            const sourceCard = document.querySelector(`[data-source-id="${source.id}"]`);
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
        const researchBudget = 0.99;
        const proBudget = 1.99;
        const warningThreshold = 0.8;
        
        if (totalCost >= proBudget) {
            const warning = `⚠️ Selected sources exceed Pro budget ($${Number(proBudget || 0).toFixed(2)})`;
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.BUDGET_WARNING, {
                detail: { warning, totalCost }
            }));
            return warning;
        } else if (totalCost >= proBudget * warningThreshold) {
            const warning = `⚠️ Selected sources approaching Pro budget limit ($${Number(proBudget || 0).toFixed(2)})`;
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.BUDGET_WARNING, {
                detail: { warning, totalCost }
            }));
            return warning;
        }
        
        if (totalCost >= researchBudget) {
            const warning = `⚠️ Selected sources exceed Research budget ($${Number(researchBudget || 0).toFixed(2)})`;
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.BUDGET_WARNING, {
                detail: { warning, totalCost }
            }));
            return warning;
        } else if (totalCost >= researchBudget * warningThreshold) {
            const warning = `⚠️ Selected sources approaching Research budget limit ($${Number(researchBudget || 0).toFixed(2)})`;
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.BUDGET_WARNING, {
                detail: { warning, totalCost }
            }));
            return warning;
        }
        
        return null;
    }
}
