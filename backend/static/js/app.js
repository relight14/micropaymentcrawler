/**
 * Main Application Controller
 * Clean, focused orchestration layer replacing the 2,670-line monolith
 */
import { APIService } from './services/api.js';
import { AuthService } from './services/auth.js';
import { AppState } from './state/app-state.js';
import { UIManager } from './components/ui-manager.js';
import { debounce } from './utils/helpers.js';

export class ChatResearchApp {
    constructor() {
        // Initialize services and state (dependency injection)
        this.authService = new AuthService();
        this.apiService = new APIService(this.authService);
        this.appState = new AppState();
        this.uiManager = new UIManager(this.appState);
        
        // Initialize the application
        this.initializeApp();
        
        // Make app globally accessible for HTML event handlers
        window.researchApp = this;
    }

    async initializeApp() {
        try {
            this.initializeEventListeners();
            this.uiManager.updateModeDisplay();
            this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            
            // Update wallet balance if authenticated
            if (this.authService.isAuthenticated()) {
                await this.authService.updateWalletBalance();
                this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            }
        } catch (error) {
            console.error('Error initializing app:', error);
            this.addMessage('system', 'Application initialization failed. Please refresh the page.');
        }
    }

    initializeEventListeners() {
        // Get DOM elements
        const chatInput = document.getElementById('chatInput');
        const sendButton = document.getElementById('sendButton');
        const clearButton = document.getElementById('clearButton');
        const newChatBtn = document.getElementById('newChatBtn');
        const chatModeBtn = document.getElementById('chatModeBtn');
        const researchModeBtn = document.getElementById('researchModeBtn');
        const reportModeBtn = document.getElementById('reportModeBtn');
        const darkModeToggle = document.getElementById('darkModeToggle');
        const authButton = document.getElementById('authButton');
        const authToggleButton = document.getElementById('authToggleButton');

        // Chat functionality
        if (sendButton) sendButton.addEventListener('click', () => this.sendMessage());
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
            
            chatInput.addEventListener('input', debounce((e) => {
                if (sendButton) sendButton.disabled = !e.target.value.trim();
                this.uiManager.updateCharacterCount();
                this.uiManager.autoResizeTextarea(e.target);
            }, 100));
        }

        // Mode switching
        if (chatModeBtn) chatModeBtn.addEventListener('click', () => this.setMode('chat'));
        if (researchModeBtn) researchModeBtn.addEventListener('click', () => this.setMode('research'));
        if (reportModeBtn) reportModeBtn.addEventListener('click', () => this.setMode('report'));

        // Clear conversation
        if (clearButton) clearButton.addEventListener('click', () => this.clearConversation());
        if (newChatBtn) newChatBtn.addEventListener('click', () => this.clearConversation());

        // Dark mode toggle
        if (darkModeToggle) {
            darkModeToggle.checked = this.appState.isDarkModeEnabled();
            darkModeToggle.addEventListener('change', () => this.toggleDarkMode());
        }

