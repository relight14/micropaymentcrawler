/**
 * ReportBuilder Component
 * Handles report tier selection, generation, and display
 * Uses event-based architecture for loose coupling
 */

import { analytics } from '../utils/analytics.js';
import { projectStore } from '../state/project-store.js';
import { TIERS } from '../config/tier-catalog.js';

export class ReportBuilder extends EventTarget {
    constructor({ appState, apiService, authService, toastManager, uiManager }) {
        super();
        this.appState = appState;
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.uiManager = uiManager;
        this.pricingRefreshDebounceTimer = null;
        this.sourceSelectionHandler = null;
        this.isActive = false;
    }
    
    /**
     * Setup listener for source selection changes to refresh pricing
     * @private
     */
    _setupSourceSelectionListener() {
        // Remove existing listener if any
        if (this.sourceSelectionHandler) {
            document.removeEventListener('sourceSelectionChanged', this.sourceSelectionHandler);
        }
        
        // Create bound handler for cleanup
        this.sourceSelectionHandler = () => {
            if (!this.isActive) return; // Only refresh if builder is active
            
            if (this.pricingRefreshDebounceTimer) {
                clearTimeout(this.pricingRefreshDebounceTimer);
            }
            
            this.pricingRefreshDebounceTimer = setTimeout(() => {
                console.log('📊 Source selection changed - refreshing pricing');
                this._fetchAndUpdatePricing();
            }, 500);
        };
        
        document.addEventListener('sourceSelectionChanged', this.sourceSelectionHandler);
    }
    
    /**
     * Cleanup listeners when builder is no longer needed
     */
    destroy() {
        this.isActive = false;
        if (this.sourceSelectionHandler) {
            document.removeEventListener('sourceSelectionChanged', this.sourceSelectionHandler);
            this.sourceSelectionHandler = null;
        }
        if (this.pricingRefreshDebounceTimer) {
            clearTimeout(this.pricingRefreshDebounceTimer);
            this.pricingRefreshDebounceTimer = null;
        }
    }

    /**
     * Get merged selected sources from both AppState and ProjectStore
     * Deduplicates by source ID to handle dual-state scenarios
     * @returns {Array} Merged and deduplicated sources array
     * @private
     */
    _getMergedSelectedSources() {
        const projectStoreSources = projectStore?.getState?.().selectedSources || [];
        const appStateSources = this.appState.getSelectedSources() || [];
        
        // Merge and deduplicate by ID
        const sourceMap = new Map();
        [...projectStoreSources, ...appStateSources].forEach(source => {
            if (source && source.id) {
                sourceMap.set(source.id, source);
            }
        });
        
        return Array.from(sourceMap.values());
    }

    /**
     * Shows the report builder interface
     * @returns {HTMLElement} The report builder DOM element
     */
    show() {
        // Clean up any previous state first (singleton pattern protection)
        if (this.isActive) {
            this.destroy();
        }
        
        // Mark as active and setup listener
        this.isActive = true;
        this._setupSourceSelectionListener();
        
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
        // Defensive guard - don't refresh if builder is inactive
        if (!this.isActive || !this.authService.isAuthenticated()) {
            return;
        }
        
        const query = this.appState.getCurrentQuery() || projectStore.getResearchQuery() || "Research Query";
        const outlineStructure = projectStore.getOutlineSnapshot();
        
        try {
            // Fetch quotes for both tiers in parallel
            const [researchQuote, proQuote] = await Promise.all([
                this.apiService.getPricingQuote('research', query, outlineStructure),
                this.apiService.getPricingQuote('pro', query, outlineStructure)
            ]);
            
            this.pricingQuotes = {
                research: researchQuote,
                pro: proQuote
            };
            
            console.log('💵 Pricing quotes fetched:', this.pricingQuotes);
            
            // Update tier cards with dynamic pricing
            this._updateTierCardPricing('research', researchQuote);
            this._updateTierCardPricing('pro', proQuote);
            
        } catch (error) {
            console.error('Failed to fetch pricing quotes:', error);
            this.pricingQuotes = {};
        }
    }
    
