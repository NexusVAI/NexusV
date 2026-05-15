/*!
 * Cancri 客户端遥测（错误回传）
 *
 * 用户进入页面后：
 *   1. 检查 localStorage.cancri_telemetry_consent
 *   2. 没决策 → 右下角弹同意卡片（同意 / 拒绝）
 *   3. 同意后：window.onerror / unhandledrejection 自动上报到 chat-gateway
 *      的 client_error_report endpoint，附最近 10 条 fetch 请求（环形缓冲）
 *   4. 拒绝后：仅记录决策一次，后续不再采集，不再骚扰
 *
 * 完全自包含：不依赖 components.js、jQuery 或 Supabase JS。
 * 任何页面 <script src="/js/telemetry.js" defer> 一行就能挂上。
 *
 * 隐私承诺（与 about.html 隐私章节一致）：
 *   - 仅在 window 抛 unhandled error 时触发
 *   - 收集：浏览器 UA / 当前 URL / 视口尺寸 / 异常 message + stack /
 *           最近 10 条 fetch 的 url + 状态码（不含 body）
 *   - 不收集：聊天内容、Cookie、表单值、键盘输入
 *   - 不分享给第三方
 */

(function () {
  'use strict';

  if (window.__cancri_telemetry_loaded) return;
  window.__cancri_telemetry_loaded = true;

  // ── 配置 ──────────────────────────────────────────────────────────
  // 用 cancri_config.js 注入的常量优先（聊天/平台页有），否则用硬编码 fallback
  // —— anon key 本来就是公开的（写在所有 HTML 里），不算秘密。
  var SUPABASE_URL = window.__SUPABASE_URL__ || 'https://diusqgphvybnzazgopor.supabase.co';
  var SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || 'sb_publishable_zK_fV6gwNta8Ne8aFL_n4g_cm8HP4lY';
  var GW = SUPABASE_URL + '/functions/v1/chat-gateway';

  var CONSENT_KEY = 'cancri_telemetry_consent';
  var CONSENT_TS_KEY = 'cancri_telemetry_consent_ts';
  var ANON_ID_KEY = 'cancri_anon_id';

  // ── 工具 ──────────────────────────────────────────────────────────
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* quota / private mode */ } }

  function getOrCreateAnonId() {
    var id = lsGet(ANON_ID_KEY);
    if (id) return id;
    try {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : ('anon-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
    } catch (e) {
      id = 'anon-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }
    lsSet(ANON_ID_KEY, id);
    return id;
  }

  function getViewport() {
    return (window.innerWidth || 0) + 'x' + (window.innerHeight || 0);
  }

  function getAccessToken() {
    // Supabase auth 在 localStorage 里以 `cancri_supabase_auth` 为 key 存 session JSON。
    // 如果用户在聊天/平台页登录过，我们就能拿到 user_id；否则 null 也无妨（best-effort）。
    try {
      var raw = lsGet('cancri_supabase_auth');
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      return (parsed && parsed.access_token) ? String(parsed.access_token) : '';
    } catch (e) { return ''; }
  }

  // ── fetch 环形缓冲（最近 10 条）────────────────────────────────────
  var fetchRing = [];
  var FETCH_RING_SIZE = 10;

  function pushFetchEvent(evt) {
    fetchRing.push(evt);
    if (fetchRing.length > FETCH_RING_SIZE) fetchRing.shift();
  }

  function instrumentFetch() {
    if (typeof window.fetch !== 'function') return;
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var startedAt = (window.performance && performance.now) ? performance.now() : Date.now();
      var method = 'GET';
      var url = '';
      try {
        if (typeof input === 'string') { url = input; }
        else if (input && input.url) { url = input.url; }
        if (init && init.method) method = String(init.method).toUpperCase();
        else if (input && input.method) method = String(input.method).toUpperCase();
      } catch (e) { /* ignore */ }

      // 不收集自身上报请求，避免无限循环
      var isSelfReport = (url.indexOf('chat-gateway') >= 0);

      return orig(input, init).then(function (resp) {
        if (!isSelfReport) {
          var endedAt = (window.performance && performance.now) ? performance.now() : Date.now();
          pushFetchEvent({
            url: String(url).slice(0, 300),
            method: method,
            status: resp ? resp.status : null,
            duration_ms: Math.round(endedAt - startedAt),
            ts: new Date().toISOString(),
          });
        }
        return resp;
      }, function (err) {
        if (!isSelfReport) {
          var endedAt = (window.performance && performance.now) ? performance.now() : Date.now();
          pushFetchEvent({
            url: String(url).slice(0, 300),
            method: method,
            status: 0,
            duration_ms: Math.round(endedAt - startedAt),
            ts: new Date().toISOString(),
          });
        }
        throw err;
      });
    };
  }

  // ── 错误上报 ──────────────────────────────────────────────────────
  // 同一 fingerprint 在 30 秒内最多上报 2 次，防止 setInterval 报错刷量
  var reportThrottle = {};
  var THROTTLE_WINDOW_MS = 30000;
  var THROTTLE_MAX_PER_KEY = 2;

  function fingerprintOf(msg, stack) {
    var input = (msg || '') + '|' + (stack || '').slice(0, 200);
    var h = 0;
    for (var i = 0; i < input.length; i++) {
      h = ((h << 5) - h) + input.charCodeAt(i);
      h |= 0;
    }
    return String(h);
  }

  function shouldReport(msg, stack) {
    var key = fingerprintOf(msg, stack);
    var now = Date.now();
    var bucket = reportThrottle[key];
    if (!bucket || bucket.resetAt < now) {
      reportThrottle[key] = { count: 1, resetAt: now + THROTTLE_WINDOW_MS };
      return true;
    }
    if (bucket.count >= THROTTLE_MAX_PER_KEY) return false;
    bucket.count++;
    return true;
  }

  function reportError(level, message, stack) {
    var consent = lsGet(CONSENT_KEY);
    if (consent !== 'accept') return;
    if (!shouldReport(message, stack)) return;

    var payload = {
      endpoint: 'client_error_report',
      consent_level: 'accept',
      anon_id: getOrCreateAnonId(),
      level: level,
      message: String(message || '').slice(0, 2000),
      stack: String(stack || '').slice(0, 8000),
      url: String(location.href || '').slice(0, 500),
      viewport: getViewport(),
      recent_fetches: fetchRing.slice(),
    };

    var token = getAccessToken();
    if (token) payload.__auth_token = token;

    var bodyStr;
    try { bodyStr = JSON.stringify(payload); } catch (e) { return; }

    var headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
    };

    // 用 keepalive fetch（页面卸载时也能发出去），不用 sendBeacon 因为它不让设自定义 header
    try {
      fetch(GW, { method: 'POST', headers: headers, body: bodyStr, keepalive: true }).catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  function recordConsent(level) {
    lsSet(CONSENT_KEY, level);
    lsSet(CONSENT_TS_KEY, String(Date.now()));

    var payload = {
      endpoint: 'client_consent_record',
      consent_level: level,
      anon_id: getOrCreateAnonId(),
    };
    var token = getAccessToken();
    if (token) payload.__auth_token = token;
    var headers = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY),
    };
    try {
      fetch(GW, { method: 'POST', headers: headers, body: JSON.stringify(payload), keepalive: true })
        .catch(function () { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  // ── 错误捕获 ──────────────────────────────────────────────────────
  function registerErrorHandlers() {
    var prevOnerror = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
      try {
        var msg = String(message || '');
        var stack = error && error.stack ? String(error.stack)
          : (source + ':' + lineno + ':' + colno);
        reportError('error', msg, stack);
      } catch (e) { /* ignore */ }
      if (typeof prevOnerror === 'function') {
        try { return prevOnerror.apply(this, arguments); } catch (e) { /* ignore */ }
      }
      return false; // 不阻止浏览器默认错误处理
    };

    window.addEventListener('unhandledrejection', function (ev) {
      try {
        var reason = ev && ev.reason;
        var msg, stack;
        if (reason && typeof reason === 'object') {
          msg = String(reason.message || reason.code || reason);
          stack = String(reason.stack || '');
        } else {
          msg = String(reason || 'unhandledrejection');
          stack = '';
        }
        reportError('rejection', msg, stack);
      } catch (e) { /* ignore */ }
    });
  }

  // ── 同意弹窗 UI ───────────────────────────────────────────────────
  function injectBannerStyles() {
    if (document.getElementById('cancri-telemetry-style')) return;
    var style = document.createElement('style');
    style.id = 'cancri-telemetry-style';
    style.textContent = '' +
      '.cancri-telemetry-banner{position:fixed;right:16px;bottom:16px;z-index:2147483600;' +
      'width:min(360px,calc(100vw - 32px));padding:16px 18px 14px;border-radius:14px;' +
      'background:rgba(20,22,28,0.97);color:#f3f3f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;' +
      'font-size:13px;line-height:1.55;box-shadow:0 12px 32px rgba(0,0,0,0.32);' +
      'border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
      'transform:translateY(8px);opacity:0;transition:opacity .25s ease,transform .25s ease;}' +
      '.cancri-telemetry-banner.is-visible{transform:translateY(0);opacity:1;}' +
      '.cancri-telemetry-banner h4{margin:0 0 6px;font-size:14px;font-weight:600;color:#fff;letter-spacing:0.01em;}' +
      '.cancri-telemetry-banner p{margin:0 0 12px;font-size:12.5px;color:rgba(243,243,245,0.78);}' +
      '.cancri-telemetry-actions{display:flex;gap:8px;justify-content:flex-end;}' +
      '.cancri-telemetry-actions button{padding:7px 14px;font-size:12.5px;font-weight:500;border-radius:8px;cursor:pointer;' +
      'border:1px solid rgba(255,255,255,0.16);background:transparent;color:#f3f3f5;transition:background .15s ease,border-color .15s ease;font-family:inherit;}' +
      '.cancri-telemetry-actions button:hover{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.32);}' +
      '.cancri-telemetry-actions button.is-primary{background:#6366f1;border-color:#6366f1;color:#fff;}' +
      '.cancri-telemetry-actions button.is-primary:hover{background:#5457e8;border-color:#5457e8;}' +
      '@media (max-width:480px){.cancri-telemetry-banner{right:12px;left:12px;bottom:12px;width:auto;}}';
    document.head.appendChild(style);
  }

  function showBanner() {
    if (document.getElementById('cancri-telemetry-banner')) return;
    injectBannerStyles();

    var el = document.createElement('div');
    el.id = 'cancri-telemetry-banner';
    el.className = 'cancri-telemetry-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', '错误日志收集请求');
    el.innerHTML = '' +
      '<h4>帮我们更快修 bug</h4>' +
      '<p>仅当你遇到错误时，我们会收集浏览器型号、错误堆栈和最近的请求记录用来定位问题。不会收集聊天内容，也不会共享给第三方。</p>' +
      '<div class="cancri-telemetry-actions">' +
        '<button type="button" data-act="decline">拒绝</button>' +
        '<button type="button" class="is-primary" data-act="accept">同意</button>' +
      '</div>';
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-visible'); });

    function close(level) {
      recordConsent(level);
      el.classList.remove('is-visible');
      setTimeout(function () { try { el.remove(); } catch (e) { /* ignore */ } }, 280);
      if (level === 'accept') {
        // 同意后立刻启用捕获，本次会话内剩余的错误就能上报
        registerErrorHandlers();
      }
    }

    el.querySelector('[data-act="accept"]').addEventListener('click', function () { close('accept'); });
    el.querySelector('[data-act="decline"]').addEventListener('click', function () { close('decline'); });
  }

  // ── 启动逻辑 ──────────────────────────────────────────────────────
  function boot() {
    // fetch 拦截总是装上（环形缓冲不需要同意；这只是内存数据，不上报就丢）
    instrumentFetch();

    var consent = lsGet(CONSENT_KEY);
    if (consent === 'accept') {
      registerErrorHandlers();
      return;
    }
    if (consent === 'decline') {
      return; // 尊重用户决策，不弹也不采集
    }
    // 未决策 → 等 DOM 就绪后弹卡片
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner, { once: true });
    } else {
      showBanner();
    }
  }

  // 暴露简单 API 方便后续手动测试 / 重置
  window.CancriTelemetry = {
    /** 当前决策（'accept' | 'decline' | null） */
    getConsent: function () { return lsGet(CONSENT_KEY); },
    /** 重置决策，下次刷新会重新弹窗（仅用于调试） */
    reset: function () {
      try { localStorage.removeItem(CONSENT_KEY); localStorage.removeItem(CONSENT_TS_KEY); } catch (e) { /* ignore */ }
    },
    /** 手动触发一次测试上报（仅在已同意时生效） */
    test: function () {
      reportError('error', '__cancri_telemetry_test__', 'manual test trigger from CancriTelemetry.test()');
    },
  };

  boot();
})();
