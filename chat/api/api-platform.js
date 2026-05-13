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

  function readSavedTheme() {
    try {
      var v = localStorage.getItem(THEME_KEY);
      if (v === DARK || v === LIGHT) return v;
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
    } else {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "dark";
    }
  }

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === LIGHT
      ? LIGHT
      : DARK;
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
        var next = currentTheme() === LIGHT ? DARK : LIGHT;
        applyTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (_) {}
      });
    });
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

  function ready() {
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
      if (t !== DARK && t !== LIGHT) return;
      applyTheme(t);
      try {
        localStorage.setItem(THEME_KEY, t);
      } catch (_) {}
    },
    getTheme: currentTheme,
    THEME_KEY: THEME_KEY,
  };
})();
