/**
 * Projects Dropdown Controller
 * Handles the dropdown menu for project navigation
 */

export class ProjectsDropdown {
    constructor() {
        this.menuBtn = null;
        this.dropdown = null;
        this.isOpen = false;
        this.projectCount = 0;
    }

    /**
     * Initialize the dropdown controller
     */
    init() {
        this.menuBtn = document.getElementById('projectsMenuBtn');
        this.dropdown = document.getElementById('projectsDropdown');
        this.countBadge = document.getElementById('projectsCount');
        
        if (!this.menuBtn || !this.dropdown) {
            console.warn('⚠️ [ProjectsDropdown] Menu elements not found');
            return;
        }
        
        // Toggle dropdown on button click
        this.menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.dropdown.contains(e.target) && !this.menuBtn.contains(e.target)) {
                this.close();
            }
        });
        
        // Prevent dropdown close when clicking inside
        this.dropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        console.log('✅ [ProjectsDropdown] Initialized');
    }

    /**
     * Toggle dropdown open/close
     */
    toggle() {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    }

    /**
     * Open the dropdown
     */
    open() {
        this.isOpen = true;
        this.dropdown.classList.add('active');
        this.menuBtn.classList.add('active');
        console.log('📂 [ProjectsDropdown] Opened');
    }

    /**
     * Close the dropdown
     */
    close() {
        this.isOpen = false;
        this.dropdown.classList.remove('active');
        this.menuBtn.classList.remove('active');
        console.log('📁 [ProjectsDropdown] Closed');
    }

    /**
     * Update the project count badge
     * @param {number} count - Number of projects
     */
    updateCount(count) {
        this.projectCount = count;
        if (this.countBadge) {
            this.countBadge.textContent = count;
        }
    }
}
