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
            if (error.message.includes('503')) {
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
        
        // Display clean tier options only - no overwhelming text
        const tiersSection = this.createTiersSection(data.refined_query);
        
        resultsDiv.innerHTML = tiersSection;

        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.appendChild(resultsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add event listeners for tier cards in this specific results section
        this.addTierCardListeners(resultsDiv);
    }

    createTiersSection(query) {
        const tiers = [
            {
                name: 'Basic',
                price: 1.00,
                sources: 10,
                valueProps: '10 licensed sources',
                description: 'Professional summary with key insights'
            },
            {
                name: 'Research', 
                price: 2.00,
                sources: 20,
                valueProps: '20 licensed sources + structured outline',
                description: 'Expert analysis & actionable recommendations'
            },
            {
                name: 'Pro',
                price: 4.00,
                sources: 40,
                valueProps: '40 licensed sources + outline + strategic insights',
                description: 'Comprehensive report with competitive intelligence'
            }
        ];

        // Create tiers section container - just the cards, no headers
        const sectionDiv = document.createElement('div');
        sectionDiv.className = 'research-tiers-section';
        
        const tiersGrid = document.createElement('div');
        tiersGrid.className = 'tiers-grid';
        
        // Create tier cards using DOM APIs (secure from XSS)
        tiers.forEach(tier => {
            const tierCard = document.createElement('div');
            tierCard.className = 'tier-card story-card';
            
            // Use dataset to safely set attributes (no XSS)
            tierCard.dataset.tier = tier.name.toLowerCase();
            tierCard.dataset.query = query; // Safe - directly set via DOM API
            tierCard.dataset.price = tier.price.toString();
            
            const tierTitle = document.createElement('div');
            tierTitle.className = 'tier-title';
            tierTitle.textContent = `${tier.name} Tier`;
            tierCard.appendChild(tierTitle);
            
            const tierPrice = document.createElement('div');
            tierPrice.className = 'tier-price';
            tierPrice.textContent = `$${tier.price.toFixed(2)}`;
            tierCard.appendChild(tierPrice);
            
            const tierValue = document.createElement('div');
            tierValue.className = 'tier-value';
            tierValue.textContent = tier.valueProps;
            tierCard.appendChild(tierValue);
            
            const tierDescription = document.createElement('div');
            tierDescription.className = 'tier-description-compelling';
            tierDescription.textContent = tier.description;
            tierCard.appendChild(tierDescription);
            
            tiersGrid.appendChild(tierCard);
        });
        
        sectionDiv.appendChild(tiersGrid);
        
        // Store the query for later use by event handlers
        this.currentQuery = query;
        
        return sectionDiv.outerHTML;
    }

    selectTier(tierName, query, container) {
        // Remove selection from tier cards in this specific container
        container.querySelectorAll('.tier-card').forEach(card => {
            card.classList.remove('selected');
        });

        // Add selection to clicked card in this container
        const selectedCard = container.querySelector(`[data-tier="${tierName}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
        }

        // Show purchase option for selected tier
        this.showPurchaseOption(tierName, query);
    }

    showPurchaseOption(tierName, query) {
        // Store the selected tier and query for the purchase flow
        this.selectedTier = tierName;
        this.currentQuery = query;
        
        // Launch the LedeWire purchase flow - this will handle auth, wallet, and payment
        this.handlePurchaseFlow();
    }

    handlePurchaseFlow() {
        if (!this.authToken) {
            // No authentication - show LedeWire auth modal
            this.showAuthModal();
        } else {
            // Already authenticated - get wallet balance and show payment modal
            this.checkWalletAndShowModal('tier');
        }
    }

    showAuthModal() {
        // Create authentication modal if it doesn't exist
        let authModal = document.getElementById('authModal');
        if (!authModal) {
            authModal = this.createAuthModal();
            document.body.appendChild(authModal);
        }
        authModal.style.display = 'block';
    }

    createAuthModal() {
        const modal = document.createElement('div');
        modal.id = 'authModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content auth-modal">
                <span class="close" onclick="this.parentElement.parentElement.style.display='none'">&times;</span>
                <h2>🔐 LedeWire Authentication Required</h2>
                <p>Please sign in to access your wallet and make purchases.</p>
                
                <div class="auth-form">
                    <input type="email" id="authEmail" placeholder="Email address" required>
                    <input type="password" id="authPassword" placeholder="Password" required>
                    <input type="text" id="authName" placeholder="Full name (for signup)" style="display:none;">
                    
                    <button id="loginBtn" class="auth-btn primary">Sign In</button>
                    <button id="signupBtn" class="auth-btn secondary">Create Account</button>
                    
                    <div class="auth-toggle">
                        <a href="#" id="toggleAuth">Need an account? Sign up</a>
                    </div>
                </div>
            </div>
        `;

        // Add event listeners
        modal.querySelector('#loginBtn').addEventListener('click', () => this.handleAuth('login'));
        modal.querySelector('#signupBtn').addEventListener('click', () => this.handleAuth('signup'));
        modal.querySelector('#toggleAuth').addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleAuthMode();
        });

        return modal;
    }

    toggleAuthMode() {
        const nameField = document.getElementById('authName');
        const loginBtn = document.getElementById('loginBtn');
        const signupBtn = document.getElementById('signupBtn');
        const toggleLink = document.getElementById('toggleAuth');

        if (nameField.style.display === 'none') {
            // Switch to signup mode
            nameField.style.display = 'block';
            loginBtn.style.display = 'none';
            signupBtn.style.display = 'block';
            toggleLink.textContent = 'Already have an account? Sign in';
        } else {
            // Switch to login mode
            nameField.style.display = 'none';
            loginBtn.style.display = 'block';
            signupBtn.style.display = 'none';
            toggleLink.textContent = 'Need an account? Sign up';
        }
    }

    async handleAuth(type) {
        const email = document.getElementById('authEmail').value;
        const password = document.getElementById('authPassword').value;
        const name = document.getElementById('authName').value;

        if (!email || !password || (type === 'signup' && !name)) {
            this.addMessage('system', 'Please fill in all required fields');
            return;
        }

        try {
            const endpoint = type === 'login' ? '/auth/login/email' : '/auth/signup';
            const body = type === 'login' 
                ? { email, password }
                : { email, password, name };

            const response = await fetch(`${this.apiBase}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            const data = await response.json();
            
            if (response.ok && data.success) {
                this.authToken = data.token;
                // Persist token to localStorage for future sessions
                localStorage.setItem('authToken', data.token);
                document.getElementById('authModal').style.display = 'none';
                
                // Now proceed with the original purchase flow
                this.checkWalletAndShowModal('tier');
            } else {
                throw new Error(data.message || `${type} failed`);
            }

        } catch (error) {
            console.error(`${type} error:`, error);
            this.addMessage('system', `${type} failed: ${error.message}`);
        }
    }

    async checkWalletAndShowModal(type, itemDetails = null) {
        try {
            // Get real wallet balance from backend
            const response = await fetch(`${this.apiBase}/wallet/balance`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.walletBalance = data.balance_cents / 100; // Convert cents to dollars
                
                // Now show wallet modal with real balance
                this.showWalletModal(type, itemDetails);
            } else {
                throw new Error('Failed to get wallet balance');
            }

        } catch (error) {
            console.error('Wallet balance error:', error);
            this.addMessage('system', 'Could not load wallet balance. Please try again.');
        }
    }

    showWalletModal(type, itemDetails = null) {
        // Create wallet modal if it doesn't exist
        let walletModal = document.getElementById('walletModal');
        if (!walletModal) {
            walletModal = this.createWalletModal();
            document.body.appendChild(walletModal);
        }

        // Update modal content based on type and current selection
        const prices = { basic: 1.00, research: 2.00, pro: 4.00 };
        const price = prices[this.selectedTier] || 0;
        
        document.getElementById('walletBalance').textContent = `$${this.walletBalance.toFixed(2)}`;
        document.getElementById('transactionItem').textContent = `${this.selectedTier.charAt(0).toUpperCase() + this.selectedTier.slice(1)} Research Package`;
        document.getElementById('transactionAmount').textContent = `$${price.toFixed(2)}`;
        
        walletModal.style.display = 'block';
    }

    createWalletModal() {
        const modal = document.createElement('div');
        modal.id = 'walletModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content wallet-modal">
                <span class="close" onclick="this.parentElement.parentElement.style.display='none'">&times;</span>
                <h2>💳 LedeWire Wallet</h2>
                <div class="wallet-info">
                    <p class="balance-label">Current Balance:</p>
                    <p class="balance-amount" id="walletBalance">$0.00</p>
                </div>
                <hr>
                <div class="transaction-details">
                    <div class="transaction-row">
                        <span>Item:</span>
                        <span id="transactionItem">Research Package</span>
                    </div>
                    <div class="transaction-row total">
                        <span>Total:</span>
                        <span id="transactionAmount">$0.00</span>
                    </div>
                </div>
                <div class="wallet-actions">
                    <button id="confirmPaymentBtn" class="wallet-btn primary">Confirm Payment</button>
                    <button onclick="document.getElementById('walletModal').style.display='none'" class="wallet-btn secondary">Cancel</button>
                </div>
            </div>
        `;

        // Add event listener for confirm payment
        modal.querySelector('#confirmPaymentBtn').addEventListener('click', () => this.confirmPayment('tier'));

        return modal;
    }

    async confirmPayment(type, itemDetails = null) {
        const prices = { basic: 1.00, research: 2.00, pro: 4.00 };
        const price = prices[this.selectedTier] || 0;

        // Check balance
        if (this.walletBalance < price) {
            this.addMessage('system', 'Insufficient wallet balance');
            return;
        }

        document.getElementById('walletModal').style.display = 'none';
        
        if (type === 'tier') {
            await this.processTierPurchase();
        }
    }

    async processTierPurchase() {
        if (!this.selectedTier || !this.currentQuery) return;

        try {
            const response = await fetch(`${this.apiBase}/purchase`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({
                    query: this.currentQuery,
                    tier: this.selectedTier,
                    user_wallet_id: 'demo_wallet_' + Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Update wallet balance
                this.walletBalance -= data.wallet_deduction;
                this.addMessage('system', `🎉 Payment processed successfully! $${data.wallet_deduction.toFixed(2)} deducted from wallet. Your research package is being prepared.`);
            } else {
                throw new Error(data.message || 'Purchase failed');
            }
        } catch (error) {
            console.error('Purchase error:', error);
            this.addMessage('system', 'Purchase failed. Please check your wallet balance and try again.');
        }
    }


    getLicenseIcon(protocol) {
        const icons = {
            'rsl': '🔒 RSL',
            'tollbit': '⚡ Tollbit',
            'cloudflare': '☁️ Cloudflare'
        };
        return `<span class="license-badge">${icons[protocol] || '🔐 Licensed'}</span>`;
    }

    addTierCardListeners(container) {
        // Use event delegation to avoid duplicate listeners
        container.addEventListener('click', (event) => {
            const tierCard = event.target.closest('.tier-card');
            if (tierCard) {
                const tierName = tierCard.dataset.tier;
                const query = tierCard.dataset.query;
                
                if (tierName && query) {
                    this.selectTier(tierName, query, container);
                }
            }
        });
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