/**
 * UI Manager - Handles DOM manipulation and UI updates
 * Extracted from the monolithic ChatResearchApp
 */
export class UIManager {
    constructor(appState) {
        this.appState = appState;
        this.messagesContainer = document.getElementById('messagesContainer');
        this.chatInput = document.getElementById('chatInput');
        this.sendButton = document.getElementById('sendButton');
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
            const descriptions = {
                'chat': '💬 Conversational AI mode - Explore topics through natural dialogue',
                'research': '🔍 Research mode - Find and license authoritative sources',
                'report': '📊 Report Builder - Create comprehensive research packages'
            };
            modeDescription.textContent = descriptions[this.appState.getMode()] || descriptions['chat'];
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

    // Character count management
    updateCharacterCount() {
        const characterCount = document.querySelector('.character-count');
        if (!characterCount || !this.chatInput) return;
        
        const count = this.chatInput.value.length;
        characterCount.textContent = `${count} / 2000`;
        
        if (count > 1800) {
            characterCount.style.color = 'var(--destructive)';
        } else if (count > 1500) {
            characterCount.style.color = 'var(--accent)';
        } else {
            characterCount.style.color = 'var(--muted-foreground)';
        }
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }

    // Wallet display management
    updateWalletDisplay(balance = 0) {
        const walletBalance = document.getElementById('walletBalance');
        if (walletBalance) {
            walletBalance.textContent = `$${balance.toFixed(2)}`;
        }
    }

    // Message display
    addMessageToChat(message) {
        if (!this.messagesContainer) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.sender}`;
        messageDiv.innerHTML = this.formatMessageHTML(message);
        
        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        
        return messageDiv;
    }

    formatMessageHTML(message) {
        const timeString = message.timestamp.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        let html = `
            <div class="message-content">
                <div class="message-header">
                    <span class="message-sender">${this.formatSender(message.sender)}</span>
                    <span class="message-time">${timeString}</span>
                </div>
                <div class="message-text">${this.formatMessage(message.content)}</div>
            </div>
        `;
        
        // Add metadata if present (research packets, sources, etc.)
        if (message.metadata) {
            html += this.formatMessageMetadata(message.metadata);
        }
        
        return html;
    }

    formatSender(sender) {
        const senderMap = {
            'user': '👤 You',
            'assistant': '🤖 Assistant', 
            'system': '⚙️ System'
        };
        return senderMap[sender] || sender;
    }

    formatMessage(text) {
        // Basic markdown-like formatting with sanitization
        return this.sanitizeHtml(text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>'));
    }

    formatMessageMetadata(metadata) {
        // Handle different types of metadata (sources, research packets, etc.)
        if (metadata.type === 'research_packet') {
            return this.formatResearchPacketHTML(metadata.data);
        } else if (metadata.type === 'sources') {
            return this.formatSourcesHTML(metadata.data);
        }
        return '';
    }

    formatResearchPacketHTML(packet) {
        // Format research packet display
        return `<div class="research-packet">${packet.summary || 'Research completed'}</div>`;
    }

    formatSourcesHTML(sources) {
        // Format sources display
        return sources.map(source => 
            `<div class="source-preview">${source.title}</div>`
        ).join('');
    }

    // Typing indicator
    showTypingIndicator() {
        this.hideTypingIndicator(); // Remove any existing indicator
        
        const typingDiv = document.createElement('div');
        typingDiv.id = 'typingIndicator';
        typingDiv.className = 'message assistant typing';
        typingDiv.innerHTML = `
            <div class="message-content">
                <div class="message-header">
                    <span class="message-sender">🤖 Assistant</span>
                </div>
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        
        this.messagesContainer.appendChild(typingDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
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

    // Utility methods
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