/*
 * Cancri 开放平台 — Chrome 共享脚本
 *
 * 适用页面（按 v1 钩子接入）：
 *   chat/api/index.html         门户首页
 *   chat/api_apply.html         申请 API
 *   chat/api_keys.html          我的 Keys
 *   chat/api_models.html        模型广场
 *   chat/api_docs.html          API 文档
 *   chat/api/admin*.html        管理员页面（可选接入）
 *
 * 提供功能：
 *   1. 主题切换（dark / light），状态存入 localStorage 'cancri_open_platform_theme'
 *      与系统首选项联动；用户显式选择后会覆盖系统切换。
 *   2. <button data-copy-text="ELEMENT_ID"> 一键复制目标元素文本，按钮自带"已复制"反馈。
 *
 * 不依赖任何 npm/CDN，10K 内、零副作用、CSP 'self' 可用。
 */
(function () {
  "use strict";

  // ── theme ─────────────────────────────────────────────────
  var THEME_KEY = "cancri_open_platform_theme";
  var DARK = "dark";
  var LIGHT = "light";
  var BLACK = "black";
  var THEME_CYCLE = [LIGHT, DARK, BLACK];

  function readSavedTheme() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      if (v === DARK || v === LIGHT || v === BLACK) return v;
    } catch (_) {}
    return null;
  }

  function systemPrefersLight() {
    try {
      return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: light)").matches
      );
    } catch (_) {
      return false;
    }
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === LIGHT) {
      root.setAttribute("data-theme", LIGHT);
      root.style.colorScheme = "light";
    } else if (theme === BLACK) {
      root.setAttribute("data-theme", BLACK);
      root.style.colorScheme = "dark";
    } else {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "dark";
    }
  }

  function currentTheme() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === LIGHT || t === BLACK) return t;
    return DARK;
  }

  function initThemeEarly() {
    // 在 DOMContentLoaded 之前已经执行（脚本放在 <head> 里且
    // defer/未指定时按顺序解析），尽快避免主题闪烁。
    var saved = readSavedTheme();
    if (saved) {
      applyTheme(saved);
      return;
    }
    applyTheme(systemPrefersLight() ? LIGHT : DARK);
  }

  // 跟随系统切换（仅在用户未显式选择时）
  function watchSystemTheme() {
    if (
      typeof window.matchMedia !== "function" ||
      readSavedTheme() // 用户已固定选择则不自动跟随
    )
      return;
    try {
      var mql = window.matchMedia("(prefers-color-scheme: light)");
      mql.addEventListener
        ? mql.addEventListener("change", function (e) {
            if (!readSavedTheme()) applyTheme(e.matches ? LIGHT : DARK);
          })
        : mql.addListener &&
          mql.addListener(function (e) {
            if (!readSavedTheme()) applyTheme(e.matches ? LIGHT : DARK);
          });
    } catch (_) {}
  }

  function wireThemeToggles() {
    var btns = document.querySelectorAll("[data-theme-toggle]");
    if (!btns.length) return;
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cur = currentTheme();
        var idx = THEME_CYCLE.indexOf(cur);
        var next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
        applyTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (_) {}
        updateToggleLabel(btn, next);
      });
      // 初始化按钮标签
      updateToggleLabel(btn, currentTheme());
    });
  }

  function updateToggleLabel(btn, theme) {
    // 优先用 data-theme-label-* 属性，否则用默认文案
    var label;
    if (theme === LIGHT) label = btn.getAttribute("data-theme-label-light") || "☀️ 浅色";
    else if (theme === BLACK) label = btn.getAttribute("data-theme-label-black") || "🌙 纯黑";
    else label = btn.getAttribute("data-theme-label-dark") || "🌙 深色";
    // 仅更新有 data-theme-label 属性的按钮（避免破坏纯图标按钮）
    if (btn.hasAttribute("data-theme-label")) btn.textContent = label;
  }

  // ── one-shot copy buttons ──────────────────────────────────
  function wireCopyButtons() {
    var btns = document.querySelectorAll("[data-copy-target]");
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var sel = btn.getAttribute("data-copy-target");
        var el = sel ? document.querySelector(sel) : null;
        var text = el ? (el.textContent || "").trim() : "";
        if (!text) return;
        var orig = btn.textContent;
        try {
          navigator.clipboard.writeText(text).then(
            function () {
              btn.textContent = "已复制";
              btn.classList.add("is-ok");
              setTimeout(function () {
                btn.textContent = orig;
                btn.classList.remove("is-ok");
              }, 1400);
            },
            function () {
              btn.textContent = "复制失败";
              setTimeout(function () {
                btn.textContent = orig;
              }, 1400);
            },
          );
        } catch (_) {
          btn.textContent = "复制失败";
          setTimeout(function () {
            btn.textContent = orig;
          }, 1400);
        }
      });
    });
  }

  // 在 head 里就把主题应用上避免闪烁
  initThemeEarly();

  function isAdminShellPage() {
    var p = location.pathname || "";
    return /\/api\/admin(?:_|\.html)/.test(p);
  }

  function injectAdminThemeToggle() {
    var nav = document.querySelector(".nav, .nav-bar");
    if (!nav || nav.querySelector("[data-theme-toggle]")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.setAttribute("data-theme-toggle", "");
    btn.setAttribute("aria-label", "切换主题");
    btn.innerHTML =
      '<svg class="theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>' +
      '<svg class="theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
      '<svg class="theme-toggle__black" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg>';
    var backLink = nav.querySelector('a[href="../"], a[href="../index.html"]');
    if (backLink) nav.insertBefore(btn, backLink);
    else {
      var spacer = nav.querySelector(".spacer");
      if (spacer) nav.insertBefore(btn, spacer.nextSibling);
      else nav.appendChild(btn);
    }
  }

  function injectAdminMobileDock() {
    if (document.querySelector(".admin-mobile-dock")) return;
    var path = location.pathname.split("/").pop() || "";
    var items = [
      { href: "./admin_dashboard.html", label: "仪表盘", icon: "📊", match: "admin_dashboard.html" },
      { href: "./admin_orders.html", label: "订单", icon: "💳", match: "admin_orders.html" },
      { href: "./admin_users.html", label: "用户", icon: "👤", match: "admin_users.html" },
      { href: "./admin.html", label: "审核", icon: "✓", match: "admin.html" },
      { href: "./admin_usage.html", label: "日志", icon: "📋", match: "admin_usage.html" },
    ];
    var dock = document.createElement("nav");
    dock.className = "admin-mobile-dock";
    dock.setAttribute("aria-label", "管理员快捷导航");
    items.forEach(function (it) {
      var a = document.createElement("a");
      a.href = it.href;
      if (path === it.match) a.classList.add("is-active");
      a.innerHTML =
        '<span class="dock-icon" aria-hidden="true">' +
        it.icon +
        "</span><span>" +
        it.label +
        "</span>";
      dock.appendChild(a);
    });
    document.body.appendChild(dock);
  }

  function initAdminShell() {
    if (!isAdminShellPage()) return;
    document.body.classList.add("admin-shell");
    injectAdminThemeToggle();
    injectAdminMobileDock();
  }

  function ready() {
    initAdminShell();
    wireThemeToggles();
    wireCopyButtons();
    watchSystemTheme();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }

  // 暴露给页面脚本（有些页面想以编程方式切换主题）
  window.CancriPlatform = {
    setTheme: function (t) {
      if (t !== DARK && t !== LIGHT && t !== BLACK) return;
      applyTheme(t);
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch (_) {}
    },
    getTheme: currentTheme,
    THEME_KEY: THEME_KEY,
  };

  // Note: previously auto-loaded ../cancri_liquid_glass.js on every
  // admin page to back [data-glass]. Removed 2026-05-14 — admin pages
  // don't use the helper anymore (see api-platform.css). Re-enable
  // only if individual admin pages add data-glass themselves.
})();
