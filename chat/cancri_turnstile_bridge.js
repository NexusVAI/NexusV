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

  var state = {
    widgetId: null,
    mount: null,
    token: "",
    tokenAt: 0,
    rendering: false,
    waiters: [], // [{resolve, timeoutId}]
  };

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

  // ---- 隐形挂件挂载点（离屏、零占位） ----------------------------------
  function ensureMount() {
    if (state.mount && document.body && document.body.contains(state.mount)) return state.mount;
    var m = document.getElementById("cancriTurnstileBridgeMount");
    if (!m) {
      m = document.createElement("div");
      m.id = "cancriTurnstileBridgeMount";
      // 离屏但可渲染（display:none 会让部分挑战无法初始化）。
      m.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;width:300px;height:65px;overflow:hidden;";
      (document.body || document.documentElement).appendChild(m);
    }
    state.mount = m;
    return m;
  }

  function drainWaiters(token) {
    while (state.waiters.length > 0) {
      var w = state.waiters.shift();
      try { clearTimeout(w.timeoutId); } catch (_e) {}
      try { w.resolve(token); } catch (_e) {}
    }
  }

  function resetWidget() {
    try {
      if (state.widgetId !== null && window.turnstile && window.turnstile.reset) {
        window.turnstile.reset(state.widgetId);
      }
    } catch (_e) {}
  }

  function renderWidget() {
    if (!SITE_KEY) return false;
    if (typeof window === "undefined" || !window.turnstile) return false;
    if (state.widgetId !== null || state.rendering) return true;
    var mount = ensureMount();
    if (!mount) return false;
    state.rendering = true;

    var doRender = function () {
      try {
        var id = window.turnstile.render(mount, {
          sitekey: SITE_KEY,
          appearance: "interaction-only", // 正常用户完全无感；仅可疑流量才显示
          execution: "render",
          size: "normal",
          theme: "auto",
          retry: "auto",
          "refresh-expired": "auto",
          callback: function (token) {
            token = token || "";
            if (!token) return;
            if (state.waiters.length > 0) {
              // 有人在等：直接派发（token 单次使用），并重置预取下一枚
              drainWaiters(token);
              resetWidget();
            } else {
              // 无人等待（如 prerender 阶段自动解出）：缓存起来，供随后的
              // getToken 直接取用；切勿丢弃，否则挂件转入空闲、getToken 会空等超时。
              state.token = token;
              state.tokenAt = Date.now();
            }
          },
          "error-callback": function () { drainWaiters(""); },
          "expired-callback": function () { state.token = ""; state.tokenAt = 0; resetWidget(); },
          "timeout-callback": function () { state.token = ""; state.tokenAt = 0; resetWidget(); },
        });
        state.widgetId = id;
      } catch (_e) {
        drainWaiters("");
      } finally {
        state.rendering = false;
      }
    };

    if (typeof window.turnstile.ready === "function") window.turnstile.ready(doRender);
    else doRender();
    return true;
  }

  function prerender() {
    waitForApi(API_WAIT_MS).then(function () { try { renderWidget(); } catch (_e) {} }).catch(function () {});
  }

  // 返回 Promise<string>：拿到 token（或超时/失败时空串）。
  function getToken() {
    return new Promise(function (resolve) {
      if (!SITE_KEY) return resolve("");
      waitForApi(API_WAIT_MS).then(function () {
        // 有新鲜缓存 token → 直接用
        if (state.token && Date.now() - state.tokenAt < TOKEN_TTL_MS) {
          var t = state.token;
          state.token = "";
          state.tokenAt = 0;
          resetWidget();
          return resolve(t);
        }
        if (!renderWidget()) return resolve("");
        // 挂件可能已解过一次而处于空闲：重置以触发一枚新 token（reset 会重跑挑战）。
        resetWidget();
        var waiter = { resolve: resolve, timeoutId: null };
        waiter.timeoutId = setTimeout(function () {
          var i = state.waiters.indexOf(waiter);
          if (i >= 0) state.waiters.splice(i, 1);
          resolve("");
        }, TOKEN_WAIT_MS);
        state.waiters.push(waiter);
      }).catch(function () { resolve(""); });
    });
  }

  function suspend() {
    try {
      if (state.widgetId !== null && window.turnstile && window.turnstile.remove) {
        window.turnstile.remove(state.widgetId);
      }
    } catch (_e) {}
    drainWaiters("");
    state.widgetId = null;
    state.token = "";
    state.tokenAt = 0;
    state.rendering = false;
  }

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
        if (
          method === "POST" &&
          isAuthTokenUrl(url) &&
          init && typeof init.body === "string"
        ) {
          var body = null;
          try { body = JSON.parse(init.body); } catch (_e) { body = null; }
          if (body && typeof body === "object") {
            var meta = body.gotrue_meta_security;
            var hasToken = meta && typeof meta.captcha_token === "string" && meta.captcha_token;
            if (!hasToken) {
              return getTokenBestEffort(INJECT_BUDGET_MS).then(function (tok) {
                if (tok) {
                  body.gotrue_meta_security = { captcha_token: tok };
                  var newInit = {};
                  for (var k in init) { if (Object.prototype.hasOwnProperty.call(init, k)) newInit[k] = init[k]; }
                  newInit.body = JSON.stringify(body);
                  return realFetch(input, newInit);
                }
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
