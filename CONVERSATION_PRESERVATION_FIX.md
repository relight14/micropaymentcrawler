# Conditional Conversation Clearing Implementation

## Problem Statement
When users created new projects, the previous project's outline and chat history would briefly appear before being cleared, causing a confusing user experience. Additionally, the login migration flow needed to preserve pre-login chat while properly handling project outlines.

## Solution Overview
Implemented a `preserveConversation` flag that threads through the entire project creation and loading flow, enabling different behaviors for user-initiated actions vs. login migration.

## Key Changes

### 1. Event Listener Setup (project-manager.js)
All event listeners now properly destructure event details with default values:

```javascript
// projectCreated event
this.sidebar.addEventListener('projectCreated', (e) => {
    const { project, preserveConversation = false } = e.detail;
    this.handleProjectCreated(project, { preserveConversation });
});

// projectLoadingStarted event
this.sidebar.addEventListener('projectLoadingStarted', (e) => {
    const { projectId, projectTitle, preserveConversation = false } = e.detail;
    this.handleProjectLoadingStarted(projectId, projectTitle, preserveConversation);
});

// projectLoaded event
this.sidebar.addEventListener('projectLoaded', (e) => {
    const { projectData, preserveConversation = false } = e.detail;
    this.handleProjectLoaded(projectData, preserveConversation);
});
```

### 2. Conditional Clearing in handleProjectCreated()
```javascript
if (!preserveConversation) {
    // User-initiated new project: full reset
    this.clearChatInterface();
    this.appState.clearConversation();
    projectStore.setOutline(projectStore.getDefaultOutline());
    this.outlineBuilder.setProject(project.id, { outline: [] });
} else {
    // Login migration: preserve state, let loadProject() fetch data
}
```

### 3. Immediate Outline Render (outline-builder.js)
```javascript
setProject(projectId, projectData) {
    // Clear sections and render immediately BEFORE async AI fetch
    this.sections = [];
    this.render();
    
    // Then fetch AI suggestions in background
    if (!projectData?.outline?.length) {
        await this.fetchAndApplyAISuggestions(projectId);
    }
}
```

### 4. Login Flow Project Reuse (project-manager.js)
```javascript
const existing = this._findExistingProjectByTitle(candidateTitle);
if (existing) {
    newProjectId = existing.id;
    // Will be loaded with preserveConversation flag below
}

// Common loading path for both new and reused projects
if (newProjectId) {
    await this.sidebar.loadProject(newProjectId, { preserveConversation: true });
}
```

### 5. Outline Restoration in handleProjectLoaded()
```javascript
// Always set outline from fetched data
projectStore.setOutline(projectData.outline);
this.outlineBuilder.setProject(projectData.id, projectData);

// Conditionally load messages
if (!preserveConversation) {
    this.appState.clearConversation();
    await this.loadProjectMessages(projectData.id);
} else {
    // Skip loading - messages already in UI from pre-login chat
}
```

### 6. Event Passing in ProjectListSidebar
```javascript
createProject(title, researchQuery = null, options = {}) {
    const { preserveConversation = false } = options;
    // ...
    this.dispatchEvent(new CustomEvent('projectCreated', {
        detail: { project: newProject, preserveConversation }
    }));
}

loadProject(projectId, options = {}) {
    const { preserveConversation = false } = options;
    // ...
    this.dispatchEvent(new CustomEvent('projectLoadingStarted', {
        detail: { projectId, projectTitle, preserveConversation }
    }));
    // ...
    this.dispatchEvent(new CustomEvent('projectLoaded', {
        detail: { projectData, preserveConversation }
    }));
}
```

## User Flows

### Flow 1: User-Initiated New Project
1. User clicks "New Project" → `createProject(title)` with default `preserveConversation: false`
2. `projectCreated` event fires
3. `handleProjectCreated()` immediately clears chat and outline
4. `OutlineBuilder.setProject()` renders empty state instantly
5. AI suggestions load asynchronously in background

**Result:** Instant visual clearing, no flash of previous content

### Flow 2: Login Migration - New Project
1. User logs in with pre-login chat
2. System creates project: `createProject(title, query, {preserveConversation: true})`
3. `handleProjectCreated()` skips all clearing
4. System calls `loadProject(id, {preserveConversation: true})`
5. `handleProjectLoaded()` sets outline from server (empty → triggers AI)
6. Messages preserved from pre-login chat

**Result:** Chat preserved, outline loaded from server

### Flow 3: Login Migration - Existing Project Reuse
1. User logs in with pre-login chat
2. System finds existing project by title
3. System calls `loadProject(existingId, {preserveConversation: true})`
4. `handleProjectLoaded()` sets outline from server (existing sections)
5. Messages preserved from pre-login chat

**Result:** Both chat and existing outline preserved

## Benefits

1. **No Visual Flash:** Outline clears instantly before async operations
2. **Proper State Management:** No desync between store and UI
3. **Login Preservation:** Pre-login chat survives migration correctly
4. **Project Reuse:** Existing projects keep their outlines during login
5. **Clean UX:** User-initiated actions feel instant and responsive

## Testing Recommendations

1. Create new project as logged-in user → verify instant clear
2. Research as guest → log in → verify chat preserved in new project
3. Research as guest → log in with existing project title → verify both chat and outline preserved
4. Switch between projects → verify no flash of previous content
5. Create project while another is active → verify previous outline doesn't appear
