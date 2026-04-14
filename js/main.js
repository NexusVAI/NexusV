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

class WhiteFrameDetector {
    constructor(config = {}) {
        this.sampleSize = config.sampleSize || 24;
        this.meanThreshold = config.meanThreshold || 242;
        this.varianceThreshold = config.varianceThreshold || 90;
        this.whiteRatioThreshold = config.whiteRatioThreshold || 0.88;
        this.whitePixelThreshold = config.whitePixelThreshold || 245;
        this._canvas = document.createElement('canvas');
        this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    }

    isWhiteFrame(video) {
        if (!this._ctx || !video.videoWidth || !video.videoHeight) return false;
        this._canvas.width = this.sampleSize;
        this._canvas.height = this.sampleSize;
        try {
            this._ctx.drawImage(video, 0, 0, this.sampleSize, this.sampleSize);
            const imageData = this._ctx.getImageData(0, 0, this.sampleSize, this.sampleSize).data;
            return this._analyzePixels(imageData);
        } catch (e) {
            return false;
        }
    }

    _analyzePixels(imageData) {
        const pixels = this.sampleSize * this.sampleSize;
        let sum = 0;
        let sumSq = 0;
        let whiteCount = 0;
        for (let i = 0; i < imageData.length; i += 4) {
            const luma = 0.2126 * imageData[i] + 0.7152 * imageData[i + 1] + 0.0722 * imageData[i + 2];
            sum += luma;
            sumSq += luma * luma;
            if (luma > this.whitePixelThreshold) whiteCount++;
        }
        const mean = sum / pixels;
        const variance = (sumSq / pixels) - mean * mean;
        const whiteRatio = whiteCount / pixels;
        return mean > this.meanThreshold && variance < this.varianceThreshold && whiteRatio > this.whiteRatioThreshold;
    }
}

class LazyLoadTrigger {
    constructor(options = {}) {
        this.rootMargin = options.rootMargin || '50px';
    }

    observe(element, callback) {
        if (!('IntersectionObserver' in window)) {
            callback();
            return () => {};
        }
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    callback();
                    observer.unobserve(element);
                }
            });
        }, { rootMargin: this.rootMargin });
        observer.observe(element);
        return () => observer.unobserve(element);
    }
}

class VideoLoader {
    constructor(video, poster, config = {}) {
        this.video = video;
        this.poster = poster;
        this.config = {
            timeout: config.timeout || 4500,
            fallbackImage: config.fallbackImage || 'Logo/I2.webp',
            whiteWatchInterval: config.whiteWatchInterval || 280,
            whiteWatchMaxChecks: config.whiteWatchMaxChecks || 6,
            fallbackDelay: config.fallbackDelay || 220,
            posterFadeDelay: config.posterFadeDelay || 800,
            timeUpdateThreshold: config.timeUpdateThreshold || 0.08
        };
        this.state = {
            isLoaded: false,
            hasPlayableFrame: false,
            isVideoVisible: false,
            isRejected: false
        };
        this._loadTimeoutId = null;
        this._whiteWatchId = null;
        this.detector = new WhiteFrameDetector();
    }

    load(sourceUrl) {
        if (this.state.isLoaded) return;
        this.state.isLoaded = true;
        this._showPoster();
        this.video.src = sourceUrl;
        this.video.load();
        this._startLoadTimeout();
        this._attemptPlay();
    }

    reveal() {
        if (this.state.isVideoVisible || this.state.isRejected) return;
        if (this.detector.isWhiteFrame(this.video)) {
            this.reject();
            return;
        }
        this.state.isVideoVisible = true;
        this.state.hasPlayableFrame = true;
        this._clearLoadTimeout();
        this.video.style.opacity = '1';
        this._hidePoster();
        this._startWhiteWatch();
    }

    reject() {
        if (this.state.isRejected) return;
        this.state.isRejected = true;
        this.state.isVideoVisible = false;
        this._clearAllTimers();
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this._showPoster();
    }

