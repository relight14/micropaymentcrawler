class ResearchApp {
    constructor() {
        this.selectedTier = null;
        this.currentQuery = '';
        this.apiBase = window.location.origin;
        this.walletBalance = 100.00; // Mock wallet balance
        this.pendingTransaction = null; // Store pending transaction details
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const queryInput = document.getElementById('queryInput');
        const searchButton = document.getElementById('searchButton');
        const purchaseButton = document.getElementById('purchaseButton');

        // Modal elements
        const walletModal = document.getElementById('walletModal');
        const closeModal = document.querySelector('.close');
        const cancelPayment = document.getElementById('cancelPayment');
        const confirmPayment = document.getElementById('confirmPayment');
        

        // Search functionality
        searchButton.addEventListener('click', () => this.handleSearch());
        queryInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSearch();
            }
        });

        // Purchase functionality
        purchaseButton.addEventListener('click', (e) => {
            e.preventDefault();
            this.showWalletModal('tier');
        });

        // Modal functionality
        closeModal.addEventListener('click', () => this.hideWalletModal());
        cancelPayment.addEventListener('click', () => this.hideWalletModal());
        confirmPayment.addEventListener('click', () => this.confirmPayment());

        // Close modal when clicking outside
        walletModal.addEventListener('click', (e) => {
            if (e.target === walletModal) {
                this.hideWalletModal();
            }
        });

        // Enable search button when query is entered
        queryInput.addEventListener('input', (e) => {
            searchButton.disabled = !e.target.value.trim();
        });
    }

    async handleSearch() {
        const query = document.getElementById('queryInput').value.trim();
        if (!query) return;

        this.currentQuery = query;
        this.showLoading(true);
        this.hideAllSections();

        try {
            const response = await fetch(`${this.apiBase}/tiers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.displayTiers(data.tiers);
        } catch (error) {
            console.error('Search error:', error);
            this.showError('Failed to fetch research options. Please try again.');
        } finally {
            this.showLoading(false);
        }
    }

    displayTiers(tiers) {
        const tiersGrid = document.getElementById('tiersGrid');
        const tiersSection = document.getElementById('tiersSection');
        
        tiersGrid.innerHTML = '';
        
        tiers.forEach(tier => {
            const tierCard = this.createTierCard(tier);
            tiersGrid.appendChild(tierCard);
        });
        
        tiersSection.style.display = 'block';
        this.updatePurchaseButton();
    }

    createTierCard(tier) {
        const card = document.createElement('div');
        card.className = 'tier-card';
        card.dataset.tier = tier.tier;
        
        const features = [
            `${tier.sources} research sources`,
            'Comprehensive summary'
        ];
        
        if (tier.includes_outline) {
            features.push('Structured research outline');
        }
        
        if (tier.includes_insights) {
            features.push('Strategic insights & analysis');
        }

        card.innerHTML = `
            <h3>${this.formatTierName(tier.tier)}</h3>
            <div class="tier-price">$${tier.price.toFixed(2)}</div>
            <div class="tier-description">${tier.description}</div>
            <ul class="tier-features">
                ${features.map(feature => `<li>${feature}</li>`).join('')}
            </ul>
        `;

        card.addEventListener('click', () => this.selectTier(tier.tier, card));
        
        return card;
    }

    formatTierName(tier) {
        return tier.charAt(0).toUpperCase() + tier.slice(1);
    }

    selectTier(tierType, cardElement) {
        // Remove selection from all cards
        document.querySelectorAll('.tier-card').forEach(card => {
            card.classList.remove('selected');
        });

        // Select current card
        cardElement.classList.add('selected');
        this.selectedTier = tierType;
        this.updatePurchaseButton();
    }

    updatePurchaseButton() {
        const purchaseButton = document.getElementById('purchaseButton');
        purchaseButton.disabled = !this.selectedTier;
        
        if (this.selectedTier) {
            purchaseButton.textContent = `Pay Now - ${this.formatTierName(this.selectedTier)}`;
        } else {
            purchaseButton.textContent = 'Pay Now';
        }
    }

    showWalletModal(type, itemDetails = null) {
        const modal = document.getElementById('walletModal');
        const balanceElement = document.getElementById('walletBalance');
        const itemElement = document.getElementById('transactionItem');
        const amountElement = document.getElementById('transactionAmount');
        const totalElement = document.getElementById('transactionTotal');

        // Update balance display
        balanceElement.textContent = `$${this.walletBalance.toFixed(2)}`;

        let price, description;
        
        if (type === 'tier') {
            const tierPrices = { basic: 1.00, research: 2.00, pro: 4.00 };
            price = tierPrices[this.selectedTier];
            description = `${this.formatTierName(this.selectedTier)} Research Package`;
        } else if (type === 'source') {
            price = itemDetails.price;
            description = `Unlock: ${itemDetails.title}`;
        }

        // Store pending transaction
        this.pendingTransaction = {
            type: type,
            price: price,
            description: description,
            itemDetails: itemDetails
        };

        // Update modal content
        itemElement.textContent = description;
        amountElement.textContent = `$${price.toFixed(2)}`;
        totalElement.textContent = `$${price.toFixed(2)}`;

        // Check if user has sufficient balance
        const confirmButton = document.getElementById('confirmPayment');
        if (this.walletBalance < price) {
            confirmButton.disabled = true;
            confirmButton.textContent = 'Insufficient Balance';
            confirmButton.style.background = '#dc3545';
        } else {
            confirmButton.disabled = false;
            confirmButton.textContent = 'Confirm Payment';
            confirmButton.style.background = '#28a745';
        }

        modal.style.display = 'block';
    }

    hideWalletModal() {
        const modal = document.getElementById('walletModal');
        modal.style.display = 'none';
        this.pendingTransaction = null;
    }

    async confirmPayment() {
        if (!this.pendingTransaction) return;

        const { type, price, itemDetails } = this.pendingTransaction;

        // Check balance
        if (this.walletBalance < price) {
            this.showError('Insufficient wallet balance');
            return;
        }

        this.hideWalletModal();
        
        if (type === 'tier') {
            await this.processTierPurchase();
        } else if (type === 'source') {
            await this.processSourceUnlock(itemDetails);
        }
    }

    async processTierPurchase() {
        if (!this.selectedTier || !this.currentQuery) return;

        this.showLoading(true);
        this.hideAllSections();

        try {
            const response = await fetch(`${this.apiBase}/purchase`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    query: this.currentQuery,
                    tier: this.selectedTier,
                    user_wallet_id: 'demo_wallet_' + Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Update wallet balance
                this.walletBalance -= data.wallet_deduction;
                this.displayResearchPacket(data.packet);
                this.showSuccess(`Payment processed successfully! $${data.wallet_deduction} deducted from wallet.`);
            } else {
                throw new Error(data.message || 'Purchase failed');
            }
        } catch (error) {
            console.error('Purchase error:', error);
            this.showError('Purchase failed. Please check your wallet balance and try again.');
        } finally {
            this.showLoading(false);
        }
    }

    async processSourceUnlock(itemDetails) {
        try {
            const response = await fetch(`${this.apiBase}/unlock-source`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    source_id: itemDetails.id,
                    price: itemDetails.price,
                    title: itemDetails.title,
                    user_wallet_id: 'demo_wallet_' + Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Update wallet balance
                this.walletBalance -= data.wallet_deduction;
                
                // Find and update the source card to show unlocked content
                const sourceCard = document.querySelector(`[data-source-id="${itemDetails.id}"]`);
                if (sourceCard) {
                    const contentDiv = sourceCard.querySelector('.source-content');
                    if (contentDiv) {
                        contentDiv.innerHTML = `<div class="unlocked-content">${data.unlocked_content.replace(/\n/g, '<br>')}</div>`;
                    }
                    
                    // Hide the unlock button
                    const unlockBtn = sourceCard.querySelector('.unlock-source-btn');
                    if (unlockBtn) {
                        unlockBtn.style.display = 'none';
                    }
                }
                
                this.showSuccess(`Source unlocked successfully! $${data.wallet_deduction.toFixed(2)} deducted from wallet.`);
            } else {
                throw new Error(data.message || 'Source unlock failed');
            }
        } catch (error) {
            console.error('Source unlock error:', error);
            this.showError('Source unlock failed. Please check your wallet balance and try again.');
        }
    }

    displayResearchPacket(packet) {
        // Update packet header
        document.getElementById('packetTitle').textContent = packet.query;
        document.getElementById('packetMeta').textContent = 
            `${this.formatTierName(packet.tier)} Tier • ${packet.total_sources} Sources`;

        // Display summary
        document.getElementById('packetSummaryContent').innerHTML = 
            this.formatText(packet.summary);

        // Display outline if available
        const outlineSection = document.getElementById('packetOutlineSection');
        if (packet.outline) {
            document.getElementById('packetOutlineContent').textContent = packet.outline;
            outlineSection.style.display = 'block';
        } else {
            outlineSection.style.display = 'none';
        }

        // Display insights if available
        const insightsSection = document.getElementById('packetInsightsSection');
        if (packet.insights) {
            document.getElementById('packetInsightsContent').textContent = packet.insights;
            insightsSection.style.display = 'block';
        } else {
            insightsSection.style.display = 'none';
        }

        // Display sources
        this.displaySources(packet.sources);

        // Show packet section
        document.getElementById('packetSection').style.display = 'block';
    }

    displaySources(sources) {
        const sourcesGrid = document.getElementById('sourcesGrid');
        const sourcesTitle = document.getElementById('sourcesTitle');
        
        sourcesTitle.textContent = `Research Sources (${sources.length})`;
        sourcesGrid.innerHTML = '';

        sources.forEach(source => {
            const sourceCard = this.createSourceCard(source);
            sourcesGrid.appendChild(sourceCard);
        });
    }

    createSourceCard(source) {
        const card = document.createElement('div');
        card.className = 'source-card';
        card.setAttribute('data-source-id', source.id);

        card.innerHTML = `
            <div class="source-header">
                <div style="flex-grow: 1;">
                    <div class="source-title">${source.title}</div>
                    <div class="source-domain">${source.domain}</div>
                </div>
            </div>
            <div class="source-content">
                <div class="source-excerpt">${source.excerpt}</div>
            </div>
            <button class="unlock-button unlock-source-btn" onclick="app.handleSourceUnlock('${source.id}', ${source.unlock_price}, '${source.title.replace(/'/g, "\\'")}')">
                🔓 Unlock Full Source - $${source.unlock_price.toFixed(2)}
            </button>
        `;

        return card;
    }

    handleSourceUnlock(sourceId, price, title) {
        this.showWalletModal('source', {
            id: sourceId,
            price: price,
            title: title
        });
    }

    formatText(text) {
        return text.replace(/\n/g, '<br>').replace(/\n\n/g, '<br><br>');
    }

    showLoading(show) {
        document.getElementById('loadingSection').style.display = show ? 'block' : 'none';
    }

    hideAllSections() {
        document.getElementById('tiersSection').style.display = 'none';
        document.getElementById('packetSection').style.display = 'none';
        this.clearMessages();
    }

    showError(message) {
        this.clearMessages();
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = message;
        document.querySelector('.container').appendChild(errorDiv);
    }

    showSuccess(message) {
        this.clearMessages();
        const successDiv = document.createElement('div');
        successDiv.className = 'success';
        successDiv.textContent = message;
        document.querySelector('.container').appendChild(successDiv);
    }

    clearMessages() {
        document.querySelectorAll('.error, .success').forEach(el => el.remove());
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ResearchApp();
    // Initialize search button state
    document.getElementById('searchButton').disabled = true;
});