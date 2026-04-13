function initMegaMenu() {
    const navItems = document.querySelectorAll('.nav-item');
    const navLinks = document.querySelector('.nav-links');
    const megaMenu = document.getElementById('mega-menu');
    const contentWrapper = document.getElementById('menu-content-wrapper');
    const navbar = document.querySelector('.navbar');
    
    if (!megaMenu || !contentWrapper) return;

    let hideTimeout;
    let currentKey = null;
    let isTransitioning = false;

    // Create overlay if not exists
    let menuOverlay = document.querySelector('.menu-overlay');
    if (!menuOverlay) {
        menuOverlay = document.createElement('div');
        menuOverlay.className = 'menu-overlay';
        document.body.appendChild(menuOverlay);
    }

    const menuData = {
        'research': `
            <div class="menu-column main-links">
                <a href="article.html?id=hero" data-i18n="menu.research.index"></a>
                <a href="article.html?id=hero" data-i18n="menu.research.deep_nexusv5"></a>
                <a href="article.html?id=sentienceLS" data-i18n="menu.research.deep_sentienceLS"></a>
                <a href="article.html?id=sentienceV4C" data-i18n="menu.research.deep_sentienceV4C"></a>
                <a href="article.html?id=n3" data-i18n="menu.research.deep_nexusv4"></a>
                <a href="article.html?id=tactfr570" data-i18n="menu.research.deep_tactfr56"></a>
            </div>
            <div class="menu-column latest-updates">
                <span class="label" data-i18n="menu.research.label"></span>
                <a href="article.html?id=hero" data-i18n="menu.research.nexusv5"></a>
                <a href="article.html?id=sentienceLS" data-i18n="menu.research.sentienceLS"></a>
                <a href="article.html?id=sentienceV4C" data-i18n="menu.research.sentienceV4C"></a>
                <a href="article.html?id=news6" data-i18n="menu.research.sentience31"></a>
                <a href="article.html?id=news7" data-i18n="menu.research.sentience3"></a>
                <a href="article.html?id=tactfr570" data-i18n="menu.research.tactfr56"></a>
                <a href="article.html?id=n4" data-i18n="menu.research.tactfr4"></a>
                <a href="article.html?id=n3" data-i18n="menu.research.nexusv4"></a>
            </div>
        `,
        'safety': `
            <div class="menu-column main-links">
                <a href="article.html?id=news3" data-i18n="menu.safety.protocol"></a>
                <a href="article.html?id=news5" data-i18n="menu.safety.guidelines"></a>
            </div>
        `
    };

    const menuLineWidths = {
        'research': '0px',
        'safety': '0px'
    };

    function setMenuLineWidth(key) {
        const menuLine = megaMenu.querySelector('.menu-line');
        if (!menuLine) return;

        let lineWidth;
        if (menuLineWidths[key]) {
            lineWidth = menuLineWidths[key];
        } else {
            const mainLinks = megaMenu.querySelector('.main-links');
            if (mainLinks) {
                const linkCount = mainLinks.querySelectorAll('a').length;
                lineWidth = Math.min(80 + linkCount * 180, 1100) + 'px';
            } else {
                lineWidth = '0px';
            }
        }
        menuLine.style.width = lineWidth;
    }

    function animateMenuItems() {
        const items = contentWrapper.querySelectorAll('.menu-column .label, .menu-column a');
        items.forEach((item, index) => {
            item.style.transition = 'none';
            item.style.opacity = '0';
            item.style.transform = 'translateY(5px)';
            void item.offsetHeight;
            item.style.transition = `opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s`;
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        });
    }

    function switchMenuContent(key) {
        if (currentKey === key || isTransitioning) return;
        isTransitioning = true;

        const menuInner = megaMenu.querySelector('.mega-menu-inner');
        const startHeight = menuInner.offsetHeight;
        menuInner.style.height = `${startHeight}px`;

        contentWrapper.style.transition = 'opacity 50ms ease-in-out';
        contentWrapper.style.opacity = '0';
        
        setTimeout(() => {
            contentWrapper.innerHTML = menuData[key];
            if (window.translate) window.translate(contentWrapper);
            
            menuInner.style.height = 'auto';
            const endHeight = menuInner.offsetHeight;
            menuInner.style.height = `${startHeight}px`;
            void menuInner.offsetHeight;
            menuInner.style.height = `${endHeight}px`;

            animateMenuItems();
            contentWrapper.style.opacity = '1';
            currentKey = key;
            
            setTimeout(() => {
                if (currentKey === key) {
                    menuInner.style.height = 'auto';
                }
                isTransitioning = false;
            }, 150);
        }, 50);
    }

    const dropdownNavItems = Array.from(navItems).filter(item => {
        const targetMenuId = item.getAttribute('data-menu');
        return !!(targetMenuId && menuData[targetMenuId]);
    });

    const resetActiveState = () => {
        megaMenu.classList.remove('active');
        menuOverlay.classList.remove('active');
        navItems.forEach(nav => {
            nav.classList.remove('active');
            if (nav.hasAttribute('aria-expanded')) {
                nav.setAttribute('aria-expanded', 'false');
            }
        });
        if (navLinks) navLinks.classList.remove('has-active');
        currentKey = null;
    };

    const hideMenu = (immediate = false) => {
        clearTimeout(hideTimeout);
        if (immediate) {
            resetActiveState();
            return;
        }

        hideTimeout = setTimeout(() => {
            resetActiveState();
        }, 150);
    };

    const showMenuForItem = (item) => {
        clearTimeout(hideTimeout);
        const targetMenuId = item.getAttribute('data-menu');
        
        navItems.forEach(nav => {
            nav.classList.remove('active');
            if (nav.hasAttribute('aria-expanded')) {
                nav.setAttribute('aria-expanded', 'false');
            }
        });
        item.classList.add('active');
        if (item.hasAttribute('aria-expanded')) {
            item.setAttribute('aria-expanded', 'true');
        }
        if (navLinks) navLinks.classList.add('has-active');
        
        if (targetMenuId && menuData[targetMenuId]) {
            if (!megaMenu.classList.contains('active')) {
                contentWrapper.innerHTML = menuData[targetMenuId];
                if (window.translate) window.translate(contentWrapper); // Translate immediately
                currentKey = targetMenuId;
                animateMenuItems();
                const menuLine = megaMenu.querySelector('.menu-line');
                if (menuLine) menuLine.style.width = '0';
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        setMenuLineWidth(targetMenuId);
                    });
                });
            } else {
                switchMenuContent(targetMenuId);
            }
            megaMenu.classList.add('active');
            menuOverlay.classList.add('active');
        } else {
            hideMenu(true);
        }
    };

    navItems.forEach(item => {
        item.addEventListener('mouseenter', () => showMenuForItem(item));
    });

    // Keyboard/focus support for dropdown triggers without changing visual style.
    dropdownNavItems.forEach(item => {
        if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-haspopup', 'true');
        item.setAttribute('aria-expanded', 'false');

        item.addEventListener('focusin', () => showMenuForItem(item));
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showMenuForItem(item);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                showMenuForItem(item);
                const firstMenuLink = megaMenu.querySelector('a');
                if (firstMenuLink) firstMenuLink.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideMenu(true);
            }
        });
    });

    if (navbar) {
        navbar.addEventListener('mouseleave', () => hideMenu());
        navbar.addEventListener('focusout', (e) => {
            const next = e.relatedTarget;
            if (!next || (!navbar.contains(next) && !megaMenu.contains(next))) {
                hideMenu();
            }
        });
    }

    megaMenu.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    megaMenu.addEventListener('mouseleave', () => hideMenu());
    megaMenu.addEventListener('focusout', (e) => {
        const next = e.relatedTarget;
        if (!next || (!navbar?.contains(next) && !megaMenu.contains(next))) {
            hideMenu();
        }
    });
    megaMenu.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            const activeTrigger = navbar?.querySelector('.nav-item.active');
            hideMenu(true);
            if (activeTrigger) activeTrigger.focus();
        }
    });
}

