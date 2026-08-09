/* =====================================================================
 * Turnstile bridge (2026-07-11 审计/人机验证 → 2026-07-20 可见挑战)
 *
 * 目的：登录页用 Cloudflare Turnstile 做服务端真校验。
 * 2026-07-20：由 interaction-only 隐形改为 appearance:'always' 可见挑战，
 * 挂在登录表单 #authCaptchaContainer 内，避免「右下角小框被忽略 → 无 token
 * → 服务端 captcha_failed」的差异化失败。
 *
 * 做三件事：
 *   1) window.NexusAuthCaptcha 兼容 shim：validate() 要求已拿到 token；
 *      init/refresh 渲染可见挂件；不再隐藏 #authCaptchaContainer。
 *   2) window.NexusLoginCaptcha（prerender/getToken/suspend）——持久挂件 +
 *      缓存 token；消费后 reset 以便重试。
 *   3) 包一层 window.fetch：对 POST /auth/v1/otp 和 /auth/v1/signup，若 body
 *      尚无 captcha_token 则 best-effort 注入。
 *
 * 加载顺序：必须在 cancri_chat.js 之前（defer 按出现顺序执行）。
 * ===================================================================== */
(function () {
  "use strict";

  var SITE_KEY =
    (typeof window !== "undefined" && window.__LOGIN_TURNSTILE_SITE_KEY__) || "";
  var TOKEN_TTL_MS = 4 * 60 * 1000; // CF token ~5min，保守当 4min 内新鲜
  var API_WAIT_MS = 10000;
  var TOKEN_WAIT_MS = 90000; // 可见挑战：给用户足够时间点选
  var INJECT_BUDGET_MS = 15000;

  var BRIDGE_VERSION = "2026-08-09-no-gap";
  var state = {
    version: BRIDGE_VERSION,
    widgetId: null,
    mountEl: null,
    statusEl: null,
    pendingToken: "",
    tokenIssuedAt: 0,
    rendering: false,
    apiReady: false,
    apiFailed: false,
    // 国内链路/代理导致 CF 挂件不可用时，允许继续登录（服务端 soft 模式）
    networkDegraded: false,
    lastError: "",
    waiters: [], // [{ resolve, reject, timeoutId }]
  };

  // ---- status UI -------------------------------------------------------
  function setStatus(text, color) {
    var el = state.statusEl;
    if (!el || !document.body.contains(el)) {
      el = document.getElementById("loginTurnstileStatus");
      state.statusEl = el;
    }
    if (!el) return;
    el.textContent = text || "";
    el.style.color = color || "rgba(128,128,128,0.9)";
    el.style.display = text ? "block" : "none";
  }

  function errorHint(code) {
    var c = code == null ? "" : String(code);
    if (c === "110200") {
      return "当前域名未加入 Turnstile Hostname 白名单，请联系管理员。";
    }
    if (c === "110100" || c === "110110" || c === "400020") {
      return "site key 无效，请联系管理员。";
    }
    if (c === "400070") {
      return "site key 已被禁用，请联系管理员。";
    }
    if (c.indexOf("300") === 0) {
      return "浏览器/网络异常（扩展、VPN、代理）。请换浏览器或无痕模式后刷新。";
    }
    if (c.indexOf("600") === 0) {
      return "验证未通过。请换网络/浏览器后重试。";
    }
    return c ? "错误码 " + c : "请刷新页面后重试。";
  }

  // ---- API wait --------------------------------------------------------
  function waitForApi(timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof window !== "undefined" && window.turnstile) {
        state.apiReady = true;
        return resolve();
      }
      var start = Date.now();
      (function tick() {
        if (typeof window !== "undefined" && window.turnstile) {
          state.apiReady = true;
          return resolve();
        }
        if (Date.now() - start > timeoutMs) {
          state.apiFailed = true;
          return reject(new Error("turnstile_api_timeout"));
        }
        setTimeout(tick, 150);
      })();
    });
  }

  // ---- container: form 内可见槽位 ---------------------------------------
  function ensureContainer() {
    // 优先用登录表单自带的 #authCaptchaContainer（邮箱与验证码输入之间）
    var host = document.getElementById("authCaptchaContainer");
    if (!host) {
      host = document.getElementById("loginTurnstileContainer");
    }
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
    // 不预留 min-height：挂件未出来 / 国内降级时避免邮箱与验证码之间出现空白带。
    // 真实可见 iframe 出现后再由内容撑开高度。
    host.style.display = "block";
    host.style.margin = "0";
    host.style.minHeight = "0";
    host.style.width = "100%";
    return host;
  }

  function collapseContainer() {
    var host =
      document.getElementById("authCaptchaContainer") ||
      document.getElementById("loginTurnstileContainer") ||
      state.mountEl && state.mountEl.parentNode;
    if (!host) return;
    try {
      host.style.display = "none";
      host.style.margin = "0";
      host.style.minHeight = "0";
      host.style.height = "0";
      host.style.overflow = "hidden";
      host.style.padding = "0";
    } catch (_e) {}
  }

  function failAllWaiters(message) {
    while (state.waiters.length > 0) {
      var w = state.waiters.shift();
      try { clearTimeout(w.timeoutId); } catch (_e) {}
      try { w.reject(new Error(message || "人机验证失败")); } catch (_e2) {}
    }
  }

  function resolveOneWaiter(token) {
    if (!state.waiters.length) return false;
    var w = state.waiters.shift();
    try { clearTimeout(w.timeoutId); } catch (_e) {}
    try { w.resolve(token || ""); } catch (_e2) {}
    return true;
  }

  function consumeToken() {
    if (
      !state.pendingToken ||
      Date.now() - state.tokenIssuedAt >= TOKEN_TTL_MS
    ) {
      state.pendingToken = "";
      state.tokenIssuedAt = 0;
      return "";
    }
    var tok = state.pendingToken;
    state.pendingToken = "";
    state.tokenIssuedAt = 0;
    // 消费后 reset，便于重试（token 单次有效）
    try {
      if (
        state.widgetId !== null &&
        window.turnstile &&
        typeof window.turnstile.reset === "function"
      ) {
        window.turnstile.reset(state.widgetId);
      }
    } catch (_e) {}
    return tok;
  }

  function hasFreshToken() {
    return !!(
      state.pendingToken &&
      Date.now() - state.tokenIssuedAt < TOKEN_TTL_MS
    );
  }

  // ---- render visible widget -------------------------------------------
  function renderWidget() {
    if (!SITE_KEY) {
      setStatus("人机验证未配置（缺少 site key），请联系管理员。", "#e11d48");
      return false;
    }
    if (typeof window === "undefined" || !window.turnstile || !window.turnstile.render) {
      return false;
    }
    if (state.widgetId !== null || state.rendering) return true;

    var host = ensureContainer();
    state.rendering = true;
    host.innerHTML = "";

    var status = document.createElement("div");
    status.id = "loginTurnstileStatus";
    status.style.cssText =
      "font-size:12px;line-height:1.45;color:rgba(128,128,128,0.95);margin:0 0 8px;text-align:left;display:block;";
    status.textContent = "请完成下方 Cloudflare 人机验证";
    host.appendChild(status);
    state.statusEl = status;

    var mount = document.createElement("div");
    mount.id = "loginTurnstileMount";
    mount.className = "cancri-turnstile-mount";
    mount.style.cssText =
      "min-height:65px;display:flex;justify-content:flex-start;width:100%;";
    host.appendChild(mount);
    state.mountEl = mount;

    var onToken = function (tok) {
      state.pendingToken = tok || "";
      state.tokenIssuedAt = Date.now();
      state.lastError = "";
      setStatus("验证已通过，可以发送验证码 / 登录", "#16a34a");
      try {
        console.info(
          "[turnstile bridge] token issued, len=" +
            (tok ? tok.length : 0) +
            " v=" +
            BRIDGE_VERSION
        );
      } catch (_e) {}
      // 若有排队的 getToken，立刻交出并清空缓存（token 单次有效）
      if (state.waiters.length && state.pendingToken) {
        var t = consumeToken();
        resolveOneWaiter(t);
      }
    };

    var onError = function (err) {
      var code = err == null ? "" : String(err);
      var msg = "人机验证加载失败。" + errorHint(code);
      state.lastError = msg;
      state.pendingToken = "";
      state.tokenIssuedAt = 0;
      setStatus(msg, "#e11d48");
      try {
        console.warn("[turnstile bridge] error-callback", err);
      } catch (_e) {}
      failAllWaiters(msg);
    };

    var onExpired = function () {
      state.pendingToken = "";
      state.tokenIssuedAt = 0;
      setStatus("验证已过期，请重新点击验证框", "#ca8a04");
      try {
        if (
          state.widgetId !== null &&
          window.turnstile &&
          window.turnstile.reset
        ) {
          window.turnstile.reset(state.widgetId);
        }
      } catch (_e) {}
    };

    try {
      // 直接 render，不经 turnstile.ready()（explicit 模式下 ready 易踩坑）
      var id = window.turnstile.render(mount, {
        sitekey: SITE_KEY,
        appearance: "always", // 始终可见
        execution: "render",
        size: "normal",
        theme: "auto",
        retry: "auto",
        "refresh-expired": "auto",
        callback: onToken,
        "error-callback": function (err) {
          onError(err);
          return true; // 阻止默认 console 刷屏
        },
        "expired-callback": onExpired,
        "timeout-callback": onExpired,
      });
      state.widgetId = id;
      state.rendering = false;
      try {
        console.info(
          "[turnstile bridge] visible widget rendered, id=",
          id,
          "v=" + BRIDGE_VERSION
        );
      } catch (_e) {}

      // 6s 后检查 iframe；国内链路经常超时 → 标记 networkDegraded 允许继续登录
      setTimeout(function () {
        if (hasFreshToken()) return;
        var iframe = mount.querySelector("iframe");
        if (iframe && iframe.offsetHeight > 10) {
          setStatus("请完成下方 Cloudflare 人机验证", "rgba(128,128,128,0.95)");
          return;
        }
        state.networkDegraded = true;
        var msg =
          "Cloudflare 验证组件未能显示（国内网络 / 代理常见）。可直接点「发送验证码」继续登录；仍失败请换 4G 热点。";
        state.lastError = msg;
        setStatus(msg, "#ca8a04");
        collapseContainer();
      }, 6000);
      return true;
    } catch (err) {
      state.rendering = false;
      var message = err && err.message ? err.message : String(err);
      state.lastError = message;
      setStatus("渲染人机验证失败：" + message, "#e11d48");
      failAllWaiters(message);
      return false;
    }
  }

  function prerender() {
    if (state.apiFailed) {
      state.networkDegraded = true;
      setStatus(
        "Cloudflare 验证脚本加载失败（国内网络常见）。可直接发送验证码登录；仍失败请换 4G 热点。",
        "#ca8a04"
      );
      collapseContainer();
      return;
    }
    waitForApi(API_WAIT_MS)
      .then(function () {
        renderWidget();
      })
      .catch(function () {
        state.apiFailed = true;
        state.networkDegraded = true;
        setStatus(
          "Cloudflare 验证脚本未能加载（challenges.cloudflare.com 在国内不稳定）。可直接点「发送验证码」继续；广告拦截可关掉，或换 4G/系统代理节点。",
          "#ca8a04"
        );
        collapseContainer();
      });
  }

  function getTokenBestEffortSoft(timeoutMs) {
    return getToken()
      .catch(function () {
        return "";
      })
      .then(function (tok) {
        if (tok) return tok;
        // 无 token：若已降级则返回空串，让请求继续（服务端 soft）
        if (state.networkDegraded || state.apiFailed) return "";
        return new Promise(function (resolve) {
          setTimeout(function () {
            resolve(hasFreshToken() ? consumeToken() : "");
          }, Math.min(timeoutMs || 2000, 3000));
        });
      });
  }

  function getToken() {
    return new Promise(function (resolve, reject) {
      if (!SITE_KEY) {
        return reject(new Error("人机验证未配置（缺少 site key）"));
      }

      // 已有新鲜 token：直接消费
      if (hasFreshToken()) {
        var cached = consumeToken();
        try {
          console.info(
            "[turnstile bridge] using cached token, len=" + cached.length
          );
        } catch (_e) {}
        return resolve(cached);
      }

      waitForApi(API_WAIT_MS)
        .then(function () {
          if (!renderWidget()) {
            return reject(
              new Error(
                state.lastError ||
                  "人机验证不可用，请刷新页面后重试。"
              )
            );
          }

          var waiter = { resolve: resolve, reject: reject, timeoutId: null };
          waiter.timeoutId = setTimeout(function () {
            var idx = state.waiters.indexOf(waiter);
            if (idx >= 0) state.waiters.splice(idx, 1);
            reject(
              new Error(
                "请先完成页面上的人机验证（勾选/点击验证框）。" +
                  (state.lastError ? "\n" + state.lastError : "")
              )
            );
          }, TOKEN_WAIT_MS);
          state.waiters.push(waiter);

          // 若在排队期间已经又产生了 token（race）
          if (hasFreshToken()) {
            var t = consumeToken();
            if (resolveOneWaiter(t)) return;
            // waiter 已不在队列则直接 resolve（上面 resolveOne 会处理）
          }
        })
        .catch(function () {
          reject(
            new Error(
              "Cloudflare 验证脚本未能加载。请关闭广告拦截器或换网络后刷新。"
            )
          );
        });
    });
  }

  function getTokenBestEffort(budgetMs) {
    // 网络降级：立刻空 token，别卡 15s 等人点 CF
    if (state.networkDegraded || state.apiFailed) {
      if (hasFreshToken()) return Promise.resolve(consumeToken());
      return Promise.resolve("");
    }
    return new Promise(function (resolve) {
      var done = false;
      var fin = function (v) {
        if (!done) {
          done = true;
          resolve(v || "");
        }
      };
      var t = setTimeout(function () {
        fin("");
      }, budgetMs);
      getToken().then(
        function (tok) {
          clearTimeout(t);
          fin(tok || "");
        },
        function () {
          clearTimeout(t);
          fin("");
        }
      );
    });
  }

  // suspend：登录成功后拆掉挂件，避免后台继续轮询 CF
  function suspend() {
    try {
      if (
        state.widgetId !== null &&
        window.turnstile &&
        typeof window.turnstile.remove === "function"
      ) {
        window.turnstile.remove(state.widgetId);
      }
    } catch (_e) {}
    failAllWaiters("人机验证已挂起。");
    state.widgetId = null;
    state.mountEl = null;
    state.pendingToken = "";
    state.tokenIssuedAt = 0;
    state.rendering = false;
    state.lastError = "";
    if (state.statusEl && state.statusEl.parentNode) {
      try {
        state.statusEl.parentNode.removeChild(state.statusEl);
      } catch (_e2) {}
    }
    state.statusEl = null;
    var host =
      document.getElementById("authCaptchaContainer") ||
      document.getElementById("loginTurnstileContainer");
    if (host) {
      try {
        host.innerHTML = "";
      } catch (_e3) {}
    }
  }

  // ---- NexusAuthCaptcha 兼容（Turnstile，不再使用左侧 4 位画布码） -------
  window.NexusAuthCaptcha = {
    init: function () {
      // 表单容器必须可见（旧隐形逻辑会 display:none）
      var c = document.getElementById("authCaptchaContainer");
      if (c) c.style.display = "block";
      state.pendingToken = "";
      state.tokenIssuedAt = 0;
      // 已有挂件则 reset 重新挑战；否则全新渲染
      if (state.widgetId !== null && window.turnstile && window.turnstile.reset) {
        try {
          window.turnstile.reset(state.widgetId);
          setStatus("请完成下方 Cloudflare 人机验证", "rgba(128,128,128,0.95)");
          return;
        } catch (_e) {
          suspend();
        }
      }
      prerender();
    },
    validate: function () {
      // 已通过 CF
      if (hasFreshToken()) return true;
      // 国内网络 / 代理 / 广告拦截导致 CF 不可用：放行发送（服务端 soft + 限流）
      if (state.networkDegraded || state.apiFailed) return true;
      // 挂件渲染失败且已给出错误：同样走降级
      if (state.lastError && !window.turnstile) return true;
      // 挂件已显示但用户还没点：仍拦截
      return false;
    },
    getFailMessage: function () {
      if (state.apiFailed || state.networkDegraded) {
        return "当前网络访问 Cloudflare 验证困难（国内常见）。可直接点发送验证码继续；若仍失败请换 4G 热点或系统代理节点。";
      }
      if (state.lastError) return state.lastError;
      if (!SITE_KEY) return "人机验证未配置，请联系管理员。";
      if (!window.turnstile) {
        return "人机验证组件加载中，请稍候几秒；若一直空白可直接发送验证码（网络受限时）。";
      }
      return "请先完成下方 Cloudflare 人机验证（勾选/通过挑战）。若验证框空白或不通过：关掉广告拦截，换 4G 热点；开梯子若失败可换节点或关掉再试。";
    },
    refresh: function () {
      try {
        if (
          state.widgetId !== null &&
          window.turnstile &&
          window.turnstile.reset
        ) {
          state.pendingToken = "";
          state.tokenIssuedAt = 0;
          window.turnstile.reset(state.widgetId);
          setStatus("请完成下方 Cloudflare 人机验证", "rgba(128,128,128,0.95)");
          return;
        }
      } catch (_e) {}
      suspend();
      prerender();
    },
    clearInput: function () {
      state.pendingToken = "";
      state.tokenIssuedAt = 0;
    },
    focusInput: function () {
      var host =
        document.getElementById("authCaptchaContainer") ||
        document.getElementById("loginTurnstileContainer");
      if (host) {
        try {
          host.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (_e) {
          try {
            host.scrollIntoView();
          } catch (_e2) {}
        }
      }
    },
    getCode: function () {
      return hasFreshToken() ? "ok" : "";
    },
  };

  window.NexusLoginCaptcha = {
    prerender: prerender,
    getToken: getToken,
    suspend: suspend,
    _state: state,
  };

  // ---- fetch 注入（otp / signup 兜底） ---------------------------------
  var AUTH_TOKEN_PATHS = ["/auth/v1/otp", "/auth/v1/signup"];
  function isAuthTokenUrl(url) {
    var u = String(url || "");
    for (var i = 0; i < AUTH_TOKEN_PATHS.length; i++) {
      if (u.indexOf(AUTH_TOKEN_PATHS[i]) !== -1) return true;
    }
    return false;
  }

  var realFetch =
    typeof window !== "undefined" && window.fetch
      ? window.fetch.bind(window)
      : null;
  if (realFetch) {
    window.fetch = function (input, init) {
      try {
        var url =
          typeof input === "string" ? input : (input && input.url) || "";
        var method = String(
          (init && init.method) || (input && input.method) || "GET"
        ).toUpperCase();
        var bodyStr = null;
        if (init && typeof init.body === "string") bodyStr = init.body;
        if (method === "POST" && isAuthTokenUrl(url) && bodyStr) {
          var body = null;
          try {
            body = JSON.parse(bodyStr);
          } catch (_e) {
            body = null;
          }
          if (body && typeof body === "object") {
            var meta = body.gotrue_meta_security;
            var hasToken =
              meta &&
              typeof meta.captcha_token === "string" &&
              meta.captcha_token;
            if (!hasToken) {
              return getTokenBestEffort(INJECT_BUDGET_MS).then(function (tok) {
                if (tok) {
                  body.gotrue_meta_security = { captcha_token: tok };
                  var newInit = {};
                  if (init) {
                    for (var k in init) {
                      if (Object.prototype.hasOwnProperty.call(init, k)) {
                        newInit[k] = init[k];
                      }
                    }
                  }
                  newInit.method = "POST";
                  newInit.body = JSON.stringify(body);
                  try {
                    console.info(
                      "[turnstile bridge] injected captcha_token into",
                      url,
                      "len=" + tok.length
                    );
                  } catch (_e) {}
                  return realFetch(
                    typeof input === "string" ? input : url,
                    newInit
                  );
                }
                try {
                  console.warn(
                    "[turnstile bridge] no captcha token within budget; sending bare auth request"
                  );
                } catch (_e2) {}
                return realFetch(input, init);
              });
            }
          }
        }
      } catch (_e) {
        /* 任何异常回退原始 fetch */
      }
      return realFetch(input, init);
    };
  }

  // 登录页首屏即挂可见挑战
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        prerender();
      });
    } else {
      prerender();
    }
  }
})();
