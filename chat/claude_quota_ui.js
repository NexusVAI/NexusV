// chat/claude_quota_ui.js
//
// 2026-05-17 新增「额度」面板渲染（替换原「连接器」占位）。
// 2026-05-17 Phase A：升级为三档订阅（Pro/Pro+/Pro Max）+ 加油包 + 月度配额
// 进度条。后端 cancri_get_quota_status_v2 顶层字段：
//   tier / plan_code / expires_at / days_remaining
//   monthly_quota / monthly_consumed / monthly_remaining / monthly_percent
//   topup_balance / topup_total_purchased / topup_total_consumed
//   free_pool: {budget,consumed,remaining,percent,period_start,period_end}
//   daily_paid: {day, used, limit, remaining}
//
// 行为：
//   • 用户点击设置面板左侧 nav data-snav="quota" → 我们的 click handler 触发
//     loadQuotaPanel()，首次拉数据；之后用 60s 内存缓存避免重复拉。
//   • FREE 用户：渲染共享池 + 当日 15 次 PAID 试用 + 升级引导。
//   • PAID 用户：渲染当前档位 + 月度配额进度 + 加油包余额 + 最近 30 天用量明细。
//
// 安全：CSP script-src 'self'，本文件外联引入；不使用 eval / Function；样式通过
// 同目录 <style> 块注入（style-src 'unsafe-inline' 暂存，与 claude_ui.js
// 同款做法）。
//
// 与 claude_ui.js 的协作：那里负责升级 pill / billing copy 的 tier UI（is-paid-tier
// class + applyTierUI）；这里只管「额度」段的内容。两者各管一段，互不依赖。

