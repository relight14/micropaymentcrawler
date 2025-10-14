/**
 * ReportBuilder Component
 * Handles report tier selection, generation, and display
 * Uses event-based architecture for loose coupling
 */

// Tier configuration constant
const TIERS = [
    {
        id: 'research',
        icon: '🔬',
        title: 'Research Package',
        price: 0.99,
        description: 'Professional summary and analysis with source compilation',
        features: [
            '✓ Professional summary and analysis',
            '✓ Source compilation and citations',
            '✓ Ready for download'
        ],
        buttonText: 'Purchase Research Package',
        highlighted: true
    },
    {
        id: 'pro',
        icon: '⭐',
        title: 'Pro Package',
        price: 1.99,
        description: 'Everything in Research plus strategic insights and executive formatting',
        features: [
            '✓ Everything in Research Package',
            '✓ Strategic insights and recommendations',
            '✓ Executive summary format',
            '✓ Enhanced formatting and presentation'
        ],
        buttonText: 'Purchase Pro Package',
        highlighted: false
    }
];

export class ReportBuilder extends EventTarget {
    constructor({ appState, apiService, authService, toastManager, uiManager }) {
        super();
        this.appState = appState;
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.uiManager = uiManager;
    }

    /**
     * Shows the report builder interface
     * @returns {HTMLElement} The report builder DOM element
     */
    show() {
        const container = this._generateReportBuilderDOM();
        
        // Attach event listeners after DOM is created
        setTimeout(() => this._attachTierPurchaseListeners(), 0);
        
        return container;
    }

    /**
     * Generates a report from selected sources
     * @param {HTMLButtonElement} button - The purchase button
     * @param {string} tier - Tier ID (research/pro)
     * @param {string} query - Research query
     * @param {Array} selectedSources - Selected sources array
     */
    async generateReport(button, tier, query, selectedSources) {
        if (!this.authService.isAuthenticated()) {
            this.dispatchEvent(new CustomEvent('authRequired', {
                detail: { message: 'Please log in to generate a report.' }
            }));
            return;
        }

        try {
            // Extract source IDs
            const selectedSourceIds = selectedSources.map(source => source.id);
            
            console.log(`📊 Generating ${tier} report with ${selectedSourceIds.length} selected sources`);
            
            // Dispatch loading event
            this.dispatchEvent(new CustomEvent('reportGenerating', {
                detail: { tier, sourceCount: selectedSourceIds.length }
            }));
            
            // Call API to generate report
            const reportPacket = await this.apiService.generateReport(query, tier, selectedSourceIds);
            
            if (reportPacket) {
                // Update button state
                if (button) {
                    button.textContent = 'Report Generated';
                    button.disabled = true;
                }
                
                // Dispatch success event with report data
                this.dispatchEvent(new CustomEvent('reportGenerated', {
                    detail: {
                        reportData: reportPacket,
                        tier,
                        sourceCount: selectedSourceIds.length
                    }
                }));
            }
        } catch (error) {
            console.error('Error generating report:', error);
            
            // Dispatch error event
            this.dispatchEvent(new CustomEvent('reportError', {
                detail: { error, tier }
            }));
            
            // Reset button state
            if (button) {
                button.textContent = `Generate ${tier === 'research' ? 'Research' : 'Pro'} Report`;
                button.disabled = false;
            }
        }
    }

