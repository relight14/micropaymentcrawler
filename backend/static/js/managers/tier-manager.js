import { AppEvents, EVENT_TYPES } from '../utils/event-bus.js';
import { analytics } from '../utils/analytics.js';
import { projectStore } from '../state/project-store.js';

export class TierManager extends EventTarget {
    constructor({ appState, apiService, authService, toastManager, uiManager, reportBuilder, messageCoordinator }) {
        super();
        this.appState = appState;
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.uiManager = uiManager;
        this.reportBuilder = reportBuilder;
        this.messageCoordinator = messageCoordinator;
    }

    async purchaseTier(button, tierId, price, query = "Research Query", useSelectedSources = false) {
        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'tier_purchase', 
                button, 
                tierId, 
                price 
            });
            
            this.dispatchEvent(new CustomEvent('authRequired', {
                detail: { message: 'Please log in to purchase this research tier.' }
            }));
            return;
        }

        try {
            let selectedSources = [];
            if (useSelectedSources) {
                selectedSources = this.appState.getSelectedSources();
                if (selectedSources.length === 0) {
                    this.toastManager.show('Please select sources first', 'error');
                    return;
                }
            }

            // Build query with fallback chain
            const finalQuery = query || this.appState.getCurrentQuery() || projectStore.getResearchQuery() || "Research Query";
            
            console.log('🔍 [TierManager] Building purchase details:', {
                explicitQuery: query,
                appStateQuery: this.appState.getCurrentQuery(),
                projectStoreQuery: projectStore.getResearchQuery(),
                finalQuery: finalQuery
            });
            
            const purchaseDetails = {
                tier: tierId,
                price: price,
                selectedSources: selectedSources,
                query: finalQuery
            };

            const userConfirmed = await this.uiManager.showPurchaseConfirmationModal(purchaseDetails);
            
            if (!userConfirmed) {
                if (button) {
                    button.textContent = useSelectedSources ? 
                        `Build Report with ${selectedSources.length} Selected Sources` : 
                        `Purchase ${tierId === 'research' ? 'Research' : 'Pro'} Package`;
                    button.disabled = false;
                }
                return;
            }
            
            // Track tier selection
            analytics.trackTierSelect(tierId);

            let loadingMessageElement = null;
            try {
                loadingMessageElement = this.messageCoordinator?.showProgressiveLoading();
                
                this.dispatchEvent(new CustomEvent('purchaseStarted', {
                    detail: { tier: tierId, price }
                }));
                
                // Get outline structure from ProjectStore
                const outlineStructure = projectStore.getOutlineSnapshot();
                
                // Build query with fallback chain
                const apiQuery = query || this.appState.getCurrentQuery() || projectStore.getResearchQuery() || "Research Query";
                
                console.log('🔍 [TierManager] Calling purchaseTier API:', {
                    explicitQuery: query,
                    appStateQuery: this.appState.getCurrentQuery(),
                    projectStoreQuery: projectStore.getResearchQuery(),
                    apiQuery: apiQuery,
                    tier: tierId
                });
                
                const purchaseResponse = await this.apiService.purchaseTier(
                    tierId, 
                    price, 
                    apiQuery, 
                    useSelectedSources ? selectedSources : null,
                    outlineStructure
                );
                
                if (loadingMessageElement) {
                    this.messageCoordinator?.removeLoading(loadingMessageElement);
                    loadingMessageElement = null;
                }
                
                if (purchaseResponse && purchaseResponse.success && purchaseResponse.packet) {
                    this.appState.addPurchasedItem(tierId);
                    
                    // Track purchase
                    const sourceCount = useSelectedSources ? selectedSources.length : purchaseResponse.packet?.sources?.length || 0;
                    analytics.trackPurchase(price, sourceCount);
                    
                    if (button) {
                        button.textContent = 'Purchased';
                        button.disabled = true;
                    }

                    await this.authService.updateWalletBalance();
                    if (this.authService.isAuthenticated()) {
                        this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
                    }

                    this.dispatchEvent(new CustomEvent('purchaseCompleted', {
                        detail: { 
                            tier: tierId, 
                            reportData: purchaseResponse.packet,
                            sourceCount: useSelectedSources ? selectedSources.length : purchaseResponse.packet?.sources?.length || 0
                        }
                    }));

                    AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.TIER_PURCHASED, {
                        detail: { 
                            tier: tierId, 
                            reportData: purchaseResponse.packet 
                        }
                    }));
                } else {
                    throw new Error('Invalid purchase response');
                }
            } catch (reportError) {
                console.error('Error in purchase/report generation:', reportError);
                
                if (loadingMessageElement) {
                    this.messageCoordinator?.removeLoading(loadingMessageElement);
                }
                
                this.dispatchEvent(new CustomEvent('purchaseError', {
                    detail: { 
                        error: reportError, 
                        tier: tierId,
                        message: `❌ Purchase failed: ${reportError.message}`
                    }
                }));
                throw reportError;
            }
            
        } catch (error) {
            console.error('Error in purchase flow:', error);
            
            this.dispatchEvent(new CustomEvent('purchaseError', {
                detail: { 
                    error, 
                    tier: tierId,
                    message: `Failed to complete purchase: ${error.message}`
                }
            }));

            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.TIER_PURCHASE_ERROR, {
                detail: { error, tier: tierId }
            }));
            
            if (button) {
                const selectedSources = useSelectedSources ? this.appState.getSelectedSources() : [];
                button.textContent = useSelectedSources ? 
                    `Build Report with ${selectedSources.length || 0} Selected Sources` : 
                    `Purchase ${tierId === 'research' ? 'Research' : 'Pro'} Package`;
                button.disabled = false;
            }
        }
    }
}
