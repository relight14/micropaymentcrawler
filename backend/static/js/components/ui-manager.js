/**
 * UI Manager - Handles DOM manipulation and UI updates
 * Extracted from the monolithic ChatResearchApp
 */
import { MessageRenderer } from './message-renderer.js';

export class UIManager {
    constructor(appState, options = {}) {
        this.appState = appState;
        
        // Configuration constants
        this.CONFIG = {
            CHARACTER_WARNING_THRESHOLD: 1800,
            CHARACTER_SOFT_THRESHOLD: 1500,
            MAX_TEXTAREA_HEIGHT: 150,
            CHARACTER_LIMIT: 2000
        };
        
        // Mode descriptions - configurable
        this.modeDescriptions = options.modeDescriptions || {
            'chat': '💬 Conversational AI mode - Explore topics through natural dialogue',
            'research': '🔍 Research mode - Find and license authoritative sources',
            'report': '📊 Report Builder - Create comprehensive research packages'
        };
        
        // Element selectors - configurable for testability
        this.selectors = {
            messagesContainer: options.messagesContainer || '#messagesContainer',
            chatInput: options.chatInput || '#newChatInput',
            sendButton: options.sendButton || '#newSendButton',
            ...options.selectors
        };
        
        // Cache DOM elements
        this.messagesContainer = document.querySelector(this.selectors.messagesContainer);
        this.chatInput = document.querySelector(this.selectors.chatInput);
        this.sendButton = document.querySelector(this.selectors.sendButton);
    }

    // Mode display management
    updateModeDisplay() {
        const chatModeBtn = document.getElementById('chatModeBtn');
        const researchModeBtn = document.getElementById('researchModeBtn');
        const reportModeBtn = document.getElementById('reportModeBtn');
        const modeDescription = document.getElementById('modeDescription');

        if (chatModeBtn && researchModeBtn && reportModeBtn) {
            // Reset all buttons
            [chatModeBtn, researchModeBtn, reportModeBtn].forEach(btn => {
                btn.classList.remove('active', 'bg-primary', 'text-primary-foreground');
            });

            // Activate current mode button
            const currentModeBtn = document.getElementById(`${this.appState.getMode()}ModeBtn`);
            if (currentModeBtn) {
                currentModeBtn.classList.add('active', 'bg-primary', 'text-primary-foreground');
            }
        }

        if (modeDescription) {
            modeDescription.textContent = this.modeDescriptions[this.appState.getMode()] || this.modeDescriptions['chat'];
        }

        this.updateInputPlaceholder();
    }

    updateInputPlaceholder() {
        if (!this.chatInput) return;
        
        const hasMessages = this.appState.getConversationHistory().length > 0;
        const placeholders = {
            'chat': hasMessages ? 'Continue the conversation...' : 'Ask me anything or say "research mode" for sources...',
            'research': hasMessages ? 'Ask another research question...' : 'What would you like to research? I\'ll find authoritative sources...',
            'report': hasMessages ? 'Add more sources or create report...' : 'Build a research report from licensed sources...'
        };
        
        this.chatInput.placeholder = placeholders[this.appState.getMode()] || placeholders['chat'];
    }

