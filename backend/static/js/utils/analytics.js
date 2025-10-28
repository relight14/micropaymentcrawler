/**
 * Google Analytics 4 Event Tracking Utility
 * Centralized helper for tracking user interactions
 */

class Analytics {
    constructor() {
        // Don't cache gtag availability - check on each call for lazy loading
    }

    _isGtagAvailable() {
        return typeof window !== 'undefined' && typeof window.gtag === 'function';
    }

    track(eventName, params = {}) {
        // Lazy check - gtag may not be loaded yet at module init
        if (!this._isGtagAvailable()) {
            console.log(`[Analytics] Event queued (gtag not ready): ${eventName}`, params);
            return;
        }
        
        try {
            window.gtag('event', eventName, params);
            console.log(`[Analytics] ${eventName}`, params);
        } catch (error) {
            console.error('[Analytics] Error tracking event:', error);
        }
    }

    trackModeSwitch(mode) {
        this.track('mode_switch', {
            mode: mode,
            timestamp: new Date().toISOString()
        });
    }

    trackSearch(query, mode) {
        this.track('search_query', {
            mode: mode,
            query_length: query.length,
            has_special_chars: /[@#$%^&*]/.test(query),
            timestamp: new Date().toISOString()
        });
    }

    trackSourceView(sourceId, domain) {
        this.track('source_view', {
            source_id: sourceId,
            domain: domain,
            timestamp: new Date().toISOString()
        });
    }

    trackSourceUnlock(sourceId, price, domain) {
        this.track('source_unlock', {
            source_id: sourceId,
            price: price,
            domain: domain,
            value: price,
            currency: 'USD',
            timestamp: new Date().toISOString()
        });
    }

    trackPurchase(totalPrice, sourceCount) {
        this.track('purchase', {
            value: totalPrice,
            currency: 'USD',
            source_count: sourceCount,
            timestamp: new Date().toISOString()
        });
    }

    trackReportGenerate(sourceCount, tier) {
        this.track('report_generate', {
            source_count: sourceCount,
            tier: tier,
            timestamp: new Date().toISOString()
        });
    }

    trackReportDownload(filename) {
        this.track('report_download', {
            filename: filename,
            timestamp: new Date().toISOString()
        });
    }

    trackLogin(method = 'ledewire') {
        this.track('login', {
            method: method,
            timestamp: new Date().toISOString()
        });
    }

    trackLogout() {
        this.track('logout', {
            timestamp: new Date().toISOString()
        });
    }

    trackOnboardingComplete() {
        this.track('onboarding_complete', {
            timestamp: new Date().toISOString()
        });
    }

    trackOnboardingSkip(slideNumber) {
        this.track('onboarding_skip', {
            slide_number: slideNumber,
            timestamp: new Date().toISOString()
        });
    }

    trackFeedback(type, context = '') {
        this.track('feedback', {
            feedback_type: type,
            context: context,
            timestamp: new Date().toISOString()
        });
    }

    trackError(errorType, errorMessage) {
        this.track('error', {
            error_type: errorType,
            error_message: errorMessage,
            timestamp: new Date().toISOString()
        });
    }

    trackTierSelect(tier) {
        this.track('tier_select', {
            tier: tier,
            timestamp: new Date().toISOString()
        });
    }

    trackChatMessage(messageLength, mode) {
        this.track('chat_message', {
            message_length: messageLength,
            mode: mode,
            timestamp: new Date().toISOString()
        });
    }
}

export const analytics = new Analytics();
