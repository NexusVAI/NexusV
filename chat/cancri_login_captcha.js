/* =====================================================================
 * Login Turnstile module — Cloudflare Turnstile widget management for
 * Supabase Auth captcha (`signInWithOtp({ captchaToken })`).
 *
 * This file was extracted from chat/cancri_chat.js as the first step of
 * splitting that 365KB monolith into small, focused modules.
 *
 * Exposes a single global: `window.NexusLoginCaptcha`
 *   - prerender()  — start rendering the widget early so a token is
 *                    ready by the time the user clicks "发送验证码".
 *                    Idempotent; safe to call multiple times.
 *   - getToken()   — Promise<string> that resolves with a Cloudflare
 *                    Turnstile token. Uses cached token if fresh, else
 *                    queues until the widget callback fires.
 *
 * Why a singleton state machine instead of one-shot per click:
 *   1) Older deployed HTML may lack <div id="loginTurnstileContainer">.
 *      The legacy code fell back to `document.body.appendChild(...)`
 *      which positioned the widget BEHIND the auth overlay — the
 *      widget rendered but the user never saw or interacted with it,
 *      and the call timed out after 60s every single time.
 *      We now inject the container INSIDE the auth form (right before
 *      #authSendOtpBtn) so the widget is always visible.
 *   2) For Managed/Non-Interactive widgets the user may need a moment
 *      of dwell time. Pre-rendering when the auth overlay opens means
 *      the token is usually already issued by click time.
 *   3) For Invisible widgets, pre-render + execute() fires the token
 *      callback immediately; cached for the next sendOtp call.
 * ===================================================================== */