    // Character count management with configurable thresholds
    updateCharacterCount() {
        const characterCount = document.querySelector('.character-count');
        if (!characterCount || !this.chatInput) return;
        
        const count = this.chatInput.value.length;
        characterCount.textContent = `${count} / ${this.CONFIG.CHARACTER_LIMIT}`;
        
        if (count > this.CONFIG.CHARACTER_WARNING_THRESHOLD) {
            characterCount.style.color = 'var(--destructive)';
        } else if (count > this.CONFIG.CHARACTER_SOFT_THRESHOLD) {
            characterCount.style.color = 'var(--accent)';
        } else {
            characterCount.style.color = 'var(--muted-foreground)';
        }
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, this.CONFIG.MAX_TEXTAREA_HEIGHT) + 'px';
    }

    // Wallet display management
    updateWalletDisplay(balance = 0) {
        const walletBalance = document.getElementById('walletBalance');
        if (walletBalance) {
            const safeBalance = Number(balance) || 0;
            walletBalance.textContent = `$${safeBalance.toFixed(2)}`;
        }
    }

    // Message display with error handling
    addMessageToChat(message) {
        if (!this.messagesContainer) {
            console.error(`❌ UI MANAGER: No messagesContainer found!`);
            return;
        }

        let messageDiv;
        
        // Handle DOM nodes directly to preserve event listeners (backwards compatibility)
        if (message.content instanceof HTMLElement && !message.metadata?.type) {
            // Legacy DOM element - wrap it in new MessageRenderer structure
            messageDiv = MessageRenderer.createMessageElement({
                sender: message.sender || 'assistant',
                content: message.content,
                timestamp: message.timestamp || new Date(),
                metadata: message.metadata,
                variant: message.variant || null
            });
        } else if (message.metadata?.type === 'source_cards') {
            // Special handling for source cards - recreate with live event listeners
            messageDiv = MessageRenderer.createMessageElement({
                sender: 'assistant',
                content: document.createElement('div'), // Placeholder
                timestamp: message.timestamp || new Date()
            });
            this._recreateSourceCardsMessage(messageDiv.querySelector('.message__body'), message);
        } else {
            // Standard message - use MessageRenderer
            messageDiv = MessageRenderer.createMessageElement({
                sender: message.sender || 'assistant',
                content: message.content || '',
                timestamp: message.timestamp || new Date(),
                metadata: message.metadata,
                variant: message.variant || null
            });
        }
        
        this.messagesContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }
    
    _recreateSourceCardsMessage(messageDiv, message) {
        // Recreate source cards with live event listeners from stored metadata
        const sources = message.metadata?.sources;
        if (!sources || !Array.isArray(sources)) {
            messageDiv.innerHTML = message.content; // Fallback to static HTML
            return;
        }
        
        // Wait for SourceCard to be available
        if (window.SourceCard) {
            this._buildSourceCardsContent(messageDiv, sources);
        } else {
            // Wait for component then rebuild
            document.addEventListener('SourceCardReady', () => {
                this._buildSourceCardsContent(messageDiv, sources);
            }, { once: true });
        }
    }
    
    _buildSourceCardsContent(messageDiv, sources) {
        // Access appState from global app instance (try multiple paths)
        const appState = window.LedeWire?.researchApp?.appState || window.researchApp?.appState || window.app?.appState;
        if (!appState) {
            messageDiv.innerHTML = 'Error: Unable to recreate source cards';
            return;
        }
        
        const sourceCardComponent = new window.SourceCard(appState);
        
        // Create the DOM structure that CSS expects
        const container = document.createElement('div');
        container.className = 'sources-preview-section';
        
        // Create header section
        const header = document.createElement('div');
        header.className = 'preview-header';
        
        const title = document.createElement('h3');
        title.textContent = 'Sources Found';
        
        const subtitle = document.createElement('p');
        subtitle.textContent = `Found ${sources.length} sources for your research`;
        
        header.appendChild(title);
        header.appendChild(subtitle);
        container.appendChild(header);
        
        // Create individual source cards with live event listeners
        sources.forEach((source) => {
            const sourceCard = sourceCardComponent.create(source, {
                showCheckbox: true,
                showActions: true
            });
            container.appendChild(sourceCard);
        });
        
        messageDiv.appendChild(container);
    }
    
    /**
     * Show purchase confirmation modal
     */
    showPurchaseConfirmationModal(purchaseDetails) {
        return new Promise((resolve, reject) => {
            // Remove any existing modal
            const existingModal = document.getElementById('purchaseModal');
            if (existingModal) {
                existingModal.remove();
            }

            const { 
                tier, 
                price, 
                selectedSources = [], 
                query = "",
                titleOverride = null,
                customDescription = null
            } = purchaseDetails;
            
            const sourceCount = selectedSources.length;
            const isSourceUnlock = tier === 'source_unlock';
            const tierName = tier === 'research' ? 'Research Package' : 'Pro Package';
            const isCustom = sourceCount > 0 && !isSourceUnlock;
            
            // Determine modal title and description
            const modalTitle = titleOverride || 'Confirm Purchase';
            const modalDescription = customDescription || 
                (isCustom ? 'Generate custom report with selected sources' : 'Purchase research package');
            
            // Create modal HTML with same structure as auth modal
            const modalHTML = `
                <div id="purchaseModal" class="modal-overlay">
                    <div class="modal-content auth-modal">
                        <div class="auth-modal-header">
                            <img src="/static/ledewire-logo.png" alt="LedeWire" class="auth-modal-logo">
                            <h2>${modalTitle}</h2>
                            <p>${modalDescription}</p>
                            <button class="modal-close" id="purchaseModalClose" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; color: #999; cursor: pointer;">×</button>
                        </div>
                        <div class="auth-modal-content">
                            <div class="purchase-details">
                                ${!isSourceUnlock ? `
                                    <div class="purchase-item">
                                        <span class="purchase-label">${isCustom ? 'Custom Report' : tierName}</span>
                                        <span class="purchase-value">$${Number(price || 0).toFixed(2)}</span>
                                    </div>
                                    ${isCustom ? `
                                        <div class="purchase-item">
                                            <span class="purchase-label">Selected Sources</span>
                                            <span class="purchase-value">${sourceCount} sources</span>
                                        </div>
                                    ` : ''}
                                    <div class="purchase-item">
                                        <span class="purchase-label">Query</span>
                                        <span class="purchase-value">${query.substring(0, 50)}${query.length > 50 ? '...' : ''}</span>
                                    </div>
                                ` : `
                                    <div class="purchase-item">
                                        <span class="purchase-label">Source</span>
                                        <span class="purchase-value">${query.substring(0, 50)}${query.length > 50 ? '...' : ''}</span>
                                    </div>
                                    ${selectedSources[0]?.license_type ? `
                                        <div class="purchase-item">
                                            <span class="purchase-label">License Type</span>
                                            <span class="purchase-value">${selectedSources[0].license_type}</span>
                                        </div>
                                    ` : ''}
                                `}
                                <hr style="margin: 1rem 0; border: none; border-top: 1px solid #eee;">
                                <div class="purchase-item total">
                                    <span class="purchase-label"><strong>Total</strong></span>
                                    <span class="purchase-value"><strong>${price === 0 ? 'FREE' : `$${Number(price || 0).toFixed(2)}`}</strong></span>
                                </div>
                            </div>
                            <div style="display: flex; gap: 1rem; margin-top: 2rem;">
                                <button class="auth-btn" id="purchaseConfirmBtn" style="flex: 1; background-color: #10b981;">
                                    ${price === 0 ? 'Confirm Access' : 'Confirm Purchase'}
                                </button>
                                <button class="auth-btn" id="purchaseCancelBtn" style="flex: 1; background-color: #6b7280; color: white;">
                                    Cancel
                                </button>
                            </div>
                        </div>
                        <div class="auth-modal-footer">
                            Powered by LedeWire
                        </div>
                    </div>
                </div>
            `;

            // Add modal to page
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Set up event listeners
            const modal = document.getElementById('purchaseModal');
            const confirmBtn = document.getElementById('purchaseConfirmBtn');
            const cancelBtn = document.getElementById('purchaseCancelBtn');
            const closeBtn = document.getElementById('purchaseModalClose');

            const handleConfirm = () => {
                modal.remove();
                resolve(true); // User confirmed purchase
            };

            const handleCancel = () => {
                modal.remove();
                resolve(false); // User cancelled purchase
            };

            const handleError = (error) => {
                modal.remove();
                reject(error);
            };

            // Event listeners
            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            closeBtn.addEventListener('click', handleCancel);

            // Close on backdrop click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    handleCancel();
                }
            });

            // Escape key handling
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', handleEscape);
                    handleCancel();
                }
            };
            document.addEventListener('keydown', handleEscape);
        });
    }

    // OLD FORMATTING METHODS REMOVED
    // MessageRenderer now handles all message formatting with consistent BEM architecture
    // Removed: formatMessageHTML, formatSender, formatMessage, formatMessageMetadata,
    // formatResearchPacketHTML, formatSourcesHTML

    // Typing/Loading indicator using MessageRenderer
    showTypingIndicator(message = 'Thinking...') {
        this.hideTypingIndicator(); // Remove any existing indicator
        
        const loadingMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: message,
            timestamp: new Date(),
            variant: 'loading'
        });
        
        loadingMessage.id = 'typingIndicator';
        this.messagesContainer.appendChild(loadingMessage);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    // Clear conversation UI
    clearConversationDisplay() {
        if (!this.messagesContainer) return;
        
        this.messagesContainer.innerHTML = `
            <div class="welcome-message">
                <div class="welcome-content">
                    <h2>Fresh start! 🚀</h2>
                    <p>Your conversation has been cleared. What would you like to research today?</p>
                </div>
            </div>
        `;
    }

    // Utility methods with helper for scroll behavior
    scrollToBottom() {
        if (this.messagesContainer) {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }
    }
    
    sanitizeHtml(text) {
        const allowedTags = ['strong', 'em', 'code', 'br', 'p'];
        const div = document.createElement('div');
        div.innerHTML = text;
        
        this.cleanElement(div, allowedTags, {});
        return div.innerHTML;
    }

    cleanElement(element, allowedTags, allowedAttributes) {
        Array.from(element.childNodes).forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (!allowedTags.includes(node.tagName.toLowerCase())) {
                    node.replaceWith(...node.childNodes);
                } else {
                    // Clean attributes
                    Array.from(node.attributes).forEach(attr => {
                        if (!allowedAttributes[node.tagName.toLowerCase()]?.includes(attr.name)) {
                            node.removeAttribute(attr.name);
                        }
                    });
                    this.cleanElement(node, allowedTags, allowedAttributes);
                }
            }
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}