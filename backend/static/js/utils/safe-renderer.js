/**
 * SafeRenderer - XSS Protection Utility
 * 
 * Provides centralized HTML sanitization and safe DOM insertion methods.
 * Use this for any content from external sources (LLM output, crawled data, user input).
 */

export class SafeRenderer {
    
    /**
     * Allowed HTML tags for sanitized content (formatted text like reports)
     * Only structural/formatting tags - no script, style, iframe, etc.
     */
    static ALLOWED_TAGS = new Set([
        'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li',
        'a', 'span', 'div',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'blockquote', 'pre', 'code',
        'sup', 'sub', 'hr'
    ]);
    
    /**
     * Allowed attributes (per tag or global)
     */
    static ALLOWED_ATTRS = {
        'a': ['href', 'title', 'target', 'rel'],
        'span': ['class', 'data-source-id', 'data-protocol', 'data-price', 'data-title', 'title'],
        'div': ['class', 'id'],
        'th': ['colspan', 'rowspan', 'class'],
        'td': ['colspan', 'rowspan', 'class'],
        'table': ['class'],
        'tr': ['class'],
        'p': ['class'],
        'ul': ['class'],
        'ol': ['class'],
        'li': ['class'],
        'h1': ['class', 'id'],
        'h2': ['class', 'id'],
        'h3': ['class', 'id'],
        'h4': ['class', 'id'],
        'blockquote': ['class'],
        'code': ['class'],
        'pre': ['class']
    };
    
