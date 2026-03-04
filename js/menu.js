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
                <a href="#" data-i18n="menu.research.index"></a>
                <a href="#" data-i18n="menu.research.deep_sentience31"></a>
                <a href="#" data-i18n="menu.research.deep_nexusv4"></a>
                <a href="#" data-i18n="menu.research.deep_tactfr5"></a>
            </div>
            <div class="menu-column latest-updates">
                <span class="label" data-i18n="menu.research.label"></span>
                <a href="#" data-i18n="menu.research.sentience31"></a>
                <a href="#" data-i18n="menu.research.sentience3"></a>
                <a href="#" data-i18n="menu.research.tactfr5"></a>
                <a href="#" data-i18n="menu.research.tactfr4"></a>
                <a href="#" data-i18n="menu.research.nexusv4"></a>
            </div>
        `,
        'safety': `
            <div class="menu-column main-links">
                <a href="#" data-i18n="menu.safety.guidelines"></a>
                <a href="#" data-i18n="menu.safety.ethics"></a>
            </div>
            <div class="menu-column latest-updates">
                <span class="label" data-i18n="menu.safety.label"></span>
                <a href="#" data-i18n="menu.safety.transparency"></a>
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

    navItems.forEach(item => {
        item.addEventListener('mouseenter', () => {
            clearTimeout(hideTimeout);
            const targetMenuId = item.getAttribute('data-menu');
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
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
                megaMenu.classList.remove('active');
                menuOverlay.classList.remove('active');
            }
        });
    });

    const hideMenu = () => {
        hideTimeout = setTimeout(() => {
            megaMenu.classList.remove('active');
            menuOverlay.classList.remove('active');
            navItems.forEach(nav => nav.classList.remove('active'));
            if (navLinks) navLinks.classList.remove('has-active');
            currentKey = null;
        }, 150);
    };

    if (navbar) navbar.addEventListener('mouseleave', hideMenu);
    megaMenu.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    megaMenu.addEventListener('mouseleave', hideMenu);
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
                    { text: '意识架构索引', i18n: 'menu.research.index' },
                    { text: '深入了解 Sentience V3.1', i18n: 'menu.research.deep_sentience31' },
                    { text: '深入了解 NexusV V4', i18n: 'menu.research.deep_nexusv4' },
                    { text: '深入了解 TACTFR V5', i18n: 'menu.research.deep_tactfr5' },
                    { text: 'Sentience V3.1', i18n: 'menu.research.sentience31' },
                    { text: 'Sentience V3', i18n: 'menu.research.sentience3' },
                    { text: 'TACTFR V5', i18n: 'menu.research.tactfr5' },
                    { text: 'TACTFR V4', i18n: 'menu.research.tactfr4' },
                    { text: 'NexusV V4', i18n: 'menu.research.nexusv4' }
                ]
            },
            { 
                text: '安全', 
                i18n: 'nav.safety',
                submenu: [
                    { text: '安全准则', i18n: 'menu.safety.guidelines' },
                    { text: '数字伦理', i18n: 'menu.safety.ethics' },
                    { text: '透明度报告', i18n: 'menu.safety.transparency' }
                ]
            },
            { text: '开发者专区', i18n: 'nav.developer' },
            { text: '公司', i18n: 'nav.company' },
            { text: '新闻', i18n: 'nav.news' },
            { text: '联系我们', i18n: 'nav.contact' }
        ];

        let drawerHTML = '';
        let itemIndex = 0;
        navItemsData.forEach(item => {
            drawerHTML += `<div class="mobile-nav-item" style="transition-delay: ${itemIndex * 40}ms" ${item.submenu ? 'data-expandable' : ''} data-i18n="${item.i18n}">${item.text}</div>`;
            if (item.submenu) {
                drawerHTML += '<div class="mobile-submenu">';
                item.submenu.forEach((link, linkIdx) => {
                    drawerHTML += `<a href="#" style="transition-delay: ${linkIdx * 50}ms" data-i18n="${link.i18n}">${link.text}</a>`;
                });
                drawerHTML += '</div>';
            }
            itemIndex++;
        });

        drawerHTML += `
            <div class="mobile-actions" style="transition-delay: ${itemIndex * 40 + 60}ms">
                <a href="#" class="mobile-login" data-i18n="mobile.login">登录</a>
                <a href="#" class="mobile-cta" data-i18n="mobile.enter">进入 Nexus ↗</a>
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

window.initMegaMenu = initMegaMenu;
window.initMobileMenu = initMobileMenu;
