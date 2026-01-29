/**
 * Attribution Component
 * Displays publisher attribution for RSL-licensed content
 * 
 * Handles:
 * - Attribution display when required by RSL terms
 * - Publisher credit formatting
 * - License protocol badges
 * - Copyright information
 */

class Attribution {
    constructor() {
        this.attributionData = new Map(); // Track attribution by source ID
    }

    /**
     * Create attribution element for licensed content
     * @param {Object} attributionInfo - Attribution information
     * @returns {HTMLElement} Attribution element
     */
    create(attributionInfo) {
        const {
            source_url,
            publisher,
            requires_attribution = false,
            protocol,
            license_type = 'ai-include'
        } = attributionInfo;

        if (!requires_attribution && !publisher) {
            return null; // No attribution needed
        }

        const attribution = document.createElement('div');
        attribution.className = 'rsl-attribution';
        
        let attributionHTML = '<div class="attribution-content">';
        
        // Protocol badge
        if (protocol) {
            const badgeClass = this._getProtocolBadgeClass(protocol);
            attributionHTML += `<span class="protocol-badge ${badgeClass}">${protocol.toUpperCase()}</span>`;
        }
        
        // Publisher credit
        if (publisher) {
            attributionHTML += `<span class="publisher-credit">`;
            attributionHTML += `<i class="fas fa-copyright"></i> ${publisher}`;
            attributionHTML += `</span>`;
        }
        
        // License type
        if (license_type) {
            const licenseDisplay = this._formatLicenseType(license_type);
            attributionHTML += `<span class="license-type">${licenseDisplay}</span>`;
        }
        
        // Source link (if available)
        if (source_url) {
            attributionHTML += `<a href="${source_url}" target="_blank" class="source-link" title="View original source">`;
            attributionHTML += `<i class="fas fa-external-link-alt"></i> Source`;
            attributionHTML += `</a>`;
        }
        
        attributionHTML += '</div>';
        
        attribution.innerHTML = attributionHTML;
        
        return attribution;
    }

    /**
     * Create inline attribution (smaller, for embedded use)
     * @param {Object} attributionInfo - Attribution information
     * @returns {HTMLElement} Inline attribution element
     */
    createInline(attributionInfo) {
        const { publisher, protocol } = attributionInfo;
        
        if (!publisher && !protocol) {
            return null;
        }
        
        const attribution = document.createElement('span');
        attribution.className = 'rsl-attribution-inline';
        
        let text = '';
        if (publisher) {
            text += `© ${publisher}`;
        }
        if (protocol) {
            text += ` (${protocol.toUpperCase()})`;
        }
        
        attribution.textContent = text;
        return attribution;
    }

    /**
     * Create attribution notice for article content
     * @param {Object} content - Content object with attribution info
     * @returns {HTMLElement} Article attribution element
     */
    createArticleAttribution(content) {
        const {
            title,
            publisher,
            source_url,
            protocol,
            requires_attribution,
            cost,
            currency = 'USD'
        } = content;

        const attribution = document.createElement('div');
        attribution.className = 'article-attribution';
        
        let html = '<div class="attribution-header">';
        
        // Title
        if (title) {
            html += `<h3 class="article-title">${this._escapeHtml(title)}</h3>`;
        }
        
        html += '<div class="attribution-metadata">';
        
        // Publisher
        if (publisher) {
            html += `<div class="metadata-item">`;
            html += `<i class="fas fa-building"></i>`;
            html += `<span>${this._escapeHtml(publisher)}</span>`;
            html += `</div>`;
        }
        
        // Protocol
        if (protocol) {
            const badgeClass = this._getProtocolBadgeClass(protocol);
            html += `<div class="metadata-item">`;
            html += `<span class="protocol-badge-small ${badgeClass}">${protocol.toUpperCase()}</span>`;
            html += `</div>`;
        }
        
        // Cost
        if (cost && cost > 0) {
            html += `<div class="metadata-item">`;
            html += `<i class="fas fa-dollar-sign"></i>`;
            html += `<span>${this._formatCurrency(cost, currency)}</span>`;
            html += `</div>`;
        }
        
        // Source link
        if (source_url) {
            html += `<div class="metadata-item">`;
            html += `<a href="${source_url}" target="_blank" class="source-link">`;
            html += `<i class="fas fa-external-link-alt"></i> Original Source`;
            html += `</a>`;
            html += `</div>`;
        }
        
        html += '</div>'; // attribution-metadata
        
        // Attribution notice
        if (requires_attribution) {
            html += `<div class="attribution-notice">`;
            html += `<i class="fas fa-info-circle"></i>`;
            html += `<span>This content is licensed and requires attribution.</span>`;
            html += `</div>`;
        }
        
        html += '</div>'; // attribution-header
        
        attribution.innerHTML = html;
        
        return attribution;
    }

    /**
     * Store attribution data for a source
     * @param {string} sourceId - Source identifier
     * @param {Object} attributionInfo - Attribution information
     */
    store(sourceId, attributionInfo) {
        this.attributionData.set(sourceId, attributionInfo);
    }

    /**
     * Get stored attribution data for a source
     * @param {string} sourceId - Source identifier
     * @returns {Object|null} Attribution information
     */
    get(sourceId) {
        return this.attributionData.get(sourceId) || null;
    }

    /**
     * Clear attribution data for a source
     * @param {string} sourceId - Source identifier
     */
    clear(sourceId) {
        this.attributionData.delete(sourceId);
    }

    /**
     * Get protocol badge CSS class
     * @private
     */
    _getProtocolBadgeClass(protocol) {
        const protocolLower = protocol.toLowerCase();
        switch (protocolLower) {
            case 'rsl':
                return 'badge-rsl';
            case 'tollbit':
                return 'badge-tollbit';
            case 'cloudflare':
                return 'badge-cloudflare';
            default:
                return 'badge-default';
        }
    }

    /**
     * Format license type for display
     * @private
     */
    _formatLicenseType(licenseType) {
        const types = {
            'ai-include': 'AI Inference',
            'ai-train': 'AI Training',
            'search': 'Search Index',
            'purchase': 'Full Purchase'
        };
        return types[licenseType] || licenseType;
    }

    /**
     * Format currency amount
     * @private
     */
    _formatCurrency(amount, currency = 'USD') {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    }

    /**
     * Escape HTML to prevent XSS
     * @private
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Attribution;
}
