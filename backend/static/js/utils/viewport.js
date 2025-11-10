/**
 * Viewport Utility
 * Provides viewport-based responsive state using matchMedia
 * Works correctly in iframes (like Replit preview) unlike window.innerWidth
 */

const MOBILE_BREAKPOINT = '(max-width: 768px)';

class ViewportUtil {
    constructor() {
        this.mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);
        this.listeners = new Set();
        
        // Listen for viewport changes
        this.mediaQuery.addEventListener('change', (e) => {
            console.log('📐 [Viewport] Breakpoint changed:', {
                isMobile: e.matches,
                breakpoint: MOBILE_BREAKPOINT
            });
            this.notifyListeners(e.matches);
        });
        
        console.log('📐 [Viewport] Initialized:', {
            isMobile: this.mediaQuery.matches,
            breakpoint: MOBILE_BREAKPOINT
        });
    }

    /**
     * Check if viewport is currently mobile
     * @returns {boolean}
     */
    isMobile() {
        return this.mediaQuery.matches;
    }

    /**
     * Subscribe to viewport changes
     * @param {Function} callback - Called with (isMobile: boolean) when viewport changes
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of viewport change
     * @private
     */
    notifyListeners(isMobile) {
        this.listeners.forEach(callback => callback(isMobile));
    }
}

// Export singleton instance
export const viewport = new ViewportUtil();
