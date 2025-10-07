/**
 * MessageRenderer - Unified Message Rendering System
 * 
 * This class provides a consistent, maintainable way to render all chat messages.
 * 
 * DESIGN PRINCIPLES:
 * 1. Single source of truth for message structure
 * 2. BEM-style CSS classes (message--{modifier})
 * 3. Consistent HTML structure across all message types
 * 4. Type-safe message schema (documented via JSDoc)
 * 
 * MESSAGE SCHEMA:
 * @typedef {Object} Message
 * @property {string} sender - Message sender type: 'user' | 'assistant' | 'system'
 * @property {string|HTMLElement} content - Message content (text or DOM element)
 * @property {Date|string} [timestamp] - Message timestamp
 * @property {Object} [metadata] - Additional metadata (research data, sources, etc)
 * @property {string} [variant] - Visual variant: 'loading' | 'error' | 'success' | null
 * 
 * CSS CLASS NAMING CONVENTION (BEM):
 * - Base: .message
 * - Type modifiers: .message--user, .message--assistant, .message--system
 * - State modifiers: .message--loading, .message--error, .message--success
 * - Elements: .message__avatar, .message__content, .message__header, .message__body
 * 
 * HTML STRUCTURE (Consistent across all types):
 * <div class="message message--{type} [message--{variant}]">
 *   <div class="message__avatar">{emoji}</div>
 *   <div class="message__content">
 *     <div class="message__header">
 *       <span class="message__sender">{sender}</span>
 *       <span class="message__time">{time}</span>
 *     </div>
 *     <div class="message__body">
 *       {content}
 *     </div>
 *   </div>
 * </div>
 */

export class MessageRenderer {
    
    static MESSAGE_TYPES = {
        USER: 'user',
        ASSISTANT: 'assistant',
        SYSTEM: 'system'
    };
    
    static MESSAGE_VARIANTS = {
        LOADING: 'loading',
        ERROR: 'error',
        SUCCESS: 'success',
        DEFAULT: null
    };
    
    static AVATARS = {
        user: '👤',
        assistant: '🤖',
        system: 'ℹ️',
        loading: '🔬'
    };
    
    /**
     * Create a standardized message DOM element
     * @param {Message} message - Message object
     * @returns {HTMLElement} - Message DOM element
     */
    static createMessageElement(message) {
        const {
            sender,
            content,
            timestamp,
            metadata,
            variant = null
        } = message;
        
        // Validate sender type
        const senderType = sender.toLowerCase().split(' ')[0]; // Handle 'system loading' -> 'system'
        
        // Create message container with BEM classes
        const messageDiv = document.createElement('div');
        messageDiv.className = this._buildMessageClasses(senderType, variant);
        
        // Create message structure
        const avatar = this._createAvatar(senderType, variant);
        const contentWrapper = this._createContent(message);
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(contentWrapper);
        
        return messageDiv;
    }
    
    /**
     * Build BEM-style CSS classes for message
     * @private
     */
    static _buildMessageClasses(senderType, variant) {
        const classes = ['message', `message--${senderType}`];
        
        if (variant) {
            classes.push(`message--${variant}`);
        }
        
        return classes.join(' ');
    }
    
    /**
     * Create message avatar element
     * @private
     */
    static _createAvatar(senderType, variant) {
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message__avatar';
        
        // Use variant-specific avatar if available, otherwise use type avatar
        const avatarKey = variant === 'loading' ? 'loading' : senderType;
        avatarDiv.textContent = this.AVATARS[avatarKey] || this.AVATARS.system;
        
        return avatarDiv;
    }
    
    /**
     * Create message content wrapper
     * @private
     */
    static _createContent(message) {
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'message__content';
        
        // Header (sender + timestamp)
        const header = this._createHeader(message);
        contentWrapper.appendChild(header);
        
        // Body (actual content)
        const body = this._createBody(message);
        contentWrapper.appendChild(body);
        
        return contentWrapper;
    }
    
    /**
     * Create message header (sender name + time)
     * @private
     */
    static _createHeader(message) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'message__header';
        
        // Sender label
        const senderSpan = document.createElement('span');
        senderSpan.className = 'message__sender';
        senderSpan.textContent = this._formatSender(message.sender);
        
        // Timestamp
        const timeSpan = document.createElement('span');
        timeSpan.className = 'message__time';
        timeSpan.textContent = this._formatTime(message.timestamp);
        
        headerDiv.appendChild(senderSpan);
        headerDiv.appendChild(timeSpan);
        
