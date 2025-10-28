/**
 * OnboardingModal Component
 * Shows a 3-slide tutorial on first visit to introduce Clearcite's features
 */

import { analytics } from '../utils/analytics.js';

export class OnboardingModal {
    constructor() {
        this.currentSlide = 0;
        this.totalSlides = 3;
        this.localStorageKey = 'clearcite_onboarding_completed';
        
        this.slides = [
            {
                title: 'Welcome to Clearcite',
                icon: '✨',
                content: `
                    <h3>Real research, real sources, real citations</h3>
                    <p>Clearcite delivers verified information from authoritative sources with transparent licensing.</p>
                    <p>We compensate publishers ethically through LedeWire's micropayment system, ensuring you get authentic content while supporting quality journalism and research.</p>
                `
            },
            {
                title: 'Three Powerful Tabs',
                icon: '🎯',
                content: `
                    <div class="tab-feature">
                        <div class="feature-icon">💬</div>
                        <div class="feature-content">
                            <h4>Chat</h4>
                            <p>Explore topics conversationally and refine your questions through natural dialogue.</p>
                        </div>
                    </div>
                    <div class="tab-feature">
                        <div class="feature-icon">📚</div>
                        <div class="feature-content">
                            <h4>Sources</h4>
                            <p>Get verified articles, research papers, and authoritative content based on your conversation.</p>
                            <p class="login-required"><em>Requires login</em></p>
                        </div>
                    </div>
                    <div class="tab-feature">
                        <div class="feature-icon">📊</div>
                        <div class="feature-content">
                            <h4>Report Builder</h4>
                            <p>Generate professional AI summaries from your selected sources.</p>
                            <p class="login-required"><em>Requires login</em></p>
                        </div>
                    </div>
                `
            },
            {
                title: 'How It Works',
                icon: '🔓',
                content: `
                    <div class="workflow-steps">
                        <div class="workflow-step">
                            <div class="step-number">1</div>
                            <div class="step-content">
                                <h4>Submit Your Query</h4>
                                <p>Ask questions in Chat or search for specific sources in the Sources tab.</p>
                            </div>
                        </div>
                        <div class="workflow-step">
                            <div class="step-number">2</div>
                            <div class="step-content">
                                <h4>Unlock Premium Content</h4>
                                <p>Access licensed sources from publishers like WSJ, NYT, and academic journals. Each source displays its licensing protocol (RSL, Tollbit, Cloudflare).</p>
                            </div>
                        </div>
                        <div class="workflow-step">
                            <div class="step-number">3</div>
                            <div class="step-content">
                                <h4>Build Custom Reports</h4>
                                <p>Select sources and generate research reports with full citations. Download as markdown for your projects.</p>
                            </div>
                        </div>
                    </div>
                `
            }
        ];
    }
    
    shouldShow() {
        return !localStorage.getItem(this.localStorageKey);
    }
    
    show() {
        if (!this.shouldShow()) return;
        
        this.createModal();
        this.attachEventListeners();
        this.render();
    }
    
    createModal() {
        const modalHTML = `
            <div id="onboardingModal" class="onboarding-modal">
                <div class="onboarding-backdrop"></div>
                <div class="onboarding-content">
                    <button class="onboarding-skip" id="onboardingSkip">Skip</button>
                    <div class="onboarding-slide" id="onboardingSlide"></div>
                    <div class="onboarding-footer">
                        <div class="onboarding-dots" id="onboardingDots"></div>
                        <button class="onboarding-next" id="onboardingNext">Next</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.modal = document.getElementById('onboardingModal');
        
        setTimeout(() => {
            this.modal.classList.add('show');
        }, 100);
    }
    
    render() {
        const slideContainer = document.getElementById('onboardingSlide');
        const dotsContainer = document.getElementById('onboardingDots');
        const nextButton = document.getElementById('onboardingNext');
        
        if (!slideContainer || !dotsContainer || !nextButton) return;
        
        const slide = this.slides[this.currentSlide];
        
        slideContainer.innerHTML = `
            <div class="slide-icon">${slide.icon}</div>
            <h2>${slide.title}</h2>
            <div class="slide-body">${slide.content}</div>
        `;
        
        dotsContainer.innerHTML = Array(this.totalSlides)
            .fill(0)
            .map((_, i) => `<div class="dot ${i === this.currentSlide ? 'active' : ''}"></div>`)
            .join('');
        
        if (this.currentSlide === this.totalSlides - 1) {
            nextButton.textContent = 'Get Started';
            nextButton.classList.add('primary');
        } else {
            nextButton.textContent = 'Next';
            nextButton.classList.remove('primary');
        }
    }
    
    attachEventListeners() {
        const nextButton = document.getElementById('onboardingNext');
        const skipButton = document.getElementById('onboardingSkip');
        
        nextButton?.addEventListener('click', () => this.next());
        skipButton?.addEventListener('click', () => this.skip());
        
        document.querySelector('.onboarding-backdrop')?.addEventListener('click', () => this.skip());
    }
    
    next() {
        if (this.currentSlide < this.totalSlides - 1) {
            this.currentSlide++;
            this.render();
        } else {
            this.complete();
        }
    }
    
    skip() {
        analytics.trackOnboardingSkip(this.currentSlide + 1);
        this.complete();
    }
    
    complete() {
        if (this.currentSlide === this.totalSlides - 1) {
            analytics.trackOnboardingComplete();
        }
        
        localStorage.setItem(this.localStorageKey, 'true');
        
        this.modal?.classList.remove('show');
        
        setTimeout(() => {
            this.modal?.remove();
        }, 300);
    }
}
