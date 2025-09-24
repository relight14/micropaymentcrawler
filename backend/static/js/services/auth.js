/**
 * Authentication Service - Handles user authentication and wallet operations
 * Extracted from the monolithic ChatResearchApp
 */
export class AuthService {
    constructor() {
        this.baseURL = window.location.origin;
        this.token = localStorage.getItem('ledewire_token');
        this.walletBalance = 0;
    }

    isAuthenticated() {
        return !!this.token;
    }

    getToken() {
        return this.token;
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('ledewire_token', token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem('ledewire_token');
    }

    async login(email, password) {
        const response = await fetch(`${this.baseURL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Login failed');
        }

        const data = await response.json();
        this.setToken(data.token);
        this.walletBalance = data.wallet_balance || 0;
        
        return data;
    }

    async signup(email, password) {
        const response = await fetch(`${this.baseURL}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Signup failed');
        }

        const data = await response.json();
        this.setToken(data.token);
        this.walletBalance = data.wallet_balance || 0;
        
        return data;
    }

    async updateWalletBalance() {
        if (!this.isAuthenticated()) {
            this.walletBalance = 0;
            return 0;
        }

        try {
            const response = await fetch(`${this.baseURL}/api/wallet/balance`, {
                headers: { 
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 401) {
                this.clearToken();
                this.walletBalance = 0;
                return 0;
            }

            if (!response.ok) {
                throw new Error('Failed to fetch wallet balance');
            }

            const data = await response.json();
            this.walletBalance = data.balance || 0;
            return this.walletBalance;
        } catch (error) {
            console.error('Error updating wallet balance:', error);
            this.walletBalance = 0;
            return 0;
        }
    }

    getWalletBalance() {
        return this.walletBalance;
    }

    logout() {
        this.clearToken();
        this.walletBalance = 0;
    }
}