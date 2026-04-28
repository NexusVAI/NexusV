const NEXUS_RUNTIME = {
    bootstrapped: false,
    loadedScripts: new Map(),
    videoObserver: null,
    videoLoaders: new WeakMap()
};

function whenDocumentReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
        return;
    }
    callback();
}

function loadScriptOnce(src) {
    const normalizedSrc = String(src || '');
    if (!normalizedSrc) return Promise.reject(new Error('Missing script source'));
    if (NEXUS_RUNTIME.loadedScripts.has(normalizedSrc)) {
        return NEXUS_RUNTIME.loadedScripts.get(normalizedSrc);
    }

    const existingScript = Array.from(document.scripts).find((script) => {
        const currentSrc = script.getAttribute('src') || '';
        return currentSrc === normalizedSrc || currentSrc.endsWith(`/${normalizedSrc}`);
    });

    const promise = new Promise((resolve, reject) => {
        if (existingScript) {
            if (existingScript.dataset.loaded === '1') {
                resolve();
                return;
            }

            existingScript.addEventListener('load', () => {
                existingScript.dataset.loaded = '1';
                resolve();
            }, { once: true });
            existingScript.addEventListener('error', () => reject(new Error(`Failed to load ${normalizedSrc}`)), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = normalizedSrc;
        script.async = true;
        script.addEventListener('load', () => {
            script.dataset.loaded = '1';
            resolve();
        }, { once: true });
        script.addEventListener('error', () => reject(new Error(`Failed to load ${normalizedSrc}`)), { once: true });
        document.head.appendChild(script);
    });

    NEXUS_RUNTIME.loadedScripts.set(normalizedSrc, promise);
    return promise;
}

function isArticlePage() {
    return Boolean(document.querySelector('.article-page'));
}

function isIndexPage() {
    return Boolean(document.querySelector('.hero-card, .scrollable-list, .news-grid-2-col'));
}

function bindGlobalToggles() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle && themeToggle.dataset.bound !== '1') {
        themeToggle.dataset.bound = '1';
        themeToggle.addEventListener('click', () => {
            if (window.toggleTheme) window.toggleTheme();
        });
    }

    const langToggle = document.getElementById('lang-toggle');
    if (langToggle && langToggle.dataset.bound !== '1') {
        langToggle.dataset.bound = '1';
        langToggle.addEventListener('click', () => {
            const current = localStorage.getItem('lang') || 'zh';
            if (window.setLanguage) window.setLanguage(current === 'zh' ? 'en' : 'zh');
        });
    }

    const emailCopyBtn = document.getElementById('email-copy-btn');
    if (emailCopyBtn && emailCopyBtn.dataset.bound !== '1') {
        emailCopyBtn.dataset.bound = '1';
        emailCopyBtn.addEventListener('click', async () => {
            const emails = 'nexusvai@139.com, nexusvai@foxmail.com';
            try {
                await navigator.clipboard.writeText(emails);
                const originalTitle = emailCopyBtn.getAttribute('title') || '复制邮箱';
                const isZh = localStorage.getItem('lang') !== 'en';
                emailCopyBtn.setAttribute('title', isZh ? '已复制！' : 'Copied!');
                setTimeout(() => {
                    emailCopyBtn.setAttribute('title', originalTitle);
                }, 2000);
            } catch (err) {
                console.error('复制失败:', err);
            }
        });
    }
}

async function initPageContent() {
    if (isArticlePage()) {
        if (!window.initArticlePage) await loadScriptOnce('js/article.js');
        if (window.initArticlePage) window.initArticlePage();
        return;
    }

    if (isIndexPage()) {
        if (!window.initIndexPage) await loadScriptOnce('js/article.js');
        if (window.initIndexPage) window.initIndexPage();
    }
}

function bootstrapApp() {
    if (NEXUS_RUNTIME.bootstrapped) return;
    NEXUS_RUNTIME.bootstrapped = true;

    if (window.initTheme) window.initTheme();
    if (window.initLanguage) window.initLanguage();

    bindGlobalToggles();

    if (window.initMegaMenu) window.initMegaMenu();
    if (window.initMobileMenu) window.initMobileMenu();
    if (window.initActiveNavItem) window.initActiveNavItem();

    initLazyVideo();
    initPageContent().then(() => {
        initLazyVideo();
    }).catch((error) => {
        console.error('Failed to initialize page content:', error);
    });
}

