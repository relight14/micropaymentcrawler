/**
 * ProjectStore - State management for projects and outlines
 * Single source of truth with subscribe/notify pattern
 */

export class ProjectStore {
    constructor() {
        this.state = {
            activeProjectId: null,
            currentProjectTitle: '',
            currentResearchQuery: null,
            projects: [],
            currentOutline: this.getDefaultOutline(),
            selectedSources: []
        };
        
        this.subscribers = new Set();
    }

    /**
     * Get default outline structure
     */
    getDefaultOutline() {
        return [
            { id: null, title: 'Introduction', order_index: 0, sources: [] },
            { id: null, title: 'Key Findings', order_index: 1, sources: [] },
            { id: null, title: 'Conclusion', order_index: 2, sources: [] }
        ];
    }

    /**
     * Get current state (immutable copy)
     */
    getState() {
        return {
            ...this.state,
            projects: [...this.state.projects],
            currentOutline: JSON.parse(JSON.stringify(this.state.currentOutline)),
            selectedSources: [...this.state.selectedSources]
        };
    }

    /**
     * Subscribe to state changes
     * @param {Function} callback - Called with new state when it changes
     * @returns {Function} Unsubscribe function
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * Update state and notify subscribers
     * @param {Object} updates - Partial state updates
     */
    setState(updates) {
        const oldState = this.getState();
        this.state = { ...this.state, ...updates };
        
        // Notify all subscribers with new state
        const newState = this.getState();
        this.subscribers.forEach(callback => {
            try {
                callback(newState, oldState);
            } catch (error) {
                console.error('Error in state subscriber:', error);
            }
        });
    }

    /**
     * Set active project
     */
    setActiveProject(projectId, projectTitle = '', researchQuery = null) {
        this.setState({
            activeProjectId: projectId,
            currentProjectTitle: projectTitle,
            currentResearchQuery: researchQuery
        });
    }
    
    /**
     * Get research query for active project
     */
    getResearchQuery() {
        return this.state.currentResearchQuery;
    }
    
    /**
     * Update research query for active project
     */
    setResearchQuery(query) {
        this.setState({ currentResearchQuery: query });
        
        // Also update the project in the projects array
        if (this.state.activeProjectId) {
            this.updateProject(this.state.activeProjectId, { research_query: query });
        }
    }

    /**
     * Set projects list
     */
    setProjects(projects) {
        this.setState({ projects });
    }

    /**
     * Add a new project
     */
    addProject(project) {
        const projects = [project, ...this.state.projects];
        this.setState({ projects });
    }

    /**
     * Remove a project
     */
    removeProject(projectId) {
        const projects = this.state.projects.filter(p => p.id !== projectId);
        this.setState({ projects });
    }

    /**
     * Update a project
     */
    updateProject(projectId, updates) {
        const projects = this.state.projects.map(p =>
            p.id === projectId ? { ...p, ...updates } : p
        );
        this.setState({ projects });
    }

    /**
     * Set current outline
     */
    setOutline(outline) {
        this.setState({ currentOutline: outline || this.getDefaultOutline() });
    }

    /**
     * Set selected sources
     */
    setSelectedSources(sources) {
        this.setState({ selectedSources: sources || [] });
    }

    /**
     * Get outline snapshot for report generation
     * Returns a clean copy without internal IDs
     */
    getOutlineSnapshot() {
        return {
            sections: this.state.currentOutline.map(section => ({
                title: section.title,
                sources: section.sources.map(s => s.source_data)
            }))
        };
    }

    /**
     * Check if user has any projects
     */
    hasProjects() {
        return this.state.projects.length > 0;
    }

    /**
     * Get active project object
     */
    getActiveProject() {
        return this.state.projects.find(p => p.id === this.state.activeProjectId) || null;
    }

    /**
     * Reset store to initial state
     */
    reset() {
        this.setState({
            activeProjectId: null,
            currentProjectTitle: '',
            projects: [],
            currentOutline: this.getDefaultOutline(),
            selectedSources: []
        });
    }
}

// Global store instance
export const projectStore = new ProjectStore();
