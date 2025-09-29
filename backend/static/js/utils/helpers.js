/**
 * Utility Helper Functions
 * Extracted from the monolithic ChatResearchApp
 */

/**
 * Extract a compelling quote from text excerpt with fallback
 */
export function extractCompellingQuote(excerpt) {
    if (!excerpt || excerpt.length < 50) {
        // Fallback: return first 100 chars if excerpt is too short
        return excerpt ? truncateText(excerpt, 100) : null;
    }
    
    const sentences = excerpt.split(/[.!?]+/).filter(s => s.trim().length > 20);
    
    // Fallback: if no good sentences found, return first 100 chars
    if (sentences.length === 0) {
        return truncateText(excerpt, 100);
    }
    
    // Find the most "compelling" sentence (heuristic-based)
    let bestSentence = sentences[0];
    let bestScore = 0;
    
    for (const sentence of sentences) {
        let score = 0;
        const words = sentence.toLowerCase().split(/\s+/);
        
        // Score based on compelling words
        const compellingWords = ['significant', 'important', 'critical', 'reveals', 'shows', 'demonstrates', 'proves', 'indicates'];
        score += words.filter(word => compellingWords.some(cw => word.includes(cw))).length * 2;
        
        // Prefer moderate length sentences
        if (words.length >= 8 && words.length <= 20) score += 1;
        
        if (score > bestScore) {
            bestScore = score;
            bestSentence = sentence;
        }
    }
    
    // Final fallback: if no compelling sentence found, use first 100 chars
    const result = bestSentence.trim();
    if (!result || bestScore === 0) {
        return truncateText(excerpt, 100);
    }
    
    return result + (result.includes('.') ? '' : '...');
}

/**
 * Create source description from excerpt and quote with fuzzy matching
 */
export function createSourceDescription(excerpt, quote) {
    if (!excerpt) return "No preview available for this source.";
    
    let description = excerpt;
    
    // Safer quote removal with fuzzy matching
    if (quote) {
        // Clean the quote for matching (remove ellipsis and extra whitespace)
        const cleanQuote = quote.replace(/\.{3,}/g, '').replace(/\s+/g, ' ').trim();
        
        // Try multiple matching strategies
        if (cleanQuote.length > 10) {
            // Strategy 1: Exact match (after cleaning)
            if (excerpt.includes(cleanQuote)) {
                description = excerpt.replace(cleanQuote, '').trim();
            }
            // Strategy 2: Partial match (first 80% of quote)
            else {
                const partialQuote = cleanQuote.substring(0, Math.floor(cleanQuote.length * 0.8));
                if (partialQuote.length > 10 && excerpt.includes(partialQuote)) {
                    description = excerpt.replace(partialQuote, '').trim();
                }
            }
        }
        
        // Clean up any remaining artifacts from quote removal
        description = description
            .replace(/^[\s,.;:-]+/, '')  // Remove leading punctuation
            .replace(/[\s,.;:-]+$/, '')  // Remove trailing punctuation
            .trim();
    }
    
    // Ensure we have meaningful content
    if (!description || description.length < 20) {
        // If quote removal left too little, use original excerpt
        description = excerpt;
    }
    
    if (description.length > 150) {
        description = description.substring(0, 147) + '...';
    }
    
    return description || "Professional source with verified content.";
}

/**
 * Format currency amount
 */
export function formatCurrency(amount) {
    if (typeof amount !== 'number') return '$0.00';
    return `$${amount.toFixed(2)}`;
}

/**
 * Format date for display
 */
export function formatDate(date) {
    if (!date) return 'Unknown date';
    
    if (typeof date === 'string') {
        date = new Date(date);
    }
    
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text, maxLength = 100) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}

/**
 * Generate unique ID
 */
export function generateId() {
    return Date.now() + Math.random().toString(36).substr(2, 9);
}

/**
 * Debounce function calls
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function calls
 */
export function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Deep clone an object
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const cloned = {};
        Object.keys(obj).forEach(key => {
            cloned[key] = deepClone(obj[key]);
        });
        return cloned;
    }
}

/**
 * Check if element is in viewport
 */
export function isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
        rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
}

/**
 * Smooth scroll to element
 */
export function smoothScrollTo(element, offset = 0) {
    const targetPosition = element.offsetTop - offset;
    window.scrollTo({
        top: targetPosition,
        behavior: 'smooth'
    });
}

/**
 * Create DOM element with attributes and children
 */
export function createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    
    Object.entries(attributes).forEach(([key, value]) => {
        if (key === 'className') {
            element.className = value;
        } else if (key === 'innerHTML') {
            element.innerHTML = value;
        } else if (key === 'textContent') {
            element.textContent = value;
        } else {
            element.setAttribute(key, value);
        }
    });
    
    children.forEach(child => {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
            element.appendChild(child);
        }
    });
    
    return element;
}

/**
 * Wait for specified time (Promise-based delay)
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Sanitize filename for download
 */
export function sanitizeFilename(filename) {
    return filename.replace(/[^a-z0-9.-]/gi, '_');
}

/**
 * Generate idempotency key for API requests
 */
export function generateIdempotencyKey(userId, sourceId) {
    return `${userId}:${sourceId}:${Date.now()}`;
}