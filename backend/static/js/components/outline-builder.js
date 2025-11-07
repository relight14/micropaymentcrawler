/**
 * OutlineBuilder Component
 * Manages research outline structure with drag-and-drop source organization
 * Allows users to create custom sections and assign sources to them
 */

import { analytics } from '../utils/analytics.js';

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
    }

    /**
     * Set the current project
     */
    setProject(projectId, projectData) {
        this.currentProjectId = projectId;
        
        // If no project (logout scenario), clear sections
        if (!projectId) {
            this.sections = [];
            this.render();
            return;
        }
        
        // Has project - use its outline or defaults
        if (projectData && projectData.outline) {
            this.sections = projectData.outline;
        } else {
            this.sections = this.getDefaultSections();
        }
        this.render();
    }

    /**
     * Get default outline sections for new projects
     */
    getDefaultSections() {
        return [
            { id: null, title: 'Introduction', order_index: 0, sources: [] },
            { id: null, title: 'Key Findings', order_index: 1, sources: [] },
            { id: null, title: 'Conclusion', order_index: 2, sources: [] }
        ];
    }

    /**
     * Update selected sources from source manager
     */
    setSelectedSources(sources) {
        this.selectedSources = sources || [];
        this.render();
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
    addSourceToSection(sectionIndex, sourceData) {
        const section = this.sections[sectionIndex];
        
        const existingIndex = section.sources.findIndex(s => s.source_data.id === sourceData.id);
        if (existingIndex >= 0) {
            this.toastManager.show('Source already in this section', 'info');
            return;
        }

        section.sources.push({
            source_data: sourceData,
            order_index: section.sources.length
        });
        this.render();
        this.debouncedSave();

        analytics.track('outline_source_added', {
            project_id: this.currentProjectId,
            section_index: sectionIndex
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
     * Debounced save to backend
     */
    debouncedSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        
        this.saveTimeout = setTimeout(() => {
            this.saveToBackend();
        }, 1000);
    }

    /**
     * Save outline to backend
     */
    async saveToBackend() {
        if (!this.currentProjectId || !this.authService.isAuthenticated()) {
            return;
        }

        this.isSaving = true;
        this.updateSaveIndicator('Saving...');

        try {
            const response = await fetch(`/api/projects/${this.currentProjectId}/outline`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authService.getToken()}`
                },
                body: JSON.stringify({
                    sections: this.sections
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

        // Not authenticated - show empty state
        if (!this.authService.isAuthenticated()) {
            container.innerHTML = `
                <div class="outline-builder">
                    <div class="outline-header">
                        <h3>Research Outline</h3>
                    </div>
                    <div class="empty-outline-state">
                        <p>📝</p>
                        <p>Log in to organize sources with custom outlines</p>
                    </div>
                </div>
            `;
            return;
        }

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
                    <h3>Research Outline</h3>
                    <span class="save-indicator" id="outline-save-indicator"></span>
                </div>

                <div class="selected-sources-pool">
                    <div class="pool-header">
                        <span class="pool-title">Selected Sources (${this.selectedSources.length})</span>
                        <button class="upload-file-btn" id="upload-file-btn" title="Upload document (.md, .doc)">
                            📄 Upload
                        </button>
                    </div>
                    <input type="file" id="file-upload-input" accept=".md,.doc,.docx" style="display: none;" />
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

                <button class="add-section-btn" id="add-section-btn">
                    + Add Section
                </button>
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
     */
    attachEventListeners() {
        const addSectionBtn = document.getElementById('add-section-btn');
        if (addSectionBtn) {
            addSectionBtn.addEventListener('click', () => this.addSection());
        }

        // File upload button
        const uploadBtn = document.getElementById('upload-file-btn');
        const fileInput = document.getElementById('file-upload-input');
        if (uploadBtn && fileInput) {
            uploadBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        }

        // Resize handle
        const resizeHandle = document.getElementById('outline-resize-handle');
        if (resizeHandle) {
            this.setupResizeHandle(resizeHandle);
        }

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

        document.querySelectorAll('.section-move-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                const direction = btn.dataset.direction;
                this.moveSection(index, direction);
            });
        });

        document.querySelectorAll('.section-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(btn.dataset.index);
                this.deleteSection(index);
            });
        });

        document.querySelectorAll('.remove-source-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sectionIndex = parseInt(btn.dataset.sectionIndex);
                const sourceIndex = parseInt(btn.dataset.sourceIndex);
                this.removeSourceFromSection(sectionIndex, sourceIndex);
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
