var menuConfig = {
    research: {
        label: 'menu.research.label',
        items: [
            { href: 'article.html?id=tactfr600', i18n: 'menu.research.index' },
            { href: 'article.html?id=hero', i18n: 'menu.research.deep_nexusv5' },
            { href: 'article.html?id=sentienceV4ob', i18n: 'menu.research.deep_sentienceV4C' },
            { href: 'article.html?id=tactfr600', i18n: 'menu.research.deep_tactfr60' }
        ],
        latest: [
            { href: 'article.html?id=tactfr600', i18n: 'menu.research.tactfr60' },
            { href: 'article.html?id=sentienceV4ob', i18n: 'menu.research.sentienceV4C' },
            { href: 'article.html?id=sentienceV4C', i18n: 'menu.research.sentienceV4C_v4' },
            { href: 'article.html?id=n1', i18n: 'menu.research.sentience31' },
            { href: 'article.html?id=news7', i18n: 'menu.research.sentience3' },
            { href: 'article.html?id=n4', i18n: 'menu.research.tactfr4' }
        ]
    },
    safety: {
        label: 'menu.safety.label',
        items: [
            { href: 'article.html?id=news3', i18n: 'menu.safety.protocol' },
            { href: 'article.html?id=news5', i18n: 'menu.safety.guidelines' }
        ]
    }
};

var navMenuConfig = [
    { key: 'research', i18n: 'nav.research', submenu: true },
    { key: 'safety', i18n: 'nav.safety', submenu: true },
    { i18n: 'nav.developer', href: 'API文档网站/index.html' },
    { href: 'about.html', i18n: 'nav.company' },
    { href: 'index.html#latest-news', i18n: 'nav.news' },
    { href: 'about.html', i18n: 'nav.contact' }
];

function generateDesktopMenuHTML(key) {
    var config = menuConfig[key];
    if (!config) return '';

    var html = '<div class="menu-column main-links">';
    if (config.items) {
        config.items.forEach(function(item) {
            html += '<a href="' + item.href + '" data-i18n="' + item.i18n + '"></a>';
        });
    }
    html += '</div>';

    if (config.latest && config.latest.length) {
        html += '<div class="menu-column latest-updates">';
        html += '<span class="label" data-i18n="menu.research.label"></span>';
        config.latest.forEach(function(item) {
            html += '<a href="' + item.href + '" data-i18n="' + item.i18n + '"></a>';
        });
        html += '</div>';
    }

    return html;
}

function generateMobileMenuHTML() {
    var html = '';

    navMenuConfig.forEach(function(navItem, navIndex) {
        if (navItem.submenu && menuConfig[navItem.key]) {
            html += '<div class="mobile-nav-item" style="transition-delay: ' + (navIndex * 40) + 'ms" data-expandable data-i18n="' + navItem.i18n + '"></div>';
            html += '<div class="mobile-submenu">';

            var config = menuConfig[navItem.key];
            var mainItems = config.items || [];
            var mainHrefs = {};

            mainItems.forEach(function(link) {
                mainHrefs[link.href] = true;
            });

            mainItems.forEach(function(link, linkIdx) {
                html += '<a href="' + link.href + '" style="transition-delay: ' + (linkIdx * 50) + 'ms" data-i18n="' + link.i18n + '"></a>';
            });

            var latestItems = (config.latest || []).filter(function(link) {
                return !mainHrefs[link.href];
            });

            if (latestItems.length) {
                html += '<div class="mobile-section-label" data-i18n="' + config.label + '"></div>';

                latestItems.forEach(function(link, linkIdx) {
                    html += '<a href="' + link.href + '" style="transition-delay: ' + ((mainItems.length + linkIdx) * 50) + 'ms" data-i18n="' + link.i18n + '"></a>';
                });
            }

            html += '</div>';
        } else if (navItem.href) {
            html += '<a href="' + navItem.href + '" class="mobile-nav-item" style="transition-delay: ' + (navIndex * 40) + 'ms" data-i18n="' + navItem.i18n + '"></a>';
        } else {
            html += '<div class="mobile-nav-item" style="transition-delay: ' + (navIndex * 40) + 'ms" data-i18n="' + navItem.i18n + '"></div>';
        }
    });

    return html;
}

