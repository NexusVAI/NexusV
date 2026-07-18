/* =====================================================================
 * 埃德加德加 · 限时创意卡（hero 问候语位）
 * 2026-07-19
 *
 * 展示窗口（Asia/Shanghai）：
 *   2026-07-18 09:42  →  2026-07-20 00:00
 * 窗口外：不渲染，hero 问候文案恢复正常。
 *
 * 行为：
 *   - 替换 #heroTitle 内 .hero-text 位置，展示 Adejia0719 创意卡
 *   - 点击卡片 → 输入框写入介绍 prompt → 触发发送（#sendChatBtn / handleHomeSubmit）
 * ===================================================================== */
(function () {
  "use strict";

  var START_MS = Date.parse("2026-07-18T09:42:00+08:00");
  var END_MS = Date.parse("2026-07-20T00:00:00+08:00");
  var PROMPT =
    "介绍一下埃德加德加：他是谁、有什么有趣的特点，用轻松好玩的口吻讲，并邀请我继续聊聊。";
  var IMG_CANDIDATES = [
    "./assets/Adejia0719.png",
    "../Logo/Adejia0719.png",
    "./Logo/Adejia0719.png",
  ];
  var STYLE_ID = "adejia-promo-card-styles";
  var CARD_ID = "adejiaPromoCard";
  var BODY_CLASS = "adejia-promo-active";
  var CHECK_MS = 30 * 1000;

  function nowMs() {
    return Date.now();
  }

  function isActive() {
    var t = nowMs();
    return t >= START_MS && t < END_MS;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "/* 限时：隐藏原 logo 图标 + 问候文案，只露创意卡（红框位置） */",
      "body." + BODY_CLASS + " .hero .hero-icon,",
      "body." + BODY_CLASS + " .hero .hero-text {",
      "  display: none !important;",
      "}",
      "body." + BODY_CLASS + " #" + CARD_ID + " {",
      "  display: inline-flex !important;",
      "}",
      "body." + BODY_CLASS + " #heroTitle.hero {",
      "  gap: 0;",
      "}",
      "#" + CARD_ID + " {",
      "  display: none;",
      "  align-items: center;",
      "  gap: 12px;",
      "  vertical-align: middle;",
      "  margin: 0 auto;",
      "  padding: 6px 14px 6px 6px;",
      "  border: 1px solid rgba(112,107,87,.16);",
      "  border-radius: 999px;",
      "  background: rgba(250,249,245,.95);",
      "  box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 10px 28px rgba(0,0,0,.07);",
      "  cursor: pointer;",
      "  max-width: min(86vw, 440px);",
      "  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;",
      "  font: inherit;",
      "  color: inherit;",
      "  text-align: left;",
      "  -webkit-tap-highlight-color: transparent;",
      "}",
      "#" + CARD_ID + ":hover {",
      "  transform: translateY(-1px) scale(1.015);",
      "  border-color: rgba(217,119,87,.48);",
      "  box-shadow: 0 2px 8px rgba(0,0,0,.06), 0 14px 32px rgba(217,119,87,.14);",
      "}",
      "#" + CARD_ID + ":active { transform: scale(.985); }",
      "#" + CARD_ID + " .adejia-promo-avatar {",
      "  width: 48px;",
      "  height: 48px;",
      "  border-radius: 50%;",
      "  object-fit: cover;",
      "  flex: 0 0 auto;",
      "  background: #efece4;",
      "  display: block;",
      "  box-shadow: inset 0 0 0 1px rgba(0,0,0,.04);",
      "}",
      "#" + CARD_ID + " .adejia-promo-copy {",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 2px;",
      "  min-width: 0;",
      "  padding-right: 6px;",
      "}",
      "#" + CARD_ID + " .adejia-promo-title {",
      "  font-size: clamp(1.15rem, 1rem + 1.2vw, 1.65rem);",
      "  font-weight: 600;",
      "  line-height: 1.25;",
      "  color: var(--c-text-soft, #3a3428);",
      "  white-space: nowrap;",
      "  overflow: hidden;",
      "  text-overflow: ellipsis;",
      "}",
      "#" + CARD_ID + " .adejia-promo-sub {",
      "  font-size: 12.5px;",
      "  line-height: 1.3;",
      "  color: rgba(80,74,60,.72);",
      "  white-space: nowrap;",
      "}",
      "html[data-theme='dark'] #" + CARD_ID + " {",
      "  background: rgba(40,38,34,.94);",
      "  border-color: rgba(255,255,255,.10);",
      "}",
      "html[data-theme='dark'] #" + CARD_ID + " .adejia-promo-title { color: rgba(245,241,232,.92); }",
      "html[data-theme='dark'] #" + CARD_ID + " .adejia-promo-sub { color: rgba(220,214,200,.62); }",
      "@media (max-width: 640px) {",
      "  #" + CARD_ID + " .adejia-promo-avatar { width: 40px; height: 40px; }",
      "  #" + CARD_ID + " .adejia-promo-title { font-size: 1.15rem; }",
      "  #" + CARD_ID + " .adejia-promo-sub { font-size: 11.5px; }",
      "}",
    ].join("\n");
    document.head.appendChild(s);
  }

  function pickImgSrc() {
    return IMG_CANDIDATES[0];
  }

  function ensureCard() {
    var existing = document.getElementById(CARD_ID);
    if (existing) return existing;

    var hero = document.getElementById("heroTitle");
    if (!hero) return null;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = CARD_ID;
    btn.className = "adejia-promo-card";
    btn.setAttribute("aria-label", "认识埃德加德加，点击发送介绍");
    btn.innerHTML =
      '<img class="adejia-promo-avatar" alt="" width="40" height="40" decoding="async" />' +
      '<span class="adejia-promo-copy">' +
      '<span class="adejia-promo-title">埃德加德加</span>' +
      '<span class="adejia-promo-sub">点我认识他 · 限时创意卡</span>' +
      "</span>";

    var img = btn.querySelector("img");
    var srcs = IMG_CANDIDATES.slice();
    img.src = srcs.shift();
    img.onerror = function () {
      if (srcs.length) img.src = srcs.shift();
    };

    // 插在 .hero-text 后面；没有则挂到 hero 末尾
    var heroText = hero.querySelector(".hero-text");
    if (heroText && heroText.parentNode) {
      heroText.parentNode.insertBefore(btn, heroText.nextSibling);
    } else {
      hero.appendChild(btn);
    }

    btn.addEventListener("click", onCardClick);
    return btn;
  }

  function setComposerValue(text) {
    var input =
      document.getElementById("homeInput") ||
      document.querySelector("textarea.composer-input") ||
      document.querySelector("textarea");
    if (!input) return null;
    input.focus();
    input.value = text;
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_e) {}
    // 自动增高 textarea
    try {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 200) + "px";
    } catch (_e2) {}
    return input;
  }

  function triggerSend() {
    var btn =
      document.getElementById("sendChatBtn") ||
      document.querySelector("[data-send-chat]") ||
      document.querySelector(".composer-send") ||
      document.querySelector("button.send");
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    // 兜底：Enter 提交（部分页面绑定 keydown）
    var input = document.getElementById("homeInput");
    if (input) {
      try {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
          })
        );
      } catch (_e) {}
    }
    return false;
  }

  function onCardClick(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (!isActive()) return;
    setComposerValue(PROMPT);
    // 等一帧让 React/监听器看到 value
    setTimeout(function () {
      triggerSend();
    }, 30);
  }

  function applyState() {
    injectStyles();
    var active = isActive();
    document.body.classList.toggle(BODY_CLASS, active);
    if (active) {
      ensureCard();
    } else {
      var card = document.getElementById(CARD_ID);
      if (card && card.parentNode) card.parentNode.removeChild(card);
    }
  }

  function boot() {
    applyState();
    // 跨过窗口边界时自动恢复
    setInterval(applyState, CHECK_MS);
    // hero 可能被 SPA 重绘：观察 #heroTitle
    var hero = document.getElementById("heroTitle");
    if (hero && typeof MutationObserver !== "undefined") {
      var mo = new MutationObserver(function () {
        if (isActive() && !document.getElementById(CARD_ID)) ensureCard();
      });
      mo.observe(hero, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // 调试
  try {
    window.__ADEJIA_PROMO__ = {
      isActive: isActive,
      prompt: PROMPT,
      start: START_MS,
      end: END_MS,
    };
  } catch (_e) {}
})();
