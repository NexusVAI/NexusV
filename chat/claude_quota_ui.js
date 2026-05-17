// chat/claude_quota_ui.js
//
// 2026-05-17 新增「额度」面板渲染（替换原「连接器」占位）。
//
// 行为：
//   • 用户点击设置面板左侧 nav data-snav="quota" → 我们的 click handler 触发
//     loadQuotaPanel()，首次拉数据；之后用 60s 内存缓存避免重复拉。
//   • 数据接口：chat-gateway endpoint=get_quota_status，返回：
//        { ok, tier, subscription, free_pool: {budget,consumed,remaining,percent,period_end},
//          daily_paid: {count,limit,remaining,day} }
//   • PAID 用户：附加拉一次 get_my_chat_usage 渲染最近 30 天用量。
//
// 安全：CSP script-src 'self'，本文件外联引入；不使用 eval / Function；样式通过
// 同目录 <style> 块注入（style-src 'unsafe-inline' 暂存，与 claude_ui.js
// 同款做法）。
//
// 与 claude_ui.js 的协作：那里负责升级 pill / billing copy 的 tier UI（is-paid-tier
// class + applyTierUI）；这里只管「额度」段的内容。两者各管一段，互不依赖。

(function () {
  'use strict';

  // ── 配置 ────────────────────────────────────────────────────────
  var CACHE_TTL_MS = 60 * 1000;     // 60 秒内重复打开复用上次数据
  var quotaCache = null;            // { fetchedAt, data }
  var usageCache = null;            // { fetchedAt, data }
  var inflight = null;              // 防 race：并发打开 quota 段
  var inflightUsage = null;
  var rendered = false;             // 是否已渲染（loading 状态切换标志）

  // 注入样式 —— 与 claude.css 的 .claude-form-help / claude-settings-h2 等
  // 协调；颜色全用 var(--*) 跟随主题变量。
  function injectStyleOnce() {
    if (document.getElementById('claudeQuotaStyles')) return;
    var s = document.createElement('style');
    s.id = 'claudeQuotaStyles';
    s.textContent = [
      '.claude-quota-panel { display: flex; flex-direction: column; gap: 18px; }',
      '.claude-quota-card { padding: 16px 18px; border-radius: 12px; background: var(--bg-elev, rgba(255,255,255,0.04)); border: 1px solid var(--border, rgba(255,255,255,0.08)); }',
      '.claude-quota-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 12px; }',
      '.claude-quota-card-title { font-size: 14px; font-weight: 600; color: var(--text, #f5f4ed); }',
      '.claude-quota-card-sub { font-size: 12px; color: var(--text-mute, rgba(255,255,255,0.55)); }',
      '.claude-quota-bar { position: relative; height: 10px; border-radius: 999px; background: var(--bg-input, rgba(255,255,255,0.06)); overflow: hidden; }',
      '.claude-quota-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: var(--accent, #c96442); transition: width 0.3s ease; }',
      '.claude-quota-bar-fill.is-warn { background: #d99e35; }',
      '.claude-quota-bar-fill.is-exhausted { background: #c45252; }',
      '.claude-quota-stat { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; margin-top: 8px; color: var(--text-mute, rgba(255,255,255,0.6)); }',
      '.claude-quota-stat b { color: var(--text, #f5f4ed); font-variant-numeric: tabular-nums; font-weight: 500; }',
      '.claude-quota-note { font-size: 12px; color: var(--text-mute, rgba(255,255,255,0.55)); line-height: 1.55; margin-top: 8px; }',
      '.claude-quota-note a { color: var(--accent, #c96442); }',
      '.claude-tier-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }',
      '.claude-tier-chip.is-free { background: rgba(255,255,255,0.08); color: var(--text-mute, rgba(255,255,255,0.6)); border: 1px solid var(--border, rgba(255,255,255,0.12)); }',
      '.claude-tier-chip.is-paid { background: var(--accent, #c96442); color: #fffaf2; border: 1px solid var(--accent, #c96442); }',
      '.claude-quota-usage-list { display: flex; flex-direction: column; gap: 6px; }',
      '.claude-quota-usage-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 6px 0; border-bottom: 1px dashed var(--border, rgba(255,255,255,0.08)); }',
      '.claude-quota-usage-row:last-child { border-bottom: 0; }',
      '.claude-quota-usage-name { color: var(--text, #f5f4ed); font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11.5px; }',
      '.claude-quota-usage-meta { color: var(--text-mute, rgba(255,255,255,0.55)); font-variant-numeric: tabular-nums; }',
      '.claude-quota-day-grid { display: grid; grid-template-columns: repeat(30, 1fr); gap: 2px; margin-top: 10px; height: 36px; align-items: end; }',
      '.claude-quota-day-bar { background: var(--accent, #c96442); border-radius: 2px 2px 0 0; min-height: 2px; opacity: 0.85; }',
      '.claude-quota-day-bar.is-empty { background: var(--border, rgba(255,255,255,0.1)); opacity: 0.4; }',
      '.claude-quota-err { color: #e08585; font-size: 12.5px; padding: 12px; background: rgba(196,82,82,0.08); border: 1px solid rgba(196,82,82,0.25); border-radius: 8px; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function getAccessToken() {
    try {
      var raw = localStorage.getItem('cancri_supabase_auth');
      if (!raw) return '';
      var parsed = JSON.parse(raw);
      return (parsed && parsed.access_token) ? String(parsed.access_token) : '';
    } catch (e) { return ''; }
  }

  function getGatewayUrl() {
    var base = window.__SUPABASE_URL__ || '';
    return base ? (base + '/functions/v1/chat-gateway') : '';
  }

  // 拉 quota status；带 60s 内存缓存 + inflight 去重
  function fetchQuotaStatus(force) {
    if (!force && quotaCache && (Date.now() - quotaCache.fetchedAt) < CACHE_TTL_MS) {
      return Promise.resolve(quotaCache.data);
    }
    if (inflight) return inflight;
    var token = getAccessToken();
    var url = getGatewayUrl();
    var anon = window.__SUPABASE_ANON_KEY__;
    if (!token || !url || !anon) return Promise.reject(new Error('unauthenticated'));
    inflight = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anon,
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ endpoint: 'get_quota_status', __auth_token: token }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      quotaCache = { fetchedAt: Date.now(), data: data };
      inflight = null;
      return data;
    }).catch(function (err) {
      inflight = null;
      throw err;
    });
    return inflight;
  }

  function fetchMyUsage(force) {
    if (!force && usageCache && (Date.now() - usageCache.fetchedAt) < CACHE_TTL_MS) {
      return Promise.resolve(usageCache.data);
    }
    if (inflightUsage) return inflightUsage;
    var token = getAccessToken();
    var url = getGatewayUrl();
    var anon = window.__SUPABASE_ANON_KEY__;
    if (!token || !url || !anon) return Promise.reject(new Error('unauthenticated'));
    inflightUsage = fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anon,
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({ endpoint: 'get_my_chat_usage', __auth_token: token }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      usageCache = { fetchedAt: Date.now(), data: data };
      inflightUsage = null;
      return data;
    }).catch(function (err) {
      inflightUsage = null;
      throw err;
    });
    return inflightUsage;
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function fmtTokens(n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
    return String(n);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return String(iso); }
  }

  // 渲染 FREE 用户视图
  function renderFreeView(data) {
    var pool = data.free_pool || {};
    var daily = data.daily_paid || {};
    var poolPercent = Math.min(100, Math.max(0, Number(pool.percent) || 0));
    var poolBarClass = poolPercent >= 95 ? 'is-exhausted' : poolPercent >= 80 ? 'is-warn' : '';
    var dailyCount = Number(daily.count) || 0;
    var dailyLimit = Number(daily.limit) || 25;
    var dailyPercent = dailyLimit > 0 ? Math.min(100, (dailyCount / dailyLimit) * 100) : 0;
    var dailyBarClass = dailyCount >= dailyLimit ? 'is-exhausted' : dailyCount >= dailyLimit * 0.8 ? 'is-warn' : '';

    return [
      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">免费共享池</span>',
      '    <span class="claude-tier-chip is-free">FREE</span>',
      '  </div>',
      '  <div class="claude-quota-bar"><div class="claude-quota-bar-fill ' + poolBarClass + '" style="width:' + poolPercent.toFixed(2) + '%"></div></div>',
      '  <div class="claude-quota-stat">',
      '    <span>已用 <b>' + fmtTokens(pool.consumed || 0) + '</b> / ' + fmtTokens(pool.budget || 100000000) + ' tokens</span>',
      '    <span>' + poolPercent.toFixed(1) + '%</span>',
      '  </div>',
      '  <p class="claude-quota-note">本月共享池将于 <b>' + fmtDate(pool.period_end) + ' 00:00（UTC+8）</b> 重置。共享池采用上游真实计费（缓存命中按 10% 折算），公式与详细规则见 <a href="./api_docs.html#quota">API 文档</a>。</p>',
      '</div>',

      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">今日 PAID 模型调用</span>',
      '    <span class="claude-quota-card-sub">' + (daily.day || '') + '（UTC+8）</span>',
      '  </div>',
      '  <div class="claude-quota-bar"><div class="claude-quota-bar-fill ' + dailyBarClass + '" style="width:' + dailyPercent.toFixed(2) + '%"></div></div>',
      '  <div class="claude-quota-stat">',
      '    <span>已用 <b>' + dailyCount + '</b> / ' + dailyLimit + ' 次</span>',
      '    <span>剩余 ' + Math.max(0, dailyLimit - dailyCount) + ' 次</span>',
      '  </div>',
      '  <p class="claude-quota-note">失败请求（上游错误、key 失效、风控）不计入此 25 次。GPT-5.5 系列为 Cancri Pro 专属，不计入此额度也无法用免费试用次数调用。</p>',
      '</div>',

      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">想要无限调用？</span>',
      '  </div>',
      '  <p class="claude-quota-note">升级到 <b>Cancri Pro</b>（¥9.9/月）即可：',
      '    <ul style="margin:8px 0 0 18px; color:var(--text-mute,rgba(255,255,255,0.6)); font-size:12.5px; line-height:1.7;">',
      '      <li>无每日 25 次限制</li>',
      '      <li>不消耗共享池</li>',
      '      <li>解锁 GPT-5.5 / Claude 全系等 PAID 模型</li>',
      '      <li>独立排队通道，免与免费用户共抢资源</li>',
      '    </ul>',
      '  </p>',
      '  <p class="claude-quota-note"><a href="./pricing.html">查看套餐 →</a></p>',
      '</div>',
    ].join('');
  }

  // 渲染 PAID 用户视图（含 30 天用量明细）
  function renderPaidView(data, usage) {
    var sub = data.subscription || {};
    var daysRemaining = Number(sub.days_remaining) || 0;
    var expiresAt = sub.expires_at ? fmtDate(sub.expires_at) : '—';

    var totalIn = Number(usage && usage.total_tokens_in) || 0;
    var totalOut = Number(usage && usage.total_tokens_out) || 0;
    var totalCached = Number(usage && usage.total_tokens_cached) || 0;
    var totalCalls = Number(usage && usage.total_calls) || 0;
    var totalAll = totalIn + totalOut;

    var perModel = (usage && usage.per_model) || [];
    var perDay = (usage && usage.per_day) || [];

    // 把 per_day（最近有数据的若干天）补齐到 30 天槽位
    var dayMap = {};
    for (var i = 0; i < perDay.length; i++) {
      dayMap[perDay[i].day] = Number(perDay[i].tokens) || 0;
    }
    var dayBars = [];
    var maxTokens = 0;
    for (var d = 29; d >= 0; d--) {
      var dt = new Date(Date.now() - d * 86400000);
      // 用北京时间 YYYY-MM-DD
      var beijing = new Date(dt.getTime() + 8 * 3600 * 1000);
      var key = beijing.toISOString().slice(0, 10);
      var v = dayMap[key] || 0;
      dayBars.push({ day: key, v: v });
      if (v > maxTokens) maxTokens = v;
    }
    var dayHtml = dayBars.map(function (x) {
      var pct = maxTokens > 0 ? Math.max(2, Math.round((x.v / maxTokens) * 100)) : 0;
      var cls = x.v > 0 ? '' : 'is-empty';
      var title = x.day + '：' + fmtTokens(x.v) + ' tokens';
      return '<span class="claude-quota-day-bar ' + cls + '" style="height:' + (x.v > 0 ? pct : 100) + '%" title="' + escapeHtml(title) + '"></span>';
    }).join('');

    var topModels = perModel.slice(0, 10).map(function (m) {
      return '<div class="claude-quota-usage-row">' +
        '<span class="claude-quota-usage-name">' + escapeHtml(m.model_id) + '</span>' +
        '<span class="claude-quota-usage-meta">' + (m.calls || 0) + ' 次 · ' + fmtTokens(m.tokens || 0) + '</span>' +
        '</div>';
    }).join('');

    return [
      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">Cancri Pro 订阅</span>',
      '    <span class="claude-tier-chip is-paid">PAID</span>',
      '  </div>',
      '  <div class="claude-quota-stat">',
      '    <span>到期 <b>' + expiresAt + '</b></span>',
      '    <span>剩余 ' + daysRemaining + ' 天</span>',
      '  </div>',
      '  <p class="claude-quota-note">PAID 订阅期间所有模型不限次调用，不消耗共享池。续费请前往 <a href="./pricing.html">套餐页</a>。</p>',
      '</div>',

      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">最近 30 天用量</span>',
      '    <span class="claude-quota-card-sub">共 ' + totalCalls + ' 次成功调用</span>',
      '  </div>',
      '  <div class="claude-quota-stat">',
      '    <span>输入 <b>' + fmtTokens(totalIn) + '</b></span>',
      '    <span>输出 <b>' + fmtTokens(totalOut) + '</b></span>',
      '    <span>缓存命中 <b>' + fmtTokens(totalCached) + '</b></span>',
      '    <span>合计 <b>' + fmtTokens(totalAll) + '</b></span>',
      '  </div>',
      '  <div class="claude-quota-day-grid">' + dayHtml + '</div>',
      '  <p class="claude-quota-note">条形图最右侧为今日（UTC+8），从右至左各代表前 N 天。鼠标悬停查看具体数值。</p>',
      '</div>',

      topModels ? (
        '<div class="claude-quota-card">' +
        '  <div class="claude-quota-card-head">' +
        '    <span class="claude-quota-card-title">Top 10 模型</span>' +
        '  </div>' +
        '  <div class="claude-quota-usage-list">' + topModels + '</div>' +
        '</div>'
      ) : '',
    ].join('');
  }

  function loadQuotaPanel() {
    var panel = document.getElementById('claudeQuotaPanel');
    if (!panel) return;
    injectStyleOnce();
    if (panel.getAttribute('data-quota-state') === 'ready' && quotaCache &&
        (Date.now() - quotaCache.fetchedAt) < CACHE_TTL_MS) {
      return; // 60s 内不重复拉
    }
    panel.setAttribute('data-quota-state', 'loading');
    panel.innerHTML = '<p class="claude-form-help">正在加载额度信息…</p>';

    fetchQuotaStatus(false).then(function (data) {
      if (!data || !data.ok) {
        panel.setAttribute('data-quota-state', 'error');
        panel.innerHTML = '<div class="claude-quota-err">加载额度信息失败，请稍后重试。</div>';
        return;
      }
      if (data.tier === 'paid') {
        return fetchMyUsage(false).then(function (usage) {
          panel.setAttribute('data-quota-state', 'ready');
          panel.innerHTML = renderPaidView(data, usage || {});
        }).catch(function () {
          // 用量拉失败也能展示订阅信息
          panel.setAttribute('data-quota-state', 'ready');
          panel.innerHTML = renderPaidView(data, {});
        });
      } else {
        panel.setAttribute('data-quota-state', 'ready');
        panel.innerHTML = renderFreeView(data);
      }
    }).catch(function (err) {
      panel.setAttribute('data-quota-state', 'error');
      panel.innerHTML = '<div class="claude-quota-err">加载额度信息失败：' + escapeHtml(err && err.message || String(err)) + '</div>';
    });
  }

  // 监听设置面板 nav 点击事件 —— 用户点「额度」时触发加载
  function bindNavTrigger() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest && ev.target.closest('[data-snav="quota"]');
      if (!btn) return;
      // 给 nav 切换 DOM 一个 tick，再渲染（避免 panel 还没切到 active）
      setTimeout(loadQuotaPanel, 0);
    }, false);
  }

  // 主入口
  function init() {
    bindNavTrigger();
    // 不在 init 时主动拉数据：用户没打开额度段就不发请求，省一个 RPC。
    // 但如果 URL 锚点直达 quota（#quota），下面立即加载。
    if (window.location.hash === '#quota') {
      setTimeout(loadQuotaPanel, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露给 claude_ui.js / 调试：手动 refresh
  window.CancriQuotaUI = {
    refresh: function () {
      quotaCache = null;
      usageCache = null;
      loadQuotaPanel();
    },
    load: loadQuotaPanel,
  };
})();
