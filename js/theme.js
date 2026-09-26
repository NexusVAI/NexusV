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

// 2026-09-26：默认改为浅色。旧版 initTheme 会把默认的 warm 写进 localStorage，
// 所以「有没有存 theme」分不清是用户选的还是被默认值固化的——只有用户亲手切换过
// （theme_user=1）才沿用已存主题，否则一律浅色。各页 <head> 内联脚本用同一判据。
function resolveTheme() {
    try {
        if (localStorage.getItem('theme_user') === '1') return localStorage.getItem('theme') || 'light';
    } catch (e) {}
    return 'light';
}

function toggleTheme() {
    const currentTheme = resolveTheme();
    const themeOrder = ['light', 'dark', 'warm', 'blue'];
    const currentIndex = themeOrder.indexOf(currentTheme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    const nextTheme = themeOrder[nextIndex];
    try { localStorage.setItem('theme_user', '1'); } catch (e) {}
    setTheme(nextTheme);
}

function initTheme() {
    setTheme(resolveTheme());
}

window.setTheme = setTheme;
window.initTheme = initTheme;
window.toggleTheme = toggleTheme;
