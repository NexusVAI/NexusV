document.addEventListener('DOMContentLoaded', () => {
    // Init Theme
    if (window.initTheme) window.initTheme();

    // Init Lang
    if (window.initLanguage) window.initLanguage();

    // Events for toggles
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
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
    if (window.initActiveNavItem) window.initActiveNavItem();

    // Init Article
    if (window.initArticlePage) window.initArticlePage();
    
    // Init Index Page
    if (window.initIndexPage) window.initIndexPage();

    // Init Lazy Video
    initLazyVideo();
});

function initLazyVideo() {
    const wrappers = document.querySelectorAll('.lazy-video-wrapper');
    if (!wrappers.length) return;

    wrappers.forEach((wrapper) => {
        if (wrapper.dataset.videoInit === '1') return;
        wrapper.dataset.videoInit = '1';
        const video = wrapper.querySelector('video');
        const poster = wrapper.querySelector('.video-poster');
        if (!video) return;

        const sourceUrl = video.getAttribute('data-src');
        if (!sourceUrl) return;

        const fallbackImg = video.getAttribute('data-fallback') || poster?.getAttribute('src') || 'Logo/I2.webp';
        const fitMode = video.getAttribute('data-fit');
        const posMode = video.getAttribute('data-pos') || 'center center';
        const frameBg = video.getAttribute('data-bg');
        if (fitMode) video.style.objectFit = fitMode;
        video.style.objectPosition = posMode;
        if (frameBg) wrapper.style.backgroundColor = frameBg;
        let isLoaded = false;
        let hasPlayableFrame = false;
        let isVideoVisible = false;
        let isRejected = false;
        let loadTimeoutId = null;
        let whiteWatchId = null;
        const frameCanvas = document.createElement('canvas');
        const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });

        const showPoster = () => {
            if (!poster) return;
            if (!poster.getAttribute('src')) poster.setAttribute('src', fallbackImg);
            poster.style.opacity = '1';
            poster.style.visibility = 'visible';
            video.style.opacity = '0';
        };

        const clearTimer = () => {
            if (loadTimeoutId) {
                clearTimeout(loadTimeoutId);
                loadTimeoutId = null;
            }
        };

        const clearWhiteWatch = () => {
            if (whiteWatchId) {
                clearInterval(whiteWatchId);
                whiteWatchId = null;
            }
        };

        const rejectVideo = () => {
            if (isRejected) return;
            isRejected = true;
            isVideoVisible = false;
            clearTimer();
            clearWhiteWatch();
            video.pause();
            video.removeAttribute('src');
            video.load();
            showPoster();
        };

        const isLikelyWhiteFrame = () => {
            if (!frameCtx || !video.videoWidth || !video.videoHeight) return false;
            const sampleSize = 24;
            frameCanvas.width = sampleSize;
            frameCanvas.height = sampleSize;
            try {
                frameCtx.drawImage(video, 0, 0, sampleSize, sampleSize);
                const imageData = frameCtx.getImageData(0, 0, sampleSize, sampleSize).data;
                const pixels = sampleSize * sampleSize;
                let sum = 0;
                let sumSq = 0;
                let whiteCount = 0;
                for (let i = 0; i < imageData.length; i += 4) {
                    const luma = 0.2126 * imageData[i] + 0.7152 * imageData[i + 1] + 0.0722 * imageData[i + 2];
                    sum += luma;
                    sumSq += luma * luma;
                    if (luma > 245) whiteCount++;
                }
                const mean = sum / pixels;
                const variance = (sumSq / pixels) - mean * mean;
                const whiteRatio = whiteCount / pixels;
                return mean > 242 && variance < 90 && whiteRatio > 0.88;
            } catch (e) {
                return false;
            }
        };

        const revealVideo = () => {
            if (isVideoVisible || isRejected) return;
            if (isLikelyWhiteFrame()) {
                rejectVideo();
                return;
            }
            isVideoVisible = true;
            hasPlayableFrame = true;
            clearTimer();
            video.style.opacity = '1';
            if (poster) {
                poster.style.opacity = '0';
                setTimeout(() => {
                    if (isVideoVisible && !isRejected) poster.style.visibility = 'hidden';
                }, 800);
            }
            let checks = 0;
            whiteWatchId = setInterval(() => {
                checks += 1;
                if (!isVideoVisible || isRejected) {
                    clearWhiteWatch();
                    return;
                }
                if (isLikelyWhiteFrame()) {
                    rejectVideo();
                    return;
                }
                if (checks >= 6) clearWhiteWatch();
            }, 280);
        };

        const loadVideo = () => {
            if (isLoaded) return;
            isLoaded = true;
            showPoster();
            video.src = sourceUrl;
            video.load();
            loadTimeoutId = setTimeout(() => {
                if (!hasPlayableFrame) showPoster();
            }, 4500);

            const playPromise = video.play();
            if (playPromise && typeof playPromise.then === 'function') {
                playPromise.then(() => {
                    if (typeof video.requestVideoFrameCallback === 'function') {
                        video.requestVideoFrameCallback(() => {
                            if (isLikelyWhiteFrame()) rejectVideo();
                            else revealVideo();
                        });
                    } else {
                        setTimeout(() => {
                            if (isLikelyWhiteFrame()) rejectVideo();
                        }, 220);
                    }
                }).catch(() => showPoster());
            }
        };

        video.addEventListener('playing', revealVideo);
        video.addEventListener('timeupdate', () => {
            if (!isVideoVisible && video.currentTime > 0.08) revealVideo();
        });

        video.addEventListener('error', () => {
            clearTimer();
            clearWhiteWatch();
            showPoster();
        });

        if (poster) {
            poster.addEventListener('error', () => {
                poster.src = 'Logo/I2.webp';
            });
        }

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
            loadVideo();
        }
    });
}

window.initLazyVideo = initLazyVideo;
