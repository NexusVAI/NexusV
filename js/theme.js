function setTheme(theme) {
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');

    if (theme === 'light') {
        document.body.classList.add('light-theme');
        if (sunIcon) sunIcon.style.display = 'none';
        if (moonIcon) moonIcon.style.display = 'block';
    } else {
        document.body.classList.remove('light-theme');
        if (sunIcon) sunIcon.style.display = 'block';
        if (moonIcon) moonIcon.style.display = 'none';
    }
    localStorage.setItem('theme', theme);

    // Sync Cusdis theme if available
    if (typeof window.updateCusdisTheme === 'function') {
        window.updateCusdisTheme();
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    // Default to light if no saved theme
    const theme = savedTheme || 'light';
    setTheme(theme);
}

window.setTheme = setTheme;
window.initTheme = initTheme;
