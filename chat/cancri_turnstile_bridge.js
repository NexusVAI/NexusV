/* global window, document, setTimeout */
/* =====================================================================
 * Server-driven login Turnstile bridge.
 *
 * The browser does not decide whether an IP is overseas or high risk.
 * It sends the first OTP/signup request without a captcha. When the auth
 * service answers 403 { error: "captcha_failed" }, this bridge renders a
 * visible Cloudflare Turnstile widget and requires a fresh token before
 * the next matching request is allowed to leave the page.
 *
 * Load this file before cancri_chat.js.
 * ===================================================================== */
(function () {
  "use strict";

  var SITE_KEY =
    (typeof window !== "undefined" && window.__LOGIN_TURNSTILE_SITE_KEY__) || "";
  var TOKEN_TTL_MS = 4 * 60 * 1000;
  var API_WAIT_MS = 10000;
  var BRIDGE_VERSION = "2026-08-14-server-driven";
  var TURNSTILE_API =
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var REQUIRED_MESSAGE =
    "当前请求需要完成下方 Cloudflare 人机验证。验证通过后，请再次点击“发送验证码”。";

  var state = {
    version: BRIDGE_VERSION,
    challengeRequired: false,
    widgetId: null,
    mountEl: null,
    statusEl: null,
    pendingToken: "",
    tokenIssuedAt: 0,
    rendering: false,
    apiLoading: null,
    lastError: "",
  };

  function captchaHost() {
    return (
      document.getElementById("authCaptchaContainer") ||
      document.getElementById("loginTurnstileContainer")
    );
  }

  function ensureContainer() {
    var host = captchaHost();
    if (!host) {
      host = document.createElement("div");
      host.id = "loginTurnstileContainer";
      var sendBtn = document.getElementById("authSendOtpBtn");
      if (sendBtn && sendBtn.parentNode) {
        sendBtn.parentNode.insertBefore(host, sendBtn);
      } else {
        var step = document.getElementById("authStepEmail");
        if (step) step.appendChild(host);
        else (document.body || document.documentElement).appendChild(host);
      }
    }
    // ⛔ 禁改区（2026-09-05）：必须摘掉 hidden **属性**，光设行内 display 没用。
    // #authCaptchaContainer 在 claude-login-island.html 里是 `<div hidden>`，而那个
    // 文件自带内联 `[hidden]{display:none !important}` —— !important 的作者声明
    // 在层叠里压过行内非 important 声明，所以下面那行 style.display="block" 会被
    // 完全无效化。实测：带 hidden 属性时 computed display 恒为 none，摘掉才变 block。
    //
    // 症状极具误导性：widget **渲染成功**（turnstile.render 正常返回 widgetId、
    // 甚至能拿到 token），后端 403 的文案也照常写进 #authEmailError（它没有 hidden），
    // 于是用户看到的正是「提示要人机验证，但页面上没有验证框」。
    // 只要 captchaHost() 还可能命中一个带 hidden 的宿主，这行就不能删。
    host.removeAttribute("hidden");
    host.style.display = "block";
    host.style.margin = "10px 0 0";
    host.style.minHeight = "0";
    host.style.height = "";
    host.style.overflow = "visible";
    host.style.padding = "";
    host.style.width = "100%";
    return host;
  }

  function collapseContainer() {
    var host = captchaHost();
    if (!host) return;
    // 与 ensureContainer() 的 removeAttribute 成对：不需要挑战时把宿主还原成登录岛
    // 里的初始形态（`<div hidden>`），别让一个空容器留在表单里占位。
    host.setAttribute("hidden", "");
    host.style.display = "none";
    host.style.margin = "0";
    host.style.minHeight = "0";
    host.style.height = "0";
    host.style.overflow = "hidden";
    host.style.padding = "0";
  }

  function setStatus(text, color) {
    var el = state.statusEl;
    if (!el || !document.body.contains(el)) {
      el = document.getElementById("loginTurnstileStatus");
      state.statusEl = el;
    }
    if (!el) return;
    el.textContent = text || "";
    el.style.color = color || "rgba(128,128,128,0.95)";
    el.style.display = text ? "block" : "none";
  }

  function showStatusOnly(text, color) {
    var host = ensureContainer();
    host.innerHTML = "";
    var status = document.createElement("div");
    status.id = "loginTurnstileStatus";
    status.style.cssText =
      "font-size:12px;line-height:1.45;margin:0;text-align:left;display:block;";
    host.appendChild(status);
    state.statusEl = status;
    state.mountEl = null;
    setStatus(text, color);
  }

  function setEmailError(message) {
    var errorEl = document.getElementById("authEmailError");
    if (!errorEl) return;
    errorEl.textContent = message || "";
  }

  function focusChallenge() {
    var host = captchaHost();
    if (!host) return;
    try {
      host.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      try { host.scrollIntoView(); } catch { /* Scrolling is best-effort. */ }
    }
  }

  function waitForApi(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (window.turnstile && typeof window.turnstile.render === "function") {
        resolve();
        return;
      }
      var start = Date.now();
      (function tick() {
        if (window.turnstile && typeof window.turnstile.render === "function") {
          resolve();
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          reject(new Error("turnstile_api_timeout"));
          return;
        }
        setTimeout(tick, 150);
      })();
    });
  }

  function loadApi() {
    if (window.turnstile && typeof window.turnstile.render === "function") {
      return Promise.resolve();
    }
    if (state.apiLoading) return state.apiLoading;

    state.apiLoading = new Promise(function (resolve, reject) {
      var script = document.querySelector('script[src^="' + TURNSTILE_API + '"]');
      var created = false;
      if (!script) {
        script = document.createElement("script");
        script.src = TURNSTILE_API;
        script.async = true;
        script.defer = true;
        script.dataset.turnstileBridge = BRIDGE_VERSION;
        created = true;
      }
      script.addEventListener("error", function () {
        reject(new Error("turnstile_api_load_failed"));
      }, { once: true });
      if (created) document.head.appendChild(script);
      waitForApi(API_WAIT_MS).then(resolve, reject);
    }).catch(function (err) {
      state.apiLoading = null;
      throw err;
    });
    return state.apiLoading;
  }

  function hasFreshToken() {
    if (!state.pendingToken) return false;
    if (Date.now() - state.tokenIssuedAt < TOKEN_TTL_MS) return true;
    state.pendingToken = "";
    state.tokenIssuedAt = 0;
    return false;
  }

  function consumeToken() {
    if (!hasFreshToken()) return "";
    var token = state.pendingToken;
    state.pendingToken = "";
    state.tokenIssuedAt = 0;
    return token;
  }

  function resetWidget() {
    state.pendingToken = "";
    state.tokenIssuedAt = 0;
    try {
      if (
        state.widgetId !== null &&
        window.turnstile &&
        typeof window.turnstile.reset === "function"
      ) {
        window.turnstile.reset(state.widgetId);
      }
    } catch { /* A removed or expired widget has nothing left to reset. */ }
  }

  function renderWidget() {
    if (!state.challengeRequired) return false;
    if (!SITE_KEY) {
      state.lastError = "Cloudflare 人机验证未配置，请联系管理员。";
      showStatusOnly(state.lastError, "#e11d48");
      return false;
    }
    if (!window.turnstile || typeof window.turnstile.render !== "function") {
      return false;
    }
    if (state.widgetId !== null || state.rendering) return true;

    var host = ensureContainer();
    host.innerHTML = "";
    state.rendering = true;

    var status = document.createElement("div");
    status.id = "loginTurnstileStatus";
    status.style.cssText =
      "font-size:12px;line-height:1.45;margin:0 0 8px;text-align:left;display:block;";
    status.textContent = REQUIRED_MESSAGE;
    host.appendChild(status);
    state.statusEl = status;

    var mount = document.createElement("div");
    mount.id = "loginTurnstileMount";
    mount.className = "cancri-turnstile-mount";
    mount.dataset.action = "turnstile-spin-v1";
    mount.style.cssText =
      "min-height:65px;display:flex;justify-content:flex-start;width:100%;";
    host.appendChild(mount);
    state.mountEl = mount;

    try {
      state.widgetId = window.turnstile.render(mount, {
        sitekey: SITE_KEY,
        action: "turnstile-spin-v1",
        appearance: "always",
        execution: "render",
        size: "normal",
        theme: "auto",
        retry: "auto",
        "refresh-expired": "auto",
        callback: function (token) {
          state.pendingToken = token || "";
          state.tokenIssuedAt = Date.now();
          state.lastError = "";
          setStatus("验证已通过，请再次点击“发送验证码”。", "#16a34a");
        },
        "error-callback": function (errorCode) {
          resetWidget();
          state.lastError =
            "Cloudflare 人机验证加载失败（" + String(errorCode || "unknown") + "），请刷新后重试。";
          setStatus(state.lastError, "#e11d48");
          return true;
        },
        "expired-callback": function () {
          resetWidget();
          setStatus("验证已过期，请重新完成 Cloudflare 人机验证。", "#ca8a04");
        },
        "timeout-callback": function () {
          resetWidget();
          setStatus("验证已超时，请重新完成 Cloudflare 人机验证。", "#ca8a04");
        },
      });
      state.rendering = false;
      return true;
    } catch (err) {
      state.rendering = false;
      state.lastError =
        "Cloudflare 人机验证渲染失败：" +
        (err && err.message ? err.message : String(err));
      setStatus(state.lastError, "#e11d48");
      return false;
    }
  }

  function requireChallenge() {
    state.challengeRequired = true;
    ensureContainer();
    setEmailError(REQUIRED_MESSAGE);
    loadApi()
      .then(function () {
        if (state.widgetId !== null) {
          resetWidget();
          setStatus(REQUIRED_MESSAGE, "rgba(128,128,128,0.95)");
        } else {
          renderWidget();
        }
      })
      .catch(function () {
        state.lastError =
          "Cloudflare 人机验证组件加载失败，请关闭拦截扩展或更换网络后刷新重试。";
        showStatusOnly(state.lastError, "#e11d48");
      });
  }

  function suspend() {
    try {
      if (
        state.widgetId !== null &&
        window.turnstile &&
        typeof window.turnstile.remove === "function"
      ) {
        window.turnstile.remove(state.widgetId);
      }
    } catch { /* The host is cleared below even if the widget is already gone. */ }
    state.challengeRequired = false;
    state.widgetId = null;
    state.mountEl = null;
    state.statusEl = null;
    state.pendingToken = "";
    state.tokenIssuedAt = 0;
    state.rendering = false;
    state.lastError = "";
    var host = captchaHost();
    if (host) host.innerHTML = "";
    collapseContainer();
  }

  function installCompatibilityApis() {
    window.NexusAuthCaptcha = {
      init: function () {
        if (state.challengeRequired) requireChallenge();
        else collapseContainer();
      },
      validate: function () {
        return true;
      },
      getFailMessage: function () {
        return state.lastError || REQUIRED_MESSAGE;
      },
      refresh: function () {
        if (state.challengeRequired) requireChallenge();
      },
      clearInput: resetWidget,
      focusInput: focusChallenge,
      getCode: function () {
        return hasFreshToken() ? "ok" : "";
      },
    };

    window.NexusLoginCaptcha = {
      prerender: function () {
        if (state.challengeRequired) requireChallenge();
      },
      getToken: function () {
        return Promise.resolve(consumeToken());
      },
      suspend: suspend,
      _state: state,
    };
  }

  var AUTH_TOKEN_PATHS = ["/auth/v1/otp", "/auth/v1/signup"];
  function isAuthTokenUrl(url) {
    var value = String(url || "");
    for (var i = 0; i < AUTH_TOKEN_PATHS.length; i++) {
      if (value.indexOf(AUTH_TOKEN_PATHS[i]) !== -1) return true;
    }
    return false;
  }

  function isCaptchaFailure(response) {
    if (!response || response.status !== 403 || typeof response.clone !== "function") {
      return Promise.resolve(false);
    }
    return response.clone().json().then(
      function (payload) {
        return !!payload &&
          (payload.error === "captcha_failed" || payload.code === "captcha_failed");
      },
      function () { return false; }
    );
  }

  function withCaptchaToken(body, token) {
    var meta = {};
    var existing = body.gotrue_meta_security;
    if (existing && typeof existing === "object") {
      for (var key in existing) {
        if (Object.prototype.hasOwnProperty.call(existing, key)) {
          meta[key] = existing[key];
        }
      }
    }
    meta.captcha_token = token;
    body.gotrue_meta_security = meta;
  }

  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  if (realFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var method = String(
        (init && init.method) || (input && input.method) || "GET"
      ).toUpperCase();
      var isAuthRequest = method === "POST" && isAuthTokenUrl(url);
      var usedToken = false;
      var nextInput = input;
      var nextInit = init;

      if (isAuthRequest && init && typeof init.body === "string" && hasFreshToken()) {
        try {
          var body = JSON.parse(init.body);
          if (body && typeof body === "object") {
            var token = consumeToken();
            if (token) {
              withCaptchaToken(body, token);
              nextInit = {};
              for (var key in init) {
                if (Object.prototype.hasOwnProperty.call(init, key)) {
                  nextInit[key] = init[key];
                }
              }
              nextInit.body = JSON.stringify(body);
              nextInput = typeof input === "string" ? input : url;
              usedToken = true;
            }
          }
        } catch {
          nextInput = input;
          nextInit = init;
        }
      }

      var request = realFetch(nextInput, nextInit);
      if (!isAuthRequest) return request;
      return request.then(function (response) {
        return isCaptchaFailure(response).then(function (failed) {
          if (failed) {
            requireChallenge();
            setTimeout(function () { setEmailError(REQUIRED_MESSAGE); }, 0);
          } else if (usedToken && response && response.ok) {
            suspend();
          }
          return response;
        });
      });
    };
  }

  function guardOtpClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var button = target.closest("#authSendOtpBtn");
    if (!button || !state.challengeRequired || hasFreshToken()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setEmailError(state.lastError || REQUIRED_MESSAGE);
    focusChallenge();
  }

  installCompatibilityApis();
  if (typeof document !== "undefined") {
    document.addEventListener("click", guardOtpClick, true);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        installCompatibilityApis();
        if (!state.challengeRequired) collapseContainer();
      });
    } else {
      collapseContainer();
    }
  }
})();
