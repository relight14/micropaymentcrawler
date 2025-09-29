/**
 * Authentication Service - Handles user authentication and wallet operations
 * Extracted from the monolithic ChatResearchApp
 */
export class AuthService {
    constructor() {
        this.baseURL = window.location.origin;
        this.token = localStorage.getItem('ledewire_token');
        this.refreshToken = localStorage.getItem('ledewire_refresh_token');
        this.walletBalance = 0;
    }

    isAuthenticated() {
        return !!this.token;
    }

    getToken() {
        return this.token;
    }

    setTokens(accessToken, refreshToken) {
        this.token = accessToken;
        this.refreshToken = refreshToken;
        localStorage.setItem('ledewire_token', accessToken);
        if (refreshToken) {
            localStorage.setItem('ledewire_refresh_token', refreshToken);
        }
    }

    setToken(token) {
        this.token = token;
        localStorage.setItem('ledewire_token', token);
    }

    clearToken() {
        this.token = null;
        this.refreshToken = null;
        localStorage.removeItem('ledewire_token');
        localStorage.removeItem('ledewire_refresh_token');
    }

    async login(email, password) {
        // Capture current user ID for conversation migration
        let previousUserId = null;
        try {
            const userIdResponse = await fetch(`${this.baseURL}/api/chat/user-id`, {
                method: 'GET',
                headers: this.getAuthHeaders()
            });
            if (userIdResponse.ok) {
                const userIdData = await userIdResponse.json();
                previousUserId = userIdData.user_id;
            }
        } catch (error) {
            console.log('Could not get previous user ID:', error.message);
        }

        const headers = { 'Content-Type': 'application/json' };
        if (previousUserId) {
            headers['X-Previous-User-ID'] = previousUserId;
        }

        const response = await fetch(`${this.baseURL}/api/auth/login`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Login failed');
        }

        const data = await response.json();
        this.setTokens(data.access_token, data.refresh_token);
        
        // Decode JWT to extract user info
        this.userInfo = this.decodeJWT(data.access_token);
        
        // Get wallet balance after login
        await this.updateWalletBalance();
        
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
        this.setTokens(data.access_token, data.refresh_token);
        
        // Decode JWT to extract user info
        this.userInfo = this.decodeJWT(data.access_token);
        
        // Get wallet balance after login
        await this.updateWalletBalance();
        
        return data;
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        const response = await fetch(`${this.baseURL}/api/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: this.refreshToken })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Token refresh failed');
        }

        const data = await response.json();
        this.setTokens(data.access_token, data.refresh_token);
        
        // Update user info with new token
        this.userInfo = this.decodeJWT(data.access_token);
        
        return data;
    }

    async updateWalletBalance() {
        if (!this.isAuthenticated()) {
            this.walletBalance = 0;
            return 0;
        }

        try {
            const response = await fetch(`${this.baseURL}/api/auth/balance`, {
                headers: { 
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 401) {
                // Try to refresh token before logging out
                if (this.refreshToken) {
                    try {
                        await this.refreshAccessToken();
                        // Retry the wallet balance request with new token
                        const retryResponse = await fetch(`${this.baseURL}/api/auth/balance`, {
                            headers: { 
                                'Authorization': `Bearer ${this.token}`,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (retryResponse.ok) {
                            const data = await retryResponse.json();
                            this.walletBalance = (data.balance_cents || 0) / 100;
                            return this.walletBalance;
                        }
                    } catch (refreshError) {
                        console.log('Token refresh failed, logging out:', refreshError.message);
                    }
                }
                
                // If refresh failed or no refresh token, log out
                this.clearToken();
                this.walletBalance = 0;
                return 0;
            }

            if (!response.ok) {
                throw new Error('Failed to fetch wallet balance');
            }

            const data = await response.json();
            this.walletBalance = (data.balance_cents || 0) / 100;
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
        this.userInfo = null;
    }

    getUserInfo() {
        return this.userInfo || {};
    }

    getUserInitials() {
        console.log('Getting user initials, userInfo:', this.userInfo);
        
        if (!this.userInfo || !this.userInfo.buyer_claims) {
            console.log('No userInfo or buyer_claims, returning U');
            return 'U'; // Default fallback
        }
        
        const email = this.userInfo.buyer_claims.email;
        console.log('User email:', email);
        
        if (email) {
            // Extract initials from email (e.g., "rickybobby@hotmail.com" -> "RB")
            const namePart = email.split('@')[0];
            const parts = namePart.split(/[._-]/);
            console.log('Email parts:', parts);
            
            if (parts.length >= 2) {
                const initials = (parts[0][0] + parts[1][0]).toUpperCase();
                console.log('Generated initials from parts:', initials);
                return initials;
            }
            const initials = namePart.slice(0, 2).toUpperCase();
            console.log('Generated initials from name part:', initials);
            return initials;
        }
        
        console.log('No email found, returning U');
        return 'U';
    }

    decodeJWT(token) {
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
                atob(base64)
                    .split('')
                    .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                    .join('')
            );
            return JSON.parse(jsonPayload);
        } catch (error) {
            console.error('Error decoding JWT:', error);
            return {};
        }
    }
}