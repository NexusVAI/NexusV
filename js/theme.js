function setTheme(theme) {
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    const root = document.documentElement;
    const body = document.body;

    if (theme === 'light') {
        root.classList.add('light-theme');
        if (body) body.classList.add('light-theme');
        if (sunIcon) sunIcon.style.display = 'none';
        if (moonIcon) moonIcon.style.display = 'block';
    } else {
        root.classList.remove('light-theme');
        if (body) body.classList.remove('light-theme');
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
