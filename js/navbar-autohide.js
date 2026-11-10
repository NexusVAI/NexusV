/*
 * 顶栏滚动收起：向下阅读时收起，向上滑动一段距离后恢复。
 * 页面顶部附近、菜单或搜索层打开时始终显示。
 * 收起状态由 .navbar--hidden 控制，样式在 css/navbar.css。
 */
(function () {
    'use strict';

    var TOP_ALWAYS_SHOW = 80;   // 距顶部小于该值时始终显示
    var HIDE_DOWN_DELTA = 4;    // 下滑累计超过该像素才收起
    var SHOW_UP_DELTA = 12;     // 上滑累计超过该像素才恢复，防止触控板抖动闪烁
    var HIDDEN_CLASS = 'navbar--hidden';
    var OPEN_LAYER_SELECTOR = '.mega-menu-container.active, .mobile-drawer.active, .search-overlay.active';

    var navbar = null;
    var hidden = false;
    var lastY = 0;
    var accumulated = 0;   // 当前滚动方向上的累计位移
    var pendingY = 0;
    var ticking = false;

    function getWindowY() {
        return window.pageYOffset || document.documentElement.scrollTop || 0;
    }

    function setHidden(next) {
        if (hidden === next) return;
        hidden = next;
        navbar.classList.toggle(HIDDEN_CLASS, next);
    }

    function isLayerOpen() {
        return document.querySelector(OPEN_LAYER_SELECTOR) !== null;
    }

    function update() {
        ticking = false;
        var y = pendingY;
        var delta = y - lastY;
        lastY = y;

        if (!navbar) return;
        if (y <= TOP_ALWAYS_SHOW || isLayerOpen()) {
            accumulated = 0;
            setHidden(false);
            return;
        }
        if (delta === 0) return;

        // 方向变化时重新累计，避免上下来回的位移相互抵消
        if (delta > 0) {
            accumulated = accumulated > 0 ? accumulated + delta : delta;
            if (!hidden && accumulated > HIDE_DOWN_DELTA) {
                setHidden(true);
                accumulated = 0;
            }
        } else {
            accumulated = accumulated < 0 ? accumulated + delta : delta;
            if (hidden && accumulated < -SHOW_UP_DELTA) {
                setHidden(false);
                accumulated = 0;
            }
        }
    }

    // 捕获阶段挂在 document 上，才能收到 body 作为滚动容器时的 scroll 事件
    function onScroll(e) {
        var t = e.target;
        var isRoot = t === document || t === document.documentElement || t === document.body;
        if (!isRoot) return;

        var y = t === document ? getWindowY() : (t.scrollTop || getWindowY());
        pendingY = y;
        if (!ticking) {
            ticking = true;
            window.requestAnimationFrame(update);
        }
    }

    function init() {
        if (navbar) return;
        navbar = document.querySelector('.navbar');
        if (!navbar) return;

        lastY = getWindowY();
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    }

    // components.js 注入顶栏后会派发该事件；页面自带顶栏时靠 DOMContentLoaded 兜底
    window.addEventListener('nexus:components-injected', init);
    document.addEventListener('DOMContentLoaded', init);
})();
