/**
 * Application State Management
 * Extracted from the monolithic ChatResearchApp
 */
export class AppState {
    constructor() {
        // Configuration constants for maintainability
        this.TIER_LIMITS = {
            basic: 3,
            research: 8, 
            pro: 15,
            default: 3
        };
        
        // Core state with persistence
        this.currentMode = 'chat';
        this.conversationHistory = this._loadFromStorage('conversationHistory', []);
        this.selectedSources = this._loadFromStorage('selectedSources', []);
        this.currentResearchData = null;
        this.purchasedItems = new Set(this._loadFromStorage('purchasedItems', []));
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

    // Persistence helpers
    _loadFromStorage(key, defaultValue) {
        try {
            const stored = sessionStorage.getItem(`appState_${key}`);
            return stored ? JSON.parse(stored) : defaultValue;
        } catch (error) {
            console.warn(`Failed to load ${key} from storage:`, error);
            return defaultValue;
        }
    }
    
    _saveToStorage(key, value) {
        try {
            sessionStorage.setItem(`appState_${key}`, JSON.stringify(value));
        } catch (error) {
            console.warn(`Failed to save ${key} to storage:`, error);
        }
    }

    // Conversation management with deduplication
    addMessage(sender, content, metadata = null) {
        const messageId = `${sender}_${Date.now()}_${content.substring(0, 50)}`;
        
        // Dedupe: check if similar message exists recently (last 3 messages)
        const recentMessages = this.conversationHistory.slice(-3);
        const isDuplicate = recentMessages.some(msg => 
            msg.sender === sender && 
            msg.content === content &&
            Date.now() - new Date(msg.timestamp).getTime() < 5000 // Within 5 seconds
        );
        
        if (isDuplicate) {
            console.warn('Duplicate message prevented:', content.substring(0, 100));
            return this.conversationHistory[this.conversationHistory.length - 1];
        }
        
        const message = {
            id: messageId,
            sender,
            content,
            metadata,
            timestamp: new Date()
        };
        
        this.conversationHistory = [...this.conversationHistory, message]; // Immutable update
        this._saveToStorage('conversationHistory', this.conversationHistory);
        return message;
    }

    clearConversation() {
        this.conversationHistory = [];
        this.selectedSources = [];
        this.currentResearchData = null;
        this.pendingAction = null;
        
        // Clear persisted state
        this._saveToStorage('conversationHistory', []);
        this._saveToStorage('selectedSources', []);
    }

    getConversationHistory() {
        return [...this.conversationHistory]; // Return copy
    }

    // Source management with immutable updates
    toggleSourceSelection(sourceId, sourceData) {
        const existingIndex = this.selectedSources.findIndex(s => s.id === sourceId);
        
        if (existingIndex >= 0) {
            // Immutable removal
            this.selectedSources = this.selectedSources.filter(s => s.id !== sourceId);
            this._saveToStorage('selectedSources', this.selectedSources);
            return false; // Deselected
        } else {
            // Immutable addition
            const newSource = {
                id: sourceId,
                ...sourceData,
                selectedAt: new Date()
            };
            this.selectedSources = [...this.selectedSources, newSource];
            this._saveToStorage('selectedSources', this.selectedSources);
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
            // Use nullish coalescing to properly handle 0 values
            const price = source.unlock_price ?? source.price ?? 0;
            return total + price;
        }, 0);
    }

    removeSelectedSource(sourceId) {
        this.selectedSources = this.selectedSources.filter(s => s.id !== sourceId);
        this._saveToStorage('selectedSources', this.selectedSources);
    }

    canAddMoreSources(tierType) {
        // Guard against invalid tierType with warning
        if (!tierType || typeof tierType !== 'string') {
            console.warn('Invalid tierType provided to canAddMoreSources:', tierType);
            tierType = 'basic'; // Safe fallback
        }
        
        const limit = this.TIER_LIMITS[tierType.toLowerCase()] ?? this.TIER_LIMITS.default;
        return this.selectedSources.length < limit;
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

    // Purchased items tracking with persistence
    addPurchasedItem(itemId) {
        this.purchasedItems.add(itemId);
        this._saveToStorage('purchasedItems', Array.from(this.purchasedItems));
    }

    isPurchased(itemId) {
        return this.purchasedItems.has(itemId);
    }
    
    clearPurchasedItems() {
        this.purchasedItems.clear();
        this._saveToStorage('purchasedItems', []);
    }
    
    getPurchasedItems() {
        return Array.from(this.purchasedItems);
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