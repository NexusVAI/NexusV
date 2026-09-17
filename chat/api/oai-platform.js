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

  // Bind to api/index (`GitHub/js/theme.js`) key so open-platform pages
  // keep the same preference. OAI chrome only has dark|light; map warm/blue → dark.
  var THEME_KEY_INDEX = "theme"; // light | dark | warm | blue
  var THEME_KEY_OAI = "cancri_oai_theme"; // dark | light (legacy / console)
  var root = document.documentElement;

  function mapIndexThemeToOai(raw) {
    if (raw === "light") return "light";
    if (raw === "dark" || raw === "warm" || raw === "blue") return "dark";
    return null;
  }

  function resolveInitialTheme() {
    try {
      var fromIndex = mapIndexThemeToOai(localStorage.getItem(THEME_KEY_INDEX));
      if (fromIndex) return fromIndex;
      var fromOai = localStorage.getItem(THEME_KEY_OAI);
      if (fromOai === "light" || fromOai === "dark") return fromOai;
    } catch (e) {}
    // Match js/theme.js default when nothing saved
    return "light";
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY_OAI, theme);
      // Index cycle includes warm/blue; when OAI toggles, write light|dark so
      // index's setTheme reads a value it understands.
      localStorage.setItem(THEME_KEY_INDEX, theme);
    } catch (e) {}
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

    // Theme toggle: delegate so it still works if shell mounts late.
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest
        ? e.target.closest("#header-theme-button, [data-cancri-theme-toggle]")
        : null;
      if (!btn) return;
      var next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      persistTheme(next);
    });

    initSearchOverlay();
    initMobileDrawer();
    initCopyDelegation();
    initPingDelegation();
  });

  // ── Base URL 测速（模型页胶囊）─────────────────────────────────
  // no-cors 只拿不透明响应，测的是浏览器到端点的往返耗时，不读内容。
  // 第一次请求要付 DNS + TCP + TLS 握手（实测国内 TLS 可达 1–3s），并非冷启动：
  // 先发一次不计时的预热把连接建好，再在复用的 keep-alive 连接上测 3 次取最小值。
  // 防刷：一次点击固定 4 个请求，结束后按钮冷却 5s；真正的限流应在服务端做。
  var PING_SAMPLES = 3;
  var PING_COOLDOWN_MS = 5000;
  function initPingDelegation() {
    function once(url) {
      return fetch(url + (url.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now(), {
        mode: "no-cors",
        cache: "no-store",
      });
    }
    function timed(url) {
      var t0 = performance.now();
      return once(url).then(function () { return performance.now() - t0; });
    }
    document.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("[data-cancri-ping]") : null;
      if (!el || el.getAttribute("data-busy") === "1") return;
      el.setAttribute("data-busy", "1");
      el.textContent = "测速中…";
      var url = el.getAttribute("data-cancri-ping");
      var best = Infinity;
      var chain = once(url);
      for (var i = 0; i < PING_SAMPLES; i++) {
        chain = chain.then(function () {
          return timed(url).then(function (ms) { if (ms < best) best = ms; });
        });
      }
      chain
        .then(function () { el.textContent = Math.round(best) + " ms"; })
        .catch(function () { el.textContent = "连接失败"; })
        .then(function () {
          setTimeout(function () {
            el.removeAttribute("data-busy");
            el.textContent = "测速";
          }, PING_COOLDOWN_MS);
        });
    });
  }

  // ── search overlay ─────────────────────────────────────────────
  // Static nav targets; model results are injected from window.__CANCRI_MODELS__
  // (populated by oai-models.js once the catalog loads).
  // 2026-09-16 审计 A11：站内"页面相对根"有**两个**属性名在表达同一件事 ——
  // oai-shell-nav.js 读 data-oai-root，本文件读 data-cancri-base。
  // chat/api/model_detail.html 只设了前者，于是本文件把 base 当成 ""：
  // 搜索浮层里「概览 / API 密钥 / 用量 / 充值」四项拼成 /chat/api/api/*.html（全 404），
  // 模型搜索结果则落到 /chat/api/api_models.html（chat/ 那份才是现行页）。
  // 收敛成一个取值函数：优先 data-cancri-base，缺失时回落 data-oai-root。
  // 新增页面只设其中一个即可；两个都设时以 data-cancri-base 为准。
  function pageBase() {
    var body = document.body;
    if (!body) return "";
    var base = body.getAttribute("data-cancri-base");
    if (base === null) base = body.getAttribute("data-oai-root");
    return base || "";
  }

  function navTargets() {
    var base = pageBase();
    return [
      { name: "概览", sub: "开放平台首页", href: base + "api/index.html" },
      { name: "模型广场", sub: "全部可用模型", href: base + "api_models.html" },
      { name: "文档", sub: "接入指南与 API 参考", href: base + "api_docs.html" },
      { name: "API 密钥", sub: "控制台 · 生成与管理密钥", href: base + "api/keys.html" },
      { name: "用量", sub: "控制台 · 调用与计费", href: base + "api/usage.html" },
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
    var activeOpener = null;
    var defaultPlaceholder = input ? input.getAttribute("placeholder") : "";

    function open(opener) {
      activeOpener = opener || null;
      var scope = activeOpener && activeOpener.getAttribute("data-search-scope") === "models"
        ? "models"
        : "all";
      overlay.setAttribute("data-search-scope", scope);
      overlay.setAttribute("aria-label", scope === "models" ? "搜索所有模型" : "搜索 NexusV 开放平台");
      clearTimeout(hideTimer);
      overlay.classList.remove("hidden");
      overlay.classList.add("flex");
      overlay.setAttribute("data-open", "true");
      void overlay.offsetHeight;
      overlay.setAttribute("data-anim", "in");
      overlay.setAttribute("aria-hidden", "false");
      document.body.classList.add("cancri-search-open");
      openers.forEach(function (b) { b.setAttribute("aria-expanded", b === activeOpener ? "true" : "false"); });
      if (input) {
        input.value = "";
        input.setAttribute("placeholder", scope === "models" ? "搜索模型名称、品牌或 Model ID" : defaultPlaceholder);
        renderResults("");
        setTimeout(function () { input.focus(); }, 20);
      }
    }
    var hideTimer = null;
    function close(restoreFocus) {
      overlay.removeAttribute("data-anim");
      overlay.setAttribute("data-open", "false");
      overlay.setAttribute("aria-hidden", "true");
      // 等上滑退场动画结束再真正隐藏（与 oai-cancri.css 的 260ms 过渡对齐）
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        overlay.classList.add("hidden");
        overlay.classList.remove("flex");
        overlay.removeAttribute("data-search-scope");
      }, 260);
      document.body.classList.remove("cancri-search-open");
      openers.forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
      if (restoreFocus !== false && activeOpener && typeof activeOpener.focus === "function") activeOpener.focus();
      activeOpener = null;
    }

    openers.forEach(function (b) { b.addEventListener("click", function () { open(b); }); });
    dismissers.forEach(function (d) { d.addEventListener("click", function () { close(true); }); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && overlay.getAttribute("data-open") === "true") close(true);
      // Cmd/Ctrl-K to open
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        overlay.getAttribute("data-open") === "true" ? close(true) : open(null);
      }
    });

    function renderResults(q) {
      if (!results) return;
      q = (q || "").trim().toLowerCase();
      var scope = overlay.getAttribute("data-search-scope") || "all";
      var items = navTargets();
      var modelIndexReady = Array.isArray(window.__CANCRI_MODELS__);
      var models = (modelIndexReady ? window.__CANCRI_MODELS__ : []).map(function (m) {
        return {
          name: m.displayName || m.id,
          sub: (m.brand ? m.brand + " · " : "") + m.id,
          // 2026-08-20 模型分组：同组模型在广场折叠成一张代表卡，只有代表卡带
          // `#model-<id>` 锚点。所以跳转必须用 anchorId（成员 → 代表），
          // 而 sub 里仍显示 m.id（成员自己真实可调用的 id）。
          href: pageBase() + "api_models.html#model-" + encodeURIComponent(m.anchorId || m.id),
        };
      });
      if (scope === "models" && !modelIndexReady) {
        results.innerHTML = '<div class="px-4 py-6 text-sm text-secondary">模型目录正在加载…</div>';
        return;
      }
      var pool = scope === "models" ? models : items.concat(models);
      var filtered = q
        ? pool.filter(function (it) {
            return (it.name + " " + it.sub).toLowerCase().indexOf(q) !== -1;
          })
        : (scope === "models" ? models : items);
      if (scope !== "models") filtered = filtered.slice(0, 40);
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
    if (results) results.addEventListener("click", function (e) {
      if (e.target && e.target.closest && e.target.closest("a")) close(false);
    });
    window.__cancriSearchRefresh = function () {
      if (overlay.getAttribute("data-open") === "true" && input) renderResults(input.value);
    };
  }

  // ── mobile drawer ──────────────────────────────────────────────
  function initMobileDrawer() {
    var btn = document.getElementById("header-drawer-button");
    var drawer = document.getElementById("drawer");
    if (!btn || !drawer) return;
    // 动画移植自主站 css/mobile-menu.css + js/menu.js：汉堡变叉、抽屉淡入下移、条目错峰浮现
    var hideTimer = null;
    function toggle() {
      var open = drawer.getAttribute("data-open") === "true";
      clearTimeout(hideTimer);
      drawer.setAttribute("data-open", open ? "false" : "true");
      drawer.setAttribute("aria-hidden", open ? "true" : "false");
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      btn.classList.toggle("active", !open);
      document.body.style.overflow = open ? "" : "hidden";
      if (open) {
        drawer.classList.remove("active");
        hideTimer = setTimeout(function () {
          drawer.classList.add("hidden");
          drawer.classList.remove("flex");
        }, 250);
      } else {
        drawer.classList.remove("hidden");
        drawer.classList.add("flex");
        void drawer.offsetHeight;
        drawer.classList.add("active");
      }
    }
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 768 && drawer.getAttribute("data-open") === "true") toggle();
    });
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
