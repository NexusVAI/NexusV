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
    apiDoc: null,
    lastError: "",
  };

  // ── 登录表单住在同源 iframe 里，本文件必须跨进去 ──────────────────────
  //
  // ⛔ 禁改区（2026-09-05）：以下所有 DOM 访问都必须经 authDoc() / authWin()，
  // **不要**改回裸 `document.` / `window.`。
  //
  // chat/index.html 与 chat/claude.html 的登录界面是 #authLoginFrame 这个同源
  // iframe（src = claude-login-island.html），#authCaptchaContainer /
  // #authSendOtpBtn / #authStepEmail / #authEmailError 四个元素**全都在 iframe 的
  // document 里**，父文档一个都查不到（2026-09-05 线上实测四个 getElementById
  // 全返回 null）。改造前本文件全程用父文档 document：
  //   · captchaHost() 恒为 null → ensureContainer() 走最后那条 fallback，把宿主
  //     append 到**父文档 body 末尾**，而登录 overlay 是全屏盖在上面的 → widget
  //     渲染成功却在视觉上被遮住，用户看到的就是「让我验证，但没有验证框」；
  //   · setEmailError() 拿不到 #authEmailError，静默 return → bridge 的提示语根本
  //     写不进表单，用户看到的始终是后端 403 那段原文。
  //
  // 判据与 chat/src/main.js 的 authDoc() 逐字一致（contentDocument 里能查到
  // #authEmailInput 才算就绪），两边必须看同一个 realm。desktop-login.html 没有
  // 这个 iframe、表单就在主文档，于是这两个函数自动退回 document / window，
  // 那个页面的行为与改造前逐字相同。
  var LOGIN_FRAME_ID = "authLoginFrame";
  var AUTH_DOC_WAIT_MS = 8000;

  function authDoc() {
    var frame = document.getElementById(LOGIN_FRAME_ID);
    try {
      if (
        frame &&
        frame.contentDocument &&
        frame.contentDocument.getElementById("authEmailInput")
      ) {
        return frame.contentDocument;
      }
    } catch { /* 跨源时读 contentDocument 会抛，退回主文档。 */ }
    return document;
  }

  function authWin() {
    return authDoc().defaultView || window;
  }

  // iframe 是懒加载的（main.js 的 ensureAuthLoginFrameLoaded 在展示登录浮层时才
  // 注入 src），而 403 可能早于它就绪。等一小会儿再决定宿主，避免刚好在加载窗口里
  // 退回父文档、又把 widget 挂到看不见的地方。
  function waitForAuthDoc(timeoutMs) {
    return new Promise(function (resolve) {
      var start = Date.now();
      (function tick() {
        // 已就绪，或这个页面压根没有登录 iframe（desktop-login.html）→ 立刻定案，
        // 不要让没有 iframe 的页面白等满超时。
        if (authDoc() !== document) { resolve(); return; }
        if (!document.getElementById(LOGIN_FRAME_ID)) { resolve(); return; }
        if (Date.now() - start >= timeoutMs) { resolve(); return; }
        setTimeout(tick, 100);
      })();
    });
  }

  // ⛔ 禁改区（2026-09-05）：**不要**把 #authCaptchaContainer 加回这里。
  //
  // 它在 claude-login-island.html 里不是表单的一部分，而是躺在一个 `<div hidden>`
  // 的遗留存根堆里，同一个父块里还有 #authPasswordSection / #authPasswordLoginBtn /
  // #authLoginModeToggle / #authBackBtn / #authStatusLine —— 那批元素只为了让
  // main.js 的 authEl(id) 不返回 null 才留着，**父块本身 display:none**。
  // 于是命中它就等于把 widget 挂进一个隐藏子树：无论怎么摘它自己的 hidden、
  // 怎么设行内 display，getBoundingClientRect() 恒为 0×0（2026-09-05 实测）。
  // 这正是「后端说去完成验证，页面上却什么都没有」的最后一层原因。
  //
  // 现在只认本文件自己建的 #loginTurnstileContainer，宿主位置由 ensureContainer()
  // 按可见表单结构决定。
  function captchaHost() {
    return authDoc().getElementById("loginTurnstileContainer");
  }

  function ensureContainer() {
    var d = authDoc();
    var host = captchaHost();
    if (!host) {
      host = d.createElement("div");
      host.id = "loginTurnstileContainer";
      // 首选落点：可见表单 #authEmailForm 内、错误文案 #authEmailError 之前，
      // 也就是「发码按钮下方」——正好对上后端那句「请在页面上完成下方的 Cloudflare
      // 验证」。该 form 是 flex-col gap-4，插进去自动有间距、自动撑满宽度。
      // ⛔ 别改成 sendBtn.parentNode.insertBefore：发码按钮的直接父级是一个
      // `inline-flex w-full` 的 <span>，把 block 宿主塞进去会挤坏按钮行。
      var form = d.getElementById("authEmailForm");
      var errorEl = d.getElementById("authEmailError");
      var sendBtn = d.getElementById("authSendOtpBtn");
      if (form && errorEl && errorEl.parentNode === form) {
        form.insertBefore(host, errorEl);
      } else if (form) {
        form.appendChild(host);
      } else if (sendBtn && sendBtn.parentNode) {
        sendBtn.parentNode.insertBefore(host, sendBtn);
      } else {
        var step = d.getElementById("authStepEmail");
        if (step) step.appendChild(host);
        else (d.body || d.documentElement).appendChild(host);
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
    var d = authDoc();
    var el = state.statusEl;
    if (!el || !d.contains(el)) {
      el = d.getElementById("loginTurnstileStatus");
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
    var status = authDoc().createElement("div");
    status.id = "loginTurnstileStatus";
    status.style.cssText =
      "font-size:12px;line-height:1.45;margin:0;text-align:left;display:block;";
    host.appendChild(status);
    state.statusEl = status;
    state.mountEl = null;
    setStatus(text, color);
  }

  function setEmailError(message) {
    var errorEl = authDoc().getElementById("authEmailError");
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

  function hasApi() {
    var w = authWin();
    return !!(w.turnstile && typeof w.turnstile.render === "function");
  }

  function waitForApi(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (hasApi()) {
        resolve();
        return;
      }
      var start = Date.now();
      (function tick() {
        if (hasApi()) {
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

  // ⛔ SDK 必须注入到**宿主所在的那个 document**，不能复用父文档已加载的
  // window.turnstile。2026-09-05 实测：拿父窗口的 turnstile 去 render 一个属于
  // iframe document 的节点，直接抛
  //   [Cloudflare Turnstile] Invalid type for parameter "container",
  //   expected "string" or an implementation of "HTMLElement"
  // —— 它内部是 instanceof HTMLElement，而跨 realm 的元素对父窗口的 HTMLElement
  // 不成立。在 iframe 里注入同一个 api.js 后渲染即成功（实测拿到 837 字节 token）。
  function loadApi() {
    if (hasApi()) return Promise.resolve();

    var d = authDoc();
    // 换过一次 iframe src 就等于换了 realm，上一个 realm 的 promise 与其中的
    // turnstile 都不再可用，所以按 document 记账。
    if (state.apiLoading && state.apiDoc === d) return state.apiLoading;
    state.apiDoc = d;

    state.apiLoading = new Promise(function (resolve, reject) {
      var script = d.querySelector('script[src^="' + TURNSTILE_API + '"]');
      var created = false;
      if (!script) {
        script = d.createElement("script");
        script.src = TURNSTILE_API;
        script.async = true;
        script.defer = true;
        script.dataset.turnstileBridge = BRIDGE_VERSION;
        created = true;
      }
      script.addEventListener("error", function () {
        reject(new Error("turnstile_api_load_failed"));
      }, { once: true });
      if (created) (d.head || d.documentElement).appendChild(script);
      waitForApi(API_WAIT_MS).then(resolve, reject);
    }).catch(function (err) {
      state.apiLoading = null;
      state.apiDoc = null;
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
      var w = authWin();
      if (
        state.widgetId !== null &&
        w.turnstile &&
        typeof w.turnstile.reset === "function"
      ) {
        w.turnstile.reset(state.widgetId);
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
    if (!hasApi()) {
      return false;
    }
    if (state.widgetId !== null || state.rendering) return true;

    var d = authDoc();
    var w = authWin();
    var host = ensureContainer();
    host.innerHTML = "";
    state.rendering = true;

    var status = d.createElement("div");
    status.id = "loginTurnstileStatus";
    status.style.cssText =
      "font-size:12px;line-height:1.45;margin:0 0 8px;text-align:left;display:block;";
    status.textContent = REQUIRED_MESSAGE;
    host.appendChild(status);
    state.statusEl = status;

    var mount = d.createElement("div");
    mount.id = "loginTurnstileMount";
    mount.className = "cancri-turnstile-mount";
    mount.dataset.action = "turnstile-spin-v1";
    mount.style.cssText =
      "min-height:65px;display:flex;justify-content:flex-start;width:100%;";
    host.appendChild(mount);
    state.mountEl = mount;

    try {
      state.widgetId = w.turnstile.render(mount, {
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
    // 先等登录 iframe 就绪再决定宿主：403 可能早于 ensureAuthLoginFrameLoaded()
    // 注入 src，此刻 authDoc() 还是父文档，直接建容器会挂到看不见的地方。
    waitForAuthDoc(AUTH_DOC_WAIT_MS)
      .then(function () {
        installOtpGuard(authDoc());
        ensureContainer();
        setEmailError(REQUIRED_MESSAGE);
        return loadApi();
      })
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
      var w = authWin();
      if (
        state.widgetId !== null &&
        w.turnstile &&
        typeof w.turnstile.remove === "function"
      ) {
        w.turnstile.remove(state.widgetId);
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

  // 守卫必须注册在**按钮所在的那个 document** 上。#authSendOtpBtn 在登录 iframe
  // 里，只挂父文档的话捕获阶段收不到那次点击（父文档在事件路径上只有 <iframe>
  // 这一个节点）。iframe 懒加载，所以 requireChallenge() 在宿主定案后再补挂一次；
  // 打个标记保证幂等，换了 realm 的新 document 会重新挂。
  function installOtpGuard(d) {
    if (!d || d.__cancriOtpGuardInstalled) return;
    d.__cancriOtpGuardInstalled = true;
    d.addEventListener("click", guardOtpClick, true);
  }

  installCompatibilityApis();
  if (typeof document !== "undefined") {
    installOtpGuard(document);
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
