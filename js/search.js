
document.addEventListener('DOMContentLoaded', () => {
    // Search Animation Logic
    const searchContainer = document.querySelector('.search-container');
    const searchIcon = document.querySelector('.search-icon');
    const searchInput = document.querySelector('.search-input');
    const mobileSearchDrawer = document.getElementById('mobile-search-drawer');
    const mobileSearchInput = document.querySelector('.mobile-search-input');
    const menuOverlay = document.querySelector('.menu-overlay');
    
    if (searchIcon) {
        searchIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Check if mobile (Disable search as requested)
            if (window.innerWidth <= 768) {
                // Mobile search is currently disabled/hidden
                return;
            } else if (searchContainer && searchInput) {
                // Desktop behavior
                searchContainer.classList.toggle('active');
                if (searchContainer.classList.contains('active')) {
                    searchInput.focus();
                }
            }
        });

        // Close search when clicking outside
        document.addEventListener('click', (e) => {
            // Close desktop search
            if (searchContainer && !searchContainer.contains(e.target)) {
                searchContainer.classList.remove('active');
            }
            // Close mobile search drawer
            if (mobileSearchDrawer && !mobileSearchDrawer.contains(e.target) && !searchIcon.contains(e.target)) {
                mobileSearchDrawer.classList.remove('active');
                if (menuOverlay && mobileSearchDrawer.classList.contains('active')) {
                    menuOverlay.classList.remove('active');
                }
            }
        });

        // Close search when clicking overlay
        if (menuOverlay) {
            menuOverlay.addEventListener('click', () => {
                if (mobileSearchDrawer && mobileSearchDrawer.classList.contains('active')) {
                    mobileSearchDrawer.classList.remove('active');
                    menuOverlay.classList.remove('active');
                }
            });
        }

        // Handle resize events to auto-close/disable search
        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768) {
                // Close desktop search if open
                if (searchContainer && searchContainer.classList.contains('active')) {
                    searchContainer.classList.remove('active');
                }
                // Close mobile search if open
                if (mobileSearchDrawer && mobileSearchDrawer.classList.contains('active')) {
                    mobileSearchDrawer.classList.remove('active');
                    if (menuOverlay) menuOverlay.classList.remove('active');
                }
            }
        });

        // Prevent closing when clicking inside inputs
        if (searchInput) {
            searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
        if (mobileSearchInput) {
            mobileSearchInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }
});
