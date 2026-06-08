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
  /** UI / 收集范围变更时 bump，旧决策视为无效并重新弹窗 */
  var CONSENT_POLICY_VERSION = '2026-06-08-trae';
  var CONSENT_POLICY_KEY = 'cancri_telemetry_consent_policy';
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
    if (getEffectiveConsent() !== 'accept') return;
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

  function getEffectiveConsent() {
    var consent = lsGet(CONSENT_KEY);
    if (consent !== 'accept' && consent !== 'decline') return null;
    if (lsGet(CONSENT_POLICY_KEY) !== CONSENT_POLICY_VERSION) return null;
    return consent;
  }

  function recordConsent(level) {
    lsSet(CONSENT_KEY, level);
    lsSet(CONSENT_TS_KEY, String(Date.now()));
    lsSet(CONSENT_POLICY_KEY, CONSENT_POLICY_VERSION);

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

  // ── 同意弹窗 UI（TRAE elegant-black 风格）────────────────────────────
  function getLang() {
    try { return (localStorage.getItem('lang') || 'zh').toLowerCase(); } catch (e) { return 'zh'; }
  }

  function privacyHref() {
    var p = String(location.pathname || '');
    if (/\/chat\/api(\/|$)/.test(p)) return '../../privacy.html';
    if (/\/chat(\/|$)/.test(p)) return '../privacy.html';
    return 'privacy.html';
  }

  function copyForLang(lang) {
    var isEn = lang === 'en';
    var privacy = privacyHref();
    return {
      title: isEn ? 'Accept cookies from NexusV on this browser?' : '是否在此浏览器接受 NexusV 的 Cookie？',
      desc: isEn
        ? 'NexusV uses essential cookies and similar technologies to provide, improve and secure our services.<br>By clicking "Accept All", we may also collect diagnostic data when a page error occurs (browser type, error stack, recent request URLs) to fix bugs — never chat content or ad tracking. Click "Decline All" to skip diagnostics. Learn more in our <a class="cc__link" href="' + privacy + '" target="_blank" rel="noopener">Privacy Policy</a>.'
        : 'NexusV 使用必要的 Cookie 和类似技术来提供、改进和保护我们的服务。<br>点击「全部接受」后，我们还会在发生页面错误时收集诊断信息（浏览器型号、错误堆栈、最近请求记录），用于修复 bug；不会收集聊天内容，也不会用于广告追踪。点击「全部拒绝」则不上报诊断信息。详见 <a class="cc__link" href="' + privacy + '" target="_blank" rel="noopener">隐私协议</a>。',
      accept: isEn ? 'Accept All' : '全部接受',
      decline: isEn ? 'Decline All' : '全部拒绝',
      manage: isEn ? 'Manage preferences' : '管理偏好',
      prefsTitle: isEn ? 'Cookie preferences' : 'Cookie 偏好设置',
      prefsEssential: isEn
        ? '<strong>Essential</strong> — always on: login session, theme and language preferences (localStorage).'
        : '<strong>必要</strong> — 始终启用：登录态、主题与语言偏好（localStorage）。',
      prefsDiag: isEn
        ? '<strong>Diagnostics</strong> — optional: uncaught JS errors only when you choose Accept All. No chat content, forms, or ad tracking.'
        : '<strong>错误诊断</strong> — 可选：仅在你选择「全部接受」后，于未捕获异常时上报；不含聊天内容、表单输入或广告追踪。',
      prefsLink: isEn ? 'Read full Privacy Policy' : '阅读完整隐私协议',
      back: isEn ? 'Back' : '返回',
    };
  }

  function injectBannerStyles() {
    if (document.getElementById('cancri-telemetry-style')) return;
    var style = document.createElement('style');
    style.id = 'cancri-telemetry-style';
    style.textContent = '' +
      '#cc-main.cc--elegant-black{color-scheme:dark;' +
      '--cc-bg:#000;--cc-primary-color:#eff4f6;--cc-secondary-color:hsla(0,0%,100%,.8);' +
      '--cc-btn-primary-bg:#fff;--cc-btn-primary-color:#000;--cc-btn-primary-border-color:#fff;' +
      '--cc-btn-primary-hover-bg:hsla(0,0%,100%,.8);--cc-btn-primary-hover-color:#000;' +
      '--cc-btn-secondary-bg:hsla(0,0%,100%,.039);--cc-btn-secondary-color:var(--cc-primary-color);' +
      '--cc-btn-secondary-border-color:#252729;--cc-btn-secondary-hover-bg:#252729;' +
      '--cc-btn-secondary-hover-color:#fff;--cc-btn-secondary-hover-border-color:#252729;' +
      '--cc-separator-border-color:#252729;--cc-link-color:#fff;' +
      '--cc-modal-border-radius:.5rem;--cc-btn-border-radius:3px;--cc-modal-margin:1rem;' +
      '--cc-z-index:2147483647;--cc-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;}' +
      '#cc-main{background:transparent;color:var(--cc-primary-color);font-family:var(--cc-font-family);' +
      'font-size:16px;font-weight:400;line-height:1.15;position:fixed;inset:0;z-index:var(--cc-z-index);pointer-events:none;}' +
      '#cc-main .cm-wrapper{pointer-events:auto;position:fixed;right:var(--cc-modal-margin);bottom:var(--cc-modal-margin);z-index:1;}' +
      '#cc-main .cm{background:var(--cc-bg);border:1px solid var(--cc-separator-border-color);border-radius:var(--cc-modal-border-radius);' +
      'box-shadow:0 .625em 1.875em rgba(0,0,2,.3);display:flex;flex-direction:column;overflow:hidden;max-width:36em;width:min(36em,calc(100vw - 2rem));' +
      'opacity:0;transform:translateY(1em);transition:opacity .25s ease,transform .25s ease,visibility .25s ease;visibility:hidden;}' +
      '#cc-main.is-visible .cm{opacity:1;transform:translateY(0);visibility:visible;}' +
      '#cc-main .cm__body{display:flex;flex-direction:column;justify-content:space-between;}' +
      '#cc-main .cm__texts{display:flex;flex-direction:column;justify-content:center;padding:1rem 0 0;}' +
      '#cc-main .cm__title,#cc-main .cm__desc{padding:0 1.3rem;margin:0;}' +
      '#cc-main .cm__title{font-size:1.05em;font-weight:600;color:var(--cc-primary-color);}' +
      '#cc-main .cm__title+.cm__desc{margin-top:1.1em;}' +
      '#cc-main .cm__desc{color:var(--cc-secondary-color);font-size:.9em;line-height:1.5;padding-bottom:1em;}' +
      '#cc-main .cc__link{color:var(--cc-link-color);font-weight:600;text-decoration:underline;text-underline-offset:2px;}' +
      '#cc-main .cc__link:hover{color:var(--cc-primary-color);}' +
      '#cc-main .cm__btns{border-top:1px solid var(--cc-separator-border-color);display:flex;flex-direction:row-reverse;' +
      'justify-content:space-between;align-items:stretch;padding:1rem 1.3rem;gap:.375rem;}' +
      '#cc-main .cm__btn-group{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:.375rem;}' +
      '#cc-main .cm__btn{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:.5em 1em;' +
      'font-family:inherit;font-size:.82em;font-weight:600;text-align:center;cursor:pointer;border-radius:var(--cc-btn-border-radius);' +
      'background:var(--cc-btn-primary-bg);border:1px solid var(--cc-btn-primary-border-color);color:var(--cc-btn-primary-color);' +
      'transition:background-color .15s ease,border-color .15s ease,color .15s ease;}' +
      '#cc-main .cm__btn:hover{background:var(--cc-btn-primary-hover-bg);color:var(--cc-btn-primary-hover-color);}' +
      '#cc-main .cm__btn--secondary{background:var(--cc-btn-secondary-bg);border-color:var(--cc-btn-secondary-border-color);color:var(--cc-btn-secondary-color);}' +
      '#cc-main .cm__btn--secondary:hover{background:var(--cc-btn-secondary-hover-bg);border-color:var(--cc-btn-secondary-hover-border-color);color:var(--cc-btn-secondary-hover-color);}' +
      '#cc-main .cm__prefs{padding:1rem 1.3rem 1.2rem;display:none;}' +
      '#cc-main .cm__prefs.is-open{display:block;}' +
      '#cc-main .cm__prefs h3{margin:0 0 .9em;font-size:1.05em;font-weight:600;color:var(--cc-primary-color);}' +
      '#cc-main .cm__prefs p{margin:0 0 .75em;font-size:.88em;line-height:1.55;color:var(--cc-secondary-color);}' +
      '#cc-main .cm__prefs a{color:var(--cc-link-color);font-weight:600;text-decoration:underline;}' +
      '#cc-main .cm__panel-main.is-hidden{display:none;}' +
      '@media screen and (max-width:640px){#cc-main{--cc-modal-margin:.5em;}' +
      '#cc-main .cm-wrapper{left:var(--cc-modal-margin);right:var(--cc-modal-margin);}' +
      '#cc-main .cm{width:auto;max-width:none;}' +
      '#cc-main .cm__btns{flex-direction:column-reverse;}' +
      '#cc-main .cm__btn-group{grid-auto-flow:row;width:100%;}' +
      '#cc-main .cm__title,#cc-main .cm__desc,#cc-main .cm__btns{padding-left:1.1rem;padding-right:1.1rem;}}';
    document.head.appendChild(style);
  }

  function showBanner() {
    if (document.getElementById('cc-main')) return;
    injectBannerStyles();

    var copy = copyForLang(getLang());
    var root = document.createElement('div');
    root.id = 'cc-main';
    root.className = 'cc--elegant-black';
    root.setAttribute('data-nosnippet', '');
    root.innerHTML = '' +
      '<div class="cm-wrapper cc--anim">' +
        '<div class="cm cm--box cm--wide cm--bottom cm--right cm--flip" role="dialog" aria-modal="true" aria-labelledby="cm__title" aria-describedby="cm__desc">' +
          '<div class="cm__body">' +
            '<div class="cm__panel-main" id="cancri-cm-main">' +
              '<div class="cm__texts">' +
                '<h2 id="cm__title" class="cm__title">' + copy.title + '</h2>' +
                '<p id="cm__desc" class="cm__desc">' + copy.desc + '</p>' +
              '</div>' +
              '<div class="cm__btns">' +
                '<div class="cm__btn-group">' +
                  '<button type="button" class="cm__btn" data-act="accept"><span>' + copy.accept + '</span></button>' +
                  '<button type="button" class="cm__btn" data-act="decline"><span>' + copy.decline + '</span></button>' +
                '</div>' +
                '<div class="cm__btn-group">' +
                  '<button type="button" class="cm__btn cm__btn--secondary" data-act="manage"><span>' + copy.manage + '</span></button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="cm__prefs" id="cancri-cm-prefs" hidden>' +
              '<h3>' + copy.prefsTitle + '</h3>' +
              '<p>' + copy.prefsEssential + '</p>' +
              '<p>' + copy.prefsDiag + '</p>' +
              '<p><a href="' + privacyHref() + '" target="_blank" rel="noopener">' + copy.prefsLink + '</a></p>' +
              '<button type="button" class="cm__btn cm__btn--secondary" data-act="back" style="margin-top:.5rem;min-width:7rem;"><span>' + copy.back + '</span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);
    requestAnimationFrame(function () { root.classList.add('is-visible'); });

    var mainPanel = root.querySelector('#cancri-cm-main');
    var prefsPanel = root.querySelector('#cancri-cm-prefs');

    function close(level) {
      recordConsent(level);
      root.classList.remove('is-visible');
      setTimeout(function () { try { root.remove(); } catch (e) { /* ignore */ } }, 280);
      if (level === 'accept') registerErrorHandlers();
    }

    function showPrefs() {
      mainPanel.classList.add('is-hidden');
      prefsPanel.hidden = false;
      prefsPanel.classList.add('is-open');
    }

    function hidePrefs() {
      prefsPanel.hidden = true;
      prefsPanel.classList.remove('is-open');
      mainPanel.classList.remove('is-hidden');
    }

    root.querySelector('[data-act="accept"]').addEventListener('click', function () { close('accept'); });
    root.querySelector('[data-act="decline"]').addEventListener('click', function () { close('decline'); });
    root.querySelector('[data-act="manage"]').addEventListener('click', showPrefs);
    root.querySelector('[data-act="back"]').addEventListener('click', hidePrefs);
  }

  // ── 启动逻辑 ──────────────────────────────────────────────────────
  function boot() {
    // fetch 拦截总是装上（环形缓冲不需要同意；这只是内存数据，不上报就丢）
    instrumentFetch();

    var consent = getEffectiveConsent();
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
    getConsent: function () { return getEffectiveConsent(); },
    /** 重置决策，下次刷新会重新弹窗（仅用于调试） */
    reset: function () {
      try {
        localStorage.removeItem(CONSENT_KEY);
        localStorage.removeItem(CONSENT_TS_KEY);
        localStorage.removeItem(CONSENT_POLICY_KEY);
      } catch (e) { /* ignore */ }
    },
    /** 手动触发一次测试上报（仅在已同意时生效） */
    test: function () {
      reportError('error', '__cancri_telemetry_test__', 'manual test trigger from CancriTelemetry.test()');
    },
  };

  boot();
})();
