/**
 * ReportBuilder Component
 * Handles report generation and display
 * Uses event-based architecture for loose coupling
 */

import { analytics } from '../utils/analytics.js';

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
     * Generates a report from selected sources
     * @param {string} query - Research query
     * @param {Array} selectedSources - Selected sources array
     * @param {Object} outlineStructure - Outline structure from project store
     */
    async generateReport(query, selectedSources, outlineStructure) {
        if (!this.authService.isAuthenticated()) {
            this.dispatchEvent(new CustomEvent('authRequired', {
                detail: { message: 'Please log in to generate a report.' }
            }));
            return;
        }

        try {
            console.log(`📊 Generating report with ${selectedSources.length} selected sources`);
            
            // Dispatch loading event
            this.dispatchEvent(new CustomEvent('reportGenerating', {
                detail: { sourceCount: selectedSources.length }
            }));
            
            // Call API to generate report with full source objects and outline structure
            const reportPacket = await this.apiService.generateReport(query, selectedSources, outlineStructure);
            
            if (reportPacket) {
                // Track report generation
                analytics.trackReportGenerate(selectedSources.length);
                
                // Dispatch success event with report data
                this.dispatchEvent(new CustomEvent('reportPurchaseCompleted', {
                    detail: {
                        reportData: reportPacket,
                        sourceCount: selectedSources.length
                    }
                }));
            }
        } catch (error) {
            console.error('Error generating report:', error);
            
            // Dispatch error event
            this.dispatchEvent(new CustomEvent('reportError', {
                detail: { error }
            }));
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
        const headerText = `# Research Report: ${reportData.query}\n\n`;
        
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
                query: reportData.query,
                sources_count: sourceCount,
                citation_metadata: reportData.citation_metadata || null
            }
        };
    }

    /**
     * Creates report header with title
     * @private
     */
    _createReportHeader(reportData) {
        const header = document.createElement('div');
        header.className = 'report-header';
        
        const title = document.createElement('h2');
        title.className = 'report-title';
        title.textContent = `Research Report: ${reportData.query}`;
        
        header.appendChild(title);
        
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
}
