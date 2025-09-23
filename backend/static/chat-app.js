class ChatResearchApp {
    constructor() {
        this.currentMode = 'chat'; // 'chat', 'research', or 'report'
        this.apiBase = window.location.origin;
        this.ledewire_token = localStorage.getItem('ledewire_token');
        this.walletBalance = 0; // Initialize to prevent NaN display
        this.conversationHistory = [];
        this.isDarkMode = localStorage.getItem('darkMode') === 'true';
        this.purchasedItems = new Set();
        this.currentQuery = '';
        this.isLoginMode = true;
        this.pendingAction = null;
        this.currentResearchData = null; // Store research data for cross-tab usage
        this.initializeEventListeners();
        this.initializeWalletDisplay();
        this.initializeDarkMode();
        this.updateModeDisplay();
        this.initializeAuth();
        
        // Make app globally accessible for HTML event handlers
        window.researchApp = this;
    }

    initializeEventListeners() {
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        const clearButton = document.getElementById('clearButton');
        const newChatBtn = document.getElementById('newChatBtn');
        const chatModeBtn = document.getElementById('chatModeBtn');
        const researchModeBtn = document.getElementById('researchModeBtn');
        const reportModeBtn = document.getElementById('reportModeBtn');
        const darkModeToggle = document.getElementById('darkModeToggle');
        const authButton = document.getElementById('authButton');
        const authForm = document.getElementById('authForm');
        const authToggleButton = document.getElementById('authToggleButton');

        // Chat functionality
        sendButton.addEventListener('click', () => this.sendMessage());
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Mode switching
        if (chatModeBtn) chatModeBtn.addEventListener('click', () => this.setMode('chat'));
        if (researchModeBtn) researchModeBtn.addEventListener('click', () => this.setMode('research'));
        if (reportModeBtn) reportModeBtn.addEventListener('click', () => this.setMode('report'));
        
        // Clear conversation
        clearButton.addEventListener('click', () => this.clearConversation());
        if (newChatBtn) newChatBtn.addEventListener('click', () => this.clearConversation());

        // Dark mode toggle
        if (darkModeToggle) darkModeToggle.addEventListener('change', () => this.toggleDarkMode());

        // Enable/disable send button
        chatInput.addEventListener('input', (e) => {
            sendButton.disabled = !e.target.value.trim();
            this.updateInputPlaceholder();
            this.updateCharacterCount();
        });

        // Authentication events - single event listener to avoid conflicts
        if (authButton) {
            authButton.removeEventListener('click', this.handleAuthButtonClick); // Remove any existing
            authButton.addEventListener('click', () => this.handleAuthButtonClick());
        }
        // Remove broken form submission - using button handlers instead
        if (authToggleButton) authToggleButton.addEventListener('click', () => this.toggleAuthMode());
    }


    updateCharacterCount() {
        const chatInput = document.getElementById('chatInput');
        const characterCount = document.querySelector('.character-count');
        
        if (!characterCount) return; // Guard for missing element
        
        const count = chatInput.value.length;
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

    setMode(mode) {
        if (this.currentMode === mode) return;
        
        this.currentMode = mode;
        this.updateModeDisplay();
        
        // Add mode change message to chat if there's history
        if (this.conversationHistory.length > 0) {
            const modeMessages = {
                'chat': "💬 Switched to Chat mode - Let's explore your interests through natural conversation.",
                'research': "🔍 Switched to Research mode - I'll find and license authoritative sources with verified information.",
                'report': "📊 Switched to Report Builder - Ready to create comprehensive research packages."
            };
            
            this.addMessage('system', modeMessages[this.currentMode] || modeMessages['chat']);
        }
        
        // Handle Report Builder mode with existing research data
        if (mode === 'report' && this.currentResearchData) {
            // Show tier cards for existing research
            this.displayReportBuilderResults();
        }
    }

    initializeDarkMode() {
        if (this.isDarkMode) {
            document.documentElement.classList.add('dark');
        }
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.checked = this.isDarkMode;
        }
    }

    toggleDarkMode() {
        this.isDarkMode = !this.isDarkMode;
        localStorage.setItem('darkMode', this.isDarkMode.toString());
        
        if (this.isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    }

    updateInputPlaceholder() {
        const chatInput = document.getElementById('chatInput');
        const hasMessages = this.conversationHistory.length > 0;
        
        if (hasMessages) {
            chatInput.placeholder = "Ask me anything...";
        } else {
            chatInput.placeholder = "🔎 Start your search...";
        }
    }

    updateModeDisplay() {
        const chatModeBtn = document.getElementById('chatModeBtn');
        const researchModeBtn = document.getElementById('researchModeBtn');
        const reportModeBtn = document.getElementById('reportModeBtn');
        const modeDescription = document.getElementById('modeDescription');
        
        // Update mode buttons
        if (chatModeBtn && researchModeBtn && reportModeBtn) {
            chatModeBtn.classList.toggle('active', this.currentMode === 'chat');
            researchModeBtn.classList.toggle('active', this.currentMode === 'research');
            reportModeBtn.classList.toggle('active', this.currentMode === 'report');
        }
        
        // Update mode description
        if (modeDescription) {
            const descriptions = {
                'chat': 'Chat Mode - AI Conversations',
                'research': 'Research Mode - Find & License Sources',
                'report': 'Report Builder - Create Research Packages'
            };
            modeDescription.textContent = descriptions[this.currentMode] || descriptions['chat'];
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
        
        // Add specific loading message for Research Mode
        if (this.currentMode === 'research') {
            this.addMessage('system', '🔍 Analyzing your research query and building comprehensive packages... This takes 30-60 seconds as we scan licensed sources, optimize pricing tiers, and prepare your complete research briefing.');
        }

        try {
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add auth token for research mode
            if (this.currentMode === 'research' && this.ledewire_token) {
                headers['Authorization'] = `Bearer ${this.ledewire_token}`;
            }

            const response = await fetch(`${this.apiBase}/api/chat`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    message: message,
                    mode: this.currentMode
                })
            });

            // Handle 401 responses in research mode - token is invalid/expired
            if (response.status === 401 && this.currentMode === 'research') {
                console.log('Token expired during research, clearing auth and showing login...');
                this.hideTypingIndicator(); // Fix: ensure loading state is cleared
                this.ledewire_token = null;
                localStorage.removeItem('ledewire_token');
                this.addMessage('assistant', 'Session expired. Please sign in to continue with research.');
                this.showAuthModal();
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Handle different modes
            if (data.mode === 'research' || data.mode === 'deep_research') {
                if (data.sources && data.sources.length > 0) {
                    // Store research data for cross-tab usage
                    this.currentResearchData = data;
                    this.currentQuery = message;
                    
                    if (this.currentMode === 'research') {
                        // Research mode: Show sources quickly (no tier analysis)
                        await this.displayFastResearchResults(data);
                        this.hideTypingIndicator();
                    } else if (this.currentMode === 'report') {
                        // Report Builder mode: Show tier cards with full analysis
                        await this.displayReportBuilderResults(data);
                        this.hideTypingIndicator();
                    } else {
                        // Fallback to fast research display
                        await this.displayFastResearchResults(data);
                        this.hideTypingIndicator();
                    }
                } else {
                    // No sources found, show response only
                    this.hideTypingIndicator();
                    this.addMessage('assistant', data.response);
                }
            } else {
                // Chat mode - show response immediately
                this.hideTypingIndicator();
                this.addMessage('assistant', data.response);
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
        
        const packageTitle = "Dynamic Research Package";
        const totalSources = packet.total_sources || 0;
        const researchContent = `
            <div class="research-package-chat">
                <div class="package-header">
                    <h3>📋 ${this.escapeHtml(packageTitle)}</h3>
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
        
        // Discovery Mode licensing data
        const isLicensed = !!source.licensing_protocol;
        const protocolBadge = source.protocol_badge || '';
        const publisherName = source.publisher_name || domain;
        const licenseCost = source.license_cost || 0;
        const requiresAttribution = source.requires_attribution || false;
        
        const quote = this.extractCompellingQuote(excerpt);
        
        // Create licensing badge based on Discovery Mode data
        let licensingBadge = '';
        if (isLicensed && protocolBadge) {
            licensingBadge = `<span class="license-badge licensed">${protocolBadge}</span>`;
        } else {
            licensingBadge = '<span class="license-badge unlicensed">📄 Unlicensed</span>';
        }
        
        // Publisher attribution
        const publisherInfo = publisherName !== domain ? 
            `<span class="publisher-name">by ${this.escapeHtml(publisherName)}</span>` : '';
        
        // Create unlock button based on licensing status
        let unlockSection = '';
        if (isLicensed) {
            const totalCost = unlockPrice;
            unlockSection = `
                <div class="source-unlock licensed">
                    <div class="license-details">
                        <span class="unlock-price">$${totalCost.toFixed(2)}</span>
                        ${licenseCost > 0 ? `<span class="license-fee">includes $${licenseCost.toFixed(2)} license</span>` : ''}
                        ${requiresAttribution ? '<span class="attribution-required">⚖️ Attribution required</span>' : ''}
                    </div>
                    <button class="unlock-btn-chat licensed" onclick="window.researchApp.handleSourceUnlockInChat('${this.escapeHtml(sourceId)}', ${totalCost}, '${this.escapeHtml(title)}')">
                        🔓 Unlock & License
                    </button>
                </div>
            `;
        } else {
            unlockSection = `
                <div class="source-unlock unlicensed">
                    <div class="no-license-info">
                        <span class="view-source">View at source</span>
                        <small>No AI-include rights available</small>
                    </div>
                    <a href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="view-btn-chat">
                        🔗 View Original
                    </a>
                </div>
            `;
        }

        return `
            <div class="source-card-chat ${isLicensed ? 'licensed' : 'unlicensed'}" data-source-id="${this.escapeHtml(sourceId)}">
                <div class="source-header">
                    <h5><a href="${this.escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${this.sanitizeHtml(title)}</a></h5>
                    <div class="source-meta">
                        <span class="domain-badge">${this.escapeHtml(domain)}</span>
                        ${publisherInfo}
                        ${licensingBadge}
                    </div>
                </div>
                <div class="source-content">
                    <blockquote>"${this.sanitizeHtml(quote)}"</blockquote>
                    <p>${this.sanitizeHtml(this.createSourceDescription(excerpt, quote))}</p>
                </div>
                ${unlockSection}
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
        // Enhanced authentication check that validates token authenticity
        const isAuthenticated = await this.validateAuthenticationAndBalance();
        if (!isAuthenticated) {
            this.showAuthModal('unlock', { sourceId, price, title });
            return;
        }

        const priceCents = Math.round(price * 100);
        if (this.walletBalance < priceCents) {
            this.addMessage('system', 'Insufficient wallet balance to unlock this source.');
            return;
        }

        // Prevent double-click by disabling button immediately
        const unlockButton = document.querySelector(`[data-source-id="${sourceId}"] .unlock-btn-chat`);
        if (unlockButton) {
            unlockButton.disabled = true;
            unlockButton.textContent = '⏳ Unlocking...';
        }

        this.addMessage('system', `🔓 Unlocking "${title}"...`);
        
        try {
            // Generate idempotency key to prevent double charges
            const idempotencyKey = `unlock_${sourceId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Make real API call to unlock source - only send source_id, server computes pricing
            const response = await fetch(`${this.apiBase}/api/sources/unlock-source`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.ledewire_token}`
                },
                body: JSON.stringify({
                    source_id: sourceId,
                    idempotency_key: idempotencyKey
                })
            });

            if (response.status === 401) {
                // Handle auth failure - clear token and show login
                this.ledewire_token = null;
                localStorage.removeItem('ledewire_token');
                this.updateWalletDisplay();
                this.addMessage('system', 'Session expired. Please log in to continue.');
                // Re-enable button for retry after login
                if (unlockButton) {
                    unlockButton.disabled = false;
                    unlockButton.textContent = '🔓 Unlock & License';
                }
                return;
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.success) {
                // Update wallet balance (keep in cents for consistency)
                this.walletBalance = data.remaining_balance_cents;
                this.updateWalletDisplay();
                
                // Show unlocked content (sanitized by server)
                this.addMessage('system', `✅ Source unlocked! $${data.wallet_deduction.toFixed(2)} deducted from wallet.`);
                
                // Render unlocked content safely (plain text only)
                const safeContent = this.escapeHtml(data.unlocked_content || 'Full article content is now available.');
                this.addMessage('assistant', safeContent);
                
                // Update the source card to show unlocked state
                this.updateSourceCardState(sourceId, true);
            } else {
                this.addMessage('system', `❌ Failed to unlock source: ${data.message}`);
                // Re-enable button on failure
                if (unlockButton) {
                    unlockButton.disabled = false;
                    unlockButton.textContent = '🔓 Unlock & License';
                }
            }
        } catch (error) {
            console.error('Source unlock error:', error);
            this.addMessage('system', '❌ Error unlocking source. Please try again.');
            // Re-enable button on error
            if (unlockButton) {
                unlockButton.disabled = false;
                unlockButton.textContent = '🔓 Unlock & License';
            }
        }
    }

    async initializeWalletDisplay() {
        if (this.ledewire_token) {
            try {
                // Fetch current wallet balance
                const response = await fetch(`${this.apiBase}/api/auth/balance`, {
                    headers: {
                        'Authorization': `Bearer ${this.ledewire_token}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.walletBalance = data.balance_cents;  // Keep in cents for consistency
                    this.updateWalletDisplay();
                } else if (response.status === 401) {
                    // Token expired, clear it and prompt login
                    this.ledewire_token = null;
                    localStorage.removeItem('ledewire_token');
                    this.updateWalletDisplay();
                    console.log('Authentication expired during wallet balance fetch');
                }
            } catch (error) {
                console.error('Error fetching wallet balance:', error);
            }
        }
    }

    updateWalletDisplay() {
        const walletDisplay = document.getElementById('walletDisplay');
        const walletBalance = document.getElementById('walletBalance');
        
        if (this.ledewire_token && this.walletBalance !== undefined) {
            walletDisplay.style.display = 'block';
            walletBalance.textContent = (this.walletBalance / 100).toFixed(2); // Convert cents to dollars for display
        } else {
            walletDisplay.style.display = 'none';
        }
    }

    updateSourceCardState(sourceId, isUnlocked) {
        const sourceCard = document.querySelector(`[data-source-id="${sourceId}"]`);
        if (sourceCard) {
            if (isUnlocked) {
                sourceCard.classList.add('unlocked');
                const unlockBtn = sourceCard.querySelector('.unlock-btn-chat');
                if (unlockBtn) {
                    unlockBtn.textContent = '✅ Unlocked';
                    unlockBtn.disabled = true;
                    unlockBtn.style.background = '#10b981';
                }
            }
        }
    }

    createFigmaSourceCard(source) {
        // Extract and sanitize data to prevent XSS
        const title = this.sanitizeText(source.title || 'Untitled Source');
        const excerpt = this.sanitizeText(source.excerpt || source.snippet || 'No preview available');
        const author = this.sanitizeText(source.publisher_name || source.domain || 'Unknown Publisher');
        const publishDate = new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        const url = source.url || '#';
        
        // Determine license type and styling
        const hasLicense = source.licensing_protocol || source.license_info;
        const licenseType = hasLicense ? 'paid' : 'free';
        const licensePrice = source.license_cost || (hasLicense ? 2.99 : null);
        const licenseProtocol = source.licensing_protocol || (source.license_info?.protocol) || null;
        
        // License badge styling
        const getLicenseColor = (type) => {
            switch (type) {
                case 'free': return 'license-free';
                case 'paid': return 'license-paid';  
                case 'premium': return 'license-premium';
                default: return 'license-free';
            }
        };
        
        // Protocol badge
        const protocolBadge = licenseProtocol ? `<span class="protocol-badge protocol-${licenseProtocol.toLowerCase()}">${licenseProtocol.toUpperCase()}</span>` : '';
        
        // Mock rating for design consistency
        const rating = 4 + Math.random();
        const fullStars = Math.floor(rating);
        const starDisplay = Array.from({length: 5}, (_, i) => 
            `<span class="star ${i < fullStars ? 'star-filled' : 'star-empty'}">★</span>`
        ).join('');

        return `
            <div class="figma-source-card" data-source-id="${source.id || Date.now()}">
                <div class="card-header">
                    <div class="card-main-info">
                        <h3 class="card-title">${title}</h3>
                        <p class="card-meta">${author} • ${publishDate}</p>
                    </div>
                    <div class="card-badges">
                        <span class="source-type-badge">Article</span>
                        <span class="license-badge ${getLicenseColor(licenseType)}">
                            ${licenseType}${licensePrice ? ` $${licensePrice}` : ''}
                        </span>
                        ${protocolBadge}
                    </div>
                </div>
                
                <div class="card-rating">
                    <div class="stars">${starDisplay}</div>
                    <span class="rating-text">(${rating.toFixed(1)}/5)</span>
                </div>
                
                <div class="card-content">
                    <p class="card-summary">${excerpt.substring(0, 150)}${excerpt.length > 150 ? '...' : ''}</p>
                </div>
                
                <div class="card-actions">
                    <button class="btn-secondary view-source-btn" onclick="window.open('${url}', '_blank')">
                        <span class="btn-icon">🔗</span>
                        View Source
                    </button>
                    
                    <div class="action-buttons">
                        ${licenseType === 'free' 
                            ? `<button class="btn-download">
                                 <span class="btn-icon">⬇️</span>
                                 Download
                               </button>` 
                            : `<button class="btn-unlock" data-price="${licensePrice}">
                                 <span class="btn-icon">🔓</span>
                                 Unlock $${licensePrice}
                               </button>`
                        }
                    </div>
                </div>
            </div>
        `;
    }

    addSourceCardListeners(resultsDiv) {
        // Add click handlers for source card interactions
        resultsDiv.addEventListener('click', async (e) => {
            if (e.target.matches('.btn-unlock') || e.target.closest('.btn-unlock')) {
                const btn = e.target.matches('.btn-unlock') ? e.target : e.target.closest('.btn-unlock');
                const price = btn.dataset.price;
                const sourceId = btn.closest('[data-source-id]')?.dataset.sourceId;
                await this.handleSourceUnlock(btn, sourceId, price);
            }
            
            if (e.target.matches('.btn-download') || e.target.closest('.btn-download')) {
                const sourceId = e.target.closest('[data-source-id]')?.dataset.sourceId;
                await this.handleSourceDownload(sourceId);
            }
        });
    }

    async handleSourceUnlock(button, sourceId, price) {
        // Enhanced authentication check that validates token authenticity
        const isAuthenticated = await this.validateAuthenticationAndBalance();
        if (!isAuthenticated) {
            this.showAuthModal('unlock', { sourceId, price, button });
            return;
        }

        const priceCents = Math.round(parseFloat(price) * 100);
        
        // Check sufficient funds
        if (this.walletBalance < priceCents) {
            this.showInsufficientFundsModal(priceCents);
            return;
        }

        button.disabled = true;
        button.textContent = 'Unlocking...';
        
        try {
            // **MOCK SOURCE UNLOCK** - Simulate purchase
            const mockResult = await this.mockPurchaseConfirmation('source', priceCents);
            
            if (mockResult.success) {
                // Mock wallet deduction
                this.walletBalance -= priceCents;
                this.updateAuthDisplay(true);
                
                // Update button state
                button.textContent = '✅ Unlocked';
                button.classList.add('unlocked');
                button.disabled = true;
                
                this.showSuccessToast('Source unlocked successfully!');
            }
        } catch (error) {
            button.disabled = false;
            button.textContent = `Unlock $${price}`;
            this.showErrorToast('Failed to unlock source');
        }
    }

    async handleSourceDownload(sourceId) {
        if (!this.ledewire_token) {
            this.showAuthModal('download', { sourceId });
            return;
        }
        
        this.showSuccessToast('Source downloaded successfully!');
    }

    createResearchPacketsSection(query) {
        const packetsSection = document.createElement('div');
        packetsSection.className = 'research-packets-section';
        
        const packets = [
            {
                id: 'basic',
                name: 'Basic Tier',
                price: 'Free',
                icon: '⭐',
                description: 'Up to 10 licensed premium sources',
                subtitle: 'Free research with quality sources and professional analysis',
                features: [
                    'Up to 10 licensed premium sources',
                    'Professional analysis',
                    'Quality source verification',
                    'Basic summarization'
                ],
                buttonText: 'Get Started',
                highlighted: false,
                ctaClass: 'btn-basic'
            },
            {
                id: 'research',
                name: 'Research Tier',
                price: '$0.99',
                icon: '⚡',
                description: 'Up to 20 licensed sources + expert outline',
                subtitle: 'Craving clarity on this topic? For $0.99, we\'ll ethically license and distill the web\'s most relevant sources into a single, powerful summary.',
                features: [
                    'Up to 20 licensed sources',
                    'Expert research outline',
                    'Advanced summarization',
                    'Source credibility analysis',
                    'Topic deep-dive'
                ],
                buttonText: 'Unlock Research',
                highlighted: true,
                ctaClass: 'btn-research'
            },
            {
                id: 'pro',
                name: 'Pro Tier',
                price: '$1.99',
                icon: '👑',
                description: 'Up to 40 licensed sources + expert outline + strategic insights',
                subtitle: 'Serious about answers? Our Pro tier delivers full-spectrum research — licensed sources, competitive intelligence, and strategic framing.',
                features: [
                    'Up to 40 licensed sources',
                    'Expert research outline',
                    'Strategic insights & framing',
                    'Competitive intelligence',
                    'Executive summary',
                    'Actionable recommendations'
                ],
                buttonText: 'Unlock Pro',
                highlighted: false,
                ctaClass: 'btn-pro'
            }
        ];

        packetsSection.innerHTML = `
            <div class="packets-header">
                <div class="packets-header-content">
                    <h3 class="packets-title">Research Packages</h3>
                    <p class="packets-subtitle">Get comprehensive research bundles with licensed content and expert analysis</p>
                </div>
            </div>
            
            <div class="packets-grid">
                ${packets.map(packet => `
                    <div class="research-packet-card ${packet.highlighted ? 'highlighted' : ''}" data-packet-id="${packet.id}">
                        ${packet.highlighted ? '<div class="popular-badge"><span>Most Popular</span></div>' : ''}
                        
                        <div class="packet-header">
                            <div class="packet-icon ${packet.highlighted ? 'highlighted' : ''}">
                                <span>${packet.icon}</span>
                            </div>
                            
                            <div class="packet-info">
                                <h4 class="packet-name">${packet.name}</h4>
                                <div class="packet-price">${packet.price}</div>
                            </div>
                            
                            <p class="packet-description">${packet.description}</p>
                            <p class="packet-subtitle">${packet.subtitle}</p>
                        </div>
                        
                        <div class="packet-content">
                            <ul class="packet-features">
                                ${packet.features.map(feature => `
                                    <li class="packet-feature">
                                        <span class="feature-check ${packet.highlighted ? 'highlighted' : ''}">✓</span>
                                        <span>${feature}</span>
                                    </li>
                                `).join('')}
                            </ul>
                            
                            <button class="packet-cta ${packet.ctaClass}" data-packet="${packet.id}" data-price="${packet.price}">
                                ${packet.buttonText}
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        return packetsSection;
    }

    addTierCardListeners(resultsDiv) {
        // Add click handlers for tier card purchases
        resultsDiv.addEventListener('click', async (e) => {
            if (e.target.matches('.tier-cta') || e.target.closest('.tier-cta')) {
                const btn = e.target.matches('.tier-cta') ? e.target : e.target.closest('.tier-cta');
                const tierData = JSON.parse(btn.dataset.tierData);
                const price = parseFloat(btn.dataset.price);
                const tierName = btn.dataset.tier;
                
                await this.handleTierPurchase(btn, tierData, price, tierName);
            }
        });
    }

    async createTierCardsSection(query) {
        const tierSection = document.createElement('div');
        tierSection.className = 'tier-cards-section';
        
        // Show loading state while fetching tier analysis
        tierSection.innerHTML = `
            <div class="tier-cards-header">
                <h3>Research Packages</h3>
                <p class="packages-subtitle">Get comprehensive research bundles with licensed content and expert analysis</p>
            </div>
            <div class="tier-cards-loading">
                <div class="loading-spinner"></div>
                <p>Analyzing optimal source selection for each tier...</p>
            </div>
        `;
        
        try {
            // Fetch analysis for all 3 tiers simultaneously
            const [basicResult, researchResult, proResult] = await Promise.all([
                this.analyzeQueryForTier(query, 0.0, 10, 'basic'),
                this.analyzeQueryForTier(query, 0.99, 20, 'research'), 
                this.analyzeQueryForTier(query, 1.99, 40, 'pro')
            ]);
            
            // Replace loading with tier cards
            tierSection.innerHTML = this.createTierCardsDisplay(query, {
                basic: basicResult,
                research: researchResult,
                pro: proResult
            });
            
        } catch (error) {
            console.error('Tier analysis failed:', error);
            tierSection.innerHTML = `
                <div class="research-error">
                    <h3>⚠️ Research Analysis Unavailable</h3>
                    <p>Unable to analyze research packages at this time. Please try again later.</p>
                    <button class="retry-analysis-btn" onclick="this.parentElement.parentElement.remove()">
                        Try Again
                    </button>
                </div>
            `;
        }
        
        return tierSection;
    }

    async analyzeQueryForTier(query, maxBudget, preferredSourceCount, tierType) {
        const response = await fetch('/api/research/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.ledewire_token && { 'Authorization': `Bearer ${this.ledewire_token}` })
            },
            body: JSON.stringify({
                query: query,
                max_budget_dollars: maxBudget,
                preferred_source_count: preferredSourceCount
            })
        });
        
        if (!response.ok) {
            throw new Error(`Tier ${tierType} analysis failed: ${response.status}`);
        }
        
        const analysis = await response.json();
        return { ...analysis, tierType, maxBudget, preferredSourceCount };
    }

    createTierCardsDisplay(query, tierResults) {
        const { basic, research, pro } = tierResults;
        
        return `
            <div class="tier-cards-container">
                <div class="tier-card basic-tier">
                    <div class="tier-icon">⭐</div>
                    <div class="tier-header">
                        <h4>Basic Tier</h4>
                        <div class="tier-price">Free</div>
                    </div>
                    <div class="tier-description">
                        ${basic.source_count} licensed premium sources found
                    </div>
                    <div class="tier-subtitle">
                        Free research with quality sources and professional analysis
                    </div>
                    <ul class="tier-features">
                        <li>✓ ${basic.source_count} licensed premium sources</li>
                        <li>✓ Professional analysis</li>
                        <li>✓ Quality source verification</li>
                        <li>✓ Basic summarization</li>
                    </ul>
                    <button class="tier-cta btn-basic" data-tier-data='${JSON.stringify(basic).replace(/'/g, "&#39;")}' data-price="0.00" data-tier="basic">
                        Get Started
                    </button>
                </div>
                
                <div class="tier-card research-tier highlighted">
                    <div class="popular-badge">Most Popular</div>
                    <div class="tier-icon">⚡</div>
                    <div class="tier-header">
                        <h4>Research Tier</h4>
                        <div class="tier-price">$0.99</div>
                    </div>
                    <div class="tier-description">
                        ${research.source_count} licensed sources + expert outline
                    </div>
                    <div class="tier-subtitle">
                        Craving clarity on this topic? For $0.99, we'll ethically license and distill the web's most relevant sources.
                    </div>
                    <ul class="tier-features">
                        <li>✓ ${research.source_count} licensed sources</li>
                        <li>✓ Expert research outline</li>
                        <li>✓ Advanced summarization</li>
                        <li>✓ Source credibility analysis</li>
                        <li>✓ Topic deep-dive</li>
                    </ul>
                    <button class="tier-cta btn-research primary" data-tier-data='${JSON.stringify(research).replace(/'/g, "&#39;")}' data-price="0.99" data-tier="research">
                        Unlock Research
                    </button>
                </div>
                
                <div class="tier-card pro-tier">
                    <div class="tier-icon">👑</div>
                    <div class="tier-header">
                        <h4>Pro Tier</h4>
                        <div class="tier-price">$1.99</div>
                    </div>
                    <div class="tier-description">
                        ${pro.source_count} licensed sources + expert outline + strategic insights
                    </div>
                    <div class="tier-subtitle">
                        Serious about answers? Our Pro tier delivers full-spectrum research with competitive intelligence.
                    </div>
                    <ul class="tier-features">
                        <li>✓ ${pro.source_count} licensed sources</li>
                        <li>✓ Expert research outline</li>
                        <li>✓ Strategic insights & framing</li>
                        <li>✓ Competitive intelligence</li>
                        <li>✓ Executive summary</li>
                        <li>✓ Actionable recommendations</li>
                    </ul>
                    <button class="tier-cta btn-pro" data-tier-data='${JSON.stringify(pro).replace(/'/g, "&#39;")}' data-price="1.99" data-tier="pro">
                        Unlock Pro
                    </button>
                </div>
            </div>
        `;
    }

    async handleTierPurchase(button, tierData, price, tierName) {
        // Check authentication first (except for free tier)
        if (price > 0 && !this.ledewire_token) {
            this.showAuthModal('tier_purchase', { tierData, button, price, tierName });
            return;
        }

        const priceCents = Math.round(price * 100);
        
        // Check sufficient funds for paid tiers
        if (price > 0 && this.walletBalance < priceCents) {
            this.showInsufficientFundsModal(priceCents);
            return;
        }

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = '⏳ Processing...';
        
        try {
            // Mock purchase confirmation
            const mockResult = await this.mockPurchaseConfirmation(`${tierName}_tier`, priceCents);
            
            if (mockResult.success) {
                // Mock wallet deduction for paid tiers
                if (price > 0) {
                    this.walletBalance -= priceCents;
                    this.updateAuthDisplay(true);
                }
                
                // Update button state
                button.textContent = '✅ Unlocked!';
                button.classList.add('purchased');
                button.disabled = true;
                
                const priceText = price === 0 ? 'free' : `$${price.toFixed(2)}`;
                this.showSuccessToast(`${tierName.charAt(0).toUpperCase() + tierName.slice(1)} tier unlocked${price > 0 ? ` for ${priceText}` : ''}!`);
                
                // Display the tier research package
                this.displayTierResearchPackage(tierData, tierName);
            }
        } catch (error) {
            button.disabled = false;
            button.textContent = originalText;
            this.showErrorToast(`Failed to unlock ${tierName} tier`);
        }
    }

    displayTierResearchPackage(tierData, tierName) {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Create elements safely to prevent XSS
        const packageDiv = document.createElement('div');
        packageDiv.className = 'tier-research-package-display';
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'package-header';
        
        const titleH3 = document.createElement('h3');
        titleH3.textContent = `📋 ${tierName.charAt(0).toUpperCase() + tierName.slice(1)} Research Package: ${tierData.query}`;
        
        const metaPara = document.createElement('p');
        metaPara.className = 'package-meta';
        metaPara.textContent = `${tierData.source_count} Sources • Generated ${new Date().toLocaleString()}`;
        
        headerDiv.appendChild(titleH3);
        headerDiv.appendChild(metaPara);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'package-content';
        
        // Display the research summary
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'research-summary';
        summaryDiv.innerHTML = tierData.research_summary.split('\n').map(line => `<p>${this.sanitizeText(line)}</p>`).join('');
        
        contentDiv.appendChild(summaryDiv);
        
        packageDiv.appendChild(headerDiv);
        packageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(packageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    displayDynamicResearchPackage(analysisData) {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Create elements safely to prevent XSS
        const packageDiv = document.createElement('div');
        packageDiv.className = 'dynamic-research-package-display';
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'package-header';
        
        const titleH3 = document.createElement('h3');
        titleH3.textContent = `📋 Dynamic Research Package: ${analysisData.query}`;
        
        const metaPara = document.createElement('p');
        metaPara.className = 'package-meta';
        metaPara.textContent = `Investment: $${analysisData.total_estimated_cost.toFixed(2)} • ${analysisData.source_count} Sources • Generated ${new Date().toLocaleString()}`;
        
        headerDiv.appendChild(titleH3);
        headerDiv.appendChild(metaPara);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'package-content';
        
        // Display the research summary
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'research-summary';
        summaryDiv.innerHTML = analysisData.research_summary.split('\n').map(line => `<p>${this.sanitizeText(line)}</p>`).join('');
        
        contentDiv.appendChild(summaryDiv);
        
        packageDiv.appendChild(headerDiv);
        packageDiv.appendChild(contentDiv);
        messagesContainer.appendChild(packageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Authentication Methods
    initializeAuth() {
        if (this.ledewire_token) {
            this.updateWalletBalance().catch(() => {
                localStorage.removeItem('ledewire_token');
                this.ledewire_token = null;
                this.updateAuthDisplay(false);
            });
        } else {
            this.updateAuthDisplay(false);
        }
    }

    updateAuthDisplay(isAuthenticated) {
        const walletDisplay = document.getElementById('walletDisplay');
        const authButton = document.getElementById('authButton');
        
        if (isAuthenticated && this.walletBalance !== null) {
            if (walletDisplay) {
                walletDisplay.style.display = 'flex';
                const balanceEl = walletDisplay.querySelector('.wallet-balance');
                if (balanceEl) balanceEl.textContent = `$${(this.walletBalance / 100).toFixed(2)}`;
            }
            if (authButton) {
                authButton.textContent = 'Logout';
                // Don't use onclick to avoid conflicts with addEventListener
                authButton.classList.add('authenticated');
            }
        } else {
            if (walletDisplay) walletDisplay.style.display = 'none';
            if (authButton) {
                authButton.textContent = 'Login';
                authButton.classList.remove('authenticated');
            }
        }
    }

    async updateWalletBalance() {
        if (!this.ledewire_token) return;
        
        try {
            const response = await fetch('/api/auth/balance', {
                headers: { 'Authorization': `Bearer ${this.ledewire_token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.walletBalance = data.balance_cents;
                this.updateAuthDisplay(true);
            } else if (response.status === 401) {
                throw new Error('Token expired');
            }
        } catch (error) {
            console.error('Failed to update wallet balance:', error);
            throw error;
        }
    }

    /**
     * Enhanced authentication check that validates token authenticity
     * Returns true if properly authenticated, false if should show auth modal
     */
    async validateAuthenticationAndBalance() {
        // First check if token exists
        if (!this.ledewire_token) {
            return false;
        }

        try {
            // Validate token by checking wallet balance API
            const response = await fetch(`${this.apiBase}/api/auth/balance`, {
                headers: { 'Authorization': `Bearer ${this.ledewire_token}` }
            });
            
            if (response.ok) {
                // Token is valid, update balance (keep in cents for consistency)
                const data = await response.json();
                this.walletBalance = data.balance_cents; // Keep in cents like rest of codebase
                this.updateWalletDisplay();
                return true;
            } else if (response.status === 401) {
                // Token is expired/invalid, clear it
                console.log('Token expired/invalid, clearing authentication');
                localStorage.removeItem('ledewire_token');
                this.ledewire_token = null;
                this.walletBalance = 0;
                this.updateAuthDisplay(false); // Update both wallet and auth UI states
                return false;
            } else {
                // Other API error, assume authentication issue for safety
                console.warn('Wallet balance API error:', response.status);
                return false;
            }
        } catch (error) {
            // Network error or other issue, assume authentication needed for safety
            console.error('Error validating authentication:', error);
            return false;
        }
    }

    handleAuthButtonClick() {
        // Check button state to determine action
        const authButton = document.getElementById('authButton');
        if (authButton && authButton.classList.contains('authenticated')) {
            this.logout();
        } else {
            this.showAuthModal();
        }
    }


    closeAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) modal.style.display = 'none';
        this.pendingAction = null;
    }

    // Removed broken toggleAuthMode - using working version below

    // Removed broken handleAuthSubmit - using working handleAuth below

    // Removed broken loginUser/signupUser - using working handleAuth below

    logout() {
        localStorage.removeItem('ledewire_token');
        this.ledewire_token = null;
        this.walletBalance = 0;
        this.purchasedItems.clear();
        this.updateAuthDisplay(false);
        this.showSuccessToast('Logged out successfully');
    }

    showAuthMessage(message, type = 'error') {
        const messageEl = document.getElementById('authMessage');
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.className = `auth-message ${type}`;
        }
    }

    clearAuthMessage() {
        const messageEl = document.getElementById('authMessage');
        if (messageEl) {
            messageEl.className = 'auth-message';
            messageEl.textContent = '';
        }
    }

    // Purchase Flow Methods
    generateIdempotencyKey() {
        return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    }

    async handleTierPurchase(button, tierId, price) {
        this.currentQuery = this.getLastQuery();
        
        // Check authentication first
        if (!this.ledewire_token) {
            this.showAuthModal('tier_purchase', { tierId, price, button });
            return;
        }

        button.dataset.originalText = button.textContent;

        // For basic tier (free), skip payment processing
        if (tierId === 'basic' || price === 'Free') {
            await this.processFreeTier(button, tierId);
            return;
        }

        // Convert price to cents
        const priceCents = Math.round(parseFloat(price.replace('$', '')) * 100);
        
        // Check sufficient funds
        if (this.walletBalance < priceCents) {
            this.showInsufficientFundsModal(priceCents);
            return;
        }

        // Process purchase
        await this.processPurchase(button, tierId, priceCents);
    }

    async processFreeTier(button, tierId) {
        button.disabled = true;
        button.textContent = 'Processing...';
        
        try {
            const response = await fetch('/api/purchase/tier', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.ledewire_token}`
                },
                body: JSON.stringify({
                    tier: tierId,
                    query: this.currentQuery,
                    idempotency_key: this.generateIdempotencyKey()
                })
            });
            
            if (response.ok) {
                const result = await response.json();
                this.handlePurchaseSuccess(button, tierId, result);
            } else {
                this.handlePurchaseError(button, await response.json());
            }
        } catch (error) {
            this.handleNetworkError(button, error);
        }
    }

    async processPurchase(button, tierId, priceCents) {
        button.disabled = true;
        button.textContent = 'Processing...';
        
        try {
            // **MOCK PURCHASE MODE** - No real charges
            const mockResult = await this.mockPurchaseConfirmation(tierId, priceCents);
            
            if (mockResult.success) {
                // Mock wallet deduction
                this.walletBalance -= priceCents;
                this.updateAuthDisplay(true);
                
                // Generate research packet
                const response = await fetch('/api/purchase/tier', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.ledewire_token}`
                    },
                    body: JSON.stringify({
                        tier: tierId,
                        query: this.currentQuery,
                        idempotency_key: this.generateIdempotencyKey(),
                        mock_purchase: true
                    })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    this.handlePurchaseSuccess(button, tierId, result);
                } else {
                    this.handlePurchaseError(button, await response.json());
                }
            }
        } catch (error) {
            this.handleNetworkError(button, error);
        }
    }

    async mockPurchaseConfirmation(tierId, priceCents) {
        console.log(`🧪 MOCK PURCHASE: ${tierId} for $${(priceCents/100).toFixed(2)}`);
        
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return {
            success: true,
            transaction_id: `mock_txn_${Date.now()}`,
            content_id: `${tierId}_${this.currentQuery.substring(0, 20)}`
        };
    }

    handlePurchaseSuccess(button, tierId, result) {
        button.textContent = '✅ Purchased';
        button.classList.add('purchased');
        this.purchasedItems.add(tierId);
        
        if (result.packet) {
            this.displayResearchPacket(result.packet);
        }
        
        this.showSuccessToast(`${tierId.charAt(0).toUpperCase() + tierId.slice(1)} tier purchased!`);
    }

    handlePurchaseError(button, error) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Purchase';
        this.showErrorToast(`Purchase failed: ${error.detail || 'Unknown error'}`);
    }

    handleNetworkError(button, error) {
        button.disabled = false;
        button.textContent = button.dataset.originalText || 'Try Again';
        this.showErrorToast('Network error. Please try again.');
    }

    showInsufficientFundsModal(priceCents) {
        const needed = (priceCents / 100).toFixed(2);
        const current = (this.walletBalance / 100).toFixed(2);
        this.showErrorToast(`Insufficient funds. Need $${needed}, have $${current}. Please add funds to your wallet.`);
    }

    async executePendingAction() {
        if (!this.pendingAction) return;
        
        const { action, data } = this.pendingAction;
        this.pendingAction = null;
        
        if (action === 'purchase' && data) {
            await this.handleTierPurchase(data.button, data.tierId, data.price);
        } else if (action === 'unlock' && data) {
            await this.handleSourceUnlock(data.button, data.sourceId, data.price);
        } else if (action === 'download' && data) {
            await this.handleSourceDownload(data.sourceId);
        }
    }

    getLastQuery() {
        if (this.conversationHistory.length > 0) {
            return this.conversationHistory[this.conversationHistory.length - 1].user || 'general research';
        }
        return 'general research';
    }

    displayResearchPacket(packet) {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Create elements safely to prevent XSS
        const packetDiv = document.createElement('div');
        packetDiv.className = 'research-packet-display';
        
        const headerDiv = document.createElement('div');
        headerDiv.className = 'packet-header';
        
        const titleH3 = document.createElement('h3');
        titleH3.textContent = `📋 Dynamic Research Report`;
        
        const metaPara = document.createElement('p');
        metaPara.className = 'packet-meta';
        metaPara.textContent = `Generated ${new Date().toLocaleString()}`;
        
        headerDiv.appendChild(titleH3);
        headerDiv.appendChild(metaPara);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'packet-content';
        
        // Safely add content - check if it's HTML or text
        const content = packet.content || packet.packet_html || '<p>Research packet generated successfully!</p>';
        if (content.includes('<') && content.includes('>')) {
            // HTML content - should be sanitized on backend
            contentDiv.innerHTML = content;
        } else {
            // Plain text
            contentDiv.textContent = content;
        }
        
        packetDiv.appendChild(headerDiv);
        packetDiv.appendChild(contentDiv);
        messagesContainer.appendChild(packetDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Toast Notifications
    showSuccessToast(message) { this.showToast(message, 'success'); }
    showErrorToast(message) { this.showToast(message, 'error'); }
    showInfoToast(message) { this.showToast(message, 'info'); }

    // Security: Text sanitization to prevent XSS
    sanitizeText(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Security: Create DOM elements safely without innerHTML
    createSecureElement(tag, className, textContent) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = this.sanitizeText(message); // Sanitize message
        
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 100);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => container.removeChild(toast), 300);
        }, 5000);
    }

    async displayResearchResults(data) {
        if (!data.sources || data.sources.length === 0) return;

        // Build all results off-DOM first, including tier analysis
        
        // 1. Build research results section
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'research-results figma-design';
        
        // Research Header (matching Figma design)
        const researchHeader = document.createElement('div');
        researchHeader.className = 'research-header';
        researchHeader.innerHTML = `
            <div class="research-header-content">
                <div class="header-info">
                    <h2 class="header-title">LedeWire Research Assistant</h2>
                    <p class="header-subtitle">Ethically Licensed Content</p>
                </div>
                <div class="ai-badge">
                    <span class="sparkles-icon">✨</span>
                    <span>AI-Powered</span>
                </div>
            </div>
        `;
        
        // Results area with count and filters
        const resultsArea = document.createElement('div');
        resultsArea.className = 'results-area';
        
        const resultsMeta = document.createElement('div');
        resultsMeta.className = 'results-meta';
        resultsMeta.innerHTML = `
            <div class="results-count">
                <span>${data.sources.length} results for your research</span>
            </div>
        `;
        
        // Professional source cards grid (matching Figma SourceCard design)
        const sourceGrid = document.createElement('div');
        sourceGrid.className = 'source-cards-grid';
        sourceGrid.innerHTML = data.sources.map(source => this.createFigmaSourceCard(source)).join('');
        
        resultsArea.appendChild(resultsMeta);
        resultsArea.appendChild(sourceGrid);
        
        resultsDiv.appendChild(researchHeader);
        resultsDiv.appendChild(resultsArea);
        
        // 2. Build Tier Cards section using dynamic pricing - this takes 30+ seconds
        const tierCardsSection = await this.createTierCardsSection(data.refined_query || 'your research');
        resultsDiv.appendChild(tierCardsSection);

        // 3. Only NOW display everything at once: outline + sources + tier cards
        
        // Add the AI response with the research outline
        this.addMessage('assistant', data.response);
        
        // Add the complete research results
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.appendChild(resultsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add event listeners for source cards and tier cards
        this.addSourceCardListeners(resultsDiv);
        this.addTierCardListeners(resultsDiv);
    }

    async displayFastResearchResults(data) {
        // Fast Research mode: Show outline + sources only (no tier analysis)
        if (!data.sources || data.sources.length === 0) return;

        // 1. Build research results section (without tier cards)
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'research-results figma-design';
        
        // Research Header
        const researchHeader = document.createElement('div');
        researchHeader.className = 'research-header';
        researchHeader.innerHTML = `
            <div class="research-header-content">
                <div class="header-info">
                    <h2 class="header-title">Research Sources Found</h2>
                    <p class="header-subtitle">Licensed content available • Switch to Report Builder to create packages</p>
                </div>
                <div class="ai-badge">
                    <span class="sparkles-icon">✨</span>
                    <span>AI-Powered</span>
                </div>
            </div>
        `;
        
        // Results area with source cards
        const resultsArea = document.createElement('div');
        resultsArea.className = 'results-area';
        
        const resultsMeta = document.createElement('div');
        resultsMeta.className = 'results-meta';
        resultsMeta.innerHTML = `
            <div class="results-count">
                <span>${data.sources.length} sources found for your research</span>
            </div>
        `;
        
        // Source cards grid
        const sourceGrid = document.createElement('div');
        sourceGrid.className = 'source-cards-grid';
        sourceGrid.innerHTML = data.sources.map(source => this.createFigmaSourceCard(source)).join('');
        
        resultsArea.appendChild(resultsMeta);
        resultsArea.appendChild(sourceGrid);
        resultsDiv.appendChild(researchHeader);
        resultsDiv.appendChild(resultsArea);
        
        // Display outline + sources immediately
        this.addMessage('assistant', data.response);
        
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.appendChild(resultsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add event listeners for source cards
        this.addSourceCardListeners(resultsDiv);
    }

    async displayReportBuilderResults(data) {
        // Report Builder mode: Show tier cards for research packages
        if (!this.currentResearchData && !data) {
            this.addMessage('system', '📊 No research data available. Please run a research query first in Research mode.');
            return;
        }
        
        const researchData = data || this.currentResearchData;
        
        // Show loading message for tier analysis
        this.addMessage('system', '📊 Building research packages... Analyzing sources and creating pricing tiers (30-60 seconds).');
        
        // Build tier cards section
        const tierCardsDiv = document.createElement('div');
        tierCardsDiv.className = 'report-builder-section';
        
        const builderHeader = document.createElement('div');
        builderHeader.className = 'builder-header';
        builderHeader.innerHTML = `
            <div class="builder-header-content">
                <h2 class="header-title">Research Package Builder</h2>
                <p class="header-subtitle">Create comprehensive research reports with licensed sources</p>
            </div>
        `;
        
        tierCardsDiv.appendChild(builderHeader);
        
        // Create tier cards with full analysis
        const tierCardsSection = await this.createTierCardsSection(researchData.refined_query || this.currentQuery);
        tierCardsDiv.appendChild(tierCardsSection);
        
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.appendChild(tierCardsDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Add event listeners for tier cards
        this.addTierCardListeners(tierCardsDiv);
    }

    async getTierPrice(tierName) {
        // Helper method to get tier price from API
        try {
            const response = await fetch(`${this.apiBase}/api/tiers`, {
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
        if (!this.ledewire_token) {
            // No authentication - show LedeWire auth modal
            this.showAuthModal();
        } else {
            // Already authenticated - get wallet balance and show payment modal
            this.checkWalletAndShowModal('tier');
        }
    }

    showAuthModal(action = null, data = null) {
        // Store pending action for resume after authentication
        this.pendingAction = action ? { action, data } : null;
        
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
            const endpoint = type === 'login' ? '/api/auth/login' : '/api/auth/signup';
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
                this.ledewire_token = data.access_token;
                // Persist token to localStorage for future sessions
                localStorage.setItem('ledewire_token', data.access_token);
                document.getElementById('authModal').style.display = 'none';
                
                // Resume pending actions if any
                if (this.pendingAction) {
                    const { action, data } = this.pendingAction;
                    if (action === 'tier_purchase' && data) {
                        // Handle both old and new tier purchase formats
                        if (data.tierId) {
                            // New format: convert tierId to expected parameters
                            await this.handleTierPurchase(data.button, data.tierId, data.price);
                        } else if (data.tierData) {
                            // Legacy format: use original parameters
                            await this.handleTierPurchase(data.button, data.tierData, data.price, data.tierName);
                        }
                    } else if (action === 'unlock' && data) {
                        await this.handleSourceUnlock(data.button, data.sourceId, data.price);
                    } else if (action === 'download' && data) {
                        await this.handleSourceDownload(data.sourceId);
                    }
                    this.pendingAction = null;
                } else if (this.selectedTier && this.currentQuery) {
                    this.checkWalletAndShowModal('tier');
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
            const response = await fetch(`${this.apiBase}/api/auth/balance`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.ledewire_token}`,
                    'Content-Type': 'application/json'
                }
            });

            // Handle 401 responses - token is invalid/expired
            if (response.status === 401) {
                console.log('Token expired or invalid, clearing auth and showing login...');
                this.ledewire_token = null;
                localStorage.removeItem('ledewire_token');
                this.showAuthModal();
                return;
            }

            if (response.ok) {
                const data = await response.json();
                if (data.balance_cents !== undefined) {
                    this.walletBalance = data.balance_cents; // Keep in cents for consistency
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
        
        document.getElementById('walletBalance').textContent = `$${(this.walletBalance / 100).toFixed(2)}`;
        document.getElementById('transactionItemLabel').textContent = `${this.selectedTier.charAt(0).toUpperCase() + this.selectedTier.slice(1)} Research Package Price`;
        document.getElementById('transactionAmount').textContent = `$${price.toFixed(2)}`;
        
        // Update success banner if insufficient funds
        const successBanner = walletModal.querySelector('.wallet-success-banner');
        const priceCents = Math.round(price * 100);
        if (this.walletBalance < priceCents) {
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

        // Check balance (convert price to cents for comparison)
        const priceCents = Math.round(price * 100);
        if (this.walletBalance < priceCents) {
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
            const response = await fetch(`${this.apiBase}/api/purchase`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.ledewire_token}`
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
                this.ledewire_token = null;
                localStorage.removeItem('ledewire_token');
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
                // Update wallet balance (server returns deduction in dollars, convert to cents for storage)
                this.walletBalance -= Math.round(data.wallet_deduction * 100);
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
                const response = await fetch(`${this.apiBase}/api/chat/clear`, {
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
        if (!this.ledewire_token) {
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
    window.researchApp = new ChatResearchApp();
});