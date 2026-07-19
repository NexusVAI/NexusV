/* =====================================================================
 * 人类月球日 · 限时 hero 位图片
 * 2026-07-19 00:00 → 2026-07-22 00:00 (Asia/Shanghai) 即 7/19–7/21
 * 仅展示图片；点击后自动填入并发送介绍 prompt。
 * ===================================================================== */
(function () {
  "use strict";

  var START_MS = Date.parse("2026-07-19T00:00:00+08:00");
  var END_MS = Date.parse("2026-07-22T00:00:00+08:00");
  var PROMPT =
    "今天是「人类月球日」（Human Moon Day，7 月 20 日）。请用轻松有趣、适合聊天的口吻介绍：它纪念什么历史事件、为什么值得被记住，再分享 2～3 个月球冷知识，最后邀请我继续聊聊太空或登月故事。";
  var IMG_CANDIDATES = [
    "./assets/720.png",
    "../Logo/720.png",
    "./Logo/720.png",
  ];
  var STYLE_ID = "moon-day-promo-card-styles";
  var CARD_ID = "moonDayPromoCard";
  var BODY_CLASS = "moon-day-promo-active";
  var CHECK_MS = 30 * 1000;

  function isActive() {
    var t = Date.now();
    return t >= START_MS && t < END_MS;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = [
      "body." + BODY_CLASS + " .hero .hero-icon,",
      "body." + BODY_CLASS + " .hero .hero-text { display: none !important; }",
      "body." + BODY_CLASS + " #" + CARD_ID + " { display: inline-block !important; }",
      "#" + CARD_ID + " {",
      "  display: none;",
      "  margin: 0;",
      "  padding: 0;",
      "  border: 0;",
      "  background: transparent;",
      "  cursor: pointer;",
      "  line-height: 0;",
      "  vertical-align: middle;",
      "  -webkit-tap-highlight-color: transparent;",
      "}",
      "#" + CARD_ID + " img {",
      "  display: block;",
      "  height: clamp(40px, 5.5vw, 56px);",
      "  width: auto;",
      "  max-width: min(70vw, 280px);",
      "  object-fit: contain;",
      "  border-radius: 10px;",
      "  transition: transform .15s ease, filter .15s ease;",
      "}",
      "#" + CARD_ID + ":hover img { transform: scale(1.03); }",
      "#" + CARD_ID + ":active img { transform: scale(.98); }",
    ].join("\n");
    document.head.appendChild(s);
  }

  function ensureCard() {
    var existing = document.getElementById(CARD_ID);
    if (existing) return existing;
    // Remove legacy Adejia card if still in DOM
    var legacy = document.getElementById("adejiaPromoCard");
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);

    var hero = document.getElementById("heroTitle");
    if (!hero) return null;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = CARD_ID;
    btn.setAttribute("aria-label", "人类月球日");
    var img = document.createElement("img");
    img.alt = "人类月球日";
    img.decoding = "async";
    var srcs = IMG_CANDIDATES.slice();
    img.src = srcs.shift();
    img.onerror = function () {
      if (srcs.length) img.src = srcs.shift();
    };
    btn.appendChild(img);

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
      document.querySelector("textarea.composer-input");
    if (!input) return null;
    input.focus();
    input.value = text;
    try {
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_e) {}
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
      document.querySelector(".composer-send");
    if (btn && !btn.disabled) {
      btn.click();
      return;
    }
    var input = document.getElementById("homeInput");
    if (!input) return;
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

  function onCardClick(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    if (!isActive()) return;
    setComposerValue(PROMPT);
    setTimeout(triggerSend, 30);
  }

  function applyState() {
    injectStyles();
    var active = isActive();
    document.body.classList.toggle(BODY_CLASS, active);
    document.body.classList.remove("adejia-promo-active");
    if (active) {
      ensureCard();
    } else {
      var card = document.getElementById(CARD_ID);
      if (card && card.parentNode) card.parentNode.removeChild(card);
    }
  }

  function boot() {
    applyState();
    setInterval(applyState, CHECK_MS);
    var hero = document.getElementById("heroTitle");
    if (hero && typeof MutationObserver !== "undefined") {
      new MutationObserver(function () {
        if (isActive() && !document.getElementById(CARD_ID)) ensureCard();
      }).observe(hero, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
