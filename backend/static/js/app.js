/**
 * Main Application Controller
 * Clean, focused orchestration layer replacing the 2,670-line monolith
 */
import { APIService } from './services/api.js';
import { AuthService } from './services/auth.js';
import { AppState } from './state/app-state.js';
import { UIManager } from './components/ui-manager.js';
import { debounce } from './utils/helpers.js';

// SourceCard will be loaded globally - access it dynamically when needed

export class ChatResearchApp {
    constructor() {
        console.log("✅ ChatResearchApp constructor running");
        // Initialize services and state (dependency injection)
        this.authService = new AuthService();
        this.apiService = new APIService(this.authService);
        this.appState = new AppState();
        this.uiManager = new UIManager(this.appState);
        
        // Initialize the application
        this.initializeApp();
        
        // Make app globally accessible for HTML event handlers (namespaced for safety)
        if (!window.LedeWire) window.LedeWire = {};
        window.LedeWire.researchApp = this;
        
        // Legacy global for backward compatibility (TODO: remove in production)
        if (!window.researchApp) {
            window.researchApp = this;
        }
    }

    async initializeApp() {
        try {
            this.initializeEventListeners();
            this.uiManager.updateModeDisplay();
            // Safe wallet display update - only if user is authenticated
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }
            
            // Update wallet balance if authenticated
            if (this.authService.isAuthenticated()) {
                await this.authService.updateWalletBalance();
                // Safe wallet display update - only if user is authenticated
                if (this.authService.isAuthenticated()) {
                    this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
                }
            }
        } catch (error) {
            console.error('Error initializing app:', error);
            this.addMessage('system', 'Application initialization failed. Please refresh the page.');
        }
    }

    initializeEventListeners() {
        console.log("🔧 initializeEventListeners() starting");
        // Get DOM elements
        const chatInput = document.getElementById('newChatInput');
        const sendButton = document.getElementById('newSendButton');
        
        // Debug DOM elements
        console.log("chatInput:", chatInput);
        console.log("sendButton:", sendButton);
        const clearButton = document.getElementById('clearButton');
        const newChatBtn = document.getElementById('newChatBtn');
        const chatModeBtn = document.getElementById('chatModeBtn');
        const researchModeBtn = document.getElementById('researchModeBtn');
        const reportModeBtn = document.getElementById('reportModeBtn');
        const darkModeToggle = document.getElementById('darkModeToggle');
        const loginButton = document.getElementById('loginButton');
        const authToggleButton = document.getElementById('authToggleButton');

        // Chat functionality
        if (sendButton) {
            sendButton.addEventListener('click', () => {
                this.sendMessage();
            });
        }
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            
            chatInput.addEventListener('input', debounce((e) => {
                if (sendButton) sendButton.disabled = !e.target.value.trim();
                this.uiManager.updateCharacterCount();
                this.uiManager.autoResizeTextarea(e.target);
            }, 100));
        }

        // Mode switching
        if (chatModeBtn) chatModeBtn.addEventListener('click', () => this.setMode('chat'));
        if (researchModeBtn) researchModeBtn.addEventListener('click', () => this.setMode('research'));
        if (reportModeBtn) reportModeBtn.addEventListener('click', () => this.setMode('report'));

        // Clear conversation
        if (clearButton) clearButton.addEventListener('click', () => this.clearConversation());
        if (newChatBtn) newChatBtn.addEventListener('click', () => this.clearConversation());

        // Dark mode toggle
        if (darkModeToggle) {
            darkModeToggle.checked = this.appState.isDarkModeEnabled();
            darkModeToggle.addEventListener('change', () => this.toggleDarkMode());
        }

        // Authentication
        if (loginButton) loginButton.addEventListener('click', () => this.handleAuthButtonClick());
        if (authToggleButton) authToggleButton.addEventListener('click', () => this.toggleAuthMode());
        
        // Check if user is already authenticated on page load
        if (this.authService.isAuthenticated()) {
            this.updateAuthButton();
            this.authService.updateWalletBalance().then(() => {
                this.updateAuthButton(); // Update again with fresh balance
            });
        }
    }

    async sendMessage() {
        const chatInput = document.getElementById('newChatInput');
        const message = chatInput?.value?.trim();
        console.log("📝 Message to send:", message);
        
        if (!message) return;
        

        try {
            // Clear input and show user message
            chatInput.value = '';
            this.uiManager.updateCharacterCount();
            
            const userMessage = this.addMessage('user', message);
            this.appState.setCurrentQuery(message);
            
            // Show typing indicator
            this.uiManager.showTypingIndicator();
            
            // Send to backend with conversation context for research mode
            const conversationContext = this.appState.getMode() === 'research' ? 
                this.appState.getConversationHistory() : null;
            const response = await this.apiService.sendMessage(message, this.appState.getMode(), conversationContext);
            
            // 1. PIPELINE TRACE: Log raw response
            console.log('🔍 PIPELINE TRACE: Search response handler called');
            console.log('📦 PIPELINE TRACE: Raw response received:', response);
            
            // Hide typing indicator
            this.uiManager.hideTypingIndicator();
            
            // Display response
            if (response.content) {
                this.addMessage('assistant', response.content, response.metadata);
            }
            
            // Handle research data with progressive loading
            if (response.research_data) {
                // 2. PIPELINE TRACE: Log research data
                console.log('📋 PIPELINE TRACE: Research data found:', response.research_data);
                console.log('📊 PIPELINE TRACE: Sources array:', response.research_data?.sources);
                console.log('📏 PIPELINE TRACE: Sources length:', response.research_data?.sources?.length);
                
                this.appState.setCurrentResearchData(response.research_data);
                
                // 3. PIPELINE TRACE: Before calling _displaySourceCards
                console.log('🎯 PIPELINE TRACE: About to call _displaySourceCards()');
                console.log('🎯 PIPELINE TRACE: Sources parameter:', response.research_data.sources);
                
                // Display immediate source cards
                this._displaySourceCards(response.research_data.sources);
                
                // If enrichment is needed, let the progressive system handle updates
                // Note: Backend handles progressive enrichment via cache polling automatically
                if (response.research_data.enrichment_needed) {
                    console.log('🔄 Progressive enrichment in progress...'); 
                    // Polling is handled by backend progressive system, no client polling needed
                }
            }
            
        } catch (error) {
            console.error('❌ ERROR IN SEND MESSAGE FLOW:', error);
            console.error('❌ ERROR STACK:', error.stack);
            this.uiManager.hideTypingIndicator();
            this.addMessage('system', `Sorry, I encountered an error: ${error.message}. Please try again.`);
        }
    }

    setMode(mode) {
        const modeChanged = this.appState.setMode(mode);
        if (!modeChanged) return;

        this.uiManager.updateModeDisplay();
        
        // Handle mode-specific UI changes
        if (mode === 'report' && this.appState.getCurrentResearchData()) {
            this.displayReportBuilderResults();
        } else {
            // Restore chat messages for non-report modes
            this._restoreChatMessages();
            
            // Add mode change message if there's history
            if (this.appState.getConversationHistory().length > 0) {
                const modeMessages = {
                    'chat': "💬 Switched to Chat mode - Let's explore your interests through natural conversation.",
                    'research': "🔍 Switched to Research mode - I'll find and license authoritative sources."
                };
                if (modeMessages[mode]) {
                    this.addMessage('system', modeMessages[mode]);
                }
            }
        }
    }

    addMessage(sender, content, metadata = null) {
        // Handle live DOM nodes: store serializable content in state, pass live DOM to UI
        let stateContent = content;
        let uiContent = content;
        
        if (content instanceof HTMLElement) {
            // Store serializable version in state for conversation history
            stateContent = content.outerHTML;
            // Pass live DOM node to UI to preserve event listeners
            uiContent = content;
        }
        
        const message = this.appState.addMessage(sender, stateContent, metadata);
        
        // Create UI message with live DOM content if applicable
        const uiMessage = {
            ...message,
            content: uiContent
        };
        
        this.uiManager.addMessageToChat(uiMessage);
        
        // Hide welcome screen after first message is sent
        this.hideWelcomeScreen();
        
        return message;
    }
    
    hideWelcomeScreen() {
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen && welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
            console.log('Welcome screen hidden after first message');
        }
    }

    async clearConversation() {
        if (!confirm('Clear the entire conversation? This cannot be undone.')) {
            return;
        }

        try {
            await this.apiService.clearConversation();
            this.appState.clearConversation();
            this.uiManager.clearConversationDisplay();
            this.updateSourceSelectionUI();
            this.updateReportBuilderDisplay();
        } catch (error) {
            console.error('Error clearing conversation:', error);
            this.addMessage('system', 'Failed to clear conversation. Please refresh the page to start fresh.');
        }
    }

    toggleDarkMode() {
        const isDark = this.appState.toggleDarkMode();
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.checked = isDark;
        }
    }

    // Authentication methods
    async handleAuthButtonClick() {
        this.showAuthModal();
    }

    showAuthModal() {
        // Remove any existing modal
        const existingModal = document.getElementById('authModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const isLogin = this.appState.isInLoginMode();
        const modalHTML = `
            <div id="authModal" class="modal-overlay">
                <div class="modal-content auth-modal">
                    <div class="auth-modal-header">
                        <img src="/static/ledewire-logo.png" alt="LedeWire" class="auth-modal-logo">
                        <h2 id="authTitle">${isLogin ? 'Welcome back!' : 'Create Account'}</h2>
                        <p>${isLogin ? 'Sign in to access your wallet' : 'Join LedeWire to access premium features'}</p>
                        <button class="modal-close" onclick="document.getElementById('authModal').remove()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; color: #999; cursor: pointer;">×</button>
                    </div>
                    <div class="auth-modal-content">
                        <form class="auth-form" id="authForm">
                            <div class="auth-form-group">
                                <label for="authEmail">Email *</label>
                                <input type="email" id="authEmail" placeholder="" required>
                            </div>
                            <div class="auth-form-group">
                                <label for="authPassword">Password *</label>
                                <input type="password" id="authPassword" placeholder="" required>
                            </div>
                            <button type="submit" class="auth-btn" id="authSubmitBtn">
                                ${isLogin ? 'Log In' : 'Sign Up'}
                            </button>
                        </form>
                        <div class="auth-links">
                            ${isLogin ? '<a href="#" class="auth-link" id="forgotPasswordLink">Forgot Password?</a>' : ''}
                            <a href="#" class="auth-link" id="authToggleButton">
                                ${isLogin ? 'Need an account? Sign up' : 'Have an account? Log in'}
                            </a>
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

        // Add event listeners
        const authForm = document.getElementById('authForm');
        const authToggleButton = document.getElementById('authToggleButton');

        if (authForm) {
            authForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const type = this.appState.isInLoginMode() ? 'login' : 'signup';
                await this.handleAuth(type);
            });
        }

        if (authToggleButton) {
            authToggleButton.addEventListener('click', (e) => {
                e.preventDefault();
                this.toggleAuthMode();
                this.showAuthModal(); // Refresh modal with new mode
            });
        }

        // Add forgot password link handler
        const forgotPasswordLink = document.getElementById('forgotPasswordLink');
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                // TODO: Implement forgot password functionality
                this.addMessage('system', 'Forgot password functionality coming soon. Please contact support for assistance.');
            });
        }

        // Close modal when clicking outside
        const modalOverlay = document.getElementById('authModal');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    modalOverlay.remove();
                }
            });
        }
    }

    async handleAuth(type) {
        const emailInput = document.getElementById('authEmail');
        const passwordInput = document.getElementById('authPassword');
        
        const email = emailInput?.value?.trim();
        const password = passwordInput?.value?.trim();
        
        if (!email || !password) {
            this.addMessage('system', 'Please enter both email and password.');
            return;
        }

        // Disable submit button during processing
        const submitBtn = document.getElementById('authSubmitBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';
        }

        try {
            let result;
            if (type === 'login') {
                result = await this.authService.login(email, password);
            } else {
                result = await this.authService.signup(email, password);
            }
            
            // Safe wallet display update - only if user is authenticated
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }
            this.addMessage('system', `Welcome! Successfully ${type === 'login' ? 'logged in' : 'signed up'}.`);
            
            // Close the auth modal
            const authModal = document.getElementById('authModal');
            if (authModal) {
                authModal.remove();
            }
            
            // Update button text to show logged in state
            this.updateAuthButton();
            
            // Execute any pending action
            if (this.appState.getPendingAction()) {
                await this.executePendingAction();
            }
            
        } catch (error) {
            console.error(`${type} error:`, error);
            this.addMessage('system', `${type === 'login' ? 'Login' : 'Signup'} failed: ${error.message}`);
            
            // Re-enable submit button on error
            const submitBtn = document.getElementById('authSubmitBtn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = type === 'login' ? 'Login' : 'Sign Up';
            }
        }
    }

    updateAuthButton() {
        const loginButton = document.getElementById('loginButton');
        const profileDropdown = document.getElementById('profileDropdown');
        
        if (this.authService.isAuthenticated()) {
            // Hide login button, show profile dropdown
            if (loginButton) loginButton.style.display = 'none';
            if (profileDropdown) {
                profileDropdown.style.display = 'block';
                
                // Update profile display
                const initials = document.getElementById('userInitials');
                const balance = document.getElementById('userBalance');
                
                console.log('Updating profile UI:', {
                    userInfo: this.authService.getUserInfo(),
                    initials: this.authService.getUserInitials(),
                    balance: this.authService.getWalletBalance()
                });
                
                if (initials) {
                    const userInitials = this.authService.getUserInitials();
                    initials.textContent = userInitials;
                    console.log('Set initials to:', userInitials);
                }
                if (balance && this.authService.isAuthenticated()) {
                    const walletBalance = this.authService.getWalletBalance();
                    const safeBalance = Number(walletBalance) || 0;
                    balance.textContent = `$${safeBalance.toFixed(2)}`;
                    console.log('Set balance to:', safeBalance);
                } else if (balance) {
                    // Hide balance for unauthenticated users
                    balance.textContent = '$0.00';
                }
                
                // Add dropdown functionality
                this.setupProfileDropdown();
            }
        } else {
            // Show login button, hide profile dropdown
            if (loginButton) loginButton.style.display = 'block';
            if (profileDropdown) profileDropdown.style.display = 'none';
        }
    }

    setupProfileDropdown() {
        const profileButton = document.getElementById('profileButton');
        const dropdownMenu = document.getElementById('dropdownMenu');
        const logoutItem = document.getElementById('logoutItem');
        
        console.log('Setting up profile dropdown:', { profileButton, dropdownMenu, logoutItem });
        
        if (profileButton && dropdownMenu) {
            // Remove any existing listeners to avoid duplicates
            const newProfileButton = profileButton.cloneNode(true);
            profileButton.parentNode.replaceChild(newProfileButton, profileButton);
            
            // Toggle dropdown on profile button click
            newProfileButton.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Profile button clicked, toggling dropdown');
                dropdownMenu.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!newProfileButton.contains(e.target)) {
                    dropdownMenu.classList.remove('show');
                }
            });
        }
        
        if (logoutItem) {
            logoutItem.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Logout clicked');
                this.handleLogout();
            });
        }
    }

    handleLogout() {
        this.authService.logout();
        this.updateAuthButton();
        this.addMessage('system', 'You have been logged out successfully.');
        
        // Hide wallet display
        const walletDisplay = document.getElementById('walletDisplay');
        if (walletDisplay) {
            walletDisplay.style.display = 'none';
        }
    }

    toggleAuthMode() {
        this.appState.setLoginMode(!this.appState.isInLoginMode());
        this.updateAuthModeDisplay();
    }

    updateAuthModeDisplay() {
        const loginButton = document.getElementById('loginButton');
        const authToggleButton = document.getElementById('authToggleButton');
        const authTitle = document.getElementById('authTitle');
        
        if (this.appState.isInLoginMode()) {
            if (loginButton) loginButton.textContent = 'Login';
            if (authToggleButton) authToggleButton.textContent = 'Need an account? Sign up';
            if (authTitle) authTitle.textContent = 'Login to LedeWire';
        } else {
            if (loginButton) loginButton.textContent = 'Sign Up';
            if (authToggleButton) authToggleButton.textContent = 'Have an account? Login';
            if (authTitle) authTitle.textContent = 'Create LedeWire Account';
        }
    }

    async executePendingAction() {
        const action = this.appState.getPendingAction();
        if (!action) return;
        
        this.appState.clearPendingAction();
        
        try {
            if (action.type === 'source_unlock') {
                await this.handleSourceUnlock(action.button, action.sourceId, action.price);
            } else if (action.type === 'tier_purchase') {
                await this.handleTierPurchase(action.button, action.tierId, action.price);
            }
        } catch (error) {
            console.error('Error executing pending action:', error);
            this.addMessage('system', 'Failed to complete the action. Please try again.');
        }
    }

    // Source and tier management methods
    async handleSourceUnlock(button, sourceId, price) {
        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'source_unlock', 
                button, 
                sourceId, 
                price 
            });
            this.addMessage('system', 'Please log in to unlock this source.');
            return;
        }

        try {
            const result = await this.apiService.unlockSource(sourceId, price);
            this.addMessage('system', `Source unlocked successfully!`);
            this.appState.addPurchasedItem(sourceId);
            
            // Update UI
            if (button) {
                button.textContent = 'Unlocked';
                button.disabled = true;
            }
            
            await this.authService.updateWalletBalance();
            // Safe wallet display update - only if user is authenticated
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }
            
        } catch (error) {
            console.error('Error unlocking source:', error);
            this.addMessage('system', `Failed to unlock source: ${error.message}`);
        }
    }

    async handleTierPurchase(button, tierId, price, query = "Research Query", useSelectedSources = false) {
        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'tier_purchase', 
                button, 
                tierId, 
                price 
            });
            this.addMessage('system', 'Please log in to purchase this research tier.');
            return;
        }

        try {
            // Prepare purchase details for confirmation modal
            let selectedSources = [];
            if (useSelectedSources) {
                selectedSources = this.appState.getSelectedSources();
                if (selectedSources.length === 0) {
                    this._showToast('Please select sources first', 'error');
                    return;
                }
            }

            const purchaseDetails = {
                tier: tierId,
                price: price,
                selectedSources: selectedSources,
                query: query || this.appState.getCurrentQuery() || "Research Query"
            };

            // Show purchase confirmation modal and await user decision
            const userConfirmed = await this.uiManager.showPurchaseConfirmationModal(purchaseDetails);
            
            if (!userConfirmed) {
                // User cancelled the purchase - reset button state
                if (button) {
                    button.textContent = useSelectedSources ? 
                        `Build Report with ${selectedSources.length} Selected Sources` : 
                        `Purchase ${tierId === 'research' ? 'Research' : 'Pro'} Package`;
                    button.disabled = false;
                }
                return;
            }

            // User confirmed - proceed with mock purchase (no actual API call to LedeWire purchase endpoint)
            // Simulate brief processing time for realism
            await new Promise(resolve => setTimeout(resolve, 800));

            // Handle successful mock purchase
            this.appState.addPurchasedItem(tierId);
            
            // Update UI with success state
            if (button) {
                button.textContent = 'Purchased';
                button.disabled = true;
            }

            // Update wallet balance (keep this real for authentic UX)
            await this.authService.updateWalletBalance();
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }

            // Show success message
            if (useSelectedSources) {
                this._showToast(`Report generated with ${selectedSources.length} selected sources!`, 'success');
            } else {
                this._showToast(`Research tier purchased successfully!`, 'success');
            }
            
        } catch (error) {
            console.error('Error in purchase flow:', error);
            this.addMessage('system', `Failed to complete purchase: ${error.message}`);
            
            // Reset button state on error
            if (button) {
                button.textContent = useSelectedSources ? 
                    `Build Report with ${selectedSources.length || 0} Selected Sources` : 
                    `Purchase ${tierId === 'research' ? 'Research' : 'Pro'} Package`;
                button.disabled = false;
            }
        }
    }

    // Placeholder methods for features to be implemented
    displayReportBuilderResults(data = null) {
        const researchData = data || this.appState.getCurrentResearchData();
        if (!researchData) return;
        
        // Add system message to inform user about mode switch (like research mode)
        this.addMessage('system', '📊 Switched to Report Builder - Generate professional research reports from your selected sources.');
        
        // Create report builder DOM and append directly to maintain chat continuity AND preserve event listeners
        const messagesContainer = document.getElementById('messagesContainer');
        const reportBuilderDiv = document.createElement('div');
        reportBuilderDiv.className = 'message system report-builder-container';
        
        // Create message structure similar to other system messages
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        const messageHeader = document.createElement('div');
        messageHeader.className = 'message-header';
        const senderSpan = document.createElement('span');
        senderSpan.className = 'message-sender';
        senderSpan.textContent = '⚙️ System';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = new Date().toLocaleTimeString();
        messageHeader.appendChild(senderSpan);
        messageHeader.appendChild(timeSpan);
        
        const messageText = document.createElement('div');
        messageText.className = 'message-text';
        messageText.appendChild(this._generateReportBuilderDOM());
        
        messageContent.appendChild(messageHeader);
        messageContent.appendChild(messageText);
        reportBuilderDiv.appendChild(messageContent);
        
        messagesContainer.appendChild(reportBuilderDiv);
        this.uiManager.scrollToBottom();
        
        // Add event listeners to purchase buttons - now they will work since DOM is live
        this._attachTierPurchaseListeners();
    }

    _generateReportBuilderDOM() {
        const selectedSources = this.appState.getSelectedSources();
        const sourceCount = selectedSources.length;
        const totalCost = this.appState.getSelectedSourcesTotal();
        
        const containerDiv = document.createElement('div');
        containerDiv.className = 'tier-cards-section';
        
        // Header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'tier-cards-header';
        const headerTitle = document.createElement('h3');
        headerTitle.textContent = 'Choose Your Research Package';
        const headerDesc = document.createElement('p');
        headerDesc.textContent = 'Select the perfect research tier for your needs. Report generation begins after purchase confirmation.';
        headerDiv.appendChild(headerTitle);
        headerDiv.appendChild(headerDesc);
        containerDiv.appendChild(headerDiv);
        
        // Selected sources list (if any)
        if (sourceCount > 0) {
            const sourcesSection = document.createElement('div');
            sourcesSection.className = 'selected-sources-section';
            
            // Section header
            const sourcesHeader = document.createElement('h4');
            sourcesHeader.textContent = `Selected Sources (${sourceCount})`;
            sourcesSection.appendChild(sourcesHeader);
            
            // Sources list
            const sourcesList = document.createElement('div');
            sourcesList.className = 'selected-sources-list';
            
            selectedSources.forEach(source => {
                const sourceItem = document.createElement('div');
                sourceItem.className = 'selected-source-item';
                
                // Title (clickable if URL available)
                const titleDiv = document.createElement('div');
                titleDiv.className = 'source-title';
                if (source.url) {
                    const titleLink = document.createElement('a');
                    titleLink.href = source.url;
                    titleLink.target = '_blank';
                    titleLink.textContent = source.title || 'Untitled Source';
                    titleDiv.appendChild(titleLink);
                } else {
                    titleDiv.textContent = source.title || 'Untitled Source';
                }
                
                // Author and domain
                const metaDiv = document.createElement('div');
                metaDiv.className = 'source-meta';
                const authorText = source.author ? `${source.author} • ` : '';
                const domainText = source.domain || 'Unknown Domain';
                metaDiv.textContent = `${authorText}${domainText}`;
                
                // Excerpt
                const excerptDiv = document.createElement('div');
                excerptDiv.className = 'source-excerpt';
                excerptDiv.textContent = source.excerpt || 'No preview available.';
                
                // Licensing and remove button
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'source-actions';
                
                // Licensing protocol badge
                if (source.licensing_protocol) {
                    const licenseSpan = document.createElement('span');
                    licenseSpan.className = `license-badge ${source.licensing_protocol.toLowerCase()}`;
                    licenseSpan.textContent = source.licensing_protocol;
                    actionsDiv.appendChild(licenseSpan);
                }
                
                // Remove button
                const removeBtn = document.createElement('button');
                removeBtn.className = 'source-remove-btn';
                removeBtn.textContent = '🗑️';
                removeBtn.title = 'Remove from selection';
                removeBtn.onclick = () => {
                    this.appState.toggleSourceSelection(source.id, source);
                    sourceItem.remove();
                    // Update header count
                    const remaining = this.appState.getSelectedSourcesCount();
                    sourcesHeader.textContent = `Selected Sources (${remaining})`;
                    if (remaining === 0) {
                        sourcesSection.remove();
                    }
                };
                actionsDiv.appendChild(removeBtn);
                
                sourceItem.appendChild(titleDiv);
                sourceItem.appendChild(metaDiv);
                sourceItem.appendChild(excerptDiv);
                sourceItem.appendChild(actionsDiv);
                
                sourcesList.appendChild(sourceItem);
            });
            
            sourcesSection.appendChild(sourcesList);
            
            // Total cost summary
            const costSummary = document.createElement('div');
            costSummary.className = 'sources-cost-summary';
            costSummary.textContent = `Total licensing cost: $${Number(totalCost || 0).toFixed(2)}`;
            sourcesSection.appendChild(costSummary);
            
            containerDiv.appendChild(sourcesSection);
        }
        
        // Tier cards
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'tier-cards-container';
        
        // Research tier ($0.99 as per plan)
        cardsContainer.appendChild(this._createTierCard('research', '🔬', 'Research Package', '$0.99',
            'Professional summary and analysis with source compilation',
            ['✓ Professional summary and analysis', '✓ Source compilation and citations', '✓ Ready for download'],
            'Purchase Research Package', true));
            
        // Pro tier ($1.99 as per plan)
        cardsContainer.appendChild(this._createTierCard('pro', '⭐', 'Pro Package', '$1.99',
            'Everything in Research plus strategic insights and executive formatting',
            ['✓ Everything in Research Package', '✓ Strategic insights and recommendations', 
             '✓ Executive summary format', '✓ Enhanced formatting and presentation'],
            'Purchase Pro Package', false));
        
        containerDiv.appendChild(cardsContainer);
        
        // Build Report button (only if sources are selected)
        if (sourceCount > 0) {
            const buildReportDiv = document.createElement('div');
            buildReportDiv.className = 'build-report-section';
            
            const buildButton = document.createElement('button');
            buildButton.className = 'build-report-btn';
            buildButton.dataset.tier = 'research';
            buildButton.dataset.price = '0.99';
            buildButton.textContent = `Build Report with ${sourceCount} Selected Sources`;
            buildButton.addEventListener('click', async (e) => {
                const tier = e.target.dataset.tier;
                const price = parseFloat(e.target.dataset.price);
                const query = this.appState.getCurrentQuery() || "Selected Sources Research";
                
                e.target.textContent = 'Processing...';
                e.target.disabled = true;
                
                try {
                    // Use existing handleTierPurchase but with selectedSources flag
                    await this.handleTierPurchase(e.target, tier, price, query, true);
                } catch (error) {
                    e.target.textContent = `Build Report with ${sourceCount} Selected Sources`;
                    e.target.disabled = false;
                }
            });
            
            buildReportDiv.appendChild(buildButton);
            containerDiv.appendChild(buildReportDiv);
        }
        
        // Note
        const noteDiv = document.createElement('div');
        noteDiv.className = 'tier-cards-note';
        noteDiv.textContent = '💡 Report generation will begin only after purchase confirmation.';
        containerDiv.appendChild(noteDiv);
        
        return containerDiv;
    }
    
    _createTierCard(tier, icon, title, price, description, features, buttonText, highlighted) {
        const cardDiv = document.createElement('div');
        cardDiv.className = highlighted ? 'tier-card highlighted' : 'tier-card';
        cardDiv.dataset.tier = tier;
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'tier-icon';
        iconDiv.textContent = icon;
        
        const titleH4 = document.createElement('h4');
        titleH4.textContent = title;
        
        const priceDiv = document.createElement('div');
        priceDiv.className = 'tier-price';
        priceDiv.textContent = price;
        
        const descP = document.createElement('p');
        descP.className = 'tier-description';
        descP.textContent = description;
        
        const featuresList = document.createElement('ul');
        featuresList.className = 'tier-features';
        features.forEach(feature => {
            const li = document.createElement('li');
            li.textContent = feature;
            featuresList.appendChild(li);
        });
        
        const button = document.createElement('button');
        button.className = 'tier-purchase-btn';
        button.dataset.tier = tier;
        button.dataset.price = price.replace('$', '');
        button.textContent = buttonText;
        
        cardDiv.appendChild(iconDiv);
        cardDiv.appendChild(titleH4);
        cardDiv.appendChild(priceDiv);
        cardDiv.appendChild(descP);
        cardDiv.appendChild(featuresList);
        cardDiv.appendChild(button);
        
        return cardDiv;
    }
    
    _attachTierPurchaseListeners() {
        const purchaseButtons = document.querySelectorAll('.tier-purchase-btn');
        purchaseButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const tier = e.target.dataset.tier;
                const price = parseFloat(e.target.dataset.price);
                const query = this.appState.getCurrentQuery() || "Research Query";
                
                e.target.textContent = 'Processing...';
                e.target.disabled = true;
                
                try {
                    await this.handleTierPurchase(e.target, tier, price, query);
                } catch (error) {
                    e.target.textContent = `Purchase ${tier === 'research' ? 'Research' : 'Pro'} Package`;
                    e.target.disabled = false;
                }
            });
        });
    }

    updateSourceSelectionUI() {
        // Placeholder for source selection UI updates
        console.log('Source selection UI updated');
    }

    updateReportBuilderDisplay() {
        // Placeholder for report builder display updates
        console.log('Report builder display updated');
    }


    _restoreChatMessages() {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Remove report builder UI
        const reportBuilder = messagesContainer.querySelector('.report-builder-interface');
        if (reportBuilder) {
            reportBuilder.remove();
        }
        
        // Clear existing messages to rebuild fresh
        messagesContainer.innerHTML = '';
        
        // Rebuild UI from stored conversation history WITHOUT mutating state
        const conversationHistory = this.appState.getConversationHistory();
        conversationHistory.forEach(message => {
            // Call UI manager directly to avoid state mutation during restoration
            this.uiManager.addMessageToChat(message);
        });
    }
    
    _showToast(message, type = 'info') {
        // Simple toast implementation - could be enhanced
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            z-index: 1000;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    async _displaySourceCards(sources) {
        // 4. PIPELINE TRACE: Method entry point
        console.log('🎨 DISPLAY METHOD: _displaySourceCards() ENTRY POINT');
        console.log('🎨 DISPLAY METHOD: Sources parameter received:', sources);
        console.log('🎨 DISPLAY METHOD: Sources type:', typeof sources);
        console.log('🎨 DISPLAY METHOD: Sources is array?', Array.isArray(sources));
        console.log('🎨 DISPLAY METHOD: Sources length:', sources?.length);
        
        if (!sources || sources.length === 0) {
            console.log('❌ DISPLAY METHOD: Early return - no sources');
            console.log('❌ DISPLAY METHOD: sources value:', sources);
            console.log('❌ DISPLAY METHOD: sources.length:', sources?.length);
            return;
        }
        
        console.log('✅ DISPLAY METHOD: Validation passed, proceeding to create cards');
        
        // Wait for SourceCard to be available
        if (!window.SourceCard) {
            console.log('Waiting for SourceCard to load...');
            await new Promise(resolve => {
                if (window.SourceCard) {
                    resolve();
                    return;
                }
                document.addEventListener('SourceCardReady', resolve, { once: true });
            });
        }
        
        // Initialize the SourceCard component with app state  
        if (!this.sourceCardComponent) {
            this.sourceCardComponent = new window.SourceCard(this.appState);
            
            // Listen for component events
            document.addEventListener('sourceUnlockRequested', (e) => {
                this.handleSourceUnlock(null, e.detail.source.id, e.detail.source.unlock_price);
            });
            
            document.addEventListener('sourceDownloadRequested', (e) => {
                window.open(e.detail.source.url, '_blank');
            });
            
            document.addEventListener('sourceSelectionChanged', (e) => {
                // Event is handled internally by the component
            });
        }
        
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
        
        // Create individual source cards
        sources.forEach((source, index) => {
            // Use source data as-is from backend
            const sourceData = {
                ...source
            };
            
            // Create source card using the component
            const sourceCard = this.sourceCardComponent.create(sourceData, {
                showCheckbox: true,
                showActions: true
            });
            
            // Source card is ready to display with real backend data
            container.appendChild(sourceCard);
        });
        
        // Add the properly structured container to the chat with source data for restoration
        this.addMessage('assistant', container, {
            type: 'source_cards',
            sources: sources,
            query: this.appState.getCurrentQuery()
        });
    }
    
    async _pollForEnrichedResults(query) {
        if (!query) return;
        
        // Poll every 5 seconds for up to 30 seconds to get enriched results
        let attempts = 0;
        const maxAttempts = 6;
        
        const pollInterval = setInterval(async () => {
            attempts++;
            
            try {
                const result = await this.apiService.analyzeQueryForTier(query, 10.0, 15);
                
                // If enrichment is complete, update the source cards
                if (!result.enrichment_needed || result.enrichment_status === 'complete') {
                    this._updateSourceCards(result.sources);
                    clearInterval(pollInterval);
                    return;
                }
                
                // Stop polling after max attempts
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    console.log('Stopped polling for enriched results after max attempts');
                }
                
            } catch (error) {
                console.error('Error polling for enriched results:', error);
                clearInterval(pollInterval);
            }
        }, 5000);
    }
    
    _updateSourceCards(enrichedSources) {
        enrichedSources.forEach(source => {
            const sourceCard = document.querySelector(`[data-source-id="${source.id}"]`);
            if (!sourceCard) return;
            
            // Remove loading indicators
            sourceCard.classList.remove('source-enriching');
            const loadingIndicator = sourceCard.querySelector('.enrichment-indicator');
            if (loadingIndicator) loadingIndicator.remove();
            
            // Update content with enriched data
            const titleEl = sourceCard.querySelector('.source-title');
            if (titleEl && source.title) titleEl.textContent = source.title;
            
            const excerptEl = sourceCard.querySelector('.source-excerpt');
            if (excerptEl && source.excerpt) excerptEl.textContent = source.excerpt;
            
            const priceEl = sourceCard.querySelector('.source-price');
            if (priceEl && source.unlock_price) {
                const safePrice = Number(source.unlock_price) || 0;
                priceEl.textContent = `$${safePrice.toFixed(2)}`;
            }
            
            // Add licensing badge if available
            if (source.licensing_protocol) {
                const metadataDiv = sourceCard.querySelector('.source-metadata');
                if (metadataDiv && !metadataDiv.querySelector('.licensing-badge')) {
                    const licensingBadge = document.createElement('span');
                    licensingBadge.className = 'licensing-badge';
                    licensingBadge.textContent = source.licensing_protocol;
                    metadataDiv.appendChild(licensingBadge);
                }
            }
        });
        
        // Show completion message
        this._showToast('Source enrichment complete! Updated with enhanced details.', 'success');
    }
    
    // Global methods for HTML event handlers (legacy support)
    async handleSourceUnlockInChat(sourceId, price, title) {
        // This method is kept for backward compatibility but should not be used
        // New code should call handleSourceUnlock directly with the button reference
        console.warn('handleSourceUnlockInChat is deprecated - use handleSourceUnlock directly');
        return this.handleSourceUnlock(null, sourceId, price);
    }

    toggleSourceSelection(sourceId, sourceData) {
        const isSelected = this.appState.toggleSourceSelection(sourceId, sourceData);
        this.updateSourceSelectionUI();
        return isSelected;
    }

    updateSourceSelectionUI() {
        const selectedSources = this.appState.getSelectedSources();
        const selectedIds = new Set(selectedSources.map(s => s.id));
        
        // Update ALL checkbox states to match actual selection state
        const allCheckboxes = document.querySelectorAll('.source-selection-checkbox');
        allCheckboxes.forEach(checkbox => {
            const sourceCard = checkbox.closest('[data-source-id]');
            if (sourceCard) {
                const sourceId = sourceCard.getAttribute('data-source-id');
                const isSelected = selectedIds.has(sourceId);
                checkbox.checked = isSelected;
                
                // Visual feedback for selected cards
                if (isSelected) {
                    sourceCard.style.borderColor = 'var(--primary)';
                    sourceCard.style.backgroundColor = 'var(--primary-light, #f0f9ff)';
                } else {
                    sourceCard.style.borderColor = '';
                    sourceCard.style.backgroundColor = '';
                }
            }
        });
        
        // Update report builder if in report mode
        if (this.appState.getMode() === 'report') {
            this.displayReportBuilderResults();
        }
        
        // Update selection count display if needed
        console.log(`Sources selected: ${selectedSources.length}`);
    }

    _checkBudgetWarning(totalCost) {
        const researchBudget = 0.99;
        const proBudget = 1.99;
        const warningThreshold = 0.8; // 80% of budget
        
        // Check Pro tier budget first (higher threshold)
        if (totalCost >= proBudget) {
            return `⚠️ Selected sources exceed Pro budget ($${Number(proBudget || 0).toFixed(2)})`;
        } else if (totalCost >= proBudget * warningThreshold) {
            return `⚠️ Selected sources approaching Pro budget limit ($${Number(proBudget || 0).toFixed(2)})`;
        }
        
        // Check Research tier budget
        if (totalCost >= researchBudget) {
            return `⚠️ Selected sources exceed Research budget ($${Number(researchBudget || 0).toFixed(2)})`;
        } else if (totalCost >= researchBudget * warningThreshold) {
            return `⚠️ Selected sources approaching Research budget limit ($${Number(researchBudget || 0).toFixed(2)})`;
        }
        
        return null; // No warning needed
    }
}

// Initialize the app when DOM is ready  
document.addEventListener('DOMContentLoaded', () => {
    console.log("🚀 DOMContentLoaded fired - attempting app initialization");
    // Ensure only one instance exists
    if (!window.LedeWire?.researchApp) {
        try {
            console.log("📦 Creating new ChatResearchApp instance...");
            window.app = new ChatResearchApp();
            console.log("✅ ChatResearchApp created successfully:", window.app);
            // Legacy global only if not already set (avoid conflicts)
            if (!window.researchApp) {
                window.researchApp = window.app;
            }
        } catch (e) {
            console.error("🚨 App initialization failed:", e);
            console.error("Stack trace:", e.stack);
        }
    } else {
        console.log("⚠️ App instance already exists, skipping initialization");
    }
});
