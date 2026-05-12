/* =====================================================================
 * Login Turnstile module — Cloudflare Turnstile widget management for
 * Supabase Auth captcha (`signInWithOtp({ captchaToken })`).
 *
 * Exposes a single global: `window.NexusLoginCaptcha`
 *   - prerender()  — start rendering the widget early so a token is
 *                    ready by the time the user clicks "发送验证码".
 *                    Idempotent; safe to call multiple times.
 *   - getToken()   — Promise<string> that resolves with a Cloudflare
 *                    Turnstile token. Uses cached token if fresh, else
 *                    queues until the widget callback fires.
 *
 * KEY DESIGN DECISIONS (after the "no widget visible + 发送中... stuck"
 * incident on 2026-05-12):
 *
 *   1) The HTML container is now ALWAYS visible (no display:none),
 *      with a status text placeholder. So the user always sees either
 *      the iframe, a loading message, or an error message — never a
 *      blank space + permanent "发送中...".
 *
 *   2) We proactively detect ad-blockers / network blocks. If the
 *      Cloudflare api.js script never loads, we replace the placeholder
 *      with a red "请关闭广告拦截器 / 换网络" message within ~6s, before
 *      the user even clicks send.
 *
 *   3) We pass `appearance: 'always'`, `size: 'normal'`, and
 *      `execution: 'render'` explicitly to turnstile.render() so the
 *      widget shape/behaviour doesn't depend on Cloudflare-dashboard
 *      defaults that might change.
 *
 *   4) Singleton state + waiter queue: many code paths can ask for a
 *      token; first callback wins, widget is reset() for next waiter.
 * ===================================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Tunables
  // ---------------------------------------------------------------------
  // CF tokens are valid ~5 min upstream. We treat as fresh for 4 min.
  var TOKEN_TTL_MS = 4 * 60 * 1000;
  // How long the prerender / getToken paths wait for window.turnstile
  // to appear. CF's api.js usually loads in 1–2s; 8s is a safe upper
  // bound that still lets us surface ad-blocker errors quickly.
  var API_WAIT_MS = 8000;
  // After getToken queues a waiter, how long before we give up.
  // Managed widgets need time for a click; 45s is enough.
  var TOKEN_WAIT_MS = 45000;

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var state = {
    widgetId: null,
    container: null,
    statusEl: null,
    pendingToken: null,
    tokenIssuedAt: 0,
    rendering: false,
    apiReady: false,
    apiCheckFailed: false,
    waiters: [],         // [{ resolve, reject, timeoutId }]
    lastError: null,
  };

  // ---------------------------------------------------------------------
  // Status UI helpers
  // ---------------------------------------------------------------------
  function getStatusEl() {
    if (state.statusEl && document.body.contains(state.statusEl)) {
      return state.statusEl;
    }
    state.statusEl = document.getElementById("loginTurnstileStatus");
    return state.statusEl;
  }

  function setStatus(text, color) {
    var el = getStatusEl();
    if (!el) return;
    el.textContent = text;
    el.style.color = color || "rgba(255,255,255,0.55)";
    el.style.whiteSpace = "pre-wrap";
    el.style.textAlign = "center";
    el.style.lineHeight = "1.5";
  }

  function clearStatus() {
    var el = getStatusEl();
    if (el && el.parentNode) {
      try { el.parentNode.removeChild(el); } catch (_e) {}
    }
    state.statusEl = null;
  }

  // ---------------------------------------------------------------------
  // Error formatting
  // ---------------------------------------------------------------------
  function errorMessage(err) {
    var code = (typeof err === "string" || typeof err === "number") ? String(err) : "";
    var hint = "";
    if (code === "110200") {
      hint = "Cloudflare 110200：当前域名未在 Turnstile widget 的 Hostname 列表中。";
    } else if (code === "110100" || code === "110110" || code === "400020") {
      hint = "Cloudflare " + code + "：site key 无效。";
    } else if (code === "400070") {
      hint = "Cloudflare 400070：该 site key 已在 dashboard 中被禁用。";
    } else if (code.indexOf("300") === 0) {
      hint = "Cloudflare " + code + "：浏览器/网络问题（可能是 VPN/代理/扩展导致）。请尝试换浏览器或关闭扩展。";
    } else if (code.indexOf("600") === 0) {
      hint = "Cloudflare " + code + "：人机验证失败，可能被识别为机器人。换网络/换浏览器/无痕模式试试。";
    }
    return code
      ? "人机验证失败 (Cloudflare 错误 " + code + ")" + (hint ? "\n" + hint : "")
      : "人机验证失败，请重试。";
  }

  // ---------------------------------------------------------------------
  // Container resolution
  // ---------------------------------------------------------------------
  function ensureContainer() {
    var container = document.getElementById("loginTurnstileContainer");
    if (container) return container;

    container = document.createElement("div");
    container.id = "loginTurnstileContainer";
    container.style.margin = "8px 0";
    container.style.minHeight = "70px";
    container.style.display = "flex";
    container.style.alignItems = "center";
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

  // ---------------------------------------------------------------------
  // Ad-blocker / network detection
  // ---------------------------------------------------------------------
  // We can't simply fetch api.js because of CORS. Instead, we rely on
  // the existing <script> tag in index.html: if window.turnstile shows
  // up within API_WAIT_MS, we're good; otherwise it's almost certainly
  // an ad-blocker / firewall blocking challenges.cloudflare.com.
  function waitForApi(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof window !== "undefined" && window.turnstile) {
        state.apiReady = true;
        return resolve();
      }
      var start = Date.now();
      var tick = function () {
        if (typeof window !== "undefined" && window.turnstile) {
          state.apiReady = true;
          return resolve();
        }
        if (Date.now() - start > timeoutMs) {
          state.apiCheckFailed = true;
          return reject(new Error(
            "Cloudflare Turnstile 脚本未能加载。\n" +
            "请尝试以下任一方式：\n" +
            "1) 关闭 uBlock / AdGuard / 隐私徽章 等浏览器扩展\n" +
            "2) 换一个网络（如手机热点）\n" +
            "3) 在无痕模式下打开本页\n" +
            "随后刷新页面（Ctrl+F5）。"
          ));
        }
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  // ---------------------------------------------------------------------
  // Waiter queue helpers
  // ---------------------------------------------------------------------
  function failAllWaiters(message) {
    while (state.waiters.length > 0) {
      var w = state.waiters.shift();
      try { clearTimeout(w.timeoutId); } catch (_e) {}
      try { w.reject(new Error(message)); } catch (_e) {}
    }
  }

  // ---------------------------------------------------------------------
  // Widget render
  // ---------------------------------------------------------------------
  function renderWidget() {
    var siteKey = (typeof window !== "undefined" && window.__LOGIN_TURNSTILE_SITE_KEY__) || "";
    if (!siteKey) {
      setStatus("人机验证未配置（缺少 site key），请联系管理员。", "#ff6b6b");
      return false;
    }
    if (typeof window === "undefined" || !window.turnstile) return false;
    if (state.widgetId !== null || state.rendering) return true;

    var container = ensureContainer();
    if (!container) return false;
    state.container = container;
    state.rendering = true;

    // Make the container visible. We DON'T clearStatus() here — we let
    // the iframe push the status text out naturally once the widget
    // mounts. If render fails, status still shows error.
    if (!container.style.display || container.style.display === "none") {
      container.style.display = "flex";
    }

    var onCallback = function (token) {
      state.pendingToken = token || "";
      state.tokenIssuedAt = Date.now();
      state.lastError = null;
      try { console.info("[login turnstile] token issued, len=" + (token ? token.length : 0)); } catch (_e) {}
      // Drain first waiter (tokens are single-use).
      while (state.waiters.length > 0) {
        var w = state.waiters.shift();
        try { clearTimeout(w.timeoutId); } catch (_e) {}
        if (state.pendingToken) {
          var t = state.pendingToken;
          state.pendingToken = "";
          state.tokenIssuedAt = 0;
          try { w.resolve(t); } catch (_e) {}
          try {
            if (state.widgetId !== null && window.turnstile && window.turnstile.reset) {
              window.turnstile.reset(state.widgetId);
            }
          } catch (_e) {}
          return;
        }
      }
    };

    var onError = function (err) {
      try { console.warn("[login turnstile] error-callback", err); } catch (_e) {}
      var message = errorMessage(err);
      state.lastError = message;
      setStatus(message, "#ff6b6b");
      failAllWaiters(message);
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
        // Explicit options so behaviour doesn't depend on the
        // Cloudflare-dashboard defaults (which can change).
        var id = window.turnstile.render(container, {
          sitekey: siteKey,
          callback: onCallback,
          "error-callback": onError,
          "expired-callback": onExpired,
          "timeout-callback": onExpired,
          appearance: "always",       // visible from page load
          size: "normal",             // 300x65 (visible challenge area)
          execution: "render",        // run challenge immediately on render
          theme: "auto",
          retry: "auto",
          "refresh-expired": "auto",
        });
        state.widgetId = id;
        state.rendering = false;
        try { console.info("[login turnstile] widget rendered, id=", id); } catch (_e) {}
      } catch (err) {
        try { console.warn("[login turnstile] render threw", err); } catch (_e) {}
        state.rendering = false;
        var message = err && err.message ? err.message : String(err);
        state.lastError = message;
        setStatus("渲染人机验证失败：" + message, "#ff6b6b");
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

  // ---------------------------------------------------------------------
  // Public: prerender (called when auth overlay opens)
  // ---------------------------------------------------------------------
  function prerender() {
    // If we've already detected api.js is blocked, don't keep retrying
    // silently — show the message.
    if (state.apiCheckFailed) {
      setStatus(
        "❌ 人机验证组件加载失败\n请关闭广告拦截器或换网络后刷新页面",
        "#ff6b6b"
      );
      return;
    }
    setStatus("正在加载人机验证组件…");
    waitForApi(API_WAIT_MS).then(function () {
      try { renderWidget(); } catch (_e) {}
    }).catch(function (err) {
      setStatus(err.message || "人机验证加载失败", "#ff6b6b");
    });
  }

  // ---------------------------------------------------------------------
  // Public: getToken (called by sendOtp)
  // ---------------------------------------------------------------------
  function getToken() {
    return new Promise(function (resolve, reject) {
      var siteKey = (typeof window !== "undefined" && window.__LOGIN_TURNSTILE_SITE_KEY__) || "";
      if (!siteKey) return reject(new Error("人机验证未配置（缺少 site key），请联系管理员。"));

      waitForApi(API_WAIT_MS).then(function () {
        // 1) Fresh cached token? Consume it.
        if (
          state.pendingToken
          && Date.now() - state.tokenIssuedAt < TOKEN_TTL_MS
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

        // 2) Render widget if not yet mounted, then queue waiter.
        var ok = renderWidget();
        if (!ok) {
          return reject(new Error("人机验证不可用，请刷新页面后重试。"));
        }

        var waiter = { resolve: resolve, reject: reject, timeoutId: null };
        waiter.timeoutId = setTimeout(function () {
          var idx = state.waiters.indexOf(waiter);
          if (idx >= 0) state.waiters.splice(idx, 1);
          var extra = state.lastError
            ? "\n上次错误：" + state.lastError
            : "\n如未看到验证窗口或验证按钮，请关闭广告拦截器、换个网络或刷新页面再试。";
          reject(new Error("人机验证超时（" + Math.round(TOKEN_WAIT_MS / 1000) + "s 内未拿到 token）。" + extra));
        }, TOKEN_WAIT_MS);
        state.waiters.push(waiter);

        // For execution: 'execute' mode you'd call execute() here. We
        // use execution: 'render' so the challenge starts on render —
        // no execute() call needed.
      }).catch(reject);
    });
  }

  window.NexusLoginCaptcha = {
    prerender: prerender,
    getToken: getToken,
    _state: state,            // for console debugging
    _setStatus: setStatus,    // for console debugging
  };

  // Kick off the API wait as soon as the script loads, so by the time
  // initAuthOverlay() calls prerender() we already know whether
  // Turnstile is available.
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        // Best-effort: don't wait — just start the check so apiReady is
        // populated before anyone asks.
        waitForApi(API_WAIT_MS).catch(function () { /* surfaced later */ });
      });
    } else {
      waitForApi(API_WAIT_MS).catch(function () { /* surfaced later */ });
    }
  }
})();
