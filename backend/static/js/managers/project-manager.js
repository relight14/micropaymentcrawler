/**
 * ProjectManager - Orchestration layer for project and outline functionality
 * Coordinates between ProjectStore, API, and UI components
 */

import { ProjectListSidebar } from '../components/project-sidebar.js';
import { OutlineBuilder } from '../components/outline-builder.js';
import { projectStore } from '../state/project-store.js';
import { AppEvents, EVENT_TYPES } from '../utils/event-bus.js';
import { analytics } from '../utils/analytics.js';

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
     * Handle user login - preserve conversation history from localStorage
     */
    async handleLogin() {
        try {
            console.log(`🔐 User logged in - checking for saved anonymous session...`);
            
            // Load initial project data first
            await this.loadInitialData();
            
            // Check for saved anonymous session in localStorage
            const savedSessionData = localStorage.getItem('temp_anonymous_conversation');
            
            if (!savedSessionData) {
                console.log(`ℹ️  No anonymous session found in localStorage`);
                return;
            }
            
            try {
                const sessionData = JSON.parse(savedSessionData);
                const messages = sessionData.messages || [];
                
                // Validate session (not too old - within 10 minutes)
                const sessionAge = Date.now() - (sessionData.timestamp || 0);
                if (sessionAge > 10 * 60 * 1000) {
                    console.log(`⏰ Anonymous session expired (${Math.round(sessionAge / 1000)}s old), skipping`);
                    localStorage.removeItem('temp_anonymous_conversation');
                    return;
                }
                
                if (messages.length === 0) {
                    console.log(`ℹ️  Anonymous session has no messages`);
                    localStorage.removeItem('temp_anonymous_conversation');
                    return;
                }
                
                console.log(`💾 Restoring ${messages.length} messages from anonymous session...`);
                
                // Extract project title from first user message
                const firstUserMessage = messages.find(msg => msg.sender === 'user');
                const projectTitle = firstUserMessage?.content?.substring(0, 100).replace(/<[^>]*>/g, '').trim() || 'Untitled Research';
                
                // Create new project
                const project = await this.sidebar.createProject(projectTitle, sessionData.currentQuery);
                
                if (project) {
                    // Save all messages to the project
                    for (const msg of messages) {
                        const normalizedSender = msg.sender === 'assistant' ? 'ai' : msg.sender;
                        const messageData = msg.metadata ? { metadata: msg.metadata } : null;
                        await this.apiService.saveMessage(project.id, normalizedSender, msg.content, messageData);
                    }
                    
                    console.log(`✅ Anonymous conversation restored to project ${project.id}`);
                    this.toastManager.show(`💾 Your conversation has been saved to "${projectTitle}"`, 'success');
                    
                    // Add to project list
                    projectStore.addProject(project);
                    await this.sidebar.loadProjects(); // Refresh sidebar
                    
                    // Clean up localStorage
                    localStorage.removeItem('temp_anonymous_conversation');
                }
            } catch (parseError) {
                console.error('Failed to parse or restore anonymous session:', parseError);
                // Clean up invalid data
                localStorage.removeItem('temp_anonymous_conversation');
            }
        } catch (error) {
            console.error('Error handling login:', error);
            // Still try to load initial data even if restoration fails
            await this.loadInitialData();
        }
    }

    /**
     * Load initial project data
     */
    async loadInitialData() {
        try {
            // Load projects via sidebar
            await this.sidebar.loadProjects();
            
            // Update store with loaded projects
            projectStore.setProjects(this.sidebar.projects);
            
            // Don't auto-load any project - start with fresh chat
            // User can manually select a project or start a new one
            this.outlineBuilder.setProject(null, null);
            projectStore.setActiveProject(null);
        } catch (error) {
            console.error('Error loading initial data:', error);
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
        if (project.research_query && window.app?.appState) {
            window.app.appState.setCurrentQuery(project.research_query);
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
        console.log(`⚡ [ProjectManager] Project loading started immediately:`, {
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
        console.log(`📊 [ProjectManager] Handling project switch:`, {
            newProjectId: projectData.id,
            newProjectTitle: projectData.title,
            researchQuery: projectData.research_query,
            currentAppState: {
                mode: window.app?.appState?.getMode(),
                messageCount: window.app?.appState?.state?.messages?.length || 0
            }
        });
        
        // Update store
        projectStore.setActiveProject(projectData.id, projectData.title, projectData.research_query);
        projectStore.setOutline(projectData.outline);
        
        // Sync research query to AppState if available
        if (projectData.research_query && window.app?.appState) {
            window.app.appState.setCurrentQuery(projectData.research_query);
            console.log(`✅ [ProjectManager] Restored research query: "${projectData.research_query}"`);
        } else if (!projectData.research_query) {
            console.log(`ℹ️  [ProjectManager] Project has no saved research query`);
        }
        
        // Update outline builder
        this.outlineBuilder.setProject(projectData.id, projectData);
        
        // Reset auto-creation flag so user can auto-create another project later
        this.hasAutoCreatedProject = false;
        
        // Load and display project messages
        await this.loadProjectMessages(projectData.id);
        
        // Emit global event
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_SWITCHED, {
            detail: { projectData }
        }));
    }

    /**
     * Load and display messages for a specific project
     * @param {number} projectId - The ID of the project
     */
    async loadProjectMessages(projectId) {
        try {
            console.log(`📨 [ProjectManager] Loading messages for project ${projectId}...`);
            
            // Clear current chat UI while preserving mode
            this.clearChatInterface();
            
            // Fetch messages from API
            const response = await this.apiService.getProjectMessages(projectId);
            const messages = response.messages || [];
            
            console.log(`📬 [ProjectManager] Fetched ${messages.length} messages`);
            
            if (messages.length === 0) {
                console.log(`ℹ️  [ProjectManager] No messages found for project ${projectId}`);
                return;
            }
            
            // Clear AppState conversation history to prevent duplicates
            this.appState.clearConversation();
            
            // Restore each message using MessageCoordinator
            for (const messageRecord of messages) {
                // Add to AppState (skipPersist to avoid re-saving)
                this.appState.addMessage(
                    messageRecord.sender === 'ai' ? 'assistant' : messageRecord.sender,
                    messageRecord.content,
                    messageRecord.message_data?.metadata || null
                );
                
                // Render the message
                this.messageCoordinator.restoreMessage(messageRecord, { skipPersist: true });
            }
            
            console.log(`✅ [ProjectManager] Loaded and displayed ${messages.length} messages`);
        } catch (error) {
            console.error(`❌ [ProjectManager] Failed to load messages for project ${projectId}:`, error);
            this.toastManager.show('Failed to load project messages', 'error');
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
        
        console.log(`🧹 [ProjectManager] Chat interface cleared`);
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

        // Auto-create project from query (works for both authenticated and anonymous users)
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
            console.error('Failed to auto-create project:', error);
            // Reset flag on failure to allow retry
            this.hasAutoCreatedProject = false;
            return null;
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
