class ChatResearchApp {
    constructor() {
        this.currentMode = 'conversational'; // 'conversational' or 'deep_research'
        this.apiBase = window.location.origin;
        this.authToken = localStorage.getItem('authToken');
        this.walletBalance = 0; // Initialize to prevent NaN display
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

            // Handle 401 responses in deep research mode - token is invalid/expired
            if (response.status === 401 && this.currentMode === 'deep_research') {
                console.log('Token expired during deep research, clearing auth and showing login...');
                this.hideTypingIndicator(); // Fix: ensure loading state is cleared
                this.authToken = null;
                localStorage.removeItem('authToken');
                this.addMessage('assistant', 'Session expired. Please sign in to continue with deep research.');
                this.showAuthModal();
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.hideTypingIndicator();
            
            // Add AI response
            this.addMessage('assistant', data.response);
            
            // Handle deep research results
            if (data.mode === 'deep_research' && data.sources) {
                await this.displayResearchResults(data);
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

    displayResearchPacketInChat(packet) {
        // Create formatted research package content for chat display
        if (!packet) {
            console.error('No packet data provided');
            return;
        }
        
        const tierName = this.formatTierName(packet.tier);
        const totalSources = packet.total_sources || 0;
        const researchContent = `
            <div class="research-package-chat">
                <div class="package-header">
                    <h3>📋 ${this.escapeHtml(tierName)} Research Package</h3>
                    <div class="package-meta">${totalSources} Licensed Sources</div>
                </div>
                
                <div class="package-section">
                    <h4>📝 Executive Summary</h4>
                    <div class="content">${this.formatResearchContent(packet.summary || 'No summary available.')}</div>
                </div>
                
                ${packet.outline ? `
                <div class="package-section">
                    <h4>🗂️ Research Outline</h4>
                    <div class="content">${this.formatResearchContent(packet.outline)}</div>
                </div>
                ` : ''}
                
                ${packet.insights ? `
                <div class="package-section">
                    <h4>💡 Key Insights</h4>
                    <div class="content">${this.formatResearchContent(packet.insights)}</div>
                </div>
                ` : ''}
                
                <div class="package-section">
                    <h4>📚 Licensed Sources (${(packet.sources || []).length} available)</h4>
                    <div class="sources-grid-chat">
                        ${(packet.sources || []).map(source => this.createSourceCardForChat(source)).join('')}
                    </div>
                </div>
            </div>
        `;

        // Add as system message with special formatting
        const messagesContainer = document.getElementById('messagesContainer');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system-message research-package-message';
        messageDiv.innerHTML = `
            <div class="system-message">
                ${researchContent}
            </div>
        `;

        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    formatTierName(tier) {
        return tier.charAt(0).toUpperCase() + tier.slice(1);
    }

    formatResearchContent(text) {
        // Enhanced formatting for research content with sanitization
        const formatted = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/^/, '<p>')
            .replace(/$/, '</p>');
        return this.sanitizeHtml(formatted);
    }

    sanitizeHtml(text) {
        // Create a temporary element to safely parse HTML
        const temp = document.createElement('div');
        temp.innerHTML = text;
        
        // Define allowed tags and their allowed attributes
        const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'blockquote', 'ul', 'ol', 'li', 'span'];
        const allowedAttributes = ['class'];
        
        // Recursively clean all elements
        this.cleanElement(temp, allowedTags, allowedAttributes);
        
        return temp.innerHTML;
    }

    cleanElement(element, allowedTags, allowedAttributes) {
        // Remove script and style elements completely
        const scripts = element.querySelectorAll('script, style');
        scripts.forEach(script => script.remove());
        
        // Check all child elements
        const children = Array.from(element.children);
        children.forEach(child => {
            if (!allowedTags.includes(child.tagName.toLowerCase())) {
                // Replace disallowed tags with their text content
                const textNode = document.createTextNode(child.textContent);
                child.parentNode.replaceChild(textNode, child);
            } else {
                // Remove disallowed attributes
                const attributes = Array.from(child.attributes);
                attributes.forEach(attr => {
                    if (!allowedAttributes.includes(attr.name.toLowerCase()) && 
                        !attr.name.startsWith('data-') && 
                        attr.name !== 'class') {
                        child.removeAttribute(attr.name);
                    }
                });
                
                // Recursively clean child elements
                this.cleanElement(child, allowedTags, allowedAttributes);
            }
        });
    }

    createSourceCardForChat(source) {
        if (!source) return '';
        
        const excerpt = source.excerpt || '';
        const title = source.title || 'Untitled Source';
        const domain = source.domain || 'Unknown';
        const url = source.url || '#';
        const unlockPrice = source.unlock_price || 0;
        const sourceId = source.id || '';
        
        const quote = this.extractCompellingQuote(excerpt);
        const licensingBadge = source.licensing_protocol ? 
            this.getLicenseIcon(source.licensing_protocol) : 
            '<span class="license-badge">📄 Standard</span>';

        return `
            <div class="source-card-chat" data-source-id="${this.escapeHtml(sourceId)}">
                <div class="source-header">
                    <h5><a href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${this.sanitizeHtml(title)}</a></h5>
                    <div class="source-meta">
                        <span class="domain-badge">${this.escapeHtml(domain)}</span>
                        ${licensingBadge}
                    </div>
                </div>
                <div class="source-content">
                    <blockquote>"${this.sanitizeHtml(quote)}"</blockquote>
                    <p>${this.sanitizeHtml(this.createSourceDescription(excerpt, quote))}</p>
                </div>
                <div class="source-unlock">
                    <span class="unlock-price">$${unlockPrice.toFixed(2)}</span>
                    <button class="unlock-btn-chat" onclick="chatApp.handleSourceUnlockInChat('${this.escapeHtml(sourceId)}', ${unlockPrice}, '${this.escapeHtml(title)}')">
                        🔓 Unlock
                    </button>
                </div>
            </div>
        `;
    }

    extractCompellingQuote(excerpt) {
        // Extract first meaningful sentence or chunk
        if (!excerpt || typeof excerpt !== 'string') {
            return 'No preview available';
        }
        
        const sentences = excerpt.split(/[.!?]+/);
        const meaningfulSentence = sentences.find(s => s && s.trim().length > 20) || sentences[0] || '';
        const cleanSentence = meaningfulSentence.trim();
        return cleanSentence.substring(0, 120) + (cleanSentence.length > 120 ? '...' : '');
    }

    createSourceDescription(excerpt, quote) {
        // Create description without repeating the quote
        if (!excerpt || typeof excerpt !== 'string') {
            return 'No description available';
        }
        
        // More robust quote removal - try multiple approaches
        let remaining = excerpt;
        
        // Remove exact quote match
        if (quote) {
            remaining = remaining.replace(quote, '');
            // Also try removing quote without quotes
            remaining = remaining.replace(quote.replace(/"/g, ''), '');
            // Remove any leftover quote marks that might be orphaned
            remaining = remaining.replace(/^["']|["']$/g, '');
        }
        
        // Clean up extra spaces and trim
        remaining = remaining.replace(/\s+/g, ' ').trim();
        
        // If nothing meaningful left, return a generic description
        if (remaining.length < 20) {
            return 'Additional insights and analysis available with full access.';
        }
        
        return remaining.substring(0, 200) + (remaining.length > 200 ? '...' : '');
    }

    async handleSourceUnlockInChat(sourceId, price, title) {
        if (!this.authToken) {
            this.addMessage('system', 'Please log in to unlock premium sources.');
            return;
        }

        if (this.walletBalance < price) {
            this.addMessage('system', 'Insufficient wallet balance to unlock this source.');
            return;
        }

        this.addMessage('system', `🔓 Unlocking "${title}" for $${price.toFixed(2)}...`);
        
        // For now, simulate unlocking - in full version would make API call
        setTimeout(() => {
            this.walletBalance -= price;
            this.addMessage('system', `✅ Source unlocked! $${price.toFixed(2)} deducted from wallet. Full article content would be displayed here.`);
        }, 1000);
    }

    async displayResearchResults(data) {
        if (!data.sources || data.sources.length === 0) return;

        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'research-results';
        
        // First, display the actual polished source cards from Tavily+Claude hybrid pipeline
        const sourcesPreview = document.createElement('div');
        sourcesPreview.className = 'sources-preview-section';
        sourcesPreview.innerHTML = `
            <div class="preview-header">
                <h3>🔬 Research Preview: ${data.sources.length} Premium Sources Found</h3>
                <p>Real URLs with AI-polished content and licensing verification</p>
            </div>
            <div class="sources-preview-grid">
                ${data.sources.slice(0, 6).map(source => this.createSourceCardForChat(source)).join('')}
            </div>
            ${data.sources.length > 6 ? `<p class="more-sources-hint">+ ${data.sources.length - 6} more sources available with tier selection</p>` : ''}
        `;
        
        resultsDiv.appendChild(sourcesPreview);
        
        // Then show tier options for purchase
        const tiersSection = await this.createTiersSection(data.refined_query);
        resultsDiv.appendChild(tiersSection);

        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.appendChild(resultsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add event listeners for tier cards in this specific results section
        this.addTierCardListeners(resultsDiv);
    }

    async getTierPrice(tierName) {
        // Helper method to get tier price from API
        try {
            const response = await fetch(`${this.apiBase}/tiers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query: 'pricing_query' })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const tier = data.tiers.find(t => t.tier === tierName.toLowerCase());
            return tier ? tier.price : 0;
        } catch (error) {
            console.error('Failed to fetch tier price from API:', error);
            // Fallback pricing
            const fallbackPrices = { basic: 0.00, research: 2.00, pro: 4.00 };
            return fallbackPrices[tierName.toLowerCase()] || 0;
        }
    }

    async createTiersSection(query) {
        // Fetch dynamic pricing from backend API instead of hardcoded values
        let tiers = [];
        try {
            const response = await fetch(`${this.apiBase}/tiers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query: query })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Transform backend response to frontend format
            tiers = data.tiers.map(tier => ({
                name: tier.tier.charAt(0).toUpperCase() + tier.tier.slice(1),
                price: tier.price,
                sources: tier.sources,
                valueProps: `Up to ${tier.sources} licensed${tier.includes_outline ? ' sources + expert outline' : ' premium sources'}${tier.includes_insights ? ' + strategic insights' : ''}`,
                description: tier.description
            }));
        } catch (error) {
            console.error('Failed to fetch tiers from API, using fallback:', error);
            // Fallback to hardcoded tiers if API fails
            tiers = [
                {
                    name: 'Basic',
                    price: 0.00,
                    sources: 10,
                    valueProps: 'Up to 10 licensed premium sources',
                    description: 'Free research with quality sources and professional analysis'
                },
                {
                    name: 'Research', 
                    price: 2.00,
                    sources: 20,
                    valueProps: 'Up to 20 licensed sources + expert outline',
                    description: 'Premium licensed sources with structured insights and actionable recommendations'
                },
                {
                    name: 'Pro',
                    price: 4.00,
                    sources: 40,
                    valueProps: 'Up to 40 licensed sources + outline + strategic insights',
                    description: 'Comprehensive licensed research with competitive intelligence and strategic analysis'
                }
            ];
        }

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
            tierPrice.textContent = tier.price === 0 ? 'Free' : `$${tier.price.toFixed(2)}`;
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
        
        return sectionDiv;
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
        // Clear any previous errors
        this.clearModalErrors();
        authModal.style.display = 'block';
    }

    showModalError(message) {
        // Clear any existing errors first
        this.clearModalErrors();
        
        // Create error element
        const errorDiv = document.createElement('div');
        errorDiv.className = 'modal-error';
        errorDiv.textContent = message;
        
        // Add to current modal (auth or wallet)
        const authModal = document.getElementById('authModal');
        const walletModal = document.getElementById('walletModal');
        
        if (authModal && authModal.style.display === 'block') {
            const authForm = authModal.querySelector('.auth-form');
            authForm.insertBefore(errorDiv, authForm.firstChild);
        } else if (walletModal && walletModal.style.display === 'block') {
            const walletContent = walletModal.querySelector('.wallet-content');
            walletContent.insertBefore(errorDiv, walletContent.firstChild);
        }
    }

    clearModalErrors() {
        document.querySelectorAll('.modal-error').forEach(error => error.remove());
    }

    createAuthModal() {
        const modal = document.createElement('div');
        modal.id = 'authModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content auth-modal">
                <span class="close" onclick="this.parentElement.parentElement.style.display='none'">&times;</span>
                <h2>Welcome back!</h2>
                <p>Sign in to access your wallet and purchase this premium content.</p>
                
                <div class="auth-form">
                    <input type="email" id="authEmail" placeholder="Email *" required>
                    <input type="password" id="authPassword" placeholder="Password *" required>
                    <input type="text" id="authName" placeholder="Full name *" style="display:none;">
                    
                    <button id="loginBtn" class="auth-btn primary">Log In</button>
                    <button id="signupBtn" class="auth-btn primary">Sign up</button>
                    
                    <div class="auth-toggle">
                        <a href="#" id="forgotPassword">Forgot Password?</a>
                        <a href="#" id="toggleAuth">Need an account? Sign up</a>
                    </div>
                </div>
                
                <div class="auth-footer">
                    Powered by LedeWire
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
        const forgotLink = document.getElementById('forgotPassword');

        if (nameField.style.display === 'none') {
            // Switch to signup mode
            nameField.style.display = 'block';
            loginBtn.style.display = 'none';
            signupBtn.style.display = 'block';
            toggleLink.textContent = 'Already have an account? Sign in';
            forgotLink.style.display = 'none';
        } else {
            // Switch to login mode
            nameField.style.display = 'none';
            loginBtn.style.display = 'block';
            signupBtn.style.display = 'none';
            toggleLink.textContent = 'Need an account? Sign up';
            forgotLink.style.display = 'inline';
        }
    }

    async handleAuth(type) {
        const email = document.getElementById('authEmail').value;
        const password = document.getElementById('authPassword').value;
        const name = document.getElementById('authName').value;

        if (!email || !password || (type === 'signup' && !name)) {
            this.showModalError('Please fill in all required fields');
            return;
        }

        try {
            const endpoint = type === 'login' ? '/auth/login' : '/auth/signup';
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
            
            if (response.ok && data.access_token) {
                this.authToken = data.access_token;
                // Persist token to localStorage for future sessions
                localStorage.setItem('authToken', data.access_token);
                document.getElementById('authModal').style.display = 'none';
                
                // Resume the original purchase flow with stored tier context
                if (this.selectedTier && this.currentQuery) {
                    this.checkWalletAndShowModal('tier');
                } else {
                    console.log('No pending tier purchase context after auth');
                }
            } else {
                throw new Error(data.detail || `${type} failed`);
            }

        } catch (error) {
            console.error(`${type} error:`, error);
            this.showModalError(error.message || `${type} failed. Please try again.`);
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

            // Handle 401 responses - token is invalid/expired
            if (response.status === 401) {
                console.log('Token expired or invalid, clearing auth and showing login...');
                this.authToken = null;
                localStorage.removeItem('authToken');
                this.showAuthModal();
                return;
            }

            if (response.ok) {
                const data = await response.json();
                if (data.balance_cents !== undefined) {
                    this.walletBalance = data.balance_cents / 100; // Convert cents to dollars
                    // Now show wallet modal with real balance
                    await this.showWalletModal(type, itemDetails);
                } else {
                    // Handle error response with success: false
                    throw new Error(data.message || 'Invalid wallet response');
                }
            } else {
                let errorMessage = 'Failed to get wallet balance';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.message || errorData.detail || `HTTP ${response.status}: ${response.statusText}`;
                } catch (jsonError) {
                    errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }

        } catch (error) {
            console.error('Wallet balance error:', error);
            
            // Handle different error types  
            let errorMessage;
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                errorMessage = 'Network connection error. Please check your internet connection.';
            } else if (error.message && error.message.includes('503')) {
                errorMessage = 'Wallet service temporarily unavailable. Please try again in a moment.';
            } else if (error.message && error.message.includes('JSON')) {
                errorMessage = 'Server response error. Please try again.';
            } else {
                errorMessage = error.message || 'Could not load wallet balance. Please try again.';
            }
            
            this.showModalError(errorMessage);
        }
    }

    async showWalletModal(type, itemDetails = null) {
        // Create wallet modal if it doesn't exist
        let walletModal = document.getElementById('walletModal');
        if (!walletModal) {
            walletModal = this.createWalletModal();
            document.body.appendChild(walletModal);
        }

        // Get current tier price dynamically (prices now come from API)
        const price = await this.getTierPrice(this.selectedTier);
        
        document.getElementById('walletBalance').textContent = `$${this.walletBalance.toFixed(2)}`;
        document.getElementById('transactionItemLabel').textContent = `${this.selectedTier.charAt(0).toUpperCase() + this.selectedTier.slice(1)} Research Package Price`;
        document.getElementById('transactionAmount').textContent = `$${price.toFixed(2)}`;
        
        // Update success banner if insufficient funds
        const successBanner = walletModal.querySelector('.wallet-success-banner');
        if (this.walletBalance < price) {
            successBanner.style.background = 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)';
            successBanner.style.color = '#991b1b';
            successBanner.textContent = 'Insufficient funds in your wallet to purchase this content.';
        } else {
            successBanner.style.background = 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)';
            successBanner.style.color = '#065f46';
            successBanner.textContent = 'Ready to purchase! You have sufficient funds in your wallet to purchase this content.';
        }
        
        walletModal.style.display = 'block';
    }

    createWalletModal() {
        const modal = document.createElement('div');
        modal.id = 'walletModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content wallet-modal">
                <span class="close" onclick="this.parentElement.parentElement.style.display='none'">&times;</span>
                
                <div class="wallet-success-banner">
                    Ready to purchase! You have sufficient funds in your wallet to purchase this content.
                </div>
                
                <div class="wallet-content">
                    <div class="wallet-balance-section">
                        <span class="balance-label">Current Balance</span>
                        <div class="balance-amount" id="walletBalance">$0.00</div>
                    </div>
                    
                    <div class="wallet-item-section">
                        <span class="item-label" id="transactionItemLabel">Research Package Price</span>
                        <div class="item-price" id="transactionAmount">$0.00</div>
                    </div>
                </div>
                
                <div class="wallet-actions">
                    <button id="confirmPaymentBtn" class="wallet-btn primary">Purchase Article</button>
                    <button onclick="document.getElementById('walletModal').style.display='none'" class="wallet-btn secondary">Cancel</button>
                </div>
                
                <div class="wallet-footer">
                    Powered by LedeWire
                </div>
            </div>
        `;

        // Add event listener for confirm payment
        modal.querySelector('#confirmPaymentBtn').addEventListener('click', () => this.confirmPayment('tier'));

        return modal;
    }

    async confirmPayment(type, itemDetails = null) {
        const price = await this.getTierPrice(this.selectedTier);

        // Check balance
        if (this.walletBalance < price) {
            this.showModalError('Insufficient wallet balance. Please add funds to your wallet.');
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

            // Handle 401 responses - token is invalid/expired
            if (response.status === 401) {
                console.log('Token expired during purchase, clearing auth and showing login...');
                this.authToken = null;
                localStorage.removeItem('authToken');
                // Fix: close wallet modal before showing auth modal
                const walletModal = document.getElementById('walletModal');
                if (walletModal) walletModal.style.display = 'none';
                // Note: selectedTier and currentQuery are already stored, so auth resume will work correctly
                this.showAuthModal();
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Update wallet balance
                this.walletBalance -= data.wallet_deduction;
                this.addMessage('system', `🎉 Payment processed successfully! $${data.wallet_deduction.toFixed(2)} deducted from wallet.`);
                
                // Display the research package
                this.displayResearchPacketInChat(data.packet);
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
            'rsl': '🔒 RSL Licensed',
            'tollbit': '⚡ Tollbit Access',
            'cloudflare': '☁️ CF Licensed'
        };
        return `<span class="license-badge">${icons[protocol] || '📋 Standard'}</span>`;
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
        // Basic markdown-like formatting with sanitization
        const formatted = text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
        return this.sanitizeHtml(formatted);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the chat app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new ChatResearchApp();
});