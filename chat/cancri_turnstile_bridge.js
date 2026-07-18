/* =====================================================================
 * Turnstile bridge (2026-07-11, 审计/人机验证)
 *
 * 目的：把登录页原来的「画布填数字」验证码（纯前端、服务端从不校验、脚本
 * 可绕开）换成 Cloudflare Turnstile 隐形（interaction-only）验证，并把
 * Turnstile token 送到服务端做真校验——但**不重建 App 主 bundle**
 * (cancri_chat.js)，全部用这一支独立脚本外挂完成，方便网页手动提交。
 *
 * 做三件事：
 *   1) 提供一个「隐形无操作」的 window.NexusAuthCaptcha 兼容 shim：bundle
 *      的「发送验证码 / 密码登录」按钮会调用 NexusAuthCaptcha.validate()，
 *      这里恒返回 true（不再弹画布），并隐藏旧的 #authCaptchaContainer。
 *      真正的反自动化 = 下面注入的 Turnstile（服务端校验）+ 服务端每 IP 限流。
 *   2) 渲染一个隐形 Turnstile 挂件（appearance:'interaction-only'），正常
 *      用户无感、无弹窗；仅当 Cloudflare 判定可疑时才出现交互挑战。
 *      同时对外暴露 window.NexusLoginCaptcha（prerender/getToken/suspend），
 *      兼容 bundle 里对它的可选调用。
 *   3) 包一层 window.fetch：对 POST /auth/v1/otp 和 /auth/v1/signup，把
 *      Turnstile token 注入 body.gotrue_meta_security.captcha_token（这正是
 *      supabase-js 传 captchaToken 时用的字段）。best-effort：挂件被墙/慢时
 *      绝不卡住登录——短预算后无 token 发出，交由服务端决定（服务端 fail-open
 *      基础设施抖动、但 token 无效/缺失时按开关拒绝；每 IP 限流始终兜底）。
 *
 * 加载顺序：必须在 cancri_chat.js 之前（defer 按出现顺序执行），这样
 *   - NexusAuthCaptcha shim 在 bundle 运行时已存在；
 *   - window.fetch 覆盖在 supabase.createClient()（首次登录时才跑）之前装好，
 *     确保 supabase-js resolveFetch 捕获到的是包装后的 fetch。
 * ===================================================================== */
