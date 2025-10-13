export class InteractionHandler {
    constructor({ appState, apiService, modalController, uiManager, toastManager, sourceManager }) {
        this.appState = appState;
        this.apiService = apiService;
        this.modalController = modalController;
        this.uiManager = uiManager;
        this.toastManager = toastManager;
        this.sourceManager = sourceManager;
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

    handleResearchSuggestion(topicHint, setModeCallback) {
        setModeCallback('research');
        
        if (topicHint) {
            const chatInput = document.getElementById('newChatInput');
            if (chatInput) {
                chatInput.value = topicHint;
                chatInput.focus();
                this.uiManager.updateCharacterCount();
            }
        }
    }

    async clearConversation(addMessageCallback, reportBuilderUpdateCallback) {
        if (!confirm('Clear the entire conversation? This cannot be undone.')) {
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
