/**
 * SourcesPanel - Dedicated panel for displaying and managing research sources
 * Mirrors OutlineBuilder pattern with clean state management and debounced saves
 */

export class SourcesPanel {
    constructor(appState, projectStore, authService, apiService, toastManager) {
        this.appState = appState;
        this.projectStore = projectStore;
        this.authService = authService;
        this.apiService = apiService;
        this.toastManager = toastManager;
        
        this.container = document.getElementById('sources-panel');
        this.sources = [];
        this.currentProjectId = null;
        this.saveTimeout = null;
        this.isSaving = false;
        
        if (!this.container) {
            console.error('❌ Sources panel container not found');
            return;
        }
        
        this.init();
    }
    
    /**
     * Initialize the sources panel
     */
    init() {
        console.log('📚 [SourcesPanel] Initializing...');
        
        // Listen for new sources from research results
        window.addEventListener('researchSourcesFound', (e) => {
            this.handleNewSources(e.detail.sources);
        });
        
        // Listen for project changes
        this.projectStore.subscribe((newState, oldState) => {
            if (newState.activeProjectId !== oldState.activeProjectId) {
                this.onProjectChange(newState.activeProjectId);
            }
        });
        
        // Show panel if user is authenticated (mirror OutlineBuilder pattern)
        if (this.authService.isAuthenticated() && this.container) {
            this.container.classList.add('visible');
        }
        
        this.render();
        console.log('✅ [SourcesPanel] Initialized');
    }
    
    /**
     * Handle project change - load sources for new project
     */
    async onProjectChange(projectId) {
        // Cancel any pending saves before project change to avoid race conditions
        this.cancelPendingSave();
        
        if (!projectId) {
            this.sources = [];
            this.currentProjectId = null;
            this.render();
            return;
        }
        
        // ALWAYS preserve current sources before loading (even when switching between projects)
        // This prevents data loss when switching projects mid-research
        const stagedSources = this.sources.map(s => s.source_data || s);
        
        this.currentProjectId = projectId;
        await this.loadSources(projectId);
        
        // Merge staged sources with loaded sources (dedupe using composite key)
        // Merge whenever we have staged sources - deduplication handles overlap
        if (stagedSources.length > 0) {
            console.log(`📚 [SourcesPanel] Merging ${stagedSources.length} staged sources into loaded project ${projectId}`);
            
            // Use same deduplication logic as handleNewSources
            const sourceMap = new Map();
            
            const getSourceKey = (source) => {
                const url = source.url || '';
                const title = source.title || '';
                const excerpt = (source.excerpt || '').substring(0, 50);
                return `${url}|||${title}|||${excerpt}`;
            };
            
            // Add loaded sources first
            this.sources.forEach((s, idx) => {
                const sourceData = s.source_data || s;
                const key = getSourceKey(sourceData);
                sourceMap.set(key, { source_data: sourceData, order_index: idx });
            });
            
            // Merge staged sources (avoid duplicates)
            let nextIndex = this.sources.length;
            stagedSources.forEach(source => {
                const key = getSourceKey(source);
                if (!sourceMap.has(key)) {
                    sourceMap.set(key, { source_data: source, order_index: nextIndex++ });
                }
            });
            
            // Update with merged sources
            this.sources = Array.from(sourceMap.values());
            
            // Update ProjectStore
            const sourcesData = this.sources.map(s => s.source_data);
            this.projectStore.setSources(sourcesData);
            
            // Save merged sources to backend
            if (this.authService.isAuthenticated()) {
                this.debouncedSave();
            }
            
            // Re-render with merged sources
            this.render();
        }
    }
    
    /**
     * Load sources from backend for a project
     */
    async loadSources(projectId) {
        if (!this.authService.isAuthenticated() || !projectId) {
            return;
        }
        
        try {
            const data = await this.apiService.get(`/api/projects/${projectId}/sources`);
            this.sources = data.sources || [];
            
            // Update ProjectStore with loaded sources
            const sourcesData = this.sources.map(s => s.source_data);
            this.projectStore.setSources(sourcesData);
            
            console.log(`✅ [SourcesPanel] Loaded ${this.sources.length} sources for project ${projectId}`);
            this.render();
            
        } catch (error) {
            console.error('❌ [SourcesPanel] Error loading sources:', error);
        }
    }
    