(function () {
  "use strict";

  // Cloudflare Turnstile tokens are valid for ~5 min upstream; treat as
  // fresh for 4 min so we have safety margin.
  var LOGIN_CAPTCHA_TOKEN_TTL_MS = 4 * 60 * 1000;

  var state = {
    widgetId: null,
    container: null,
    pendingToken: null,
    tokenIssuedAt: 0,    // ms epoch
    rendering: false,    // render() in flight
    waiters: [],         // [{ resolve, reject, timeoutId }]
    lastError: null,
  };

  function errorMessage(err) {
    var code = (typeof err === "string" || typeof err === "number") ? String(err) : "";
    var hint = code === "110200"
      ? "Cloudflare 110200：当前域名未在 Turnstile widget 的 Hostname 列表中。"
      : code === "110100" || code === "110110" || code === "400020"
        ? "Cloudflare " + code + "：site key 无效。"
        : code === "400070"
          ? "Cloudflare 400070：该 site key 已在 dashboard 中被禁用。"
          : "";
    return code
      ? "人机验证失败 (Cloudflare 错误 " + code + ")" + (hint ? "\n" + hint : "")
      : "人机验证失败，请重试。";
  }

  // Find or create a visible container for the login Turnstile widget.
  // Order of preference:
  //   1. #loginTurnstileContainer if already in the DOM (new HTML)
  //   2. Insert before #authSendOtpBtn (works with both old and new HTML)
  //   3. Append at the end of #authStepEmail
  //   4. Last-resort centered fixed-position overlay above everything
  function ensureContainer() {
    var container = document.getElementById("loginTurnstileContainer");
    if (container) return container;

    container = document.createElement("div");
    container.id = "loginTurnstileContainer";
    container.style.margin = "8px 0";
    container.style.minHeight = "65px";
    container.style.display = "flex";
    container.style.justifyContent = "center";

    var sendBtn = document.getElementById("authSendOtpBtn");
    if (sendBtn && sendBtn.parentNode) {
      sendBtn.parentNode.insertBefore(container, sendBtn);
      return container;
    }
    var stepEmail = document.getElementById("authStepEmail");
    if (stepEmail) {
      stepEmail.appendChild(container);
      return container;
    }
    // Last-resort: float above everything so it's never hidden by the overlay.
    container.style.position = "fixed";
    container.style.top = "50%";
    container.style.left = "50%";
    container.style.transform = "translate(-50%, -50%)";
    container.style.zIndex = "999999";
    container.style.background = "#fff";
    container.style.padding = "12px";
    container.style.borderRadius = "8px";
    container.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)";
    document.body.appendChild(container);
    return container;
  }

  // Wait until window.turnstile is available (script loads async). Resolves
  // when ready, rejects after `timeoutMs` of waiting.
  function waitForApi(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof window !== "undefined" && window.turnstile) return resolve();
      var start = Date.now();
      var tick = function () {
        if (typeof window !== "undefined" && window.turnstile) return resolve();
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(
            "人机验证脚本加载失败，请检查网络或关闭广告拦截器后刷新页面。"
          ));
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function failAllWaiters(message) {
    while (state.waiters.length > 0) {
      var w = state.waiters.shift();
      try { clearTimeout(w.timeoutId); } catch (_e) {}
      try { w.reject(new Error(message)); } catch (_e) {}
    }
  }

  // Render (or re-render) the login Turnstile widget. Idempotent: if a
  // widget is already mounted and not stale, this is a no-op.
  function renderWidget() {
    var siteKey = (typeof window !== "undefined" && window.__LOGIN_TURNSTILE_SITE_KEY__) || "";
    if (!siteKey) return false;
    if (typeof window === "undefined" || !window.turnstile) return false;
    if (state.widgetId !== null || state.rendering) return true;

    var container = ensureContainer();
    if (!container) return false;
    if (container.style.display === "none" || !container.style.display) {
      container.style.display = "flex";
    }
    container.innerHTML = "";
    state.container = container;
    state.rendering = true;

    var onCallback = function (token) {
      state.pendingToken = token || "";
      state.tokenIssuedAt = Date.now();
      state.lastError = null;
      // Drain queued waiters: first one wins the token (Turnstile tokens are
      // single-use). We then reset() the widget so subsequent waiters get
      // a freshly-issued token.
      while (state.waiters.length > 0) {
        var w = state.waiters.shift();
        try { clearTimeout(w.timeoutId); } catch (_e) {}
        if (state.pendingToken) {
          var t = state.pendingToken;
          state.pendingToken = "";
          state.tokenIssuedAt = 0;
          try { console.info("[login turnstile] token issued, len=" + t.length); } catch (_e) {}
          try { w.resolve(t); } catch (_e) {}
          try {
            if (state.widgetId !== null && window.turnstile && window.turnstile.reset) {
              window.turnstile.reset(state.widgetId);
            }
          } catch (_e) {}
          return; // Reset will produce next callback for next waiter.
        }
      }
    };

    var onError = function (err) {
      try { console.warn("[login turnstile] error-callback", err); } catch (_e) {}
      var message = errorMessage(err);
      state.lastError = message;
      failAllWaiters(message);
      // Leave widget visible so the user can see CF's own error UI.
    };

    var onExpired = function () {
      state.pendingToken = "";
      state.tokenIssuedAt = 0;
      try {
        if (state.widgetId !== null && window.turnstile && window.turnstile.reset) {
          window.turnstile.reset(state.widgetId);
        }
      } catch (_e) {}
    };

    var doRender = function () {
      try {
        var id = window.turnstile.render(container, {
          sitekey: siteKey,
          callback: onCallback,
          "error-callback": onError,
          "expired-callback": onExpired,
          "timeout-callback": onExpired,
        });
        state.widgetId = id;
        state.rendering = false;
        try { console.info("[login turnstile] widget rendered, id=", id); } catch (_e) {}
      } catch (err) {
        try { console.warn("[login turnstile] render threw", err); } catch (_e) {}
        state.rendering = false;
        var message = err && err.message ? err.message : String(err);
        state.lastError = message;
        failAllWaiters(message);
      }
    };

    if (typeof window.turnstile.ready === "function") {
      window.turnstile.ready(doRender);
    } else {
      doRender();
    }
    return true;
  }

  // Pre-render the login captcha widget. Safe to call multiple times.
  // Called when the auth overlay shows so the widget is visible (and
  // possibly auto-passing) before the user even clicks "发送验证码".
  function prerender() {
    waitForApi(15000).then(function () {
      try { renderWidget(); } catch (_e) {}
    }).catch(function () { /* surface only on actual sendOtp */ });
  }

  // Get a Turnstile token for Supabase Auth signInWithOtp. Uses the
  // cached pre-rendered widget when available; renders one if not.
  function getToken() {
    return new Promise(function (resolve, reject) {
      var siteKey = (typeof window !== "undefined" && window.__LOGIN_TURNSTILE_SITE_KEY__) || "";
      if (!siteKey) return reject(new Error("Login captcha is not configured."));

      waitForApi(15000).then(function () {
        // 1. If we have a fresh cached token, consume it directly.
        if (
          state.pendingToken
          && Date.now() - state.tokenIssuedAt < LOGIN_CAPTCHA_TOKEN_TTL_MS
        ) {
          var token = state.pendingToken;
          state.pendingToken = "";
          state.tokenIssuedAt = 0;
          try {
            if (state.widgetId !== null && window.turnstile && window.turnstile.reset) {
              window.turnstile.reset(state.widgetId);
            }
          } catch (_e) {}
          try { console.info("[login turnstile] using cached token, len=" + token.length); } catch (_e) {}
          return resolve(token);
        }

        // 2. Otherwise render (or use existing) widget and queue a waiter.
        var ok = renderWidget();
        if (!ok) {
          return reject(new Error("人机验证不可用，请刷新页面后重试。"));
        }

        // Managed widgets ask the user to click. 45s gives enough time
        // for slow network + a click, but not so long that users think
        // the page is frozen.
        var TIMEOUT_MS = 45000;
        var waiter = { resolve: resolve, reject: reject, timeoutId: null };
        waiter.timeoutId = setTimeout(function () {
          var idx = state.waiters.indexOf(waiter);
          if (idx >= 0) state.waiters.splice(idx, 1);
          var extra = state.lastError
            ? "\n上次错误：" + state.lastError
            : "\n如未看到验证窗口，请关闭广告拦截器、换个网络或刷新页面再试。";
          reject(new Error("人机验证超时（45s 内未拿到 token）。" + extra));
        }, TIMEOUT_MS);
        state.waiters.push(waiter);

        // Some loader builds need an explicit execute() for invisible mode.
        try {
          if (state.widgetId !== null && window.turnstile && window.turnstile.execute) {
            window.turnstile.execute(state.widgetId);
          }
        } catch (_e) { /* ignore — render's callback will fire if it succeeds */ }
      }).catch(reject);
    });
  }

  window.NexusLoginCaptcha = {
    prerender: prerender,
    getToken: getToken,
    // Exposed for diagnostics / debugging from the console.
    _state: state,
  };
})();
