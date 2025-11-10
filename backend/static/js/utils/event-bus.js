export const AppEvents = new EventTarget();

export const EVENT_TYPES = {
    SOURCE_UNLOCKED: 'sourceUnlocked',
    SOURCE_UNLOCK_ERROR: 'sourceUnlockError',
    SOURCE_SELECTED: 'sourceSelected',
    SOURCE_DESELECTED: 'sourceDeselected',
    BUDGET_WARNING: 'budgetWarning',
    TIER_PURCHASED: 'tierPurchased',
    TIER_PURCHASE_ERROR: 'tierPurchaseError',
    REPORT_REQUESTED: 'reportRequested',
    REPORT_STATUS_CHANGED: 'reportStatusChanged',
    
    // Project events
    PROJECT_CREATED: 'projectCreated',
    PROJECT_LOADED: 'projectLoaded',
    PROJECT_SWITCHED: 'projectSwitched',
    PROJECT_DELETED: 'projectDeleted',
    PROJECT_UPDATED: 'projectUpdated',
    
    // Outline events
    OUTLINE_UPDATED: 'outlineUpdated',
    OUTLINE_SECTION_ADDED: 'outlineSectionAdded',
    OUTLINE_SECTION_DELETED: 'outlineSectionDeleted',
    OUTLINE_SOURCE_ADDED: 'outlineSourceAdded',
    OUTLINE_SOURCE_REMOVED: 'outlineSourceRemoved',
    
    // Sources selection
    SOURCES_SELECTION_CHANGED: 'sourcesSelectionChanged'
};
