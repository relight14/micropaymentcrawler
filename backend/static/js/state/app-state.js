/**
 * Application State Management
 * Extracted from the monolithic ChatResearchApp
 */
export class AppState {
    constructor() {
        // Core state
        this.currentMode = 'chat';
        this.conversationHistory = [];
        this.selectedSources = [];
        this.currentResearchData = null;
        this.purchasedItems = new Set();
        this.pendingAction = null;
        
        // UI state
        this.isDarkMode = localStorage.getItem('darkMode') === 'true';
        this.isLoginMode = true;
        this.currentQuery = '';
        
        // Initialize dark mode
        if (this.isDarkMode) {
            document.documentElement.classList.add('dark');
        }
    }

    // Mode management
    setMode(mode) {
        if (this.currentMode === mode) return false;
        
        this.currentMode = mode;
        return true;
    }

    getMode() {
        return this.currentMode;
    }

    // Conversation management
    addMessage(sender, content, metadata = null) {
        const message = {
            id: Date.now() + Math.random(),
            sender,
            content,
            metadata,
            timestamp: new Date()
        };
        
        this.conversationHistory.push(message);
        return message;
    }

    clearConversation() {
        this.conversationHistory = [];
        this.selectedSources = [];
        this.currentResearchData = null;
        this.pendingAction = null;
    }

    getConversationHistory() {
        return [...this.conversationHistory]; // Return copy
    }

    // Source management
    toggleSourceSelection(sourceId, sourceData) {
        const existingIndex = this.selectedSources.findIndex(s => s.id === sourceId);
        
        if (existingIndex >= 0) {
            this.selectedSources.splice(existingIndex, 1);
            return false; // Deselected
        } else {
            this.selectedSources.push({
                id: sourceId,
                ...sourceData,
                selectedAt: new Date()
            });
            return true; // Selected
        }
    }

    isSourceSelected(sourceId) {
        return this.selectedSources.some(s => s.id === sourceId);
    }

    getSelectedSources() {
        return [...this.selectedSources]; // Return copy
    }

    getSelectedSourcesCount() {
        return this.selectedSources.length;
    }

    getSelectedSourcesTotal() {
        return this.selectedSources.reduce((total, source) => {
            // Use unlock_price which is the actual field in source data
            return total + (source.unlock_price || source.price || 0);
        }, 0);
    }

    removeSelectedSource(sourceId) {
        this.selectedSources = this.selectedSources.filter(s => s.id !== sourceId);
    }

    canAddMoreSources(tierType) {
        const limits = { basic: 3, research: 8, pro: 15 };
        return this.selectedSources.length < (limits[tierType] || 3);
    }

    // Dark mode management
    toggleDarkMode() {
        this.isDarkMode = !this.isDarkMode;
        localStorage.setItem('darkMode', this.isDarkMode.toString());
        
        if (this.isDarkMode) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        
        return this.isDarkMode;
    }

    isDarkModeEnabled() {
        return this.isDarkMode;
    }

    // Research data management
    setCurrentResearchData(data) {
        this.currentResearchData = data;
    }

    getCurrentResearchData() {
        return this.currentResearchData;
    }

    // Purchased items tracking
    addPurchasedItem(itemId) {
        this.purchasedItems.add(itemId);
    }

    isPurchased(itemId) {
        return this.purchasedItems.has(itemId);
    }

    // Auth mode management
    setLoginMode(isLogin) {
        this.isLoginMode = isLogin;
    }

    isInLoginMode() {
        return this.isLoginMode;
    }

    // Pending action management
    setPendingAction(action) {
        this.pendingAction = action;
    }

    getPendingAction() {
        return this.pendingAction;
    }

    clearPendingAction() {
        this.pendingAction = null;
    }

    // Query management
    setCurrentQuery(query) {
        this.currentQuery = query;
    }

    getCurrentQuery() {
        return this.currentQuery;
    }
}