function refreshInjectedUi() {
    bindGlobalToggles();

    if (window.initMegaMenu) window.initMegaMenu();
    if (window.initMobileMenu) window.initMobileMenu();
    if (window.initActiveNavItem) window.initActiveNavItem();
}

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
        } catch (error) {
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
            if (luma > this.whitePixelThreshold) whiteCount += 1;
        }

        const mean = sum / pixels;
        const variance = (sumSq / pixels) - mean * mean;
        const whiteRatio = whiteCount / pixels;
        return mean > this.meanThreshold && variance < this.varianceThreshold && whiteRatio > this.whiteRatioThreshold;
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
            isRejected: false,
            isActive: false
        };
        this.sourceUrl = '';
        this._loadTimeoutId = null;
        this._whiteWatchId = null;
        this.detector = new WhiteFrameDetector();
    }

    activate(sourceUrl) {
        if (this.state.isRejected) return;
        this.state.isActive = true;
        if (!this.state.isLoaded) {
            this.load(sourceUrl);
            return;
        }
        this._attemptPlay();
    }

    deactivate() {
        this.state.isActive = false;
        this._clearWhiteWatch();
        if (!this.video.paused) this.video.pause();
    }

    load(sourceUrl) {
        if (this.state.isLoaded) return;
        this.state.isLoaded = true;
        this.sourceUrl = sourceUrl;
        this._showPoster();
        this.video.src = sourceUrl;
        this.video.load();
        this._startLoadTimeout();
        this._attemptPlay();
    }

    reveal() {
        if (!this.state.isActive || this.state.isVideoVisible || this.state.isRejected) return;
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
        this.state.isLoaded = false;
        this.state.isVideoVisible = false;
        this._clearAllTimers();
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
        this._showPoster();
    }

    handleError() {
        this.state.isLoaded = false;
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
            if (!this.state.isVideoVisible || this.state.isRejected || !this.state.isActive) {
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
        if (!this.state.isActive) return;
        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(() => this._onPlaySuccess()).catch(() => this._showPoster());
        }
    }

    _onPlaySuccess() {
        if (!this.state.isActive) return;
        if (typeof this.video.requestVideoFrameCallback === 'function') {
            this.video.requestVideoFrameCallback(() => {
                if (!this.state.isActive) return;
                if (this.detector.isWhiteFrame(this.video)) this.reject();
                else this.reveal();
            });
            return;
        }

        setTimeout(() => {
            if (!this.state.isActive) return;
            if (this.detector.isWhiteFrame(this.video)) this.reject();
            else this.reveal();
        }, this.config.fallbackDelay);
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
}

function ensureVideoObserver() {
    if (NEXUS_RUNTIME.videoObserver || !('IntersectionObserver' in window)) {
        return NEXUS_RUNTIME.videoObserver;
    }

    NEXUS_RUNTIME.videoObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const loader = NEXUS_RUNTIME.videoLoaders.get(entry.target);
            if (!loader) return;
            if (entry.isIntersecting) {
                loader.activate(entry.target.dataset.videoSrc || '');
                return;
            }
            loader.deactivate();
        });
    }, {
        rootMargin: '180px 0px',
        threshold: 0.01
    });

    return NEXUS_RUNTIME.videoObserver;
}

function initLazyVideo() {
    const wrappers = document.querySelectorAll('.lazy-video-wrapper');
    if (!wrappers.length) return;

    const observer = ensureVideoObserver();

    wrappers.forEach((wrapper) => {
        if (wrapper.dataset.videoInit === '1') return;
        wrapper.dataset.videoInit = '1';

        const video = wrapper.querySelector('video');
        const poster = wrapper.querySelector('.video-poster');
        if (!video) return;

        const sourceUrl = video.getAttribute('data-src');
        if (!sourceUrl) return;

        wrapper.dataset.videoSrc = sourceUrl;
        configureVideoStyles(video, wrapper);
        setupPosterErrorHandling(poster);

        const loader = new VideoLoader(video, poster, {
            fallbackImage: video.getAttribute('data-fallback') || (poster ? poster.getAttribute('src') : '') || 'Logo/I2.webp'
        });

        setupVideoEventListeners(video, loader);
        NEXUS_RUNTIME.videoLoaders.set(wrapper, loader);

        if (wrapper.dataset.loadOnPoster === '1' && poster) {
            const startOnPosterReady = () => {
                if (wrapper.dataset.posterAutoLoaded === '1') return;
                wrapper.dataset.posterAutoLoaded = '1';
                loader.activate(sourceUrl);
            };

            if (poster.complete && poster.naturalWidth > 0) {
                requestAnimationFrame(startOnPosterReady);
            } else {
                poster.addEventListener('load', startOnPosterReady, { once: true });
            }
        }

        if (observer) {
            observer.observe(wrapper);
            return;
        }

        loader.activate(sourceUrl);
    });
}

