/*!
 * Cancri 设备 / 浏览器指纹（反多账号）
 *
 * 用户登录后进入页面 → 采集：
 *   1. WebRTC IP（VPN 改不了 → 暴露真实 ISP 出口 / 本地 IP）
 *   2. Canvas / WebGL / Audio 指纹（硬件层差异）
 *   3. navigator 全家桶（UA / platform / languages / hardware / memory）
 *   4. 字体探测、屏幕、时区、连接信息
 *
 * 综合所有信号 SHA-256 → visitor_id。同一 visitor_id 跨多个 user_id =
 * 高度疑似多账号，后台用 v_suspect_multi_accounts 视图查。
 *
 * 行为：
 *   - 仅登录用户采集（拿到 access_token 才上报）
 *   - 24h 内同一浏览器只上报一次（节流避免刷量）
 *   - 失败静默（不影响业务）
 *
 * 加载方式（与 telemetry.js 一致）：
 *   <script src="../js/fingerprint.js?v=2026-05-16-fp" defer></script>
 *   必须先加载 cancri_config.js（注入 SUPABASE_URL / ANON_KEY）。
 */

(function () {
  'use strict';

  if (window.__cancri_fingerprint_loaded) return;
  window.__cancri_fingerprint_loaded = true;

  // ── 配置 ──────────────────────────────────────────────────────────
  var SUPABASE_URL = window.__SUPABASE_URL__ || 'https://chat.nexusvai.xyz';
  var SUPABASE_ANON_KEY = window.__SUPABASE_ANON_KEY__ || 'sb_publishable_zK_fV6gwNta8Ne8aFL_n4g_cm8HP4lY';
  var GW = SUPABASE_URL + '/functions/v1/chat-gateway';

  var SUBMIT_INTERVAL_MS = 24 * 3600 * 1000;
  var STORAGE_LAST_KEY = 'cancri_fp_last_submit';
  var STORAGE_VISITOR_KEY = 'cancri_visitor_id';
  var ANON_ID_KEY = 'cancri_anon_id';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

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

  function getAccessToken() {
    try {
      var raw = lsGet('cancri_supabase_auth');
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      return (parsed && parsed.access_token) ? String(parsed.access_token) : '';
    } catch (e) { return ''; }
  }

  // ── 1. WebRTC IP 采集 ──────────────────────────────────────────────
  // STUN 协议会触发浏览器把 host candidate（真实本机 IP）和 srflx
  // candidate（NAT/VPN 后的公网 IP）发出来。VPN 不接管 WebRTC 时，
  // host candidate 仍是物理网卡 IP，srflx 仍是真实 ISP 出口。
  // 现代 Chrome 默认对非 same-origin 隐藏 host IP 为 mDNS（xxx.local），
  // 但 srflx 仍可拿到，足够标记"VPN 没接管 UDP"。
  function collectWebRtcIps(timeoutMs) {
    return new Promise(function (resolve) {
      var localIps = {};
      var publicIps = {};
      var ipv4Re = /(\d{1,3}\.){3}\d{1,3}/;
      var ipv6Re = /([0-9a-f]{1,4}:){2,}[0-9a-f]{1,4}/i;

      var RTCPC = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
      if (!RTCPC) return resolve({ local: [], public: [] });

      var pc;
      try {
        pc = new RTCPC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        pc.createDataChannel('cancri-fp');
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function () { /* ignore */ });
      } catch (e) {
        return resolve({ local: [], public: [] });
      }

      pc.onicecandidate = function (ev) {
        if (!ev || !ev.candidate) return;
        var cand = ev.candidate.candidate || '';
        if (!cand) return;
        var m = cand.match(ipv4Re) || cand.match(ipv6Re);
        if (!m) return;
        var ip = m[0];
        // mDNS（xxx.local）不会进 ipv4/v6 Regex，所以这里命中的是真实 IP
        if (cand.indexOf('typ host') >= 0) {
          localIps[ip] = 1;
        } else if (cand.indexOf('typ srflx') >= 0 || cand.indexOf('typ prflx') >= 0) {
          publicIps[ip] = 1;
        }
      };

      setTimeout(function () {
        try { pc.close(); } catch (e) { /* ignore */ }
        resolve({ local: Object.keys(localIps), public: Object.keys(publicIps) });
      }, timeoutMs || 2500);
    });
  }

  // ── 2. Canvas 指纹 ─────────────────────────────────────────────────
  // 不同 GPU / 字体渲染引擎绘出的同一段文字像素级不同。
  function getCanvasFingerprint() {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 60;
      var ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('Cancri \u00e9\u00e1\u00f1 \u4e2d\u6587 fjordbank 0123', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Cancri \u00e9\u00e1\u00f1 \u4e2d\u6587 fjordbank 0123', 4, 17);
      // toDataURL 是 GPU + 浏览器实现差异的核心来源
      return cheapHash(canvas.toDataURL());
    } catch (e) { return ''; }
  }

  // ── 3. WebGL 指纹 ──────────────────────────────────────────────────
  function getWebGlFingerprint() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { fp: '', vendor: '', renderer: '' };
      var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      var vendor = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '')
        : String(gl.getParameter(gl.VENDOR) || '');
      var renderer = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '')
        : String(gl.getParameter(gl.RENDERER) || '');
      var maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
      var parts = [
        gl.getParameter(gl.VERSION),
        gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
        gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) ? gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE).toString() : '',
        maxViewportDims ? maxViewportDims.toString() : '',
        (gl.getSupportedExtensions() || []).sort().join(',')
      ].join('|');
      return {
        fp: cheapHash(vendor + '|' + renderer + '|' + parts),
        vendor: vendor.slice(0, 250),
        renderer: renderer.slice(0, 250)
      };
    } catch (e) { return { fp: '', vendor: '', renderer: '' }; }
  }

  // ── 4. AudioContext 指纹 ──────────────────────────────────────────
  // OfflineAudioContext 同样的 oscillator + compressor 链路，在不同
  // OS / 浏览器 fl32 实现下，输出的浮点值有 ulp 级别差异，能稳定区分。
  function getAudioFingerprint() {
    return new Promise(function (resolve) {
      try {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) return resolve('');
        var ctx = new OAC(1, 44100, 44100);
        var oscillator = ctx.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 10000;
        var compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -50;
        compressor.knee.value = 40;
        compressor.ratio.value = 12;
        compressor.attack.value = 0;
        compressor.release.value = 0.25;
        oscillator.connect(compressor);
        compressor.connect(ctx.destination);
        oscillator.start(0);
        ctx.startRendering();

        var settled = false;
        ctx.oncomplete = function (ev) {
          if (settled) return;
          settled = true;
          try {
            var buf = ev.renderedBuffer.getChannelData(0);
            var sum = 0;
            for (var i = 4500; i < 5000; i++) sum += Math.abs(buf[i]);
            resolve(cheapHash(sum.toString()));
          } catch (e) { resolve(''); }
          try { oscillator.disconnect(); compressor.disconnect(); } catch (e) { /* ignore */ }
        };
        // 2s 超时兜底（旧浏览器 / 静音设备可能不触发 oncomplete）
        setTimeout(function () {
          if (settled) return;
          settled = true;
          resolve('');
        }, 2000);
      } catch (e) { resolve(''); }
    });
  }

  // ── 5. 字体探测 ────────────────────────────────────────────────────
  // 经典的"渲染同一字符串，看宽度/高度有没有从基准字体变化"。
  // 控制范围：候选 ≈ 18 个常用字体，整个探测 < 30ms。
  function detectFonts() {
    var detected = [];
    try {
      var body = document.body;
      if (!body) return detected;
      var candidates = [
        'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
        'Tahoma', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Lucida Console',
        'Microsoft YaHei', 'SimSun', 'SimHei', 'PingFang SC', 'Hiragino Sans GB',
        'Helvetica', 'Roboto', 'Segoe UI'
      ];
      var baseFonts = ['monospace', 'sans-serif', 'serif'];
      var testString = 'mmmmmmmmmmlli\u4e2d\u6587';
      var testSize = '72px';

      var span = document.createElement('span');
      span.style.cssText = 'position:absolute;left:-9999px;top:-9999px;font-size:' + testSize + ';line-height:normal;';
      span.innerText = testString;

      var defaultWidth = {};
      var defaultHeight = {};
      for (var i = 0; i < baseFonts.length; i++) {
        var base = baseFonts[i];
        span.style.fontFamily = base;
        body.appendChild(span);
        defaultWidth[base] = span.offsetWidth;
        defaultHeight[base] = span.offsetHeight;
        body.removeChild(span);
      }

      for (var j = 0; j < candidates.length; j++) {
        var font = candidates[j];
        var matched = false;
        for (var k = 0; k < baseFonts.length; k++) {
          var b = baseFonts[k];
          span.style.fontFamily = "'" + font + "'," + b;
          body.appendChild(span);
          if (span.offsetWidth !== defaultWidth[b] || span.offsetHeight !== defaultHeight[b]) {
            matched = true;
          }
          body.removeChild(span);
          if (matched) break;
        }
        if (matched) detected.push(font);
      }
    } catch (e) { /* ignore */ }
    return detected;
  }

  // ── 6. 简单 hash（fallback / 字段级 hash 用）────────────────────────
  function cheapHash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(16);
  }

  // ── 7. SHA-256（综合 visitor_id 用，提高碰撞抵抗）──────────────────
  function sha256Hex(text) {
    if (!(window.crypto && window.crypto.subtle && window.TextEncoder)) {
      return Promise.resolve(cheapHash(text));
    }
    try {
      var buf = new TextEncoder().encode(text);
      return window.crypto.subtle.digest('SHA-256', buf).then(function (digest) {
        var arr = new Uint8Array(digest);
        var hex = '';
        for (var i = 0; i < arr.length; i++) {
          hex += arr[i].toString(16).padStart(2, '0');
        }
        return hex;
      });
    } catch (e) {
      return Promise.resolve(cheapHash(text));
    }
  }

  // ── 8. 节流判断 ─────────────────────────────────────────────────────
  function shouldSubmit() {
    try {
      var last = parseInt(lsGet(STORAGE_LAST_KEY) || '0', 10);
      return (Date.now() - last) > SUBMIT_INTERVAL_MS;
    } catch (e) { return true; }
  }

  function markSubmitted() {
    lsSet(STORAGE_LAST_KEY, String(Date.now()));
  }

  // ── 主流程：采集所有信号 → 综合 visitor_id → 上报 ─────────────────
  function collectAndSubmit(opts) {
    opts = opts || {};
    var forced = !!opts.force;
    var token = getAccessToken();
    // 默认只在登录态采集：匿名访问无 user_id 关联，存了也没法判多账号。
    // 调用方可以传 { allowAnonymous: true } 在某些公开页强行采集观察。
    if (!token && !opts.allowAnonymous) return Promise.resolve({ skipped: 'no_auth' });
    if (!forced && !shouldSubmit()) return Promise.resolve({ skipped: 'throttled' });

    return Promise.all([
      collectWebRtcIps(2500),
      getAudioFingerprint(),
    ]).then(function (results) {
      var webrtc = results[0] || { local: [], public: [] };
      var audioFp = results[1] || '';
      var canvasFp = getCanvasFingerprint();
      var webgl = getWebGlFingerprint();
      var fonts = detectFonts();

      var nav = navigator || {};
      var screen = window.screen || {};
      var conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;

      var uaData = null;
      if (nav.userAgentData) {
        uaData = {
          brands: (nav.userAgentData.brands || []).map(function (b) {
            return { brand: String(b.brand || ''), version: String(b.version || '') };
          }).slice(0, 8),
          mobile: !!nav.userAgentData.mobile,
          platform: String(nav.userAgentData.platform || '')
        };
      }

      var tz = '';
      var tzOffset = null;
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
      try { tzOffset = new Date().getTimezoneOffset(); } catch (e) { /* ignore */ }

      var languages = (nav.languages && nav.languages.length)
        ? Array.prototype.slice.call(nav.languages, 0, 10)
        : (nav.language ? [nav.language] : []);

      var plugins = [];
      try {
        if (nav.plugins && nav.plugins.length) {
          for (var p = 0; p < Math.min(nav.plugins.length, 20); p++) {
            var name = (nav.plugins[p] && nav.plugins[p].name) ? String(nav.plugins[p].name) : '';
            if (name) plugins.push(name);
          }
        }
      } catch (e) { /* ignore */ }

      // 构造综合签名（visitor_id 来源），不含 server IP / WebRTC（这些
      // 是检测信号，不进 visitor_id），保证同一设备换网络仍同 visitor_id。
      var visitorParts = [
        nav.userAgent || '',
        nav.platform || '',
        languages.join(','),
        tz,
        canvasFp,
        webgl.fp,
        webgl.vendor,
        webgl.renderer,
        audioFp,
        fonts.join(','),
        String(nav.hardwareConcurrency || 0),
        String(nav.deviceMemory || 0),
        screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
        String(nav.maxTouchPoints || 0)
      ].join('||');

      return sha256Hex(visitorParts).then(function (visitorId) {
        lsSet(STORAGE_VISITOR_KEY, visitorId);

        // 存储 quota（async，best-effort）
        var quotaPromise = (nav.storage && nav.storage.estimate)
          ? nav.storage.estimate().then(function (est) { return est && est.quota ? est.quota : null; }, function () { return null; })
          : Promise.resolve(null);

        return quotaPromise.then(function (storageQuota) {
          var payload = {
            endpoint: 'device_fingerprint',
            visitor_id: visitorId,
            anon_id: getOrCreateAnonId(),
            ua: String(nav.userAgent || ''),
            platform: String(nav.platform || ''),
            vendor: String(nav.vendor || ''),
            user_agent_data: uaData,
            timezone: tz,
            timezone_offset: tzOffset,
            languages: languages,
            hardware_concurrency: (typeof nav.hardwareConcurrency === 'number') ? nav.hardwareConcurrency : null,
            device_memory: (typeof nav.deviceMemory === 'number') ? nav.deviceMemory : null,
            max_touch_points: (typeof nav.maxTouchPoints === 'number') ? nav.maxTouchPoints : null,
            screen: {
              w: screen.width || 0, h: screen.height || 0,
              aw: screen.availWidth || 0, ah: screen.availHeight || 0,
              depth: screen.colorDepth || 0,
              ratio: window.devicePixelRatio || 1
            },
            canvas_fp: canvasFp,
            webgl_fp: webgl.fp,
            webgl_vendor: webgl.vendor,
            webgl_renderer: webgl.renderer,
            audio_fp: audioFp,
            fonts: fonts,
            cookie_enabled: !!nav.cookieEnabled,
            do_not_track: String(nav.doNotTrack || ''),
            plugins: plugins,
            storage_quota: storageQuota,
            connection: conn ? {
              downlink: (typeof conn.downlink === 'number') ? conn.downlink : null,
              effectiveType: String(conn.effectiveType || ''),
              rtt: (typeof conn.rtt === 'number') ? conn.rtt : null,
              saveData: !!conn.saveData
            } : null,
            webrtc_local_ips: webrtc.local,
            webrtc_public_ips: webrtc.public
          };
          if (token) payload.__auth_token = token;

          var headers = {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + (token || SUPABASE_ANON_KEY)
          };

          var bodyStr;
          try { bodyStr = JSON.stringify(payload); } catch (e) { return { skipped: 'serialize_failed' }; }

          return fetch(GW, {
            method: 'POST',
            headers: headers,
            body: bodyStr,
            keepalive: true,
            credentials: 'omit'
          }).then(function (resp) {
            if (resp && resp.ok) {
              markSubmitted();
              return resp.json().catch(function () { return { ok: true }; });
            }
            return { ok: false, status: resp ? resp.status : 0 };
          }, function () {
            return { ok: false, error: 'network' };
          });
        });
      });
    });
  }

  // ── 启动：DOM ready 后 2 秒触发一次（避开页面加载抖动）─────────────
  function boot() {
    // 避开页面初始化高峰
    setTimeout(function () {
      collectAndSubmit().catch(function () { /* silent */ });
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // 暴露调试 API（不影响主流程）
  window.CancriFingerprint = {
    /** 立即采集 + 强制上报（忽略 24h 节流），用于调试 */
    submitNow: function () { return collectAndSubmit({ force: true }); },
    /** 读取当前 visitor_id */
    getVisitorId: function () { return lsGet(STORAGE_VISITOR_KEY) || ''; },
    /** 重置 last_submit，下次刷新会重新上报 */
    reset: function () {
      try { localStorage.removeItem(STORAGE_LAST_KEY); } catch (e) { /* ignore */ }
    }
  };
})();
