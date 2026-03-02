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
                <a href="#">自主 NPC 概述</a>
                <a href="#">行为树演化项目</a>
                <a href="#">开放认知研究</a>
            </div>
            <div class="menu-column latest-updates">
                <span class="label">前沿进展</span>
                <a href="#">Nexus-Core 1.0 发布</a>
                <a href="#">洛圣都实时对话模型</a>
                <a href="#">合成意志 2.0</a>
                <a href="#">多智能体协作协议</a>
            </div>
        `,
        'safety': `
            <div class="menu-column main-links">
                <a href="#">数字伦理框架</a>
                <a href="#">AI 安全协议</a>
                <a href="#">意识权利研究</a>
                <a href="#">透明度报告</a>
            </div>
            <div class="menu-column latest-updates">
                <span class="label">最新动态</span>
                <a href="#">安全准则 v2.0</a>
                <a href="#">伦理审查流程</a>
            </div>
        `
    };

    function switchMenuContent(key) {
        if (currentKey === key || isTransitioning) return;
        
        isTransitioning = true;
        contentWrapper.style.transition = 'opacity 80ms ease-in-out';
        contentWrapper.style.opacity = '0';
        
        setTimeout(() => {
            contentWrapper.innerHTML = menuData[key];
            contentWrapper.style.opacity = '1';
            currentKey = key;
            isTransitioning = false;
        }, 80);
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
            { text: '研究', submenu: menuData['research'] ? ['意识架构索引', '自主 NPC 概述', '行为树演化项目', '开放认知研究'] : null },
            { text: '安全', submenu: menuData['safety'] ? ['数字伦理框架', 'AI 安全协议', '意识权利研究', '透明度报告'] : null },
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
});
