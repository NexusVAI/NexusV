/* ============================================================================
 * cancri_chat_nav.js
 * ----------------------------------------------------------------------------
 * 顶栏右上角「新建对话」铅笔按钮（对齐 Grok 视觉）—— 点击复用现有
 * window.CancriApp.newChat。附加式、纯前端，不改 cancri_chat.js 主体。
 *
 * 注：右侧「对话轮次导航条」站内已有实现（#chatNav / updateChatNav，
 * cancri_chat.css 的 .chat-nav），本文件不再重复造，其 Grok 风格刻度样式
 * 由 cancri_chat.css 里的 .chat-nav 重新设计承担。
 * ========================================================================== */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn, { once: true });
  }

  function init() {
    initNewChatButton(document.querySelector(".header-right"));
  }

  /* ── 顶栏铅笔「新建对话」按钮 ── */
  function initNewChatButton(headerRight) {
    if (!headerRight || document.getElementById("headerNewChatBtn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "headerNewChatBtn";
    btn.className = "icon-btn header-newchat-btn";
    btn.title = "新建对话";
    btn.setAttribute("aria-label", "新建对话");
    btn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>' +
      '<path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"></path>' +
      "</svg>";
    btn.addEventListener("click", function () {
      const app = window.CancriApp;
      if (app && typeof app.newChat === "function") app.newChat();
    });
    // 放在 header-right 末尾（最右），与 Grok「分享 + 铅笔」的铅笔位置一致
    headerRight.appendChild(btn);
  }

  ready(init);
})();
