import { logger } from '../utils/logger.js';
/**
 * ProjectsController - Encapsulates all project and outline orchestration logic
 * Handles initialization, event wiring, and message persistence
 */

import { ProjectManager } from '../managers/project-manager.js';
import { AppEvents, EVENT_TYPES } from '../utils/event-bus.js';

export class ProjectsController {
    constructor() {
        this.projectManager = null;
        this.dependencies = null;
        this.isRestoringMessages = false;
    }

    /**
     * Attach the controller to the app with required dependencies
     * @param {Object} deps - Dependencies needed for project operations
     * @param {Object} deps.apiService - API service for backend communication
     * @param {Object} deps.authService - Authentication service
     * @param {Object} deps.toastManager - Toast notification manager
     * @param {Object} deps.appState - Application state manager
     * @param {Object} deps.uiManager - UI manager for rendering
     * @param {Object} deps.reportBuilder - Report builder component
     * @param {Object} deps.sourceManager - Source manager
     * @param {Function} deps.addMessageCallback - Callback for adding messages to chat
     * @param {Function} deps.hideWelcomeCallback - Callback for hiding welcome screen
     */
    async attach(deps) {
        logger.debug('📦 ProjectsController: Attaching with dependencies...');
        this.dependencies = deps;
        
        // Set callbacks BEFORE initialization to avoid missing early events
        this.addMessageCallback = deps.addMessageCallback;
        this.hideWelcomeCallback = deps.hideWelcomeCallback;
        
        // Create and initialize ProjectManager
        this.projectManager = new ProjectManager({
            apiService: deps.apiService,
            authService: deps.authService,
            toastManager: deps.toastManager,
            messageCoordinator: deps.messageCoordinator,
            appState: deps.appState,
            sourcesPanel: deps.sourcesPanel  // Pass sourcesPanel for project lifecycle management
        });
        
        // Set up all event listeners
        this.setupEventListeners();
        logger.debug('📦 ProjectsController: Event listeners set up');
        
        // Initialize the project manager
        await this.projectManager.init();
        logger.debug('📦 ProjectsController: ProjectManager initialized');
    }

    /**
     * Set up all event listeners for project-related operations
     */
    setupEventListeners() {
        const { appState, uiManager, reportBuilder, sourceManager } = this.dependencies;

        // SOURCE_SELECTED: Update project store when sources are selected
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_SELECTED, (e) => {
            logger.debug('📡 AppEvents: Source selected', e.detail);
            // Update project store with selected sources
            this.projectManager.updateSelectedSources(appState.getSelectedSources());
        });

