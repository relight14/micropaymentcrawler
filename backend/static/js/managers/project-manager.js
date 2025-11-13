/**
 * ProjectManager - Orchestration layer for project and outline functionality
 * Coordinates between ProjectStore, API, and UI components
 */

import { ProjectListSidebar } from '../components/project-sidebar.js';
import { OutlineBuilder } from '../components/outline-builder.js';
import { projectStore } from '../state/project-store.js';
import { AppEvents, EVENT_TYPES } from '../utils/event-bus.js';
import { analytics } from '../utils/analytics.js';
import { logger } from '../utils/logger.js';

export class ProjectManager {
    constructor({ apiService, authService, toastManager, messageCoordinator, appState }) {
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.messageCoordinator = messageCoordinator;
        this.appState = appState;
        
        // Create component instances
        this.sidebar = new ProjectListSidebar({ apiService, authService, toastManager });
        this.outlineBuilder = new OutlineBuilder({ apiService, authService, toastManager });
        
        // Track initialization state
        this.isInitialized = false;
        this.hasAutoCreatedProject = false;
        this.isLoadingProjects = false; // Guard flag to prevent duplicate loadProjects() calls
        this.pendingReload = false; // Flag to queue a retry if load is requested during active load
        this.hasMigratedLoginChat = false; // One-shot flag to prevent duplicate login migration
        this._autoCreateLock = false; // Mutex guard to prevent concurrent auto-create calls
    }

    /**
     * Initialize the project manager
     */
    async init() {
        if (this.isInitialized) return;

        // Set up component event listeners
        this.setupComponentListeners();

        // Set up store subscription
        this.setupStoreSubscription();

        // Initialize sidebar (renders mobile login prompt if not authenticated)
        await this.sidebar.init();

        // Initialize outline builder with persistent event delegation
        this.outlineBuilder.init();

        // Load initial data if authenticated
        if (this.authService.isAuthenticated()) {
            await this.loadInitialData();
        }

        this.isInitialized = true;
    }

    /**
     * Set up listeners for component events
     */
    setupComponentListeners() {
        // Project sidebar events
        this.sidebar.addEventListener('projectCreated', (e) => {
            const { project, preserveConversation = false } = e.detail;
            this.handleProjectCreated(project, { preserveConversation });
        });

        // Immediate UI update when project loading starts
        this.sidebar.addEventListener('projectLoadingStarted', (e) => {
            const { projectId, projectTitle, preserveConversation = false } = e.detail;
            this.handleProjectLoadingStarted(projectId, projectTitle, preserveConversation);
        });

        this.sidebar.addEventListener('projectLoaded', (e) => {
            const { projectData, preserveConversation = false } = e.detail;
            this.handleProjectLoaded(projectData, preserveConversation);
        });

        this.sidebar.addEventListener('projectDeleted', (e) => {
            this.handleProjectDeleted(e.detail.projectId);
        });

        // Listen to auth state changes
        AppEvents.addEventListener('authStateChanged', async (e) => {
            if (e.detail.isAuthenticated) {
                // Capture conversation history before loading projects
                await this.handleLogin();
            } else {
                this.handleLogout();
            }
        });
    }

    /**
     * Set up subscription to store changes
     */
    setupStoreSubscription() {
        projectStore.subscribe((newState, oldState) => {
            // Update components when store changes
            if (newState.selectedSources !== oldState.selectedSources) {
                this.outlineBuilder.setSelectedSources(newState.selectedSources);
            }
        });
    }

