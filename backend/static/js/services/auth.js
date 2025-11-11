/**
 * Authentication Service - Handles user authentication and wallet operations
 * Extracted from the monolithic ChatResearchApp
 */

import { analytics } from '../utils/analytics.js';

export class AuthService {
    constructor() {
        this.baseURL = window.location.origin;
        this.token = localStorage.getItem('ledewire_token');
        this.refreshToken = localStorage.getItem('ledewire_refresh_token');
        this.walletBalance = 0;
        this.logoutCallbacks = []; // Callbacks to trigger on logout
        
        // Decode userInfo from stored token on page load/reload
        if (this.token) {
            this.userInfo = this.decodeJWT(this.token);
        }
    }

    /**
     * Register a callback to be called when user is logged out
     * @param {Function} callback - Function to call on logout
     */
    onLogout(callback) {
        if (typeof callback === 'function') {
            this.logoutCallbacks.push(callback);
        }
    }

    /**
     * Check if user is authenticated with a valid (non-expired) token
     * @returns {boolean} - True if token exists and is not expired
     */
    isAuthenticated() {
        if (!this.token) return false;
        
        // Check if token is expired
        if (this.isTokenExpired(this.token)) {
            console.log('Token exists but is expired, logging out');
            this.clearToken();
            return false;
        }
        
        return true;
    }

    /**
     * Check if a JWT token is expired
     * @param {string} token - JWT token to check
     * @returns {boolean} - True if token is expired
     */
    isTokenExpired(token) {
        if (!token) return true;
        
        try {
            const payload = this.decodeJWT(token);
            if (!payload || !payload.exp) {
                return false; // If no exp claim, assume valid
            }
            
            // JWT exp is in seconds, Date.now() is in milliseconds
            const currentTime = Math.floor(Date.now() / 1000);
            const isExpired = payload.exp < currentTime;
            
            if (isExpired) {
                console.log('Token expired at:', new Date(payload.exp * 1000).toLocaleString());
            }
            
            return isExpired;
        } catch (error) {
            console.error('Error checking token expiry:', error);
            return true; // If we can't decode, treat as expired
        }
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
        // Track logout
        analytics.trackLogout();
        
        this.token = null;
        this.refreshToken = null;
        this.userInfo = null;
        this.walletBalance = 0;
        localStorage.removeItem('ledewire_token');
        localStorage.removeItem('ledewire_refresh_token');
        
        // Dispatch auth state changed event
        import('../utils/event-bus.js').then(({ AppEvents, EVENT_TYPES }) => {
            AppEvents.dispatchEvent(new CustomEvent(EVENT_TYPES.AUTH_STATE_CHANGED, {
                detail: { isAuthenticated: false }
            }));
        });
        
        // Trigger all logout callbacks to update UI
        this.logoutCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error('Error in logout callback:', error);
            }
        });
    }

    async login(email, password) {
        // Capture current user ID for conversation migration
        let previousUserId = null;
        try {
            const userIdResponse = await fetch(`${this.baseURL}/api/chat/user-id`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }  // ✅ FIXED: No getAuthHeaders()
            });
            if (userIdResponse.ok) {
                const userIdData = await userIdResponse.json();
                previousUserId = userIdData.user_id;
            }
        } catch (error) {
            console.log('Could not get previous user ID:', error.message);
        }

        // Warn if no previous user ID detected
        if (!previousUserId) {
            console.warn("No previous user ID detected. Migration will not trigger.");
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
        
        // Track successful login
        analytics.trackLogin('ledewire');
        
        return data;
    }

    async signup(email, password, firstName, lastName) {
        const response = await fetch(`${this.baseURL}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                email, 
                password,
                first_name: firstName,
                last_name: lastName
            })
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

    getUserId() {
        return this.userInfo?.buyer_claims?.user_id;
    }

    getUserInitials() {
        if (!this.userInfo || !this.userInfo.buyer_claims) {
            return 'U'; // Default fallback
        }
        
        const email = this.userInfo.buyer_claims.email;
        
        if (email) {
            // Extract initials from email (e.g., "rickybobby@hotmail.com" -> "RB")
            const namePart = email.split('@')[0];
            const parts = namePart.split(/[._-]/);
            
            if (parts.length >= 2) {
                const initials = (parts[0][0] + parts[1][0]).toUpperCase();
                return initials;
            }
            const initials = namePart.slice(0, 2).toUpperCase();
            return initials;
        }
        
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