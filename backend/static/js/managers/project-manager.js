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
    constructor({ apiService, authService, toastManager }) {
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        
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

        this.sidebar.addEventListener('projectLoaded', (e) => {
            this.handleProjectLoaded(e.detail.projectData);
        });

        this.sidebar.addEventListener('projectDeleted', (e) => {
            this.handleProjectDeleted(e.detail.projectId);
        });

        // Listen to auth state changes
        AppEvents.addEventListener('authStateChanged', (e) => {
            if (e.detail.isAuthenticated) {
                this.loadInitialData();
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
     * Load initial project data
     */
    async loadInitialData() {
        try {
            // Load projects via sidebar
            await this.sidebar.loadProjects();
            
            // Update store with loaded projects
            projectStore.setProjects(this.sidebar.projects);
            
            // Load the first project if available
            if (this.sidebar.projects.length > 0) {
                const firstProject = this.sidebar.projects[0];
                await this.sidebar.loadProject(firstProject.id);
            } else {
                // No projects - clear the outline builder
                this.outlineBuilder.setProject(null, null);
                projectStore.setActiveProject(null);
            }
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
        
        // Emit global event
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_CREATED, {
            detail: { project }
        }));
    }

    /**
     * Handle project loaded event
     */
    handleProjectLoaded(projectData) {
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
        
        console.log(`⚠️ [ProjectManager] Chat interface NOT updated - projects don't store messages`);
        
        // Emit global event
        AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.PROJECT_SWITCHED, {
            detail: { projectData }
        }));
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
        // Don't auto-create if user already has projects
        if (projectStore.hasProjects() || this.hasAutoCreatedProject) {
            return projectStore.state.activeProjectId;
        }

        // Auto-create project from query (works for both authenticated and anonymous users)
        this.hasAutoCreatedProject = true;
        const project = await this.sidebar.autoCreateProject(query);
        
        if (project) {
            analytics.track('project_auto_created', {
                project_id: project.id,
                from_query: true,
                is_authenticated: this.authService.isAuthenticated()
            });
            return project.id;
        }

        return null;
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
