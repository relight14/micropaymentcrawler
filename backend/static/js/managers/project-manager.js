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
    constructor({ apiService, authService, toastManager, messageCoordinator, appState, sourceManager }) {
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.messageCoordinator = messageCoordinator;
        this.appState = appState;
        this.sourceManager = sourceManager;
        
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
        this.suppressNextAutoLoad = false; // Flow A guard: prevent auto-loading project after creation
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
            this.handleProjectCreated(e.detail.project);
        });

        // Immediate UI update when project loading starts
        this.sidebar.addEventListener('projectLoadingStarted', (e) => {
            this.handleProjectLoadingStarted(e.detail.projectId, e.detail.projectTitle);
        });

        this.sidebar.addEventListener('projectLoaded', (e) => {
            this.handleProjectLoaded(e.detail.projectData);
        });

        this.sidebar.addEventListener('projectDeleted', (e) => {
            this.handleProjectDeleted(e.detail.projectId);
        });

        // Listen to auth state changes
        AppEvents.addEventListener('authStateChanged', async (e) => {
            console.log('🚨🚨🚨 AUTH STATE CHANGED EVENT FIRED', { 
                isAuthenticated: e.detail.isAuthenticated,
                timestamp: new Date().toISOString()
            });
            
            if (e.detail.isAuthenticated) {
                // Get current query and message count for routing decision
                const query = this.appState.getCurrentQuery();
                const messageCount = this.appState.getConversationHistory()?.length || 0;
                const hasQuery = query && query.trim();
                
                console.log('🚨 AUTH ROUTING DECISION:', {
                    query: query,
                    hasQuery: hasQuery,
                    messageCount: messageCount,
                    decision: hasQuery ? 'FLOW A (preserve DOM)' : 'FLOW B (traditional)'
                });
                
                if (hasQuery) {
                    // Flow A: Unauthenticated user with pending source query
                    // Preserve existing DOM and fire source search
                    console.log('🔍🔍🔍 ROUTING TO FLOW A - handleAuthenticatedSourceQuery');
                    logger.info('🔍 Routing to handleAuthenticatedSourceQuery (Flow A: preserve DOM)');
                    await this.handleAuthenticatedSourceQuery(query);
                } else {
                    // Flow B: Regular login without pending source query
                    // Use traditional flow (may rebuild DOM if loading existing project)
                    console.log('🔐🔐🔐 ROUTING TO FLOW B - handleLogin');
                    logger.info('🔐 Routing to handleLogin (Flow B: traditional)');
                    await this.handleLogin();
                }
            } else {
                console.log('🚨 LOGOUT EVENT');
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
     * Handle user login - FLOW B for traditional login without pending source query
     * Triggered by authStateChanged event when no source query is pending
     * Preserves pre-login chat and migrates it to a new project
     * Uses one-shot guard to prevent duplicate migration if event fires multiple times
     * Note: This flow may rebuild DOM when loading existing project
     * ORDER: Load projects first → Migrate if needed → Sync store → Auto-load new project
     */
    async handleLogin() {
        const preLoginChat = this.appState.getConversationHistory();
        const messageCount = preLoginChat?.length || 0;
        
        console.log('🔐🔐🔐 FLOW B STARTED - handleLogin', {
            messageCount: messageCount,
            hasMigratedLoginChat: this.hasMigratedLoginChat,
            timestamp: new Date().toISOString()
        });
        logger.info(`🔐 [ProjectManager] FLOW B: handleLogin (traditional)`);
        
        // Preserve chat BEFORE anything else
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
        
        // 3) If we created or found one, load it
        if (newProjectId) {
            await this.sidebar.loadProject(newProjectId);
            
            // Only dispatch SOURCE_SEARCH_TRIGGER after restore completes
            const query = this.appState.getCurrentQuery();
            if (query && query.trim() && !this._isRestoring) {
                logger.info('🔍 Dispatching SOURCE_SEARCH_TRIGGER after login with query:', query);
                AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.SOURCE_SEARCH_TRIGGER, {
                    detail: { query }
                }));
            } else if (this._isRestoring) {
                logger.warn('⚠️ Skipping SOURCE_SEARCH_TRIGGER - project still restoring');
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
            
            // Create new project
            const project = await this.sidebar.createProject(projectTitle, researchQuery);
            
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
     * Handle authenticated source query - FLOW A for unauthenticated users running source search
     * CRITICAL: This flow preserves the existing DOM completely (no clear/rebuild)
     * Used when: User has conversation → clicks "Find Sources" → logs in → source search fires
     * @param {string} query - The research query to search for sources
     */
    async handleAuthenticatedSourceQuery(query) {
        const preLoginChat = this.appState.getConversationHistory();
        const messageCount = preLoginChat?.length || 0;
        const messagesContainer = document.getElementById('messagesContainer');
        const domMessageCount = messagesContainer?.children.length || 0;
        
        console.log('🔍🔍🔍 FLOW A STARTED - handleAuthenticatedSourceQuery', {
            query: query,
            messageCount: messageCount,
            domMessageCount: domMessageCount,
            hasMigratedLoginChat: this.hasMigratedLoginChat,
            timestamp: new Date().toISOString()
        });
        logger.info(`🔍 [ProjectManager] FLOW A: handleAuthenticatedSourceQuery with query: "${query}"`);
        
        // Preserve chat BEFORE anything else
        const hasPreLoginChat = !!(preLoginChat && preLoginChat.length);
        
        // Optimistic UI (cached projects) to avoid blank flash
        if (projectStore.state.projects?.length) {
            this.sidebar.projects = projectStore.state.projects;
            this.sidebar.render();
        }
        
        // 1) Load projects first so we can dedupe against them
        await this.loadProjectsWithGuard();
        projectStore.setProjects(this.sidebar.projects); // sync store NOW
        
        // 2) Sync selected sources from session storage to ProjectStore
        this.syncSelectedSourcesFromAppState();
        
        // 3) One-shot guarded migration (prevent duplicate if event fires multiple times)
        let projectId = null;
        if (hasPreLoginChat && !this.hasMigratedLoginChat) {
            this.hasMigratedLoginChat = true;
            this.toastManager.show('💾 Syncing your research...', 'info');
            
            try {
                const firstUserMessage = preLoginChat.find(m => m.sender === 'user');
                const candidateTitle = this._extractProjectTitle(firstUserMessage?.content);
                
                // Check if project with same title exists
                const existing = this._findExistingProjectByTitle(candidateTitle);
                if (existing) {
                    projectId = existing.id;
                    logger.info(`🔁 Reusing existing project: ${existing.title} (${projectId})`);
                    this.toastManager.show(`🔁 Using project "${existing.title}"`, 'info');
                } else {
                    // Create new project (just metadata, no messages yet)
                    // FLOW A GUARD: Suppress auto-load to preserve DOM
                    this.suppressNextAutoLoad = true;
                    logger.info('🛡️ FLOW A: Setting suppressNextAutoLoad flag before project creation');
                    
                    const project = await this.sidebar.createProject(candidateTitle, query);
                    if (project) {
                        projectId = project.id;
                        logger.info(`✅ Created new project: ${project.title} (${projectId})`);
                        this.toastManager.show(`💾 Saved to "${project.title}"`, 'success');
                        
                        // CRITICAL: Add new project to sidebar list immediately so it can be found below
                        await this.sidebar.loadProjects();
                        projectStore.setProjects(this.sidebar.projects);
                        
                        // Persist messages to DB in background (non-blocking)
                        this._persistConversationToProject(projectId, preLoginChat)
                            .then(() => logger.info(`✅ Background save complete for project ${projectId}`))
                            .catch(err => logger.error('Background save failed:', err));
                    }
                }
            } catch (err) {
                logger.error('Failed to create/find project:', err);
                this.hasMigratedLoginChat = false; // allow retry on next login
                this.toastManager.show('⚠️ Failed to save conversation', 'error');
            }
        } else if (!hasPreLoginChat) {
            // Edge case: No conversation but query exists (user typed query without sending messages)
            // Create minimal project with just the query
            logger.info('⚠️ No pre-login chat but query exists - creating minimal project');
            try {
                // FLOW A GUARD: Suppress auto-load to preserve DOM
                this.suppressNextAutoLoad = true;
                logger.info('🛡️ FLOW A: Setting suppressNextAutoLoad flag before minimal project creation');
                
                const project = await this.sidebar.createProject('Research Query', query);
                if (project) {
                    projectId = project.id;
                    logger.info(`✅ Created minimal project for query: ${project.title} (${projectId})`);
                    
                    // Reload projects to ensure new project is in sidebar list
                    await this.sidebar.loadProjects();
                    projectStore.setProjects(this.sidebar.projects);
                }
            } catch (err) {
                logger.error('Failed to create minimal project:', err);
            }
        }
        
        // 4) Set active project metadata WITHOUT rebuilding DOM
        if (projectId) {
            // Reload projects to ensure we have the latest list (in case creation just happened)
            const projectData = this.sidebar.projects.find(p => p.id === projectId);
            if (projectData) {
                // Update stores only (no DOM manipulation)
                projectStore.setActiveProject(projectId, projectData.title, query);
                this.appState.setCurrentQuery(query);
                
                // Update outline builder metadata
                this.outlineBuilder.setProject(projectId, { outline: projectStore.state.currentOutline });
                
                // Update sidebar visual state
                this.sidebar.activeProjectId = projectId;
                this.sidebar.render();
                
                logger.info(`📋 Set active project: ${projectData.title} (${projectId}) - DOM preserved`);
            } else {
                logger.error(`❌ Project ${projectId} not found in sidebar list after creation - cannot set active`);
                projectId = null; // CRITICAL: Clear projectId to prevent source search without active project
                this.hasMigratedLoginChat = false; // Reset flag to allow retry
            }
        } else {
            logger.warn('⚠️ No project established - resetting migration flag');
            this.hasMigratedLoginChat = false; // Reset flag to allow retry
        }
        
        // 5) Fire source search ONLY if we have an active project
        if (projectId && query && query.trim()) {
            logger.info(`🔍 Dispatching SOURCE_SEARCH_TRIGGER with query: "${query}"`);
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.SOURCE_SEARCH_TRIGGER, {
                detail: { query }
            }));
        } else if (!projectId && query) {
            logger.error('❌ Cannot fire source search - no active project established');
            this.toastManager.show('⚠️ Please create or select a project first', 'warning');
        }
    }

    /**
     * Persist conversation messages to project database (background helper)
     * Does NOT touch DOM - only saves to database
     * @param {number} projectId - Project ID to save messages to
     * @param {Array} conversationHistory - Messages to save
     * @returns {Promise<void>}
     * @private
     */
    async _persistConversationToProject(projectId, conversationHistory) {
        if (!projectId || !conversationHistory || conversationHistory.length === 0) {
            return;
        }
        
        try {
            // Filter to user/assistant messages only
            const messagesToSave = conversationHistory.filter(msg => 
                msg.sender === 'user' || msg.sender === 'assistant' || msg.sender === 'ai'
            );
            
            if (messagesToSave.length === 0) {
                logger.info(`ℹ️ No user/assistant messages to save for project ${projectId}`);
                return;
            }
            
            logger.info(`💾 Persisting ${messagesToSave.length} messages to project ${projectId}...`);
            
            // Save all messages to the project
            for (const msg of messagesToSave) {
                const normalizedSender = msg.sender === 'assistant' ? 'ai' : msg.sender;
                const messageData = msg.metadata ? { metadata: msg.metadata } : null;
                await this.apiService.saveMessage(projectId, normalizedSender, msg.content, messageData);
            }
            
            logger.info(`✅ ${messagesToSave.length} messages persisted to project ${projectId}`);
        } catch (error) {
            logger.error(`❌ Error persisting messages to project ${projectId}:`, error);
            throw error;
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
        } catch (error) {
            logger.error('Error loading initial data:', error);
        }
    }

    /**
     * Handle project created event
     */
    handleProjectCreated(project) {
        // Add to store
        projectStore.addProject(project);
        projectStore.setActiveProject(project.id, project.title, project.research_query);
        
        // Sync research query to AppState if available
        if (project.research_query && this.appState) {
            this.appState.setCurrentQuery(project.research_query);
        }
        
        // Set up outline builder with new project
        this.outlineBuilder.setProject(project.id, { outline: projectStore.state.currentOutline });
        
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
    handleProjectLoadingStarted(projectId, projectTitle) {
        logger.info(`⚡ [ProjectManager] Project loading started immediately:`, {
            projectId,
            projectTitle
        });
        
        // Show loading UI immediately
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_LOADING_STARTED, {
            detail: { projectId, projectTitle }
        }));
    }

    /**
     * Handle project loaded event
     */
    async handleProjectLoaded(projectData) {
        // FLOW A GUARD: Skip auto-loading if suppression flag is set
        if (this.suppressNextAutoLoad) {
            logger.info('🛡️ FLOW A: Auto-load suppressed - skipping handleProjectLoaded to preserve DOM');
            console.log('🛡️🛡️🛡️ FLOW A GUARD: suppressNextAutoLoad is TRUE - SKIPPING handleProjectLoaded entirely');
            this.suppressNextAutoLoad = false; // Clear flag for next time
            return;
        }
        
        const messagesContainer = document.getElementById('messagesContainer');
        const domMessageCount = messagesContainer?.children.length || 0;
        
        console.log('📊📊📊 handleProjectLoaded CALLED - ABOUT TO LOAD PROJECT MESSAGES', {
            projectId: projectData.id,
            projectTitle: projectData.title,
            currentDomMessageCount: domMessageCount,
            appStateMessageCount: this.appState?.state?.messages?.length || 0,
            timestamp: new Date().toISOString(),
            WARNING: '⚠️ This will call loadProjectMessages which CLEARS DOM'
        });
        
        logger.info(`📊 [ProjectManager] Handling project switch:`, {
            newProjectId: projectData.id,
            newProjectTitle: projectData.title,
            researchQuery: projectData.research_query,
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
        
        console.log('⚠️⚠️⚠️ ABOUT TO CALL loadProjectMessages - DOM WILL BE CLEARED');
        // Load and display project messages (this clears and rebuilds chat DOM)
        await this.loadProjectMessages(projectData.id);
        
        // FLOW B: Re-apply outline and sources AFTER DOM rebuild
        logger.info('🔄 FLOW B: Re-applying outline and sources after DOM rebuild');
        
        // Re-apply outline state (in case DOM rebuild cleared it)
        projectStore.setOutline(projectData.outline);
        this.outlineBuilder.setProject(projectData.id, projectData);
        logger.info(`✅ FLOW B: Outline restored with ${projectData.outline?.sections?.length || 0} sections`);
        
        // Restore and display sources if available
        const savedSources = projectData.selected_sources || projectData.sources || [];
        if (savedSources.length > 0) {
            logger.info(`🔄 FLOW B: Rebuilding ${savedSources.length} source cards...`);
            
            // Rebuild source cards in DOM
            if (this.sourceManager) {
                await this.sourceManager.displayCards(savedSources);
                logger.info(`✅ FLOW B: Source cards displayed`);
                
                // Reattach click handlers to source cards
                if (this.sourceManager.sourceCardComponent) {
                    const rehydratedCount = this.sourceManager.sourceCardComponent.rehydrateCards();
                    logger.info(`✅ FLOW B: Rehydrated ${rehydratedCount} source card handlers`);
                } else {
                    logger.warn('⚠️ FLOW B: sourceCardComponent not available for rehydration');
                }
            } else {
                logger.warn('⚠️ FLOW B: sourceManager not available for displaying cards');
            }
            
            // Update selected sources in store
            projectStore.setSelectedSources(savedSources);
            logger.info(`✅ FLOW B: Restored ${savedSources.length} selected sources to store`);
        } else {
            logger.info(`ℹ️ FLOW B: No saved sources to restore`);
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
        const domMessageCountBefore = messagesContainer?.children.length || 0;
        
        console.log('💣💣💣 loadProjectMessages CALLED - DOM CLEAR IMMINENT', {
            projectId: projectId,
            domMessageCountBefore: domMessageCountBefore,
            appStateMessageCount: this.appState?.getConversationHistory()?.length || 0,
            isRestoring: this._isRestoring,
            timestamp: new Date().toISOString(),
            CRITICAL: '🔥 This function WILL clear innerHTML and wipe all chat messages'
        });
        
        try {
            // Guard against concurrent restores
            if (this._isRestoring) {
                console.log('⚠️ SKIPPING - Already restoring messages');
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
                    console.log('🔥🔥🔥 CLEARING DOM NOW - No messages (empty project) - innerHTML = ""');
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
                    console.log('🔥🔥🔥 CLEARING DOM NOW - Atomic swap with ' + messages.length + ' messages - innerHTML = ""');
                    messagesContainer.innerHTML = '';
                    messagesContainer.appendChild(fragment);
                    console.log('✅ DOM REBUILT with', messages.length, 'messages from database');
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
            
            // Rehydrate source card click handlers after DOM rebuild
            if (this.sourceManager && this.sourceManager.sourceCardComponent) {
                console.log('🔄 REHYDRATE: Calling rehydrateCards after DOM rebuild...');
                const rehydratedCount = this.sourceManager.sourceCardComponent.rehydrateCards();
                console.log(`✅ REHYDRATE: Rehydrated ${rehydratedCount} source card handlers`);
            } else {
                console.warn('⚠️ REHYDRATE: SourceManager or sourceCardComponent not available');
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
                projectStore.setActiveProject(null);
                this.outlineBuilder.setProject(null, null);
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
    }

    /**
     * Auto-create a project from the first user query
     * @param {string} query - The user's first query
     */
    async ensureActiveProject(query) {
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
