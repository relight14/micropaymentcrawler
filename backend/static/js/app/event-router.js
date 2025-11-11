/**
 * EventRouter - Centralized event listener management
 * Extracted from app.js to reduce bloat and improve maintainability
 */

// Utility: debounce function
const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

export class EventRouter {
    constructor(handlers) {
        this.handlers = handlers || {};
        this.listeners = [];
    }

    /**
     * Set handler functions
     * @param {Object} handlers - Object containing handler functions
     */
    setHandlers(handlers) {
        this.handlers = { ...this.handlers, ...handlers };
    }

    /**
     * Initialize all event listeners
     */
    initialize() {
        this._setupChatEvents();
        this._setupModeEvents();
        this._setupUIEvents();
        this._setupAuthEvents();
        this._setupDelegatedEvents();
    }

    /**
     * Setup chat-related events
     */
    _setupChatEvents() {
        const chatInput = document.getElementById('newChatInput');
        const sendButton = document.getElementById('newSendButton');
        
        if (sendButton) {
            sendButton.addEventListener('click', () => {
                if (this.handlers.onSendMessage) {
                    this.handlers.onSendMessage();
                }
            });
        }
        
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (this.handlers.onSendMessage) {
                        this.handlers.onSendMessage();
                    }
                }
            });
            
            chatInput.addEventListener('input', debounce((e) => {
                if (sendButton) sendButton.disabled = !e.target.value.trim();
                if (this.handlers.onChatInput) {
                    this.handlers.onChatInput(e);
                }
            }, 100));
        }
    }

    /**
     * Setup mode switching events
     */
    _setupModeEvents() {
        const chatModeBtn = document.getElementById('chatModeBtn');
        const researchModeBtn = document.getElementById('researchModeBtn');
        const reportModeBtn = document.getElementById('reportModeBtn');
        
        if (chatModeBtn) {
            chatModeBtn.addEventListener('click', () => {
                if (this.handlers.onModeSwitch) {
                    this.handlers.onModeSwitch('chat');
                }
            });
        }
        
        if (researchModeBtn) {
            researchModeBtn.addEventListener('click', () => {
                if (this.handlers.onModeSwitch) {
                    this.handlers.onModeSwitch('research');
                }
            });
        }
        
        if (reportModeBtn) {
            reportModeBtn.addEventListener('click', () => {
                if (this.handlers.onModeSwitch) {
                    this.handlers.onModeSwitch('report');
                }
            });
        }
    }

    /**
     * Setup UI-related events (clear, dark mode, etc.)
     */
    _setupUIEvents() {
        const clearButton = document.getElementById('clearButton');
        const newChatBtn = document.getElementById('newChatBtn');
        const darkModeToggle = document.getElementById('darkModeToggle');
        
        // Clear conversation
        if (clearButton) {
            clearButton.addEventListener('click', () => {
                if (this.handlers.onClearConversation) {
                    this.handlers.onClearConversation();
                }
            });
        }
        
        if (newChatBtn) {
            newChatBtn.addEventListener('click', () => {
                if (this.handlers.onClearConversation) {
                    this.handlers.onClearConversation();
                }
            });
        }
        
        // Dark mode toggle
        if (darkModeToggle && this.handlers.getDarkModeState) {
            darkModeToggle.checked = this.handlers.getDarkModeState();
            darkModeToggle.addEventListener('change', () => {
                if (this.handlers.onDarkModeToggle) {
                    this.handlers.onDarkModeToggle();
                }
            });
        }
    }

    /**
     * Setup authentication events
     */
    _setupAuthEvents() {
        const loginButton = document.getElementById('loginButton');
        
        if (loginButton) {
            loginButton.addEventListener('click', () => {
                if (this.handlers.onAuthButtonClick) {
                    this.handlers.onAuthButtonClick();
                }
            });
        }
    }

    /**
     * Setup delegated events (event delegation for dynamic content)
     */
    _setupDelegatedEvents() {
        // Citation badge click handler
        document.addEventListener('click', (e) => {
            const badge = e.target.closest('.citation-badge');
            if (!badge) return;
            
            e.preventDefault();
            
            if (this.handlers.onCitationBadgeClick) {
                const sourceId = badge.getAttribute('data-source-id');
                const price = parseFloat(badge.getAttribute('data-price')) || 0;
                this.handlers.onCitationBadgeClick(sourceId, price);
            }
        });
        
        // Feedback button handler
        document.addEventListener('click', (e) => {
            const feedbackBtn = e.target.closest('.feedback-btn');
            if (!feedbackBtn) return;
            
            e.preventDefault();
            
            const feedbackSection = feedbackBtn.closest('.feedback-section');
            if (!feedbackSection) return;
            
            // Check if already submitted
            if (feedbackSection.dataset.submitted === 'true') {
                console.log('Feedback already submitted for this result');
                return;
            }
            
            if (this.handlers.onFeedbackSubmit) {
                const rating = feedbackBtn.classList.contains('feedback-up') ? 'up' : 'down';
                const query = feedbackSection.dataset.query;
                const sourceIds = JSON.parse(feedbackSection.dataset.sourceIds || '[]');
                const mode = feedbackSection.dataset.mode || 'research';
                
                this.handlers.onFeedbackSubmit(query, sourceIds, rating, mode, feedbackSection);
            }
        });
        
        // Research mode suggestion handler (custom event)
        document.addEventListener('switchToResearch', (e) => {
            const topicHint = e.detail?.topicHint || '';
            const autoExecute = e.detail?.autoExecute || false;
            console.log('💡 Switching to research mode with topic:', topicHint, 'autoExecute:', autoExecute);
            
            if (this.handlers.onResearchSuggestion) {
                this.handlers.onResearchSuggestion(topicHint, autoExecute);
            }
        });
    }

    /**
     * Remove all event listeners (cleanup)
     */
    cleanup() {
        this.listeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.listeners = [];
    }
}
