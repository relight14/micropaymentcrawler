/**
 * OutlineBuilder Component
 * Manages research outline structure with drag-and-drop source organization
 * Allows users to create custom sections and assign sources to them
 */

import { analytics } from '../utils/analytics.js';
import { projectStore } from '../state/project-store.js';
import { AppEvents } from '../utils/event-bus.js';

export class OutlineBuilder extends EventTarget {
    constructor({ apiService, authService, toastManager }) {
        super();
        this.apiService = apiService;
        this.authService = authService;
        this.toastManager = toastManager;
        this.currentProjectId = null;
        this.selectedSources = [];
        this.sections = [];
        this.isSaving = false;
        this.saveTimeout = null;
        this.isCollapsed = false;
    }

    /**
     * Initialize persistent event listeners using event delegation
     * Called once when component is created - survives all re-renders
     */
    init() {
        const container = document.getElementById('outline-builder');
        if (!container) {
            console.warn('⚠️ OutlineBuilder container not found during init');
            return;
        }

        // Event delegation: Listen on persistent container, not individual buttons
        // This survives innerHTML replacements in render()
        container.addEventListener('click', (e) => {
            // Build Research Packet button
            if (e.target.id === 'build-packet-btn' || e.target.closest('#build-packet-btn')) {
                console.log('🔘 Build Packet button clicked via delegation!');
                this.handleBuildResearchPacket();
                return;
            }

            // Outline toggle button
            if (e.target.id === 'outline-toggle-btn' || e.target.closest('#outline-toggle-btn')) {
                this.toggleCollapse();
                return;
            }

            // Add section button
            if (e.target.id === 'add-section-btn' || e.target.closest('#add-section-btn')) {
                this.addSection();
                return;
            }

            // File upload button
            if (e.target.id === 'upload-file-btn' || e.target.closest('#upload-file-btn')) {
                const fileInput = document.getElementById('file-upload-input');
                if (fileInput) fileInput.click();
                return;
            }

            // Section move buttons
            const moveBtnTarget = e.target.closest('.section-move-btn');
            if (moveBtnTarget) {
                const index = parseInt(moveBtnTarget.dataset.index);
                const direction = moveBtnTarget.dataset.direction;
                this.moveSection(index, direction);
                return;
            }

            // Section delete buttons
            const deleteBtnTarget = e.target.closest('.section-delete-btn');
            if (deleteBtnTarget) {
                const index = parseInt(deleteBtnTarget.dataset.index);
                this.deleteSection(index);
                return;
            }

            // Remove source buttons
            const removeSourceTarget = e.target.closest('.remove-source-btn');
            if (removeSourceTarget) {
                const sectionIndex = parseInt(removeSourceTarget.dataset.sectionIndex);
                const sourceIndex = parseInt(removeSourceTarget.dataset.sourceIndex);
                this.removeSourceFromSection(sectionIndex, sourceIndex);
                return;
            }
        });

        console.log('✅ OutlineBuilder persistent listeners initialized via delegation');
    }