        return headerDiv;
    }
    
    /**
     * Create message body (content area)
     * @private
     */
    static _createBody(message) {
        const bodyDiv = document.createElement('div');
        bodyDiv.className = 'message__body';
        
        // Handle different content types
        if (message.content instanceof HTMLElement) {
            // DOM element - append directly
            // Check if this is a research report with citation metadata
            if (message.metadata?.citation_metadata) {
                this._injectCitationBadges(message.content, message.metadata.citation_metadata);
            }
            bodyDiv.appendChild(message.content);
        } else if (message.variant === 'loading' && typeof message.content === 'string') {
            // Loading variant - add spinner
            const loadingContent = this._createLoadingContent(message.content);
            bodyDiv.appendChild(loadingContent);
        } else {
            // Plain text or HTML string
            bodyDiv.innerHTML = this._formatContent(message.content);
            
            console.log('🔍 BADGE INJECT: metadata =', message.metadata);
            console.log('🔍 BADGE INJECT: citation_metadata =', message.metadata?.citation_metadata);
            
            // Inject citation badges after content is in DOM (for string content)
            if (message.metadata?.citation_metadata) {
                this._injectCitationBadges(bodyDiv, message.metadata.citation_metadata);
            }
        }
        
        return bodyDiv;
    }
    
    /**
     * Inject citation badges for locked sources in research reports
     * @private
     */
    static _injectCitationBadges(contentElement, citationMetadata) {
        console.log('🔍 INJECT BADGES called with:', { contentElement, citationMetadata });
        
        if (!contentElement || !citationMetadata) return;
        
        // Protocol icon mapping
        const protocolIcons = {
            'rsl': '🔒',
            'tollbit': '⚡',
            'cloudflare': '☁️'
        };
        
        console.log('🔍 INJECT BADGES: Protocol icons =', protocolIcons);
        
        // Find all text nodes that might contain citations
        const walker = document.createTreeWalker(
            contentElement,
            NodeFilter.SHOW_TEXT,
            null
        );
        
        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
            textNodes.push(node);
        }
        
        console.log('🔍 INJECT BADGES: Found text nodes =', textNodes.map(n => n.textContent))
        
        // Process each text node for citation patterns
        textNodes.forEach(textNode => {
            const text = textNode.textContent;
            const citationRegex = /\[(\d+)\]/g;
            let match;
            const fragments = [];
            let lastIndex = 0;
            
            while ((match = citationRegex.exec(text)) !== null) {
                const citationNum = parseInt(match[1]);
                const citationData = citationMetadata[citationNum];
                
                // Add text before citation
                if (match.index > lastIndex) {
                    fragments.push(document.createTextNode(text.substring(lastIndex, match.index)));
                }
                
                // Add citation number
                fragments.push(document.createTextNode(match[0]));
                
                // Add badge if source is locked
                if (citationData && citationData.locked) {
                    const badge = document.createElement('span');
                    const protocol = (citationData.protocol || 'rsl').toLowerCase();
                    badge.className = `citation-badge citation-badge--${protocol}`;
                    badge.setAttribute('data-source-id', citationData.source_id);
                    badge.setAttribute('data-protocol', protocol);
                    badge.setAttribute('data-price', citationData.price || 0);
                    badge.setAttribute('data-title', citationData.title || 'Source');
                    
                    const icon = protocolIcons[protocol] || '🔒';
                    const price = Number(citationData.price || 0).toFixed(2);
                    const priceText = price === '0.00' ? 'Free Source' : `$${price}`;
                    badge.textContent = `${icon} ${priceText}`;
                    badge.title = `Unlock: ${citationData.title || 'Source'} - $${price}`;
                    
                    fragments.push(badge);
                }
                
                lastIndex = citationRegex.lastIndex;
            }
            
            // Add remaining text
            if (lastIndex < text.length) {
                fragments.push(document.createTextNode(text.substring(lastIndex)));
            }
            
            // Replace text node with fragments if we found citations
            if (fragments.length > 0) {
                const parent = textNode.parentNode;
                fragments.forEach(fragment => {
                    parent.insertBefore(fragment, textNode);
                });
                parent.removeChild(textNode);
            }
        });
    }
    
    /**
     * Create loading indicator content
     * @private
     */
    static _createLoadingContent(text) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message__loading';
        
        const spinner = document.createElement('div');
        spinner.className = 'message__spinner';
        
        const textSpan = document.createElement('span');
        textSpan.className = 'message__loading-text';
        textSpan.textContent = text;
        
        loadingDiv.appendChild(spinner);
        loadingDiv.appendChild(textSpan);
        
        return loadingDiv;
    }
    
    /**
     * Format sender name for display
     * @private
     */
    static _formatSender(sender) {
        const senderMap = {
            'user': 'You',
            'assistant': 'Assistant',
            'system': 'System',
            'system loading': 'System'
        };
        
        return senderMap[sender.toLowerCase()] || sender;
    }
    
    /**
     * Format timestamp for display
     * @private
     */
    static _formatTime(timestamp) {
        try {
            if (!timestamp) {
                return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
            
            const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (error) {
            return '--:--';
        }
    }
    
    /**
     * Format message content (escape HTML, preserve formatting)
     * @private
     */
    static _formatContent(content) {
        if (typeof content !== 'string') {
            return '';
        }
        
        // Basic HTML escaping for security
        const escaped = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        
        // Preserve line breaks
        return escaped.replace(/\n/g, '<br>');
    }
}

/**
 * USAGE EXAMPLES:
 * 
 * // Basic user message
 * const userMessage = MessageRenderer.createMessageElement({
 *     sender: 'user',
 *     content: 'Hello, how can you help me?',
 *     timestamp: new Date()
 * });
 * 
 * // Loading indicator
 * const loadingMessage = MessageRenderer.createMessageElement({
 *     sender: 'system',
 *     content: 'Generating your research report...',
 *     variant: 'loading',
 *     timestamp: new Date()
 * });
 * 
 * // Assistant message with DOM content
 * const contentDiv = document.createElement('div');
 * contentDiv.innerHTML = '<strong>Research Results</strong>';
 * const assistantMessage = MessageRenderer.createMessageElement({
 *     sender: 'assistant',
 *     content: contentDiv,
 *     timestamp: new Date()
 * });
 */
