export const AppEvents = new EventTarget();

export const EVENT_TYPES = {
    SOURCE_UNLOCKED: 'sourceUnlocked',
    SOURCE_UNLOCK_ERROR: 'sourceUnlockError',
    SOURCE_SELECTED: 'sourceSelected',
    SOURCE_DESELECTED: 'sourceDeselected',
    BUDGET_WARNING: 'budgetWarning',
    TIER_PURCHASED: 'tierPurchased',
    TIER_PURCHASE_ERROR: 'tierPurchaseError',
    REPORT_REQUESTED: 'reportRequested'
};