    /**
     * Escape HTML entities in a string (for plain text display)
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text safe for innerHTML
     */
    static escapeHtml(text) {
        if (typeof text !== 'string') return '';
        
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
    
    /**
     * Sanitize HTML string by removing dangerous elements and attributes
     * @param {string} html - HTML string to sanitize
     * @returns {string} - Sanitized HTML
     */
    static sanitizeHtml(html) {
        if (typeof html !== 'string') return '';
        
        // Create a temporary container to parse HTML
        const temp = document.createElement('div');
        temp.innerHTML = html;
        
        // Recursively sanitize all elements
        this._sanitizeNode(temp);
        
        return temp.innerHTML;
    }
    
    /**
     * Parse and sanitize HTML string into DOM elements
     * Safe version of innerHTML-based parsing
     * @param {string} htmlString - HTML content to parse
     * @returns {HTMLElement|null} - Sanitized DOM element(s)
     */
    static parseHtmlSafe(htmlString) {
        if (typeof htmlString !== 'string') return null;
        if (!htmlString.trim()) return null;
        
        // Check if it looks like HTML
        if (!htmlString.trim().startsWith('<')) {
            // Plain text - create text node in a wrapper
            const wrapper = document.createElement('div');
            wrapper.textContent = htmlString;
            return wrapper;
        }
        
        try {
            const sanitized = this.sanitizeHtml(htmlString);
            const temp = document.createElement('div');
            temp.innerHTML = sanitized;
            
            // Return single child or wrapper
            if (temp.children.length === 1) {
                return temp.firstElementChild;
            } else if (temp.children.length > 1) {
                const wrapper = document.createElement('div');
                while (temp.firstChild) {
                    wrapper.appendChild(temp.firstChild);
                }
                return wrapper;
            } else if (temp.childNodes.length > 0) {
                return temp;
            }
            
            return null;
        } catch (error) {
            console.error('Error parsing HTML safely:', error);
            // Return escaped text as fallback
            const fallback = document.createElement('div');
            fallback.textContent = htmlString;
            return fallback;
        }
    }
    
    /**
     * Set text content safely (escapes all HTML)
     * @param {HTMLElement} element - Target element
     * @param {string} text - Text to set
     */
    static setTextContent(element, text) {
        if (element && typeof text === 'string') {
            element.textContent = text;
        }
    }
    
    /**
     * Set sanitized HTML content
     * @param {HTMLElement} element - Target element
     * @param {string} html - HTML to sanitize and set
     */
    static setSafeHtml(element, html) {
        if (element) {
            element.innerHTML = this.sanitizeHtml(html);
        }
    }
    
    /**
     * Create a text node (always safe)
     * @param {string} text - Text content
     * @returns {Text} - Text node
     */
    static createTextNode(text) {
        return document.createTextNode(text || '');
    }
    
    /**
     * Recursively sanitize a DOM node
     * @private
     */
    static _sanitizeNode(node) {
        // Process child nodes in reverse order (safe for removal)
        const children = Array.from(node.childNodes);
        
        for (const child of children) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tagName = child.tagName.toLowerCase();
                
                // Remove disallowed tags entirely
                if (!this.ALLOWED_TAGS.has(tagName)) {
                    // For dangerous tags, remove completely
                    if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'].includes(tagName)) {
                        child.remove();
                        continue;
                    }
                    // For other disallowed tags, unwrap (keep text content)
                    while (child.firstChild) {
                        node.insertBefore(child.firstChild, child);
                    }
                    child.remove();
                    continue;
                }
                
                // Sanitize attributes
                this._sanitizeAttributes(child, tagName);
                
                // Recursively sanitize children
                this._sanitizeNode(child);
            } else if (child.nodeType === Node.COMMENT_NODE) {
                // Remove HTML comments
                child.remove();
            }
        }
    }
    
    /**
     * Remove disallowed attributes from an element
     * @private
     */
    static _sanitizeAttributes(element, tagName) {
        const allowedAttrs = this.ALLOWED_ATTRS[tagName] || [];
        const attrs = Array.from(element.attributes);
        
        for (const attr of attrs) {
            const attrName = attr.name.toLowerCase();
            
            // Always remove event handlers
            if (attrName.startsWith('on')) {
                element.removeAttribute(attr.name);
                continue;
            }
            
            // Remove disallowed attributes
            if (!allowedAttrs.includes(attrName)) {
                element.removeAttribute(attr.name);
                continue;
            }
            
            // Special handling for href - prevent javascript: URLs
            // Normalize value to defeat whitespace/control character bypass attacks
            if (attrName === 'href') {
                if (this._isDangerousUrl(attr.value)) {
                    element.removeAttribute('href');
                }
            }
            
            // For links, ensure safe target and rel
            if (tagName === 'a') {
                element.setAttribute('target', '_blank');
                element.setAttribute('rel', 'noopener noreferrer');
            }
        }
    }
    
    /**
     * Check if a URL is dangerous (javascript:, data:, vbscript:, etc.)
     * Normalizes the URL to defeat whitespace/control character bypass attacks
     * @private
     */
    static _isDangerousUrl(url) {
        if (typeof url !== 'string') return true;
        
        // Step 1: Decode HTML entities FIRST (so &#x09; becomes tab, etc.)
        let normalized = url
            .replace(/&#(\d+);?/g, (_, num) => String.fromCharCode(parseInt(num, 10)))  // Decode decimal entities
            .replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));  // Decode hex entities
        
        // Step 2: THEN remove whitespace and control characters
        // This defeats attacks like "java\nscript:", "java&#x09;script:", etc.
        normalized = normalized
            .replace(/[\s\u0000-\u001F\u007F-\u009F]/g, '')  // Remove whitespace and control chars
            .toLowerCase()
            .trim();
        
        // Check for dangerous protocols
        const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
        for (const protocol of dangerousProtocols) {
            if (normalized.startsWith(protocol)) {
                return true;
            }
        }
        
        // Also block if it doesn't look like a valid URL scheme
        // Valid: http://, https://, mailto:, tel:, #, /path, ./path, ../path
        // Use the NORMALIZED string for pattern checks
        const validPatterns = [
            /^https?:\/\//,
            /^mailto:/,
            /^tel:/,
            /^#/,
            /^\//,
            /^\.\//,
            /^\.\.\//
        ];
        
        const hasValidPattern = validPatterns.some(pattern => pattern.test(normalized));
        if (!hasValidPattern && normalized.includes(':')) {
            // Has a colon but doesn't match valid patterns - suspicious
            return true;
        }
        
        return false;
    }
    
    /**
     * Format plain text for display with line breaks
     * @param {string} text - Plain text
     * @returns {string} - Escaped HTML with <br> for line breaks
     */
    static formatPlainText(text) {
        if (typeof text !== 'string') return '';
        return this.escapeHtml(text).replace(/\n/g, '<br>');
    }
}
