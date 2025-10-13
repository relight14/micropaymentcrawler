/**
 * Main Application Controller
 * Clean, focused orchestration layer with modular infrastructure
 */
import { APIService } from './services/api.js';
import { AuthService } from './services/auth.js';
import { AppState } from './state/app-state.js';
import { UIManager } from './components/ui-manager.js';
import { MessageRenderer } from './components/message-renderer.js';
import { ToastManager } from './app/toast-manager.js';
import { ModalController } from './app/modal-controller.js';
import { EventRouter } from './app/event-router.js';

// SourceCard will be loaded globally - access it dynamically when needed

export class ChatResearchApp {
    constructor() {
        // Initialize base URL for API calls
        this.baseURL = window.location.origin;
        
        // Initialize core services and state (dependency injection)
        this.authService = new AuthService();
        this.apiService = new APIService(this.authService);
        this.appState = new AppState();
        this.uiManager = new UIManager(this.appState);
        
        // Initialize infrastructure managers
        this.toastManager = new ToastManager();
        this.modalController = new ModalController(
            this.authService, 
            this.appState, 
            this.toastManager, 
            this.baseURL
        );
        this.eventRouter = new EventRouter();
        
        // Register logout callback to update UI when user is logged out
        this.authService.onLogout(() => {
            console.log('🔐 Logout callback triggered - updating UI');
            this.updateAuthButton();
            this.toastManager.show('Session expired. Please log in again.', 'info');
        });
        
        // Debounce flag for unlock operations
        this.isUnlockInProgress = false;
        
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
            // Setup modal controller callbacks
            this.modalController.setAuthSuccessCallback(async (type) => {
                // Close the auth modal
                this.modalController.closeAuthModal();
                
                // Show success toast
                this.toastManager.show(`Welcome! Successfully ${type === 'login' ? 'logged in' : 'signed up'}.`, 'success');

                // Fetch wallet balance from API
                await this.authService.updateWalletBalance();
                
                // Auto-trigger funding modal if balance is $0
                if (this.authService.isAuthenticated() && this.authService.getWalletBalance() === 0) {
                    setTimeout(() => {
                        this.modalController.showFundingModal();
                    }, 500);
                }
                
                // Execute any pending tab state action
                const pendingTabAction = this.appState.getPendingTabAction();
                if (pendingTabAction) {
                    console.log('🔄 Executing pending tab action after login:', pendingTabAction);
                    
                    if (pendingTabAction.type === 'mode_switch') {
                        this.setMode(pendingTabAction.mode);
                    }
                    
                    this.appState.clearPendingTabAction();
                }
                
                // Update UI with wallet balance
                this.updateAuthButton();
            });

            this.modalController.setAuthToggleCallback(() => {
                this.toggleAuthMode();
            });

            this.modalController.setFundingSuccessCallback(async () => {
                // Refresh wallet balance
                await this.authService.updateWalletBalance();
                if (this.authService.isAuthenticated()) {
                    this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
                }
            });

            // Setup event router handlers
            this.eventRouter.setHandlers({
                onSendMessage: () => this.sendMessage(),
                onModeSwitch: (mode) => this.setMode(mode),
                onClearConversation: () => this.clearConversation(),
                onDarkModeToggle: () => this.toggleDarkMode(),
                onAuthButtonClick: () => this.handleAuthButtonClick(),
                onCitationBadgeClick: (sourceId, price) => this.handleCitationBadgeClick(sourceId, price),
                onFeedbackSubmit: (query, sourceIds, rating, mode, feedbackSection) => 
                    this.submitFeedback(query, sourceIds, rating, mode, feedbackSection),
                onResearchSuggestion: (topicHint) => this.handleResearchSuggestion(topicHint),
                onChatInput: (e) => {
                    this.uiManager.updateCharacterCount();
                    this.uiManager.autoResizeTextarea(e.target);
                },
                getDarkModeState: () => this.appState.isDarkModeEnabled()
            });

            // Initialize event listeners
            this.eventRouter.initialize();
            
            // Update UI
            this.uiManager.updateModeDisplay();
            
            // Validate token and update auth UI (this will auto-logout if expired)
            const isAuthenticated = this.authService.isAuthenticated();
            this.updateAuthButton();
            
            // Update wallet balance if authenticated (and still authenticated after validation)
            if (isAuthenticated && this.authService.isAuthenticated()) {
                await this.authService.updateWalletBalance();
                // Safe wallet display update - only if user is still authenticated
                if (this.authService.isAuthenticated()) {
                    this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
                }
            }
        } catch (error) {
            console.error('Error initializing app:', error);
            this.addMessage('system', 'Application initialization failed. Please refresh the page.');
        }
    }

    // Event router handlers (extracted to helper methods)
    handleCitationBadgeClick(sourceId, price) {
        // Extract source data from current research data
        const researchData = this.appState.getCurrentResearchData();
        if (!researchData || !researchData.sources) {
            console.error('Citation badge clicked but no research data available');
            return;
        }
        
        const source = researchData.sources.find(s => s.id === sourceId);
        if (!source) {
            console.error('Citation badge clicked but source not found:', sourceId);
            return;
        }
        
        // Call the existing unlock handler
        console.log('🔖 Citation badge clicked for source:', source.title);
        this.handleSourceUnlock(null, sourceId, price);
    }

    handleResearchSuggestion(topicHint) {
        // Switch to research mode
        this.setMode('research');
        
        // Prefill the search query if we have a topic hint
        if (topicHint) {
            const chatInput = document.getElementById('newChatInput');
            if (chatInput) {
                chatInput.value = topicHint;
                chatInput.focus();
                // Update character count
                this.uiManager.updateCharacterCount();
            }
        }
    }

    async sendMessage() {
        const chatInput = document.getElementById('newChatInput');
        const message = chatInput?.value?.trim();
        
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
            
            // Hide typing indicator
            this.uiManager.hideTypingIndicator();
            
            // Display response
            if (response.content) {
                this.addMessage('assistant', response.content, response.metadata);
            }
            
            // Handle research data with progressive loading
            if (response.research_data) {
                // Backend is single source of truth for enrichment status
                this.appState.setCurrentResearchData(response.research_data);
                
                // Display immediate source cards
                this._displaySourceCards(response.research_data.sources);
                
                // If enrichment is needed, let the progressive system handle updates
                // Note: Backend handles progressive enrichment via cache polling automatically
                if (response.research_data.enrichment_needed) {
 
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
        // Check authentication for research mode
        if (mode === 'research' && !this.authService.isAuthenticated()) {
            // Save pending mode switch and show login modal
            this.appState.setPendingAction({ 
                type: 'mode_switch', 
                mode: 'research' 
            });
            this.modalController.showAuthModal();
            return;
        }
        
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
        this.modalController.showAuthModal();
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
        const topUpItem = document.getElementById('topUpItem');
        const logoutItem = document.getElementById('logoutItem');
        
        console.log('Setting up profile dropdown:', { profileButton, dropdownMenu, topUpItem, logoutItem });
        
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
        
        if (topUpItem) {
            topUpItem.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Top Up clicked');
                dropdownMenu.classList.remove('show'); // Close dropdown
                this.modalController.showFundingModal(); // Launch funding modal
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
            } else if (action.type === 'mode_switch') {
                // Switch to the pending mode after login
                this.setMode(action.mode);
            }
        } catch (error) {
            console.error('Error executing pending action:', error);
            this.addMessage('system', 'Failed to complete the action. Please try again.');
        }
    }

    // Feedback submission
    async submitFeedback(query, sourceIds, rating, mode, feedbackSection) {
        try {
            console.log('📊 Submitting feedback:', { query, sourceIds, rating, mode });
            
            // Get authorization token if available
            const token = this.authService.getAccessToken();
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            // Submit to API
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    query: query,
                    source_ids: sourceIds,
                    rating: rating,
                    mode: mode
                })
            });
            
            if (!response.ok) {
                throw new Error('Failed to submit feedback');
            }
            
            const result = await response.json();
            
            // Mark as submitted to prevent duplicates
            feedbackSection.dataset.submitted = 'true';
            
            // Update UI to show submitted state
            const feedbackText = feedbackSection.querySelector('p');
            if (feedbackText) {
                feedbackText.textContent = result.message || 'Thank you for your feedback!';
            }
            
            const buttonContainer = feedbackSection.querySelector('div');
            if (buttonContainer) {
                buttonContainer.style.display = 'none';
            }
            
            // Show success toast
            this.toastManager.show('✅ ' + (result.message || 'Feedback submitted!'), 'success', 3000);
            
            console.log('✅ Feedback submitted successfully');
            
        } catch (error) {
            console.error('❌ Feedback submission error:', error);
            this.toastManager.show('Failed to submit feedback. Please try again.', 'error', 3000);
        }
    }
    
    // Source and tier management methods
    async handleSourceUnlock(button, sourceId, price) {
        console.log('🔓 UNLOCK: handleSourceUnlock() called!', { button, sourceId, price });
        
        // Find the source object
        let sourceToUpdate = null;
        const researchResults = this.appState.getCurrentResearchData();
        if (researchResults && researchResults.sources) {
            sourceToUpdate = researchResults.sources.find(s => s.id === sourceId);
        }

        // Guard: Check if already unlocked
        if (sourceToUpdate?.is_unlocked || this.appState.isPurchased(sourceId)) {
            console.log('🔓 UNLOCK: Source already unlocked, opening directly');
            if (sourceToUpdate?.url) {
                window.open(sourceToUpdate.url, '_blank');
            }
            return;
        }

        // LAYER 2 SAFETY: Block unlock if enrichment is still pending
        if (this.appState.isEnrichmentPending()) {
            this.toastManager.show('⏳ Pricing is still loading... please wait', 'info', 3000);
            console.log('🔓 UNLOCK: Blocked - enrichment still pending');
            return;
        }

        // Guard: Prevent duplicate unlock attempts
        if (this.isUnlockInProgress) {
            console.log('🔓 UNLOCK: Already in progress, ignoring duplicate request');
            return;
        }

        // Auth check: Show auth modal if not authenticated
        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'source_unlock', 
                button, 
                sourceId, 
                price 
            });
            this.modalController.showAuthModal();
            return;
        }
        
        // LAYER 3 SAFETY: Always fetch fresh server-authoritative pricing before showing modal
        try {
            console.log('🔓 UNLOCK: Fetching fresh pricing from server...');
            const freshPricing = await this.apiService.getFreshSourcePricing(sourceId);
            
            // Update source with fresh pricing
            if (sourceToUpdate) {
                sourceToUpdate.unlock_price = freshPricing.unlock_price;
                sourceToUpdate.licensing_protocol = freshPricing.licensing_protocol;
            }
            
            // Use fresh price for modal
            price = freshPricing.unlock_price;
            console.log('✅ UNLOCK: Fresh pricing fetched:', freshPricing);
            
        } catch (error) {
            console.error('❌ UNLOCK: Failed to fetch fresh pricing:', error);
            this.toastManager.show('Failed to load pricing. Please try again.', 'error');
            return;
        }

        // Prepare purchase details for checkout modal
        const purchaseDetails = {
            tier: 'source_unlock',
            price: price,
            titleOverride: 'Unlock Source',
            customDescription: price === 0 
                ? 'This source is free to unlock. Click confirm to access.'
                : `Unlock this ${sourceToUpdate?.license_type || 'licensed'} source for $${Number(price).toFixed(2)}`,
            selectedSources: sourceToUpdate ? [sourceToUpdate] : [],
            query: sourceToUpdate?.title || 'Source Access'
        };

        // Show checkout confirmation modal
        const userConfirmed = await this.uiManager.showPurchaseConfirmationModal(purchaseDetails);
        
        if (!userConfirmed) {
            // User cancelled - reset button state
            console.log('🔓 UNLOCK: User cancelled purchase');
            if (button) {
                button.innerHTML = '🔓 <span>Unlock</span>';
                button.disabled = false;
            }
            return;
        }

        // Lock the unlock operation
        this.isUnlockInProgress = true;

        // Show loading state on button
        const originalButtonContent = button?.innerHTML;
        if (button) {
            button.innerHTML = '🔄 <span>Unlocking...</span>';
            button.disabled = true;
        }

        try {
            const result = await this.apiService.unlockSource(sourceId, price);
            
            // Update source state
            if (sourceToUpdate) {
                sourceToUpdate.is_unlocked = true;
            }
            this.appState.addPurchasedItem(sourceId);
            
            // Update wallet balance
            await this.authService.updateWalletBalance();
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }

            // Show success toast
            this.toastManager.show('✅ Source unlocked! Redirecting you now…', 'success', 4000);

            // Update button to "View Source" state
            if (button) {
                button.innerHTML = '📄 <span>View Source</span>';
                button.disabled = false;
                // Update click handler to open source URL
                const newHandler = () => {
                    if (sourceToUpdate?.url) {
                        window.open(sourceToUpdate.url, '_blank');
                    }
                };
                button.removeEventListener('click', button._currentHandler);
                button.addEventListener('click', newHandler);
                button._currentHandler = newHandler;
            }

            // Wait 1.5-2 seconds for UX clarity, then redirect
            setTimeout(() => {
                if (sourceToUpdate?.url) {
                    window.open(sourceToUpdate.url, '_blank');
                } else {
                    console.warn('Source URL not found for redirect');
                }
            }, 1800);

            // Trigger UI refresh for source cards (shallow copy to force re-render)
            if (researchResults && researchResults.sources) {
                this.appState.setCurrentResearchData({
                    ...researchResults,
                    sources: [...researchResults.sources]
                });
            }

        } catch (error) {
            console.error('Error unlocking source:', error);
            
            // Detailed logging for 422 errors
            if (error.message.includes('422') || error.message.includes('Unprocessable Entity')) {
                console.warn('⚠️ Unlock schema validation error - check payload structure:', {
                    sourceId,
                    price,
                    error: error.message
                });
            }
            
            this.toastManager.show('⚠️ Unlock failed. Please try again.', 'error');
            
            // Restore button state on failure
            if (button && originalButtonContent) {
                button.innerHTML = originalButtonContent;
                button.disabled = false;
            }
        } finally {
            // Always unlock the operation
            this.isUnlockInProgress = false;
        }
    }

    async handleReportGeneration(button, tier, query, selectedSources) {
        if (!this.authService.isAuthenticated()) {
            this.addMessage('system', 'Please log in to generate a report.');
            return;
        }

        try {
            // Extract source IDs from selected sources
            const selectedSourceIds = selectedSources.map(source => source.id);
            
            console.log(`📊 Generating ${tier} report with ${selectedSourceIds.length} selected sources`);
            
            // Show progressive loading indicator
            const loadingMessageElement = this._addProgressiveLoadingMessage();
            
            // Call generateReport endpoint with selected source IDs
            const reportPacket = await this.apiService.generateReport(query, tier, selectedSourceIds);
            
            // Remove loading indicator
            if (loadingMessageElement) {
                this._removeLoadingMessage(loadingMessageElement);
            }
            
            if (reportPacket) {
                // Update button state
                if (button) {
                    button.textContent = 'Report Generated';
                    button.disabled = true;
                }
                
                // Display the generated report
                this._displayGeneratedReport(reportPacket);
                
                // Show success message as toast (non-intrusive, won't trigger DOM re-render)
                this.toastManager.show(`✅ ${tier === 'research' ? 'Research' : 'Pro'} report generated successfully from your ${selectedSourceIds.length} selected sources!`, 'success');
            }
        } catch (error) {
            console.error('Error generating report:', error);
            this.toastManager.show(`⚠️ Report generation failed: ${error.message}`, 'error');
            
            // Reset button state
            if (button) {
                button.textContent = `Generate ${tier === 'research' ? 'Research' : 'Pro'} Report`;
                button.disabled = false;
            }
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
                    this.toastManager.show('Please select sources first', 'error');
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

            // User confirmed - proceed with real purchase API call
            let loadingMessageElement = null;
            try {
                // Show progressive loading indicator in chat
                loadingMessageElement = this._addProgressiveLoadingMessage();
                
                // Call real purchase endpoint which generates sources + AI report
                const purchaseResponse = await this.apiService.purchaseTier(
                    tierId, 
                    price, 
                    query || this.appState.getCurrentQuery() || "Research Query", 
                    useSelectedSources ? selectedSources : null
                );
                
                // Remove loading indicator
                if (loadingMessageElement) {
                    this._removeLoadingMessage(loadingMessageElement);
                    loadingMessageElement = null;
                }
                
                if (purchaseResponse && purchaseResponse.success && purchaseResponse.packet) {
                    // Mark as purchased in state
                    this.appState.addPurchasedItem(tierId);
                    
                    // Update UI with success state
                    if (button) {
                        button.textContent = 'Purchased';
                        button.disabled = true;
                    }

                    // Update wallet balance
                    await this.authService.updateWalletBalance();
                    if (this.authService.isAuthenticated()) {
                        this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
                    }

                    // Display the AI-generated report in the UI
                    this._displayGeneratedReport(purchaseResponse.packet);
                    
                    // Show success message in chat
                    this.addMessage('system', '✅ AI research report generated successfully!');
                } else {
                    throw new Error('Invalid purchase response');
                }
            } catch (reportError) {
                console.error('Error in purchase/report generation:', reportError);
                
                // Remove loading indicator on error
                if (loadingMessageElement) {
                    this._removeLoadingMessage(loadingMessageElement);
                }
                
                this.addMessage('system', `❌ Purchase failed: ${reportError.message}`);
                throw reportError;
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
        
        // Create report builder DOM content
        const reportBuilderContent = this._generateReportBuilderDOM();
        
        // Use MessageRenderer for consistent message structure
        const reportBuilderMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: reportBuilderContent,
            timestamp: new Date()
        });
        
        // Add custom class for specific styling if needed
        reportBuilderMessage.classList.add('report-builder-container');
        
        const messagesContainer = document.getElementById('messagesContainer');
        messagesContainer.appendChild(reportBuilderMessage);
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
                    // If in report builder mode with selected sources, use generateReport endpoint
                    const selectedSources = this.appState.getSelectedSources();
                    if (selectedSources && selectedSources.length > 0) {
                        await this.handleReportGeneration(e.target, tier, query, selectedSources);
                    } else {
                        // Otherwise use standard purchase flow
                        await this.handleTierPurchase(e.target, tier, price, query);
                    }
                } catch (error) {
                    e.target.textContent = `Generate ${tier === 'research' ? 'Research' : 'Pro'} Report`;
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
        
        conversationHistory.forEach((message) => {
            // Convert HTML strings back to DOM elements for proper rendering
            const uiMessage = { ...message };
            if (typeof message.content === 'string' && message.content.startsWith('<')) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = message.content;
                uiMessage.content = tempDiv.firstChild;
            }
            
            // Call UI manager directly to avoid state mutation during restoration
            this.uiManager.addMessageToChat(uiMessage);
        });
    }
    
    _addLoadingMessage(message) {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Use new MessageRenderer for consistent loading indicators
        const loadingMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: message,
            timestamp: new Date(),
            variant: 'loading'
        });
        
        messagesContainer.appendChild(loadingMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        return loadingMessage;
    }
    
    _addProgressiveLoadingMessage() {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Create loading message with initial status
        const loadingMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: '📊 Compiling sources...',
            timestamp: new Date(),
            variant: 'loading'
        });
        
        messagesContainer.appendChild(loadingMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        // Progressive status updates
        const steps = [
            { delay: 0, text: '📊 Compiling sources...' },
            { delay: 5000, text: '🔍 Analyzing content...' },
            { delay: 10000, text: '✍️ Building your report...' }
        ];
        
        const timers = [];
        
        steps.forEach((step, index) => {
            if (index === 0) return; // First step is already shown
            
            const timer = setTimeout(() => {
                const messageText = loadingMessage.querySelector('.message__loading-text');
                if (messageText) {
                    messageText.textContent = step.text;
                }
            }, step.delay);
            
            timers.push(timer);
        });
        
        // Store timers on the element for cleanup
        loadingMessage._progressTimers = timers;
        
        return loadingMessage;
    }
    
    _removeLoadingMessage(element) {
        if (element && element.parentNode) {
            // Clear any progressive timers
            if (element._progressTimers) {
                element._progressTimers.forEach(timer => clearTimeout(timer));
            }
            element.remove();
        }
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
                console.log('🔓 UNLOCK: Event received in app.js!', e.detail);
                console.log('🔓 UNLOCK: Calling handleSourceUnlock with:', e.detail.source.id, e.detail.source.unlock_price);
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
        
        // Add feedback component
        const feedbackSection = this._createFeedbackComponent(sources);
        container.appendChild(feedbackSection);
        
        // Add the properly structured container to the chat with source data for restoration
        this.addMessage('assistant', container, {
            type: 'source_cards',
            sources: sources,
            query: this.appState.getCurrentQuery()
        });
    }
    
    _createFeedbackComponent(sources) {
        const feedbackContainer = document.createElement('div');
        feedbackContainer.className = 'feedback-section';
        feedbackContainer.style.cssText = 'margin-top: 20px; padding: 16px; background: var(--surface-secondary, #f5f5f5); border-radius: 8px; text-align: center;';
        
        const feedbackText = document.createElement('p');
        feedbackText.textContent = 'How helpful are these sources?';
        feedbackText.style.cssText = 'margin: 0 0 12px 0; color: var(--text-primary, #333); font-weight: 500;';
        
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 12px; justify-content: center; align-items: center;';
        
        const thumbsUpBtn = document.createElement('button');
        thumbsUpBtn.className = 'feedback-btn feedback-up';
        thumbsUpBtn.innerHTML = '👍 Helpful';
        thumbsUpBtn.style.cssText = 'padding: 8px 20px; border: 2px solid var(--primary, #4A90E2); background: white; color: var(--primary, #4A90E2); border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s;';
        
        const thumbsDownBtn = document.createElement('button');
        thumbsDownBtn.className = 'feedback-btn feedback-down';
        thumbsDownBtn.innerHTML = '👎 Not helpful';
        thumbsDownBtn.style.cssText = 'padding: 8px 20px; border: 2px solid #666; background: white; color: #666; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s;';
        
        // Store data attributes for later submission
        feedbackContainer.dataset.query = this.appState.getCurrentQuery() || '';
        feedbackContainer.dataset.sourceIds = JSON.stringify(sources.map(s => s.id));
        feedbackContainer.dataset.mode = this.appState.getMode();
        
        buttonContainer.appendChild(thumbsUpBtn);
        buttonContainer.appendChild(thumbsDownBtn);
        feedbackContainer.appendChild(feedbackText);
        feedbackContainer.appendChild(buttonContainer);
        
        return feedbackContainer;
    }
    
    _displayGeneratedReport(reportData) {
        console.log('📊 DISPLAY REPORT: Displaying generated report:', reportData);
        console.log('🔍 CITATION DEBUG: citation_metadata =', reportData.citation_metadata);
        
        if (!reportData || !reportData.summary) {
            console.error('❌ DISPLAY REPORT: Invalid report data:', reportData);
            return;
        }
        
        // Build report header
        const headerText = `# Research Report: ${reportData.query}\n**${(reportData.tier || 'research').toUpperCase()} TIER**\n\n`;
        
        // Build complete report content
        let reportContent = headerText + reportData.summary;
        
        // Add outline if available
        if (reportData.outline) {
            reportContent += '\n\n' + reportData.outline;
        }
        
        // Add insights if available
        if (reportData.insights) {
            reportContent += '\n\n' + reportData.insights;
        }
        
        // Add footer
        const sourceCount = reportData.total_sources || reportData.sources?.length || 0;
        reportContent += `\n\n---\n*Generated from ${sourceCount} sources*`;
        
        // Pass raw markdown to MessageRenderer with citation metadata
        // MessageRenderer will handle conversion to HTML and inject citation badges
        this.addMessage('assistant', reportContent, {
            type: 'research_report',
            tier: reportData.tier,
            query: reportData.query,
            sources_count: sourceCount,
            citation_metadata: reportData.citation_metadata || null
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
        this.toastManager.show('Source enrichment complete! Updated with enhanced details.', 'success');
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
    // Ensure only one instance exists
    if (!window.LedeWire?.researchApp) {
        try {
            window.app = new ChatResearchApp();
            // Legacy global only if not already set (avoid conflicts)
            if (!window.researchApp) {
                window.researchApp = window.app;
            }
        } catch (e) {
            console.error("🚨 App initialization failed:", e);
            console.error("Stack trace:", e.stack);
        }
    }
});
