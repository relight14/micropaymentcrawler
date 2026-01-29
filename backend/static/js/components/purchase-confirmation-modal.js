/**
 * PurchaseConfirmationModal - Unified modal for all purchase types
 * Handles 3 purchase flows:
 * 1. Summarize (single source AI access)
 * 2. Generate Report (multiple sources tallied)
 * 3. Full Access (single source human access)
 */
export class PurchaseConfirmationModal {
    constructor(authService, apiService, modalController, toastManager) {
        this.authService = authService;
        this.apiService = apiService;
        this.modalController = modalController;
        this.toastManager = toastManager;
        
        // Track current purchase context
        this.currentPurchase = null;
        this.onConfirmCallback = null;
    }

    /**
     * Show purchase confirmation modal for summarize action
     * @param {Object} source - Source to summarize
     * @param {Function} onConfirm - Callback after successful purchase
     */
    async showSummarizeConfirmation(source, onConfirm) {
        const price = this._calculateSummaryPrice(source);
        const priceCents = Math.round(price * 100);

        this.currentPurchase = {
            type: 'summarize',
            source: source,
            priceCents: priceCents
        };
        this.onConfirmCallback = onConfirm;

        await this._showModal({
            title: 'Summarize Article',
            description: `Generate an AI-powered summary of this article`,
            itemList: [
                {
                    name: source.title || 'Article',
                    url: source.url,
                    cost: price
                }
            ],
            totalCost: price,
            priceCents: priceCents,
            contentId: null, // Will be registered during purchase
            actionLabel: 'Generate Summary'
        });
    }

    /**
     * Show purchase confirmation modal for report generation
     * @param {String} query - Research query
     * @param {Array} sources - Sources to include in report
     * @param {Object} outlineStructure - Outline structure for report
     * @param {Function} onConfirm - Callback after successful purchase
     */
    async showReportConfirmation(query, sources, outlineStructure, onConfirm) {
        // Get pricing quote from API
        const quoteResult = await this._getPricingQuote(query, outlineStructure);
        
        if (!quoteResult.success) {
            this.toastManager.show('Failed to calculate pricing', 'error', 3000);
            return;
        }

        const totalCost = quoteResult.calculated_price;
        const priceCents = Math.round(totalCost * 100);
        const newSourceCount = quoteResult.new_source_count;
        const previousSourceCount = quoteResult.previous_source_count;

        this.currentPurchase = {
            type: 'report',
            query: query,
            sources: sources,
            outlineStructure: outlineStructure,
            priceCents: priceCents,
            newSourceCount: newSourceCount
        };
        this.onConfirmCallback = onConfirm;

        // Build source list for display
        const itemList = sources.slice(0, 5).map(s => ({
            name: s.title || s.url,
            url: s.url,
            cost: null // Don't show individual costs for report
        }));
        
        if (sources.length > 5) {
            itemList.push({
                name: `... and ${sources.length - 5} more sources`,
                url: null,
                cost: null
            });
        }

        let description = `Generate a research report with ${sources.length} source${sources.length !== 1 ? 's' : ''}`;
        if (previousSourceCount > 0) {
            description += ` (${newSourceCount} new, ${previousSourceCount} already purchased)`;
        }

        await this._showModal({
            title: 'Generate Research Report',
            description: description,
            itemList: itemList,
            totalCost: totalCost,
            priceCents: priceCents,
            contentId: null, // Will be registered during purchase
            actionLabel: 'Generate Report'
        });
    }

    /**
     * Show purchase confirmation modal for full access
     * @param {Object} source - Source to unlock
     * @param {Function} onConfirm - Callback after successful purchase
     */
    async showFullAccessConfirmation(source, onConfirm) {
        const price = source.purchase_price || source.unlock_price || 0;
        const priceCents = Math.round(price * 100);

        this.currentPurchase = {
            type: 'full_access',
            source: source,
            priceCents: priceCents
        };
        this.onConfirmCallback = onConfirm;

        await this._showModal({
            title: 'Get Full Article Access',
            description: `Unlock full human-readable access to this article`,
            itemList: [
                {
                    name: source.title || 'Article',
                    url: source.url,
                    cost: price
                }
            ],
            totalCost: price,
            priceCents: priceCents,
            contentId: null, // Will be registered during purchase
            actionLabel: 'Get Full Access'
        });
    }