    /**
     * Load projects with guard to prevent duplicate concurrent calls
     * Uses queued retry pattern to ensure loads after project creation are not skipped
     * Single entry point for all project loading to avoid race conditions
     * Caps at 1 retry to prevent infinite loops
     */
    async loadProjectsWithGuard() {
        // If already loading, queue a retry instead of skipping
        if (this.isLoadingProjects) {
            logger.info(`📋 [ProjectManager] Already loading projects, queuing retry...`);
            this.pendingReload = true;
            return;
        }
        
        // Loop to handle queued retries (max 1 retry to prevent infinite loops)
        let reloadCount = 0;
        do {
            this.isLoadingProjects = true;
            this.pendingReload = false;
            
            try {
                logger.info(`📋 [ProjectManager] Loading projects...`);
                await this.sidebar.loadProjects();
                logger.info(`✅ [ProjectManager] Projects loaded successfully`);
            } catch (error) {
                logger.error('[ProjectManager] Error loading projects:', error);
                throw error;
            } finally {
                this.isLoadingProjects = false;
            }
            
            // If another call came in during load, retry once more (up to 1 retry)
            if (this.pendingReload && reloadCount < 1) {
                logger.info(`📋 [ProjectManager] Executing queued reload...`);
                reloadCount++;
            }
        } while (this.pendingReload && reloadCount < 1);
    }

    /**
     * Find existing project by normalized title
     */
    _findExistingProjectByTitle(title) {
        const norm = s => (s || '').toLowerCase().trim();
        const k = norm(title);
        const list = this.sidebar?.projects || projectStore.state.projects || [];
        return list.find(p => norm(p.title) === k) || null;
    }

    /**
     * Sync selected sources from AppState (sessionStorage) to ProjectStore (runtime)
     * Called during login to restore pre-login source selections
     */
    syncSelectedSourcesFromAppState() {
        const selectedSources = this.appState.getSelectedSources();
        projectStore.setSelectedSources(selectedSources);
        logger.info(`[Sync] Restored ${selectedSources.length} selected sources from session to ProjectStore`);
    }

