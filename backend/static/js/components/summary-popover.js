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
     * @param {string} params.sourceTitle - Title of the article
     * @param {string} params.sourceUrl - URL of the article
     */
    show({ anchorElement, summary, price, sourceTitle, sourceUrl }) {
        // Clean up any existing popover first
        this.hide();

        // Create backdrop overlay
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'summary-backdrop';
        this.backdrop.addEventListener('click', () => this.hide());

        // Create popover container
        this.activePopover = document.createElement('div');
        this.activePopover.className = 'summary-popover';
        
        // Popover content
        this.activePopover.innerHTML = `
            <div class="summary-header">
                <div class="summary-title-section">
                    <h4 class="summary-article-title">${this._escapeHtml(sourceTitle)}</h4>
                    <div class="summary-meta">
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
        
        // Calculate horizontal position (centered on anchor)
        let left = anchorRect.left + (anchorRect.width / 2) - (popoverRect.width / 2);
        
        // Prevent horizontal overflow
        const minLeft = 16; // 16px margin from edge
        const maxLeft = viewportWidth - popoverRect.width - 16;
        left = Math.max(minLeft, Math.min(left, maxLeft));
        
        // Calculate vertical position (above anchor with gap)
        const gap = 12;
        let top = anchorRect.top - popoverRect.height - gap;
        
        // If not enough space above, show below instead
        if (top < 16) {
            top = anchorRect.bottom + gap;
            this.activePopover.classList.add('position-below');
        } else {
            this.activePopover.classList.add('position-above');
        }
        
        // Apply position
        this.activePopover.style.left = `${left}px`;
        this.activePopover.style.top = `${top}px`;
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
