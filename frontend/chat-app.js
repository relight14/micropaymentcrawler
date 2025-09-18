class ChatResearchApp {
    constructor() {
        this.currentMode = 'conversational'; // 'conversational' or 'deep_research'
        this.apiBase = window.location.origin;
        this.authToken = localStorage.getItem('authToken');
        this.conversationHistory = [];
        this.initializeEventListeners();
        this.updateCharacterCount();
    }

    initializeEventListeners() {
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        const modeToggle = document.getElementById('modeToggle');
        const clearButton = document.getElementById('clearButton');

        // Chat functionality
        sendButton.addEventListener('click', () => this.sendMessage());
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Mode toggle
        modeToggle.addEventListener('click', () => this.toggleMode());
        
        // Clear conversation
        clearButton.addEventListener('click', () => this.clearConversation());

        // Enable/disable send button and character count
        chatInput.addEventListener('input', (e) => {
            sendButton.disabled = !e.target.value.trim();
            this.updateCharacterCount();
        });

        // Auto-resize textarea
        chatInput.addEventListener('input', () => this.autoResizeTextarea(chatInput));
    }

    updateCharacterCount() {
        const chatInput = document.getElementById('chatInput');
        const characterCount = document.querySelector('.character-count');
        const count = chatInput.value.length;
        characterCount.textContent = `${count} / 2000`;
        
        if (count > 1800) {
            characterCount.style.color = 'var(--error-color)';
        } else if (count > 1500) {
            characterCount.style.color = 'var(--warning-color)';
        } else {
            characterCount.style.color = 'var(--text-secondary)';
        }
    }

    autoResizeTextarea(textarea) {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }

    toggleMode() {
        this.currentMode = this.currentMode === 'conversational' ? 'deep_research' : 'conversational';
        this.updateModeDisplay();
        
        // Add mode change message to chat
        const modeMessage = this.currentMode === 'deep_research' 
            ? "🔬 Switched to Deep Research mode - I'll search licensed sources and provide detailed research findings with citations."
            : "💬 Switched to Conversational mode - Let's explore your research interests together through natural conversation!";
        
        this.addMessage('system', modeMessage);
    }

    updateModeDisplay() {
        const modeToggle = document.getElementById('modeToggle');
        const modeIndicator = document.querySelector('.mode-indicator');
        
        if (this.currentMode === 'deep_research') {
            modeToggle.textContent = 'Switch to Conversation';
            modeIndicator.innerHTML = '🔬 Deep Research Mode';
            modeIndicator.className = 'mode-indicator research-mode';
        } else {
            modeToggle.textContent = 'Switch to Deep Research';
            modeIndicator.innerHTML = '💬 Conversational Mode';
            modeIndicator.className = 'mode-indicator conversation-mode';
        }
    }

    async sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        if (!message) return;

        // Remove welcome message on first interaction
        const welcomeMessage = document.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        // Add user message to chat
        this.addMessage('user', message);
        input.value = '';
        input.style.height = 'auto';
        this.updateCharacterCount();
        
        // Show typing indicator
        this.showTypingIndicator();

        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add auth token for deep research mode
            if (this.currentMode === 'deep_research' && this.authToken) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
            }

            const response = await fetch(`${this.apiBase}/chat`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    message: message,
                    mode: this.currentMode
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.hideTypingIndicator();
            
            // Add AI response
            this.addMessage('assistant', data.response);
            
            // Handle deep research results
            if (data.mode === 'deep_research' && data.sources) {
                this.displayResearchResults(data);
            }

        } catch (error) {
            this.hideTypingIndicator();
            console.error('Chat error:', error);
            
            let errorMessage = "I'm having trouble connecting right now. Please try again in a moment.";
            if (error.message.includes('401')) {
                errorMessage = "Authentication required for Deep Research mode. Please log in to access premium features.";
            } else if (error.message.includes('503')) {
                errorMessage = "The research service is temporarily unavailable. Please try again shortly.";
            }
            
            this.addMessage('system', errorMessage);
        }
        
        // Re-enable send button
        const sendButton = document.getElementById('sendButton');
        sendButton.disabled = false;
    }

    addMessage(sender, content, metadata = null) {
        const messagesContainer = document.getElementById('messagesContainer');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;

        if (sender === 'user') {
            messageDiv.innerHTML = `
                <div class="message-content">
                    <div class="message-text">${this.escapeHtml(content)}</div>
                    <div class="message-time">${new Date().toLocaleTimeString()}</div>
                </div>
                <div class="message-avatar">👤</div>
            `;
        } else if (sender === 'assistant') {
            const icon = this.currentMode === 'deep_research' ? '🔬' : '🤖';
            messageDiv.innerHTML = `
                <div class="message-avatar">${icon}</div>
                <div class="message-content">
                    <div class="message-text">${this.formatMessage(content)}</div>
                    <div class="message-time">${new Date().toLocaleTimeString()}</div>
                </div>
            `;
        } else { // system
            messageDiv.innerHTML = `
                <div class="system-message">
                    <div class="message-text">${this.escapeHtml(content)}</div>
                </div>
            `;
        }

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add to conversation history
        this.conversationHistory.push({ sender, content, timestamp: new Date() });
    }

    displayResearchResults(data) {
        if (!data.sources || data.sources.length === 0) return;

        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'research-results';
        
        let licensingInfo = '';
        if (data.licensing_summary && data.total_cost > 0) {
            const protocolBreakdown = Object.entries(data.licensing_summary.by_protocol || {})
                .map(([protocol, info]) => {
                    const icon = this.getLicenseIcon(protocol);
                    return `<span class="protocol-cost">${icon}: $${info.total_cost.toFixed(2)}</span>`;
                }).join(' • ');

            licensingInfo = `
                <div class="licensing-summary">
                    <h4>💰 Licensed Research Package Available</h4>
                    <p class="cost-breakdown">Total Cost: <strong>$${data.total_cost.toFixed(2)}</strong></p>
                    <p class="protocol-breakdown">${protocolBreakdown}</p>
                    <p class="source-count">Licensed Sources: ${data.licensing_summary.licensed_count} of ${data.sources.length}</p>
                    <button onclick="app.purchaseResearch('${this.escapeHtml(data.refined_query)}', ${data.total_cost})" class="purchase-btn">
                        🔓 Purchase Full Research Access
                    </button>
                </div>
            `;
        }

        const sourcesHtml = data.sources.slice(0, 5).map((source, index) => {
            const licenseIcon = source.license_info ? 
                this.getLicenseIcon(source.license_info.terms.protocol) : '';
            
            const costInfo = source.license_cost ? `<span class="source-cost">$${source.license_cost.toFixed(2)}</span>` : '';
            
            return `
                <div class="source-card">
                    <div class="source-header">
                        <h4>${this.escapeHtml(source.title)}</h4>
                        <div class="source-badges">
                            ${licenseIcon}
                            ${costInfo}
                        </div>
                    </div>
                    <p class="source-excerpt">${this.escapeHtml(source.excerpt)}</p>
                    <div class="source-meta">
                        <span class="source-domain">📄 ${source.domain}</span>
                        <span class="source-quality">Quality: ${source.quality_score}/10</span>
                    </div>
                </div>
            `;
        }).join('');

        const moreSourcesInfo = data.sources.length > 5 ? 
            `<p class="more-sources">... and ${data.sources.length - 5} more sources</p>` : '';

        resultsDiv.innerHTML = `
            <div class="research-header">
                <h3>🎯 Research Results Found</h3>
                <p>Discovered ${data.sources.length} relevant sources for your query</p>
            </div>
            ${licensingInfo}
            <div class="sources-preview">
                <h4>📚 Source Preview</h4>
                ${sourcesHtml}
                ${moreSourcesInfo}
            </div>
        `;

        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.appendChild(resultsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    getLicenseIcon(protocol) {
        const icons = {
            'rsl': '🔒 RSL',
            'tollbit': '⚡ Tollbit',
            'cloudflare': '☁️ Cloudflare'
        };
        return `<span class="license-badge">${icons[protocol] || '🔐 Licensed'}</span>`;
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('messagesContainer');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message assistant-message typing-indicator';
        typingDiv.id = 'typingIndicator';
        
        const icon = this.currentMode === 'deep_research' ? '🔬' : '🤖';
        typingDiv.innerHTML = `
            <div class="message-avatar">${icon}</div>
            <div class="message-content">
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;
        messagesContainer.appendChild(typingDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    hideTypingIndicator() {
        const typingIndicator = document.getElementById('typingIndicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    async clearConversation() {
        if (confirm('Clear the entire conversation? This cannot be undone.')) {
            try {
                const response = await fetch(`${this.apiBase}/clear-conversation`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (response.ok) {
                    document.getElementById('messagesContainer').innerHTML = `
                        <div class="welcome-message">
                            <div class="welcome-content">
                                <h2>Fresh start! 🚀</h2>
                                <p>Your conversation has been cleared. What would you like to research today?</p>
                            </div>
                        </div>
                    `;
                    this.conversationHistory = [];
                } else {
                    throw new Error('Failed to clear conversation');
                }
                
            } catch (error) {
                console.error('Error clearing conversation:', error);
                this.addMessage('system', 'Failed to clear conversation. Please refresh the page to start fresh.');
            }
        }
    }

    async purchaseResearch(query, cost) {
        // Check if user is authenticated
        if (!this.authToken) {
            this.addMessage('system', 
                `To purchase the full research package for "${query}" ($${cost.toFixed(2)}), please log in first. ` +
                'This would integrate with the LedeWire wallet system for secure payments.'
            );
            return;
        }

        // Simulate purchase flow - in production this would integrate with LedeWire
        const confirmed = confirm(
            `Purchase Research Package?\n\n` +
            `Query: "${query}"\n` +
            `Total Cost: $${cost.toFixed(2)}\n\n` +
            `This includes access to all licensed sources with full content and citations.`
        );

        if (confirmed) {
            this.addMessage('system', 
                `🔓 Research package purchased! In production, this would:\n` +
                `• Deduct $${cost.toFixed(2)} from your LedeWire wallet\n` +
                `• Unlock all licensed sources\n` +
                `• Provide full content access with proper citations\n` +
                `• Generate a comprehensive research report\n\n` +
                `The payment would be processed securely through LedeWire's API.`
            );
        }
    }

    formatMessage(text) {
        // Basic markdown-like formatting
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the chat app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ChatResearchApp();
});