/* Cancri 开放平台 — chrome behaviour for the OpenAI-style redesign.
 *
 * Loaded *synchronously in <head>* (CSP forbids inline scripts, so the theme
 * bootstrap can't be inlined; running blocking in <head> applies the theme
 * before first paint and avoids a flash).
 *
 * Responsibilities:
 *   - theme: toggle `class="dark"` + `data-theme` on <html> (OpenAI's mechanism)
 *   - swap dual-theme <img data-dark-src data-light-src>
 *   - header search overlay (filters models + nav links)
 *   - mobile drawer
 *   - delegated copy-to-clipboard for model-id pills
 */
(function () {
  "use strict";

  var THEME_KEY = "cancri_oai_theme"; // 'dark' | 'light'
  var root = document.documentElement;

  function resolveInitialTheme() {
    try {
      var saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) {}
    // default dark, matching the OpenAI dev platform + the old Cancri portal
    return "dark";
  }

  function applyTheme(theme) {
    if (theme === "light") {
      root.classList.remove("dark");
      root.setAttribute("data-theme", "light");
    } else {
      root.classList.add("dark");
      root.setAttribute("data-theme", "dark");
    }
    swapThemedImages(theme);
  }

  function swapThemedImages(theme) {
    var imgs = document.querySelectorAll("img[data-dark-src][data-light-src]");
    for (var i = 0; i < imgs.length; i++) {
      var el = imgs[i];
      var next = theme === "light" ? el.getAttribute("data-light-src") : el.getAttribute("data-dark-src");
      if (next && el.getAttribute("src") !== next) el.setAttribute("src", next);
    }
  }

  function currentTheme() {
    return root.classList.contains("dark") ? "dark" : "light";
  }

  // ── apply immediately (pre-paint) ──────────────────────────────
  applyTheme(resolveInitialTheme());

  // ── wire up the rest after DOM is ready ────────────────────────
  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    swapThemedImages(currentTheme());

    // theme toggle button(s)
    var themeBtns = document.querySelectorAll("#header-theme-button, [data-cancri-theme-toggle]");
    themeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = currentTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      });
    });

    initSearchOverlay();
    initMobileDrawer();
    initCopyDelegation();
  });

  // ── search overlay ─────────────────────────────────────────────
  // Static nav targets; model results are injected from window.__CANCRI_MODELS__
  // (populated by oai-models.js once the catalog loads).
  function navTargets() {
    var base = document.body.getAttribute("data-cancri-base") || "";
    return [
      { name: "概览", sub: "开放平台首页", href: base + "api/index.html" },
      { name: "模型广场", sub: "全部可用模型", href: base + "api_models.html" },
      { name: "文档", sub: "接入指南与 API 参考", href: base + "api_docs.html" },
      { name: "API 密钥", sub: "控制台 · 生成与管理密钥", href: base + "api_keys.html" },
      { name: "用量", sub: "控制台 · 调用与计费", href: base + "api_keys.html" },
      { name: "充值", sub: "API 按量充值（结算）", href: base + "api/billing.html" },
      { name: "账单记录", sub: "订单与工单状态", href: base + "api/billing.html#bills" },
      { name: "联系我们", sub: "提交工单 / 反馈", href: base + "api_apply.html" },
    ];
  }

  function initSearchOverlay() {
    var overlay = document.getElementById("header-search-overlay");
    if (!overlay) return;
    var input = document.getElementById("cancri-search-input");
    var results = document.getElementById("cancri-search-results");
    var openers = document.querySelectorAll("[data-header-search-button]");
    var dismissers = overlay.querySelectorAll("[data-header-search-dismiss]");

    function open() {
      overlay.classList.remove("hidden");
      overlay.classList.add("flex");
      overlay.setAttribute("data-open", "true");
      overlay.setAttribute("aria-hidden", "false");
      openers.forEach(function (b) { b.setAttribute("aria-expanded", "true"); });
      if (input) { input.value = ""; renderResults(""); setTimeout(function () { input.focus(); }, 20); }
    }
    function close() {
      overlay.classList.add("hidden");
      overlay.classList.remove("flex");
      overlay.setAttribute("data-open", "false");
      overlay.setAttribute("aria-hidden", "true");
      openers.forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
    }

    openers.forEach(function (b) { b.addEventListener("click", open); });
    dismissers.forEach(function (d) { d.addEventListener("click", close); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.getAttribute("data-open") === "true") close();
      // Cmd/Ctrl-K to open
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        overlay.getAttribute("data-open") === "true" ? close() : open();
      }
    });

    function renderResults(q) {
      if (!results) return;
      q = (q || "").trim().toLowerCase();
      var items = navTargets();
      var models = (window.__CANCRI_MODELS__ || []).map(function (m) {
        return {
          name: m.displayName || m.id,
          sub: (m.brand ? m.brand + " · " : "") + m.id,
          href: (document.body.getAttribute("data-cancri-base") || "") + "api_models.html#model-" + encodeURIComponent(m.id),
        };
      });
      var pool = items.concat(models);
      var filtered = q
        ? pool.filter(function (it) {
            return (it.name + " " + it.sub).toLowerCase().indexOf(q) !== -1;
          })
        : items;
      filtered = filtered.slice(0, 40);
      if (!filtered.length) {
        results.innerHTML = '<div class="px-4 py-6 text-sm text-secondary">没有匹配的结果</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < filtered.length; i++) {
        var it = filtered[i];
        html +=
          '<a class="cancri-search-result" href="' + escapeAttr(it.href) + '">' +
          '<span>' + escapeHtml(it.name) + "</span>" +
          '<span class="cancri-search-result__sub">' + escapeHtml(it.sub) + "</span>" +
          "</a>";
      }
      results.innerHTML = html;
    }

    if (input) input.addEventListener("input", function () { renderResults(input.value); });
    window.__cancriSearchRefresh = function () {
      if (overlay.getAttribute("data-open") === "true" && input) renderResults(input.value);
    };
  }

  // ── mobile drawer ──────────────────────────────────────────────
  function initMobileDrawer() {
    var btn = document.getElementById("header-drawer-button");
    var drawer = document.getElementById("drawer");
    if (!btn || !drawer) return;
    function toggle() {
      var open = drawer.getAttribute("data-open") === "true";
      drawer.setAttribute("data-open", open ? "false" : "true");
      drawer.classList.toggle("hidden", open);
      drawer.classList.toggle("flex", !open);
      btn.setAttribute("aria-expanded", open ? "false" : "true");
    }
    btn.addEventListener("click", toggle);
    drawer.addEventListener("click", function (e) {
      if (e.target === drawer || e.target.hasAttribute("data-drawer-dismiss")) toggle();
    });
  }

  // ── copy-to-clipboard for model id pills ───────────────────────
  function initCopyDelegation() {
    document.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-copy]") : null;
      if (!el) return;
      e.preventDefault();
      var text = el.getAttribute("data-copy");
      copyText(text).then(function () {
        var label = el.querySelector(".cancri-id__text");
        var prev = label ? label.textContent : null;
        el.classList.add("is-copied");
        if (label) label.textContent = "已复制";
        setTimeout(function () {
          el.classList.remove("is-copied");
          if (label && prev != null) label.textContent = prev;
        }, 1100);
      });
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise(function (resolve) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (e) {}
      resolve();
    });
  }

  // ── tiny html helpers ──────────────────────────────────────────
  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }
})();
