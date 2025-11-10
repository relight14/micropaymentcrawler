/**
 * ProjectListSidebar Component
 * Manages project list display and navigation
 * Allows users to create, switch between, and manage research projects
 */

import { analytics } from '../utils/analytics.js';

export class ProjectListSidebar extends EventTarget {
    constructor({ apiService, authService, toastManager }) {
        super();
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.projects = [];
        this.activeProjectId = null;
        this.isCollapsed = false;
    }

    /**
     * Initialize the sidebar
     * Note: For authenticated users, projects are loaded by ProjectManager.loadInitialData()
     * This just ensures the sidebar renders for non-authenticated users
     */
    async init() {
        if (!this.authService.isAuthenticated()) {
            // Render for non-authenticated users (shows mobile login prompt on mobile)
            this.render();
        }
    }

    /**
     * Load all projects for the current user
     */
    async loadProjects() {
        try {
            const response = await fetch('/api/projects', {
                headers: {
                    'Authorization': `Bearer ${this.authService.getToken()}`
                }
            });

            if (response.ok) {
                this.projects = await response.json();
                this.render();
            } else if (response.status === 401) {
                this.authService.handleUnauthorized();
            }
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    /**
     * Create a new project
     */
    async createProject(title) {
        try {
            const response = await fetch('/api/projects', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authService.getToken()}`
                },
                body: JSON.stringify({ title })
            });

            if (response.ok) {
                const newProject = await response.json();
                this.projects.unshift(newProject);
                this.activeProjectId = newProject.id;
                this.render();
                
                analytics.track('project_created', {
                    project_id: newProject.id,
                    title: newProject.title
                });

                this.dispatchEvent(new CustomEvent('projectCreated', {
                    detail: { project: newProject }
                }));
                
                this.toastManager.show('New project created successfully', 'success');
                return newProject;
            } else if (response.status === 401) {
                this.authService.handleUnauthorized();
            } else {
                this.toastManager.show('Failed to create project', 'error');
            }
        } catch (error) {
            console.error('Error creating project:', error);
            this.toastManager.show('Failed to create project', 'error');
        }
        return null;
    }

    /**
     * Load a specific project
     */
    async loadProject(projectId) {
        try {
            console.log(`🔄 [ProjectSidebar] Loading project ${projectId}...`);
            const response = await fetch(`/api/projects/${projectId}`, {
                headers: {
                    'Authorization': `Bearer ${this.authService.getToken()}`
                }
            });

            if (response.ok) {
                const response_data = await response.json();
                
                // API returns {project: {...}, outline: [...]}
                // Flatten for easier use in the frontend
                const projectData = {
                    id: response_data.project.id,
                    user_id: response_data.project.user_id,
                    title: response_data.project.title,
                    created_at: response_data.project.created_at,
                    updated_at: response_data.project.updated_at,
                    is_active: response_data.project.is_active,
                    outline: response_data.outline
                };
                
                console.log(`✅ [ProjectSidebar] Project data loaded:`, {
                    id: projectData.id,
                    title: projectData.title,
                    outlineSections: projectData.outline?.length || 0
                });
                
                this.activeProjectId = projectId;
                this.render();
                
                analytics.track('project_loaded', {
                    project_id: projectId
                });

                this.dispatchEvent(new CustomEvent('projectLoaded', {
                    detail: { projectData }
                }));
                
                return projectData;
            } else if (response.status === 401) {
                this.authService.handleUnauthorized();
            } else {
                this.toastManager.show('Failed to load project', 'error');
            }
        } catch (error) {
            console.error('Error loading project:', error);
            this.toastManager.show('Failed to load project', 'error');
        }
        return null;
    }

    /**
     * Delete a project
     */
    async deleteProject(projectId) {
        if (!confirm('Are you sure you want to delete this project?')) {
            return;
        }

        try {
            const response = await fetch(`/api/projects/${projectId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authService.getToken()}`
                }
            });

            if (response.ok) {
                this.projects = this.projects.filter(p => p.id !== projectId);
                if (this.activeProjectId === projectId) {
                    this.activeProjectId = this.projects.length > 0 ? this.projects[0].id : null;
                }
                this.render();
                
                analytics.track('project_deleted', {
                    project_id: projectId
                });

                this.dispatchEvent(new CustomEvent('projectDeleted', {
                    detail: { projectId }
                }));
                
                this.toastManager.show('Project deleted successfully', 'success');
            } else if (response.status === 401) {
                this.authService.handleUnauthorized();
            } else {
                this.toastManager.show('Failed to delete project', 'error');
            }
        } catch (error) {
            console.error('Error deleting project:', error);
            this.toastManager.show('Failed to delete project', 'error');
        }
    }

    /**
     * Toggle sidebar collapsed state
     */
    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        this.render();
    }

    /**
     * Format timestamp for display
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
    }

    /**
     * Render the sidebar
     */
    render() {
        const container = document.getElementById('project-sidebar');
        if (!container) return;

        // Check if mobile viewport
        const isMobile = window.innerWidth <= 768;
        
        if (!this.authService.isAuthenticated()) {
            // On mobile, show login prompt instead of hiding
            if (isMobile) {
                container.style.display = '';  // Clear inline style, let CSS handle it
                container.innerHTML = `
                    <div class="mobile-login-prompt">
                        <div class="login-prompt-icon">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                            </svg>
                        </div>
                        <h3>Projects</h3>
                        <p>Save and organize your research across sessions</p>
                        <button class="mobile-login-btn" id="mobile-login-btn">
                            Log In to Access Projects
                        </button>
                    </div>
                `;
                
                // Ensure panel is visible on mobile (maintain mobile-active class from MobileNavigation)
                container.classList.add('visible', 'mobile-active');
                
                // Attach login button listener
                const loginBtn = document.getElementById('mobile-login-btn');
                if (loginBtn) {
                    loginBtn.addEventListener('click', () => {
                        this.authService.login();
                    });
                }
            } else {
                container.innerHTML = '';
                container.style.display = 'none';
            }
            return;
        }

        container.style.display = '';

        container.innerHTML = `
            <div class="project-sidebar ${this.isCollapsed ? 'collapsed' : ''}">
                <div class="sidebar-header">
                    <button class="toggle-btn" id="sidebar-toggle">
                        ${this.isCollapsed ? '▶' : '◀'}
                    </button>
                    ${!this.isCollapsed ? '<h3>Projects</h3>' : ''}
                </div>
                
                ${!this.isCollapsed ? `
                    <button class="new-project-btn" id="new-project-btn">
                        + New Project
                    </button>
                    
                    <div class="projects-list">
                        ${this.projects.length === 0 ? `
                            <div class="empty-state">
                                <p>No projects yet</p>
                                <p class="hint">Create your first project to get started</p>
                            </div>
                        ` : this.projects.map(project => `
                            <div class="project-item ${project.id === this.activeProjectId ? 'active' : ''}" 
                                 data-project-id="${project.id}">
                                <div class="project-info">
                                    <div class="project-title">${this.escapeHtml(project.title)}</div>
                                    <div class="project-timestamp">${this.formatTimestamp(project.updated_at)}</div>
                                </div>
                                <button class="delete-project-btn" data-project-id="${project.id}" title="Delete project">
                                    ✕
                                </button>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `;

        this.attachEventListeners();
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        const toggleBtn = document.getElementById('sidebar-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleCollapse());
        }

        const newProjectBtn = document.getElementById('new-project-btn');
        if (newProjectBtn) {
            newProjectBtn.addEventListener('click', () => this.showNewProjectDialog());
        }

        document.querySelectorAll('.project-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-project-btn')) {
                    const projectId = parseInt(item.dataset.projectId);
                    this.loadProject(projectId);
                }
            });
        });

        document.querySelectorAll('.delete-project-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const projectId = parseInt(btn.dataset.projectId);
                this.deleteProject(projectId);
            });
        });
    }

    /**
     * Show dialog to create a new project
     */
    showNewProjectDialog() {
        const title = prompt('Enter project title:');
        if (title && title.trim()) {
            this.createProject(title.trim());
        }
    }

    /**
     * Auto-create a project with a generated title from query
     */
    async autoCreateProject(query) {
        const title = this.generateProjectTitle(query);
        return await this.createProject(title);
    }

    /**
     * Generate a project title from the first query
     */
    generateProjectTitle(query) {
        const maxLength = 50;
        const cleaned = query.trim();
        
        if (cleaned.length <= maxLength) {
            return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        }
        
        return cleaned.substring(0, maxLength - 3) + '...';
    }
}