    /**
     * Displays a generated report
     * @param {Object} reportData - Report data from API
     * @returns {Object} Message object ready for display
     */
    displayReport(reportData) {
        console.log('📊 DISPLAY REPORT: Displaying generated report:', reportData);
        console.log('🔍 CITATION DEBUG: citation_metadata =', reportData.citation_metadata);
        
        if (!reportData || !reportData.summary) {
            console.error('❌ DISPLAY REPORT: Invalid report data:', reportData);
            return null;
        }
        
        // Build report header
        const headerText = `# Research Report: ${reportData.query}\n**${(reportData.tier || 'research').toUpperCase()} TIER**\n\n`;
        
        // Build complete report content
        let reportContent = headerText + reportData.summary;
        
        // Add outline if available
        if (reportData.outline) {
            reportContent += '\n\n' + reportData.outline;
        }
        
        // Add insights if available
        if (reportData.insights) {
            reportContent += '\n\n' + reportData.insights;
        }
        
        // Add footer
        const sourceCount = reportData.total_sources || reportData.sources?.length || 0;
        reportContent += `\n\n---\n*Generated from ${sourceCount} sources*`;
        
        // Return message object for display
        return {
            sender: 'assistant',
            content: reportContent,
            metadata: {
                type: 'research_report',
                tier: reportData.tier,
                query: reportData.query,
                sources_count: sourceCount,
                citation_metadata: reportData.citation_metadata || null
            }
        };
    }

    /**
     * Generates the report builder DOM structure
     * @private
     * @returns {HTMLElement}
     */
    _generateReportBuilderDOM() {
        const selectedSources = this.appState.getSelectedSources();
        const sourceCount = selectedSources.length;
        const totalCost = this.appState.getSelectedSourcesTotal();
        
        const container = document.createElement('div');
        container.className = 'tier-cards-section';
        
        // Header
        container.appendChild(this._createHeader());
        
        // Selected sources section (if any)
        if (sourceCount > 0) {
            container.appendChild(this._createSelectedSourcesSection(selectedSources, sourceCount, totalCost));
        }
        
        // Tier cards
        container.appendChild(this._createTierCardsContainer());
        
        // Note
        container.appendChild(this._createNote());
        
        return container;
    }

    /**
     * Creates header section
     * @private
     */
    _createHeader() {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'tier-cards-header';
        
        const headerTitle = document.createElement('h3');
        headerTitle.textContent = 'Choose Your Research Package';
        
        const headerDesc = document.createElement('p');
        headerDesc.textContent = 'Select the perfect research tier for your needs. Report generation begins after purchase confirmation.';
        
        headerDiv.appendChild(headerTitle);
        headerDiv.appendChild(headerDesc);
        
        return headerDiv;
    }

    /**
     * Creates selected sources section
     * @private
     */
    _createSelectedSourcesSection(selectedSources, sourceCount, totalCost) {
        const sourcesSection = document.createElement('div');
        sourcesSection.className = 'selected-sources-section';
        
        // Section header
        const sourcesHeader = document.createElement('h4');
        sourcesHeader.textContent = `Selected Sources (${sourceCount})`;
        sourcesSection.appendChild(sourcesHeader);
        
        // Sources list
        const sourcesList = document.createElement('div');
        sourcesList.className = 'selected-sources-list';
        
        selectedSources.forEach(source => {
            sourcesList.appendChild(this._createSourceItem(source, sourcesHeader, sourcesSection));
        });
        
        sourcesSection.appendChild(sourcesList);
        
        // Total cost summary
        const costSummary = document.createElement('div');
        costSummary.className = 'sources-cost-summary';
        costSummary.textContent = `Total licensing cost: $${Number(totalCost || 0).toFixed(2)}`;
        sourcesSection.appendChild(costSummary);
        
        return sourcesSection;
    }

