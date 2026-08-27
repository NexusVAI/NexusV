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

    // Keep OAI open-platform pages (models/docs/console chrome) in sync.
    // Those pages only support light|dark; warm/blue map to dark.
    try {
        var oai = (theme === 'light') ? 'light' : 'dark';
        localStorage.setItem('cancri_oai_theme', oai);
    } catch (e) {}

    // Sync Cusdis theme if available
    if (typeof window.updateCusdisTheme === 'function') {
        window.updateCusdisTheme();
    }
}

function toggleTheme() {
    // 2026-08-27：fallback 改为 warm，与各页 <head> 内联脚本的默认保持一致。
    const currentTheme = localStorage.getItem('theme') || 'warm';
    const themeOrder = ['light', 'dark', 'warm', 'blue'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    const nextTheme = themeOrder[nextIndex];
    setTheme(nextTheme);
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    // 2026-08-27：原默认为 'light'，但各页 <head> 内联脚本先加的是 warm-theme，
    // 于是首次访问会「warm 闪一下 → 被 setTheme('light') 改掉」，并且 setTheme
    // 顺手把 light 写进 localStorage 永久固化。两处默认统一为 warm 后闪烁消失。
    const theme = savedTheme || 'warm';
    setTheme(theme);
}

window.setTheme = setTheme;
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;
