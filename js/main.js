document.addEventListener('DOMContentLoaded', () => {
    // Init Theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    if (window.setTheme) window.setTheme(savedTheme);

    // Init Lang
    const savedLang = localStorage.getItem('lang') || 'zh';
    if (window.setLanguage) window.setLanguage(savedLang);

    // Events for toggles
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isLight = document.body.classList.contains('light-theme');
            window.setTheme(isLight ? 'dark' : 'light');
        });
    }

    const langToggle = document.getElementById('lang-toggle');
    if (langToggle) {
        langToggle.addEventListener('click', () => {
            const current = localStorage.getItem('lang') || 'zh';
            window.setLanguage(current === 'zh' ? 'en' : 'zh');
        });
    }

    // Init Menus
    if (window.initMegaMenu) window.initMegaMenu();
    if (window.initMobileMenu) window.initMobileMenu();

    // Init Article
    if (window.initArticlePage) window.initArticlePage();
});
