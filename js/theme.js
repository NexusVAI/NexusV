function setTheme(theme) {
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    const warmIcon = document.querySelector('.warm-icon');
    const blueIcon = document.querySelector('.blue-icon');
    const root = document.documentElement;
    const body = document.body;

    // 清除所有主题类
    root.classList.remove('light-theme', 'warm-theme', 'blue-theme');
    if (body) body.classList.remove('light-theme', 'warm-theme', 'blue-theme');

    // 隐藏所有图标
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'none';
    if (warmIcon) warmIcon.style.display = 'none';
    if (blueIcon) blueIcon.style.display = 'none';

    // 应用对应主题
    if (theme === 'light') {
        root.classList.add('light-theme');
        if (body) body.classList.add('light-theme');
        if (sunIcon) sunIcon.style.display = 'block';
    } else if (theme === 'warm') {
        root.classList.add('warm-theme');
        if (body) body.classList.add('warm-theme');
        if (warmIcon) warmIcon.style.display = 'block';
    } else if (theme === 'blue') {
        root.classList.add('blue-theme');
        if (body) body.classList.add('blue-theme');
        if (sunIcon) sunIcon.style.display = 'block';
    } else {
        // dark theme (default)
        if (moonIcon) moonIcon.style.display = 'block';
    }

    localStorage.setItem('theme', theme);

    // Sync Cusdis theme if available
    if (typeof window.updateCusdisTheme === 'function') {
        window.updateCusdisTheme();
    }
}

function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'warm';
    const themeOrder = ['warm', 'dark', 'light', 'blue'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    const nextTheme = themeOrder[nextIndex];
    setTheme(nextTheme);
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    // Default to warm if no saved theme
    const theme = savedTheme || 'warm';
    setTheme(theme);
}

window.setTheme = setTheme;
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;