        // SOURCE_DESELECTED: Update project store when sources are deselected
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_DESELECTED, (e) => {
            logger.debug('📡 AppEvents: Source deselected', e.detail);
            // Update project store with selected sources
            this.projectManager.updateSelectedSources(appState.getSelectedSources());
        });

        // SOURCE_SELECTION_CHANGED: Sync appState selections to ProjectStore
        document.addEventListener('sourceSelectionChanged', (e) => {
            logger.debug('📡 Source selection changed:', e.detail);
            this.projectManager.updateSelectedSources(appState.getSelectedSources());
        });

        // PROJECT_CREATED: Handle new project creation
        AppEvents.addEventListener(EVENT_TYPES.PROJECT_CREATED, async (e) => {
            const preserveConversation = e.detail?.preserveConversation || false;
            
            logger.debug('📡 AppEvents: New project created', {
                projectId: e.detail.project.id,
                projectTitle: e.detail.project.title,
                preserveConversation
            });
            
            const { appState, uiManager, sourceManager, reportBuilder, apiService } = this.dependencies;
            
            if (preserveConversation) {
                // Login migration flow: preserve in-memory chat and save to new project
                logger.debug('💾 Preserving conversation for login migration - saving messages to project');
                
                // Save all in-memory messages to the newly created project
                const messages = appState.getConversationHistory();
                if (messages && messages.length > 0) {
                    try {
                        // Save messages one by one to preserve order
                        for (const msg of messages) {
                            const normalizedSender = msg.sender === 'assistant' ? 'ai' : msg.sender;
                            if (['user', 'ai', 'system'].includes(normalizedSender)) {
                                await apiService.saveMessage(
                                    e.detail.project.id,
                                    normalizedSender,
                                    msg.content,
                                    msg.metadata ? { metadata: msg.metadata } : null
                                );
                            }
                        }
                        console.log(`✅ Saved ${messages.length} messages to project ${e.detail.project.id}`);
                    } catch (error) {
                        console.error('Failed to save conversation to project:', error);
                        this.dependencies.toastManager.show('⚠️ Some messages may not have been saved', 'warning');
                    }
                }
                
                // Don't clear chat - messages stay visible
                // Update UI components without clearing
                sourceManager.updateSelectionUI();
            } else {
                // Normal project creation: clear old messages and show welcome
                appState.clearConversation();
                uiManager.clearConversationDisplay();
                sourceManager.updateSelectionUI();
                
                // Show welcome message for new project (don't save it)
                this.isRestoringMessages = true;
                this._addMessage('system', `🎯 Welcome to "${e.detail.project.title}". Start your research here.`);
                this.isRestoringMessages = false;
            }
            
            // Hide welcome screen in both cases
            this._hideWelcomeScreen();
        });

        // PROJECT_LOADING_STARTED: Show loading UI immediately
        AppEvents.addEventListener(EVENT_TYPES.PROJECT_LOADING_STARTED, (e) => {
            const preserveConversation = e.detail?.preserveConversation || false;
            
            logger.debug('⚡ AppEvents: Project loading started', {
                projectId: e.detail.projectId,
                projectTitle: e.detail.projectTitle,
                preserveConversation
            });
            
            // Only clear chat for manual project switches, not login flow
            if (!preserveConversation) {
                const { appState, uiManager, sourceManager } = this.dependencies;
                appState.clearConversation();
                uiManager.clearConversationDisplay(true); // Show loading state
                sourceManager.updateSelectionUI();
            }
        });

        // PROJECT_SWITCHED: Message loading is now handled by ProjectManager
        // No additional action needed here - ProjectManager loads messages before emitting this event

        // AUTH_STATE_CHANGED: Already handled by ProjectManager internally via AppEvents
        // No need to duplicate here
    }

    /**
     * Ensure an active project exists before sending a message
     * Auto-creates a project from the first query if needed
     * @param {string} query - The user's query
     */
    async ensureActiveProject(query) {
        return await this.projectManager.ensureActiveProject(query);
    }

    /**
     * Save a message to the current active project
     * @param {string} sender - Message sender ('user', 'assistant', 'system')
     * @param {string} content - Message content (HTML string)
     * @param {Object} metadata - Optional message metadata
     */
    async saveMessageToProject(sender, content, metadata) {
        try {
            // Skip saving if we're restoring messages from database
            if (this.isRestoringMessages) {
                return;
            }
            
            // Skip saving if user is not authenticated
            if (!this.dependencies.authService.isAuthenticated()) {
                logger.debug('👤 User not authenticated - message displayed but not persisted');
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
            
            // Skip report builder UI (tier selection cards) - it's ephemeral and should regenerate fresh
            // Only filter DOM elements with tier-cards-section as root class, not text content mentioning it
            // Always preserve research reports (metadata.type === 'research_report')
            if (metadata?.type !== 'research_report' && content.startsWith('<')) {
                try {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = content;
                    const firstChild = tempDiv.firstElementChild;
                    if (firstChild && firstChild.classList.contains('tier-cards-section')) {
                        console.log(`⏭️ Skipping report builder UI persistence for project ${activeProjectId}`);
                        return;
                    }
                } catch (e) {
                    // If parsing fails, allow the content to be saved
                    console.warn('Failed to parse HTML for filtering, allowing save:', e);
                }
            }
            
            const messageData = metadata ? { metadata } : null;
            
            await this.dependencies.apiService.saveMessage(activeProjectId, normalizedSender, content, messageData);
            console.log(`💾 Message saved to project ${activeProjectId}`);
        } catch (error) {
            console.error('Failed to save message to project:', error);
            // Don't throw - message already displayed to user
        }
    }


    /**
     * Get the active project ID
     */
    getActiveProjectId() {
        return this.projectManager.getActiveProjectId();
    }

    /**
     * Get the active project
     */
    getActiveProject() {
        return this.projectManager.getActiveProject();
    }

    /**
     * Get outline snapshot for report generation
     */
    getOutlineSnapshot() {
        return this.projectManager.getOutlineSnapshot();
    }

    /**
     * Internal method to add a message (delegates to app)
     * This allows ProjectsController to trigger UI updates
     * @private
     */
    _addMessage(sender, content, metadata) {
        // Call back to the app's addMessage method
        // This will be set during attach()
        if (this.addMessageCallback) {
            return this.addMessageCallback(sender, content, metadata);
        }
    }

    /**
     * Internal method to hide welcome screen
     * @private
     */
    _hideWelcomeScreen() {
        if (this.hideWelcomeCallback) {
            this.hideWelcomeCallback();
        }
    }

}
