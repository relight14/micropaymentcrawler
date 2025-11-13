export class InteractionHandler {
    constructor({ appState, apiService, modalController, uiManager, toastManager, sourceManager, authService }) {
        this.appState = appState;
        this.apiService = apiService;
        this.modalController = modalController;
        this.uiManager = uiManager;
        this.toastManager = toastManager;
        this.sourceManager = sourceManager;
        this.authService = authService;
    }

    handleCitationClick(sourceId, price) {
        const researchData = this.appState.getCurrentResearchData();
        if (!researchData || !researchData.sources) {
            console.error('Citation badge clicked but no research data available');
            return;
        }
        
        const source = researchData.sources.find(s => s.id === sourceId);
        if (!source) {
            console.error('Citation badge clicked but source not found:', sourceId);
            return;
        }
        
        console.log('🔖 Citation badge clicked for source:', source.title);
        this.sourceManager.unlockSource(null, sourceId, price);
    }

    handleResearchSuggestion(topicHint, setModeCallback, autoExecute = false, sendMessageCallback = null) {
        // Check authentication first
        if (!this.authService.isAuthenticated()) {
            // Save pending action to switch to research mode and auto-execute search after login
            this.appState.setPendingAction({ 
                type: 'research_suggestion', 
                topicHint: topicHint || '',
                autoExecute: autoExecute  // Persist the autoExecute flag so search fires after login
            });
            this.modalController.showAuthModal('Sign in to search premium sources');
            return;
        }
        
        // Switch to research mode
        setModeCallback('research');
        
        const chatInput = document.getElementById('newChatInput');
        if (!chatInput) return;
        
        // Use topicHint if available, otherwise use current query from appState
        let queryText = topicHint || this.appState.getCurrentQuery() || '';
        
        // If still no query, try to extract from last user message
        if (!queryText) {
            const messages = this.appState.getConversationHistory();
            const lastUserMessage = messages.filter(m => m.sender === 'user').pop();
            if (lastUserMessage?.content) {
                // Safely extract text - handle both string and HTML content
                const content = lastUserMessage.content;
                if (typeof content === 'string') {
                    queryText = content.substring(0, 100);
                } else if (content instanceof HTMLElement) {
                    queryText = content.textContent?.substring(0, 100) || '';
                }
            }
        }
        
        // Set the query in the input
        chatInput.value = queryText;
        this.uiManager.updateCharacterCount();
        
        // Auto-execute search if requested
        if (autoExecute && sendMessageCallback && queryText) {
            // Small delay to ensure mode switch completes
            setTimeout(async () => {
                try {
                    // Execute the search
                    await sendMessageCallback();
                } catch (error) {
                    console.error('Failed to auto-execute search:', error);
                }
            }, 100);
        } else {
            chatInput.focus();
        }

    }

    async clearConversation(addMessageCallback, reportBuilderUpdateCallback, skipConfirmation = false) {
        if (!skipConfirmation && !confirm('Clear the entire conversation? This cannot be undone.')) {
            return;
        }

        try {
            await this.apiService.clearConversation();
            this.appState.clearConversation();
            this.uiManager.clearConversationDisplay();
            this.sourceManager.updateSelectionUI();
            reportBuilderUpdateCallback();
        } catch (error) {
            console.error('Error clearing conversation:', error);
            addMessageCallback('system', 'Failed to clear conversation. Please refresh the page to start fresh.');
        }
    }

    hideWelcome() {
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen && welcomeScreen.style.display !== 'none') {
            welcomeScreen.style.display = 'none';
        }
    }

    toggleDarkMode() {
        const isDark = this.appState.toggleDarkMode();
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.checked = isDark;
        }
    }
}
