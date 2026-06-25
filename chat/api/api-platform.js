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
 *   1. 主题选择（light / dark / black），悬停菜单点选；状态存入
 *      localStorage 'cancri_open_platform_theme'，与系统首选项联动。
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
    // 2026-06-20：开放平台默认 Claude 深色优雅；仅尊重用户已保存的选择。
    var saved = readSavedTheme();
    if (saved) {
      applyTheme(saved);
      return;
    }
    applyTheme(DARK);
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

  var THEME_OPTIONS = [
    { key: LIGHT, label: "浅色" },
    { key: DARK, label: "深色" },
    { key: BLACK, label: "纯黑" },
  ];

  function selectTheme(theme, btn) {
    if (theme !== DARK && theme !== LIGHT && theme !== BLACK) return;
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
    updateThemePickerState(btn, theme);
    updateToggleLabel(btn, theme);
  }

  function updateThemePickerState(btn, theme) {
    var picker = btn && btn.closest ? btn.closest(".theme-picker") : null;
    if (!picker) return;
    picker.querySelectorAll("[data-theme-option]").forEach(function (el) {
      var active = el.getAttribute("data-theme-option") === theme;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-checked", active ? "true" : "false");
    });
  }

  function buildThemePicker(btn) {
    if (btn.closest(".theme-picker")) return btn.closest(".theme-picker");

    var wrapper = document.createElement("div");
    wrapper.className = "theme-picker";
    btn.parentNode.insertBefore(wrapper, btn);
    wrapper.appendChild(btn);

    var menu = document.createElement("div");
    menu.className = "theme-picker__menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "选择主题");

    THEME_OPTIONS.forEach(function (opt) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "theme-picker__option";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("data-theme-option", opt.key);
      item.textContent = opt.label;
      item.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        selectTheme(opt.key, btn);
      });
      menu.appendChild(item);
    });

    wrapper.appendChild(menu);
    btn.setAttribute("aria-haspopup", "true");
    return wrapper;
  }

  function wireThemeToggles() {
    var btns = document.querySelectorAll("[data-theme-toggle]");
    if (!btns.length) return;
    btns.forEach(function (btn) {
      buildThemePicker(btn);
      updateThemePickerState(btn, currentTheme());
      updateToggleLabel(btn, currentTheme());
    });
  }

  function updateToggleLabel(btn, theme) {
    var label;
    if (theme === LIGHT) label = btn.getAttribute("data-theme-label-light") || "☀️ 浅色";
    else if (theme === BLACK) label = btn.getAttribute("data-theme-label-black") || "🌙 纯黑";
    else label = btn.getAttribute("data-theme-label-dark") || "🌙 深色";
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
    var wrapper = document.createElement("div");
    wrapper.className = "theme-picker";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.setAttribute("data-theme-toggle", "");
    btn.setAttribute("aria-label", "选择主题");
    btn.setAttribute("aria-haspopup", "true");
    btn.innerHTML =
      '<svg class="theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>' +
      '<svg class="theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
      '<svg class="theme-toggle__black" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="5"/></svg>';
    wrapper.appendChild(btn);
    var menu = document.createElement("div");
    menu.className = "theme-picker__menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "选择主题");
    THEME_OPTIONS.forEach(function (opt) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "theme-picker__option";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("data-theme-option", opt.key);
      item.textContent = opt.label;
      item.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        selectTheme(opt.key, btn);
      });
      menu.appendChild(item);
    });
    wrapper.appendChild(menu);
    var backLink = nav.querySelector('a[href="../"], a[href="../index.html"]');
    if (backLink) nav.insertBefore(wrapper, backLink);
    else {
      var spacer = nav.querySelector(".spacer");
      if (spacer) nav.insertBefore(wrapper, spacer.nextSibling);
      else nav.appendChild(wrapper);
    }
    updateThemePickerState(btn, currentTheme());
  }

  // ── topbar mega menu（复刻主站 js/menu.js + css/navbar.css） ──
  var TOPNAV_MENU_KEYS = [
    { key: "overview", match: /\/api\/?$|\/api\/index\.html$/ },
    { key: "apply", match: /api_apply\.html/ },
    { key: "keys", match: /api_keys\.html/ },
    { key: "models", match: /api_models\.html/ },
    { key: "docs", match: /api_docs\.html/ },
    { key: "pricing", match: /pricing\.html/ },
    { key: "orders", match: /orders\.html/ },
  ];

  var TOPNAV_MENU_DEFS = {
    overview: {
      sideLabel: "相关入口",
      main: [
        { self: true, label: "平台概览" },
        { nav: /api_apply/, label: "申请密钥" },
        { nav: /api_docs/, hash: "quickstart", label: "快速开始" },
      ],
      side: [
        { nav: /api_models/, label: "模型广场" },
        { nav: /pricing/, label: "套餐定价" },
        { nav: /api_docs/, hash: "intro", label: "阅读文档" },
      ],
    },
    apply: {
      sideLabel: "申请之后",
      main: [
        { self: true, label: "提交申请" },
        { nav: /api_keys/, label: "管理 Keys" },
        { nav: /api_docs/, hash: "auth", label: "认证方式" },
      ],
      side: [
        { nav: /api_models/, label: "查看可用模型" },
        { nav: /pricing/, label: "选择套餐" },
        { nav: /api\/$|api\/index/, label: "返回概览" },
      ],
    },
    keys: {
      sideLabel: "常用操作",
      main: [
        { self: true, label: "控制台" },
        { nav: /api_docs/, hash: "auth", label: "Bearer 认证" },
        { nav: /api_docs/, hash: "quickstart", label: "调用示例" },
      ],
      side: [
        { nav: /api_apply/, label: "申请新密钥" },
        { nav: /api_models/, label: "模型广场" },
        { nav: /orders/, label: "订单记录" },
      ],
    },
    models: {
      sideLabel: "接入参考",
      main: [
        { self: true, label: "浏览全部模型" },
        { nav: /api_docs/, hash: "models", label: "模型列表 API" },
        { nav: /api_docs/, hash: "chat", label: "Chat 调用" },
      ],
      side: [
        { nav: /pricing/, label: "套餐与额度" },
        { nav: /api_keys/, label: "管理 API Keys" },
        { nav: /api_docs/, hash: "messages", label: "Messages 协议" },
      ],
    },
    docs: {
      sideLabel: "客户端接入",
      main: [
        { hash: "intro", label: "概述" },
        { hash: "auth", label: "认证" },
        { hash: "quickstart", label: "快速开始" },
        { hash: "chat", label: "Chat Completions" },
        { hash: "messages", label: "Messages" },
      ],
      side: [
        { hash: "cli-claude", label: "Claude Code" },
        { hash: "client-cursor", label: "Cursor" },
        { hash: "quota", label: "额度与计费" },
      ],
    },
    pricing: {
      sideLabel: "购买相关",
      main: [
        { self: true, label: "套餐与加油包" },
        { nav: /orders/, label: "我的订单" },
        { nav: /api_keys/, label: "查看 Keys" },
      ],
      side: [
        { nav: /api_models/, label: "模型广场" },
        { nav: /api_docs/, hash: "quota", label: "额度说明" },
        { nav: /api_apply/, label: "申请 API" },
      ],
    },
    orders: {
      sideLabel: "账户",
      main: [
        { self: true, label: "订单记录" },
        { nav: /pricing/, label: "购买套餐" },
        { nav: /api_keys/, label: "我的 Keys" },
      ],
      side: [
        { nav: /api_docs/, hash: "quota", label: "额度规则" },
        { external: "account.html", label: "账号设置" },
        { nav: /api\/$|api\/index/, label: "平台概览" },
      ],
    },
  };

  function findTopnavHref(topnav, pattern) {
    var links = topnav.querySelectorAll("a:not(.topnav__back)");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href") || "";
      if (pattern.test(href) || pattern.test(links[i].textContent || "")) {
        return href;
      }
    }
    return null;
  }

  function chatSiblingHref(topnav, tail) {
    // 以「返回聊天」为 chat 根目录，避免 ./api/ 被误判成 ./api/account.html
    var back = topnav && topnav.querySelector("a.topnav__back");
    if (back) {
      var root = back.getAttribute("href") || "./";
      if (!/\/$/.test(root)) root += "/";
      return root + String(tail || "").replace(/^\//, "");
    }
    var sample = topnav.querySelector("a:not(.topnav__back)");
    if (!sample) return tail;
    var href = sample.getAttribute("href") || "";
    var dir = href.replace(/(?:^|\/)[^/]*$/, "");
    if (!dir) dir = ".";
    return (dir === "." ? "./" : dir + "/") + String(tail || "").replace(/^\//, "");
  }

  function menuItemHref(topnav, parentHref, spec) {
    if (spec.self) return (parentHref || "").split("#")[0];
    if (spec.external) return chatSiblingHref(topnav, spec.external);
    var base;
    if (spec.nav) {
      base = findTopnavHref(topnav, spec.nav);
      if (!base) return "#";
    } else {
      base = (parentHref || "").split("#")[0];
    }
    return spec.hash ? base.split("#")[0] + "#" + spec.hash : base;
  }

  function menuKeyForLink(link) {
    var href = link.getAttribute("href") || "";
    var path = "";
    try {
      path = new URL(href, location.href).pathname;
    } catch (_) {
      path = href;
    }
    for (var i = 0; i < TOPNAV_MENU_KEYS.length; i++) {
      if (TOPNAV_MENU_KEYS[i].match.test(path) || TOPNAV_MENU_KEYS[i].match.test(href)) {
        return TOPNAV_MENU_KEYS[i].key;
      }
    }
    return null;
  }

  function buildTopnavMenuHTML(key, parentHref, topnav) {
    var def = TOPNAV_MENU_DEFS[key];
    if (!def) return "";
    var html = '<div class="topbar-megamenu__col topbar-megamenu__col--main">';
    (def.main || []).forEach(function (spec) {
      html +=
        '<a href="' +
        menuItemHref(topnav, parentHref, spec) +
        '">' +
        spec.label +
        "</a>";
    });
    html += "</div>";
    if (def.side && def.side.length) {
      html += '<div class="topbar-megamenu__col topbar-megamenu__col--side">';
      if (def.sideLabel) {
        html += '<span class="topbar-megamenu__label">' + def.sideLabel + "</span>";
      }
      def.side.forEach(function (spec) {
        html +=
          '<a href="' +
          menuItemHref(topnav, parentHref, spec) +
          '">' +
          spec.label +
          "</a>";
      });
      html += "</div>";
    }
    return html;
  }

  function syncTopbarOffset() {
    var topbar = document.querySelector(".topbar");
    if (!topbar) return;
    var h = topbar.offsetHeight || 54;
    document.documentElement.style.setProperty("--topbar-offset", h + "px");
    document.body.classList.add("has-topbar");
    var drawer = document.getElementById("topbar-mobile-drawer");
    if (drawer) drawer.style.top = h + "px";
  }

  function buildMobileDrawerHTML(topnav) {
    var html = "";
    topnav.querySelectorAll("a").forEach(function (link) {
      var label = (link.textContent || "").trim();
      var href = link.getAttribute("href") || "#";
      var key = link.getAttribute("data-megamenu");
      if (key && TOPNAV_MENU_DEFS[key]) {
        var def = TOPNAV_MENU_DEFS[key];
        html +=
          '<div class="topbar-mobile-item" data-expandable tabindex="0" role="button">' +
          label +
          "</div>";
        html += '<div class="topbar-mobile-submenu">';
        (def.main || []).forEach(function (spec) {
          html +=
            '<a href="' +
            menuItemHref(topnav, href, spec) +
            '">' +
            spec.label +
            "</a>";
        });
        if (def.side && def.side.length) {
          html +=
            '<div class="topbar-mobile-section-label">' +
            (def.sideLabel || "") +
            "</div>";
          def.side.forEach(function (spec) {
            html +=
              '<a href="' +
              menuItemHref(topnav, href, spec) +
              '">' +
              spec.label +
              "</a>";
          });
        }
        html += "</div>";
        return;
      }
      html +=
        '<a class="topbar-mobile-item' +
        (link.classList.contains("is-active") ? " is-active" : "") +
        '" href="' +
        href +
        '">' +
        label +
        "</a>";
    });
    return html;
  }

  function initTopbarMobileMenu() {
    var topbar = document.querySelector(".topbar");
    var inner = topbar && topbar.querySelector(".topbar__inner");
    var topnav = document.querySelector(".topnav");
    if (!topbar || !inner || !topnav || inner.dataset.mobileNavReady === "1") return;
    inner.dataset.mobileNavReady = "1";

    var actions = inner.querySelector(".topbar__actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "topbar__actions";
      var themeEl =
        inner.querySelector(".theme-picker") ||
        inner.querySelector("[data-theme-toggle]");
      if (themeEl) {
        inner.insertBefore(actions, themeEl);
        actions.appendChild(themeEl);
      } else {
        inner.appendChild(actions);
      }
    }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "topbar-mobile-menu-btn";
    btn.setAttribute("aria-label", "打开导航菜单");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = "<span></span><span></span><span></span>";
    actions.insertBefore(btn, actions.firstChild);

    var drawer = document.createElement("nav");
    drawer.className = "topbar-mobile-drawer";
    drawer.id = "topbar-mobile-drawer";
    drawer.setAttribute("aria-label", "开放平台导航");
    drawer.innerHTML = buildMobileDrawerHTML(topnav);
    document.body.appendChild(drawer);

    function refreshMobileDrawer() {
      drawer.innerHTML = buildMobileDrawerHTML(topnav);
      drawer.querySelectorAll("[data-expandable]").forEach(function (el) {
        function toggle() {
          var sub = el.nextElementSibling;
          if (!sub || !sub.classList.contains("topbar-mobile-submenu")) return;
          var willOpen = !sub.classList.contains("is-open");
          drawer.querySelectorAll(".topbar-mobile-submenu.is-open").forEach(function (openSub) {
            if (openSub !== sub) openSub.classList.remove("is-open");
          });
          drawer.querySelectorAll(".topbar-mobile-item.is-expanded").forEach(function (expanded) {
            if (expanded !== el) expanded.classList.remove("is-expanded");
          });
          sub.classList.toggle("is-open", willOpen);
          el.classList.toggle("is-expanded", willOpen);
        }
        el.addEventListener("click", toggle);
        el.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        });
      });
      drawer.querySelectorAll("a").forEach(function (a) {
        a.addEventListener("click", function () {
          setOpen(false);
        });
      });
    }

    syncTopbarOffset();
    window.addEventListener("resize", syncTopbarOffset);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(refreshMobileDrawer).catch(function () {});
    }

    var open = false;
    function setOpen(next) {
      open = next;
      btn.classList.toggle("is-active", open);
      drawer.classList.toggle("is-active", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.style.overflow = open ? "hidden" : "";
      if (!open) {
        drawer.querySelectorAll(".topbar-mobile-submenu.is-open").forEach(function (sub) {
          sub.classList.remove("is-open");
        });
        drawer.querySelectorAll(".topbar-mobile-item.is-expanded").forEach(function (el) {
          el.classList.remove("is-expanded");
        });
      }
    }

    btn.addEventListener("click", function () {
      setOpen(!open);
    });

    refreshMobileDrawer();

    window.addEventListener("resize", function () {
      if (window.innerWidth > 720 && open) setOpen(false);
    });
  }

  function initTopbarMegaMenu() {
    var topbar = document.querySelector(".topbar");
    var topnav = document.querySelector(".topnav");
    if (!topbar || !topnav || topbar.dataset.megamenuReady === "1") return;
    topbar.dataset.megamenuReady = "1";

    var menuItems = [];
    topnav.querySelectorAll("a:not(.topnav__back)").forEach(function (link) {
      var key = menuKeyForLink(link);
      if (!key || !TOPNAV_MENU_DEFS[key]) return;
      link.classList.add("topnav__item--menu");
      link.setAttribute("data-megamenu", key);
      menuItems.push({ link: link, key: key });
    });
    if (!menuItems.length) return;

    var overlay = document.querySelector(".topbar-menu-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "topbar-menu-overlay";
      document.body.appendChild(overlay);
    }

    var mega = document.createElement("div");
    mega.className = "topbar-megamenu";
    mega.id = "topbar-megamenu";
    mega.innerHTML =
      '<div class="topbar-megamenu__inner">' +
      '<div class="topbar-megamenu__content" id="topbar-megamenu-content"></div>' +
      '<div class="topbar-megamenu__line" id="topbar-megamenu-line"></div>' +
      "</div>";
    topbar.appendChild(mega);

    var content = mega.querySelector("#topbar-megamenu-content");
    var menuLine = mega.querySelector("#topbar-megamenu-line");
    var hideTimeout;
    var currentKey = null;
    var isTransitioning = false;

    function setMenuLineWidth(key) {
      if (!menuLine) return;
      var mainCol = content.querySelector(".topbar-megamenu__col--main");
      var count = mainCol ? mainCol.querySelectorAll("a").length : 0;
      var width = Math.min(72 + count * 150, 920);
      menuLine.style.width = width + "px";
    }

    function animateMenuItems() {
      var items = content.querySelectorAll("a, .topbar-megamenu__label");
      items.forEach(function (item, idx) {
        item.style.transition = "none";
        item.style.opacity = "0";
        item.style.transform = "translateY(6px)";
        void item.offsetHeight;
        item.style.transition =
          "opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), color 0.2s";
        window.setTimeout(function () {
          item.style.opacity = "1";
          item.style.transform = "translateY(0)";
        }, idx * 18);
      });
    }

    function resetMenu() {
      mega.classList.remove("is-active");
      overlay.classList.remove("is-active");
      topnav.classList.remove("has-megamenu-active");
      menuItems.forEach(function (it) {
        it.link.classList.remove("is-megamenu-active");
      });
      currentKey = null;
    }

    function hideMenu(immediate) {
      clearTimeout(hideTimeout);
      if (immediate) {
        resetMenu();
        return;
      }
      hideTimeout = window.setTimeout(resetMenu, 140);
    }

    function switchMenuContent(key, parentHref) {
      if (currentKey === key || isTransitioning) return;
      isTransitioning = true;
      var inner = mega.querySelector(".topbar-megamenu__inner");
      var startHeight = inner.offsetHeight;
      inner.style.height = startHeight + "px";
      content.style.opacity = "0";
      window.setTimeout(function () {
        content.innerHTML = buildTopnavMenuHTML(key, parentHref, topnav);
        inner.style.height = "auto";
        var endHeight = inner.offsetHeight;
        inner.style.height = startHeight + "px";
        void inner.offsetHeight;
        inner.style.height = endHeight + "px";
        animateMenuItems();
        content.style.opacity = "1";
        currentKey = key;
        setMenuLineWidth(key);
        window.setTimeout(function () {
          if (currentKey === key) inner.style.height = "auto";
          isTransitioning = false;
        }, 160);
      }, 50);
    }

    function showMenuForItem(item) {
      clearTimeout(hideTimeout);
      var key = item.key;
      var href = item.link.getAttribute("href") || "";
      menuItems.forEach(function (it) {
        it.link.classList.remove("is-megamenu-active");
      });
      item.link.classList.add("is-megamenu-active");
      topnav.classList.add("has-megamenu-active");

      if (!mega.classList.contains("is-active")) {
        content.innerHTML = buildTopnavMenuHTML(key, href, topnav);
        currentKey = key;
        if (menuLine) menuLine.style.width = "0";
        animateMenuItems();
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            setMenuLineWidth(key);
          });
        });
      } else {
        switchMenuContent(key, href);
      }
      mega.classList.add("is-active");
      overlay.classList.add("is-active");
    }

    menuItems.forEach(function (item) {
      item.link.addEventListener("mouseenter", function () {
        showMenuForItem(item);
      });
    });

    topbar.addEventListener("mouseleave", function () {
      hideMenu();
    });
    mega.addEventListener("mouseenter", function () {
      clearTimeout(hideTimeout);
    });
    mega.addEventListener("mouseleave", function () {
      hideMenu();
    });
    overlay.addEventListener("mouseenter", function () {
      hideMenu();
    });
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

  function chatAssetPrefix() {
    var p = (location.pathname || "").replace(/\\/g, "/");
    if (/\/api\/?$/.test(p) || /\/api\/index\.html$/i.test(p) || /\/api\/admin/i.test(p)) {
      return "../";
    }
    return "./";
  }

  function injectSiteFooterSocials() {
    if (isAdminShellPage()) return;
    var inner = document.querySelector(".site-footer__inner");
    if (!inner || inner.querySelector(".site-footer__socials")) return;

    var sig = inner.querySelector(".site-footer__sig");
    var copy = inner.querySelector(".site-footer__copy");
    if (!copy) {
      var kids = inner.children;
      for (var i = 0; i < kids.length; i++) {
        if (
          kids[i] !== sig &&
          kids[i].textContent &&
          kids[i].textContent.indexOf("©") !== -1
        ) {
          copy = kids[i];
          copy.classList.add("site-footer__copy");
          break;
        }
      }
    }

    if (sig && !sig.closest(".site-footer__brand")) {
      var brand = document.createElement("div");
      brand.className = "site-footer__brand";
      inner.insertBefore(brand, sig);
      brand.appendChild(sig);
      sig = brand.querySelector(".site-footer__sig");
    }
    var brandHost = inner.querySelector(".site-footer__brand") || inner;

    var asset = chatAssetPrefix();
    var nav = document.createElement("nav");
    nav.className = "site-footer__socials";
    nav.setAttribute("aria-label", "社交链接");
    nav.innerHTML =
      '<a href="https://x.com/NexusVAI" target="_blank" rel="noopener noreferrer" aria-label="X" title="X">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>' +
      '<a href="https://discord.gg/fAfvyhjHJP" target="_blank" rel="noopener noreferrer" aria-label="Discord" title="Discord">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.2252 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg></a>' +
      '<a href="https://github.com/NexusVAI" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg></a>' +
      '<a href="https://huggingface.co/xingy555888" target="_blank" rel="noopener noreferrer" aria-label="Hugging Face" title="Hugging Face">' +
      '<img class="social-icon--huggingface" src="' +
      asset +
      'huggingface-color.svg" alt="" width="20" height="20" loading="lazy" decoding="async" /></a>' +
      '<a href="https://space.bilibili.com/3691002594331274" target="_blank" rel="noopener noreferrer" aria-label="Bilibili" title="Bilibili">' +
      '<img class="social-icon--bilibili" src="' +
      asset +
      'bilibili-color.svg" alt="" width="20" height="20" loading="lazy" decoding="async" /></a>';

    brandHost.appendChild(nav);
  }

  function injectClaudeDocsTheme() {
    if (isAdminShellPage()) return;
    if (document.getElementById("cancri-claude-docs-theme")) return;
    var scripts = document.getElementsByTagName("script");
    var base = "./api/";
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("api-platform.js") !== -1) {
        base = src.replace(/api-platform\.js.*$/, "");
        break;
      }
    }
    var link = document.createElement("link");
    link.id = "cancri-claude-docs-theme";
    link.rel = "stylesheet";
    link.href = base + "claude-docs-theme.css?v=20260620-claude-ui";
    document.head.appendChild(link);
  }

  function chatRootPrefix() {
    var path = location.pathname || "";
    if (/\/api\/?$/.test(path) || /\/api\/index\.html$/i.test(path)) {
      return "../";
    }
    return "./";
  }

  function enhanceTopbarChrome() {
    if (isAdminShellPage()) return;
    var inner = document.querySelector(".topbar__inner");
    if (!inner) return;

    var brand = inner.querySelector(".brand");
    if (brand && !brand.querySelector(".brand__wordmark")) {
      var wordmark = document.createElement("span");
      wordmark.className = "brand__wordmark";
      wordmark.textContent = "NexusVAI API Docs";
      brand.appendChild(wordmark);
    }

    inner.querySelectorAll('.topnav a[href*="api_keys"]').forEach(function (a) {
      if (/^keys$/i.test((a.textContent || "").trim())) {
        a.textContent = "控制台";
      }
    });

    if (inner.querySelector(".topbar__actions")) return;
    var actions = document.createElement("div");
    actions.className = "topbar__actions";

    var root = chatRootPrefix();
    var consoleLink = document.createElement("a");
    consoleLink.className = "topbar__console-btn";
    consoleLink.href = root + "api_keys.html";
    consoleLink.textContent = "Console";
    if (/api_keys\.html/i.test(location.pathname || "")) {
      consoleLink.classList.add("is-active");
    }
    actions.appendChild(consoleLink);

    var themeBtn =
      inner.querySelector("[data-theme-toggle]") ||
      inner.querySelector(".theme-toggle") ||
      inner.querySelector(".theme-picker");
    if (themeBtn) {
      inner.insertBefore(actions, themeBtn);
    } else {
      inner.appendChild(actions);
    }
  }

  function loadPlatformSearch() {
    if (isAdminShellPage()) return;
    if (!document.querySelector(".topbar")) return;
    var scripts = document.getElementsByTagName("script");
    var base = "./api/";
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("api-platform.js") !== -1) {
        base = src.replace(/api-platform\.js.*$/, "");
        break;
      }
    }
    var s = document.createElement("script");
    s.src = base + "api-platform-search.js?v=20260607-account-fix";
    s.defer = true;
    document.head.appendChild(s);
  }

  function wireDocsHomeSearch() {
    var pill = document.getElementById("docsSearchPill");
    if (!pill) return;
    pill.addEventListener("click", function () {
      var trigger =
        document.querySelector("[data-platform-search-trigger]") ||
        document.querySelector(".platform-search-trigger");
      if (trigger) trigger.click();
    });
  }

  function ready() {
    injectClaudeDocsTheme();
    initAdminShell();
    initTopbarMegaMenu();
    enhanceTopbarChrome();
    wireThemeToggles();
    initTopbarMobileMenu();
    injectSiteFooterSocials();
    loadPlatformSearch();
    wireDocsHomeSearch();
    syncTopbarOffset();
    window.addEventListener("resize", syncTopbarOffset);
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
      document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
        updateThemePickerState(btn, t);
        updateToggleLabel(btn, t);
      });
    },
    getTheme: currentTheme,
    THEME_KEY: THEME_KEY,
  };

  // Note: previously auto-loaded ../cancri_liquid_glass.js on every
  // admin page to back [data-glass]. Removed 2026-05-14 — admin pages
  // don't use the helper anymore (see api-platform.css). Re-enable
  // only if individual admin pages add data-glass themselves.
})();