        // Authentication
        if (authButton) authButton.addEventListener('click', () => this.handleAuthButtonClick());
        if (authToggleButton) authToggleButton.addEventListener('click', () => this.toggleAuthMode());
    }

    async sendMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput?.value?.trim();
        
        if (!message) return;

        try {
            // Clear input and show user message
            chatInput.value = '';
            this.uiManager.updateCharacterCount();
            
            const userMessage = this.addMessage('user', message);
            this.appState.setCurrentQuery(message);
            
            // Show typing indicator
            this.uiManager.showTypingIndicator();
            
            // Send to backend
            const response = await this.apiService.sendMessage(message, this.appState.getMode());
            
            // Hide typing indicator
            this.uiManager.hideTypingIndicator();
            
            // Display response
            if (response.content) {
                this.addMessage('assistant', response.content, response.metadata);
            }
            
            // Handle research data
            if (response.research_data) {
                this.appState.setCurrentResearchData(response.research_data);
            }
            
        } catch (error) {
            console.error('Error sending message:', error);
            this.uiManager.hideTypingIndicator();
            this.addMessage('system', `Sorry, I encountered an error: ${error.message}. Please try again.`);
        }
    }

    setMode(mode) {
        const modeChanged = this.appState.setMode(mode);
        if (!modeChanged) return;

        this.uiManager.updateModeDisplay();
        
        // Add mode change message if there's history
        if (this.appState.getConversationHistory().length > 0) {
            const modeMessages = {
                'chat': "💬 Switched to Chat mode - Let's explore your interests through natural conversation.",
                'research': "🔍 Switched to Research mode - I'll find and license authoritative sources.",
                'report': "📊 Switched to Report Builder - Ready to create comprehensive research packages."
            };
            this.addMessage('system', modeMessages[mode]);
        }

        // Handle special mode logic
        if (mode === 'report' && this.appState.getCurrentResearchData()) {
            this.displayReportBuilderResults();
        }
    }

    addMessage(sender, content, metadata = null) {
        const message = this.appState.addMessage(sender, content, metadata);
        this.uiManager.addMessageToChat(message);
        return message;
    }

    async clearConversation() {
        if (!confirm('Clear the entire conversation? This cannot be undone.')) {
            return;
        }

        try {
            await this.apiService.clearConversation();
            this.appState.clearConversation();
            this.uiManager.clearConversationDisplay();
            this.updateSourceSelectionUI();
            this.updateReportBuilderDisplay();
        } catch (error) {
            console.error('Error clearing conversation:', error);
            this.addMessage('system', 'Failed to clear conversation. Please refresh the page to start fresh.');
        }
    }

    toggleDarkMode() {
        const isDark = this.appState.toggleDarkMode();
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.checked = isDark;
        }
    }

    // Authentication methods
    async handleAuthButtonClick() {
        const type = this.appState.isInLoginMode() ? 'login' : 'signup';
        await this.handleAuth(type);
    }

    async handleAuth(type) {
        const emailInput = document.getElementById('authEmail');
        const passwordInput = document.getElementById('authPassword');
        
        const email = emailInput?.value?.trim();
        const password = passwordInput?.value?.trim();
        
        if (!email || !password) {
            this.addMessage('system', 'Please enter both email and password.');
            return;
        }

        try {
            let result;
            if (type === 'login') {
                result = await this.authService.login(email, password);
            } else {
                result = await this.authService.signup(email, password);
            }
            
            this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            this.addMessage('system', `Welcome! Successfully ${type === 'login' ? 'logged in' : 'signed up'}.`);
            
            // Execute any pending action
            if (this.appState.getPendingAction()) {
                await this.executePendingAction();
            }
            
        } catch (error) {
            console.error(`${type} error:`, error);
            this.addMessage('system', `${type === 'login' ? 'Login' : 'Signup'} failed: ${error.message}`);
        }
    }

    toggleAuthMode() {
        this.appState.setLoginMode(!this.appState.isInLoginMode());
        this.updateAuthModeDisplay();
    }

    updateAuthModeDisplay() {
        const authButton = document.getElementById('authButton');
        const authToggleButton = document.getElementById('authToggleButton');
        const authTitle = document.getElementById('authTitle');
        
        if (this.appState.isInLoginMode()) {
            if (authButton) authButton.textContent = 'Login';
            if (authToggleButton) authToggleButton.textContent = 'Need an account? Sign up';
            if (authTitle) authTitle.textContent = 'Login to LedeWire';
        } else {
            if (authButton) authButton.textContent = 'Sign Up';
            if (authToggleButton) authToggleButton.textContent = 'Have an account? Login';
            if (authTitle) authTitle.textContent = 'Create LedeWire Account';
        }
    }

    async executePendingAction() {
        const action = this.appState.getPendingAction();
        if (!action) return;
        
        this.appState.clearPendingAction();
        
        try {
            if (action.type === 'source_unlock') {
                await this.handleSourceUnlock(action.button, action.sourceId, action.price);
            } else if (action.type === 'tier_purchase') {
                await this.handleTierPurchase(action.button, action.tierId, action.price);
            }
        } catch (error) {
            console.error('Error executing pending action:', error);
            this.addMessage('system', 'Failed to complete the action. Please try again.');
        }
    }

    // Source and tier management methods
    async handleSourceUnlock(button, sourceId, price) {
        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'source_unlock', 
                button, 
                sourceId, 
                price 
            });
            this.addMessage('system', 'Please log in to unlock this source.');
            return;
        }

        try {
            const result = await this.apiService.unlockSource(sourceId, price);
            this.addMessage('system', `Source unlocked successfully!`);
            this.appState.addPurchasedItem(sourceId);
            
            // Update UI
            if (button) {
                button.textContent = 'Unlocked';
                button.disabled = true;
            }
            
            await this.authService.updateWalletBalance();
            this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            
        } catch (error) {
            console.error('Error unlocking source:', error);
            this.addMessage('system', `Failed to unlock source: ${error.message}`);
        }
    }

    async handleTierPurchase(button, tierId, price) {
        if (!this.authService.isAuthenticated()) {
            this.appState.setPendingAction({ 
                type: 'tier_purchase', 
                button, 
                tierId, 
                price 
            });
            this.addMessage('system', 'Please log in to purchase this research tier.');
            return;
        }

        try {
            const result = await this.apiService.purchaseTier(tierId, price);
            this.addMessage('system', `Research tier purchased successfully!`);
            this.appState.addPurchasedItem(tierId);
            
            // Update UI
            if (button) {
                button.textContent = 'Purchased';
                button.disabled = true;
            }
            
            await this.authService.updateWalletBalance();
            this.uiManager.updateWalletDisplay(this.authService.getWalletBalance());
            
        } catch (error) {
            console.error('Error purchasing tier:', error);
            this.addMessage('system', `Failed to purchase tier: ${error.message}`);
        }
    }

    // Placeholder methods for features to be implemented
    displayReportBuilderResults(data = null) {
        const researchData = data || this.appState.getCurrentResearchData();
        if (!researchData) return;
        
        this.addMessage('system', 'Report Builder results would be displayed here.');
    }

    updateSourceSelectionUI() {
        // Placeholder for source selection UI updates
        console.log('Source selection UI updated');
    }

    updateReportBuilderDisplay() {
        // Placeholder for report builder display updates
        console.log('Report builder display updated');
    }

    // Global methods for HTML event handlers
    async handleSourceUnlockInChat(sourceId, price, title) {
        return this.handleSourceUnlock(null, sourceId, price);
    }

    toggleSourceSelection(sourceId, sourceData) {
        const isSelected = this.appState.toggleSourceSelection(sourceId, sourceData);
        this.updateSourceSelectionUI();
        return isSelected;
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.researchApp = new ChatResearchApp();
});