function initMegaMenu() {
    var navItems = document.querySelectorAll('.nav-item');
    var navLinks = document.querySelector('.nav-links');
    var megaMenu = document.getElementById('mega-menu');
    var contentWrapper = document.getElementById('menu-content-wrapper');
    var navbar = document.querySelector('.navbar');

    if (!megaMenu || !contentWrapper) return;
    if (megaMenu.dataset.initialized === '1') return;
    megaMenu.dataset.initialized = '1';

    var hideTimeout;
    var currentKey = null;
    var isTransitioning = false;

    var menuOverlay = document.querySelector('.menu-overlay');
    if (!menuOverlay) {
        menuOverlay = document.createElement('div');
        menuOverlay.className = 'menu-overlay';
        document.body.appendChild(menuOverlay);
    }

    var menuLineWidths = {
        research: '0px',
        safety: '0px'
    };

    function setMenuLineWidth(key) {
        var menuLine = megaMenu.querySelector('.menu-line');
        if (!menuLine) return;

        var lineWidth;
        if (menuLineWidths[key]) {
            lineWidth = menuLineWidths[key];
        } else {
            var mainLinks = megaMenu.querySelector('.main-links');
            if (mainLinks) {
                var linkCount = mainLinks.querySelectorAll('a').length;
                lineWidth = Math.min(80 + linkCount * 180, 1100) + 'px';
            } else {
                lineWidth = '0px';
            }
        }
        menuLine.style.width = lineWidth;
    }

    function animateMenuItems() {
        var items = contentWrapper.querySelectorAll('.menu-column .label, .menu-column a');
        items.forEach(function(item) {
            item.style.transition = 'none';
            item.style.opacity = '0';
            item.style.transform = 'translateY(5px)';
            void item.offsetHeight;
            item.style.transition = 'opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s';
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        });
    }

    function switchMenuContent(key) {
        if (currentKey === key || isTransitioning) return;
        isTransitioning = true;

        var menuInner = megaMenu.querySelector('.mega-menu-inner');
        var startHeight = menuInner.offsetHeight;
        menuInner.style.height = startHeight + 'px';

        contentWrapper.style.transition = 'opacity 50ms ease-in-out';
        contentWrapper.style.opacity = '0';

        setTimeout(function() {
            contentWrapper.innerHTML = generateDesktopMenuHTML(key);
            if (window.translate) window.translate(contentWrapper);

            menuInner.style.height = 'auto';
            var endHeight = menuInner.offsetHeight;
            menuInner.style.height = startHeight + 'px';
            void menuInner.offsetHeight;
            menuInner.style.height = endHeight + 'px';

            animateMenuItems();
            contentWrapper.style.opacity = '1';
            currentKey = key;

            setTimeout(function() {
                if (currentKey === key) {
                    menuInner.style.height = 'auto';
                }
                isTransitioning = false;
            }, 150);
        }, 50);
    }

    var dropdownNavItems = Array.from(navItems).filter(function(item) {
        var targetMenuId = item.getAttribute('data-menu');
        return !!(targetMenuId && menuConfig[targetMenuId]);
    });

    var resetActiveState = function() {
        megaMenu.classList.remove('active');
        menuOverlay.classList.remove('active');
        navItems.forEach(function(nav) {
            nav.classList.remove('active');
            if (nav.hasAttribute('aria-expanded')) {
                nav.setAttribute('aria-expanded', 'false');
            }
        });
        if (navLinks) navLinks.classList.remove('has-active');
        currentKey = null;
    };

    var hideMenu = function(immediate) {
        clearTimeout(hideTimeout);
        if (immediate) {
            resetActiveState();
            return;
        }

        hideTimeout = setTimeout(function() {
            resetActiveState();
        }, 150);
    };

    var showMenuForItem = function(item) {
        clearTimeout(hideTimeout);
        var targetMenuId = item.getAttribute('data-menu');

        navItems.forEach(function(nav) {
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

        if (targetMenuId && menuConfig[targetMenuId]) {
            if (!megaMenu.classList.contains('active')) {
                contentWrapper.innerHTML = generateDesktopMenuHTML(targetMenuId);
                if (window.translate) window.translate(contentWrapper);
                currentKey = targetMenuId;
                animateMenuItems();
                var menuLine = megaMenu.querySelector('.menu-line');
                if (menuLine) menuLine.style.width = '0';
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
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

    navItems.forEach(function(item) {
        item.addEventListener('mouseenter', function() { showMenuForItem(item); });
    });

    dropdownNavItems.forEach(function(item) {
        if (!item.hasAttribute('tabindex')) item.setAttribute('tabindex', '0');
        item.setAttribute('role', 'button');
        item.setAttribute('aria-haspopup', 'true');
        item.setAttribute('aria-expanded', 'false');

        item.addEventListener('focusin', function() { showMenuForItem(item); });
        item.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                showMenuForItem(item);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                showMenuForItem(item);
                var firstMenuLink = megaMenu.querySelector('a');
                if (firstMenuLink) firstMenuLink.focus();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                hideMenu(true);
            }
        });
    });

    if (navbar) {
        navbar.addEventListener('mouseleave', function() { hideMenu(); });
        navbar.addEventListener('focusout', function(e) {
            var next = e.relatedTarget;
            if (!next || (!navbar.contains(next) && !megaMenu.contains(next))) {
                hideMenu();
            }
        });
    }

    megaMenu.addEventListener('mouseenter', function() { clearTimeout(hideTimeout); });
    megaMenu.addEventListener('mouseleave', function() { hideMenu(); });
    megaMenu.addEventListener('focusout', function(e) {
        var next = e.relatedTarget;
        if (!next || (!(navbar && navbar.contains(next)) && !megaMenu.contains(next))) {
            hideMenu();
        }
    });
    megaMenu.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            var activeTrigger = navbar ? navbar.querySelector('.nav-item.active') : null;
            hideMenu(true);
            if (activeTrigger) activeTrigger.focus();
        }
    });
}

