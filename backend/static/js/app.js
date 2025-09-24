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
            
            // Handle research data with progressive loading
            if (response.research_data) {
                this.appState.setCurrentResearchData(response.research_data);
                
                // Display immediate source cards
                this._displaySourceCards(response.research_data.sources);
                
                // If enrichment is needed, poll for updates
                if (response.research_data.enrichment_needed) {
                    this._pollForEnrichedResults(this.appState.getCurrentQuery());
                }
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
        
        // Handle mode-specific UI changes
        if (mode === 'report' && this.appState.getCurrentResearchData()) {
            this.displayReportBuilderResults();
        } else {
            // Restore chat messages for non-report modes
            this._restoreChatMessages();
            
            // Add mode change message if there's history
            if (this.appState.getConversationHistory().length > 0) {
                const modeMessages = {
                    'chat': "💬 Switched to Chat mode - Let's explore your interests through natural conversation.",
                    'research': "🔍 Switched to Research mode - I'll find and license authoritative sources."
                };
                if (modeMessages[mode]) {
                    this.addMessage('system', modeMessages[mode]);
                }
            }
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

    async handleTierPurchase(button, tierId, price, query = "Research Query") {
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
            const result = await this.apiService.purchaseTier(tierId, price, query);
            this._showToast(`Research tier purchased successfully!`, 'success');
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
            this._showToast(`Failed to purchase tier: ${error.message}`, 'error');
        }
    }

    // Placeholder methods for features to be implemented
    displayReportBuilderResults(data = null) {
        const researchData = data || this.appState.getCurrentResearchData();
        if (!researchData) return;
        
        // Generate Report Builder UI WITHOUT expensive packet building operations
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Hide existing messages but don't clear them
        const existingMessages = messagesContainer.querySelectorAll('.message, .welcome-screen');
        existingMessages.forEach(msg => msg.style.display = 'none');
        
        // Remove any existing report builder UI
        const existingReportBuilder = messagesContainer.querySelector('.report-builder-interface');
        if (existingReportBuilder) {
            existingReportBuilder.remove();
        }
        
        // Create Report Builder UI
        const reportBuilderDiv = document.createElement('div');
        reportBuilderDiv.className = 'report-builder-interface';
        reportBuilderDiv.appendChild(this._generateReportBuilderDOM());
        
        messagesContainer.appendChild(reportBuilderDiv);
        
        // Add event listeners to purchase buttons
        this._attachTierPurchaseListeners();
    }

    _generateReportBuilderDOM() {
        const selectedSources = this.appState.getSelectedSources();
        const sourceCount = selectedSources.length;
        const totalCost = this.appState.getSelectedSourcesTotal();
        
        const containerDiv = document.createElement('div');
        containerDiv.className = 'tier-cards-section';
        
        // Header
        const headerDiv = document.createElement('div');
        headerDiv.className = 'tier-cards-header';
        const headerTitle = document.createElement('h3');
        headerTitle.textContent = 'Choose Your Research Package';
        const headerDesc = document.createElement('p');
        headerDesc.textContent = 'Select the perfect research tier for your needs. Report generation begins after purchase confirmation.';
        headerDiv.appendChild(headerTitle);
        headerDiv.appendChild(headerDesc);
        containerDiv.appendChild(headerDiv);
        
        // Selected sources (if any)
        if (sourceCount > 0) {
            const sourcesSection = document.createElement('div');
            sourcesSection.className = 'selected-sources-section';
            
            const sourcesTitle = document.createElement('h3');
            sourcesTitle.textContent = `Selected Sources (${sourceCount})`;
            sourcesSection.appendChild(sourcesTitle);
            
            const sourcesList = document.createElement('div');
            sourcesList.className = 'sources-list';
            
            selectedSources.slice(0, 5).forEach(source => {
                const sourceItem = document.createElement('div');
                sourceItem.className = 'source-item';
                
                const titleSpan = document.createElement('span');
                titleSpan.className = 'source-title';
                titleSpan.textContent = source.title; // Safe text content
                
                const priceSpan = document.createElement('span');
                priceSpan.className = 'source-price';
                priceSpan.textContent = source.price ? `$${source.price.toFixed(2)}` : 'Free';
                
                sourceItem.appendChild(titleSpan);
                sourceItem.appendChild(priceSpan);
                sourcesList.appendChild(sourceItem);
            });
            
            if (sourceCount > 5) {
                const moreDiv = document.createElement('div');
                moreDiv.className = 'source-item-more';
                moreDiv.textContent = `... and ${sourceCount - 5} more sources`;
                sourcesList.appendChild(moreDiv);
            }
            
            const totalDiv = document.createElement('div');
            totalDiv.className = 'sources-total';
            totalDiv.textContent = `Total Source Cost: $${totalCost.toFixed(2)}`;
            
            sourcesSection.appendChild(sourcesList);
            sourcesSection.appendChild(totalDiv);
            containerDiv.appendChild(sourcesSection);
        }
        
        // Tier cards
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'tier-cards-container';
        
        // Research tier
        cardsContainer.appendChild(this._createTierCard('research', '🔬', 'Research Package', '$2.00',
            'Professional summary and analysis with source compilation',
            ['✓ Professional summary and analysis', '✓ Source compilation and citations', '✓ Ready for download'],
            'Purchase Research Package', true));
            
        // Pro tier
        cardsContainer.appendChild(this._createTierCard('pro', '⭐', 'Pro Package', '$4.00',
            'Everything in Research plus strategic insights and executive formatting',
            ['✓ Everything in Research Package', '✓ Strategic insights and recommendations', 
             '✓ Executive summary format', '✓ Enhanced formatting and presentation'],
            'Purchase Pro Package', false));
        
        containerDiv.appendChild(cardsContainer);
        
        // Note
        const noteDiv = document.createElement('div');
        noteDiv.className = 'tier-cards-note';
        noteDiv.textContent = '💡 Report generation will begin only after purchase confirmation.';
        containerDiv.appendChild(noteDiv);
        
        return containerDiv;
    }
    
    _createTierCard(tier, icon, title, price, description, features, buttonText, highlighted) {
        const cardDiv = document.createElement('div');
        cardDiv.className = highlighted ? 'tier-card highlighted' : 'tier-card';
        cardDiv.dataset.tier = tier;
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'tier-icon';
        iconDiv.textContent = icon;
        
        const titleH4 = document.createElement('h4');
        titleH4.textContent = title;
        
        const priceDiv = document.createElement('div');
        priceDiv.className = 'tier-price';
        priceDiv.textContent = price;
        
        const descP = document.createElement('p');
        descP.className = 'tier-description';
        descP.textContent = description;
        
        const featuresList = document.createElement('ul');
        featuresList.className = 'tier-features';
        features.forEach(feature => {
            const li = document.createElement('li');
            li.textContent = feature;
            featuresList.appendChild(li);
        });
        
        const button = document.createElement('button');
        button.className = 'tier-purchase-btn';
        button.dataset.tier = tier;
        button.dataset.price = price.replace('$', '');
        button.textContent = buttonText;
        
        cardDiv.appendChild(iconDiv);
        cardDiv.appendChild(titleH4);
        cardDiv.appendChild(priceDiv);
        cardDiv.appendChild(descP);
        cardDiv.appendChild(featuresList);
        cardDiv.appendChild(button);
        
        return cardDiv;
    }
    
    _attachTierPurchaseListeners() {
        const purchaseButtons = document.querySelectorAll('.tier-purchase-btn');
        purchaseButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const tier = e.target.dataset.tier;
                const price = parseFloat(e.target.dataset.price);
                const query = this.appState.getCurrentQuery() || "Research Query";
                
                e.target.textContent = 'Processing...';
                e.target.disabled = true;
                
                try {
                    await this.handleTierPurchase(e.target, tier, price, query);
                } catch (error) {
                    e.target.textContent = `Purchase ${tier === 'research' ? 'Research' : 'Pro'} Package`;
                    e.target.disabled = false;
                }
            });
        });
    }

    updateSourceSelectionUI() {
        // Placeholder for source selection UI updates
        console.log('Source selection UI updated');
    }

    updateReportBuilderDisplay() {
        // Placeholder for report builder display updates
        console.log('Report builder display updated');
    }

    _restoreChatMessages() {
        const messagesContainer = document.getElementById('messagesContainer');
        
        // Remove report builder UI
        const reportBuilder = messagesContainer.querySelector('.report-builder-interface');
        if (reportBuilder) {
            reportBuilder.remove();
        }
        
        // Properly restore hidden messages by removing inline display style
        const hiddenMessages = messagesContainer.querySelectorAll('.message, .welcome-screen');
        hiddenMessages.forEach(msg => {
            msg.style.removeProperty('display'); // Properly restore display
        });
    }
    
    _showToast(message, type = 'info') {
        // Simple toast implementation - could be enhanced
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            z-index: 1000;
            animation: slideIn 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    _displaySourceCards(sources) {
        if (!sources || sources.length === 0) return;
        
        // Create sources grid container
        const sourcesGrid = document.createElement('div');
        sourcesGrid.className = 'sources-grid';
        
        sources.forEach(source => {
            const isEnriching = source.enrichment_needed;
            
            // Create source card using safe DOM methods to prevent XSS
            const sourceCard = document.createElement('div');
            sourceCard.className = `source-card ${isEnriching ? 'source-enriching' : ''}`;
            sourceCard.setAttribute('data-source-id', source.id);
            
            // Add enrichment indicator if needed
            if (isEnriching) {
                const indicator = document.createElement('div');
                indicator.className = 'enrichment-indicator';
                indicator.textContent = '⚡ Enhancing...';
                sourceCard.appendChild(indicator);
            }
            
            // Source header
            const header = document.createElement('div');
            header.className = 'source-header';
            
            const title = document.createElement('h4');
            title.className = 'source-title';
            title.textContent = source.title; // Safe text content
            
            const domain = document.createElement('span');
            domain.className = 'source-domain';
            domain.textContent = source.domain; // Safe text content
            
            header.appendChild(title);
            header.appendChild(domain);
            sourceCard.appendChild(header);
            
            // Source excerpt
            const excerpt = document.createElement('p');
            excerpt.className = 'source-excerpt';
            excerpt.textContent = source.excerpt || 'Loading detailed excerpt...'; // Safe text content
            sourceCard.appendChild(excerpt);
            
            // Source metadata
            const metadata = document.createElement('div');
            metadata.className = 'source-metadata';
            
            const price = document.createElement('span');
            price.className = 'source-price';
            price.textContent = `$${(source.unlock_price || 0).toFixed(2)}`;
            
            metadata.appendChild(price);
            
            if (source.licensing_protocol) {
                const badge = document.createElement('span');
                badge.className = 'licensing-badge';
                badge.textContent = source.licensing_protocol;
                metadata.appendChild(badge);
            }
            
            sourceCard.appendChild(metadata);
            
            // Unlock button with safe event handler
            const unlockBtn = document.createElement('button');
            unlockBtn.className = 'unlock-btn';
            unlockBtn.textContent = 'Unlock Source';
            unlockBtn.addEventListener('click', async () => {
                if (window.researchApp && window.researchApp.handleSourceUnlock) {
                    // Disable button to prevent duplicate clicks
                    unlockBtn.disabled = true;
                    unlockBtn.textContent = 'Processing...';
                    
                    try {
                        await window.researchApp.handleSourceUnlock(unlockBtn, source.id, source.unlock_price || 0);
                        // Button will be updated by handleSourceUnlock on success
                    } catch (error) {
                        // Re-enable button on error
                        unlockBtn.disabled = false;
                        unlockBtn.textContent = 'Unlock Source';
                        console.error('Source unlock failed:', error);
                    }
                } else {
                    console.error('Research app or method not found');
                }
            });
            
            sourceCard.appendChild(unlockBtn);
            sourcesGrid.appendChild(sourceCard);
        });
        
        // Create wrapper message  
        const messageDiv = document.createElement('div');
        const headerText = document.createElement('strong');
        headerText.textContent = `🔍 Found ${sources.length} sources for your research:`;
        messageDiv.appendChild(headerText);
        messageDiv.appendChild(document.createElement('br'));
        messageDiv.appendChild(document.createElement('br'));
        messageDiv.appendChild(sourcesGrid);
        
        this.addMessage('assistant', messageDiv.outerHTML);
    }
    
    async _pollForEnrichedResults(query) {
        if (!query) return;
        
        // Poll every 5 seconds for up to 30 seconds to get enriched results
        let attempts = 0;
        const maxAttempts = 6;
        
        const pollInterval = setInterval(async () => {
            attempts++;
            
            try {
                const result = await this.apiService.analyzeQueryForTier(query, 10.0, 15);
                
                // If enrichment is complete, update the source cards
                if (!result.enrichment_needed || result.enrichment_status === 'complete') {
                    this._updateSourceCards(result.sources);
                    clearInterval(pollInterval);
                    return;
                }
                
                // Stop polling after max attempts
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    console.log('Stopped polling for enriched results after max attempts');
                }
                
            } catch (error) {
                console.error('Error polling for enriched results:', error);
                clearInterval(pollInterval);
            }
        }, 5000);
    }
    
    _updateSourceCards(enrichedSources) {
        enrichedSources.forEach(source => {
            const sourceCard = document.querySelector(`[data-source-id="${source.id}"]`);
            if (!sourceCard) return;
            
            // Remove loading indicators
            sourceCard.classList.remove('source-enriching');
            const loadingIndicator = sourceCard.querySelector('.enrichment-indicator');
            if (loadingIndicator) loadingIndicator.remove();
            
            // Update content with enriched data
            const titleEl = sourceCard.querySelector('.source-title');
            if (titleEl && source.title) titleEl.textContent = source.title;
            
            const excerptEl = sourceCard.querySelector('.source-excerpt');
            if (excerptEl && source.excerpt) excerptEl.textContent = source.excerpt;
            
            const priceEl = sourceCard.querySelector('.source-price');
            if (priceEl && source.unlock_price) priceEl.textContent = `$${source.unlock_price.toFixed(2)}`;
            
            // Add licensing badge if available
            if (source.licensing_protocol) {
                const metadataDiv = sourceCard.querySelector('.source-metadata');
                if (metadataDiv && !metadataDiv.querySelector('.licensing-badge')) {
                    const licensingBadge = document.createElement('span');
                    licensingBadge.className = 'licensing-badge';
                    licensingBadge.textContent = source.licensing_protocol;
                    metadataDiv.appendChild(licensingBadge);
                }
            }
        });
        
        // Show completion message
        this._showToast('Source enrichment complete! Updated with enhanced details.', 'success');
    }
    
    // Global methods for HTML event handlers (legacy support)
    async handleSourceUnlockInChat(sourceId, price, title) {
        // This method is kept for backward compatibility but should not be used
        // New code should call handleSourceUnlock directly with the button reference
        console.warn('handleSourceUnlockInChat is deprecated - use handleSourceUnlock directly');
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
    window.app = new ChatResearchApp();
    window.researchApp = window.app; // For backward compatibility
});