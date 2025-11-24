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
import { ProjectsController } from './controllers/projects-controller.js';
import { MobileNavigation } from './components/mobile-navigation.js';
import { ProjectsDropdown } from './components/projects-dropdown.js';
import { AppEvents, EVENT_TYPES } from './utils/event-bus.js';
import { analytics } from './utils/analytics.js';
import { summaryPopover } from './components/summary-popover.js';
import { projectStore } from './state/project-store.js';

// SourceCard and SummaryPopover loaded globally - access them dynamically when needed
window.summaryPopover = summaryPopover;

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
        
        // Initialize projects controller (handles all project/outline orchestration)
        this.projectsController = new ProjectsController();
        
        // Initialize projects dropdown menu
        this.projectsDropdown = new ProjectsDropdown();
        
        // Initialize sources panel
        if (window.SourcesPanel) {
            this.sourcesPanel = new window.SourcesPanel(this.appState, projectStore, this.authService, this.apiService, this.toastManager);
        }
        
        // Initialize mobile navigation for responsive mobile experience
        this.mobileNavigation = new MobileNavigation();
        
        // Setup ReportBuilder event listeners
        this.reportBuilder.addEventListener('reportGenerated', (e) => {
            const { reportData, tier, sourceCount } = e.detail;
            const message = this.reportBuilder.displayReport(reportData);
            if (message) {
                this.addMessage(message.sender, message.content, message.metadata);
                // Auto-scroll to top of the newly generated report
                this._scrollToLastMessage();
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
            const { tier, price, query, button, useSelectedSources, quoteUnavailable } = e.detail;
            this.tierManager.purchaseTier(button, tier, price, query, useSelectedSources, quoteUnavailable);
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
            
            // Add success message BEFORE scrolling so it doesn't become the scroll target
            this.addMessage('system', '✅ AI research report generated successfully!');
            
            // Auto-scroll to the report (second-to-last message now)
            if (message) {
                this._scrollToSecondLastMessage();
            }
        });
        
        this.tierManager.addEventListener('purchaseError', (e) => {
            this.addMessage('system', e.detail.message);
        });
        
        // Setup centralized AppEvents bus listeners for cross-component coordination
        // Note: Project-related events (SOURCE_SELECTED, SOURCE_DESELECTED, PROJECT_SWITCHED) 
        // are now handled by ProjectsController
        
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
        
        // Listen for Build Research Packet event from OutlineBuilder
        AppEvents.addEventListener('buildResearchPacket', (e) => {
            console.log('📡 AppEvents: Build Research Packet triggered', e.detail);
            
            // Get deduplicated sources from outline (same logic as report-builder.js)
            const outlineSnapshot = projectStore.getOutlineSnapshot();
            const sourceMap = new Map();
            
            if (outlineSnapshot && outlineSnapshot.sections) {
                outlineSnapshot.sections.forEach(section => {
                    if (section.sources && Array.isArray(section.sources)) {
                        section.sources.forEach(source => {
                            if (source && source.id && !sourceMap.has(source.id)) {
                                sourceMap.set(source.id, source);
                            }
                        });
                    }
                });
            }
            
            const sources = Array.from(sourceMap.values());
            const sourceCount = sources.length;
            const price = sourceCount * 0.05; // $0.05 per source (Pro tier only)
            const query = this.appState.getCurrentQuery() || projectStore.getResearchQuery() || "Research Query";
            const useSelectedSources = sources.length > 0;
            
            // Validate we have sources before launching modal
            if (!useSelectedSources) {
                console.warn('⚠️ No sources in outline - cannot launch purchase modal');
                this.addMessage('system', 'Please add sources to your outline before generating a report.');
                return;
            }
            
            console.log(`💰 Launching purchase modal - ${sourceCount} source${sourceCount !== 1 ? 's' : ''} at $${price.toFixed(2)}`);
            
            // Call tierManager.purchaseTier() directly with Pro tier
            // Note: Passing null for button bypasses some UI state handling
            this.tierManager.purchaseTier(null, 'pro', price, query, useSelectedSources, false);
        });
        
        // Guard to prevent duplicate search triggers during login flow
        this.pendingSearchFromLogin = false;
        
        // FIX B: Global listener for SOURCE_SEARCH_TRIGGER - fires search from any entry point
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_SEARCH_TRIGGER, (e) => {
            console.log('📡 AppEvents: SOURCE_SEARCH_TRIGGER received', e.detail);
            const query = e.detail?.query || this.appState.getCurrentQuery();
            if (query && query.trim()) {
                // Guard: Skip if search was already fired from setMode during login flow
                if (this.pendingSearchFromLogin) {
                    console.log('⏭️ SOURCE_SEARCH_TRIGGER: Skipping - search already fired from setMode');
                    this.pendingSearchFromLogin = false; // reset flag
                    return;
                }
                
                // Populate input with query and trigger send
                const chatInput = document.getElementById('newChatInput');
                if (chatInput) {
                    chatInput.value = query;
                    this.sendMessage();
                }
            } else {
                console.log('⚠️ SOURCE_SEARCH_TRIGGER: No query available to search');
            }
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
                    
                    // Update UI with wallet balance
                    console.log('🎨 Updating auth button UI...');
                    this.updateAuthButton();
                    
                    // NOTE: Project creation and loading moved to ProjectManager.handleLogin()
                    // to prevent race conditions and duplicate migrations. The authStateChanged
                    // event will trigger handleLogin() which preserves chat and creates project.
                    
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
                            // Set guard flag to prevent duplicate search from SOURCE_SEARCH_TRIGGER
                            if (pendingTabAction.mode === 'research') {
                                this.pendingSearchFromLogin = true;
                            }
                            this.setMode(pendingTabAction.mode);
                        }
                        
                        this.appState.clearPendingAction();
                    }
                    
                    console.log('✅ Auth success callback completed');
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
                onClearConversation: () => this.interactionHandler.clearConversation(
                    (sender, content) => this.addMessage(sender, content),
                    () => this.reportBuilder.update()
                ),
                onDarkModeToggle: () => this.interactionHandler.toggleDarkMode(),
                onAuthButtonClick: () => this.handleAuthButtonClick(),
                onCitationBadgeClick: (sourceId, price) => this.interactionHandler.handleCitationClick(sourceId, price),
                onFeedbackSubmit: (query, sourceIds, rating, mode, feedbackSection) => 
                    this.messageCoordinator.submitFeedback(query, sourceIds, rating, mode, feedbackSection),
                onResearchSuggestion: (topicHint, autoExecute) => this.interactionHandler.handleResearchSuggestion(
                    topicHint,
                    null,
                    autoExecute,
                    () => this.sendMessage(),
                    this.authService
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
            
            // Attach projects controller with all dependencies
            await this.projectsController.attach({
                apiService: this.apiService,
                authService: this.authService,
                toastManager: this.toastManager,
                appState: this.appState,
                uiManager: this.uiManager,
                reportBuilder: this.reportBuilder,
                sourceManager: this.sourceManager,
                messageCoordinator: this.messageCoordinator,
                sourcesPanel: this.sourcesPanel,  // Pass sourcesPanel for project lifecycle management
                addMessageCallback: (sender, content, metadata) => this.addMessage(sender, content, metadata),
                hideWelcomeCallback: () => this.hideWelcomeScreen()
            });
            
            // Initialize dropdown AFTER projectsController so DOM is ready
            // Wait a tick for any dynamic DOM updates to complete
            await new Promise(resolve => setTimeout(resolve, 0));
            this.projectsDropdown.init();
            
            // Wire project count updates from sidebar to dropdown badge
            const sidebar = this.projectsController.projectManager?.sidebar;
            if (sidebar) {
                sidebar.addEventListener('projectCountUpdated', (e) => {
                    console.log('📊 Project count updated:', e.detail.count);
                    this.projectsDropdown.updateCount(e.detail.count);
                });
                
                // Initialize count to current project count
                const currentCount = sidebar.projects?.length || 0;
                this.projectsDropdown.updateCount(currentCount);
            }
        } catch (error) {
            console.error('Error initializing app:', error);
            this.addMessage('system', 'Application initialization failed. Please refresh the page.');
        }
    }

    async sendMessage() {
        const chatInput = document.getElementById('newChatInput');
        const message = chatInput?.value?.trim();
        
        if (!message) return;
        
        try {
            // Auto-create project from first query if user has no projects
            await this.projectsController.ensureActiveProject(message);
            
            // Everyone defaults to conversational chat mode
            // Sources are only searched when explicitly requested (button click or intent detection)
            const isAuthenticated = this.authService.isAuthenticated();
            const mode = 'chat'; // Always use chat mode for regular messages
            console.log(`💬 Chat mode: isAuthenticated=${isAuthenticated}, mode=${mode}`);
            
            // Track search/message
            analytics.trackSearch(message, mode);
            analytics.trackChatMessage(message.length, mode);
            
            // Clear input and show user message
            chatInput.value = '';
            this.uiManager.updateCharacterCount();
            
            const userMessage = this.addMessage('user', message);
            this.appState.setCurrentQuery(message);
            
            // Show typing indicator
            this.uiManager.showTypingIndicator();
            
            // Always use conversational chat endpoint with conversation context
            const conversationContext = this.appState.getConversationHistory();
            const response = await this.apiService.sendMessage(message, mode, conversationContext);
            
            // Hide typing indicator
            this.uiManager.hideTypingIndicator();
            
            // Display response
            if (response.content) {
                this.addMessage('assistant', response.content, response.metadata);
                
                // Add appropriate CTA based on authentication status
                const lastMsg = document.querySelector('#messagesContainer .message:last-child .message__body');
                if (lastMsg) {
                    if (!isAuthenticated) {
                        // Anonymous users: encourage login to access sources
                        const loginPrompt = document.createElement('div');
                        loginPrompt.className = 'anonymous-chat-prompt';
                        loginPrompt.innerHTML = `
                            <p class="prompt-text">
                                Want to search for authoritative sources? 
                                <button id="promptLoginButton" class="login-button">Log in</button> 
                                to find sources on this topic.
                            </p>
                        `;
                        lastMsg.appendChild(loginPrompt);
                        
                        // Attach login click handler
                        const loginButton = loginPrompt.querySelector('#promptLoginButton');
                        if (loginButton) {
                            loginButton.addEventListener('click', (e) => {
                                e.preventDefault();
                                this.modalController.showAuthModal();
                            });
                        }
                    } else {
                        // Authenticated users: show "Find Sources" button
                        const sourcesPrompt = document.createElement('div');
                        sourcesPrompt.className = 'find-sources-prompt';
                        sourcesPrompt.innerHTML = `
                            <button id="findSourcesButton" class="find-sources-button">
                                <span class="icon">🔍</span>
                                Find Authoritative Sources
                            </button>
                        `;
                        lastMsg.appendChild(sourcesPrompt);
                        
                        // Attach source search handler
                        const findSourcesButton = sourcesPrompt.querySelector('#findSourcesButton');
                        if (findSourcesButton) {
                            findSourcesButton.addEventListener('click', async (e) => {
                                e.preventDefault();
                                await this.triggerSourceSearch();
                            });
                        }
                    }
                }
                
                // INTENT DETECTION: Auto-trigger source search if backend detected intent
                if (isAuthenticated && response.metadata?.source_search_requested) {
                    console.log(`🧠 Intent detected: source_search_requested=true (confidence=${response.metadata.source_confidence})`);
                    console.log(`🔍 Auto-triggering source search with query: "${response.metadata.source_query}"`);
                    
                    // Small delay to let user see the assistant's response first
                    setTimeout(async () => {
                        try {
                            await this.triggerSourceSearch(response.metadata.source_query);
                        } catch (error) {
                            console.error('Failed to auto-trigger source search:', error);
                        }
                    }, 500);
                }
            }
            
            // Handle research data with progressive loading
            if (response.research_data) {
                // Backend is single source of truth for enrichment status
                this.appState.setCurrentResearchData(response.research_data);
                
                // Route sources to SourcesPanel instead of chat
                if (response.research_data.sources && response.research_data.sources.length > 0) {
                    const sourceCount = response.research_data.sources.length;
                    
                    // Send sources to SourcesPanel
                    if (this.sourcesPanel) {
                        this.sourcesPanel.handleNewSources(response.research_data.sources);
                    }
                    
                    // Add simple confirmation message to chat
                    this.addMessage('assistant', `Found ${sourceCount} sources. Check the Sources panel to review and select sources for your research.`);
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

    async triggerSourceSearch(intentQuery = null) {
        console.log('🔍 User requested source search via button or intent detection');
        
        try {
            // Show typing indicator
            this.uiManager.showTypingIndicator();
            
            // Get conversation context and current query
            const conversationContext = this.appState.getConversationHistory();
            // Use intent query if provided, otherwise fall back to current query
            const currentQuery = intentQuery || this.appState.getCurrentQuery() || 'Find sources on this topic';
            
            // Call research endpoint with full conversation context
            const response = await this.apiService.analyzeResearchQuery(currentQuery, conversationContext);
            
            // Hide typing indicator
            this.uiManager.hideTypingIndicator();
            
            // Handle research data (send sources to SourcesPanel)
            if (response.research_data) {
                this.appState.setCurrentResearchData(response.research_data);
                
                // Route sources to SourcesPanel instead of chat
                if (response.research_data.sources && response.research_data.sources.length > 0) {
                    const sourceCount = response.research_data.sources.length;
                    
                    // Send sources to SourcesPanel
                    if (this.sourcesPanel) {
                        this.sourcesPanel.handleNewSources(response.research_data.sources);
                    }
                    
                    // Add simple confirmation message to chat
                    this.addMessage('assistant', `Found ${sourceCount} sources. Check the Sources panel to review and select sources for your research.`);
                }
            }
            
        } catch (error) {
            console.error('❌ Error triggering source search:', error);
            this.uiManager.hideTypingIndicator();
            this.addMessage('system', `Sorry, I couldn't search for sources: ${error.message}`);
        }
    }

    setMode(mode) {
        console.log(`⚠️ setMode called with '${mode}' but mode switching is disabled - everything stays in chat mode`);
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
        this.projectsController.saveMessageToProject(sender, stateContent, metadata);
        
        return message;
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

    /**
     * Scrolls to the top of the last message in the chat
     * Used for report generation to show the report header
     * @private
     */
    _scrollToLastMessage() {
        // Small delay to ensure DOM has updated
        setTimeout(() => {
            const messagesContainer = document.getElementById('messagesContainer');
            if (!messagesContainer) return;
            
            const messages = messagesContainer.querySelectorAll('.message');
            if (messages.length === 0) return;
            
            const lastMessage = messages[messages.length - 1];
            
            // Scroll to top of the message (not bottom) so user sees the report header first
            lastMessage.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start',
                inline: 'nearest'
            });
        }, 100);
    }

    /**
     * Scrolls to the second-to-last message in the chat
     * Used when a success message is added after the report
     * @private
     */
    _scrollToSecondLastMessage() {
        // Small delay to ensure DOM has updated
        setTimeout(() => {
            const messagesContainer = document.getElementById('messagesContainer');
            if (!messagesContainer) return;
            
            const messages = messagesContainer.querySelectorAll('.message');
            if (messages.length < 2) return;
            
            const reportMessage = messages[messages.length - 2];
            
            // Scroll to top of the report message so user sees the report header first
            reportMessage.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start',
                inline: 'nearest'
            });
        }, 100);
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
