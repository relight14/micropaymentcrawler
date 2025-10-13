/**
 * ToastManager - Handles toast notification lifecycle
 * Extracted from app.js to reduce bloat and improve maintainability
 */
export class ToastManager {
    constructor(containerSelector = '#toastContainer') {
        this.toasts = [];
        this.toastContainer = null;
        this.containerSelector = containerSelector;
        this.initialize();
    }

    initialize() {
        this.toastContainer = document.querySelector(this.containerSelector);
        if (!this.toastContainer) {
            console.warn('Toast container not found, creating fallback');
            this.toastContainer = document.createElement('div');
            this.toastContainer.className = 'toast-container';
            this.toastContainer.id = this.containerSelector.replace('#', '');
            document.body.appendChild(this.toastContainer);
        }
    }

    /**
     * Show a toast notification
     * @param {string} message - Message to display
     * @param {string} type - Type of toast: 'success', 'error', 'info'
     * @param {number} duration - Duration in milliseconds (0 = no auto-dismiss)
     * @returns {number} Toast ID
     */
    show(message, type = 'info', duration = 3000) {
        const toastId = Date.now();
        const icons = {
            success: '✅',
            error: '⚠️', 
            info: 'ℹ️'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.dataset.toastId = toastId;
        
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-content">${message}</span>
            <button class="toast-dismiss" aria-label="Dismiss">×</button>
        `;

        // Add dismiss functionality
        const dismissBtn = toast.querySelector('.toast-dismiss');
        dismissBtn.addEventListener('click', () => this.dismiss(toastId));

        // Add to container and tracking
        this.toastContainer.appendChild(toast);
        this.toasts.push({ id: toastId, element: toast });

        // Auto-dismiss after duration
        if (duration > 0) {
            setTimeout(() => this.dismiss(toastId), duration);
        }

        return toastId;
    }

    /**
     * Dismiss a specific toast
     * @param {number} toastId - ID of toast to dismiss
     */
    dismiss(toastId) {
        const toastIndex = this.toasts.findIndex(t => t.id === toastId);
        if (toastIndex === -1) return;

        const toast = this.toasts[toastIndex];
        toast.element.classList.add('dismissing');
        
        // Remove after animation
        setTimeout(() => {
            if (toast.element.parentNode) {
                toast.element.parentNode.removeChild(toast.element);
            }
            this.toasts.splice(toastIndex, 1);
        }, 300);
    }

    /**
     * Dismiss all toasts
     */
    dismissAll() {
        const toastIds = this.toasts.map(t => t.id);
        toastIds.forEach(id => this.dismiss(id));
    }
}
