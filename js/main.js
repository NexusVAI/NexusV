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

    // Init Lazy Video
    initLazyVideo();
});

function initLazyVideo() {
    const wrapper = document.querySelector('.lazy-video-wrapper');
    if (!wrapper) return;

    const video = wrapper.querySelector('video');
    const poster = wrapper.querySelector('.video-poster');
    const sourceUrl = video.getAttribute('data-src');

    if (!sourceUrl) return;

    // Browser detection for debugging
    console.log('[Debug] Viewport:', window.innerWidth, 'x', window.innerHeight);
    console.log('[Debug] UA:', navigator.userAgent);
    
    // QQ Browser / Specific browser detection logic (as requested)
    const isQQ = /QQBrowser/i.test(navigator.userAgent);
    if (isQQ) {
        console.log('[Debug] Detected QQ Browser');
        // Example: Force desktop layout logic if needed, but CSS fix is primary.
        // If window.innerWidth >= 1024, ensure mobile menu is hidden.
        if (window.innerWidth >= 1024) {
            document.body.classList.add('force-desktop');
        }
    }

    let isLoaded = false;

    const loadVideo = () => {
        if (isLoaded) return;
        isLoaded = true;
        
        video.src = sourceUrl;
        video.load();
        
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.then(_ => {
                // Play started
            }).catch(error => {
                console.log("Autoplay prevented:", error);
                // Keep poster visible on error/prevention
            });
        }
    };

    video.addEventListener('canplay', () => {
        // Fade in video, fade out poster
        video.style.opacity = '1';
        poster.style.opacity = '0';
        
        // After transition, can hide poster (optional)
        setTimeout(() => {
            poster.style.visibility = 'hidden';
        }, 800);
    });

    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    loadVideo();
                    observer.unobserve(wrapper);
                }
            });
        }, { rootMargin: '50px' });
        
        observer.observe(wrapper);
    } else {
        // Fallback for browsers without IntersectionObserver
        loadVideo();
    }
}