(function () {
  "use strict";

  var SITE_KEY =
    (typeof window !== "undefined" && window.__LOGIN_TURNSTILE_SITE_KEY__) || "";
  var TOKEN_TTL_MS = 4 * 60 * 1000; // CF token ~5min，保守当 4min 内新鲜
  var API_WAIT_MS = 8000; // 等 window.turnstile 出现的上限
  var TOKEN_WAIT_MS = 20000; // getToken 排队等待挂件回调的上限
  var INJECT_BUDGET_MS = 8000; // fetch 注入时等 token 的预算（超时则裸发）

  var BRIDGE_VERSION = "2026-07-11c-directrender";
  var state = { version: BRIDGE_VERSION };

  // ---- window.turnstile 就绪等待 ---------------------------------------
  function waitForApi(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof window !== "undefined" && window.turnstile) return resolve();
      var start = Date.now();
      (function tick() {
        if (typeof window !== "undefined" && window.turnstile) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error("turnstile_api_timeout"));
        setTimeout(tick, 150);
      })();
    });
  }

  // ---- 预热：仅确保 api.js 就绪，不预渲染（避免"预热 token 被丢弃/挂件转空闲"）---
  function prerender() {
    waitForApi(API_WAIT_MS).catch(function () {});
  }

  // 返回 Promise<string>：拿到 token（或超时/失败时空串）。
  //
  // 采用"每次调用 → 全新渲染一枚挂件 → 回调拿到一枚 token → 用完即移除"的模式。
  // 这是已验证可靠的原语（单次 render 必触发一次 callback 返回 token）；不做跨调用
  // 复用/reset/缓存，避免 interaction-only 下 reset 不重跑、或预热 token 被丢弃导致
  // 挂件转入空闲、后续 getToken 空等超时的坑。
  //
  // 挂件上屏（fixed 右下角）而非离屏：interaction-only 下正常用户完全不可见（自动过、
  // 尺寸塌缩为 0）；仅当 Cloudflare 判定需要交互时才在右下角显示一个可点的小挑战框
  // ——离屏的话该挑战无法被用户完成，会把可疑真人也挡死。
  function getToken() {
    return new Promise(function (resolve) {
      if (!SITE_KEY) return resolve("");
      waitForApi(API_WAIT_MS)
        .then(function () {
          if (!window.turnstile || !window.turnstile.render) return resolve("");

          var mount = document.createElement("div");
          mount.className = "cancri-turnstile-mount";
          mount.style.cssText =
            "position:fixed;right:12px;bottom:12px;z-index:2147483647;width:300px;max-width:90vw;";
          (document.body || document.documentElement).appendChild(mount);

          var done = false;
          var wid = null;
          var finish = function (tok) {
            if (done) return;
            done = true;
            try { if (wid !== null && window.turnstile.remove) window.turnstile.remove(wid); } catch (_e) {}
            try { if (mount.parentNode) mount.parentNode.removeChild(mount); } catch (_e) {}
            resolve(tok || "");
          };
          var timer = setTimeout(function () { finish(""); }, TOKEN_WAIT_MS);

          var doRender = function () {
            try {
              wid = window.turnstile.render(mount, {
                sitekey: SITE_KEY,
                appearance: "interaction-only",
                execution: "render",
                size: "normal",
                theme: "auto",
                retry: "auto",
                "refresh-expired": "auto",
                callback: function (tok) { clearTimeout(timer); finish(tok); },
                "error-callback": function () { clearTimeout(timer); finish(""); return true; },
                "timeout-callback": function () { clearTimeout(timer); finish(""); },
              });
            } catch (_e) { clearTimeout(timer); finish(""); }
          };

          // 直接渲染，不经 turnstile.ready()：在 render=explicit 模式下经 ready() 包一层
          // 会触发「ready() would break」告警且回调不执行，导致挂件根本不渲染。
          // waitForApi 已确保 window.turnstile.render 存在，直接调用即可（A/B 实测可靠）。
          doRender();
        })
        .catch(function () { resolve(""); });
    });
  }

  // 无持久挂件需要清理（每次 getToken 的挂件自我移除）。保留接口兼容 bundle 的可选调用。
  function suspend() {}

  // ---- (1) 隐形 NexusAuthCaptcha 兼容 shim -----------------------------
  window.NexusAuthCaptcha = {
    init: function () {
      var c = document.getElementById("authCaptchaContainer");
      if (c) c.style.display = "none";
      prerender(); // 预热隐形挂件，点「发送」时 token 基本已就绪
    },
    validate: function () { return true; }, // 隐形：真校验在服务端（Turnstile）
    refresh: function () {},
    clearInput: function () {},
    focusInput: function () {},
    getCode: function () { return ""; },
  };

  // ---- (2) NexusLoginCaptcha 兼容（bundle 里有可选调用） ----------------
  window.NexusLoginCaptcha = {
    prerender: prerender,
    getToken: getToken,
    suspend: suspend,
    _state: state,
  };

  // ---- (3) fetch 拦截：给 signup / otp 注入 Turnstile token -------------
  var AUTH_TOKEN_PATHS = ["/auth/v1/otp", "/auth/v1/signup"];
  function isAuthTokenUrl(url) {
    var u = String(url || "");
    for (var i = 0; i < AUTH_TOKEN_PATHS.length; i++) {
      if (u.indexOf(AUTH_TOKEN_PATHS[i]) !== -1) return true;
    }
    return false;
  }

  var realFetch = (typeof window !== "undefined" && window.fetch) ? window.fetch.bind(window) : null;
  if (realFetch) {
    window.fetch = function (input, init) {
      try {
        var url = (typeof input === "string") ? input : (input && input.url) || "";
        var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        // 兼容两种调用：fetch(url, {body}) 与 fetch(new Request(url,{body}))。
        var bodyStr = null;
        if (init && typeof init.body === "string") bodyStr = init.body;
        else if (typeof input !== "string" && input && typeof input.clone === "function") {
          // Request 体只能读一次；这里不主动 clone 读（异步），仅在 init 有 body 时注入。
          bodyStr = null;
        }
        if (method === "POST" && isAuthTokenUrl(url) && bodyStr) {
          var body = null;
          try { body = JSON.parse(bodyStr); } catch (_e) { body = null; }
          if (body && typeof body === "object") {
            var meta = body.gotrue_meta_security;
            var hasToken = meta && typeof meta.captcha_token === "string" && meta.captcha_token;
            if (!hasToken) {
              return getTokenBestEffort(INJECT_BUDGET_MS).then(function (tok) {
                if (tok) {
                  body.gotrue_meta_security = { captcha_token: tok };
                  var newInit = {};
                  if (init) {
                    for (var k in init) { if (Object.prototype.hasOwnProperty.call(init, k)) newInit[k] = init[k]; }
                  }
                  newInit.method = "POST";
                  newInit.body = JSON.stringify(body);
                  try {
                    console.info("[turnstile bridge] injected captcha_token into", url, "len=" + tok.length);
                  } catch (_e) {}
                  return realFetch(typeof input === "string" ? input : url, newInit);
                }
                try {
                  console.warn("[turnstile bridge] no captcha token within budget; sending bare auth request");
                } catch (_e) {}
                return realFetch(input, init);
              });
            }
          }
        }
      } catch (_e) { /* 任何异常都回退到原始 fetch，绝不打断请求 */ }
      return realFetch(input, init);
    };
  }

  function getTokenBestEffort(budgetMs) {
    return new Promise(function (resolve) {
      var done = false;
      var fin = function (v) { if (!done) { done = true; resolve(v || ""); } };
      var t = setTimeout(function () { fin(""); }, budgetMs);
      getToken().then(function (tok) { clearTimeout(t); fin(tok || ""); }, function () { clearTimeout(t); fin(""); });
    });
  }

  // 页面加载后预热一次（隐形，无 UI 影响）。
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { prerender(); });
    } else {
      prerender();
    }
  }
})();
