import { MessageRenderer } from '../components/message-renderer.js';

export class MessageCoordinator {
    constructor({ appState, apiService, authService, uiManager, toastManager, sourceManager }) {
        this.appState = appState;
        this.apiService = apiService;
        this.authService = authService;
        this.uiManager = uiManager;
        this.toastManager = toastManager;
        this.sourceManager = sourceManager;
    }

    restoreMessages() {
        const messagesContainer = document.getElementById('messagesContainer');
        
        const reportBuilder = messagesContainer.querySelector('.report-builder-interface');
        if (reportBuilder) {
            reportBuilder.remove();
        }
        
        messagesContainer.innerHTML = '';
        
        const conversationHistory = this.appState.getConversationHistory();
        
        conversationHistory.forEach((message) => {
            const uiMessage = { ...message };
            if (typeof message.content === 'string' && message.content.startsWith('<')) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = message.content;
                uiMessage.content = tempDiv.firstChild;
            }
            
            this.uiManager.addMessageToChat(uiMessage);
        });
    }

    showLoadingMessage(message) {
        const messagesContainer = document.getElementById('messagesContainer');
        
        const loadingMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: message,
            timestamp: new Date(),
            variant: 'loading'
        });
        
        messagesContainer.appendChild(loadingMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        return loadingMessage;
    }

    showProgressiveLoading() {
        const messagesContainer = document.getElementById('messagesContainer');
        
        const loadingMessage = MessageRenderer.createMessageElement({
            sender: 'system',
            content: '📊 Compiling sources...',
            timestamp: new Date(),
            variant: 'loading'
        });
        
        messagesContainer.appendChild(loadingMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        const steps = [
            { delay: 0, text: '📊 Compiling sources...' },
            { delay: 5000, text: '🔍 Analyzing content...' },
            { delay: 10000, text: '✍️ Building your report...' }
        ];
        
        const timers = [];
        
        steps.forEach((step, index) => {
            if (index === 0) return;
            
            const timer = setTimeout(() => {
                const messageText = loadingMessage.querySelector('.message__loading-text');
                if (messageText) {
                    messageText.textContent = step.text;
                }
            }, step.delay);
            
            timers.push(timer);
        });
        
        loadingMessage._progressTimers = timers;
        
        return loadingMessage;
    }

    removeLoading(element) {
        if (element && element.parentNode) {
            if (element._progressTimers) {
                element._progressTimers.forEach(timer => clearTimeout(timer));
            }
            element.remove();
        }
    }

    createFeedback(sources) {
        const feedbackContainer = document.createElement('div');
        feedbackContainer.className = 'feedback-section';
        feedbackContainer.style.cssText = 'margin-top: 20px; padding: 16px; background: var(--surface-secondary, #f5f5f5); border-radius: 8px; text-align: center;';
        
        const feedbackText = document.createElement('p');
        feedbackText.textContent = 'How helpful are these sources?';
        feedbackText.style.cssText = 'margin: 0 0 12px 0; color: var(--text-primary, #333); font-weight: 500;';
        
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 12px; justify-content: center; align-items: center;';
        
        const thumbsUpBtn = document.createElement('button');
        thumbsUpBtn.className = 'feedback-btn feedback-up';
        thumbsUpBtn.innerHTML = '👍 Helpful';
        thumbsUpBtn.style.cssText = 'padding: 8px 20px; border: 2px solid var(--primary, #4A90E2); background: white; color: var(--primary, #4A90E2); border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s;';
        
        const thumbsDownBtn = document.createElement('button');
        thumbsDownBtn.className = 'feedback-btn feedback-down';
        thumbsDownBtn.innerHTML = '👎 Not helpful';
        thumbsDownBtn.style.cssText = 'padding: 8px 20px; border: 2px solid #666; background: white; color: #666; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s;';
        
        feedbackContainer.dataset.query = this.appState.getCurrentQuery() || '';
        feedbackContainer.dataset.sourceIds = JSON.stringify(sources.map(s => s.id));
        feedbackContainer.dataset.mode = this.appState.getMode();
        
        buttonContainer.appendChild(thumbsUpBtn);
        buttonContainer.appendChild(thumbsDownBtn);
        feedbackContainer.appendChild(feedbackText);
        feedbackContainer.appendChild(buttonContainer);
        
        return feedbackContainer;
    }

    async submitFeedback(query, sourceIds, rating, mode, feedbackSection) {
        try {
            console.log('📊 FEEDBACK SUBMISSION START');
            console.log('  Query:', query);
            console.log('  Source IDs:', sourceIds);
            console.log('  Rating:', rating);
            console.log('  Mode:', mode);
            console.log('  Feedback section:', feedbackSection);
            
            const token = this.authService.getAccessToken();
            console.log('  Token available:', !!token);
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }
            
            const requestBody = {
                query: query,
                source_ids: sourceIds,
                rating: rating,
                mode: mode
            };
            
            console.log('  Request body:', JSON.stringify(requestBody, null, 2));
            console.log('  Headers:', headers);
            
            console.log('🌐 Sending POST request to /api/feedback...');
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestBody)
            });
            
            console.log('  Response status:', response.status);
            console.log('  Response ok:', response.ok);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('  Error response body:', errorText);
                throw new Error(`Failed to submit feedback: ${response.status} - ${errorText}`);
            }
            
            const result = await response.json();
            console.log('  Success response:', result);
            
            feedbackSection.dataset.submitted = 'true';
            
            const feedbackText = feedbackSection.querySelector('p');
            if (feedbackText) {
                feedbackText.textContent = result.message || 'Thank you for your feedback!';
            }
            
            const buttonContainer = feedbackSection.querySelector('div');
            if (buttonContainer) {
                buttonContainer.style.display = 'none';
            }
            
            this.toastManager.show('✅ ' + (result.message || 'Feedback submitted!'), 'success', 3000);
            
            console.log('✅ FEEDBACK SUBMISSION COMPLETE');
            
        } catch (error) {
            console.error('❌ FEEDBACK SUBMISSION ERROR:', error);
            console.error('  Error name:', error.name);
            console.error('  Error message:', error.message);
            console.error('  Error stack:', error.stack);
            this.toastManager.show('Failed to submit feedback. Please try again.', 'error', 3000);
        }
    }

    async pollForEnrichment(query) {
        if (!query) return;
        
        let attempts = 0;
        const maxAttempts = 6;
        
        const pollInterval = setInterval(async () => {
            attempts++;
            
            try {
                const result = await this.apiService.analyzeQueryForTier(query, 10.0, 15);
                
                if (!result.enrichment_needed || result.enrichment_status === 'complete') {
                    this.sourceManager.updateCards(result.sources);
                    clearInterval(pollInterval);
                    return;
                }
                
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
}