    handleError() {
        this._clearAllTimers();
        this._showPoster();
    }

    _showPoster() {
        if (!this.poster) return;
        if (!this.poster.getAttribute('src')) this.poster.setAttribute('src', this.config.fallbackImage);
        this.poster.style.opacity = '1';
        this.poster.style.visibility = 'visible';
        this.video.style.opacity = '0';
    }

    _hidePoster() {
        if (!this.poster) return;
        this.poster.style.opacity = '0';
        setTimeout(() => {
            if (this.state.isVideoVisible && !this.state.isRejected) {
                this.poster.style.visibility = 'hidden';
            }
        }, this.config.posterFadeDelay);
    }

    _startLoadTimeout() {
        this._loadTimeoutId = setTimeout(() => {
            if (!this.state.hasPlayableFrame) this._showPoster();
        }, this.config.timeout);
    }

    _startWhiteWatch() {
        let checks = 0;
        this._whiteWatchId = setInterval(() => {
            checks += 1;
            if (!this.state.isVideoVisible || this.state.isRejected) {
                this._clearWhiteWatch();
                return;
            }
            if (this.detector.isWhiteFrame(this.video)) {
                this.reject();
                return;
            }
            if (checks >= this.config.whiteWatchMaxChecks) this._clearWhiteWatch();
        }, this.config.whiteWatchInterval);
    }

    _attemptPlay() {
        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(() => this._onPlaySuccess()).catch(() => this._showPoster());
        }
    }

    _onPlaySuccess() {
        if (typeof this.video.requestVideoFrameCallback === 'function') {
            this.video.requestVideoFrameCallback(() => {
                if (this.detector.isWhiteFrame(this.video)) this.reject();
                else this.reveal();
            });
        } else {
            setTimeout(() => {
                if (this.detector.isWhiteFrame(this.video)) this.reject();
            }, this.config.fallbackDelay);
        }
    }

    _clearAllTimers() {
        this._clearLoadTimeout();
        this._clearWhiteWatch();
    }

    _clearLoadTimeout() {
        if (this._loadTimeoutId) {
            clearTimeout(this._loadTimeoutId);
            this._loadTimeoutId = null;
        }
    }

    _clearWhiteWatch() {
        if (this._whiteWatchId) {
            clearInterval(this._whiteWatchId);
            this._whiteWatchId = null;
        }
    }

    destroy() {
        this._clearAllTimers();
    }
}

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

        _configureVideoStyles(video, wrapper);

        const loader = new VideoLoader(video, poster, {
            fallbackImage: video.getAttribute('data-fallback') || poster?.getAttribute('src') || 'Logo/I2.webp'
        });

        _setupVideoEventListeners(video, loader);
        _setupPosterErrorHandling(poster);

        const trigger = new LazyLoadTrigger({ rootMargin: '50px' });
        trigger.observe(wrapper, () => loader.load(sourceUrl));
    });
}

function _configureVideoStyles(video, wrapper) {
    const fitMode = video.getAttribute('data-fit');
    const posMode = video.getAttribute('data-pos') || 'center center';
    const frameBg = video.getAttribute('data-bg');
    if (fitMode) video.style.objectFit = fitMode;
    video.style.objectPosition = posMode;
    if (frameBg) wrapper.style.backgroundColor = frameBg;
}

function _setupVideoEventListeners(video, loader) {
    video.addEventListener('playing', () => loader.reveal());
    video.addEventListener('timeupdate', () => {
        if (!loader.state.isVideoVisible && video.currentTime > loader.config.timeUpdateThreshold) {
            loader.reveal();
        }
    });
    video.addEventListener('error', () => loader.handleError());
}

function _setupPosterErrorHandling(poster) {
    if (!poster) return;
    poster.addEventListener('error', () => {
        poster.src = 'Logo/I2.webp';
    });
}

window.initLazyVideo = initLazyVideo;
