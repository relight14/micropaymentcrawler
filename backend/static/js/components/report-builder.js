/**
 * ReportBuilder Component
 * Handles report tier selection, generation, and display
 * Uses event-based architecture for loose coupling
 */

import { analytics } from '../utils/analytics.js';
import { projectStore } from '../state/project-store.js';
import { TIERS, calculateProPrice, PER_SOURCE_RATE } from '../config/tier-catalog.js';

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
     * Get sources from outline (single source of truth)
     * @private
     * @returns {Object} { sources: Array, count: number, totalPrice: number }
     */
    _getOutlineSourcesFromStore() {
        const outlineSnapshot = projectStore.getOutlineSnapshot();
        
        // Flatten all sources from all sections and DEDUPLICATE by ID
        const sourceMap = new Map();
        if (outlineSnapshot && outlineSnapshot.sections) {
            outlineSnapshot.sections.forEach(section => {
                if (section.sources && Array.isArray(section.sources)) {
                    section.sources.forEach(source => {
                        // Only add if it has an ID and we haven't seen it before
                        if (source && source.id && !sourceMap.has(source.id)) {
                            sourceMap.set(source.id, source);
                        }
                    });
                }
            });
        }
        
        const sources = Array.from(sourceMap.values());
        const count = sources.length;
        const totalPrice = calculateProPrice(count);
        
        return { sources, count, totalPrice };
    }

    /**
     * Shows the report builder interface
     * @returns {HTMLElement} The report builder DOM element
     */
    show() {
        // Render DOM with static pricing first (optimistic render)
        const container = this._generateReportBuilderDOM();
        
        // Attach event listeners after DOM is created
        setTimeout(() => this._attachTierPurchaseListeners(), 0);
        
        // Fetch dynamic pricing asynchronously and patch DOM when ready
        this._fetchAndUpdatePricing();
        
        return container;
    }
    
    /**
     * Fetch pricing quotes and update DOM when ready
     * @private
     */
    async _fetchAndUpdatePricing() {
        if (!this.authService.isAuthenticated()) {
            // User not logged in - pricing already calculated from sources × $0.05
            return;
        }
        
        const query = this.appState.getCurrentQuery() || projectStore.getResearchQuery() || "Research Query";
        const outlineStructure = projectStore.getOutlineSnapshot();
        
        try {
            // Fetch quote for Pro tier only
            const proQuote = await this.apiService.getPricingQuote('pro', query, outlineStructure);
            
            this.pricingQuotes = { pro: proQuote };
            
            console.log('💵 Pro pricing quote fetched:', proQuote);
            
            // Update Pro tier card with backend quote (may differ from local calculation)
            this._updateTierCardPricing('pro', proQuote);
            
        } catch (error) {
            console.error('Failed to fetch pricing quote:', error);
            // Fallback: Keep local calculation (sources × $0.05)
            this.pricingQuotes = {};
        }
    }
    
    /**
     * Update tier card with dynamic pricing
     * @param {string} tierId - Tier ID (pro)
     * @param {Object} quote - Pricing quote object
     * @private
     */
    _updateTierCardPricing(tierId, quote) {
        const tierCard = document.querySelector(`[data-tier-id="${tierId}"]`);
        if (!tierCard) return;
        
        const priceElement = tierCard.querySelector('.tier-price');
        const detailsElement = tierCard.querySelector('.tier-pricing-details');
        const buttonElement = tierCard.querySelector('.tier-purchase-btn');
        
        if (!priceElement) return;
        
        // Check if quote is unavailable (error fallback)
        if (quote.quote_unavailable) {
            const price = quote.calculated_price || 0;
            priceElement.textContent = `$${price.toFixed(2)}`;
            
            // Update button text with price
            if (buttonElement) {
                buttonElement.textContent = `Generate Pro Report — $${price.toFixed(2)}`;
                buttonElement.dataset.price = price.toFixed(2);
            }
            
            if (detailsElement) {
                detailsElement.textContent = 'Quote unavailable — showing list price';
                detailsElement.style.display = 'block';
                detailsElement.style.color = '#999';
            }
            
            // Mark tier card with quote unavailable flag
            tierCard.dataset.quoteUnavailable = 'true';
            tierCard.dataset.actualPrice = price.toFixed(2);
            return;
        }
        
        const price = quote.calculated_price || 0;
        const newSourceCount = quote.new_source_count || 0;
        const previousSourceCount = quote.previous_source_count || 0;
        const totalSourceCount = newSourceCount + previousSourceCount;
        
        // Update price display
        priceElement.textContent = `$${price.toFixed(2)}`;
        
        // Update button text with price
        if (buttonElement) {
            buttonElement.textContent = `Generate Pro Report — $${price.toFixed(2)}`;
            buttonElement.dataset.price = price.toFixed(2);
        }
        
        // Update header source count with backend's authoritative count
        const progressTitle = document.querySelector('.progress-title');
        if (progressTitle && totalSourceCount > 0) {
            progressTitle.textContent = `${totalSourceCount} Sources Ready`;
        }
        
        // Update pricing details with full transparency
        if (detailsElement) {
            detailsElement.style.color = '#666'; // Reset color for successful quotes
            
            if (previousSourceCount > 0) {
                // Incremental purchase - show previous + new sources
                detailsElement.textContent = `${previousSourceCount} already owned, ${newSourceCount} new at $0.05 each`;
                detailsElement.style.display = 'block';
            } else if (newSourceCount > 0) {
                // First purchase
                detailsElement.textContent = `${newSourceCount} source${newSourceCount !== 1 ? 's' : ''} at $0.05 each`;
                detailsElement.style.display = 'block';
            } else {
                // No sources (edge case)
                detailsElement.textContent = 'No new sources to purchase';
                detailsElement.style.display = 'block';
            }
        }
        
        // Update data attribute for purchase flow
        tierCard.dataset.actualPrice = price.toFixed(2);
    }

    /**
     * Generates a report from selected sources
     * @param {HTMLButtonElement} button - The purchase button
     * @param {string} tier - Tier ID (pro)
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
            console.log(`📊 Generating ${tier} report with ${selectedSources.length} selected sources`);
            
            // Dispatch loading event
            this.dispatchEvent(new CustomEvent('reportGenerating', {
                detail: { tier, sourceCount: selectedSources.length }
            }));
            
            // Get outline structure from project store
            const outlineStructure = projectStore.getOutlineSnapshot();
            
            // Call API to generate report with full source objects and outline structure
            const reportPacket = await this.apiService.generateReport(query, tier, selectedSources, outlineStructure);
            
            if (reportPacket) {
                // Track report generation
                analytics.trackReportGenerate(selectedSources.length, tier);
                
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
                        sourceCount: selectedSources.length
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
                button.textContent = 'Generate Pro Report';
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
        
        // Check if this is new table-based format
        if (reportData.table_data && Array.isArray(reportData.table_data) && reportData.table_data.length > 0) {
            return this._displayTableReport(reportData);
        } else {
            // Fall back to markdown format for backward compatibility
            return this._displayMarkdownReport(reportData);
        }
    }

    /**
     * Displays a report in new table format
     * @private
     * @param {Object} reportData - Report data with table_data
     * @returns {Object} Message object with HTML content
     */
    _displayTableReport(reportData) {
        const container = document.createElement('div');
        container.className = 'research-report-container';
        
        // Build report header
        const header = this._createReportHeader(reportData);
        container.appendChild(header);
        
        // Build summary section
        const summarySection = this._createSection('Summary', reportData.summary);
        container.appendChild(summarySection);
        
        // Add Pro tier sections BEFORE table (for context/insights before data)
        if (reportData.conflicts) {
            const conflictsSection = this._createSection('Areas of Agreement & Conflict', reportData.conflicts);
            container.appendChild(conflictsSection);
        }
        
        if (reportData.research_directions && Array.isArray(reportData.research_directions)) {
            const directionsSection = this._createResearchDirectionsSection(reportData.research_directions);
            container.appendChild(directionsSection);
        }
        
        // Build research findings table (after context sections)
        const findingsSection = this._createFindingsSection(reportData.table_data);
        container.appendChild(findingsSection);
        
        // Add footer
        const sourceCount = reportData.total_sources || reportData.table_data.length || 0;
        const footer = this._createReportFooter(sourceCount);
        container.appendChild(footer);
        
        // Return message object for display
        return {
            sender: 'assistant',
            content: container,
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
     * Displays a report in markdown format (backward compatibility)
     * @private
     * @param {Object} reportData - Report data with markdown content
     * @returns {Object} Message object with markdown content
     */
    _displayMarkdownReport(reportData) {
        // Build report header
        const headerText = `# Research Report: ${reportData.query}\n**${(reportData.tier || 'pro').toUpperCase()} TIER**\n\n`;
        
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
     * Creates report header with title and tier badge
     * @private
     */
    _createReportHeader(reportData) {
        const header = document.createElement('div');
        header.className = 'report-header';
        
        const title = document.createElement('h2');
        title.className = 'report-title';
        title.textContent = `Research Report: ${reportData.query}`;
        
        const tierBadge = document.createElement('span');
        tierBadge.className = `tier-badge tier-${reportData.tier || 'pro'}`;
        tierBadge.textContent = `${(reportData.tier || 'pro').toUpperCase()} TIER`;
        
        header.appendChild(title);
        header.appendChild(tierBadge);
        
        return header;
    }

    /**
     * Creates a text section with title and content
     * @private
     */
    _createSection(title, content) {
        const section = document.createElement('div');
        section.className = 'report-section';
        
        const sectionTitle = document.createElement('h3');
        sectionTitle.className = 'section-title';
        sectionTitle.textContent = title;
        
        const sectionContent = document.createElement('div');
        sectionContent.className = 'section-content';
        sectionContent.textContent = content;
        
        section.appendChild(sectionTitle);
        section.appendChild(sectionContent);
        
        return section;
    }

    /**
     * Creates research findings section with table
     * @private
     */
    _createFindingsSection(tableData) {
        const section = document.createElement('div');
        section.className = 'report-section';
        
        // Header with title and export button
        const sectionHeader = document.createElement('div');
        sectionHeader.className = 'findings-section-header';
        
        const title = document.createElement('h3');
        title.className = 'section-title';
        title.textContent = 'Research Findings';
        
        const exportBtn = document.createElement('button');
        exportBtn.className = 'csv-export-btn';
        exportBtn.innerHTML = '📥 Export to CSV';
        exportBtn.setAttribute('data-table-data', JSON.stringify(tableData));
        exportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this._exportToCSV(tableData);
        });
        
        sectionHeader.appendChild(title);
        sectionHeader.appendChild(exportBtn);
        
        const table = this._createFindingsTable(tableData);
        
        section.appendChild(sectionHeader);
        section.appendChild(table);
        
        return section;
    }

    /**
     * Creates HTML table from table_data, grouped by topic
     * @private
     */
    _createFindingsTable(tableData) {
        // Group entries by topic
        const groupedByTopic = {};
        tableData.forEach(entry => {
            const topic = entry.topic || 'General';
            if (!groupedByTopic[topic]) {
                groupedByTopic[topic] = [];
            }
            groupedByTopic[topic].push(entry);
        });
        
        // Create table
        const table = document.createElement('table');
        table.className = 'findings-table';
        
        // Create table header
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        ['Content/Quote', 'Takeaway', 'Topic', 'Source', 'Link'].forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        
        thead.appendChild(headerRow);
        table.appendChild(thead);
        
        // Create table body with grouped rows
        const tbody = document.createElement('tbody');
        
        Object.keys(groupedByTopic).forEach(topic => {
            const entries = groupedByTopic[topic];
            
            // Add topic header row
            const topicRow = document.createElement('tr');
            topicRow.className = 'topic-header-row';
            
            const topicCell = document.createElement('td');
            topicCell.colSpan = 5;
            topicCell.className = 'topic-header-cell';
            topicCell.textContent = topic;
            
            topicRow.appendChild(topicCell);
            tbody.appendChild(topicRow);
            
            // Add data rows for this topic
            entries.forEach((entry, index) => {
                const row = document.createElement('tr');
                row.className = 'finding-row';
                
                // Content/Quote cell
                const contentCell = document.createElement('td');
                contentCell.className = 'content-cell';
                contentCell.textContent = entry.content || '';
                row.appendChild(contentCell);
                
                // Takeaway cell
                const takeawayCell = document.createElement('td');
                takeawayCell.className = 'takeaway-cell';
                takeawayCell.textContent = entry.takeaway || '';
                row.appendChild(takeawayCell);
                
                // Topic cell
                const topicCell = document.createElement('td');
                topicCell.className = 'topic-cell';
                topicCell.textContent = entry.topic || '';
                row.appendChild(topicCell);
                
                // Source cell
                const sourceCell = document.createElement('td');
                sourceCell.className = 'source-cell';
                sourceCell.textContent = entry.source || '';
                row.appendChild(sourceCell);
                
                // Link cell
                const linkCell = document.createElement('td');
                linkCell.className = 'link-cell';
                if (entry.link) {
                    const link = document.createElement('a');
                    link.href = entry.link;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = '🔗';
                    link.title = 'View source';
                    linkCell.appendChild(link);
                } else {
                    linkCell.textContent = '-';
                }
                row.appendChild(linkCell);
                
                tbody.appendChild(row);
            });
        });
        
        table.appendChild(tbody);
        
        return table;
    }

    /**
     * Creates research directions section with bullet list
     * @private
     */
    _createResearchDirectionsSection(directions) {
        const section = document.createElement('div');
        section.className = 'report-section';
        
        const title = document.createElement('h3');
        title.className = 'section-title';
        title.textContent = 'Suggested Research Directions';
        
        const list = document.createElement('ul');
        list.className = 'research-directions-list';
        
        directions.forEach(direction => {
            const li = document.createElement('li');
            li.textContent = direction;
            list.appendChild(li);
        });
        
        section.appendChild(title);
        section.appendChild(list);
        
        return section;
    }

    /**
     * Creates report footer
     * @private
     */
    _createReportFooter(sourceCount) {
        const footer = document.createElement('div');
        footer.className = 'report-footer';
        
        const stats = document.createElement('p');
        stats.className = 'source-stats';
        stats.textContent = `Generated from ${sourceCount} sources`;
        
        footer.appendChild(stats);
        
        return footer;
    }

    /**
     * Exports table data to CSV format and triggers download
     * @private
     */
    _exportToCSV(tableData) {
        if (!tableData || tableData.length === 0) {
            console.warn('No table data to export');
            return;
        }

        // CSV headers
        const headers = ['Topic', 'Source', 'Content/Quote', 'Takeaway', 'Link'];
        
        // Convert table data to CSV rows
        const rows = tableData.map(row => [
            this._escapeCSV(row.topic || ''),
            this._escapeCSV(row.source || ''),
            this._escapeCSV(row.content || ''),
            this._escapeCSV(row.takeaway || ''),
            row.link || ''
        ]);
        
        // Combine headers and rows
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');
        
        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        // Generate filename with timestamp
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `research-findings-${timestamp}.csv`;
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        console.log(`✅ Exported ${tableData.length} rows to ${filename}`);
    }

    /**
     * Escapes CSV field values (handles quotes, commas, newlines)
     * @private
     */
    _escapeCSV(field) {
        if (field == null) return '';
        
        const stringField = String(field);
        
        // If field contains comma, quote, or newline, wrap in quotes and escape internal quotes
        if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
            return `"${stringField.replace(/"/g, '""')}"`;
        }
        
        return stringField;
    }

    /**
     * Generates the report builder DOM structure
     * @private
     * @returns {HTMLElement}
     */
    _generateReportBuilderDOM() {
        // Get sources from outline (single source of truth)
        const { sources, count: sourceCount, totalPrice } = this._getOutlineSourcesFromStore();
        
        // Create modal-style takeover container
        const container = document.createElement('div');
        container.className = 'tier-selection-takeover';
        
        // Progress narrative header
        const progressHeader = document.createElement('div');
        progressHeader.className = 'tier-progress-header';
        progressHeader.innerHTML = `
            <div class="progress-checkmark">✅</div>
            <div class="progress-content">
                <div class="progress-title">${sourceCount} Sources Ready</div>
                <div class="progress-subtitle">Your Research Package → Report Generation Begins</div>
            </div>
        `;
        container.appendChild(progressHeader);
        
        // Main content area
        const contentArea = document.createElement('div');
        contentArea.className = 'tier-selection-content';
        
        // Header
        contentArea.appendChild(this._createHeader());
        
        // Tier cards (Pro tier only)
        contentArea.appendChild(this._createTierCardsContainer());
        
        // Security footer
        contentArea.appendChild(this._createSecurityFooter());
        
        container.appendChild(contentArea);
        
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
        headerTitle.textContent = 'Your Research Package';
        
        headerDiv.appendChild(headerTitle);
        
        return headerDiv;
    }

    /**
     * Creates tier cards container with asymmetric layout
     * @private
     */
    _createTierCardsContainer() {
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'tier-cards-asymmetric';
        
        // Create tier card (Pro tier only)
        TIERS.forEach(tier => {
            cardsContainer.appendChild(this._createTierCard(tier));
        });
        
        return cardsContainer;
    }

    /**
     * Creates individual tier card with new asymmetric design
     * @private
     */
    _createTierCard(tier) {
        // Calculate dynamic pricing based on outline sources (single source of truth)
        const { count: sourceCount, totalPrice: calculatedPrice } = this._getOutlineSourcesFromStore();
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'tier-card tier-card-pro'; // Only Pro tier now
        cardDiv.dataset.tier = tier.id;
        cardDiv.dataset.tierId = tier.id; // For DOM querying in price updates
        cardDiv.dataset.actualPrice = calculatedPrice.toFixed(2);
        
        const badgeHTML = tier.badge ? `<div class="tier-badge">${tier.badge}</div>` : '';
        const microcopyHTML = tier.microcopy ? `<div class="tier-microcopy">${tier.microcopy}</div>` : '';
        
        // Dynamic pricing labels
        const priceLabel = `$${calculatedPrice.toFixed(2)}`;
        const buttonText = `Generate Pro Report — $${calculatedPrice.toFixed(2)}`;
        const pricingDetails = `${sourceCount} source${sourceCount !== 1 ? 's' : ''} at $${PER_SOURCE_RATE.toFixed(2)} each`;
        
        cardDiv.innerHTML = `
            ${badgeHTML}
            <div class="tier-icon">${tier.icon}</div>
            <h4 class="tier-title-new">${tier.title}</h4>
            <div class="tier-price tier-price-new">${priceLabel}</div>
            <div class="tier-pricing-details" style="display: block; font-size: 0.8rem; color: #666; margin-top: 4px;">${pricingDetails}</div>
            <div class="tier-subtitle">${tier.subtitle}</div>
            <ul class="tier-features-compact">
                ${tier.features.map(feature => `<li>✓ ${feature}</li>`).join('')}
            </ul>
            <button class="tier-purchase-btn tier-btn-primary" data-tier="${tier.id}" data-price="${calculatedPrice.toFixed(2)}">
                ${buttonText}
            </button>
            ${microcopyHTML}
        `;
        
        return cardDiv;
    }

    /**
     * Creates security footer
     * @private
     */
    _createSecurityFooter() {
        const footer = document.createElement('div');
        footer.className = 'tier-security-footer';
        footer.innerHTML = `
            <span class="security-icon">🔒</span>
            <span class="security-text">Secure checkout</span>
        `;
        return footer;
    }

    /**
     * Creates note section (legacy, no longer used)
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
            button.addEventListener('click', async (e) => {
                const tier = e.target.dataset.tier;
                const query = this.appState.getCurrentQuery() || projectStore.getResearchQuery() || "Research Query";
                
                // Read actual price from tier card (dynamic pricing) or fall back to static
                const tierCard = e.target.closest('[data-tier-id]');
                const actualPrice = tierCard?.dataset.actualPrice;
                const quoteUnavailable = tierCard?.dataset.quoteUnavailable === 'true';
                const price = actualPrice ? parseFloat(actualPrice) : parseFloat(e.target.dataset.price);
                
                console.log(`💰 Purchase initiated - Tier: ${tier}, Price: $${price.toFixed(2)} ${actualPrice ? '(dynamic)' : '(static fallback)'}, Quote unavailable: ${quoteUnavailable}`);
                
                // Get sources from outline (single source of truth)
                const { sources: outlineSources } = this._getOutlineSourcesFromStore();
                const useSelectedSources = outlineSources && outlineSources.length > 0;
                
                this.dispatchEvent(new CustomEvent('tierPurchase', {
                    detail: { 
                        tier, 
                        price, 
                        query,
                        button: e.target,
                        useSelectedSources,
                        quoteUnavailable
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
