/* NexusV 开放平台首页：生态 logo 动画条 + 旗舰卡营销展示。
 * 注意：本页使用 <base href="../../">，所有相对路径以站点根为基准。
 *
 * 2026-07-10：价格行禁止 data-i18n（曾把正确价刷成过期 i18n）。
 * 2026-08-10：首页三张旗舰卡用 HOME_CARD_OVERRIDES 固定营销名/价/ctx（不跟计费库）。
 */
(function () {
  "use strict";

  // ── OpenAI-style trusted logo grid (mask + vertical crossfade) ──
  function initTrustedLogos() {
    var host = document.getElementById("api-home-trusted-logos");
    if (!host || !window.OaiTrustedLogos) return;
    window.OaiTrustedLogos.init(host);
  }

  // ── frontier model cards：首页营销展示 ──────────────────────────
  function fmtYuan(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return "—";
    // 1.6 → 1.60；0.075 → 0.075（去掉多余尾 0，但至少保留一位小数观感）
    var s = x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    if (s.indexOf(".") === -1) s += ".00";
    else if (s.split(".")[1].length === 1) s += "0";
    return s;
  }

  function isEn() {
    try {
      var lang = localStorage.getItem("lang") || "";
      if (lang === "en") return true;
      if (lang === "zh") return false;
    } catch (e) { /* ignore */ }
    return (document.documentElement.lang || "").toLowerCase().indexOf("zh") !== 0;
  }

  // 首页旗舰卡营销展示（仅 UI；不改计费 / model_pricing）
  var HOME_CARD_OVERRIDES = {
    "claude-opus-4-8-xhigh": {
      displayName: "Claude Opus 5",
      inputPricePerM: 0.59,
      outputPricePerM: 1.99,
      ctxZh: "1M 上下文长度 · 32K 最大输出",
      ctxEn: "1M context · 32K max output",
    },
    "gpt-5.6-sol-xhigh": {
      displayName: "GPT 5.6 Sol",
      inputPricePerM: 0.59,
      outputPricePerM: 2.99,
      ctxZh: "100万 上下文长度 · 3.2万 最大输出",
      ctxEn: "1M context · 32K max output",
    },
    "grok-4.5-xhigh": {
      displayName: "Grok 4.5",
      pricePerCall: 0.05,
      ctxZh: "500K 上下文长度 · 32K 最大输出",
      ctxEn: "500K context · 32K max output",
    },
  };

  function marketingPriceLine(ov, en) {
    if (ov.pricePerCall != null) {
      return en
        ? "¥" + fmtYuan(ov.pricePerCall) + " per request"
        : "每次：¥" + fmtYuan(ov.pricePerCall);
    }
    if (en) {
      return (
        "Input: ¥" +
        fmtYuan(ov.inputPricePerM) +
        " / Output: ¥" +
        fmtYuan(ov.outputPricePerM) +
        " per 1M tokens"
      );
    }
    return (
      "输入：¥" +
      fmtYuan(ov.inputPricePerM) +
      " / 输出：¥" +
      fmtYuan(ov.outputPricePerM) +
      " 每百万标记"
    );
  }

  function applyHomeMarketingCards() {
    var en = isEn();
    document.querySelectorAll(".model-card[data-model-id]").forEach(function (card) {
      var id = (card.getAttribute("data-model-id") || "").toLowerCase();
      var ov = HOME_CARD_OVERRIDES[id];
      if (!ov) return;
      var nameEl = card.querySelector(".model-card__name");
      var priceEl = card.querySelector('[data-slot="price"]');
      var ctxEl = card.querySelector('[data-slot="ctx"]');
      if (nameEl && ov.displayName) nameEl.textContent = ov.displayName;
      if (priceEl) priceEl.textContent = marketingPriceLine(ov, en);
      if (ctxEl) {
        var ctx = en ? ov.ctxEn : ov.ctxZh;
        if (ctx) ctxEl.textContent = ctx;
      }
    });
  }

  // 语言切换后按 isEn 重套营销文案（cutoff 由 i18n data-i18n 处理）
  window.addEventListener("languageChanged", function () {
    applyHomeMarketingCards();
  });

  // ── voice/image tab toggle (section 6) ──────────────────────────
  function initElevateTabs() {
    var tabs = document.querySelectorAll("[data-elevate-tab]");
    var panels = document.querySelectorAll("[data-elevate-panel]");
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var key = tab.getAttribute("data-elevate-tab");
        tabs.forEach(function (t) {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        panels.forEach(function (p) {
          p.classList.toggle("is-active", p.getAttribute("data-elevate-panel") === key);
        });
      });
    });
  }

  // ── Split 按钮：左半跳转，右半箭头开菜单 ────────────────────
  // 胶囊按钮 r=40；只有下拉菜单同比缩小用 r=32。条目 R = 32 − padding，min-height > 2R。
  var CK_PILL_RADIUS = 40;
  var CK_MENU_RADIUS = 32;
  var CK_SMOOTHING = 1;
  var ckInstance = null;

  function getCornerKit() {
    var Ctor = window.CornerKit;
    if (!Ctor) return null;
    if (!ckInstance) ckInstance = new Ctor({ radius: CK_PILL_RADIUS, smoothing: CK_SMOOTHING });
    return ckInstance;
  }

  function paddingInset(el) {
    var style = window.getComputedStyle(el);
    var left = parseFloat(style.paddingLeft) || 0;
    var right = parseFloat(style.paddingRight) || 0;
    var top = parseFloat(style.paddingTop) || 0;
    var bottom = parseFloat(style.paddingBottom) || 0;
    return Math.min(left, right, top, bottom);
  }

  function applySquircle(el, radius, withBorder) {
    var ck = getCornerKit();
    if (!ck || !(el instanceof HTMLElement)) return false;
    if (el.offsetWidth < 1 || el.offsetHeight < 1) return false;
    var cfg = { radius: radius, smoothing: CK_SMOOTHING };
    if (withBorder) cfg.border = { width: 1, color: "var(--border-light)" };
    try {
      if (ck.inspect(el)) ck.update(el, cfg);
      else ck.apply(el, cfg);
      el.setAttribute("data-ck", "1");
      return true;
    } catch (err) {
      return false;
    }
  }

  function squircleMenuPanel(panel) {
    applySquircle(panel, CK_MENU_RADIUS, true);
    var innerR = Math.max(0, CK_MENU_RADIUS - paddingInset(panel));
    var host = panel.querySelector(".api-btn-menu__clip") || panel;
    host.querySelectorAll("a").forEach(function (a) {
      applySquircle(a, innerR, false);
    });
  }

  function squirclePills() {
    document.querySelectorAll(".api-btn").forEach(function (el) {
      applySquircle(el, CK_PILL_RADIUS, false);
    });
  }

  function initSplitMenus() {
    var menus = document.querySelectorAll(".api-btn-menu");
    if (!menus.length) return;

    function setOpen(root, open) {
      var btn = root.querySelector(".api-btn-menu__toggle");
      var panel = root.querySelector(".api-btn-menu__panel");
      if (!btn || !panel) return;
      root.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        panel.removeAttribute("hidden");
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            squircleMenuPanel(panel);
          });
        });
      } else {
        panel.setAttribute("hidden", "");
      }
    }

    function closeAll(except) {
      menus.forEach(function (root) {
        if (root !== except) setOpen(root, false);
      });
    }

    menus.forEach(function (root) {
      var btn = root.querySelector(".api-btn-menu__toggle");
      if (!btn) return;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var next = !root.classList.contains("is-open");
        closeAll(root);
        setOpen(root, next);
      });
    });

    document.addEventListener("click", function (e) {
      var hit = e.target && e.target.closest ? e.target.closest(".api-btn-menu") : null;
      if (!hit) closeAll(null);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeAll(null);
    });
  }

  // ── 仅本页顶栏：社群按钮 + NexusVAI 开放平台文案（不改 components.js）──
  var QQ_GROUP_URL = "https://qm.qq.com/q/bjNIz8USbu";

  function patchApiHomeNav() {
    var pill = document.querySelector(".navbar a.btn-pill");
    if (pill) {
      pill.href = QQ_GROUP_URL;
      pill.target = "_blank";
      pill.rel = "noopener noreferrer";
      var pillLabel = pill.querySelector("[data-i18n]") || pill;
      pillLabel.setAttribute("data-i18n", "api.home.nav.join_community");
      if (pillLabel !== pill) pill.removeAttribute("data-i18n");
    }

    document.querySelectorAll("a.nav-item, a.mobile-nav-item").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key === "nav.developer" || key === "api.home.nav.developer") {
        el.setAttribute("data-i18n", "api.home.nav.developer");
      }
    });

    var cta = document.querySelector(".mobile-drawer a.mobile-cta");
    if (cta) {
      cta.href = QQ_GROUP_URL;
      cta.target = "_blank";
      cta.rel = "noopener noreferrer";
      cta.setAttribute("data-i18n", "api.home.nav.join_community");
    }

    if (typeof window.translate === "function") {
      var nav = document.querySelector(".navbar");
      var drawer = document.querySelector(".mobile-drawer");
      if (nav) window.translate(nav);
      if (drawer) window.translate(drawer);
    }
  }

  function boot() {
    initTrustedLogos();
    initElevateTabs();
    applyHomeMarketingCards();
    initSplitMenus();
    squirclePills();
    if (document.querySelector(".navbar")) patchApiHomeNav();
  }

  window.addEventListener("nexus:components-injected", patchApiHomeNav);
  window.addEventListener("languageChanged", patchApiHomeNav);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
