/**
 * Mobile Bottom Navigation Component
 * Provides tab-based navigation for Projects, Chat, and Outline on mobile devices
 */

import { viewport } from '../utils/viewport.js';

export class MobileNavigation {
    constructor() {
        this.currentPanel = 'chat'; // Default to chat view
        this.init();
    }

    init() {
        this.render();
        this.attachEventListeners();
        this.updatePanelVisibility();
    }

    render() {
        const existingNav = document.getElementById('mobile-nav');
        if (existingNav) {
            existingNav.remove();
        }

        const nav = document.createElement('nav');
        nav.id = 'mobile-nav';
        nav.className = 'mobile-nav';
        nav.setAttribute('role', 'navigation');
        nav.setAttribute('aria-label', 'Mobile navigation');

        nav.innerHTML = `
            <button 
                class="mobile-nav-tab ${this.currentPanel === 'projects' ? 'active' : ''}" 
                data-panel="projects"
                aria-label="Projects"
                ${this.currentPanel === 'projects' ? 'aria-current="page"' : ''}
            >
                <svg class="mobile-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                </svg>
                <span class="mobile-nav-label">Projects</span>
            </button>
            
            <button 
                class="mobile-nav-tab ${this.currentPanel === 'chat' ? 'active' : ''}" 
                data-panel="chat"
                aria-label="Chat"
                ${this.currentPanel === 'chat' ? 'aria-current="page"' : ''}
            >
                <svg class="mobile-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
                <span class="mobile-nav-label">Chat</span>
            </button>
            
            <button 
                class="mobile-nav-tab ${this.currentPanel === 'sources' ? 'active' : ''}" 
                data-panel="sources"
                aria-label="Sources"
                ${this.currentPanel === 'sources' ? 'aria-current="page"' : ''}
            >
                <svg class="mobile-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <path d="M14 2v6h6"/>
                    <path d="M16 13H8"/>
                    <path d="M16 17H8"/>
                    <path d="M10 9H8"/>
                </svg>
                <span class="mobile-nav-label">Sources</span>
            </button>
            
            <button 
                class="mobile-nav-tab ${this.currentPanel === 'outline' ? 'active' : ''}" 
                data-panel="outline"
                aria-label="Outline"
                ${this.currentPanel === 'outline' ? 'aria-current="page"' : ''}
            >
                <svg class="mobile-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
                </svg>
                <span class="mobile-nav-label">Outline</span>
            </button>
        `;

        document.body.appendChild(nav);

        this.createBackdrop();
    }

    createBackdrop() {
        let backdrop = document.getElementById('mobile-backdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'mobile-backdrop';
            backdrop.className = 'mobile-backdrop';
            backdrop.addEventListener('click', () => this.switchPanel('chat'));
            document.body.appendChild(backdrop);
        }
    }

    attachEventListeners() {
        const tabs = document.querySelectorAll('.mobile-nav-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const panel = e.currentTarget.getAttribute('data-panel');
                this.switchPanel(panel);
            });
        });
    }

    switchPanel(panel) {
        console.log('📱 [MobileNav] switchPanel() called', {
            fromPanel: this.currentPanel,
            toPanel: panel,
            windowWidth: window.innerWidth
        });
        
        this.currentPanel = panel;
        this.updateTabStates();
        this.updatePanelVisibility();

        window.dispatchEvent(new CustomEvent('mobilePanelChanged', {
            detail: { panel }
        }));
    }

    updateTabStates() {
        const tabs = document.querySelectorAll('.mobile-nav-tab');
        tabs.forEach(tab => {
            const tabPanel = tab.getAttribute('data-panel');
            if (tabPanel === this.currentPanel) {
                tab.classList.add('active');
                tab.setAttribute('aria-current', 'page');
            } else {
                tab.classList.remove('active');
                tab.removeAttribute('aria-current');
            }
        });
    }

    updatePanelVisibility() {
        console.log('📱 [MobileNav] updatePanelVisibility() called', {
            currentPanel: this.currentPanel
        });
        
        const projectSidebar = document.getElementById('project-sidebar');
        const mainContent = document.getElementById('main-content');
        const sourcesPanel = document.getElementById('sources-panel');
        const outlineBuilder = document.getElementById('outline-builder');
        const backdrop = document.getElementById('mobile-backdrop');

        console.log('📱 [MobileNav] DOM elements check:', {
            projectSidebar: !!projectSidebar,
            mainContent: !!mainContent,
            sourcesPanel: !!sourcesPanel,
            outlineBuilder: !!outlineBuilder,
            backdrop: !!backdrop
        });

        if (!projectSidebar || !mainContent || !sourcesPanel || !outlineBuilder) {
            console.error('📱 [MobileNav] ERROR: Missing required DOM elements!');
            return;
        }

        projectSidebar.classList.remove('visible', 'mobile-active');
        mainContent.classList.remove('mobile-hidden');
        sourcesPanel.classList.remove('visible', 'mobile-active');
        outlineBuilder.classList.remove('visible', 'mobile-active');
        backdrop.classList.remove('visible');

        switch (this.currentPanel) {
            case 'projects':
                console.log('📱 [MobileNav] Showing Projects panel - adding classes to #project-sidebar');
                projectSidebar.classList.add('visible', 'mobile-active');
                backdrop.classList.add('visible');
                console.log('📱 [MobileNav] Classes added:', {
                    projectSidebarClasses: projectSidebar.className,
                    backdropClasses: backdrop.className
                });
                break;
            case 'chat':
                console.log('📱 [MobileNav] Showing Chat panel (default)');
                break;
            case 'sources':
                console.log('📱 [MobileNav] Showing Sources panel');
                sourcesPanel.classList.add('visible', 'mobile-active');
                backdrop.classList.add('visible');
                break;
            case 'outline':
                console.log('📱 [MobileNav] Showing Outline panel');
                outlineBuilder.classList.add('visible', 'mobile-active');
                backdrop.classList.add('visible');
                break;
        }
    }

    getCurrentPanel() {
        return this.currentPanel;
    }
}