function initMobileMenu() {
    var mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    if (mobileMenuBtn) {
        if (mobileMenuBtn.dataset.initialized === '1') return;
        mobileMenuBtn.dataset.initialized = '1';

        var drawer = document.createElement('div');
        drawer.className = 'mobile-drawer';

        var drawerHTML = generateMobileMenuHTML();

        drawerHTML += '<div class="mobile-actions">';
        drawerHTML += '<a href="about.html" class="mobile-login" data-i18n="mobile.login">登录</a>';
        drawerHTML += '<a href="https://www.wanjiadongli.com/user/1753255?tab=2" class="mobile-cta" data-i18n="mobile.enter">进入 Nexus ↗</a>';
        drawerHTML += '</div>';

        drawer.innerHTML = drawerHTML;
        document.body.appendChild(drawer);
        if (window.translate) window.translate(drawer);

        drawer.querySelectorAll('[data-expandable]').forEach(function(el) {
            el.addEventListener('click', function() {
                var sub = el.nextElementSibling;
                if (sub && sub.classList.contains('mobile-submenu')) {
                    var isOpen = sub.classList.contains('open');
                    drawer.querySelectorAll('.mobile-submenu.open').forEach(function(openSub) {
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

        var drawerOpen = false;
        mobileMenuBtn.addEventListener('click', function() {
            drawerOpen = !drawerOpen;
            mobileMenuBtn.classList.toggle('active', drawerOpen);
            drawer.classList.toggle('active', drawerOpen);
            document.body.style.overflow = drawerOpen ? 'hidden' : '';

            if (!drawerOpen) {
                drawer.querySelectorAll('.mobile-submenu.open').forEach(function(sub) {
                    sub.classList.remove('open');
                    sub.previousElementSibling.classList.remove('expanded');
                });
            }
        });

        window.addEventListener('resize', function() {
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
    var navItems = document.querySelectorAll('.nav-item');
    var currentHref = window.location.href;

    navItems.forEach(function(item) {
        item.classList.remove('current-page');
        var href = item.getAttribute('href');
        if (href) {
            var isCurrentPage =
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
