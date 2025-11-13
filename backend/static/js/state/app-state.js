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
        this.currentResearchData = this._loadFromStorage('currentResearchData', null);
        this.purchasedItems = new Set(this._loadFromStorage('purchasedItems', []));
        this.purchasedSummaries = this._loadFromStorage('purchasedSummaries', {}); // sourceId -> {summary, price, timestamp}
        this.pendingAction = null;
        
        // Conversation scoping to prevent source contamination across topics
        this.conversationId = this._loadFromStorage('conversationId', null);
        if (!this.conversationId) {
            this.conversationId = this._generateConversationId();
            this._saveToStorage('conversationId', this.conversationId);
        }
        this.selectedSources = this._loadFromStorage('selectedSources', []);
        
        // Clean up sources from previous conversations on initialization
        this._cleanStaleSources();
        
        // Enrichment tracking
        this.enrichmentStatus = 'idle'; // idle | processing | complete
        
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

    // Conversation ID management
    _generateConversationId() {
        return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    _cleanStaleSources() {
        // Remove sources that don't belong to current conversation
        const cleanedSources = this.selectedSources.filter(source => 
            source.conversationId === this.conversationId
        );
        
        // If any sources were removed, update storage
        if (cleanedSources.length !== this.selectedSources.length) {
            console.log(`🧹 Cleaned ${this.selectedSources.length - cleanedSources.length} stale sources from previous conversation`);
            this.selectedSources = cleanedSources;
            this._saveToStorage('selectedSources', this.selectedSources);
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
        
        // Generate new conversation ID for fresh start
        this.conversationId = this._generateConversationId();
        
        // Clear persisted state
        this._saveToStorage('conversationHistory', []);
        this._saveToStorage('selectedSources', []);
        this._saveToStorage('conversationId', this.conversationId);
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
            // Immutable addition with conversation scoping
            const newSource = {
                id: sourceId,
                ...sourceData,
                selectedAt: new Date(),
                conversationId: this.conversationId // Link to current conversation
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
        this._saveToStorage('currentResearchData', data);
        
        // Track enrichment status from research data (backend is single source of truth)
        if (data?.enrichment_status) {
            // Map backend statuses to frontend states
            const statusMap = {
                'idle': 'idle',
                'processing': 'processing',
                'complete': 'complete',
                'ready': 'complete',  // Backend enrichment endpoint returns 'ready'
                'error': 'complete',
                'failed': 'complete'
            };
            this.enrichmentStatus = statusMap[data.enrichment_status] || 'idle';
        }
    }

    getCurrentResearchData() {
        return this.currentResearchData;
    }
    
    // Enrichment status tracking - ADAPTER (delegates to MessageCoordinator)
    // TODO: Remove after all consumers migrated to MessageCoordinator
    setEnrichmentStatus(status, messageCoordinator = null) {
        // Legacy support during dual-write period
        this.enrichmentStatus = status;
        
        // Delegate to MessageCoordinator if available
        if (messageCoordinator) {
            // Map old statuses to new state machine
            const statusMap = {
                'idle': 'idle',
                'processing': 'pricing',
                'complete': 'complete'
            };
            messageCoordinator.setReportStatus(statusMap[status] || status);
        }
    }
    
    getEnrichmentStatus(messageCoordinator = null) {
        // Prefer MessageCoordinator if available
        if (messageCoordinator) {
            const status = messageCoordinator.getReportStatus();
            // Map back to legacy format for compatibility
            const reverseMap = {
                'idle': 'idle',
                'pricing': 'processing',
                'generating': 'processing',
                'complete': 'complete',
                'error': 'complete'
            };
            return reverseMap[status] || status;
        }
        return this.enrichmentStatus;
    }
    
    isEnrichmentPending(messageCoordinator = null) {
        // Prefer MessageCoordinator if available
        if (messageCoordinator) {
            return messageCoordinator.isReportPending();
        }
        return this.enrichmentStatus === 'processing';
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

    // Summary management
    cacheSummary(sourceId, summary, price, summaryType = 'full') {
        this.purchasedSummaries[sourceId] = {
            summary,
            price,
            summary_type: summaryType,  // "full" or "excerpt" for transparency
            timestamp: new Date().toISOString()
        };
        this._saveToStorage('purchasedSummaries', this.purchasedSummaries);
    }

    getCachedSummary(sourceId) {
        return this.purchasedSummaries[sourceId] || null;
    }

    hasCachedSummary(sourceId) {
        return !!this.purchasedSummaries[sourceId];
    }

    clearCachedSummaries() {
        this.purchasedSummaries = {};
        this._saveToStorage('purchasedSummaries', {});
    }
}