    /**
     * Toggle outline builder collapsed state
     */
    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        const container = document.getElementById('outline-builder');
        if (container) {
            container.classList.toggle('collapsed', this.isCollapsed);
        }
        this.render();
    }

    /**
     * Set the current project
     */
    async setProject(projectId, projectData) {
        this.currentProjectId = projectId;
        
        // If no project (logout scenario), clear sections
        if (!projectId) {
            this.sections = [];
            this.selectedSources = [];
            projectStore.setSelectedSources([]);
            console.log(`[Sync] Cleared selected sources from ProjectStore (logout)`);
            this.render();
            return;
        }
        
        // Has project - use its outline or fetch AI suggestions
        if (projectData && projectData.outline && projectData.outline.length > 0) {
            this.sections = projectData.outline;
            
            // Extract all sources from outline sections to populate selected sources pool
            const allSources = [];
            const seenIds = new Set();
            
            this.sections.forEach(section => {
                if (section.sources && Array.isArray(section.sources)) {
                    section.sources.forEach(sourceWrapper => {
                        const source = sourceWrapper.source_data;
                        if (source && source.id && !seenIds.has(source.id)) {
                            allSources.push(source);
                            seenIds.add(source.id);
                        }
                    });
                }
            });
            
            // Populate selected sources pool with all sources from outline
            this.selectedSources = allSources;
            
            // Sync to ProjectStore (canonical source of truth)
            projectStore.setSelectedSources(allSources);
            console.log(`[Sync] Loaded ${allSources.length} sources from outline to ProjectStore`);
            
            this.render();
        } else {
            // New project or empty outline - clear sources and fetch AI suggestions
            this.selectedSources = [];
            projectStore.setSelectedSources([]);
            console.log(`[Sync] Cleared selected sources from ProjectStore (new project)`);
            await this.fetchAndApplyAISuggestions();
        }
    }

    /**
     * Get default outline sections for new projects (fallback)
     */
    getDefaultSections() {
        return [
            { id: null, title: 'Background & Context', order_index: 0, sources: [] },
            { id: null, title: 'Key Findings', order_index: 1, sources: [] },
            { id: null, title: 'Analysis & Perspectives', order_index: 2, sources: [] },
            { id: null, title: 'Conclusions', order_index: 3, sources: [] }
        ];
    }

    /**
     * Fetch AI-generated outline suggestions from backend
     */
    async fetchAISuggestions(projectId) {
        if (!projectId) {
            throw new Error('No project ID provided');
        }

        const token = this.authService.getToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(`/api/projects/${projectId}/suggest-outline`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch suggestions: ${response.statusText}`);
        }

        const suggestions = await response.json();
        return suggestions;
    }

    /**
     * Fetch and apply AI suggestions to outline
     * Includes race condition protection for project switching
     */
    async fetchAndApplyAISuggestions() {
        // Capture project ID at invocation time to prevent race conditions
        const initiatingProjectId = this.currentProjectId;
        
        if (!initiatingProjectId) {
            this.sections = this.getDefaultSections();
            this.render();
            return;
        }
        
        try {
            this.updateSaveIndicator('Generating outline...');
            
            // Pass captured ID to API call
            const suggestions = await this.fetchAISuggestions(initiatingProjectId);
            
            // Guard: Bail if project changed while fetching (before mutating state)
            if (this.currentProjectId !== initiatingProjectId) {
                console.log('Project changed during AI fetch, discarding stale suggestions');
                this.updateSaveIndicator('');
                return;
            }
            
            // Convert AI suggestions to outline sections
            this.sections = suggestions.map((suggestion, index) => ({
                id: null,
                title: suggestion.title,
                order_index: index,
                sources: [],
                aiGenerated: true,
                aiRationale: suggestion.rationale
            }));

            this.render();
            this.debouncedSave();
            this.updateSaveIndicator('AI outline ready');
            setTimeout(() => this.updateSaveIndicator(''), 2000);

            analytics.track('ai_outline_generated', {
                project_id: initiatingProjectId,
                section_count: this.sections.length
            });

        } catch (error) {
            // Guard: Only show error if still on same project
            if (this.currentProjectId !== initiatingProjectId) {
                this.updateSaveIndicator('');
                return;
            }
            
            console.error('Error fetching AI suggestions:', error);
            this.toastManager.show('Using default outline - AI suggestions unavailable', 'info');
            this.sections = this.getDefaultSections();
            this.render();
            this.updateSaveIndicator('');
        }
    }

    /**
     * Regenerate AI suggestions (user-triggered)
     * Includes race condition protection for project switching
     */
    async regenerateAISuggestions() {
        if (!confirm('Replace current outline with new AI suggestions? This will keep your sources but reorganize sections.')) {
            return;
        }

        // Capture project ID to prevent cross-project contamination
        const initiatingProjectId = this.currentProjectId;

        // Store current sources to preserve them
        const allSources = [];
        this.sections.forEach(section => {
            allSources.push(...section.sources);
        });

        await this.fetchAndApplyAISuggestions();

        // Guard: Abort if project changed during regeneration
        if (this.currentProjectId !== initiatingProjectId) {
            console.log('Project changed during regeneration, aborting source restoration');
            return;
        }

        // Add all sources back to first section (user can reorganize)
        if (this.sections.length > 0 && allSources.length > 0) {
            this.sections[0].sources = allSources;
            this.render();
            this.debouncedSave();
        }
    }

    /**
     * Handle Build Research Packet button click
     * Switches user to Report Builder tab where they can see purchase options
     */
    handleBuildResearchPacket() {
        console.log('🚀 handleBuildResearchPacket - Switching to Report Builder tab');
        
        // Switch to Report Builder tab by clicking the header button
        const reportModeBtn = document.getElementById('reportModeBtn');
        if (reportModeBtn) {
            reportModeBtn.click();
        } else {
            console.error('❌ Report Builder button not found in header');
            this.toastManager.show('Unable to switch to Report Builder', 'error');
        }
    }

    /**
     * Update selected sources from source manager
     * Auto-categorizes and places new sources into relevant sections
     * CRITICAL: Merges new sources with existing outline sources to prevent data loss
     */
    async setSelectedSources(sources) {
        const incomingSources = sources || [];
        
        // Extract all sources currently embedded in outline sections
        const outlineSources = [];
        const outlineSourceIds = new Set();
        this.sections.forEach(section => {
            if (section.sources && Array.isArray(section.sources)) {
                section.sources.forEach(sourceWrapper => {
                    const source = sourceWrapper.source_data;
                    if (source && source.id && !outlineSourceIds.has(source.id)) {
                        outlineSources.push(source);
                        outlineSourceIds.add(source.id);
                    }
                });
            }
        });
        
        // Merge: Start with outline sources (preserve), then add incoming sources (new selections)
        const mergedSources = [...outlineSources];
        const mergedIds = new Set(outlineSourceIds);
        
        incomingSources.forEach(source => {
            if (!mergedIds.has(source.id)) {
                mergedSources.push(source);
                mergedIds.add(source.id);
            }
        });
        
        // Find truly new sources (not in selectedSources AND not in outline)
        const previousIds = new Set(this.selectedSources.map(s => s.id));
        const newlySelected = incomingSources.filter(s => 
            !previousIds.has(s.id) && !outlineSourceIds.has(s.id)
        );
        
        // Update selectedSources with merged set
        this.selectedSources = mergedSources;
        this.render();
        
        console.log(`[OutlineBuilder] Merged sources: ${outlineSources.length} from outline + ${incomingSources.length} incoming = ${mergedSources.length} total, ${newlySelected.length} truly new`);
        
        // Auto-place only truly new sources into relevant sections
        if (newlySelected.length > 0 && this.sections.length > 0 && this.currentProjectId) {
            await this.autoPlaceNewSources(newlySelected);
        }
    }

    /**
     * Automatically categorize and place new sources into relevant sections using AI
     * Includes race condition protection for project switching
     */
    async autoPlaceNewSources(newSources) {
        // Capture project ID to prevent placing sources in wrong project
        const initiatingProjectId = this.currentProjectId;
        
        for (const source of newSources) {
            try {
                const relevantIndices = await this.categorizeSource(source);
                
                // Guard: Bail if project changed during categorization
                if (this.currentProjectId !== initiatingProjectId) {
                    console.log('Project changed during source categorization, aborting placement');
                    return;
                }
                
                // Add source to each relevant section
                for (const sectionIndex of relevantIndices) {
                    if (sectionIndex < this.sections.length) {
                        this.addSourceToSection(sectionIndex, source, true); // true = AI-placed
                    }
                }
                
            } catch (error) {
                // Guard: Only handle error if still on same project
                if (this.currentProjectId !== initiatingProjectId) {
                    return;
                }
                
                console.error('Error auto-placing source:', error);
                // Fallback: add to first section
                if (this.sections.length > 0) {
                    this.addSourceToSection(0, source, false);
                }
            }
        }
    }

    /**
     * Call AI API to categorize a source into sections
     */
    async categorizeSource(source) {
        const token = this.authService.getToken();
        if (!token || this.sections.length === 0) {
            return [0]; // Fallback to first section
        }

        try {
            const sectionTitles = this.sections.map(s => s.title);
            
            const response = await fetch('/api/sources/categorize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    source_title: source.title || '',
                    source_description: source.description || source.excerpt || '',
                    section_titles: sectionTitles
                })
            });

            if (!response.ok) {
                throw new Error('Categorization failed');
            }

            const result = await response.json();
            return result.relevant_section_indices || [0];
            
        } catch (error) {
            console.error('Error categorizing source:', error);
            return [0]; // Fallback to first section
        }
    }

    /**
     * Add a new section
     */
    addSection() {
        const newSection = {
            id: null,
            title: 'New Section',
            order_index: this.sections.length,
            sources: []
        };
        this.sections.push(newSection);
        this.render();
        this.debouncedSave();

        analytics.track('outline_section_added', {
            project_id: this.currentProjectId,
            section_count: this.sections.length
        });
    }

    /**
     * Delete a section
     */
    deleteSection(index) {
        if (this.sections.length <= 1) {
            this.toastManager.show('Must have at least one section', 'warning');
            return;
        }

        this.sections.splice(index, 1);
        this.sections.forEach((section, i) => {
            section.order_index = i;
        });
        this.render();
        this.debouncedSave();

        analytics.track('outline_section_deleted', {
            project_id: this.currentProjectId,
            section_count: this.sections.length
        });
    }

    /**
     * Update section title
     */
    updateSectionTitle(index, newTitle) {
        if (newTitle && newTitle.trim()) {
            this.sections[index].title = newTitle.trim();
            this.debouncedSave();

            analytics.track('outline_section_renamed', {
                project_id: this.currentProjectId
            });
        }
    }

    /**
     * Move section up or down
     */
    moveSection(index, direction) {
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= this.sections.length) return;

        [this.sections[index], this.sections[newIndex]] = [this.sections[newIndex], this.sections[index]];
        this.sections.forEach((section, i) => {
            section.order_index = i;
        });
        this.render();
        this.debouncedSave();

        analytics.track('outline_section_reordered', {
            project_id: this.currentProjectId
        });
    }

    /**
     * Add source to a section
     */
    addSourceToSection(sectionIndex, sourceData, isAIPlaced = false) {
        const section = this.sections[sectionIndex];
        
        const existingIndex = section.sources.findIndex(s => s.source_data.id === sourceData.id);
        if (existingIndex >= 0) {
            // Source already in section, don't show toast for AI placement
            if (!isAIPlaced) {
                this.toastManager.show('Source already in this section', 'info');
            }
            return;
        }

        section.sources.push({
            source_data: sourceData,
            order_index: section.sources.length,
            aiPlaced: isAIPlaced
        });
        this.render();
        this.debouncedSave();

        analytics.track('outline_source_added', {
            project_id: this.currentProjectId,
            section_index: sectionIndex,
            ai_placed: isAIPlaced
        });
    }

    /**
     * Remove source from a section
     */
    removeSourceFromSection(sectionIndex, sourceIndex) {
        this.sections[sectionIndex].sources.splice(sourceIndex, 1);
        this.sections[sectionIndex].sources.forEach((source, i) => {
            source.order_index = i;
        });
        this.render();
        this.debouncedSave();

        analytics.track('outline_source_removed', {
            project_id: this.currentProjectId,
            section_index: sectionIndex
        });
    }

    /**
     * Debounced save to backend with race condition protection
     * Captures project ID and sections snapshot when scheduled
     */
    debouncedSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        
        // Capture project ID and sections at schedule time
        const projectIdToSave = this.currentProjectId;
        const sectionsToSave = JSON.parse(JSON.stringify(this.sections)); // Deep clone
        
        // CRITICAL: Sync outline to ProjectStore immediately so getOutlineSnapshot() returns current data
        if (this.authService.isAuthenticated() && projectIdToSave) {
            projectStore.setOutline(sectionsToSave);
            console.log(`📋 [OutlineBuilder] Synced ${sectionsToSave.length} sections to ProjectStore`);
        }
        
        this.saveTimeout = setTimeout(() => {
            this.saveToBackend(projectIdToSave, sectionsToSave);
        }, 1000);
    }

    /**
     * Save outline to backend with race condition protection
     * Only saves if still on the same project
     */
    async saveToBackend(projectIdToSave, sectionsToSave) {
        if (!projectIdToSave || !this.authService.isAuthenticated()) {
            return;
        }

        // Guard: Abort if project changed since save was scheduled
        if (this.currentProjectId !== projectIdToSave) {
            console.log('Project changed since save scheduled, aborting save');
            return;
        }

        this.isSaving = true;
        this.updateSaveIndicator('Saving...');

        try {
            const response = await fetch(`/api/projects/${projectIdToSave}/outline`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authService.getToken()}`
                },
                body: JSON.stringify({
                    sections: sectionsToSave
                })
            });

            if (response.ok) {
                this.updateSaveIndicator('Saved');
                setTimeout(() => this.updateSaveIndicator(''), 2000);
            } else if (response.status === 401) {
                this.authService.handleUnauthorized();
            } else {
                this.updateSaveIndicator('Error saving');
                this.toastManager.show('Failed to save outline', 'error');
            }
        } catch (error) {
            console.error('Error saving outline:', error);
            this.updateSaveIndicator('Error saving');
            this.toastManager.show('Failed to save outline', 'error');
        } finally {
            this.isSaving = false;
        }
    }

    /**
     * Update save status indicator
     */
    updateSaveIndicator(text) {
        const indicator = document.getElementById('outline-save-indicator');
        if (indicator) {
            indicator.textContent = text;
            indicator.className = 'save-indicator';
            if (text === 'Saved') {
                indicator.classList.add('success');
            } else if (text.includes('Error')) {
                indicator.classList.add('error');
            }
        }
    }

    /**
     * Handle file upload
     */
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // Validate file type
        const allowedExtensions = ['.md', '.doc', '.docx'];
        const fileExt = '.' + file.name.split('.').pop().toLowerCase();
        
        if (!allowedExtensions.includes(fileExt)) {
            this.toastManager.show(`Invalid file type. Allowed: ${allowedExtensions.join(', ')}`, 'error');
            event.target.value = '';
            return;
        }

        // Validate file size (10MB)
        if (file.size > 10 * 1024 * 1024) {
            this.toastManager.show('File too large. Maximum size: 10MB', 'error');
            event.target.value = '';
            return;
        }

        if (!this.currentProjectId) {
            this.toastManager.show('Please select a project first', 'error');
            event.target.value = '';
            return;
        }

        try {
            this.updateSaveIndicator('Uploading...');
            
            const formData = new FormData();
            formData.append('file', file);
            formData.append('project_id', this.currentProjectId);

            const response = await fetch('/api/files/upload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.authService.getToken()}`
                },
                body: formData
            });

            if (!response.ok) {
                if (response.status === 401) {
                    this.authService.handleUnauthorized();
                    return;
                }
                const error = await response.json();
                throw new Error(error.detail || 'Upload failed');
            }

            const uploadedFile = await response.json();
            
            // Add uploaded file to selected sources pool as a special source type
            const fileSource = {
                id: `file_${uploadedFile.id}`,
                title: uploadedFile.filename,
                url: null,
                source_type: 'document',
                file_id: uploadedFile.id,
                file_type: uploadedFile.file_type,
                content_preview: uploadedFile.content_preview,
                is_uploaded_file: true
            };

            this.selectedSources.push(fileSource);
            this.updateSaveIndicator('Uploaded');
            setTimeout(() => this.updateSaveIndicator(''), 2000);
            this.toastManager.show(`File "${file.name}" uploaded successfully`, 'success');
            this.render();
            
        } catch (error) {
            console.error('Error uploading file:', error);
            this.updateSaveIndicator('');
            this.toastManager.show(error.message || 'Failed to upload file', 'error');
        } finally {
            event.target.value = '';
        }
    }

    /**
     * Get outline structure for report generation
     */
    getOutlineStructure() {
        return {
            sections: this.sections.map(section => ({
                title: section.title,
                sources: section.sources.map(s => s.source_data)
            }))
        };
    }

    /**
     * Setup resize handle for outline builder
     */
    setupResizeHandle(handle) {
        const container = document.getElementById('outline-builder');
        const MIN_WIDTH = 250;
        const MAX_WIDTH = 600;
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = container.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const deltaX = startX - e.clientX;
            const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + deltaX));
            
            container.style.width = `${newWidth}px`;
            container.style.minWidth = `${newWidth}px`;
            container.style.maxWidth = `${newWidth}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }

    /**
     * Render the outline builder
     */
    render() {
        const container = document.getElementById('outline-builder');
        if (!container) return;

        // Not authenticated - hide the panel completely
        if (!this.authService.isAuthenticated()) {
            container.classList.remove('visible');
            container.innerHTML = '';  // Clear content completely
            return;
        }

        // Check if there's any meaningful content to show
        const hasContent = this.currentProjectId || 
                          (this.selectedSources && this.selectedSources.length > 0) ||
                          (this.sections && this.sections.some(s => s.sources && s.sources.length > 0));

        // Hide if no content to show
        if (!hasContent) {
            container.classList.remove('visible');
            container.innerHTML = '';
            return;
        }

        // Authenticated and has content - show outline with .visible class for CSS
        container.classList.add('visible');  // CSS uses this to show outline across all breakpoints

        // Authenticated but no project - show default template
        if (!this.currentProjectId) {
            if (!this.sections || this.sections.length === 0) {
                this.sections = this.getDefaultSections();
            }
        }

        // If still no sections (edge case), initialize with defaults
        if (!this.sections || this.sections.length === 0) {
            this.sections = this.getDefaultSections();
        }

        container.innerHTML = `
            <div class="resize-handle" id="outline-resize-handle"></div>
            <div class="outline-builder">
                <div class="outline-header">
                    ${!this.isCollapsed ? `
                        <div>
                            <h3>Research Outline</h3>
                            <p class="outline-prompt">Build a research packet based on this outline</p>
                            <button class="build-packet-btn" id="build-packet-btn" title="Generate a comprehensive research report">
                                📊 Build Research Packet
                            </button>
                        </div>
                        <span class="save-indicator" id="outline-save-indicator"></span>
                    ` : ''}
                    <button class="outline-toggle-btn" id="outline-toggle-btn">
                        ${this.isCollapsed ? '◀' : '▶'}
                    </button>
                </div>

                ${!this.isCollapsed ? `
                    <div class="selected-sources-pool">
                        <div class="pool-header">
                            <span class="pool-title">Selected Sources (${this.selectedSources.length})</span>
                        </div>
                        <div class="source-chips">
                            ${this.selectedSources.length === 0 ? `
                                <div class="empty-pool">
                                    <p>No sources selected</p>
                                    <p class="hint">Select sources from the search results to organize them</p>
                                </div>
                            ` : this.selectedSources.map(source => `
                                <div class="source-chip" 
                                     draggable="true" 
                                     data-source-id="${source.id}"
                                     data-source-json='${JSON.stringify(source).replace(/'/g, "&apos;")}'>
                                    <span class="source-chip-icon">${this.getSourceIcon(source.source_type)}</span>
                                    <span class="source-chip-title">${this.escapeHtml(source.title || source.url)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="outline-sections">
                        ${this.sections.map((section, index) => `
                            <div class="outline-section" data-section-index="${index}">
                                <div class="section-header">
                                    <input 
                                        type="text" 
                                        class="section-title-input" 
                                        value="${this.escapeHtml(section.title)}"
                                        data-section-index="${index}"
                                        placeholder="Section title"
                                    />
                                    <div class="section-controls">
                                        ${this.sections.length > 1 && index > 0 ? `
                                            <button class="section-move-btn" data-index="${index}" data-direction="up" title="Move up">
                                                ▲
                                            </button>
                                        ` : ''}
                                        ${this.sections.length > 1 && index < this.sections.length - 1 ? `
                                            <button class="section-move-btn" data-index="${index}" data-direction="down" title="Move down">
                                                ▼
                                            </button>
                                        ` : ''}
                                        <button class="section-delete-btn" data-index="${index}" title="Delete section">
                                            ✕
                                        </button>
                                    </div>
                                </div>
                                <div class="section-drop-zone" data-section-index="${index}">
                                    ${section.sources.length === 0 ? `
                                        <div class="drop-placeholder">Drop sources here</div>
                                    ` : section.sources.map((source, sourceIndex) => `
                                        <div class="section-source">
                                            <span class="source-icon">${this.getSourceIcon(source.source_data.source_type)}</span>
                                            <span class="source-title">${this.escapeHtml(source.source_data.title || source.source_data.url)}</span>
                                            <button class="remove-source-btn" data-section-index="${index}" data-source-index="${sourceIndex}">
                                                ✕
                                            </button>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <input type="file" id="file-upload-input" accept=".md,.doc,.docx" style="display: none;" />
                    <button class="upload-file-btn" id="upload-file-btn" title="Upload document (.md, .doc, .docx)">
                        Upload your own docs
                    </button>

                    <button class="add-section-btn" id="add-section-btn">
                        + Add Section
                    </button>
                ` : ''}
            </div>
        `;

        this.attachEventListeners();
        this.setupDragAndDrop();
    }

    /**
     * Get icon for source type
     */
    getSourceIcon(sourceType) {
        const icons = {
            'news': '📰',
            'academic': '🎓',
            'blog': '📝',
            'social': '💬',
            'video': '🎥',
            'document': '📄',
            'other': '🔗'
        };
        return icons[sourceType] || icons['other'];
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Attach event listeners
     * NOTE: Most buttons use event delegation via init() to survive re-renders
     * Only attach listeners here for elements that need special handling
     */
    attachEventListeners() {
        // File upload input (needs special handling for 'change' event)
        const fileInput = document.getElementById('file-upload-input');
        if (fileInput) {
            // Remove old listener to avoid duplicates
            fileInput.replaceWith(fileInput.cloneNode(true));
            const newFileInput = document.getElementById('file-upload-input');
            newFileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        }

        // Resize handle (needs special drag event handling)
        const resizeHandle = document.getElementById('outline-resize-handle');
        if (resizeHandle) {
            this.setupResizeHandle(resizeHandle);
        }

        // Section title inputs (need blur and keydown events)
        document.querySelectorAll('.section-title-input').forEach(input => {
            input.addEventListener('blur', (e) => {
                const index = parseInt(e.target.dataset.sectionIndex);
                this.updateSectionTitle(index, e.target.value);
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.target.blur();
                }
            });
        });
    }

    /**
     * Setup drag and drop functionality
     */
    setupDragAndDrop() {
        document.querySelectorAll('.source-chip').forEach(chip => {
            chip.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('source-data', chip.dataset.sourceJson);
                chip.classList.add('dragging');
            });

            chip.addEventListener('dragend', (e) => {
                chip.classList.remove('dragging');
            });
        });

        document.querySelectorAll('.section-drop-zone').forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', (e) => {
                zone.classList.remove('drag-over');
            });

            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');

                const sourceData = JSON.parse(e.dataTransfer.getData('source-data'));
                const sectionIndex = parseInt(zone.dataset.sectionIndex);
                this.addSourceToSection(sectionIndex, sourceData);
            });
        });
    }
}
