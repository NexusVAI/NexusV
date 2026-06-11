/* Cancri · 冠军预测活动 · 主站顶部 banner */
(function () {
  "use strict";

  var ACTIVITY_URL = "./champion_predict.html";
  var SESSION_KEY = "cancri_cp_banner_session_off";
  var KILL_KEY = "cancri_cp_banner_off";
  var END_UTC = Date.UTC(2026, 6, 19, 16, 0, 0); // 7/20 00:00 UTC+8

  function isKilled() {
    try {
      if (window.location.search.indexOf("nochampion=1") >= 0) {
        localStorage.setItem(KILL_KEY, "1");
        return true;
      }
      if (localStorage.getItem(KILL_KEY) === "1") return true;
      if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
    } catch (_) {}
    return false;
  }

  function isActive() {
    return Date.now() < END_UTC;
  }

  function injectStyles() {
    if (document.getElementById("cp-banner-styles")) return;
    var s = document.createElement("style");
    s.id = "cp-banner-styles";
    s.textContent =
      ".cp-moon-banner{position:relative;z-index:80;display:flex;align-items:stretch;width:100%;" +
      "background:linear-gradient(95deg,#0d0d0d 0%,#1a1a1a 55%,#252525 100%);" +
      "color:#fff;font-size:13px;line-height:1.4;border-bottom:1px solid rgba(255,255,255,.1);" +
      "font-family:'Inter',system-ui,sans-serif}" +
      ".cp-moon-banner__inner{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;" +
      "padding:8px 16px;text-decoration:none;color:inherit;flex-wrap:wrap;transition:filter .15s}" +
      ".cp-moon-banner__inner:hover{filter:brightness(1.08)}" +
      ".cp-moon-banner__title strong{color:#f5c842;font-weight:700}" +
      ".cp-moon-banner__sub{color:rgba(255,255,255,.72);font-size:12px}" +
      ".cp-moon-banner__arrow{color:#f5c842;font-weight:700}" +
      ".cp-moon-banner__close{flex:none;width:32px;border:none;background:transparent;" +
      "color:rgba(255,255,255,.55);font-size:16px;cursor:pointer}" +
      ".cp-moon-banner__close:hover{color:#fff;background:rgba(255,255,255,.08)}" +
      "@media (max-width:720px){.cp-moon-banner__sub{display:none}}";
    document.head.appendChild(s);
  }

  function show() {
    if (isKilled() || !isActive()) return;
    injectStyles();

    var bar = document.createElement("div");
    bar.className = "cp-moon-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      '<a class="cp-moon-banner__inner" href="' +
      ACTIVITY_URL +
      '">' +
      '<span class="cp-moon-banner__title"><strong>⚽ 冠军预测</strong> 预测冠军队 · 瓜分 Token 奖励池</span>' +
      '<span class="cp-moon-banner__sub">畅聊世界杯 · AI 帮你分析夺冠热门</span>' +
      '<span class="cp-moon-banner__arrow">→</span>' +
      "</a>" +
      '<button class="cp-moon-banner__close" type="button" aria-label="关闭">×</button>';

    document.body.insertBefore(bar, document.body.firstChild);

    var closeBtn = bar.querySelector(".cp-moon-banner__close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        try {
          sessionStorage.setItem(SESSION_KEY, "1");
        } catch (_) {}
        if (bar.parentNode) bar.parentNode.removeChild(bar);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", show);
  } else {
    show();
  }
})();
