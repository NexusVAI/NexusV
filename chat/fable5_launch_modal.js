/* ============================================================
 * Claude Fable 5 上线推广弹窗（Claude 官方卡片布局复刻）
 * 2026-06-10
 *
 * 行为：chat 页（index / claude）与 API 模型广场（api_models.html）
 *       各弹出一次；关闭后按 surface 写入 localStorage。
 * Kill：URL ?nofable5=1
 * ============================================================ */
(function () {
  "use strict";

  var SEEN_KEY = "cancri_fable5_launch_v1";
  var KILL_KEY = "cancri_fable5_launch_off";
  var SHOW_DELAY_MS = 1200;
  var PRICING_URL = "./pricing.html";
  var VIDEO_SRC = "../Logo/model-launch-login-hero-aca82d76.mp4";

  function detectSurface() {
    var p = String(window.location.pathname || "");
    if (/api_models\.html$/i.test(p) || p.indexOf("api_models") >= 0) return "api";
    return "chat";
  }

  function isKilled() {
    try {
      if (window.location.search.indexOf("nofable5=1") >= 0) {
        localStorage.setItem(KILL_KEY, "1");
        return true;
      }
      if (localStorage.getItem(KILL_KEY) === "1") return true;
    } catch (_) {}
    return false;
  }

  function isSeen(surface) {
    try {
      var raw = localStorage.getItem(SEEN_KEY) || "";
      return raw.split(",").indexOf(surface) >= 0;
    } catch (_) {
      return false;
    }
  }

  function markSeen(surface) {
    try {
      var parts = (localStorage.getItem(SEEN_KEY) || "").split(",").filter(Boolean);
      if (parts.indexOf(surface) < 0) parts.push(surface);
      localStorage.setItem(SEEN_KEY, parts.join(","));
    } catch (_) {}
  }

  function injectStyles() {
    if (document.getElementById("fable5-launch-modal-styles")) return;
    var s = document.createElement("style");
    s.id = "fable5-launch-modal-styles";
    s.textContent = [
      ".f5lm-overlay{position:fixed;inset:0;z-index:9150;display:flex;align-items:center;justify-content:center;",
      "padding:16px;background:rgba(15,15,15,.46);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);",
      "opacity:0;transition:opacity .28s ease}",
      ".f5lm-overlay.f5lm-open{opacity:1}",
      ".f5lm-card{position:relative;width:100%;max-width:920px;max-height:92vh;overflow:hidden;",
      "background:#faf9f5;color:#29261b;border-radius:20px;",
      "box-shadow:0 1px 2px rgba(0,0,0,.05),0 16px 40px rgba(0,0,0,.12);",
      "border:1px solid rgba(112,107,87,.2);transform:translateY(10px) scale(.982);",
      "transition:transform .3s cubic-bezier(.2,.7,.3,1)}",
      ".f5lm-overlay.f5lm-open .f5lm-card{transform:translateY(0) scale(1)}",
      ".f5lm-grid{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);min-height:0}",
      "@media (max-width:767px){.f5lm-grid{grid-template-columns:1fr}}",
      ".f5lm-panel{display:flex;flex-direction:column;justify-content:space-between;gap:24px;",
      "padding:28px 28px 24px;min-width:0}",
      "@media (min-width:768px){.f5lm-panel{padding:32px 32px 28px}}",
      ".f5lm-badge{display:inline-flex;align-items:center;align-self:flex-start;height:24px;padding:0 10px;",
      "border-radius:8px;font-size:12px;font-weight:600;letter-spacing:.02em;",
      "background:rgba(217,119,87,.14);color:#9a3412}",
      ".f5lm-title{margin:0;font-size:clamp(22px,3.2vw,28px);line-height:1.22;font-weight:700;color:#29261b;",
      "font-family:'Source Serif 4','Source Serif Pro',ui-serif,Georgia,serif;letter-spacing:-.01em}",
      ".f5lm-lead{margin:0;font-size:15px;line-height:1.6;color:#535146}",
      ".f5lm-note{margin-top:4px;border:1px solid rgba(112,107,87,.22);border-radius:14px;",
      "padding:14px 16px;font-size:13px;line-height:1.55;color:#535146;background:#fff}",
      ".f5lm-note strong{display:block;color:#29261b;font-weight:600;margin-bottom:4px}",
      ".f5lm-note code{font-size:12px;background:#f3f1ea;padding:1px 6px;border-radius:4px;font-family:ui-monospace,monospace}",
      ".f5lm-actions{display:flex;flex-direction:column;gap:10px;width:100%}",
      ".f5lm-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:40px;",
      "border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;",
      "font-family:inherit;transition:background .15s,border-color .15s,color .15s,transform .12s}",
      ".f5lm-btn:active{transform:translateY(1px)}",
      ".f5lm-btn--primary{background:#29261b;color:#faf9f5}",
      ".f5lm-btn--primary:hover{background:#1f1d17}",
      ".f5lm-btn--secondary{background:#faf9f5;color:#29261b;border-color:rgba(112,107,87,.35)}",
      ".f5lm-btn--secondary:hover{background:#f3f1ea}",
      ".f5lm-media{position:relative;display:none;align-items:stretch;justify-content:center;",
      "background:#ebe6da;overflow:hidden;border-radius:0 20px 20px 0;min-height:220px}",
      "@media (min-width:768px){.f5lm-media{display:flex}}",
      ".f5lm-video{width:100%;height:100%;object-fit:cover;display:block}",
      ".f5lm-close{position:absolute;top:14px;right:14px;z-index:2;width:36px;height:36px;",
      "border:none;border-radius:50%;background:rgba(250,249,245,.92);color:#29261b;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.08);",
      "transition:background .15s,transform .12s}",
      ".f5lm-close:hover{background:#fff;transform:scale(1.04)}",
      ".f5lm-close svg{width:18px;height:18px;flex-shrink:0}",
      "@media (max-width:767px){.f5lm-close{top:10px;right:10px}}",
    ].join("");
    document.head.appendChild(s);
  }

  function buildModal(surface) {
    injectStyles();

    var overlay = document.createElement("div");
    overlay.className = "f5lm-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "f5lm-title");

    var apiHint =
      surface === "api"
        ? '模型 ID：<code>claude-fable-5</code> · 已在模型广场上架'
        : "聊天模型列表中搜索「Claude Fable 5」即可选用";

    overlay.innerHTML =
      '<div class="f5lm-card">' +
      '  <div class="f5lm-grid">' +
      '    <div class="f5lm-panel">' +
      '      <div style="display:flex;flex-direction:column;gap:14px">' +
      '        <span class="f5lm-badge">全新上线</span>' +
      '        <h1 class="f5lm-title" id="f5lm-title">Claude Fable 5<br>有史以来最强大的 Claude 模型</h1>' +
      '        <p class="f5lm-lead">长程推理、复杂任务与多轮协作一气呵成，更少来回确认。升级付费套餐即可抢先使用。</p>' +
      '        <div class="f5lm-note"><strong>付费套餐专属</strong>' +
      apiHint +
      " · VIP 档计费，与 Opus 4.8 同档倍率。</div>" +
      "      </div>" +
      '      <div class="f5lm-actions">' +
      '        <button type="button" class="f5lm-btn f5lm-btn--primary" data-f5lm-action="upgrade">升级以使用</button>' +
      '        <button type="button" class="f5lm-btn f5lm-btn--secondary" data-f5lm-action="later">稍后再说</button>' +
      "      </div>" +
      "    </div>" +
      '    <div class="f5lm-media">' +
      '      <video class="f5lm-video" autoplay loop muted playsinline aria-hidden="true">' +
      '        <source src="' +
      escapeAttr(VIDEO_SRC) +
      '" type="video/mp4">' +
      "      </video>" +
      "    </div>" +
      "  </div>" +
      '  <button type="button" class="f5lm-close" aria-label="关闭">' +
      '    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M15.147 4.146a.5.5 0 0 1 .707.707L10.707 10l5.147 5.147a.5.5 0 0 1-.63.771l-.078-.064L10 10.707l-5.146 5.147a.5.5 0 0 1-.708-.707L9.293 10 4.146 4.853a.5.5 0 0 1 .708-.707L10 9.293z"></path></svg>' +
      "  </button>" +
      "</div>";

    return overlay;
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function closeModal(overlay, surface) {
    overlay.classList.remove("f5lm-open");
    markSeen(surface);
    window.setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 280);
  }

  function showModal() {
    if (isKilled()) return;
    var surface = detectSurface();
    if (isSeen(surface)) return;

    var overlay = buildModal(surface);
    document.body.appendChild(overlay);

    function dismiss() {
      closeModal(overlay, surface);
    }

    overlay.querySelector(".f5lm-close").addEventListener("click", dismiss);
    overlay.querySelector('[data-f5lm-action="later"]').addEventListener("click", dismiss);
    overlay.querySelector('[data-f5lm-action="upgrade"]').addEventListener("click", function () {
      markSeen(surface);
      window.location.href = PRICING_URL;
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener(
      "keydown",
      function onKey(e) {
        if (e.key === "Escape") {
          document.removeEventListener("keydown", onKey);
          dismiss();
        }
      },
      { once: false }
    );

    requestAnimationFrame(function () {
      overlay.classList.add("f5lm-open");
      var vid = overlay.querySelector("video");
      if (vid && vid.play) vid.play().catch(function () {});
    });
  }

  function schedule() {
    window.setTimeout(showModal, SHOW_DELAY_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule, { once: true });
  } else {
    schedule();
  }
})();