    /**
     * Update tier card with dynamic pricing
     * @param {string} tierId - Tier ID (research/pro)
     * @param {Object} quote - Pricing quote object
     * @private
     */
    _updateTierCardPricing(tierId, quote) {
        const tierCard = document.querySelector(`[data-tier-id="${tierId}"]`);
        if (!tierCard) return;
        
        const priceElement = tierCard.querySelector('.tier-price');
        const detailsElement = tierCard.querySelector('.tier-pricing-details');
        
        if (!priceElement) return;
        
        // Check if quote is unavailable (error fallback)
        if (quote.quote_unavailable) {
            const price = quote.calculated_price || 0;
            priceElement.textContent = `$${price.toFixed(2)}`;
            
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
        
        // Update price display
        priceElement.textContent = `$${price.toFixed(2)}`;
        
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
                this._handleReportSuccess(button, tier, selectedSources, reportPacket);
            }
        } catch (error) {
            this._handleReportError(button, tier, error);
        }
    }
    
    /**
     * Handle successful report generation
     * @private
     */
    _handleReportSuccess(button, tier, selectedSources, reportPacket) {
        // Track report generation
        analytics.trackReportGenerate(selectedSources.length, tier);
        
        // Update button state
        if (button) {
            button.textContent = 'Report Generated';
            button.disabled = true;
        }
        
        // Show success toast
        if (this.toastManager) {
            this.toastManager.show(`${tier === 'research' ? 'Research' : 'Pro'} report generated successfully`, 'success');
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
    
    /**
     * Handle report generation errors
     * @private
     */
    _handleReportError(button, tier, error) {
        console.error('Error generating report:', error);
        
        // Parse error message for user-friendly display
        const errorMessage = this._parseErrorMessage(error);
        
        // Show error toast with retry guidance
        if (this.toastManager) {
            this.toastManager.show(errorMessage, 'error');
        }
        
        // Dispatch error event
        this.dispatchEvent(new CustomEvent('reportError', {
            detail: { error, tier, userMessage: errorMessage }
        }));
        
        // Reset button state
        if (button) {
            button.textContent = `Generate ${tier === 'research' ? 'Research' : 'Pro'} Report`;
            button.disabled = false;
        }
    }
    
    /**
     * Parse error into user-friendly message with retry guidance
     * @private
     */
    _parseErrorMessage(error) {
        // Check if we have structured error from backend
        if (error.retryGuidance) {
            return `${error.message}. ${error.retryGuidance}`;
        }
        
        const errorStr = error?.message || String(error);
        
        // Handle specific error types
        if (errorStr.includes('insufficient funds') || errorStr.includes('balance')) {
            return 'Insufficient wallet balance. Please add funds and try again.';
        }
        
        if (errorStr.includes('401') || errorStr.includes('unauthorized') || errorStr.includes('session')) {
            return 'Your session expired. Please log in again.';
        }
        
        if (errorStr.includes('429') || errorStr.includes('rate limit')) {
            return 'Too many requests. Please wait a moment and try again.';
        }
        
        if (errorStr.includes('timeout') || errorStr.includes('timed out')) {
            return 'Request timed out. Please check your connection and try again.';
        }
        
        if (errorStr.includes('network') || errorStr.includes('fetch')) {
            return 'Network error. Please check your connection and try again.';
        }
        
        // Generic fallback with retry guidance
        return 'Report generation failed. Please try again or contact support if the issue persists.';
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
        tierBadge.className = `tier-badge tier-${reportData.tier || 'research'}`;
        tierBadge.textContent = `${(reportData.tier || 'research').toUpperCase()} TIER`;
        
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
        const selectedSources = this._getMergedSelectedSources();
        const sourceCount = selectedSources.length;
        const totalCost = this.appState.getSelectedSourcesTotal();
        
        // Create modal-style takeover container
        const container = document.createElement('div');
        container.className = 'tier-selection-takeover';
        
        // Progress narrative header
        const progressHeader = document.createElement('div');
        progressHeader.className = 'tier-progress-header';
        progressHeader.innerHTML = `
            <div class="progress-checkmark">✅</div>
            <div class="progress-content">
                <div class="progress-title">${sourceCount} Vetted Sources Ready</div>
                <div class="progress-subtitle">Choose Your Research Package → Report Generation Begins</div>
            </div>
        `;
        container.appendChild(progressHeader);
        
        // Main content area
        const contentArea = document.createElement('div');
        contentArea.className = 'tier-selection-content';
        
        // Header
        contentArea.appendChild(this._createHeader());
        
        // Selected sources section (if any sources selected)
        if (sourceCount > 0) {
            contentArea.appendChild(this._createSelectedSourcesSection(selectedSources, sourceCount, totalCost));
        }
        
        // Tier cards with asymmetric layout
        contentArea.appendChild(this._createTierCardsContainer());
        
        // Expandable comparison (What's inside?)
        contentArea.appendChild(this._createComparisonAccordion());
        
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
        headerTitle.textContent = 'Choose Your Research Package';
        
        headerDiv.appendChild(headerTitle);
        
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
     * Creates tier cards container with asymmetric layout
     * @private
     */
    _createTierCardsContainer() {
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'tier-cards-asymmetric';
        
        // Create tier cards from config (Pro first, then Research)
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
        const cardDiv = document.createElement('div');
        cardDiv.className = tier.highlighted ? 'tier-card tier-card-pro' : 'tier-card tier-card-research';
        cardDiv.dataset.tier = tier.id;
        cardDiv.dataset.tierId = tier.id; // For DOM querying in price updates
        
        const badgeHTML = tier.badge ? `<div class="tier-badge">${tier.badge}</div>` : '';
        const microcopyHTML = tier.microcopy ? `<div class="tier-microcopy">${tier.microcopy}</div>` : '';
        const buttonClass = tier.highlighted ? 'tier-purchase-btn tier-btn-primary' : 'tier-purchase-btn tier-btn-ghost';
        
        cardDiv.innerHTML = `
            ${badgeHTML}
            <div class="tier-icon">${tier.icon}</div>
            <h4 class="tier-title-new">${tier.title}</h4>
            <div class="tier-price tier-price-new">${tier.priceLabel}</div>
            <div class="tier-pricing-details" style="display: none; font-size: 0.8rem; color: #666; margin-top: 4px;"></div>
            <div class="tier-subtitle">${tier.subtitle}</div>
            <ul class="tier-features-compact">
                ${tier.features.map(feature => `<li>✓ ${feature}</li>`).join('')}
            </ul>
            <button class="${buttonClass}" data-tier="${tier.id}" data-price="${tier.price}">
                ${tier.buttonText}
            </button>
            ${microcopyHTML}
        `;
        
        return cardDiv;
    }

    /**
     * Creates expandable comparison accordion
     * @private
     */
    _createComparisonAccordion() {
        const accordionDiv = document.createElement('details');
        accordionDiv.className = 'tier-comparison-accordion';
        
        const summary = document.createElement('summary');
        summary.className = 'accordion-summary';
        summary.textContent = "What's inside? ▼";
        
        const content = document.createElement('div');
        content.className = 'accordion-content';
        
        // Build comparison table
        content.innerHTML = `
            <table class="tier-comparison-table">
                <thead>
                    <tr>
                        <th>Feature</th>
                        <th>Research</th>
                        <th>Pro</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>Professional summary & analysis</td>
                        <td>✓</td>
                        <td>✓</td>
                    </tr>
                    <tr>
                        <td>Source compilation & citations</td>
                        <td>✓</td>
                        <td>✓</td>
                    </tr>
                    <tr>
                        <td>Strategic insights & recommendations</td>
                        <td>—</td>
                        <td>✓</td>
                    </tr>
                    <tr>
                        <td>Executive summary format</td>
                        <td>—</td>
                        <td>✓</td>
                    </tr>
                    <tr>
                        <td>Enhanced formatting & presentation</td>
                        <td>—</td>
                        <td>✓</td>
                    </tr>
                </tbody>
            </table>
        `;
        
        accordionDiv.appendChild(summary);
        accordionDiv.appendChild(content);
        
        return accordionDiv;
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
                
                const selectedSources = this._getMergedSelectedSources();
                const useSelectedSources = selectedSources && selectedSources.length > 0;
                
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