    /**
     * Handle new sources from research results
     */
    handleNewSources(newSources) {
        if (!Array.isArray(newSources) || newSources.length === 0) {
            return;
        }
        
        console.log(`📚 [SourcesPanel] Received ${newSources.length} new sources`);
        
        // Merge with existing sources (avoid duplicates using stable composite key)
        const sourceMap = new Map();
        
        // Helper to create stable key from source
        const getSourceKey = (source) => {
            const url = source.url || '';
            const title = source.title || '';
            const excerpt = (source.excerpt || '').substring(0, 50);  // First 50 chars
            return `${url}|||${title}|||${excerpt}`;
        };
        
        // Add existing sources
        this.sources.forEach((s, idx) => {
            const sourceData = s.source_data || s;
            const key = getSourceKey(sourceData);
            sourceMap.set(key, { source_data: sourceData, order_index: idx });
        });
        
        // Add new sources (avoid duplicates)
        let nextIndex = this.sources.length;
        newSources.forEach(source => {
            const key = getSourceKey(source);
            if (!sourceMap.has(key)) {
                sourceMap.set(key, { source_data: source, order_index: nextIndex++ });
            }
        });
        
        // Convert back to array
        this.sources = Array.from(sourceMap.values());
        
        // Update ProjectStore
        const sourcesData = this.sources.map(s => s.source_data);
        this.projectStore.setSources(sourcesData);
        
        // Save to backend (only if project is active)
        if (this.currentProjectId && this.authService.isAuthenticated()) {
            this.debouncedSave();
        } else {
            console.log('📚 [SourcesPanel] Sources staged in-memory (no active project yet)');
        }
        
        // Always re-render to show sources in panel
        this.render();
        
        // Show panel when sources are added
        if (this.sources.length > 0 && this.container) {
            this.container.classList.add('visible');
        }
    }
    
    /**
     * Debounced save to backend
     * Only saves when both auth and project are active
     */
    debouncedSave() {
        // ALWAYS clear existing timer first (prevents stale saves)
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        
        // Gate: Only save when both authenticated AND project is active
        if (!this.authService.isAuthenticated() || !this.currentProjectId) {
            console.log('📚 [SourcesPanel] Skipping save - no auth or no active project');
            return;
        }
        
        const projectIdToSave = this.currentProjectId;
        const sourcesToSave = [...this.sources];
        
        this.saveTimeout = setTimeout(() => {
            this.saveToBackend(projectIdToSave, sourcesToSave);
        }, 1000);
    }
    
    /**
     * Cancel any pending saves (called before project changes)
     */
    cancelPendingSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
            console.log('📚 [SourcesPanel] Cancelled pending save');
        }
    }
    
    /**
     * Save sources to backend
     */
    async saveToBackend(projectId, sources) {
        if (!projectId || !this.authService.isAuthenticated()) {
            return;
        }
        
        // Guard: Abort if project changed since save was scheduled
        if (this.currentProjectId !== projectId) {
            console.log('Project changed since save scheduled, aborting save');
            return;
        }
        
        this.isSaving = true;
        
        try {
            await this.apiService.put(`/api/projects/${projectId}/sources`, {
                sources: sources
            });
            
            console.log(`✅ [SourcesPanel] Saved ${sources.length} sources`);
            
        } catch (error) {
            console.error('❌ [SourcesPanel] Error saving sources:', error);
            if (this.toastManager) {
                this.toastManager.show('Failed to save sources', 'error');
            }
        } finally {
            this.isSaving = false;
        }
    }
    
    /**
     * Render the sources panel
     */
    render() {
        if (!this.container) return;
        
        const sourcesData = this.sources.map(s => s.source_data || s);
        
        this.container.innerHTML = `
            <div class="sources-panel-header">
                <h3>Research Sources</h3>
                <span class="source-count">${sourcesData.length} sources</span>
            </div>
            <div class="sources-list" id="sources-list">
                ${sourcesData.length === 0 ? this.renderEmptyState() : ''}
            </div>
        `;
        
        // Render source cards
        if (sourcesData.length > 0) {
            const sourcesList = document.getElementById('sources-list');
            const sourceCardFactory = window.SourceCard ? new window.SourceCard(this.appState) : null;
            
            if (!sourceCardFactory) {
                console.error('❌ SourceCard component not available');
                return;
            }
            
            sourcesData.forEach(source => {
                const card = sourceCardFactory.create(source, {
                    showCheckbox: false,
                    showActions: true
                });
                sourcesList.appendChild(card);
            });
        }
    }
    
    /**
     * Render empty state
     */
    renderEmptyState() {
        return `
            <div class="sources-empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                <p>No sources yet</p>
                <span>Sources from your research will appear here</span>
            </div>
        `;
    }
    
    /**
     * Set project (called when loading a project)
     */
    async setProject(projectId) {
        this.currentProjectId = projectId;
        await this.loadSources(projectId);
    }
}