    /**
     * Handle user login - triggered by authStateChanged event
     * Preserves pre-login chat and migrates it to a new project
     * Uses one-shot guard to prevent duplicate migration if event fires multiple times
     * ORDER: Load projects first → Migrate if needed → Sync store → Auto-load new project
     */
    async handleLogin() {
        logger.info(`🔐 [ProjectManager] Auth state changed to authenticated`);
        
        // Preserve chat BEFORE anything else
        const preLoginChat = this.appState.getConversationHistory();
        const hasPreLoginChat = !!(preLoginChat && preLoginChat.length);
        let newProjectId = null;
        
        // Optimistic UI (cached projects) to avoid blank flash
        if (projectStore.state.projects?.length) {
            this.sidebar.projects = projectStore.state.projects;
            this.sidebar.render();
        }
        
        // 1) Load projects first so we can dedupe against them
        await this.loadProjectsWithGuard();
        projectStore.setProjects(this.sidebar.projects); // sync store NOW
        
        // 1.5) Sync selected sources from session storage to ProjectStore
        this.syncSelectedSourcesFromAppState();
        
        // 2) One-shot guarded migration
        if (hasPreLoginChat && !this.hasMigratedLoginChat) {
            this.hasMigratedLoginChat = true;
            this.toastManager.show('💾 Syncing your research...', 'info');
            
            try {
                // derive candidate title
                const firstUserMessage = preLoginChat.find(m => m.sender === 'user');
                const candidateTitle = this._extractProjectTitle(firstUserMessage?.content);
                
                // If a project with the same title exists, reuse it
                const existing = this._findExistingProjectByTitle(candidateTitle);
                if (existing) {
                    newProjectId = existing.id;
                    this.toastManager.show(`🔁 Opening existing project "${existing.title}"`, 'info');
                    // Will be loaded later in the common loadProject() call
                } else {
                    const project = await this.createProjectFromConversation(preLoginChat);
                    if (project) {
                        newProjectId = project.id;
                        this.toastManager.show(`💾 Saved to "${project.title}"`, 'success');
                    }
                }
            } catch (err) {
                logger.error('Failed to migrate login chat:', err);
                this.hasMigratedLoginChat = false; // allow retry on next login
            }
        }
        
        // 3) If we created or found one, load it WITH preserveConversation flag
        if (newProjectId) {
            await this.sidebar.loadProject(newProjectId, { preserveConversation: true });
        }
        
        // 4) Check for pending source search from Find Sources button
        const pendingSearch = sessionStorage.getItem('pendingSourceSearch');
        if (pendingSearch) {
            try {
                const { query, mode } = JSON.parse(pendingSearch);
                sessionStorage.removeItem('pendingSourceSearch'); // Clear immediately
                
                if (query && query.trim()) {
                    logger.info('🔍 Processing pending source search after login:', query);
                    
                    // Switch to research mode if needed
                    if (mode === 'research' && this.appState.getMode() !== 'research') {
                        this.appState.setMode('research');
                    }
                    
                    // Dispatch source search trigger
                    AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.SOURCE_SEARCH_TRIGGER, {
                        detail: { query }
                    }));
                }
            } catch (err) {
                logger.error('Failed to process pending source search:', err);
                sessionStorage.removeItem('pendingSourceSearch');
            }
        }
    }

    /**
     * Create project from conversation (used after login)
     * @param {Array} conversationHistory - Optional pre-captured conversation to avoid race conditions
     * @returns {Promise<Object|null>} Created project or null if failed
     */
    async createProjectFromConversation(conversationHistory = null) {
        try {
            // Use passed conversation or fetch from appState (fallback for legacy calls)
            const conversation = conversationHistory || this.appState.getConversationHistory();
            
            if (!conversation || conversation.length === 0) {
                logger.info(`ℹ️  No conversation to save`);
                return null;
            }
            
            // Filter to user/assistant messages only
            const messagesToSave = conversation.filter(msg => 
                msg.sender === 'user' || msg.sender === 'assistant' || msg.sender === 'ai'
            );
            
            if (messagesToSave.length === 0) {
                logger.info(`ℹ️  No user/assistant messages to save`);
                return null;
            }
            
            logger.info(`💾 Creating project from ${messagesToSave.length} messages...`);
            
            // Extract project title from first user message
            const firstUserMessage = messagesToSave.find(msg => msg.sender === 'user');
            const projectTitle = this._extractProjectTitle(firstUserMessage?.content);
            
            // Get research query from AppState
            const researchQuery = this.appState.getCurrentQuery() || null;
            
            // Create new project with preserveConversation flag for login migration
            const project = await this.sidebar.createProject(projectTitle, researchQuery, { preserveConversation: true });
            
            if (!project) {
                logger.error('Failed to create project');
                return null;
            }
            
            // Save all messages to the project
            for (const msg of messagesToSave) {
                const normalizedSender = msg.sender === 'assistant' ? 'ai' : msg.sender;
                const messageData = msg.metadata ? { metadata: msg.metadata } : null;
                await this.apiService.saveMessage(project.id, normalizedSender, msg.content, messageData);
            }
            
            logger.info(`✅ Conversation saved to project ${project.id}`);
            
            // Return the created project (caller will handle loading projects)
            return project;
        } catch (error) {
            logger.error('Error creating project from conversation:', error);
            return null;
        }
    }
    
    /**
     * Extract project title from message content
     * @private
     */
    _extractProjectTitle(content) {
        if (!content) return 'Untitled Research';
        
        // Handle HTML content
        if (typeof content !== 'string') {
            if (content instanceof HTMLElement) {
                content = content.textContent || '';
            } else {
                content = String(content);
            }
        }
        
        // Strip HTML tags and truncate
        return content.replace(/<[^>]*>/g, '').trim().substring(0, 100) || 'Untitled Research';
    }

    /**
     * Load initial project data
     */
    async loadInitialData() {
        try {
            // Load projects via guarded loader to ensure concurrency safety
            await this.loadProjectsWithGuard();
            
            // Update store with loaded projects
            projectStore.setProjects(this.sidebar.projects);
            
            // Don't auto-load any project - start with fresh chat
            // User can manually select a project or start a new one
            this.outlineBuilder.setProject(null, null);
            projectStore.setActiveProject(null);
            
            // Clear any stale conversation history from sessionStorage
            this.appState.clearConversation();
        } catch (error) {
            logger.error('Error loading initial data:', error);
        }
    }

    /**
     * Handle project created event
     * @param {Object} project - The created project
     * @param {Object} options - Creation options
     * @param {boolean} options.preserveConversation - If true, preserve chat history (for login migration)
     */
    handleProjectCreated(project, options = {}) {
        const { preserveConversation = false } = options;
        
        // Add to store
        projectStore.addProject(project);
        projectStore.setActiveProject(project.id, project.title, project.research_query);
        
        // Sync research query to AppState if available
        if (project.research_query && this.appState) {
            this.appState.setCurrentQuery(project.research_query);
        }
        
        // Only clear chat and outline if NOT preserving conversation (user-initiated new project)
        if (!preserveConversation) {
            logger.info(`🧹 [ProjectManager] Clearing chat and outline for new project (preserveConversation: false)`);
            this.clearChatInterface();
            this.appState.clearConversation();
            projectStore.setOutline(projectStore.getDefaultOutline());
            this.outlineBuilder.setProject(project.id, { outline: [] });
        } else {
            logger.info(`💾 [ProjectManager] Preserving conversation for login migration (preserveConversation: true)`);
            // For login migration, skip outline setup - loadProject() will fetch full data
            // This prevents destroying the outline of reused projects
        }
        
        // Reset auto-creation flag so user can auto-create another project later
        this.hasAutoCreatedProject = false;
        
        // Emit global event
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_CREATED, {
            detail: { project }
        }));
    }

    /**
     * Handle project loading started (immediate UI update)
     */
    handleProjectLoadingStarted(projectId, projectTitle, preserveConversation = false) {
        logger.info(`⚡ [ProjectManager] Project loading started immediately:`, {
            projectId,
            projectTitle,
            preserveConversation
        });
        
        // Show loading UI immediately, forward preserveConversation flag
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_LOADING_STARTED, {
            detail: { projectId, projectTitle, preserveConversation }
        }));
    }

    /**
     * Handle project loaded event
     */
    async handleProjectLoaded(projectData, preserveConversation = false) {
        logger.info(`📊 [ProjectManager] Handling project switch:`, {
            newProjectId: projectData.id,
            newProjectTitle: projectData.title,
            researchQuery: projectData.research_query,
            preserveConversation,
            currentAppState: this.appState ? {
                mode: this.appState.getMode(),
                messageCount: this.appState.state?.messages?.length || 0
            } : 'AppState not available'
        });
        
        // Update store
        projectStore.setActiveProject(projectData.id, projectData.title, projectData.research_query);
        projectStore.setOutline(projectData.outline);
        
        // Sync research query to AppState if available
        if (projectData.research_query && this.appState) {
            this.appState.setCurrentQuery(projectData.research_query);
            logger.info(`✅ [ProjectManager] Restored research query: "${projectData.research_query}"`);
        } else if (!projectData.research_query) {
            logger.info(`ℹ️  [ProjectManager] Project has no saved research query`);
        }
        
        // Update outline builder
        this.outlineBuilder.setProject(projectData.id, projectData);
        
        // Reset auto-creation flag so user can auto-create another project later
        this.hasAutoCreatedProject = false;
        
        // SURGICAL FIX: Skip loading messages if preserveConversation is true (login flow)
        // Messages are already in the UI from pre-login chat - no need to reload from DB
        // If not preserving conversation, clear it before loading new project messages
        if (!preserveConversation) {
            this.appState.clearConversation();
            await this.loadProjectMessages(projectData.id);
        } else {
            logger.info(`🎯 [ProjectManager] Skipping message reload - conversation preserved from login`);
        }
        
        // Emit global event
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_SWITCHED, {
            detail: { projectData }
        }));
    }

    /**
     * Load and display messages for a specific project
     * Uses overlay + DocumentFragment for flicker-free restoration
     * @param {number} projectId - The ID of the project
     */
    async loadProjectMessages(projectId) {
        const messagesContainer = document.getElementById('messagesContainer');
        
        try {
            // Guard against concurrent restores
            if (this._isRestoring) {
                logger.warn(`⚠️  [ProjectManager] Already restoring messages, skipping...`);
                return;
            }
            
            logger.info(`📨 [ProjectManager] Loading messages for project ${projectId}...`);
            
            // Set restoring flag and add overlay CSS (dims without clearing)
            this._isRestoring = true;
            if (messagesContainer) {
                messagesContainer.classList.add('restoring');
            }
            
            // Remove report builder if present (can't restore across mode boundaries)
            const reportBuilder = messagesContainer?.querySelector('.report-builder-interface');
            if (reportBuilder) {
                reportBuilder.remove();
            }
            
            // Fetch messages from API
            const response = await this.apiService.getProjectMessages(projectId);
            const messages = response.messages || [];
            
            logger.info(`📬 [ProjectManager] Fetched ${messages.length} messages`);
            
            if (messages.length === 0) {
                // Clear and show welcome message for empty project
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                }
                this.appState.clearConversation();
                
                const projectTitle = projectStore.state.activeProjectTitle || 'this project';
                this.messageCoordinator.addMessage('system', `🎯 Welcome to "${projectTitle}". Start your research here.`, null, { skipPersist: true });
                logger.info(`ℹ️  [ProjectManager] No messages found, showing welcome message`);
            } else {
                // Build all messages off-DOM in DocumentFragment
                const fragment = document.createDocumentFragment();
                let mostRecentResearchData = null;
                
                // Build messages into fragment
                for (const messageRecord of messages) {
                    const messageElement = this.messageCoordinator.buildMessageElement(messageRecord);
                    fragment.appendChild(messageElement);
                    
                    // Extract research data from source cards metadata
                    const metadata = messageRecord.message_data?.metadata;
                    if (metadata?.type === 'source_cards' && metadata?.sources) {
                        mostRecentResearchData = {
                            sources: metadata.sources,
                            query: metadata.query || '',
                            enrichment_status: 'complete'
                        };
                    }
                }
                
                // Single atomic swap: clear + append fragment
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                    messagesContainer.appendChild(fragment);
                }
                
                // Update AppState in single batch after DOM is ready
                this.appState.clearConversation();
                for (const messageRecord of messages) {
                    this.appState.addMessage(
                        messageRecord.sender === 'ai' ? 'assistant' : messageRecord.sender,
                        messageRecord.content,
                        messageRecord.message_data?.metadata || null
                    );
                }
                
                // Restore research data to appState
                if (mostRecentResearchData) {
                    this.appState.setCurrentResearchData(mostRecentResearchData);
                    logger.info(`✅ Restored research data with ${mostRecentResearchData.sources.length} sources`);
                }
                
                logger.info(`✅ [ProjectManager] Loaded and displayed ${messages.length} messages`);
            }
            
            // Hide welcome screen
            this.hideWelcomeScreen();
            
        } catch (error) {
            logger.error(`❌ [ProjectManager] Failed to load messages for project ${projectId}:`, error);
            this.toastManager.show('Failed to load project messages', 'error');
        } finally {
            // Always cleanup restore state, even on errors
            this._isRestoring = false;
            if (messagesContainer) {
                messagesContainer.classList.remove('restoring');
            }
        }
    }

    /**
     * Clear chat interface while preserving mode
     */
    clearChatInterface() {
        const messagesContainer = document.getElementById('messagesContainer');
        if (!messagesContainer) return;
        
        // Remove report builder if present
        const reportBuilder = messagesContainer.querySelector('.report-builder-interface');
        if (reportBuilder) {
            reportBuilder.remove();
        }
        
        // Clear all messages
        messagesContainer.innerHTML = '';
        
        logger.info(`🧹 [ProjectManager] Chat interface cleared`);
    }

    /**
     * Hide the welcome screen
     */
    hideWelcomeScreen() {
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen && !welcomeScreen.classList.contains('hidden')) {
            welcomeScreen.classList.add('hidden');
        }
    }

    /**
     * Handle project deleted event
     */
    handleProjectDeleted(projectId) {
        // Remove from store
        projectStore.removeProject(projectId);
        
        // If deleted project was active, switch to first available
        if (projectStore.state.activeProjectId === projectId) {
            const projects = projectStore.state.projects;
            if (projects.length > 0) {
                this.sidebar.loadProject(projects[0].id);
            } else {
                // No projects left - clear everything
                projectStore.setActiveProject(null);
                this.outlineBuilder.setProject(null, null);
                this.appState.clearConversation();
                this.clearChatInterface();
            }
        }
        
        // Emit global event
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_DELETED, {
            detail: { projectId }
        }));
    }

    /**
     * Handle logout
     */
    handleLogout() {
        projectStore.reset();
        this.sidebar.projects = [];
        this.sidebar.activeProjectId = null;
        this.sidebar.render();
        this.outlineBuilder.setProject(null, null);
        this.hasAutoCreatedProject = false;
        this.hasMigratedLoginChat = false; // Reset migration flag for next login
        
        // Clear conversation history to prevent old chats from appearing
        this.appState.clearConversation();
        this.clearChatInterface();
    }

    /**
     * Auto-create a project from the first user query
     * DEFERS when unauthenticated - login flow will handle project creation
     * @param {string} query - The user's first query
     * @returns {Promise<number|null|{deferred: true}>} Project ID, null, or {deferred: true}
     */
    async ensureActiveProject(query) {
        // CRITICAL: If unauthenticated, defer project creation to login flow
        // This prevents 401 errors when Find Sources button is clicked before login
        if (!this.authService.isAuthenticated()) {
            logger.info('📋 ensureActiveProject: User not authenticated - deferring project creation to login flow');
            return { deferred: true };
        }
        
        // If there's already an active project, use it
        if (projectStore.state.activeProjectId) {
            return projectStore.state.activeProjectId;
        }

        // If we've already auto-created in this session, don't create another
        if (this.hasAutoCreatedProject) {
            return null;
        }

        // Mutex guard to prevent concurrent auto-create calls
        if (this._autoCreateLock) {
            return null;
        }

        this._autoCreateLock = true;
        this.hasAutoCreatedProject = true;
        
        try {
            const project = await this.sidebar.autoCreateProject(query);
            
            if (project) {
                analytics.track('project_auto_created', {
                    project_id: project.id,
                    from_query: true,
                    is_authenticated: this.authService.isAuthenticated()
                });
                return project.id;
            }
            
            // Creation returned null - reset flag to allow retry
            this.hasAutoCreatedProject = false;
            return null;
        } catch (error) {
            logger.error('Failed to auto-create project:', error);
            // Reset flag on failure to allow retry
            this.hasAutoCreatedProject = false;
            return null;
        } finally {
            this._autoCreateLock = false;
        }
    }

    /**
     * Update selected sources in store
     * Called by SourceManager when selection changes
     */
    updateSelectedSources(sources) {
        projectStore.setSelectedSources(sources);
    }

    /**
     * Get outline snapshot for report generation
     */
    getOutlineSnapshot() {
        return projectStore.getOutlineSnapshot();
    }

    /**
     * Get active project ID
     */
    getActiveProjectId() {
        return projectStore.state.activeProjectId;
    }

    /**
     * Get active project
     */
    getActiveProject() {
        return projectStore.getActiveProject();
    }
}
