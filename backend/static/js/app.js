/**
 * Main Application Controller
 * Clean, focused orchestration layer with modular infrastructure
 */
import { APIService } from './services/api.js';
import { AuthService } from './services/auth.js';
import { AppState } from './state/app-state.js';
import { UIManager } from './components/ui-manager.js';
import { MessageRenderer } from './components/message-renderer.js';
import { ReportBuilder } from './components/report-builder.js';
import { OnboardingModal } from './components/onboarding-modal.js';
import { ToastManager } from './app/toast-manager.js';
import { ModalController } from './app/modal-controller.js';
import { EventRouter } from './app/event-router.js';
import { SourceManager } from './managers/source-manager.js';
import { TierManager } from './managers/tier-manager.js';
import { MessageCoordinator } from './managers/message-coordinator.js';
import { InteractionHandler } from './managers/interaction-handler.js';
import { ProjectManager } from './managers/project-manager.js';
import { AppEvents, EVENT_TYPES } from './utils/event-bus.js';
import { analytics } from './utils/analytics.js';
import { summaryPopover } from './components/summary-popover.js';

// SourceCard and SummaryPopover loaded globally - access them dynamically when needed
window.summaryPopover = summaryPopover;

export class ChatResearchApp {
    constructor() {
        // Initialize base URL for API calls
        this.baseURL = window.location.origin;
        
        // Flag to prevent saving messages during restoration
        this.isRestoringMessages = false;
        
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
        
        // Initialize UI components
        this.reportBuilder = new ReportBuilder({
            appState: this.appState,
            apiService: this.apiService,
            authService: this.authService,
            toastManager: this.toastManager,
            uiManager: this.uiManager
        });
        
        // Initialize domain managers
        this.sourceManager = new SourceManager({
            appState: this.appState,
            apiService: this.apiService,
            authService: this.authService,
            toastManager: this.toastManager,
            uiManager: this.uiManager,
            modalController: this.modalController
        });
        
        this.tierManager = new TierManager({
            appState: this.appState,
            apiService: this.apiService,
            authService: this.authService,
            toastManager: this.toastManager,
            uiManager: this.uiManager,
            reportBuilder: this.reportBuilder,
            messageCoordinator: null  // Will be set after MessageCoordinator is created
        });
        
        this.messageCoordinator = new MessageCoordinator({
            appState: this.appState,
            apiService: this.apiService,
            authService: this.authService,
            uiManager: this.uiManager,
            toastManager: this.toastManager,
            sourceManager: this.sourceManager
        });
        
        // Update TierManager's messageCoordinator reference
        this.tierManager.messageCoordinator = this.messageCoordinator;
        
        this.interactionHandler = new InteractionHandler({
            appState: this.appState,
            apiService: this.apiService,
            modalController: this.modalController,
            uiManager: this.uiManager,
            toastManager: this.toastManager,
            sourceManager: this.sourceManager
        });
        
        this.projectManager = new ProjectManager({
            apiService: this.apiService,
            authService: this.authService,
            toastManager: this.toastManager
        });
        
        // Setup ReportBuilder event listeners
        this.reportBuilder.addEventListener('reportGenerated', (e) => {
            const { reportData, tier, sourceCount } = e.detail;
            const message = this.reportBuilder.displayReport(reportData);
            if (message) {
                this.addMessage(message.sender, message.content, message.metadata);
            }
            this.toastManager.show(`✅ ${tier === 'research' ? 'Research' : 'Pro'} report generated successfully from your ${sourceCount} selected sources!`, 'success');
        });
        
        this.reportBuilder.addEventListener('reportGenerating', (e) => {
            // Show progressive loading message and store reference for cleanup
            this.currentReportLoadingMessage = this.messageCoordinator.showProgressiveLoading();
        });
        
        this.reportBuilder.addEventListener('reportError', (e) => {
            const { error, tier } = e.detail;
            
            // Remove progressive loading message if it exists
            if (this.currentReportLoadingMessage) {
                this.messageCoordinator.removeLoading(this.currentReportLoadingMessage);
                this.currentReportLoadingMessage = null;
            }
            
            this.toastManager.show(`⚠️ Report generation failed: ${error.message}`, 'error');
        });
        
        this.reportBuilder.addEventListener('authRequired', (e) => {
            this.addMessage('system', e.detail.message);
        });
        
        this.reportBuilder.addEventListener('tierPurchase', (e) => {
            const { tier, price, query, button, useSelectedSources } = e.detail;
            this.tierManager.purchaseTier(button, tier, price, query, useSelectedSources);
        });
        
        // Setup TierManager event listeners
        this.tierManager.addEventListener('authRequired', (e) => {
            this.addMessage('system', e.detail.message);
        });
        
        this.tierManager.addEventListener('purchaseCompleted', (e) => {
            const { reportData, tier, sourceCount } = e.detail;
            
            // Remove progressive loading message if it exists
            if (this.currentReportLoadingMessage) {
                this.messageCoordinator.removeLoading(this.currentReportLoadingMessage);
                this.currentReportLoadingMessage = null;
            }
            
            const message = this.reportBuilder.displayReport(reportData);
            if (message) {
                this.addMessage(message.sender, message.content, message.metadata);
            }
            this.addMessage('system', '✅ AI research report generated successfully!');
        });
        
        this.tierManager.addEventListener('purchaseError', (e) => {
            this.addMessage('system', e.detail.message);
        });
        
        // Setup centralized AppEvents bus listeners for cross-component coordination
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_SELECTED, (e) => {
            console.log('📡 AppEvents: Source selected', e.detail);
            // Update report builder when sources are selected
            if (this.appState.getMode() === 'report') {
                const reportBuilderElement = this.reportBuilder.show();
                this.addMessage('system', reportBuilderElement);
            }
            // Update project store with selected sources
            this.projectManager.updateSelectedSources(this.appState.getSelectedSources());
        });
        
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_DESELECTED, (e) => {
            console.log('📡 AppEvents: Source deselected', e.detail);
            // Update report builder when sources are deselected
            if (this.appState.getMode() === 'report') {
                const reportBuilderElement = this.reportBuilder.show();
                this.addMessage('system', reportBuilderElement);
            }
            // Update project store with selected sources
            this.projectManager.updateSelectedSources(this.appState.getSelectedSources());
        });
        
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_UNLOCKED, (e) => {
            console.log('📡 AppEvents: Source unlocked', e.detail);
        });
        
        AppEvents.addEventListener(EVENT_TYPES.BUDGET_WARNING, (e) => {
            console.log('📡 AppEvents: Budget warning', e.detail);
            this.toastManager.show(e.detail.warning, 'warning');
        });
        
        AppEvents.addEventListener(EVENT_TYPES.TIER_PURCHASED, (e) => {
            console.log('📡 AppEvents: Tier purchased', e.detail);
        });
        
        // Handle project switching - load conversation history for the project
        AppEvents.addEventListener(EVENT_TYPES.PROJECT_SWITCHED, async (e) => {
            console.log('📡 AppEvents: Project switched', {
                projectId: e.detail.projectData.id,
                projectTitle: e.detail.projectData.title
            });
            
            // Load messages for this project
            await this.loadProjectMessages(e.detail.projectData.id, e.detail.projectData.title);
        });
        
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
                try {
                    console.log('🔐 Auth success callback started:', type);
                    
                    // Close the auth modal
                    this.modalController.closeAuthModal();
                    
                    // Show success toast
                    this.toastManager.show(`Welcome! Successfully ${type === 'login' ? 'logged in' : 'signed up'}.`, 'success');

                    // Fetch wallet balance from API
                    console.log('💰 Fetching wallet balance...');
                    await this.authService.updateWalletBalance();
                    console.log('💰 Wallet balance updated:', this.authService.getWalletBalance());
                    
                    // Auto-trigger funding modal if balance is $0
                    if (this.authService.isAuthenticated() && this.authService.getWalletBalance() === 0) {
                        setTimeout(() => {
                            this.modalController.showFundingModal();
                        }, 500);
                    }
                    
                    // Execute any pending tab state action
                    const pendingTabAction = this.appState.getPendingAction();
                    if (pendingTabAction) {
                        console.log('🔄 Executing pending tab action after login:', pendingTabAction);
                        
                        if (pendingTabAction.type === 'mode_switch') {
                            this.setMode(pendingTabAction.mode);
                        }
                        
                        this.appState.clearPendingAction();
                    }
                    
                    // Update UI with wallet balance
                    console.log('🎨 Updating auth button UI...');
                    this.updateAuthButton();
                    console.log('✅ Auth success callback completed');
                    
                    // Dispatch auth state changed event for project manager
                    AppEvents.dispatchEvent(new CustomEvent('authStateChanged', {
                        detail: { isAuthenticated: true }
                    }));
                } catch (error) {
                    console.error('❌ Error in auth success callback:', error);
                    // Don't throw - just log and update UI anyway
                    try {
                        this.updateAuthButton();
                    } catch (uiError) {
                        console.error('❌ Failed to update auth button:', uiError);
                    }
                }
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
                onClearConversation: () => this.interactionHandler.clearConversation(
                    (sender, content) => this.addMessage(sender, content),
                    () => this.reportBuilder.update()
                ),
                onDarkModeToggle: () => this.interactionHandler.toggleDarkMode(),
                onAuthButtonClick: () => this.handleAuthButtonClick(),
                onCitationBadgeClick: (sourceId, price) => this.interactionHandler.handleCitationClick(sourceId, price),
                onFeedbackSubmit: (query, sourceIds, rating, mode, feedbackSection) => 
                    this.messageCoordinator.submitFeedback(query, sourceIds, rating, mode, feedbackSection),
                onResearchSuggestion: (topicHint) => this.interactionHandler.handleResearchSuggestion(
                    topicHint,
                    (mode) => this.setMode(mode)
                ),
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
            
            // Validate token and fetch balance if authenticated
            const isAuthenticated = this.authService.isAuthenticated();
            
            if (isAuthenticated && this.authService.isAuthenticated()) {
                // Fetch wallet balance from API before updating UI
                await this.authService.updateWalletBalance();
            }
            
            // Update auth UI after balance is fetched (or if not authenticated)
            this.updateAuthButton();
            
            // Also update wallet display if authenticated
            if (this.authService.isAuthenticated()) {
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }
            
            // Show onboarding modal for first-time users
            const onboarding = new OnboardingModal();
            onboarding.show();
            
            // Initialize project manager
            await this.projectManager.init();
        } catch (error) {
            console.error('Error initializing app:', error);
            this.addMessage('system', 'Application initialization failed. Please refresh the page.');
        }
    }

    async sendMessage() {
        const chatInput = document.getElementById('newChatInput');
        const message = chatInput?.value?.trim();
        
        if (!message) return;
        
        const currentMode = this.appState.getMode();
        
        // Auto-switch to Chat mode if query submitted from Report Builder
        if (currentMode === 'report') {
            console.log('🔄 Query from Report Builder detected - switching to Chat mode');
            this.setMode('chat');
        }

        try {
            // Auto-create project from first query if user has no projects
            await this.projectManager.ensureActiveProject(message);
            
            // Track search/message
            analytics.trackSearch(message, currentMode);
            analytics.trackChatMessage(message.length, currentMode);
            
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
                
                // Display immediate source cards using SourceManager
                const cardsResult = await this.sourceManager.displayCards(response.research_data.sources);
                if (cardsResult) {
                    // First add the message with source cards
                    this.addMessage('assistant', cardsResult.element, cardsResult.metadata);
                    
                    // Then append feedback AFTER message is in DOM (avoids serialization loss)
                    const lastMsg = document.querySelector('#messagesContainer .message:last-child .message__body');
                    if (lastMsg) {
                        const feedbackSection = this.messageCoordinator.createFeedback(response.research_data.sources);
                        lastMsg.appendChild(feedbackSection);
                    }
                }
                
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
        
        // Check authentication for report builder mode
        if (mode === 'report' && !this.authService.isAuthenticated()) {
            // Save pending mode switch and show login modal
            this.appState.setPendingAction({ 
                type: 'mode_switch', 
                mode: 'report' 
            });
            this.modalController.showAuthModal();
            return;
        }
        
        const modeChanged = this.appState.setMode(mode);
        if (!modeChanged) return;

        // Track mode switch
        analytics.trackModeSwitch(mode);

        this.uiManager.updateModeDisplay();
        
        // Handle mode-specific UI changes
        if (mode === 'report' && this.appState.getCurrentResearchData()) {
            this.addMessage('system', '📊 Switched to Report Builder - Generate professional research reports from your selected sources.');
            const reportBuilderElement = this.reportBuilder.show();
            this.addMessage('system', reportBuilderElement);
        } else {
            // Add mode change message if there's history
            if (this.appState.getConversationHistory().length > 0) {
                const modeMessages = {
                    'chat': "💬 Switched to Chat mode - Let's explore your interests through natural conversation.",
                    'research': "📚 Switched to Sources mode - I'll find and license authoritative sources."
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
        
        // Save message to backend if there's an active project
        this.saveMessageToProject(sender, stateContent, metadata);
        
        return message;
    }
    
    async saveMessageToProject(sender, content, metadata) {
        try {
            // Skip saving if we're restoring messages from database
            if (this.isRestoringMessages) {
                return;
            }
            
            const activeProjectId = this.projectManager.getActiveProjectId();
            
            if (!activeProjectId) {
                // No active project, skip saving
                return;
            }
            
            // Normalize sender type for consistency
            // Frontend uses 'assistant' but backend expects 'ai'
            const normalizedSender = sender === 'assistant' ? 'ai' : sender;
            
            // Only save user, ai, and system messages (skip ephemeral UI elements)
            if (!['user', 'ai', 'system'].includes(normalizedSender)) {
                return;
            }
            
            // Ensure content is a string (should already be serialized by addMessage)
            if (typeof content !== 'string') {
                console.warn(`⚠️ Non-string content passed to saveMessageToProject, skipping:`, typeof content);
                return;
            }
            
            const messageData = metadata ? { metadata } : null;
            
            await this.apiService.saveMessage(activeProjectId, normalizedSender, content, messageData);
            console.log(`💾 Message saved to project ${activeProjectId}`);
        } catch (error) {
            console.error('Failed to save message to project:', error);
            // Don't throw - message already displayed to user
        }
    }
    
    async loadProjectMessages(projectId, projectTitle) {
        try {
            console.log(`📥 Loading messages for project ${projectId}...`);
            
            // Clear current conversation display (skip confirmation)
            this.appState.clearConversation();
            this.uiManager.clearConversationDisplay();
            this.sourceManager.updateSelectionUI();
            this.reportBuilder.update();
            
            // Fetch messages from backend
            const response = await this.apiService.getProjectMessages(projectId);
            const messages = response.messages || [];
            
            console.log(`📥 Loaded ${messages.length} messages for project ${projectId}`);
            
            if (messages.length === 0) {
                // Show welcome message for empty project (don't save it)
                this.isRestoringMessages = true;
                this.addMessage('system', `🎯 Welcome to "${projectTitle}". Start your research here.`);
                this.isRestoringMessages = false;
            } else {
                // Restore messages to chat interface (without saving them again)
                this.isRestoringMessages = true;
                
                for (const msg of messages) {
                    // Add message to state and UI
                    const metadata = msg.message_data?.metadata || null;
                    const message = this.appState.addMessage(msg.sender, msg.content, metadata);
                    this.uiManager.addMessageToChat(message);
                }
                
                this.isRestoringMessages = false;
                console.log(`✅ Restored ${messages.length} messages to chat interface`);
            }
            
            this.hideWelcomeScreen();
            
        } catch (error) {
            console.error('Failed to load project messages:', error);
            this.addMessage('system', `Failed to load conversation history for this project. Starting fresh.`);
        }
    }
    
    hideWelcomeScreen() {
        this.interactionHandler.hideWelcome();
    }

    // Authentication methods
    async handleAuthButtonClick() {
        this.modalController.showAuthModal();
    }

    updateAuthButton() {
        try {
            const loginButton = document.getElementById('loginButton');
            const profileDropdown = document.getElementById('profileDropdown');
            
            if (!loginButton || !profileDropdown) {
                console.warn('⚠️ Auth button elements not found in DOM');
                return;
            }
            
            if (this.authService.isAuthenticated()) {
                // Hide login button, show profile dropdown
                loginButton.style.display = 'none';
                profileDropdown.style.display = 'block';
                
                // Update profile display
                const initials = document.getElementById('userInitials');
                const balance = document.getElementById('userBalance');
                
                const userInfo = this.authService.getUserInfo();
                const userInitials = this.authService.getUserInitials();
                const walletBalance = this.authService.getWalletBalance();
                
                console.log('Updating profile UI:', {
                    userInfo,
                    initials: userInitials,
                    balance: walletBalance
                });
                
                if (initials) {
                    initials.textContent = userInitials || 'RI';
                    console.log('Set initials to:', userInitials);
                } else {
                    console.warn('⚠️ userInitials element not found');
                }
                
                if (balance) {
                    const safeBalance = Number(walletBalance) || 0;
                    balance.textContent = `$${safeBalance.toFixed(2)}`;
                    console.log('Set balance to:', safeBalance);
                } else {
                    console.warn('⚠️ userBalance element not found');
                }
                
                // Add dropdown functionality
                try {
                    this.setupProfileDropdown();
                } catch (dropdownError) {
                    console.error('⚠️ Error setting up profile dropdown:', dropdownError);
                }
            } else {
                // Show login button, hide profile dropdown
                loginButton.style.display = 'block';
                profileDropdown.style.display = 'none';
            }
        } catch (error) {
            console.error('❌ Error in updateAuthButton:', error);
            // Don't throw - just log the error
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
            if (authTitle) authTitle.textContent = 'Login to Clearcite';
        } else {
            if (loginButton) loginButton.textContent = 'Sign Up';
            if (authToggleButton) authToggleButton.textContent = 'Have an account? Login';
            if (authTitle) authTitle.textContent = 'Create Clearcite Account';
        }
    }

    async executePendingAction() {
        const action = this.appState.getPendingAction();
        if (!action) return;
        
        this.appState.clearPendingAction();
        
        try {
            if (action.type === 'source_unlock') {
                await this.sourceManager.unlockSource(action.button, action.sourceId, action.price);
            } else if (action.type === 'tier_purchase') {
                await this.tierManager.purchaseTier(action.button, action.tierId, action.price);
            } else if (action.type === 'mode_switch') {
                // Switch to the pending mode after login
                this.setMode(action.mode);
            }
        } catch (error) {
            console.error('Error executing pending action:', error);
            this.addMessage('system', 'Failed to complete the action. Please try again.');
        }
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
