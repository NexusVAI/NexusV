
document.addEventListener('DOMContentLoaded', () => {
    // Search Animation Logic
    const searchContainer = document.querySelector('.search-container');
    const searchIcon = document.querySelector('.search-icon');
    const searchInput = document.querySelector('.search-input');
    
    if (searchIcon && searchContainer && searchInput) {
        searchIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            searchContainer.classList.toggle('active');
            if (searchContainer.classList.contains('active')) {
                searchInput.focus();
            }
        });

        // Close search when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchContainer.contains(e.target)) {
                searchContainer.classList.remove('active');
            }
        });

        // Prevent closing when clicking inside input
        searchInput.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
});
