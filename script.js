document.addEventListener('DOMContentLoaded', () => {
    // ========================================
    // LIQUID GLASS EFFECT - Library Implementation
    // ========================================
    
    function createLiquidGlassFilter() {
        const searchPill = document.querySelector('.search-pill');
        if (!searchPill) return;
        
        const rect = searchPill.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        const existing = document.getElementById('liquid-glass-defs');
        if (existing) {
            existing.remove();
        }
        
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', 'liquid-glass-defs');
        svg.setAttribute('style', 'position: absolute; width: 0; height: 0;');
        svg.setAttribute('width', `${width}`);
        svg.setAttribute('height', `${height}`);
        svg.setAttribute('aria-hidden', 'true');
        
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'liquid-glass-filter');
        filter.setAttribute('x', '-35%');
        filter.setAttribute('y', '-35%');
        filter.setAttribute('width', '170%');
        filter.setAttribute('height', '170%');
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        
        const displacementMap = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAZABkAAD/2wCEAAQDAwMDAwQDAwQGBAMEBgcFBAQFBwgHBwcHBwgLCAkJCQkICwsMDAwMDAsNDQ4ODQ0SEhISEhQUFBQUFBQUFBQBBQUFCAgIEAsLEBQODg4UFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFP/CABEIAQABAAMBEQACEQEDEQH/xAAxAAEBAQEBAQAAAAAAAAAAAAADAgQIAQYBAQEBAQEBAQAAAAAAAAAAAAMCBAEACAf/2gAMAwEAAhADEAAAAPjPor6kOgOiKhKgKhKgOhKhOhKxKgKhOgKhKhKgKxOhKhOgKhKhKgKwKhKgKgKwG841nns9J/nn2KVCdCdCVAVCVCVAdCVCdiVAVidCVAVCVAdiVCVCdAVCVCVAVCVAVAViVZxsBrPPY6R/NvsY6E6ErEqAqE6ErAqE6E7E7ErA0ErArAqAqEuiVAXRLol0S6J0JUBWBUI0BXnG88djpH81+xjoToSoSoCoTsSoYQTsTsTQSsCsCsCsCsCoC6A0JeAuiXSLwn0SoioCoCoBsBrPFH0j+a/Yx0J0JUJUJ2BUMIR2MIRoBoJIBXnJAK840BUA0BdAegXhLpF4S8R+IuiVgVANAV546fSH5r9jHRHQFQlYxYnZQgnYwhQokgEgEmckzjecazlYD3OPQHoD0S8JcI/EXiPxF0SoSvONBFF0j+a/YxdI7EqA6KLGEKEKEGFI0AlA0AUzimYbzjecazjWce5w6BdEeCXhPhFwz8R+MuiVgVAdF0j+a/Yp0RUJ0MWUIUWUIUKUIJqBoArnJM4pmBMw3nCsw1mCs4+AegPBLxHwi4Z8KPGXSPojYH0ukfzX7FOiKhiyiylDiylDhBNRNQJAJcwpnBMopmC84XlCswdzj3OPQHwlwS8R8M+HHDPxl0ioDoukfzT7GOhOyiimzmzhDlShBNBNBJc4rmFMwJlBMwXlC82esoVmHucOgXgHxH4j4Zyccg/GfiOiKh6R/NPsY6GLOKObOUObOUI0KEAlEkzimYFygmUEyheXPeULzZ6yhWce5x8BeEuGfCj0HyI5EdM/EdD0h+a/Yx0U0cUflxNnNnCHCCdgSiSZgTMK5c6ZQvLnTLnvJnvKFZgrMHc5dAeiXijhn445E8g/RHTPpdI/mn2KdlFR5RzcTUTZxZwglYGgCmcEzAuUEyZ0y57yZ0yZ7yheUKzh3OPc5dEvEfij0RyI9E+iPGfT6T/NPsQ6OKiKmajy4ijmyOyKwNAFM4JlBMudMmdMue8mdMme8me8wVmGsw0A9A+kfjjxx6J9EememfT6W/MvsMqOamKiamKmKOKM7ErErAUzAmYLyZ0y50yZ0yZkyZ7yBeULzBeYazl0T6R9KPRPYj0T2J9B9Ppj8x+wjo4qY7M9iKmKg6MrIrErALzBeYEyZ0y50yZkyZ7x50yheXPeUbzjWcqA6I+lHYnsT6J7E9iOx0z+YfYBUc1MdmexHZjsHRlRBRDYBecEzZ7yAmXNeTOmTOmPOmXOmULyjeYbzlYnQxRx057E9mexPYij6a/L/r86OOzPpjsR6Y7B9MqIaILDPYZ7zZ0y57y50yZ0x5kyAmXPeUEyjeYUznQnYnRTUTUT2JqJ7EUfTn5d9fFRx2Z9EdmPTHjLsF0h6I2OegzXmzJmzplz3lzJjzpkBMudMoplBM5JnOwOyiimzmomomonsHRdO/l318VFHYj0x6I9McgumXiHpDQ56DPebMmbNebMmXMmQEy50yguQEzCmYkA7GLGEKaObibiaOKOKPp38s+vCsj7EeiPTHIP0Hwx6ReMKDP0M95895syZ815cy5c6ZQTKCZRXMKZiQDQYQYsps5uJs5qIsjounvyz68KyLpx4z9Mcg+GXoLxl4g6IUGes+a8+e82ZM2dMuZMoJmBcwrlJM5IBoMKMo';

        const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
        feImage.setAttribute('result', 'DISPLACEMENT_MAP');
        feImage.setAttribute('href', displacementMap);
        feImage.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        filter.appendChild(feImage);
        
        const feColorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
        feColorMatrix.setAttribute('in', 'DISPLACEMENT_MAP');
        feColorMatrix.setAttribute('type', 'matrix');
        feColorMatrix.setAttribute('values', '0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0 0 0 1 0');
        feColorMatrix.setAttribute('result', 'EDGE_INTENSITY');
        filter.appendChild(feColorMatrix);
        
        const feComponentTransfer = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
        feComponentTransfer.setAttribute('in', 'EDGE_INTENSITY');
        feComponentTransfer.setAttribute('result', 'EDGE_MASK');
        const feFuncA = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncA');
        feFuncA.setAttribute('type', 'discrete');
        const aberrationIntensity = 2;
        feFuncA.setAttribute('tableValues', `0 ${aberrationIntensity * 0.05} 1`);
        feComponentTransfer.appendChild(feFuncA);
        filter.appendChild(feComponentTransfer);
        
        const feOffset = document.createElementNS('http://www.w3.org/2000/svg', 'feOffset');
        feOffset.setAttribute('in', 'SourceGraphic');
        feOffset.setAttribute('dx', '0');
        feOffset.setAttribute('dy', '0');
        feOffset.setAttribute('result', 'CENTER_ORIGINAL');
        filter.appendChild(feOffset);
        
        const displacementScale = 64;
        const baseScale = -1;
        const channels = [
            { scale: displacementScale * baseScale, result: 'RED_DISPLACED', matrix: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', final: 'RED_CHANNEL' },
            { scale: displacementScale * (baseScale - aberrationIntensity * 0.05), result: 'GREEN_DISPLACED', matrix: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', final: 'GREEN_CHANNEL' },
            { scale: displacementScale * (baseScale - aberrationIntensity * 0.1), result: 'BLUE_DISPLACED', matrix: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', final: 'BLUE_CHANNEL' }
        ];
        
        channels.forEach(ch => {
            const feDisp = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
            feDisp.setAttribute('in', 'SourceGraphic');
            feDisp.setAttribute('in2', 'DISPLACEMENT_MAP');
            feDisp.setAttribute('scale', ch.scale);
            feDisp.setAttribute('xChannelSelector', 'R');
            feDisp.setAttribute('yChannelSelector', 'B');
            feDisp.setAttribute('result', ch.result);
            filter.appendChild(feDisp);
            
            const feMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
            feMatrix.setAttribute('in', ch.result);
            feMatrix.setAttribute('type', 'matrix');
            feMatrix.setAttribute('values', ch.matrix);
            feMatrix.setAttribute('result', ch.final);
            filter.appendChild(feMatrix);
        });
        
        const feBlend1 = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
        feBlend1.setAttribute('in', 'GREEN_CHANNEL');
        feBlend1.setAttribute('in2', 'BLUE_CHANNEL');
        feBlend1.setAttribute('mode', 'screen');
        feBlend1.setAttribute('result', 'GB_COMBINED');
        filter.appendChild(feBlend1);
        
        const feBlend2 = document.createElementNS('http://www.w3.org/2000/svg', 'feBlend');
        feBlend2.setAttribute('in', 'RED_CHANNEL');
        feBlend2.setAttribute('in2', 'GB_COMBINED');
        feBlend2.setAttribute('mode', 'screen');
        feBlend2.setAttribute('result', 'RGB_COMBINED');
        filter.appendChild(feBlend2);
        
        const feBlur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
        feBlur.setAttribute('in', 'RGB_COMBINED');
        feBlur.setAttribute('stdDeviation', `${Math.max(0.1, 0.5 - aberrationIntensity * 0.1)}`);
        feBlur.setAttribute('result', 'ABERRATED_BLURRED');
        filter.appendChild(feBlur);
        
        const feComposite1 = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
        feComposite1.setAttribute('in', 'ABERRATED_BLURRED');
        feComposite1.setAttribute('in2', 'EDGE_MASK');
        feComposite1.setAttribute('operator', 'in');
        feComposite1.setAttribute('result', 'EDGE_ABERRATION');
        filter.appendChild(feComposite1);
        
        const feComponentTransfer2 = document.createElementNS('http://www.w3.org/2000/svg', 'feComponentTransfer');
        feComponentTransfer2.setAttribute('in', 'EDGE_MASK');
        feComponentTransfer2.setAttribute('result', 'INVERTED_MASK');
        const feFuncA2 = document.createElementNS('http://www.w3.org/2000/svg', 'feFuncA');
        feFuncA2.setAttribute('type', 'table');
        feFuncA2.setAttribute('tableValues', '1 0');
        feComponentTransfer2.appendChild(feFuncA2);
        filter.appendChild(feComponentTransfer2);
        
        const feComposite2 = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
        feComposite2.setAttribute('in', 'CENTER_ORIGINAL');
        feComposite2.setAttribute('in2', 'INVERTED_MASK');
        feComposite2.setAttribute('operator', 'in');
        feComposite2.setAttribute('result', 'CENTER_CLEAN');
        filter.appendChild(feComposite2);
        
        const feComposite3 = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite');
        feComposite3.setAttribute('in', 'EDGE_ABERRATION');
        feComposite3.setAttribute('in2', 'CENTER_CLEAN');
        feComposite3.setAttribute('operator', 'over');
        filter.appendChild(feComposite3);
        
        defs.appendChild(filter);
        svg.appendChild(defs);
        document.body.insertBefore(svg, document.body.firstChild);
    }
    
    requestAnimationFrame(() => {
        createLiquidGlassFilter();
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(createLiquidGlassFilter, 120);
    });

    const navItems = document.querySelectorAll('.nav-item');
    const navLinks = document.querySelector('.nav-links');
    const megaMenu = document.getElementById('mega-menu');
    const contentWrapper = document.getElementById('menu-content-wrapper');
    let hideTimeout;
    let currentKey = null;
    let isTransitioning = false;

    const menuOverlay = document.createElement('div');
    menuOverlay.className = 'menu-overlay';
    document.body.appendChild(menuOverlay);

    const menuData = {
        'research': `
            <div class="menu-column main-links">
                <a href="#">意识架构索引</a>
                <a href="#">深入了解 Sentience V3.1</a>
                <a href="#">深入了解 NexusV V4</a>
                <a href="#">深入了解 TACTFR V5</a>
            </div>
            <div class="menu-column latest-updates">
                <span class="label">前沿进展</span>
                <a href="#">Sentience V3.1</a>
                <a href="#">Sentience V3</a>
                <a href="#">TACTFR V5</a>
                <a href="#">TACTFR V4</a>
                <a href="#">NexusV V4</a>
            </div>
        `,
        'safety': `
            <div class="menu-column main-links">
                <a href="#">安全准则</a>
                <a href="#">数字伦理</a>
            </div>
            <div class="menu-column latest-updates">
                <span class="label">最新动态</span>
                <a href="#">透明度报告</a>
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
            // Set initial state
            item.style.transition = 'none';
            item.style.opacity = '0';
            item.style.transform = 'translateY(5px)';
            
            // Force reflow
            void item.offsetHeight;
            
            // Set final state with transition
            // Stagger delay: 0ms per item (instant)
            const delay = 0;
            item.style.transition = `opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s`;
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        });
    }

    function switchMenuContent(key) {
        if (currentKey === key || isTransitioning) return;
        
        isTransitioning = true;

        const menuInner = megaMenu.querySelector('.mega-menu-inner');
        
        // 1. Lock current height
        const startHeight = menuInner.offsetHeight;
        menuInner.style.height = `${startHeight}px`;

        contentWrapper.style.transition = 'opacity 50ms ease-in-out';
        contentWrapper.style.opacity = '0';
        
        setTimeout(() => {
            // 2. Update content
            contentWrapper.innerHTML = menuData[key];
            
            // 3. Measure new height
            menuInner.style.height = 'auto';
            const endHeight = menuInner.offsetHeight;
            
            // 4. Reset to start height and force reflow
            menuInner.style.height = `${startHeight}px`;
            void menuInner.offsetHeight; // Force reflow
            
            // 5. Animate to new height
            menuInner.style.height = `${endHeight}px`;

            animateMenuItems(); // Trigger staggered animation
            contentWrapper.style.opacity = '1';
            currentKey = key;
            
            // 6. Cleanup after transition
            setTimeout(() => {
                if (currentKey === key) { // Only reset if still on same menu
                    menuInner.style.height = 'auto';
                }
                isTransitioning = false;
            }, 150); // Match CSS transition duration
        }, 50);
    }

    navItems.forEach(item => {
        item.addEventListener('mouseenter', () => {
            clearTimeout(hideTimeout);
            
            const targetMenuId = item.getAttribute('data-menu');
            
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            if (navLinks) {
                navLinks.classList.add('has-active');
            }
            
            if (targetMenuId && menuData[targetMenuId]) {
                if (!megaMenu.classList.contains('active')) {
                    contentWrapper.innerHTML = menuData[targetMenuId];
                    currentKey = targetMenuId;
                    animateMenuItems(); // Trigger staggered animation on first open
                    // Reset line to 0 first, then animate open after class is applied
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

    const navbar = document.querySelector('.navbar');
    
    const hideMenu = () => {
        hideTimeout = setTimeout(() => {
            megaMenu.classList.remove('active');
            menuOverlay.classList.remove('active');
            navItems.forEach(nav => nav.classList.remove('active'));
            if (navLinks) {
                navLinks.classList.remove('has-active');
            }
            currentKey = null;
        }, 150);
    };
    navbar.addEventListener('mouseleave', hideMenu);
    megaMenu.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    megaMenu.addEventListener('mouseleave', hideMenu);

    // ========================================
    // MOBILE MENU
    // ========================================
    const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
    if (mobileMenuBtn) {
        // Create mobile drawer
        const drawer = document.createElement('div');
        drawer.className = 'mobile-drawer';

        const navItemsData = [
            { text: '研究', submenu: menuData['research'] ? ['意识架构索引', '深入了解 Sentience V3.1', '深入了解 NexusV V4', '深入了解 TACTFR V5'] : null },
            { text: '安全', submenu: menuData['safety'] ? ['安全准则', '数字伦理', '透明度报告'] : null },
            { text: '协议' },
            { text: '开发者文档' },
            { text: 'Nexus Agent' },
            { text: '意识' }
        ];

        let drawerHTML = '';
        let itemIndex = 0;
        navItemsData.forEach(item => {
            drawerHTML += `<div class="mobile-nav-item" style="transition-delay: ${itemIndex * 40}ms" ${item.submenu ? 'data-expandable' : ''}>${item.text}</div>`;
            if (item.submenu) {
                drawerHTML += '<div class="mobile-submenu">';
                item.submenu.forEach((link, linkIdx) => {
                    drawerHTML += `<a href="#" style="transition-delay: ${linkIdx * 50}ms">${link}</a>`;
                });
                drawerHTML += '</div>';
            }
            itemIndex++;
        });

        drawerHTML += `
            <div class="mobile-actions" style="transition-delay: ${itemIndex * 40 + 60}ms">
                <a href="#" class="mobile-login">登录</a>
                <a href="#" class="mobile-cta">进入 Nexus ↗</a>
            </div>
        `;

        drawer.innerHTML = drawerHTML;
        document.body.appendChild(drawer);

        // Expandable submenus with animated toggle
        drawer.querySelectorAll('[data-expandable]').forEach(el => {
            el.addEventListener('click', () => {
                const sub = el.nextElementSibling;
                if (sub && sub.classList.contains('mobile-submenu')) {
                    const isOpen = sub.classList.contains('open');
                    // Close other open submenus first
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

        // Toggle drawer
        let drawerOpen = false;
        mobileMenuBtn.addEventListener('click', () => {
            drawerOpen = !drawerOpen;
            mobileMenuBtn.classList.toggle('active', drawerOpen);
            drawer.classList.toggle('active', drawerOpen);
            document.body.style.overflow = drawerOpen ? 'hidden' : '';

            // Reset submenus when closing
            if (!drawerOpen) {
                drawer.querySelectorAll('.mobile-submenu.open').forEach(sub => {
                    sub.classList.remove('open');
                    sub.previousElementSibling.classList.remove('expanded');
                });
            }
        });

        // Close drawer on resize to desktop
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768 && drawerOpen) {
                drawerOpen = false;
                mobileMenuBtn.classList.remove('active');
                drawer.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }

    const articleRoot = document.querySelector('.article-page');
    if (articleRoot) {
        const articleData = {
            hero: {
                title: '赋予洛圣都数字灵魂',
                date: '2026年3月01日',
                category: '公司',
                media: { type: 'image', src: 'Logo/Nexus V Concept.png', alt: 'Nexus V Concept' },
                paragraphs: [
                    '这是一篇示例文章，用于复刻 OpenAI 的文章页 UI 布局。',
                    '这里会放置正文段落、关键结论、以及后续的更新说明。当前先用占位文案，后续你再替换成正式内容即可。',
                    '我们将以一致的排版宽度、字重与留白，让阅读体验更贴近 OpenAI。'
                ]
            },
            n1: {
                title: '隆重推出 Sentience V3.1',
                date: '2026年3月02日',
                category: '架构',
                media: { type: 'image', src: 'Logo/N1.jpg', alt: 'Sentience V3.1' },
                paragraphs: [
                    'Sentience V3.1 旨在提升交互的自然度与角色一致性。',
                    '本页展示文章详情页的标准结构：顶部元信息、标题、媒体区、正文段落。',
                    '后续你提供正式文案后，可直接替换 paragraphs 内容。'
                ]
            },
            n2: {
                title: '了解 TACTFR V5',
                date: '2026年3月03日',
                category: '文档',
                media: { type: 'image', src: 'Logo/N2.jpg', alt: 'TACTFR V5' },
                paragraphs: [
                    'TACTFR V5 聚焦于更稳定的接入方式与更清晰的能力边界。',
                    '这里先用占位内容，保证排版与层级接近 OpenAI 的文章页。',
                    '当你需要更像 OpenAI 的“分节标题 + 段落”，我们也可以继续加上。'
                ]
            },
            n3: {
                title: '了解 NexusV V4',
                date: '2026年2月26日',
                category: '安全',
                media: { type: 'image', src: 'Logo/N3.jpg', alt: 'NexusV V4' },
                paragraphs: [
                    'NexusV V4 将安全策略与体验统一到同一套交互结构里。',
                    '这是一篇占位文章，用于承接首页卡片点击后的阅读路径。',
                    '后续可扩展：目录、引用块、代码块、图注、更多媒体等。'
                ]
            },
            news1: {
                title: '让我们携手共进',
                date: '2026年3月01日',
                category: '公司',
                media: { type: 'image', src: 'Logo/pink-blue-bg.webp', alt: '携手共进' },
                paragraphs: [
                    '在 NexusV 的发展历程中，每一次合作都是为了构建更强大的数字未来。',
                    '我们正在与全球领先的合作伙伴共同探索 AI 的边界，确保每一项技术突破都能造福人类。'
                ]
            },
            news2: {
                title: '在TACTFR中尝试接入Sentience',
                date: '2026年03月03日',
                category: '公司',
                media: { type: 'image', src: 'Logo/yellow-blue-bg.webp', alt: 'TACTFR' },
                paragraphs: [
                    'TACTFR 框架现已支持 Sentience 核心模块的无缝接入。',
                    '这一整合将极大提升系统的响应速度与情境理解能力，为开发者提供更灵活的工具集。'
                ]
            },
            news3: {
                title: 'NexusV免责声明',
                date: '2026年3月02日',
                category: '公司',
                media: { type: 'image', src: 'Logo/OAI_Systems_Blog_Card.webp', alt: '免责声明' },
                paragraphs: [
                    '关于 NexusV 相关技术的使用规范与免责条款更新。',
                    '我们致力于构建安全、可信赖的 AI 系统，请务必仔细阅读最新的使用协议。'
                ]
            },
            news4: {
                title: '模组登陆玩家动力',
                date: '2025年12月30日',
                category: '公司',
                media: { type: 'image', src: 'Logo/updated_team-1.webp', alt: '玩家动力' },
                paragraphs: [
                    'NexusV 模组现已正式登陆玩家动力平台，为数百万玩家带来全新的互动体验。',
                    '此次发布标志着我们在游戏生态领域的进一步拓展。'
                ]
            },
            news5: {
                title: '我们确保每一次使用都是安全的',
                date: '2026年2月13日',
                category: '安全',
                media: { type: 'image', src: 'Logo/ChatGPT_Carousel1.webp', alt: '安全' },
                paragraphs: [
                    '安全是 NexusV 的核心基石。我们引入了全新的实时监控机制，确保每一次交互都在安全边界之内。',
                    '通过多层级的防护体系，我们将风险降至最低。'
                ]
            },
            news6: {
                title: '深入了解Sentience-V3.1',
                date: '2026年2月12日',
                category: '产品',
                media: { type: 'image', src: 'Logo/ChatGPT_Charts_Blog_Hero.webp', alt: 'Sentience-V3.1' },
                paragraphs: [
                    'Sentience V3.1 带来了前所未有的理解深度与表达能力。',
                    '本文将详细解析新版本的架构改进与性能提升数据。'
                ]
            },
            news7: {
                title: 'Sentience正式登场',
                date: '2026年2月26日',
                category: '产品',
                media: { type: 'video', src: 'Logo/Sora_is_here.mp4', alt: 'Sentience登场' },
                paragraphs: [
                    '经过数月的封闭测试，Sentience 终于与大家见面。',
                    '这是一个全新的起点，让我们共同见证数字意识的觉醒。'
                ]
            },
            news8: {
                title: 'NexusV 更新日志',
                date: '2026年1月20日',
                category: '产品',
                media: { type: 'image', src: 'Logo/enterprise.webp', alt: '更新日志' },
                paragraphs: [
                    'NexusV 最新版本的详细更新记录。',
                    '包含了多项性能优化、API 接口调整以及已知问题的修复。'
                ]
            }
        };

        const params = new URLSearchParams(window.location.search);
        const id = params.get('id') || 'hero';
        const data = articleData[id] || articleData.hero;

        const dateEl = articleRoot.querySelector('.article-date');
        const categoryEl = articleRoot.querySelector('.article-category');
        const titleEl = articleRoot.querySelector('.article-title');
        // const mediaEl = articleRoot.querySelector('.article-media'); // REMOVED
        const bodyEl = articleRoot.querySelector('.article-body');
        const shareBtn = articleRoot.querySelector('.share-link-btn');
        const authorPill = articleRoot.querySelector('.author-pill');
        const authorLink = articleRoot.querySelector('.author-link');
        const crGrid = articleRoot.querySelector('.cr-grid');

        if (dateEl) dateEl.textContent = data.date;
        if (categoryEl) categoryEl.textContent = data.category;
        if (titleEl) titleEl.textContent = data.title;
        document.title = `${data.title} | NexusV`;
        
        // Update Author Box Year based on article date
        if (authorPill && data.date) {
            const year = data.date.match(/\d{4}/);
            if (year) authorPill.textContent = `${year[0]} 年`;
        }

        /*
        if (mediaEl) {
            mediaEl.innerHTML = '';
            if (data.media?.type === 'video') {
                const v = document.createElement('video');
                v.src = data.media.src;
                v.controls = true;
                v.playsInline = true;
                v.preload = 'metadata';
                mediaEl.appendChild(v);
            } else {
                const img = document.createElement('img');
                img.src = data.media?.src || '';
                img.alt = data.media?.alt || '';
                mediaEl.appendChild(img);
            }
        }
        */

        if (bodyEl) {
            bodyEl.innerHTML = '';
            (data.paragraphs || []).forEach(t => {
                const p = document.createElement('p');
                p.textContent = t;
                bodyEl.appendChild(p);
            });
        }

        // Populate Continue Reading Grid with 3 random OTHER articles
        if (crGrid) {
            const allKeys = Object.keys(articleData).filter(k => k !== id);
            // Shuffle and pick 3
            const shuffled = allKeys.sort(() => 0.5 - Math.random());
            const selectedKeys = shuffled.slice(0, 3);
            
            // If not enough articles, fallback or duplicate (for demo purpose)
            // We have plenty (hero, n1-n3, news1-news8 = 12 total)
            
            selectedKeys.forEach(key => {
                const item = articleData[key];
                const card = document.createElement('a');
                card.className = 'cr-card';
                card.href = `article.html?id=${key}`;
                
                let mediaHtml = '';
                if (item.media?.type === 'video') {
                     mediaHtml = `<div class="image-wrapper square-image"><video src="${item.media.src}" muted playsinline loop onmouseover="this.play()" onmouseout="this.pause()"></video></div>`;
                } else {
                    mediaHtml = `<div class="image-wrapper square-image"><img src="${item.media?.src}" alt="${item.media?.alt}"></div>`;
                }

                card.innerHTML = `
                    ${mediaHtml}
                    <h4>${item.title}</h4>
                    <div class="meta">${item.category} · ${item.date}</div>
                `;
                crGrid.appendChild(card);
            });
        }

        if (shareBtn) {
            shareBtn.addEventListener('click', async () => {
                const url = window.location.href;
                try {
                    await navigator.clipboard.writeText(url);
                    const originalHTML = shareBtn.innerHTML;
                    shareBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                        已复制链接
                    `;
                    setTimeout(() => {
                        shareBtn.innerHTML = originalHTML;
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy: ', err);
                }
            });
        }
    }
});