    /**
     * Show the modal UI with checkout state logic
     */
    async _showModal(config) {
        const {
            title,
            description,
            itemList,
            totalCost,
            priceCents,
            contentId,
            actionLabel
        } = config;

        // Check checkout state (auth, funds, etc.)
        const checkoutState = await this._checkCheckoutState(priceCents, contentId);

        // Remove any existing modal
        const existingModal = document.getElementById('purchaseConfirmationModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Determine modal state based on checkout
        let modalContent = '';
        let showConfirmButton = false;
        let confirmButtonLabel = actionLabel;

        if (checkoutState.next_required_action === 'authenticate') {
            // User needs to login
            modalContent = `
                <div class="checkout-message">
                    <div class="icon-warning">🔒</div>
                    <p>${checkoutState.message}</p>
                    <button class="auth-btn" id="modalLoginBtn">Log In</button>
                </div>
            `;
        } else if (checkoutState.next_required_action === 'fund_wallet') {
            // User needs to add funds
            const shortfall = checkoutState.shortfall_cents / 100;
            modalContent = `
                <div class="checkout-message">
                    <div class="icon-warning">💳</div>
                    <p>Your wallet balance: $${(checkoutState.balance_cents / 100).toFixed(2)}</p>
                    <p>${checkoutState.message}</p>
                    <button class="auth-btn" id="modalFundBtn">Add $${shortfall.toFixed(2)} to Wallet</button>
                </div>
            `;
        } else if (checkoutState.already_purchased) {
            // Already purchased
            modalContent = `
                <div class="checkout-message">
                    <div class="icon-success">✅</div>
                    <p>${checkoutState.message}</p>
                    <button class="auth-btn" id="modalCloseBtn">Close</button>
                </div>
            `;
        } else {
            // Ready to purchase
            showConfirmButton = true;
            const balance = checkoutState.balance_cents / 100;
            const remaining = (checkoutState.balance_cents - priceCents) / 100;
            
            modalContent = `
                <div class="purchase-details">
                    <div class="purchase-items">
                        ${itemList.map(item => `
                            <div class="purchase-item">
                                <div class="item-info">
                                    <div class="item-name">${this._escapeHtml(item.name)}</div>
                                    ${item.url ? `<div class="item-url">${this._escapeHtml(item.url)}</div>` : ''}
                                </div>
                                ${item.cost !== null ? `<div class="item-cost">$${item.cost.toFixed(2)}</div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                    
                    <div class="purchase-summary">
                        <div class="summary-row">
                            <span>Total Cost</span>
                            <span class="total-amount">$${totalCost.toFixed(2)}</span>
                        </div>
                        <div class="summary-row balance-info">
                            <span>Wallet Balance</span>
                            <span>$${balance.toFixed(2)}</span>
                        </div>
                        <div class="summary-row balance-info">
                            <span>After Purchase</span>
                            <span>$${remaining.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // Build modal HTML
        const modalHTML = `
            <div id="purchaseConfirmationModal" class="modal-overlay">
                <div class="modal-content purchase-modal">
                    <div class="modal-header">
                        <h2>${title}</h2>
                        <p class="modal-description">${description}</p>
                        <button class="modal-close" id="purchaseModalClose">×</button>
                    </div>
                    <div class="modal-body">
                        ${modalContent}
                    </div>
                    ${showConfirmButton ? `
                        <div class="modal-footer">
                            <button class="btn-secondary" id="purchaseCancelBtn">Cancel</button>
                            <button class="btn-primary" id="purchaseConfirmBtn">${confirmButtonLabel}</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;

        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Add event listeners
        this._attachModalEventListeners(showConfirmButton);
    }

    /**
     * Attach event listeners to modal elements
     */
    _attachModalEventListeners(hasConfirmButton) {
        const modal = document.getElementById('purchaseConfirmationModal');
        const closeBtn = document.getElementById('purchaseModalClose');
        const cancelBtn = document.getElementById('purchaseCancelBtn');
        const confirmBtn = document.getElementById('purchaseConfirmBtn');
        const loginBtn = document.getElementById('modalLoginBtn');
        const fundBtn = document.getElementById('modalFundBtn');
        const modalCloseBtn = document.getElementById('modalCloseBtn');

        // Close button
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this._closeModal());
        }

        // Cancel button
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this._closeModal());
        }

        // Confirm button (execute purchase)
        if (confirmBtn && hasConfirmButton) {
            confirmBtn.addEventListener('click', async () => {
                confirmBtn.disabled = true;
                confirmBtn.textContent = 'Processing...';
                await this._executePurchase();
            });
        }

        // Login button
        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                this._closeModal();
                this.modalController.showAuthModal();
            });
        }

        // Fund wallet button
        if (fundBtn) {
            fundBtn.addEventListener('click', () => {
                const shortfall = this.currentPurchase.priceCents;
                this._closeModal();
                this.modalController.showFundingModal(shortfall);
            });
        }

        // Simple close button
        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', () => this._closeModal());
        }

        // Click outside to close
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this._closeModal();
                }
            });
        }
    }

    /**
     * Execute the purchase based on type
     */
    async _executePurchase() {
        try {
            if (!this.currentPurchase) {
                throw new Error('No purchase context');
            }

            let result;

            if (this.currentPurchase.type === 'summarize') {
                // Call summarize API
                result = await this.apiService.summarizeSource(
                    this.currentPurchase.source.id,
                    this.currentPurchase.source.url,
                    this.currentPurchase.source.title,
                    this.currentPurchase.source.excerpt || '',
                    this.currentPurchase.source.unlock_price || this.currentPurchase.source.licensing_cost || 0
                );
            } else if (this.currentPurchase.type === 'report') {
                // Call generate report API
                result = await this.apiService.generateReport(
                    this.currentPurchase.query,
                    this.currentPurchase.sources,
                    this.currentPurchase.outlineStructure
                );
            } else if (this.currentPurchase.type === 'full_access') {
                // Call full access API with price
                result = await this.apiService.getFullAccess(
                    this.currentPurchase.source.id,
                    this.currentPurchase.source.url,
                    this.currentPurchase.priceCents / 100
                );
            }

            if (result.success) {
                this._closeModal();
                
                // Show success toast
                const cost = this.currentPurchase.priceCents / 100;
                this.toastManager.show(`Purchase successful! $${cost.toFixed(2)} deducted`, 'success', 3000);

                // Call success callback
                if (this.onConfirmCallback) {
                    await this.onConfirmCallback(result);
                }
            } else {
                throw new Error(result.error || 'Purchase failed');
            }

        } catch (error) {
            console.error('Purchase execution error:', error);
            
            // Show error in modal
            const modalBody = document.querySelector('#purchaseConfirmationModal .modal-body');
            if (modalBody) {
                modalBody.innerHTML = `
                    <div class="checkout-message">
                        <div class="icon-error">❌</div>
                        <p>Purchase failed: ${error.message}</p>
                        <button class="auth-btn" id="modalRetryBtn">Try Again</button>
                    </div>
                `;

                document.getElementById('modalRetryBtn')?.addEventListener('click', () => {
                    this._closeModal();
                    // Re-show the modal to retry
                    setTimeout(() => {
                        this._showModal(this.currentPurchase);
                    }, 100);
                });
            }
        }
    }

    /**
     * Check checkout state with backend
     */
    async _checkCheckoutState(priceCents, contentId = null) {
        try {
            return await this.apiService.checkCheckoutState(priceCents, contentId);
        } catch (error) {
            console.error('Checkout state check failed:', error);
            // Default to requiring authentication if check fails
            return {
                next_required_action: 'authenticate',
                is_authenticated: false,
                balance_cents: 0,
                required_amount_cents: priceCents,
                shortfall_cents: priceCents,
                already_purchased: false,
                message: 'Please log in to continue'
            };
        }
    }

    /**
     * Get pricing quote from backend
     */
    async _getPricingQuote(query, outlineStructure) {
        try {
            return await this.apiService.getPricingQuote(query, outlineStructure);
        } catch (error) {
            console.error('Pricing quote failed:', error);
            return {
                success: false,
                calculated_price: 0,
                new_source_count: 0,
                previous_source_count: 0
            };
        }
    }

    /**
     * Calculate summary price from source
     */
    _calculateSummaryPrice(source) {
        // Use unlock_price or licensing_cost from Tollbit enrichment, or 0 (free) if no pricing
        return source.unlock_price || source.licensing_cost || 0;
    }

    /**
     * Close and remove modal
     */
    _closeModal() {
        const modal = document.getElementById('purchaseConfirmationModal');
        if (modal) {
            modal.remove();
        }
        this.currentPurchase = null;
        this.onConfirmCallback = null;
    }

    /**
     * Escape HTML to prevent XSS
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