function configureVideoStyles(video, wrapper) {
    const fitMode = video.getAttribute('data-fit');
    const posMode = video.getAttribute('data-pos') || 'center center';
    const frameBg = video.getAttribute('data-bg');
    if (fitMode) video.style.objectFit = fitMode;
    video.style.objectPosition = posMode;
    if (frameBg) wrapper.style.backgroundColor = frameBg;
}

function setupVideoEventListeners(video, loader) {
    if (video.dataset.runtimeBound === '1') return;
    video.dataset.runtimeBound = '1';

    video.addEventListener('playing', () => loader.reveal());
    video.addEventListener('timeupdate', () => {
        if (!loader.state.isVideoVisible && video.currentTime > loader.config.timeUpdateThreshold) {
            loader.reveal();
        }
    });
    video.addEventListener('error', () => loader.handleError());
}

function setupPosterErrorHandling(poster) {
    if (!poster || poster.dataset.runtimeBound === '1') return;
    poster.dataset.runtimeBound = '1';
    poster.addEventListener('error', () => {
        poster.src = 'Logo/I2.webp';
    });
}

window.initLazyVideo = initLazyVideo;

// AI Hero 功能
const AI_HERO = {
    placeholders: [
        "TACTFR 6.0 有哪些新功能？",
        "Sentience V4.1 什么时候发布？",
        "如何安装 NexusV 模组？",
        "NexusV 支持哪些游戏？",
        "解释 TACTFR 的 AI 驱动 NPC 系统",
        "Sentience 的实时对话能力如何使用？",
        "TACTFR 模组的最佳配置是什么？",
        "如何在游戏中启用 Sentience 功能？"
    ],
    currentIndex: 0,
    intervalId: null,

    init() {
        const input = document.getElementById('aiInput');
        const sendBtn = document.getElementById('aiSendBtn');
        const chips = document.querySelectorAll('.ai-chip');

        if (!input) return;

        // 开始占位文案轮换
        this.startRotation(input);

        // 发送按钮点击
        if (sendBtn) {
            sendBtn.addEventListener('click', () => this.handleSend(input));
        }

        // 回车发送
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSend(input);
            }
        });

        // 快捷标签点击
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const question = chip.dataset.question;
                if (question) {
                    this.jumpToChat(question);
                }
            });
        });

        // 输入时停止轮换
        input.addEventListener('input', () => {
            if (input.value) {
                this.stopRotation();
                input.placeholder = '';
            } else {
                this.startRotation(input);
            }
        });

        // 聚焦时停止轮换
        input.addEventListener('focus', () => this.stopRotation());
        input.addEventListener('blur', () => {
            if (!input.value) {
                this.startRotation(input);
            }
        });
    },

    startRotation(input) {
        if (this.intervalId) return;

        // 立即设置第一个
        input.placeholder = this.placeholders[this.currentIndex];

        this.intervalId = setInterval(() => {
            this.currentIndex = (this.currentIndex + 1) % this.placeholders.length;
            input.placeholder = this.placeholders[this.currentIndex];
        }, 3000);
    },

    stopRotation() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    },

    handleSend(input) {
        const question = input.value.trim() || input.placeholder;
        if (question) {
            this.jumpToChat(question);
        }
    },

    jumpToChat(question) {
        // 编码问题，跳转到 chat AI 页面
        const encoded = encodeURIComponent(question);
        window.location.href = `chat%20AI/cancri_chat_ui_v_3.html?q=${encoded}`;
    }
};

window.addEventListener('nexus:components-injected', refreshInjectedUi);

whenDocumentReady(() => {
    bootstrapApp();
    AI_HERO.init();
});