function initMobileMenu() {
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    if (mobileMenuBtn) {
        const drawer = document.createElement('div');
        drawer.className = 'mobile-drawer';

        const navItemsData = [
            { 
                text: '研究', 
                i18n: 'nav.research',
                submenu: [
                    { text: '意识架构索引', i18n: 'menu.research.index', href: 'article.html?id=hero' },
                    { text: '深入了解 NexusV V5', i18n: 'menu.research.deep_nexusv5', href: 'article.html?id=hero' },
                    { text: '深入了解 Sentience V4C', i18n: 'menu.research.deep_sentienceV4C', href: 'article.html?id=sentienceV4C' },
                    { text: '深入了解 NexusV V4', i18n: 'menu.research.deep_nexusv4', href: 'article.html?id=n3' },
                    { text: '深入了解 TACTFR 5.6.0', i18n: 'menu.research.deep_tactfr56', href: 'article.html?id=tactfr570' },
                    { text: 'Sentience V4C', i18n: 'menu.research.sentienceV4C', href: 'article.html?id=sentienceV4C' },
                    { text: 'Sentience V3.1', i18n: 'menu.research.sentience31', href: 'article.html?id=news6' },
                    { text: 'Sentience V3', i18n: 'menu.research.sentience3', href: 'article.html?id=news7' },
                    { text: 'TACTFR V5', i18n: 'menu.research.tactfr5', href: 'article.html?id=tactfr540' },
                    { text: 'TACTFR V4', i18n: 'menu.research.tactfr4', href: 'article.html?id=n4' },
                    { text: 'NexusV V4', i18n: 'menu.research.nexusv4', href: 'article.html?id=n3' }
                ]
            },
            { 
                text: '安全', 
                i18n: 'nav.safety',
                submenu: [
                    { text: '使用协议', i18n: 'menu.safety.protocol', href: 'article.html?id=news3' },
                    { text: '安全准则', i18n: 'menu.safety.guidelines', href: 'article.html?id=news5' }
                ]
            },
            { text: '开发者专区', i18n: 'nav.developer' },
            { text: '公司', i18n: 'nav.company', href: 'about.html' },
            { text: '新闻', i18n: 'nav.news', href: 'index.html#latest-news' },
            { text: '联系我们', i18n: 'nav.contact', href: 'about.html' }
        ];

        let drawerHTML = '';
        let itemIndex = 0;
        navItemsData.forEach(item => {
            if (item.href && !item.submenu) {
                drawerHTML += `<a href="${item.href}" class="mobile-nav-item" style="transition-delay: ${itemIndex * 40}ms" data-i18n="${item.i18n}">${item.text}</a>`;
            } else {
                drawerHTML += `<div class="mobile-nav-item" style="transition-delay: ${itemIndex * 40}ms" ${item.submenu ? 'data-expandable' : ''} data-i18n="${item.i18n}">${item.text}</div>`;
            }
            if (item.submenu) {
                drawerHTML += '<div class="mobile-submenu">';
                item.submenu.forEach((link, linkIdx) => {
                    const href = link.href || '#';
                    drawerHTML += `<a href="${href}" style="transition-delay: ${linkIdx * 50}ms" data-i18n="${link.i18n}">${link.text}</a>`;
                });
                drawerHTML += '</div>';
            }
            itemIndex++;
        });

        drawerHTML += `
            <div class="mobile-actions" style="transition-delay: ${itemIndex * 40 + 60}ms">
                <a href="about.html" class="mobile-login" data-i18n="mobile.login">登录</a>
                <a href="https://www.wanjiadongli.com/user/1753255?tab=2" class="mobile-cta" data-i18n="mobile.enter">进入 Nexus ↗</a>
            </div>
        `;

        drawer.innerHTML = drawerHTML;
        document.body.appendChild(drawer);
        if (window.translate) window.translate(drawer);

        drawer.querySelectorAll('[data-expandable]').forEach(el => {
            el.addEventListener('click', () => {
                const sub = el.nextElementSibling;
                if (sub && sub.classList.contains('mobile-submenu')) {
                    const isOpen = sub.classList.contains('open');
                    drawer.querySelectorAll('.mobile-submenu.open').forEach(openSub => {
                        if (openSub !== sub) {
                            openSub.classList.remove('open');
                            openSub.previousElementSibling.classList.remove('expanded');
                        }
                    });
                    sub.classList.toggle('open', !isOpen);
                    el.classList.toggle('expanded', !isOpen);
                }
            });
        });

        let drawerOpen = false;
        mobileMenuBtn.addEventListener('click', () => {
            drawerOpen = !drawerOpen;
            mobileMenuBtn.classList.toggle('active', drawerOpen);
            drawer.classList.toggle('active', drawerOpen);
            document.body.style.overflow = drawerOpen ? 'hidden' : '';

            if (!drawerOpen) {
                drawer.querySelectorAll('.mobile-submenu.open').forEach(sub => {
                    sub.classList.remove('open');
                    sub.previousElementSibling.classList.remove('expanded');
                });
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && drawerOpen) {
                drawerOpen = false;
                mobileMenuBtn.classList.remove('active');
                drawer.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
}

function initActiveNavItem() {
    const navItems = document.querySelectorAll('.nav-item');
    const currentPath = window.location.pathname;
    const currentHref = window.location.href;
    
    navItems.forEach(item => {
        const href = item.getAttribute('href');
        if (href) {
            const isCurrentPage = 
                currentHref.endsWith(href) || 
                currentHref.includes(href) ||
                (href === 'about.html' && (currentHref.includes('about.html')));
            
            if (isCurrentPage) {
                item.classList.add('current-page');
            }
        }
    });
}

window.initMegaMenu = initMegaMenu;
window.initMobileMenu = initMobileMenu;
window.initActiveNavItem = initActiveNavItem;
