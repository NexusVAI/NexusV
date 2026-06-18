/**
 * 站内既定维护 · 顶部黄色横条（Supabase 配额警告风格）
 * 插入 chat / API 页面顶部；不阻塞浏览网站内容。
 */
(function () {
  "use strict";

  var STATUS_URL = "https://nexusvai.github.io/ChatAI-status/status.html";
  var RECOVER_AT = "2026年6月19日 13:00";
  var bannerEl = null;

  function injectStyles() {
    if (document.getElementById("cancri-maint-banner-styles")) return;
    var s = document.createElement("style");
    s.id = "cancri-maint-banner-styles";
    s.textContent =
      ".cancri-maint-banner{position:fixed;top:0;left:0;right:0;z-index:10000;display:flex;align-items:center;" +
      "justify-content:center;gap:10px;width:100%;flex:none;padding:10px 44px 10px 16px;" +
      "background:#fffbeb;border-bottom:1px solid #fde68a;color:#92400e;font-size:13px;" +
      "line-height:1.45;text-align:center;box-shadow:0 1px 3px rgba(146,64,14,.08)}" +
      ".cancri-maint-banner__text{margin:0}" +
      ".cancri-maint-banner__link{color:#b45309;font-weight:600;text-decoration:underline;" +
      "text-underline-offset:2px;white-space:nowrap}" +
      ".cancri-maint-banner__link:hover{color:#78350f}" +
      ".cancri-maint-banner__close{position:absolute;right:8px;top:50%;transform:translateY(-50%);" +
      "width:28px;height:28px;border:none;border-radius:6px;background:transparent;" +
      "color:#a16207;font-size:18px;line-height:1;cursor:pointer}" +
      ".cancri-maint-banner__close:hover{background:rgba(146,64,14,.08);color:#78350f}" +
      "html[data-theme=black] .cancri-maint-banner," +
      "html[data-theme=dark] .cancri-maint-banner{background:#422006;border-bottom-color:#854d0e;" +
      "color:#fde68a}" +
      "html[data-theme=black] .cancri-maint-banner__link," +
      "html[data-theme=dark] .cancri-maint-banner__link{color:#fcd34d}" +
      "body.has-cancri-maint-banner{padding-top:var(--cancri-maint-banner-h,0px)}" +
      "body.has-cancri-maint-banner .topbar{top:var(--cancri-maint-banner-h,0px)}" +
      "body.has-cancri-maint-banner.has-topbar{padding-top:calc(var(--cancri-maint-banner-h,0px) + var(--topbar-offset,54px))}" +
      "@media (max-width:900px){body.has-cancri-maint-banner .sidebar{top:var(--cancri-maint-banner-h,0px);" +
      "height:calc(100dvh - var(--cancri-maint-banner-h,0px))}}" +
      "@media (max-width:720px){.cancri-maint-banner{padding:8px 36px 8px 12px;font-size:12px}}" ;
    document.head.appendChild(s);
  }

  function syncHeight() {
    if (!bannerEl) {
      document.documentElement.style.setProperty("--cancri-maint-banner-h", "0px");
      document.body.classList.remove("has-cancri-maint-banner");
      return;
    }
    var h = Math.ceil(bannerEl.getBoundingClientRect().height || bannerEl.offsetHeight || 0);
    document.documentElement.style.setProperty("--cancri-maint-banner-h", h + "px");
    document.body.classList.add("has-cancri-maint-banner");
  }

  function mount() {
    if (document.getElementById("cancri-maint-banner")) return;
    injectStyles();
    var bar = document.createElement("div");
    bar.id = "cancri-maint-banner";
    bar.className = "cancri-maint-banner";
    bar.setAttribute("role", "status");
    bar.innerHTML =
      '<p class="cancri-maint-banner__text">' +
      "站内开始既定维护：你将无权访问任何 API 和在线聊天，但仍可浏览网站内容。" +
      "维护预计于 <strong>" + RECOVER_AT + "</strong> 恢复到预期范围内。" +
      ' <a class="cancri-maint-banner__link" href="' + STATUS_URL + '" target="_blank" rel="noopener">查看我们的维护情况</a>' +
      "</p>" +
      '<button type="button" class="cancri-maint-banner__close" aria-label="关闭维护提示">×</button>';
    document.body.insertBefore(bar, document.body.firstChild);
    bannerEl = bar;
    syncHeight();
    bar.querySelector(".cancri-maint-banner__close").addEventListener("click", function () {
      bar.remove();
      bannerEl = null;
      syncHeight();
    });
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(syncHeight).observe(bar);
    } else {
      window.addEventListener("resize", syncHeight);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
