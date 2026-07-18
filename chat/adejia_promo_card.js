/* =====================================================================
 * 埃德加德加 · 限时 hero 位图片
 * 2026-07-18 09:42 → 2026-07-20 00:00 (Asia/Shanghai)
 * 仅展示图片，无额外文案；点击后自动发送介绍 prompt。
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
    var hero = document.getElementById("heroTitle");
    if (!hero) return null;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = CARD_ID;
    btn.setAttribute("aria-label", "埃德加德加");
    var img = document.createElement("img");
    img.alt = "埃德加德加";
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
