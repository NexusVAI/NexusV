function setTheme(theme) {
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    const warmIcon = document.querySelector('.warm-icon');
    const blueIcon = document.querySelector('.blue-icon');
    const root = document.documentElement;
    const body = document.body;

    // Clear all theme classes (light is the new bare-:root default).
    root.classList.remove('light-theme', 'dark-theme', 'warm-theme', 'blue-theme');
    if (body) body.classList.remove('light-theme', 'dark-theme', 'warm-theme', 'blue-theme');

    // Hide all icons
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'none';
    if (warmIcon) warmIcon.style.display = 'none';
    if (blueIcon) blueIcon.style.display = 'none';

    if (theme === 'dark') {
        root.classList.add('dark-theme');
        if (body) body.classList.add('dark-theme');
        if (moonIcon) moonIcon.style.display = 'block';
    } else if (theme === 'warm') {
        root.classList.add('warm-theme');
        if (body) body.classList.add('warm-theme');
        if (warmIcon) warmIcon.style.display = 'block';
    } else if (theme === 'blue') {
        root.classList.add('blue-theme');
        if (body) body.classList.add('blue-theme');
        if (blueIcon) blueIcon.style.display = 'block';
    } else {
        // light theme — the OpenAI-style bare-:root default
        if (sunIcon) sunIcon.style.display = 'block';
    }

    localStorage.setItem('theme', theme);

    // Sync Cusdis theme if available
    if (typeof window.updateCusdisTheme === 'function') {
        window.updateCusdisTheme();
    }
}

function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    const themeOrder = ['light', 'dark', 'warm', 'blue'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    const nextTheme = themeOrder[nextIndex];
    setTheme(nextTheme);
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    // Default to light (OpenAI-style) if no saved theme
    const theme = savedTheme || 'light';
    setTheme(theme);
}

window.setTheme = setTheme;
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;