    /**
     * Creates individual source item
     * @private
     */
    _createSourceItem(source, sourcesHeader, sourcesSection) {
        const sourceItem = document.createElement('div');
        sourceItem.className = 'selected-source-item';
        
        // Title (clickable if URL available)
        const titleDiv = document.createElement('div');
        titleDiv.className = 'source-title';
        if (source.url) {
            const titleLink = document.createElement('a');
            titleLink.href = source.url;
            titleLink.target = '_blank';
            titleLink.textContent = source.title || 'Untitled Source';
            titleDiv.appendChild(titleLink);
        } else {
            titleDiv.textContent = source.title || 'Untitled Source';
        }
        
        // Author and domain
        const metaDiv = document.createElement('div');
        metaDiv.className = 'source-meta';
        const authorText = source.author ? `${source.author} • ` : '';
        const domainText = source.domain || 'Unknown Domain';
        metaDiv.textContent = `${authorText}${domainText}`;
        
        // Excerpt
        const excerptDiv = document.createElement('div');
        excerptDiv.className = 'source-excerpt';
        excerptDiv.textContent = source.excerpt || 'No preview available.';
        
        // Licensing and remove button
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'source-actions';
        
        // Licensing protocol badge
        if (source.licensing_protocol) {
            const licenseSpan = document.createElement('span');
            licenseSpan.className = `license-badge ${source.licensing_protocol.toLowerCase()}`;
            licenseSpan.textContent = source.licensing_protocol;
            actionsDiv.appendChild(licenseSpan);
        }
        
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'source-remove-btn';
        removeBtn.textContent = '🗑️';
        removeBtn.title = 'Remove from selection';
        removeBtn.onclick = () => {
            this.appState.toggleSourceSelection(source.id, source);
            sourceItem.remove();
            // Update header count
            const remaining = this.appState.getSelectedSourcesCount();
            sourcesHeader.textContent = `Selected Sources (${remaining})`;
            if (remaining === 0) {
                sourcesSection.remove();
            }
        };
        actionsDiv.appendChild(removeBtn);
        
        sourceItem.appendChild(titleDiv);
        sourceItem.appendChild(metaDiv);
        sourceItem.appendChild(excerptDiv);
        sourceItem.appendChild(actionsDiv);
        
        return sourceItem;
    }

    /**
     * Creates tier cards container using template literals
     * @private
     */
    _createTierCardsContainer() {
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'tier-cards-container';
        
        // Create tier cards from config
        TIERS.forEach(tier => {
            cardsContainer.appendChild(this._createTierCard(tier));
        });
        
        return cardsContainer;
    }

    /**
     * Creates individual tier card
     * @private
     */
    _createTierCard(tier) {
        const cardDiv = document.createElement('div');
        cardDiv.className = tier.highlighted ? 'tier-card highlighted' : 'tier-card';
        cardDiv.dataset.tier = tier.id;
        
        cardDiv.innerHTML = `
            <div class="tier-icon">${tier.icon}</div>
            <h4>${tier.title}</h4>
            <div class="tier-price">$${tier.price.toFixed(2)}</div>
            <p class="tier-description">${tier.description}</p>
            <ul class="tier-features">
                ${tier.features.map(feature => `<li>${feature}</li>`).join('')}
            </ul>
            <button class="tier-purchase-btn" data-tier="${tier.id}" data-price="${tier.price}">
                ${tier.buttonText}
            </button>
        `;
        
        return cardDiv;
    }

    /**
     * Creates note section
     * @private
     */
    _createNote() {
        const noteDiv = document.createElement('div');
        noteDiv.className = 'tier-cards-note';
        noteDiv.textContent = '💡 Report generation will begin only after purchase confirmation.';
        return noteDiv;
    }

    /**
     * Attaches event listeners to purchase buttons
     * @private
     */
    _attachTierPurchaseListeners() {
        const purchaseButtons = document.querySelectorAll('.tier-purchase-btn');
        purchaseButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const tier = e.target.dataset.tier;
                const price = parseFloat(e.target.dataset.price);
                const query = this.appState.getCurrentQuery() || "Research Query";
                
                e.target.textContent = 'Processing...';
                e.target.disabled = true;
                
                const selectedSources = this.appState.getSelectedSources();
                const useSelectedSources = selectedSources && selectedSources.length > 0;
                
                // Always dispatch purchase event - this ensures the modal always shows
                this.dispatchEvent(new CustomEvent('tierPurchase', {
                    detail: { 
                        tier, 
                        price, 
                        query,
                        useSelectedSources,
                        button: e.target
                    }
                }));
            });
        });
    }

    /**
     * Updates the report builder display (placeholder for future enhancements)
     */
    update() {
        console.log('Report builder display updated');
    }
}
