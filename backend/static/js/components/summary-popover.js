/**
 * SummaryPopover Component
 * Floating popover that displays article summaries above source cards
 * Features: smart positioning, backdrop overlay, ESC/click-outside dismissal
 */

class SummaryPopover {
    constructor() {
        this.activePopover = null;
        this.backdrop = null;
        this.escHandler = null;
    }

    /**
     * Show summary popover above a source card
     * @param {Object} params - Configuration
     * @param {HTMLElement} params.anchorElement - Element to position above
     * @param {string} params.summary - Summary text to display
     * @param {number} params.price - Price paid for summary
     * @param {string} params.summaryType - Type of summary ("full" or "excerpt")
     * @param {string} params.sourceTitle - Title of the article
     * @param {string} params.sourceUrl - URL of the article
     */
    show({ anchorElement, summary, price, summaryType = 'full', sourceTitle, sourceUrl }) {
        // Clean up any existing popover first
        this.hide();

        // Create backdrop overlay
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'summary-backdrop';
        this.backdrop.addEventListener('click', () => this.hide());

        // Create popover container
        this.activePopover = document.createElement('div');
        this.activePopover.className = 'summary-popover';
        
        // Determine badge text based on summary type
        const typeBadgeText = summaryType === 'full' ? '📰 Full Article' : '📄 From Preview';
        const typeBadgeClass = summaryType === 'full' ? 'summary-type-full' : 'summary-type-excerpt';
        
        // Popover content with transparency badge
        this.activePopover.innerHTML = `
            <div class="summary-header">
                <div class="summary-title-section">
                    <h4 class="summary-article-title">${this._escapeHtml(sourceTitle)}</h4>
                    <div class="summary-meta">
                        <span class="summary-type-badge ${typeBadgeClass}">${typeBadgeText}</span>
                        <span class="summary-price-badge">Purchased for $${price.toFixed(2)}</span>
                    </div>
                </div>
                <button class="summary-close-btn" aria-label="Close summary">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
            <div class="summary-content">
                <p class="summary-text">${this._escapeHtml(summary)}</p>
            </div>
            <div class="summary-footer">
                <a href="${this._escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="summary-view-full">
                    View Full Article →
                </a>
            </div>
        `;

        // Add close button handler
        const closeBtn = this.activePopover.querySelector('.summary-close-btn');
        closeBtn.addEventListener('click', () => this.hide());

        // Add to DOM
        document.body.appendChild(this.backdrop);
        document.body.appendChild(this.activePopover);

        // Position popover above anchor element
        this._positionPopover(anchorElement);

        // Add ESC key handler
        this.escHandler = (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        };
        document.addEventListener('keydown', this.escHandler);

        // Trigger entrance animation
        requestAnimationFrame(() => {
            this.backdrop.classList.add('visible');
            this.activePopover.classList.add('visible');
        });
    }

    /**
     * Hide and remove the active popover
     */
    hide() {
        if (!this.activePopover && !this.backdrop) return;

        // Remove ESC handler
        if (this.escHandler) {
            document.removeEventListener('keydown', this.escHandler);
            this.escHandler = null;
        }

        // Trigger exit animation
        if (this.backdrop) {
            this.backdrop.classList.remove('visible');
        }
        if (this.activePopover) {
            this.activePopover.classList.remove('visible');
        }

        // Remove from DOM after animation
        setTimeout(() => {
            if (this.backdrop) {
                this.backdrop.remove();
                this.backdrop = null;
            }
            if (this.activePopover) {
                this.activePopover.remove();
                this.activePopover = null;
            }
        }, 200); // Match CSS transition duration
    }

    /**
     * Position popover above anchor element with smart overflow handling
     */
    _positionPopover(anchorElement) {
        const anchorRect = anchorElement.getBoundingClientRect();
        const popoverRect = this.activePopover.getBoundingClientRect();
        
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        const margin = 16;
        const gap = 12;
        
        // Calculate horizontal position (centered on anchor)
        let left = anchorRect.left + (anchorRect.width / 2) - (popoverRect.width / 2);
        
        // Prevent horizontal overflow
        const minLeft = margin;
        const maxLeft = viewportWidth - popoverRect.width - margin;
        left = Math.max(minLeft, Math.min(left, maxLeft));
        
        // Calculate vertical positions for both above and below
        const topIfAbove = anchorRect.top - popoverRect.height - gap;
        const topIfBelow = anchorRect.bottom + gap;
        const bottomIfBelow = topIfBelow + popoverRect.height;
        
        let top;
        let position;
        
        // Try positioning above first
        if (topIfAbove >= margin) {
            top = topIfAbove;
            position = 'above';
        }
        // If not enough space above, try below
        else if (bottomIfBelow <= viewportHeight - margin) {
            top = topIfBelow;
            position = 'below';
        }
        // If neither fits perfectly, choose the position with more space
        else {
            const spaceAbove = anchorRect.top;
            const spaceBelow = viewportHeight - anchorRect.bottom;
            
            if (spaceAbove > spaceBelow) {
                // More space above - center in available space above
                top = Math.max(margin, anchorRect.top - popoverRect.height - gap);
                position = 'above';
            } else {
                // More space below or equal - position at top with scrollable content
                top = Math.min(topIfBelow, viewportHeight - popoverRect.height - margin);
                position = 'below';
            }
        }
        
        // Apply position class
        this.activePopover.classList.add(`position-${position}`);
        
        // Apply position styles
        this.activePopover.style.left = `${left}px`;
        this.activePopover.style.top = `${top}px`;
        
        // Ensure popover is constrained to viewport height if needed
        const maxHeight = viewportHeight - (2 * margin);
        if (popoverRect.height > maxHeight) {
            this.activePopover.style.maxHeight = `${maxHeight}px`;
            this.activePopover.style.overflowY = 'auto';
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Check if popover is currently visible
     */
    isVisible() {
        return this.activePopover !== null;
    }
}

// Export singleton instance
export const summaryPopover = new SummaryPopover();
