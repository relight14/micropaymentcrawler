/**
 * ModalController - Handles auth and funding modal lifecycle
 * Extracted from app.js to reduce bloat and improve maintainability
 */
export class ModalController {
    constructor(authService, appState, toastManager, baseURL, apiService = null) {
        this.authService = authService;
        this.appState = appState;
        this.toastManager = toastManager;
        this.baseURL = baseURL || window.location.origin;
        this.apiService = apiService;
        
        // Callback references
        this.onAuthSuccess = null;
        this.onAuthToggle = null;
        this.onFundingSuccess = null;
        
        // Track current payment session for polling
        this.currentPaymentSessionId = null;
    }

    /**
     * Set API service reference (for payment status polling)
     */
    setApiService(apiService) {
        this.apiService = apiService;
    }

    /**
     * Set callback for successful authentication
     */
    setAuthSuccessCallback(callback) {
        this.onAuthSuccess = callback;
    }

    /**
     * Set callback for auth mode toggle
     */
    setAuthToggleCallback(callback) {
        this.onAuthToggle = callback;
    }

    /**
     * Set callback for successful funding
     */
    setFundingSuccessCallback(callback) {
        this.onFundingSuccess = callback;
    }

    /**
     * Show authentication modal (login/signup)
     */
    showAuthModal() {
        // Remove any existing modal
        const existingModal = document.getElementById('authModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Create modal HTML
        const isLogin = this.appState.isInLoginMode();
        const modalHTML = `
            <div id="authModal" class="modal-overlay">
                <div class="modal-content auth-modal">
                    <div class="auth-modal-header">
                        <img src="/static/clearcite-logo.png" alt="Clearcite" class="auth-modal-logo">
                        <h2 id="authTitle">${isLogin ? 'Welcome back!' : 'Create Account'}</h2>
                        <p>${isLogin ? 'Sign in to unlock full research access' : 'Join Clearcite to access premium features'}</p>
                        <button class="modal-close" onclick="document.getElementById('authModal').remove()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; color: #999; cursor: pointer;">×</button>
                    </div>
                    <div class="auth-modal-content">
                        <div id="authModalMessage" class="auth-modal-message" style="display: none;"></div>
                        <form class="auth-form" id="authForm">
                            ${!isLogin ? `
                                <div class="auth-form-group">
                                    <label for="authFirstName">First Name *</label>
                                    <input type="text" id="authFirstName" placeholder="" required>
                                </div>
                                <div class="auth-form-group">
                                    <label for="authLastName">Last Name *</label>
                                    <input type="text" id="authLastName" placeholder="" required>
                                </div>
                            ` : ''}
                            <div class="auth-form-group">
                                <label for="authEmail">Email *</label>
                                <input type="email" id="authEmail" placeholder="" required>
                            </div>
                            <div class="auth-form-group">
                                <label for="authPassword">Password *</label>
                                <input type="password" id="authPassword" placeholder="" required>
                            </div>
                            <button type="submit" class="auth-btn" id="authSubmitBtn">
                                ${isLogin ? 'Log In' : 'Sign Up'}
                            </button>
                        </form>
                        <div class="auth-links">
                            ${isLogin ? '<a href="#" class="auth-link" id="forgotPasswordLink">Forgot Password?</a>' : ''}
                            <a href="#" class="auth-link" id="authToggleButton">
                                ${isLogin ? 'Need an account? Sign up' : 'Have an account? Log in'}
                            </a>
                        </div>
                    </div>
                    <div class="auth-modal-footer">
                        Powered by LedeWire Wallet
                    </div>
                </div>
            </div>
        `;

        // Add modal to page
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Add event listeners
        const authForm = document.getElementById('authForm');
        const authToggleButton = document.getElementById('authToggleButton');

        if (authForm) {
            authForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const type = this.appState.isInLoginMode() ? 'login' : 'signup';
                await this._handleAuth(type);
            });
        }

        if (authToggleButton) {
            authToggleButton.addEventListener('click', (e) => {
                e.preventDefault();
                if (this.onAuthToggle) {
                    this.onAuthToggle();
                }
                this.showAuthModal(); // Refresh modal with new mode
            });
        }

        // Add forgot password link handler
        const forgotPasswordLink = document.getElementById('forgotPasswordLink');
        if (forgotPasswordLink) {
            forgotPasswordLink.addEventListener('click', (e) => {
                e.preventDefault();
                this._showAuthModalMessage('Forgot password functionality coming soon. Please contact support for assistance.', 'info');
            });
        }

