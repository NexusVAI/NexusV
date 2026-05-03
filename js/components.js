(function() {
    'use strict';

    function getBasePath() {
        const path = window.location.pathname;
        if (path.includes('/article.html') || path.includes('/about.html')) return '.';
        return '.';
    }

    const base = getBasePath();

    const navbarHTML = `
    <nav class="navbar">
        <div class="navbar-inner">
            <div class="nav-left">
                <a href="${base}/index.html" class="logo">NexusV</a>
                <div class="nav-links">
                    <div class="nav-item has-dropdown" data-menu="research" data-i18n="nav.research">研究</div>
                    <div class="nav-item has-dropdown" data-menu="safety" data-i18n="nav.safety">安全</div>
                    <a href="${base}/API文档网站/index.html" class="nav-item" data-i18n="nav.developer">NexusV开放平台</a>
                    <a href="${base}/about.html" class="nav-item" data-i18n="nav.company">公司</a>
                    <a href="${base}/index.html#latest-news" class="nav-item" data-i18n="nav.news">新闻</a>
                    <a href="${base}/about.html" class="nav-item" data-i18n="nav.contact">联系我们</a>
                    <div class="search-container search-container--nav" aria-label="搜索">
                        <div class="search-icon" aria-label="搜索">
                            <svg class="icon-search" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                            <svg class="icon-close" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </div>
                    </div>
                </div>
            </div>
            <div class="nav-right">
                <div class="search-container search-container--mobile" aria-label="搜索">
                    <div class="search-icon">
                        <svg class="icon-search" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                        <svg class="icon-close" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </div>
                </div>
                <a href="https://www.wanjiadongli.com/user/1753255?tab=2" class="btn-pill"><span data-i18n="nav.try">试用 NexusV ↗</span></a>
                <button class="mobile-menu-btn" aria-label="菜单">
                    <span></span><span></span><span></span>
                </button>
            </div>
        </div>
    </nav>`;

    const megaMenuHTML = `
    <div class="mega-menu-container" id="mega-menu">
        <div class="mega-menu-inner">
            <div class="menu-content-wrapper" id="menu-content-wrapper"></div>
            <div class="menu-line"></div>
        </div>
    </div>`;

    const searchOverlayHTML = `
    <div class="search-overlay" id="search-overlay">
        <div class="search-overlay-content">
            <div class="search-overlay-input-wrapper">
                <input type="text" class="search-overlay-input" data-i18n-placeholder="search.placeholder" placeholder="搜索 NexusV..." autocomplete="off">
                <button class="search-overlay-submit" aria-label="搜索">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="12" y1="19" x2="12" y2="5"></line>
                        <polyline points="5 12 12 5 19 12"></polyline>
                    </svg>
                </button>
            </div>
        </div>
    </div>`;

    const footerHTML = `
    <footer class="openai-footer">
        <div class="footer-inner">
            <div class="footer-grid">
                <div class="footer-column">
                    <div class="footer-label" data-i18n="footer.research">研究</div>
                    <a href="${base}/article.html?id=news9" data-i18n="footer.research_index">研究索引</a>
                    <a href="${base}/article.html?id=tactfr600" data-i18n="footer.research_overview">研究概述</a>
                    <a href="${base}/index.html#latest-news" data-i18n="footer.latest_progress">最新进展</a>
                </div>
                <div class="footer-column">
                    <div class="footer-label" data-i18n="footer.safety">安全</div>
                    <a href="${base}/article.html?id=news3" data-i18n="footer.use_protocol">使用协议</a>
                    <a href="${base}/article.html?id=news5" data-i18n="footer.safety_guidelines">安全准则</a>
                </div>
                <div class="footer-column">
                    <div class="footer-label" data-i18n="footer.company">公司</div>
                    <a href="${base}/about.html" data-i18n="footer.about_us">关于我们</a>
                    <a href="${base}/about.html" data-i18n="footer.join_us">加入团队</a>
                    <a href="${base}/index.html#latest-news" data-i18n="footer.news_center">新闻中心</a>
                    <a href="${base}/about.html" data-i18n="footer.contact_us">联系我们</a>
                </div>
            </div>
            <div class="footer-bottom">
                <div class="bottom-left">
                    <a href="https://x.com/NexusVAI" target="_blank" rel="noopener noreferrer" aria-label="X (Twitter)">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    </a>
                    <a href="https://github.com/NexusVAI" target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                    </a>
                    <a href="https://space.bilibili.com/3691002594331274?spm_id_from=333.40164.0.0" target="_blank" rel="noopener noreferrer" aria-label="Bilibili">
                        <svg class="social-icon social-icon--bilibili" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M3 10a4 4 0 0 1 4 -4h10a4 4 0 0 1 4 4v6a4 4 0 0 1 -4 4h-10a4 4 0 0 1 -4 -4v-6"/>
                            <path d="M8 3l2 3"/>
                            <path d="M16 3l-2 3"/>
                            <path d="M9 13v-2"/>
                            <path d="M15 11v2"/>
                        </svg>
                    </a>
                    <a href="https://huggingface.co/xingy555888" target="_blank" rel="noopener noreferrer" aria-label="Hugging Face">
                        <img class="social-icon social-icon--huggingface" src="https://huggingface.co/front/assets/huggingface_logo.svg" alt="" width="18" height="18" decoding="async">
                    </a>
                    <button class="email-copy-btn" id="email-copy-btn" type="button" aria-label="复制邮箱" title="复制邮箱">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    </button>
                </div>
                <div class="bottom-center">Nexus V © 2025-2026</div>
                <div class="bottom-right">
                    <button class="lang-selector" id="lang-toggle" type="button" aria-label="切换语言">
                        <svg class="lang-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="9"></circle>
                            <path d="M3 12h18"></path>
                            <path d="M12 3a15.3 15.3 0 0 1 0 18"></path>
                            <path d="M12 3a15.3 15.3 0 0 0 0 18"></path>
                        </svg>
                        <span class="lang-label" data-i18n="footer.lang">中文 中国</span>
                    </button>
                    <button class="theme-toggle" id="theme-toggle" aria-label="切换主题">
                        <svg class="moon-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                        <svg class="sun-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
                        <svg class="warm-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;"><circle cx="12" cy="12" r="4"></circle><line x1="12" y1="2" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"></line><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"></line><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"></line></svg>
                        <svg class="blue-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="display:none;">
                            <defs>
                                <linearGradient id="themeBlueGradient" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
                                    <stop offset="0%" stop-color="#8ec5ff"></stop>
                                    <stop offset="100%" stop-color="#2563eb"></stop>
                                </linearGradient>
                            </defs>
                            <circle cx="12" cy="12" r="8.5" fill="url(#themeBlueGradient)"></circle>
                            <circle cx="12" cy="12" r="3" fill="#ffffff" fill-opacity="0.78"></circle>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </footer>`;

    function getCommentsHTML(pageId, pageUrl, pageTitle) {
        return `
    <div class="comments-fab">
        <div id="comments-liquid-glass-root"></div>
    </div>
    <div id="comments-overlay" class="comments-overlay">
        <div class="comments-modal">
            <div class="comments-modal-header">
                <div class="comments-modal-title">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    <span>和DeepSeek聊天</span>
                </div>
                <button id="comments-modal-close" class="comments-modal-close">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div class="comments-modal-body">
                <div id="cusdis_thread"
                    data-host="https://cusdis.com"
                    data-app-id="479a7441-1edc-4e8b-88ae-10ccc708c42a"
                    data-page-id="${pageId}"
                    data-page-url="${pageUrl}"
                    data-page-title="${pageTitle}"
                ></div>
            </div>
        </div>
    </div>`;
    }

    function injectComponents(config) {
        var body = document.body;
        var temp = document.createElement('div');

        // Inject navbar + mega menu + search overlay at the beginning of body
        var headerFrag = document.createDocumentFragment();
        var headerHTML = navbarHTML + megaMenuHTML + searchOverlayHTML;
        temp.innerHTML = headerHTML;
        while (temp.firstChild) {
            headerFrag.appendChild(temp.firstChild);
        }
        body.insertBefore(headerFrag, body.firstChild);

        // Inject footer
        var footerMarker = document.querySelector('[data-page-footer]');
        if (footerMarker) {
            var footerFrag = document.createDocumentFragment();
            temp.innerHTML = footerHTML;
            while (temp.firstChild) footerFrag.appendChild(temp.firstChild);
            footerMarker.replaceWith(footerFrag);
        }

        // Inject comments section
        var commentsMarker = document.querySelector('[data-page-comments]');
        if (commentsMarker) {
            var commentsFrag = document.createDocumentFragment();
            temp.innerHTML = getCommentsHTML(
                config.commentsPageId || 'index',
                config.commentsPageUrl || window.location.href,
                config.commentsPageTitle || 'NexusV'
            );
            while (temp.firstChild) commentsFrag.appendChild(temp.firstChild);
            commentsMarker.replaceWith(commentsFrag);
        }

        // Re-translate dynamically injected elements
        if (window.translate) window.translate();

        window.dispatchEvent(new CustomEvent('nexus:components-injected'));
    }

    window.injectComponents = injectComponents;
})();
