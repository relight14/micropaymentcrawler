class ResearchApp {
    constructor() {
        this.selectedTier = null;
        this.currentQuery = '';
        this.apiBase = window.location.origin;
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const queryInput = document.getElementById('queryInput');
        const searchButton = document.getElementById('searchButton');
        const purchaseButton = document.getElementById('purchaseButton');

        // Search functionality
        searchButton.addEventListener('click', () => this.handleSearch());
        queryInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSearch();
            }
        });

        // Purchase functionality
        purchaseButton.addEventListener('click', () => this.handlePurchase());

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

    async handlePurchase() {
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

        card.innerHTML = `
            <div class="source-header">
                <div style="flex-grow: 1;">
                    <div class="source-title">${source.title}</div>
                    <div class="source-domain">${source.domain}</div>
                </div>
            </div>
            <div class="source-excerpt">${source.excerpt}</div>
            <button class="unlock-button" onclick="app.handleSourceUnlock('${source.id}', ${source.unlock_price})">
                🔓 Unlock Full Source - $${source.unlock_price.toFixed(2)}
            </button>
        `;

        return card;
    }

    handleSourceUnlock(sourceId, price) {
        // For MVP, this is just UI demonstration
        alert(`Source unlock feature coming soon!\n\nThis would unlock the full source for $${price.toFixed(2)} from your wallet.\n\nSource ID: ${sourceId}`);
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
});

// Initialize search button state
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('searchButton').disabled = true;
});