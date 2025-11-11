/**
 * ModalController - Handles auth and funding modal lifecycle
 * Extracted from app.js to reduce bloat and improve maintainability
 */
export class ModalController {
    constructor(authService, appState, toastManager, baseURL) {
        this.authService = authService;
        this.appState = appState;
        this.toastManager = toastManager;
        this.baseURL = baseURL || window.location.origin;
        
        // Callback references
        this.onAuthSuccess = null;
        this.onAuthToggle = null;
        this.onFundingSuccess = null;
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
     */
    async showFundingModal() {
        // Remove any existing funding modal
        const existingModal = document.getElementById('fundingModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modalHTML = `
            <div id="fundingModal" class="modal-overlay">
                <div class="modal-content auth-modal">
                    <div class="auth-modal-header">
                        <img src="/static/clearcite-logo.png" alt="Clearcite" class="auth-modal-logo">
                        <h2>Add Funds to Your Wallet</h2>
                        <p>Choose an amount to add to your wallet</p>
                        <button class="modal-close" onclick="document.getElementById('fundingModal').remove()" style="position: absolute; top: 1rem; right: 1rem; background: none; border: none; font-size: 1.5rem; color: #999; cursor: pointer;">×</button>
                    </div>
                    <div class="auth-modal-content">
                        <div class="funding-amounts">
                            <button class="funding-amount-btn" data-amount="500">
                                <span class="amount">$5</span>
                            </button>
                            <button class="funding-amount-btn" data-amount="1000">
                                <span class="amount">$10</span>
                            </button>
                            <button class="funding-amount-btn" data-amount="2000">
                                <span class="amount">$20</span>
                            </button>
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

            const { client_secret, public_key } = await response.json();

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

                const { error } = await stripe.confirmPayment({
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
                    statusEl.textContent = '✅ Payment successful! Updating balance...';
                    
                    // Trigger success callback
                    if (this.onFundingSuccess) {
                        await this.onFundingSuccess();
                    }

                    // Close modal after success
                    setTimeout(() => {
                        document.getElementById('fundingModal')?.remove();
                        this.toastManager.show('💰 Wallet funded successfully!', 'success', 3000);
                    }, 1500);
                }
            };

        } catch (error) {
            console.error('Payment session error:', error);
            statusEl.textContent = 'Failed to initialize payment. Please try again.';
        }
    }

    /**
     * Close auth modal
     */
    closeAuthModal() {
        const authModal = document.getElementById('authModal');
        if (authModal) {
            authModal.remove();
        }
    }

    /**
     * Close funding modal
     */
    closeFundingModal() {
        const fundingModal = document.getElementById('fundingModal');
        if (fundingModal) {
            fundingModal.remove();
        }
    }
}