(function () {
  'use strict';

  // 2026-05-29 积分化：统一走 window.CancriCredits（cancri_credits.js 同步先加载）。
  // 兜底：万一外联工具没加载，按 1 积分 = 1 万 token 本地降级，避免额度面板崩。
  var CC = window.CancriCredits || {
    num: function (t) {
      var c = (Number(t) || 0) / 10000;
      return c >= 100 ? Math.round(c).toLocaleString('en-US')
        : String(Math.round(c * 10) / 10);
    },
    fmt: function (t) { return this.num(t) + ' 积分'; },
  };

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
      '.claude-quota-card { padding: 16px 18px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); }',
      '.claude-quota-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 12px; }',
      '.claude-quota-card-title { font-size: 14px; font-weight: 600; color: var(--text); }',
      '.claude-quota-card-sub { font-size: 12px; color: var(--text-soft); }',
      '.claude-quota-bar { position: relative; height: 10px; border-radius: 999px; background: var(--line); overflow: hidden; }',
      '.claude-quota-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: var(--accent); transition: width 0.3s ease; }',
      '.claude-quota-bar-fill.is-warn { background: #d99e35; }',
      '.claude-quota-bar-fill.is-exhausted { background: #c45252; }',
      '.claude-quota-stat { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; margin-top: 8px; color: var(--text-soft); }',
      '.claude-quota-stat b { color: var(--text); font-variant-numeric: tabular-nums; font-weight: 500; }',
      '.claude-quota-note { font-size: 12px; color: var(--text-soft); line-height: 1.55; margin-top: 8px; }',
      '.claude-quota-note a { color: var(--accent); }',
      '.claude-tier-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }',
      '.claude-tier-chip.is-free { background: rgba(255,255,255,0.08); color: var(--text-soft); border: 1px solid var(--line); }',
      '.claude-tier-chip.is-paid { background: var(--accent); color: #fffaf2; border: 1px solid var(--accent); }',
      // 2026-05-17 Phase A grandfather：金色徽章区分老用户福利，不抢 paid chip 的视觉权重
      '.claude-tier-chip.is-grandfather { background: rgba(212,160,77,0.18); color: #d4a04d; border: 1px solid rgba(212,160,77,0.55); text-transform: none; letter-spacing: 0.02em; font-weight: 500; }',
      '.claude-quota-usage-list { display: flex; flex-direction: column; gap: 6px; }',
      '.claude-quota-usage-row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 6px 0; border-bottom: 1px dashed var(--line); }',
      '.claude-quota-usage-row:last-child { border-bottom: 0; }',
      '.claude-quota-usage-name { color: var(--text); font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 11.5px; }',
      '.claude-quota-usage-meta { color: var(--text-soft); font-variant-numeric: tabular-nums; }',
      '.claude-quota-day-grid { display: grid; grid-template-columns: repeat(30, 1fr); gap: 2px; margin-top: 10px; height: 36px; align-items: end; }',
      '.claude-quota-day-bar { background: var(--accent); border-radius: 2px 2px 0 0; min-height: 2px; opacity: 0.85; }',
      '.claude-quota-day-bar.is-empty { background: var(--line); opacity: 0.4; }',
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
    // 后端字段是 daily_paid.used / daily_paid.limit / daily_paid.remaining（v2 RPC 输出）
    var dailyUsed = Number(daily.used) || 0;
    var dailyLimit = Number(daily.limit) || 15;
    var dailyPercent = dailyLimit > 0 ? Math.min(100, (dailyUsed / dailyLimit) * 100) : 0;
    var dailyBarClass = dailyUsed >= dailyLimit ? 'is-exhausted' : dailyUsed >= dailyLimit * 0.8 ? 'is-warn' : '';
    var topupBalance = Number(data.topup_balance) || 0;

    // 2026-06-03: 滚动 token 窗口
    var tw = data.token_window || null;
    var twCard = '';
    if (tw) {
      var tw5hUsed = Number(tw.used_5h) || 0;
      var tw5hLimit = Number(tw.limit_5h) || 100000;
      var tw5hPct = tw5hLimit > 0 ? Math.min(100, (tw5hUsed / tw5hLimit) * 100) : 0;
      var tw5hBar = tw5hPct >= 95 ? 'is-exhausted' : tw5hPct >= 80 ? 'is-warn' : '';
      var twWkUsed = Number(tw.used_week) || 0;
      var twWkLimit = Number(tw.limit_week) || 500000;
      var twWkPct = twWkLimit > 0 ? Math.min(100, (twWkUsed / twWkLimit) * 100) : 0;
      var twWkBar = twWkPct >= 95 ? 'is-exhausted' : twWkPct >= 80 ? 'is-warn' : '';
      twCard = [
        '<div class="claude-quota-card">',
        '  <div class="claude-quota-card-head">',
        '    <span class="claude-quota-card-title">Token 用量窗口</span>',
        '    <span class="claude-quota-card-sub">滚动上限，超限需等待重置</span>',
        '  </div>',
        '  <div style="display:flex;flex-direction:column;gap:12px;">',
        '    <div>',
        '      <div style="font-size:12px;color:var(--text-soft);margin-bottom:4px;">5 小时窗口</div>',
        '      <div class="claude-quota-bar"><div class="claude-quota-bar-fill ' + tw5hBar + '" style="width:' + tw5hPct.toFixed(1) + '%"></div></div>',
        '      <div class="claude-quota-stat">',
        '        <span>已用 <b>' + fmtTokens(tw5hUsed) + '</b> / ' + fmtTokens(tw5hLimit) + '</span>',
        '        <span>' + tw5hPct.toFixed(1) + '%</span>',
        '      </div>',
        '    </div>',
        '    <div>',
        '      <div style="font-size:12px;color:var(--text-soft);margin-bottom:4px;">周窗口</div>',
        '      <div class="claude-quota-bar"><div class="claude-quota-bar-fill ' + twWkBar + '" style="width:' + twWkPct.toFixed(1) + '%"></div></div>',
        '      <div class="claude-quota-stat">',
        '        <span>已用 <b>' + fmtTokens(twWkUsed) + '</b> / ' + fmtTokens(twWkLimit) + '</span>',
        '        <span>' + twWkPct.toFixed(1) + '%</span>',
        '      </div>',
        '    </div>',
        '  </div>',
        '  <p class="claude-quota-note">免费用户每 5 小时最多 ' + fmtTokens(tw5hLimit) + ' token，每周最多 ' + fmtTokens(twWkLimit) + ' token。超出后需等待窗口滚动重置。升级 Pro 解除此限制。</p>',
        '</div>',
      ].join('');
    }

    var topupCard = topupBalance > 0 ? [
      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">加油包余额</span>',
      '    <span class="claude-quota-card-sub">永不过期</span>',
      '  </div>',
      '  <div class="claude-quota-stat">',
      '    <span>剩余 <b>' + CC.num(topupBalance) + '</b> 积分</span>',
      '  </div>',
      '  <p class="claude-quota-note">加油包余额独立于订阅档位，订阅过期后也可继续消耗。</p>',
      '</div>',
    ].join('') : '';

    return [
      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">免费共享池</span>',
      '    <span class="claude-tier-chip is-free">FREE</span>',
      '  </div>',
      '  <div class="claude-quota-bar"><div class="claude-quota-bar-fill ' + poolBarClass + '" style="width:' + poolPercent.toFixed(2) + '%"></div></div>',
      '  <div class="claude-quota-stat">',
      '    <span>已用 <b>' + CC.num(pool.consumed || 0) + '</b> / ' + CC.num(pool.budget || 100000000) + ' 积分</span>',
      '    <span>' + poolPercent.toFixed(1) + '%</span>',
      '  </div>',
      '  <p class="claude-quota-note">本月共享池将于 <b>' + fmtDate(pool.period_end) + ' 00:00（UTC+8）</b> 重置。余额以积分计（1 积分 = 1 万 token），按上游真实计费（缓存命中按 10% 折算）× 模型权重换算，详见 <a href="./api_docs.html#quota">API 文档</a>。</p>',
      '</div>',

      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">今日 PAID 模型调用</span>',
      '    <span class="claude-quota-card-sub">' + (daily.day || '') + '（UTC+8）</span>',
      '  </div>',
      '  <div class="claude-quota-bar"><div class="claude-quota-bar-fill ' + dailyBarClass + '" style="width:' + dailyPercent.toFixed(2) + '%"></div></div>',
      '  <div class="claude-quota-stat">',
      '    <span>已用 <b>' + dailyUsed + '</b> / ' + dailyLimit + ' 次</span>',
      '    <span>剩余 ' + Math.max(0, dailyLimit - dailyUsed) + ' 次</span>',
      '  </div>',
      '  <p class="claude-quota-note">失败请求（上游错误、key 失效、风控）不计入此 ' + dailyLimit + ' 次。GPT-5.5 系列为 Pro 以上专属，Claude Opus 系列为 Pro+ 以上专属，均不计入免费试用次数。</p>',
      '</div>',

      twCard,

      topupCard,

      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">想要更高额度？</span>',
      '  </div>',
      '  <p class="claude-quota-note">升级到付费档位即可：',
      '    <ul style="margin:8px 0 0 18px; color:var(--text-soft); font-size:12.5px; line-height:1.7;">',
      '      <li><b>Pro</b>（¥9.9/月）月度配额 2000 积分，解锁 GPT-5.5 / Claude Sonnet 等非 Opus 全模型</li>',
      '      <li><b>Pro+</b>（¥29/月）月度配额 8000 积分，<b>解锁 Claude Opus 全系</b></li>',
      '      <li><b>Pro Max</b>（¥99/月）月度配额 30000 积分，全部模型 + 视频图像生成</li>',
      '      <li>加油包（¥10 起）永不过期，可累积，付费/免费用户都能买</li>',
      '    </ul>',
      '  </p>',
      '  <p class="claude-quota-note"><a href="./pricing.html">查看套餐 →</a></p>',
      '</div>',
    ].join('');
  }

  // 档位 → 显示标签
  var PLAN_LABEL = { pro: 'Pro', pro_plus: 'Pro+', pro_max: 'Pro Max' };
  var PLAN_CHIP = { pro: 'PRO', pro_plus: 'PRO+', pro_max: 'PRO MAX' };

  // 渲染 PAID 用户视图（含 30 天用量明细）
  function renderPaidView(data, usage) {
    // v2 RPC 把 plan / quota / topup 都铺在 data 顶层；老 sub 对象兼容保留。
    var planCode = data.plan_code || (data.subscription && data.subscription.plan_code) || 'pro';
    var daysRemaining = Number(data.days_remaining || (data.subscription && data.subscription.days_remaining)) || 0;
    var expiresAt = data.expires_at || (data.subscription && data.subscription.expires_at);
    var expiresFmt = expiresAt ? fmtDate(expiresAt) : '—';

    // 2026-05-17 Phase A grandfather：方案 F 的「老用户福利」标志，仅在 Pro 档生效。
    // 后端在订阅未过期时返回 true；过期 → false → 豁免自动失效。
    var isGrandfathered = Boolean(
      data.is_grandfathered || (data.subscription && data.subscription.is_grandfathered)
    );
    var showGrandfatherChip = isGrandfathered && planCode === 'pro';

    var monthlyQuota = Number(data.monthly_quota) || 0;
    var monthlyConsumed = Number(data.monthly_consumed) || 0;
    var monthlyRemaining = Math.max(monthlyQuota - monthlyConsumed, 0);
    var monthlyPercent = monthlyQuota > 0 ? Math.min(100, (monthlyConsumed / monthlyQuota) * 100) : 0;
    var monthlyBarClass = monthlyPercent >= 95 ? 'is-exhausted' : monthlyPercent >= 80 ? 'is-warn' : '';

    var topupBalance = Number(data.topup_balance) || 0;
    var topupTotalPurchased = Number(data.topup_total_purchased) || 0;
    var topupTotalConsumed = Number(data.topup_total_consumed) || 0;

    var planLabel = PLAN_LABEL[planCode] || 'Pro';
    var planChip = PLAN_CHIP[planCode] || 'PAID';

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

    var topupCard = (topupBalance > 0 || topupTotalPurchased > 0) ? [
      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">加油包余额</span>',
      '    <span class="claude-quota-card-sub">永不过期</span>',
      '  </div>',
      '  <div class="claude-quota-stat">',
      '    <span>剩余 <b>' + CC.num(topupBalance) + '</b> 积分</span>',
      '    <span>累计购买 ' + CC.num(topupTotalPurchased) + ' · 已用 ' + CC.num(topupTotalConsumed) + ' 积分</span>',
      '  </div>',
      '  <p class="claude-quota-note">月度配额用完后自动从加油包扣减。前往 <a href="./pricing.html">套餐页</a> 购买。</p>',
      '</div>',
    ].join('') : [
      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">加油包余额</span>',
      '    <span class="claude-quota-card-sub">永不过期</span>',
      '  </div>',
      '  <div class="claude-quota-stat">',
      '    <span>剩余 <b>0</b> 积分</span>',
      '  </div>',
      '  <p class="claude-quota-note">月配额用完后可购买加油包（¥10 起）继续使用，余额永不清零。前往 <a href="./pricing.html">套餐页</a> 购买。</p>',
      '</div>',
    ].join('');

    var grandfatherChip = showGrandfatherChip
      ? '    <span class="claude-tier-chip is-grandfather" title="Phase A 老用户福利：可调 Claude Opus 系列，到期自然失效">老用户 · Opus 可调</span>'
      : '';

    var subscriptionNote = showGrandfatherChip
      ? 'PAID 订阅扣的是周期配额（积分 = 真实 token ÷ 1 万，再 × 模型权重折算），每 30 天订阅周期自动重置。<b>您是 Phase A 老用户</b>，在本订阅周期内可继续调用 Claude Opus 全系（权重照常生效），到期不延续。续费请前往 <a href="./pricing.html">套餐页</a>。'
      : 'PAID 订阅扣的是周期配额（积分 = 真实 token ÷ 1 万，再 × 模型权重折算），每 30 天订阅周期自动重置。Pro+ 以上可调 Claude Opus 系列。续费请前往 <a href="./pricing.html">套餐页</a>。';

    return [
      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">Cancri ' + escapeHtml(planLabel) + ' 订阅</span>',
      '    <span class="claude-tier-chip is-paid">' + escapeHtml(planChip) + '</span>',
      grandfatherChip,
      '  </div>',
      '  <div class="claude-quota-stat">',
      '    <span>到期 <b>' + expiresFmt + '</b></span>',
      '    <span>剩余 ' + daysRemaining + ' 天</span>',
      '  </div>',
      '  <p class="claude-quota-note">' + subscriptionNote + '</p>',
      '</div>',

      '<div class="claude-quota-card">',
      '  <div class="claude-quota-card-head">',
      '    <span class="claude-quota-card-title">本周期配额</span>',
      '    <span class="claude-quota-card-sub">每 30 天订阅周期重置</span>',
      '  </div>',
      '  <div class="claude-quota-bar"><div class="claude-quota-bar-fill ' + monthlyBarClass + '" style="width:' + monthlyPercent.toFixed(2) + '%"></div></div>',
      '  <div class="claude-quota-stat">',
      '    <span>已用 <b>' + CC.num(monthlyConsumed) + '</b> / ' + CC.num(monthlyQuota) + ' 积分</span>',
      '    <span>剩余 ' + CC.num(monthlyRemaining) + ' 积分 · ' + monthlyPercent.toFixed(1) + '%</span>',
      '  </div>',
      '  <p class="claude-quota-note">月度配额耗尽后会自动从加油包扣减；都为 0 时返回 <code>monthly_quota_exhausted</code>。</p>',
      '</div>',

      topupCard,

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
      '  <p class="claude-quota-note">此处为真实 token 收发量（非积分口径），仅供参考。条形图最右侧为今日（UTC+8），从右至左各代表前 N 天。鼠标悬停查看具体数值。</p>',
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
