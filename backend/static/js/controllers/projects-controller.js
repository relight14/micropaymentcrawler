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
        console.log('📦 ProjectsController: Attaching with dependencies...');
        this.dependencies = deps;
        
        // Set callbacks BEFORE initialization to avoid missing early events
        this.addMessageCallback = deps.addMessageCallback;
        this.hideWelcomeCallback = deps.hideWelcomeCallback;
        
        // Create and initialize ProjectManager
        this.projectManager = new ProjectManager({
            apiService: deps.apiService,
            authService: deps.authService,
            toastManager: deps.toastManager
        });
        
        // Set up all event listeners
        this.setupEventListeners();
        console.log('📦 ProjectsController: Event listeners set up');
        
        // Initialize the project manager
        await this.projectManager.init();
        console.log('📦 ProjectsController: ProjectManager initialized');
    }

    /**
     * Set up all event listeners for project-related operations
     */
    setupEventListeners() {
        const { appState, uiManager, reportBuilder, sourceManager } = this.dependencies;

        // SOURCE_SELECTED: Update project store when sources are selected
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_SELECTED, (e) => {
            console.log('📡 AppEvents: Source selected', e.detail);
            // Update report builder when sources are selected
            if (appState.getMode() === 'report') {
                const reportBuilderElement = reportBuilder.show();
                this._addMessage('system', reportBuilderElement);
            }
            // Update project store with selected sources
            this.projectManager.updateSelectedSources(appState.getSelectedSources());
        });

        // SOURCE_DESELECTED: Update project store when sources are deselected
        AppEvents.addEventListener(EVENT_TYPES.SOURCE_DESELECTED, (e) => {
            console.log('📡 AppEvents: Source deselected', e.detail);
            // Update report builder when sources are deselected
            if (appState.getMode() === 'report') {
                const reportBuilderElement = reportBuilder.show();
                this._addMessage('system', reportBuilderElement);
            }
            // Update project store with selected sources
            this.projectManager.updateSelectedSources(appState.getSelectedSources());
        });

        // SOURCE_SELECTION_CHANGED: Sync appState selections to ProjectStore
        document.addEventListener('sourceSelectionChanged', (e) => {
            console.log('📡 Source selection changed:', e.detail);
            this.projectManager.updateSelectedSources(appState.getSelectedSources());
        });

        // PROJECT_SWITCHED: Load conversation history for the project
        AppEvents.addEventListener(EVENT_TYPES.PROJECT_SWITCHED, async (e) => {
            console.log('📡 AppEvents: Project switched', {
                projectId: e.detail.projectData.id,
                projectTitle: e.detail.projectData.title
            });
            
            // Load messages for this project
            await this.loadProjectMessages(e.detail.projectData.id, e.detail.projectData.title);
        });

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
     * Load messages for a specific project
     * @param {string} projectId - Project ID
     * @param {string} projectTitle - Project title
     */
    async loadProjectMessages(projectId, projectTitle) {
        try {
            const { appState, uiManager, sourceManager, reportBuilder, apiService } = this.dependencies;
            
            // Clear current conversation display (skip confirmation)
            appState.clearConversation();
            uiManager.clearConversationDisplay();
            sourceManager.updateSelectionUI();
            reportBuilder.update();
            
            // Fetch messages from backend
            const response = await apiService.getProjectMessages(projectId);
            const messages = response.messages || [];
            
            console.log(`📥 Loaded ${messages.length} messages for project ${projectId}`);
            
            if (messages.length === 0) {
                // Show welcome message for empty project (don't save it)
                this.isRestoringMessages = true;
                this._addMessage('system', `🎯 Welcome to "${projectTitle}". Start your research here.`);
                this.isRestoringMessages = false;
            } else {
                // Restore messages to chat interface (without saving them again)
                this.isRestoringMessages = true;
                
                // Track the most recent research data while restoring messages
                let mostRecentResearchData = null;
                
                for (const msg of messages) {
                    // Add message to state and UI
                    const metadata = msg.message_data?.metadata || null;
                    const content = msg.content;
                    
                    // Add to appState with original string content (needed for .substring() calls)
                    // This normalizes "ai" → "assistant" and shapes metadata correctly
                    const message = appState.addMessage(msg.sender, content, metadata);
                    
                    // Delegate to MessageCoordinator for consistent rendering pipeline
                    // MessageCoordinator → UIManager → MessageRenderer
                    // IMPORTANT: Pass normalized message from AppState, not raw backend record
                    this.dependencies.messageCoordinator.restoreMessage(message, { skipPersist: true });
                    
                    // Extract research data from source cards metadata for restoration
                    if (metadata?.type === 'source_cards' && metadata?.sources) {
                        mostRecentResearchData = {
                            sources: metadata.sources,
                            query: metadata.query || '',
                            enrichment_status: 'complete'
                        };
                    }
                }
                
                // Restore the most recent research data to appState
                if (mostRecentResearchData) {
                    appState.setCurrentResearchData(mostRecentResearchData);
                    console.log(`✅ Restored research data with ${mostRecentResearchData.sources.length} sources`);
                }
                
                this.isRestoringMessages = false;
                console.log(`✅ Restored ${messages.length} messages to chat interface`);
            }
            
            // Hide welcome screen
            this._hideWelcomeScreen();
            
        } catch (error) {
            console.error('Failed to load project messages:', error);
            this._addMessage('system', `Failed to load conversation history for this project. Starting fresh.`);
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
