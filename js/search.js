document.addEventListener('DOMContentLoaded', () => {
    const MAX_RESULTS = 24;
    const FALLBACK_COVER = 'Logo/I2.webp';
    const copy = {
        zh: {
            loading: '正在加载文章索引...',
            empty: '暂无相关结果',
            error: '搜索暂不可用，请稍后重试'
        },
        en: {
            loading: 'Loading search index...',
            empty: 'No matching results',
            error: 'Search is temporarily unavailable'
        }
    };

    const nodes = {
        searchIcon: document.querySelector('.search-icon'),
        searchOverlay: document.getElementById('search-overlay'),
        desktopInput: document.querySelector('.search-overlay-input'),
        desktopSubmit: document.querySelector('.search-overlay-submit')
    };

    if (!nodes.searchIcon || !nodes.searchOverlay) return;

    nodes.desktopResults = ensureResultsContainer(
        nodes.searchOverlay?.querySelector('.search-overlay-content'),
        'search-results search-results-desktop'
    );

    const state = {
        desktopOpen: false,
        searchSeq: 0,
        lastResults: [],
        lastSubmittedQuery: ''
    };

    const SearchService = (() => {
        let indexCache = null;
        let indexPromise = null;
        let articleDataPromise = null;

        function normalizeText(input) {
            return String(input || '')
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();
        }

        function getFirstParagraph(paragraphs) {
            if (!Array.isArray(paragraphs)) return '';
            const paragraph = paragraphs.find((item) => typeof item === 'string' && item.trim());
            return paragraph ? paragraph.trim() : '';
        }

        function getLangPayload(item, lang, fallback) {
            const data = item?.[lang] || fallback || {};
            return {
                title: String(data.title || ''),
                category: String(data.category || ''),
                date: String(data.date || ''),
                excerpt: getFirstParagraph(data.paragraphs),
                paragraphs: Array.isArray(data.paragraphs) ? data.paragraphs : []
            };
        }

        function resolveCover(item) {
            if (item?.media?.type === 'image' && item.media.src) return item.media.src;
            if (item?.media?.type === 'video') return 'Logo/H1.webp';
            return FALLBACK_COVER;
        }

        function buildIndex(articleData) {
            return Object.entries(articleData || {})
                .map(([id, item]) => {
                    const zh = getLangPayload(item, 'zh');
                    const en = getLangPayload(item, 'en', zh);
                    const aggregate = normalizeText([
                        id,
                        item?.overlay || '',
                        zh.title, zh.category, zh.date, ...zh.paragraphs,
                        en.title, en.category, en.date, ...en.paragraphs
                    ].join(' '));

                    return {
                        id,
                        href: `article.html?id=${encodeURIComponent(id)}`,
                        cover: resolveCover(item),
                        alt: String(item?.media?.alt || zh.title || en.title || 'Article cover'),
                        zh,
                        en,
                        aggregate
                    };
                })
                .filter((item) => item.zh.title || item.en.title);
        }

        function scoreCandidate(candidate, query, lang) {
            const normalizedQuery = normalizeText(query);
            if (!normalizedQuery) return 0;

            const localized = (lang === 'en' ? candidate.en : candidate.zh)?.title
                ? (lang === 'en' ? candidate.en : candidate.zh)
                : (candidate.zh.title ? candidate.zh : candidate.en);

            const title = normalizeText(localized.title);
            const category = normalizeText(localized.category);
            const excerpt = normalizeText(localized.excerpt);
            const aggregate = candidate.aggregate;
            const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
            let score = 0;
            let matched = 0;

            for (const token of tokens) {
                let tokenScore = 0;
                if (title.startsWith(token)) tokenScore = Math.max(tokenScore, 120);
                if (title.includes(token)) tokenScore = Math.max(tokenScore, 95);
                if (category.includes(token)) tokenScore = Math.max(tokenScore, 55);
                if (excerpt.includes(token)) tokenScore = Math.max(tokenScore, 35);
                if (aggregate.includes(token)) tokenScore = Math.max(tokenScore, 20);
                if (tokenScore > 0) {
                    score += tokenScore;
                    matched += 1;
                }
            }

            if (tokens.length > 1 && matched === tokens.length) score += 30;
            return score;
        }

        function loadArticleData() {
            if (window.articleData && typeof window.articleData === 'object') {
                return Promise.resolve(window.articleData);
            }
            if (articleDataPromise) return articleDataPromise;

            articleDataPromise = new Promise((resolve, reject) => {
                const existingScript = Array.from(document.scripts).find((script) => {
                    const src = script.getAttribute('src') || '';
                    return src === 'js/article.js' || src.endsWith('/js/article.js');
                });

                const finish = () => {
                    if (window.articleData && typeof window.articleData === 'object') {
                        resolve(window.articleData);
                    } else {
                        reject(new Error('articleData unavailable'));
                    }
                };

                if (existingScript) {
                    if (window.articleData) {
                        finish();
                    } else {
                        existingScript.addEventListener('load', finish, { once: true });
                        existingScript.addEventListener('error', () => reject(new Error('Failed to load article.js')), { once: true });
                    }
                    return;
                }

                const script = document.createElement('script');
                script.src = 'js/article.js';
                script.async = true;
                script.onload = finish;
                script.onerror = () => reject(new Error('Failed to load article.js'));
                document.head.appendChild(script);
            });

            return articleDataPromise;
        }

        async function getIndex() {
            if (indexCache) return indexCache;
            if (indexPromise) return indexPromise;

            indexPromise = (async () => {
                const articleData = await loadArticleData();
                indexCache = buildIndex(articleData);
                return indexCache;
            })();

            return indexPromise;
        }

        async function search(query, lang) {
            const index = await getIndex();
            const trimmed = String(query || '').trim();
            if (!trimmed) return [];

            const scored = [];
            for (const candidate of index) {
                const score = scoreCandidate(candidate, trimmed, lang);
                if (score > 0) scored.push({ score, candidate });
            }

            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, MAX_RESULTS).map((item) => item.candidate);
        }

        return {
            getIndex,
            search
        };
    })();

    nodes.searchIcon.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleDesktopSearch();
    });

    nodes.desktopInput?.addEventListener('input', (event) => {
        syncInputs(event.target.value, 'desktop');
        resetSubmittedState();
        clearResultContainers();
    });

    nodes.desktopSubmit?.addEventListener('click', () => {
        submitSearch(nodes.desktopInput?.value || '');
    });

    nodes.searchOverlay?.addEventListener('click', (event) => {
        if (event.target === nodes.searchOverlay) closeDesktopSearch();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (state.desktopOpen) closeDesktopSearch();
    });

    window.addEventListener('languageChanged', () => {
        if (state.lastSubmittedQuery) runSearch(state.lastSubmittedQuery);
    });

    function getCurrentLang() {
        const lang = localStorage.getItem('lang') || 'zh';
        return lang === 'en' ? 'en' : 'zh';
    }

    function text(key) {
        const lang = getCurrentLang();
        const target = copy[lang] || copy.zh;
        return target[key];
    }

    function ensureResultsContainer(parent, className) {
        if (!parent) return null;
        let container = parent.querySelector(`.${className.split(' ').join('.')}`);
        if (!container) {
            container = document.createElement('div');
            container.className = className;
            parent.appendChild(container);
        }
        return container;
    }

    function syncInputs(value, source) {
        if (source !== 'desktop' && nodes.desktopInput) nodes.desktopInput.value = value;
    }

    function resetSubmittedState() {
        state.lastSubmittedQuery = '';
        state.lastResults = [];
    }

    function updateIconState() {
        nodes.searchIcon.classList.toggle('active', state.desktopOpen);
    }

    function toggleDesktopSearch() {
        if (state.desktopOpen) {
            closeDesktopSearch();
        } else {
            openDesktopSearch();
        }
    }

    function openDesktopSearch() {
        if (!nodes.searchOverlay) return;
        state.desktopOpen = true;
        nodes.searchOverlay.classList.add('active');
        lockBodyScroll();
        updateIconState();
        SearchService.getIndex().catch(() => null);
        resetSubmittedState();
        clearResultContainers();
        setTimeout(() => {
            nodes.desktopInput?.focus();
        }, 60);
    }

    function closeDesktopSearch(options = {}) {
        if (!state.desktopOpen) return;
        state.desktopOpen = false;
        nodes.searchOverlay?.classList.remove('active');
        if (options.restoreBody !== false) unlockBodyScroll();
        updateIconState();
    }

    function lockBodyScroll() {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.paddingRight = `${Math.max(0, scrollbarWidth)}px`;
        document.body.style.overflow = 'hidden';
    }

    function unlockBodyScroll() {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }

    function submitSearch(rawQuery) {
        const query = String(rawQuery || '').trim();
        state.lastSubmittedQuery = query;
        if (!query) {
            clearResultContainers();
            return;
        }
        runSearch(query);
    }

    async function runSearch(rawQuery) {
        const query = String(rawQuery || '').trim();
        const seq = ++state.searchSeq;

        if (!query) {
            state.lastResults = [];
            clearResultContainers();
            return;
        }

        renderLoading();

        try {
            const results = await SearchService.search(query, getCurrentLang());
            if (seq !== state.searchSeq) return;
            state.lastResults = results;
            renderResults(results);
        } catch (error) {
            if (seq !== state.searchSeq) return;
            state.lastResults = [];
            renderError();
            console.error('Search failed:', error);
        }
    }

    function clearResultContainers() {
        if (!nodes.desktopResults) return;
        nodes.desktopResults.textContent = '';
    }

    function appendState(textContent, className) {
        if (!nodes.desktopResults) return;
        const stateNode = document.createElement('div');
        stateNode.className = `search-state ${className}`;
        stateNode.textContent = textContent;
        nodes.desktopResults.appendChild(stateNode);
    }

    function renderLoading() {
        clearResultContainers();
        appendState(text('loading'), 'search-loading');
    }

    function renderError() {
        clearResultContainers();
        appendState(text('error'), 'search-error');
    }

    function renderResults(results) {
        clearResultContainers();

        if (!results.length) {
            appendState(text('empty'), 'search-empty');
            return;
        }

        if (!nodes.desktopResults) return;
        const fragment = document.createDocumentFragment();
        results.forEach((item) => {
            fragment.appendChild(createResultItem(item));
        });
        nodes.desktopResults.appendChild(fragment);
    }

    function createResultItem(result) {
        const lang = getCurrentLang();
        const localized = (lang === 'en' ? result.en : result.zh)?.title
            ? (lang === 'en' ? result.en : result.zh)
            : (result.zh.title ? result.zh : result.en);

        const item = document.createElement('a');
        item.className = 'search-result-item';
        item.href = result.href;

        const body = document.createElement('div');
        body.className = 'search-result-body';

        const meta = document.createElement('p');
        meta.className = 'search-result-meta';
        meta.textContent = [localized.category, localized.date].filter(Boolean).join('   ');

        const title = document.createElement('h4');
        title.className = 'search-result-title';
        title.textContent = localized.title || result.id;

        const excerpt = document.createElement('p');
        excerpt.className = 'search-result-excerpt';
        excerpt.textContent = localized.excerpt || '';

        if (meta.textContent) body.appendChild(meta);
        body.appendChild(title);
        if (localized.excerpt) body.appendChild(excerpt);

        const thumb = document.createElement('div');
        thumb.className = 'search-result-thumb';
        const image = document.createElement('img');
        image.src = result.cover || FALLBACK_COVER;
        image.alt = result.alt || localized.title || 'Article cover';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.onerror = function onImageError() {
            this.onerror = null;
            this.src = FALLBACK_COVER;
        };
        thumb.appendChild(image);

        item.appendChild(body);
        item.appendChild(thumb);
        return item;
    }
});
