/**
 * Cancri 开放平台 — 共享会话鉴权（与 chat 页 storageKey 一致）
 * 需拉用户数据的页面：无有效会话（含依赖脚本失败、超时）→ location.replace 登录页
 */
(function (win) {
  "use strict";

  var sb = null;

  function resolveLoginUrl() {
    var custom =
      (document.body && document.body.getAttribute("data-login-url")) ||
      document.documentElement.getAttribute("data-login-url");
    if (custom) return custom;
    var p = (location.pathname || "").replace(/\\/g, "/");
    // 用绝对 URL 解析，避免页面 <base href> 把相对登录地址错解到上层目录
    if (/\/api\//.test(p)) return new URL("../index.html", location.href).href;
    return new URL("index.html", location.href).href;
  }

  function redirectToLogin() {
    win.location.replace(resolveLoginUrl());
  }

  function hide(elOrId) {
    var el = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
    if (!el) return;
    el.style.display = "none";
    el.removeAttribute("aria-busy");
  }

  function showAuthError(message, parent) {
    var host = document.getElementById("auth-error");
    if (!host) {
      host = document.createElement("div");
      host.id = "auth-error";
      host.className = "cs-auth-error";
      var mount = parent || document.querySelector(".page-shell") || document.getElementById("console-root") || document.body;
      if (mount === document.body) mount.insertBefore(host, mount.firstChild);
      else mount.insertBefore(host, mount.firstChild);
    }
    host.textContent = message;
    host.style.display = "block";
  }

  function getSupabase() {
    if (sb) return sb;
    if (!win.supabase || !win.__SUPABASE_URL__ || !win.__SUPABASE_ANON_KEY__) {
      throw new Error("supabase_not_loaded");
    }
    sb = win.supabase.createClient(win.__SUPABASE_URL__, win.__SUPABASE_ANON_KEY__, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "cancri_supabase_auth",
      },
    });
    return sb;
  }

  async function getSession(timeoutMs) {
    if (timeoutMs == null) timeoutMs = 6000;
    var p = getSupabase().auth.getSession().then(function (r) {
      return r && r.data ? r.data.session : null;
    });
    if (!timeoutMs) return p;
    var timeout = new Promise(function (resolve) {
      setTimeout(function () {
        resolve(null);
      }, timeoutMs);
    });
    return Promise.race([p, timeout]);
  }

  function isValidSession(session) {
    return !!(session && session.user && !session.user.is_anonymous);
  }

  /** @returns {Promise<object|null>} session，或 null（已跳转 / 已展示错误） */
  async function requireSession(opts) {
    opts = opts || {};
    try {
      getSupabase();
    } catch (e) {
      if (e && e.message === "supabase_not_loaded") {
        redirectToLogin();
        return null;
      }
      throw e;
    }
    var session = await getSession(opts.timeoutMs);
    if (!isValidSession(session)) {
      redirectToLogin();
      return null;
    }
    if (opts.loadingId) hide(opts.loadingId);
    return session;
  }

  win.PlatformAuth = {
    resolveLoginUrl: resolveLoginUrl,
    redirectToLogin: redirectToLogin,
    hide: hide,
    showAuthError: showAuthError,
    getSupabase: getSupabase,
    getSession: getSession,
    isValidSession: isValidSession,
    requireSession: requireSession,
  };
})(window);
