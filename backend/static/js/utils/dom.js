export function safeQuery(selector, parent = document) {
    return parent.querySelector(selector);
}

export function safeQueryAll(selector, parent = document) {
    return Array.from(parent.querySelectorAll(selector));
}

export function safeAppend(parent, child) {
    if (parent && child) {
        parent.appendChild(child);
    }
}

export function fadeOut(element, duration = 300) {
    if (!element) return Promise.resolve();
    
    return new Promise(resolve => {
        element.style.transition = `opacity ${duration}ms`;
        element.style.opacity = '0';
        setTimeout(() => {
            element.remove();
            resolve();
        }, duration);
    });
}

export function fadeIn(element, duration = 300) {
    if (!element) return Promise.resolve();
    
    return new Promise(resolve => {
        element.style.opacity = '0';
        element.style.transition = `opacity ${duration}ms`;
        setTimeout(() => {
            element.style.opacity = '1';
            resolve();
        }, 10);
    });
}

export function createElement(tag, className = '', innerHTML = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML) el.innerHTML = innerHTML;
    return el;
}

export function scrollToBottom(element, smooth = true) {
    if (!element) return;
    element.scrollTo({
        top: element.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
    });
}

export function scrollToTop(element, smooth = true) {
    if (!element) return;
    element.scrollTo({
        top: 0,
        behavior: smooth ? 'smooth' : 'auto'
    });
}