        // Close modal when clicking outside
        const modalOverlay = document.getElementById('authModal');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    modalOverlay.remove();
                }
            });
        }
    }

    /**
     * Show message in auth modal
     */
    _showAuthModalMessage(message, type = 'error') {
        const messageEl = document.getElementById('authModalMessage');
        if (!messageEl) return;
        
        messageEl.textContent = message;
        messageEl.className = `auth-modal-message ${type}`;
        messageEl.style.display = 'block';
        
        // Auto-hide success messages after 3 seconds
        if (type === 'success') {
            setTimeout(() => {
                messageEl.style.display = 'none';
            }, 3000);
        }
    }

    /**
     * Handle authentication (login/signup)
     */
    async _handleAuth(type) {
        const emailInput = document.getElementById('authEmail');
        const passwordInput = document.getElementById('authPassword');
        const firstNameInput = document.getElementById('authFirstName');
        const lastNameInput = document.getElementById('authLastName');
        
        const email = emailInput?.value?.trim();
        const password = passwordInput?.value?.trim();
        const firstName = firstNameInput?.value?.trim();
        const lastName = lastNameInput?.value?.trim();
        
        if (!email || !password) {
            this._showAuthModalMessage('Please enter both email and password.');
            return;
        }
        
        if (type === 'signup' && (!firstName || !lastName)) {
            this._showAuthModalMessage('Please enter your first and last name.');
            return;
        }

        // Disable submit button during processing
        const submitBtn = document.getElementById('authSubmitBtn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Processing...';
        }

        try {
            let result;
            if (type === 'login') {
                result = await this.authService.login(email, password);
            } else if (type === 'signup') {
                result = await this.authService.signup(email, password, firstName, lastName);
            }
            
            if (result.success) {
                // Close modal on success
                document.getElementById('authModal')?.remove();
                
                // Trigger success callback
                if (this.onAuthSuccess) {
                    await this.onAuthSuccess(type);
                }
            }
            
        } catch (error) {
            console.error(`${type} error:`, error);
            this._showAuthModalMessage(`${type === 'login' ? 'Login' : 'Signup'} failed: ${error.message}`);
            
            // Re-enable submit button on error
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = type === 'login' ? 'Log In' : 'Sign Up';
            }
        }
    }

    /**
     * Show funding modal
     * @param {number} suggestedAmountCents - Optional minimum suggested amount in cents
     */
    async showFundingModal(suggestedAmountCents = null) {
        // Remove any existing funding modal
        const existingModal = document.getElementById('fundingModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Calculate suggested amount (round up to nearest $5)
        let suggestedDisplay = '';
        let customAmountCents = null;
        if (suggestedAmountCents && suggestedAmountCents > 0) {
            // Round up to nearest $5 (500 cents)
            customAmountCents = Math.ceil(suggestedAmountCents / 500) * 500;
            if (customAmountCents < 500) customAmountCents = 500; // Minimum $5
            suggestedDisplay = `<p class="funding-suggestion">You need at least $${(suggestedAmountCents / 100).toFixed(2)} more for this purchase</p>`;
        }

        // Build amount buttons - always show $5, $10, $20, highlight suggested amount
        const amounts = [
            { cents: 500, display: '$5' },
            { cents: 1000, display: '$10' },
            { cents: 2000, display: '$20' }
        ];
        
        // Add custom amount if it doesn't match existing buttons
        if (customAmountCents && !amounts.some(a => a.cents === customAmountCents)) {
            amounts.unshift({ cents: customAmountCents, display: `$${(customAmountCents / 100).toFixed(0)}`, recommended: true });
        } else if (customAmountCents) {
            // Mark existing amount as recommended
            const match = amounts.find(a => a.cents === customAmountCents);
            if (match) match.recommended = true;
        }
        
        const amountButtonsHTML = amounts.map(a => `
            <button class="funding-amount-btn ${a.recommended ? 'recommended' : ''}" data-amount="${a.cents}">
                <span class="amount">${a.display}</span>
                ${a.recommended ? '<span class="recommended-badge">Recommended</span>' : ''}
            </button>
        `).join('');

        const modalHTML = `
            <div id="fundingModal" class="modal-overlay">
                <div class="modal-content auth-modal">
                    <div class="auth-modal-header">
                        <img src="/static/clearcite-logo.png" alt="Clearcite" class="auth-modal-logo">
                        <h2>Add Funds to Your Wallet</h2>
                        <p>Choose an amount to add to your wallet</p>
                        ${suggestedDisplay}
                        <button class="modal-close" onclick="document.getElementById('fundingModal').remove()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; color: #999; cursor: pointer;">×</button>
                    </div>
                    <div class="auth-modal-content">
                        <div class="funding-amounts">
                            ${amountButtonsHTML}
                        </div>
                        <div id="stripePaymentElement" style="display: none; margin-top: 1.5rem;"></div>
                        <button id="stripeSubmitBtn" class="auth-btn" style="display: none; margin-top: 1rem;">
                            Complete Payment
                        </button>
                        <div id="fundingStatus" style="margin-top: 1rem; text-align: center; color: #666;"></div>
                    </div>
                    <div class="auth-modal-footer">
                        Powered by LedeWire Wallet • Secured by Stripe
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Add event listeners to amount buttons
        const amountButtons = document.querySelectorAll('.funding-amount-btn');
        amountButtons.forEach(btn => {
            btn.addEventListener('click', async () => {
                // Remove selected class from all buttons
                amountButtons.forEach(b => b.classList.remove('selected'));
                // Add selected class to clicked button
                btn.classList.add('selected');
                
                const amount = parseInt(btn.dataset.amount);
                await this._handleFundingAmountSelection(amount);
            });
        });

        // Close modal when clicking outside
        const modal = document.getElementById('fundingModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }
    }

    /**
     * Handle funding amount selection
     */
    async _handleFundingAmountSelection(amountCents) {
        const statusEl = document.getElementById('fundingStatus');
        statusEl.textContent = 'Preparing payment...';

        try {
            // Call backend to create payment session
            const response = await fetch(`${this.baseURL}/api/wallet/payment-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authService.getToken()}`
                },
                body: JSON.stringify({
                    amount_cents: amountCents,
                    currency: 'usd'
                })
            });

            if (!response.ok) {
                throw new Error('Failed to create payment session');
            }

            const { client_secret, public_key, session_id } = await response.json();
            
            // Store session_id for payment status polling
            this.currentPaymentSessionId = session_id;

            // Initialize Stripe with public key from LedeWire
            const stripe = Stripe(public_key);
            const elements = stripe.elements({ clientSecret: client_secret });
            const paymentElement = elements.create('payment');
            
            // Mount payment element
            const container = document.getElementById('stripePaymentElement');
            container.style.display = 'block';
            paymentElement.mount('#stripePaymentElement');

            // Show submit button
            const submitBtn = document.getElementById('stripeSubmitBtn');
            submitBtn.style.display = 'block';
            statusEl.textContent = '';

            // Handle payment submission
            submitBtn.onclick = async () => {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Processing...';
                statusEl.textContent = 'Processing payment...';

                const { error, paymentIntent } = await stripe.confirmPayment({
                    elements,
                    confirmParams: {
                        return_url: window.location.href
                    },
                    redirect: 'if_required'
                });

                if (error) {
                    statusEl.textContent = `Payment failed: ${error.message}`;
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Complete Payment';
                } else {
                    statusEl.textContent = '✅ Payment confirmed! Verifying with wallet...';
                    
                    // Poll for payment status confirmation from LedeWire
                    await this._pollAndConfirmPayment(statusEl, submitBtn);
                }
            };

        } catch (error) {
            console.error('Payment session error:', error);
            statusEl.textContent = 'Failed to initialize payment. Please try again.';
        }
    }

    /**
     * Poll LedeWire for payment completion and update UI
     */
    async _pollAndConfirmPayment(statusEl, submitBtn) {
        if (!this.currentPaymentSessionId) {
            console.warn('No payment session ID available for polling');
            await this._handlePaymentSuccess(statusEl);
            return;
        }

        statusEl.textContent = 'Verifying payment with wallet service...';

        // Use APIService polling if available, otherwise direct fetch
        if (this.apiService && this.apiService.pollPaymentStatus) {
            try {
                const result = await this.apiService.pollPaymentStatus(this.currentPaymentSessionId, 15, 2000);
                
                if (result.status === 'completed') {
                    console.log('✅ Payment verified by LedeWire');
                    await this._handlePaymentSuccess(statusEl, result.balance_cents);
                } else if (result.status === 'failed') {
                    statusEl.textContent = `Payment verification failed: ${result.message}`;
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Try Again';
                } else if (result.status === 'timeout') {
                    // Stripe confirmed but LedeWire polling timed out - assume success
                    console.log('⚠️ LedeWire polling timed out, but Stripe confirmed - treating as success');
                    await this._handlePaymentSuccess(statusEl);
                }
            } catch (pollError) {
                console.error('Payment polling error:', pollError);
                // Stripe already confirmed, so treat as success
                await this._handlePaymentSuccess(statusEl);
            }
        } else {
            // No API service - just confirm success based on Stripe response
            await this._handlePaymentSuccess(statusEl);
        }
    }

    /**
     * Handle successful payment completion
     */
    async _handlePaymentSuccess(statusEl, newBalanceCents = null) {
        statusEl.textContent = '✅ Payment successful! Updating balance...';
        
        // Trigger success callback
        if (this.onFundingSuccess) {
            await this.onFundingSuccess(newBalanceCents);
        }

        // Close modal after success
        setTimeout(() => {
            document.getElementById('fundingModal')?.remove();
            this.toastManager.show('Wallet funded successfully!', 'success', 3000);
        }, 1500);
        
        // Clear session ID
        this.currentPaymentSessionId = null;
    }
}
