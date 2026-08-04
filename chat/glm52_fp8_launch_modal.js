/* GLM-5.2 FP8 限时上线公告：chat 与 API 首页各展示一次，2026-08-15 结束。
   END_AT 必须与后端访问期同日：cf-gateway/src/shared-catalog.ts 与
   cf-modelscope-proxy/src/index.ts 的 MODEL_ACCESS_END_MS。 */
(function () {
  "use strict";

  var END_AT = new Date("2026-08-15T23:59:59+08:00").getTime();
  var SEEN_KEY = "nexusv_glm52_fp8_launch_v1";
  var MODEL_ID = "glm-5.2-fp8";

  function surface() {
    return /\/chat\/api\/(?:index\.html)?$/i.test(window.location.pathname || "") ? "api" : "chat";
  }

  function hasSeen(name) {
    try {
      return (localStorage.getItem(SEEN_KEY) || "").split(",").indexOf(name) >= 0;
    } catch (_) {
      return false;
    }
  }

  function markSeen(name) {
    try {
      var seen = (localStorage.getItem(SEEN_KEY) || "").split(",").filter(Boolean);
      if (seen.indexOf(name) < 0) seen.push(name);
      localStorage.setItem(SEEN_KEY, seen.join(","));
    } catch (_) {}
  }

  function assetUrl() {
    return surface() === "api"
      ? "Logo/9156717884b690b7cc98e5fceb253ea1.png"
      : "../Logo/9156717884b690b7cc98e5fceb253ea1.png";
  }

  function modelsUrl() {
    return surface() === "api"
      ? "chat/api_models.html#model-" + MODEL_ID
      : "./api_models.html#model-" + MODEL_ID;
  }

  function contactUrl() {
    return surface() === "api" ? "chat/api_apply.html" : "./api_apply.html";
  }

  function close(overlay) {
    overlay.classList.remove("glm52-launch--open");
    window.setTimeout(function () { overlay.remove(); }, 220);
  }

  function show() {
    var name = surface();
    if (Date.now() > END_AT || hasSeen(name)) return;
    markSeen(name);

    var style = document.createElement("style");
    style.textContent =
      ".glm52-launch{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:20px;background:rgba(8,10,16,.72);backdrop-filter:blur(10px);opacity:0;transition:opacity .22s ease}" +
      ".glm52-launch--open{opacity:1}.glm52-launch__card{position:relative;width:min(920px,100%);max-height:min(720px,calc(100vh - 40px));overflow:auto;display:grid;grid-template-columns:minmax(280px,1.08fr) minmax(300px,.92fr);border:1px solid rgba(255,255,255,.14);border-radius:24px;background:#111319;color:#f7f7f5;box-shadow:0 30px 90px rgba(0,0,0,.5)}" +
      ".glm52-launch__media{min-height:430px;background:#090b10}.glm52-launch__media img{display:block;width:100%;height:100%;object-fit:cover}" +
      ".glm52-launch__body{display:flex;flex-direction:column;justify-content:center;padding:48px 42px}.glm52-launch__eyebrow{margin:0 0 14px;color:#a8b3ff;font:600 13px/1.4 system-ui;letter-spacing:.12em;text-transform:uppercase}" +
      ".glm52-launch h2{margin:0 0 20px;font:650 clamp(28px,4vw,43px)/1.12 system-ui;letter-spacing:-.035em}.glm52-launch__copy{margin:0 0 16px;color:#d1d3da;font:400 16px/1.75 system-ui}" +
      ".glm52-launch__note{margin:0 0 30px;color:#aeb1bb;font:400 13px/1.65 system-ui}.glm52-launch a{color:#c9d0ff}.glm52-launch__cta{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 24px;border-radius:999px;background:#f5f5f0;color:#111319!important;text-decoration:none;font:650 15px/1 system-ui;transition:transform .15s ease,background .15s ease}.glm52-launch__cta:hover{transform:translateY(-1px);background:#fff}" +
      ".glm52-launch__close{position:absolute;top:14px;right:14px;z-index:2;width:38px;height:38px;border:1px solid rgba(255,255,255,.14);border-radius:50%;background:rgba(10,12,17,.62);color:#fff;font:400 24px/1 system-ui;cursor:pointer}" +
      "@media(max-width:720px){.glm52-launch{padding:12px}.glm52-launch__card{grid-template-columns:1fr;max-height:calc(100vh - 24px);border-radius:18px}.glm52-launch__media{min-height:220px;max-height:38vh}.glm52-launch__body{padding:30px 24px 28px}.glm52-launch h2{font-size:30px}.glm52-launch__copy{font-size:15px}}";
    document.head.appendChild(style);

    var overlay = document.createElement("div");
    overlay.className = "glm52-launch";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "glm52-launch-title");
    overlay.innerHTML =
      '<section class="glm52-launch__card">' +
        '<button class="glm52-launch__close" type="button" aria-label="关闭">×</button>' +
        '<div class="glm52-launch__media"><img src="' + assetUrl() + '" alt="GLM-5.2 FP8" /></div>' +
        '<div class="glm52-launch__body">' +
          '<p class="glm52-launch__eyebrow">NexusV AI · 新模型上线</p>' +
          '<h2 id="glm52-launch-title">部署在我们硬件上的<br />GLM-5.2 FP8 版本<sup>1</sup></h2>' +
          '<p class="glm52-launch__copy">即刻体验部署在 NexusV AI 硬件上的 GLM-5.2 FP8。</p>' +
          '<p class="glm52-launch__note"><sup>1</sup> 在使用前，必须遵守我们的防滥用政策。注册后即可直接创建 API Key；有问题请到 <a href="' + contactUrl() + '">联系我们</a>提工单，或者只在 <a href="' + (name === "api" ? "chat/index.html" : "./index.html") + '">网页对话</a>中使用。</p>' +
          '<a class="glm52-launch__cta" href="' + modelsUrl() + '">即刻使用 →</a>' +
        '</div>' +
      '</section>';

    document.body.appendChild(overlay);
    var closeButton = overlay.querySelector(".glm52-launch__close");
    closeButton.addEventListener("click", function () { close(overlay); });
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close(overlay);
    });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key !== "Escape" || !document.body.contains(overlay)) return;
      document.removeEventListener("keydown", onKey);
      close(overlay);
    });
    window.requestAnimationFrame(function () { overlay.classList.add("glm52-launch--open"); });
    closeButton.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", show, { once: true });
  } else {
    show();
  }
})();
