/* NexusV 开放平台控制台 — 多页共享逻辑（对标 platform.openai.com）。
 * 一份脚本驱动 overview / usage / logs / keys 四个页面：
 *   - 注入左侧栏 + 顶栏（按 data-console-page 高亮）
 *   - supabase 会话鉴权（与聊天页共享 storageKey）；未登录 → 登录引导
 *   - 复用真实端点 api_my_usage / api_my_keys（+ api_generate_key / api_delete_key）
 *   - 用量"波浪图"：每日调用面积 + 每日 token 虚线（SVG）
 * 数据形状（已核对 api-keys-app.js）：usage 行 = {created_at, tokens_in, tokens_out, model, status_code} */
(function () {
  "use strict";

  var PAGE = document.body.getAttribute("data-console-page") || "overview";
  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var sb = null, _usage = null, _keys = null, _wallet = null;
  var WALLET_LOW_THRESHOLD = 10; // 余额 < ¥10 触发黄色警报
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function nf(n) { return (Number(n) || 0).toLocaleString(); }

  // ── auth（共享 PlatformAuth）────────────────────────────────
  function getSupabase() {
    return window.PlatformAuth.getSupabase();
  }
  async function getSession() {
    return window.PlatformAuth.getSession(6000);
  }
  async function call(endpoint, payload) {
    var s = await getSession();
    if (!s) throw new Error("not_logged_in");
    var r = await fetch(GW, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: window.__SUPABASE_ANON_KEY__ },
      body: JSON.stringify(Object.assign({ endpoint: endpoint }, payload || {}, { __auth_token: s.access_token })),
    });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) throw Object.assign(new Error(d.message || d.error || r.statusText), { status: r.status, body: d });
    return d;
  }

  // ── icons (line, OpenAI-style) ─────────────────────────
  var IC = {
    overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    usage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></svg>',
    logs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 1-7.1 7.1 5 5 0 0 1 7.1-7.1zm0 0L15 8m0 0l3 3m-3-3l2-2"/></svg>',
    models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l9 4.9V17L12 22 3 17V6.9L12 2z"/><path d="M12 22V12M3 6.9L12 12l9-5.1"/></svg>',
    recharge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
    docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4a2 2 0 0 1 2-2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M14 2v6h6"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  };

  function navItem(page, href, icon, label) {
    return '<a class="csb__item' + (PAGE === page ? " is-active" : "") + '" href="' + href + '">' + IC[icon] + "<span>" + label + "</span></a>";
  }

  function buildShell(email) {
    var title = { overview: "概览", usage: "用量", logs: "日志", keys: "API 密钥" }[PAGE] || "控制台";
    var initial = (email || "N").trim().charAt(0).toUpperCase();
    var shell =
      '<aside class="csb">' +
        '<a class="csb__brand" href="index.html"><img src="../../Logo/Cancri1.jpg" alt="NexusV" /><span>NexusV 开放平台</span></a>' +
        '<div class="csb__section">控制台</div>' +
        '<nav class="csb__nav">' +
          navItem("overview", "console.html", "overview", "概览") +
          navItem("usage", "usage.html", "usage", "用量") +
          navItem("logs", "logs.html", "logs", "日志") +
          navItem("keys", "keys.html", "keys", "API 密钥") +
        "</nav>" +
        '<div class="csb__section">平台</div>' +
        '<nav class="csb__nav">' +
          navItem("_m", "../api_models.html", "models", "模型广场") +
          navItem("_r", "./billing.html", "recharge", "充值") +
          navItem("_d", "../api_docs_detail.html", "docs", "文档") +
          navItem("_h", "index.html", "home", "返回首页") +
        "</nav>" +
        '<div class="csb__spacer"></div>' +
        '<div class="csb__foot"><div class="csb__user"><span class="csb__avatar">' + esc(initial) + '</span><span>' + esc(email || "未登录") + "</span></div></div>" +
      "</aside>" +
      '<div class="csc">' +
        '<div class="csc__top"><div class="csc__title">' + title + "</div>" +
          '<div class="csc__actions"><a class="csbtn csbtn--ghost" href="./billing.html">充值</a><a class="csbtn csbtn--primary" href="keys.html">创建密钥</a></div>' +
        "</div>" +
        '<div class="csc__body" id="cs-view"></div>' +
      "</div>";
    var root = document.getElementById("console-root");
    root.className = "cs-console";
    root.innerHTML = shell;
  }

  function viewSkeletonHtml() {
    return '<div class="cs-console-view-skeleton" aria-busy="true">' +
      '<div class="cs-console-skeleton__cards">' +
      "<span></span><span></span><span></span><span></span>" +
      "</div>" +
      '<span class="cs-console-skeleton__chart"></span>' +
      '<span class="cs-console-skeleton__table"></span></div>';
  }

  // ── boot ───────────────────────────────────────────────
  async function boot() {
    var root = document.getElementById("console-root");
    try {
      if (!window.PlatformAuth) throw new Error("supabase_not_loaded");
      var session = await PlatformAuth.requireSession({
        errorParent: root,
        loadingId: "console-boot-skeleton",
      });
      if (!session) return;
      if (root) root.removeAttribute("aria-busy");
      buildShell(session.user.email);
      var view = document.getElementById("cs-view");
      if (view) view.innerHTML = viewSkeletonHtml();
      // 并行拉钱包余额（所有页共享）+ 用量（keys 页也要指标）+ 密钥（仅 keys 页）。
      // 任一失败不阻断其他：_usage/_wallet 保持 null 时渲染降级（不画指标/钱包卡）。
      var tasks = [];
      tasks.push(call("get_quota_status", {}).then(function (d) {
        if (d && d.ok && d.wallet) _wallet = d.wallet;
      }).catch(function () {}));
      tasks.push(call("api_my_usage", {}).then(function (d) { _usage = (d && d.usage) || []; }).catch(function () {}));
      if (PAGE === "keys") {
        tasks.push(call("api_my_keys", {}).then(function (d) { _keys = d; }).catch(function () {}));
      }
      await Promise.all(tasks);
      if (PAGE === "keys") renderKeys();
      else if (PAGE === "usage") renderUsage();
      else if (PAGE === "logs") renderLogs();
      else renderOverview();
    } catch (e) {
      if (e && e.message === "not_logged_in") {
        PlatformAuth.redirectToLogin();
        return;
      }
      if (root) root.removeAttribute("aria-busy");
      if (e && e.message === "supabase_not_loaded") {
        PlatformAuth.showAuthError("依赖脚本加载失败，请检查网络后刷新。", root);
        return;
      }
      var v = document.getElementById("cs-view");
      if (v) v.innerHTML = '<div class="cs-auth-error">加载失败：' + esc(e && e.message ? e.message : String(e)) + "</div>";
      else if (root) {
        root.className = "cs-console";
        root.innerHTML = '<div class="cs-auth-error" style="margin:24px">加载失败，请刷新或重新登录。</div>';
      }
    }
  }
  function aggregate(rows) {
    var days = [], dayCalls = {}, dayTok = {}, byModel = {}, totIn = 0, totOut = 0, err = 0;
    var now = Date.now(), DAY = 86400000;
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now - i * DAY);
      var k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      days.push(k); dayCalls[k] = 0; dayTok[k] = 0;
    }
    rows.forEach(function (r) {
      var d = new Date(r.created_at);
      var k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      var tin = Number(r.tokens_in) || 0, tout = Number(r.tokens_out) || 0;
      if (k in dayCalls) { dayCalls[k]++; dayTok[k] += tin + tout; }
      var m = r.model || "unknown";
      if (!byModel[m]) byModel[m] = { calls: 0, tin: 0, tout: 0 };
      byModel[m].calls++; byModel[m].tin += tin; byModel[m].tout += tout;
      totIn += tin; totOut += tout;
      if (r.status_code && Number(r.status_code) >= 400) err++;
    });
    return { days: days, dayCalls: dayCalls, dayTok: dayTok, byModel: byModel, totIn: totIn, totOut: totOut, calls: rows.length, err: err };
  }

  function statCards(a) {
    var rate = a.calls ? Math.round((a.err / a.calls) * 100) : 0;
    return '<div class="cs-cards">' +
      card("近30天调用", nf(a.calls), "次请求") +
      card("输入 Token", nf(a.totIn), "tokens in") +
      card("输出 Token", nf(a.totOut), "tokens out") +
      card("错误率", rate + "%", a.err + " 次失败") +
      "</div>";
  }
  function card(label, val, sub) {
    return '<div class="cs-card"><div class="cs-card__label">' + esc(label) + '</div><div class="cs-card__value">' + esc(val) + '</div><div class="cs-card__sub">' + esc(sub) + "</div></div>";
  }

  // 钱包余额卡：余额 < ¥10 触发黄色警报（is-warn）。_wallet 为 null（端点失败/非 wallet_v3）时不渲染。
  function walletCard() {
    if (!_wallet) return "";
    var bal = Number(_wallet.balance_cny);
    if (!(bal >= 0)) return ""; // NaN / 缺字段 → 不画，避免误导
    var debt = Number(_wallet.debt_cny) || 0;
    var low = bal < WALLET_LOW_THRESHOLD;
    var sub = low ? "余额不足 ¥" + WALLET_LOW_THRESHOLD + "，请尽快充值" : "按量计费 · 余额充足";
    return '<div class="cs-wallet' + (low ? " is-warn" : "") + '">' +
      '<div class="cs-wallet__main"><div class="cs-wallet__label">钱包余额</div>' +
      '<div class="cs-wallet__value">¥' + bal.toFixed(2) + '</div>' +
      '<div class="cs-wallet__sub">' + esc(sub) + (debt > 0 ? '（欠款 ¥' + debt.toFixed(2) + '）' : '') + '</div></div>' +
      '<a class="csbtn csbtn--ghost" href="./billing.html">充值 →</a></div>';
  }

  // statCards + 波浪图组合（keys/logs/overview/usage 复用）。_usage 为 null 时降级为空。
  function metricsHtml(a, chartTitle) {
    if (!_usage) return "";
    return statCards(a) + chartPanel(a, chartTitle || "每日调用 / Token");
  }

  // SVG area "wave" chart: per-day calls (area+line) + per-day tokens (dashed)
  function chartPanel(a, title) {
    return '<div class="cs-panel"><div class="cs-panel__head"><div class="cs-panel__title">' + esc(title || "每日用量") + "</div>" +
      '<div class="cs-chart__legend"><span><i></i>调用次数</span><span><i class="dash"></i>Token</span></div></div>' +
      '<div class="cs-panel__body"><div class="cs-chart-wrap"><svg class="cs-chart-svg" id="cs-chart" viewBox="0 0 800 240" preserveAspectRatio="none"></svg>' +
      '<div class="cs-tooltip" id="cs-tip" style="display:none"></div></div><div class="cs-chart__axis" id="cs-axis"></div></div></div>';
  }
  function drawChart(a) {
    var svg = document.getElementById("cs-chart"); if (!svg) return;
    var W = 800, H = 240, pad = { t: 18, r: 12, b: 12, l: 12 };
    var iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;
    var calls = a.days.map(function (k) { return a.dayCalls[k]; });
    var toks = a.days.map(function (k) { return a.dayTok[k]; });
    var maxC = Math.max(1, Math.max.apply(null, calls)), maxT = Math.max(1, Math.max.apply(null, toks));
    var n = a.days.length;
    function px(i) { return pad.l + (i / Math.max(1, n - 1)) * iW; }
    var pc = calls.map(function (v, i) { return { x: px(i), y: pad.t + iH - (v / maxC) * iH, v: v, day: a.days[i], t: toks[i] }; });
    var pt = toks.map(function (v, i) { return { x: px(i), y: pad.t + iH - (v / maxT) * iH * 0.85 }; });
    var lc = pc.map(function (p) { return p.x + "," + p.y; }).join(" ");
    var lt = pt.map(function (p) { return p.x + "," + p.y; }).join(" ");
    var area = pc[0].x + "," + (pad.t + iH) + " " + lc + " " + pc[n - 1].x + "," + (pad.t + iH);
    var grid = [0.25, 0.5, 0.75].map(function (f) { var y = pad.t + iH * (1 - f); return '<line class="cs-chart__grid" x1="' + pad.l + '" y1="' + y + '" x2="' + (W - pad.r) + '" y2="' + y + '"/>'; }).join("");
    svg.innerHTML =
      '<defs><linearGradient id="cs-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--accent-color)" stop-opacity="0.26"/><stop offset="100%" stop-color="var(--accent-color)" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      '<polygon points="' + area + '" fill="url(#cs-grad)"/>' +
      '<polyline class="cs-chart__tokens" points="' + lt + '"/>' +
      '<polyline class="cs-chart__area-stroke" points="' + lc + '"/>' +
      pc.map(function (p, i) { return '<circle class="cs-chart__dot" data-i="' + i + '" cx="' + p.x + '" cy="' + p.y + '" r="3.5"/>'; }).join("");
    var ax = document.getElementById("cs-axis");
    if (ax) ax.innerHTML = "<span>" + a.days[0].slice(5) + "</span><span>" + a.days[Math.floor(n / 2)].slice(5) + "</span><span>" + a.days[n - 1].slice(5) + "</span>";
    var tip = document.getElementById("cs-tip"), wrap = svg.parentElement;
    svg.querySelectorAll("circle[data-i]").forEach(function (c) {
      c.addEventListener("mouseenter", function () {
        var p = pc[+c.getAttribute("data-i")];
        tip.style.display = "block";
        tip.innerHTML = "<strong>" + p.day + "</strong>调用 " + p.v + " 次 · Token " + nf(p.t);
        tip.style.left = (p.x / W * wrap.clientWidth) + "px";
        tip.style.top = "6px";
      });
      c.addEventListener("mouseleave", function () { tip.style.display = "none"; });
    });
  }

  function modelTable(a) {
    var rows = Object.keys(a.byModel).map(function (m) { return [m, a.byModel[m]]; }).sort(function (x, y) { return y[1].calls - x[1].calls; }).slice(0, 12);
    if (!rows.length) return '<div class="cs-panel"><div class="cs-empty">暂无调用数据</div></div>';
    var body = rows.map(function (r) {
      return "<tr><td class='cs-mono'>" + esc(r[0]) + "</td><td class='num'>" + nf(r[1].calls) + "</td><td class='num'>" + nf(r[1].tin) + "</td><td class='num'>" + nf(r[1].tout) + "</td></tr>";
    }).join("");
    return '<div class="cs-panel"><div class="cs-panel__head"><div class="cs-panel__title">按模型用量</div></div>' +
      '<table class="cs-table"><thead><tr><th>模型</th><th class="num">调用</th><th class="num">输入</th><th class="num">输出</th></tr></thead><tbody>' + body + "</tbody></table></div>";
  }

  // ── page renderers ─────────────────────────────────────
  function renderOverview() {
    var a = aggregate(_usage || []);
    var view = document.getElementById("cs-view");
    view.innerHTML = '<p class="csc__lead">最近 30 天的 API 使用概览。数据来自你账号下所有密钥的真实调用。</p>' +
      walletCard() + metricsHtml(a, "每日调用 / Token") + modelTable(a);
    drawChart(a);
  }
  function renderUsage() {
    var a = aggregate(_usage || []);
    var view = document.getElementById("cs-view");
    view.innerHTML = '<p class="csc__lead">用量与计费明细（近 30 天）。Token 计费以倍率结算，详见充值页。</p>' +
      walletCard() + metricsHtml(a, "每日调用 / Token") + modelTable(a);
    drawChart(a);
  }
  function renderLogs() {
    var a = aggregate(_usage || []);
    var rows = (_usage || []).slice().sort(function (x, y) { return new Date(y.created_at) - new Date(x.created_at); }).slice(0, 200);
    var view = document.getElementById("cs-view");
    var head = '<p class="csc__lead">最近 200 条调用日志。</p>' + walletCard() + metricsHtml(a, "每日调用 / Token");
    if (!rows.length) { view.innerHTML = head + '<div class="cs-panel"><div class="cs-empty">近 30 天暂无调用日志</div></div>'; drawChart(a); return; }
    var body = rows.map(function (r) {
      var ok = !(r.status_code && Number(r.status_code) >= 400);
      return "<tr><td class='cs-mono'>" + esc(new Date(r.created_at).toLocaleString("zh-CN")) + "</td>" +
        "<td class='cs-mono'>" + esc(r.model || "—") + "</td>" +
        "<td class='num'>" + nf(r.tokens_in) + "</td><td class='num'>" + nf(r.tokens_out) + "</td>" +
        "<td><span class='cs-pill " + (ok ? "cs-pill--ok'>" + (r.status_code || 200) : "cs-pill--err'>" + r.status_code) + "</span></td></tr>";
    }).join("");
    view.innerHTML = head + '<div class="cs-panel">' +
      '<table class="cs-table"><thead><tr><th>时间</th><th>模型</th><th class="num">输入</th><th class="num">输出</th><th>状态</th></tr></thead><tbody>' + body + "</tbody></table></div>";
    drawChart(a);
  }
  // ── 自制 modal（替换浏览器原生 prompt/alert/confirm，控制台风格）─────────
  // opts: { title, body(html), input:{label,placeholder,value}, confirmText, confirmKind, onConfirm }
  function showModal(opts) {
    opts = opts || {};
    closeCsModal();
    var backdrop = el("div", "cs-modal__backdrop");
    var card = el("div", "cs-modal" + (opts.kind ? " cs-modal--" + opts.kind : ""));
    var head = '<div class="cs-modal__head"><div class="cs-modal__title">' + esc(opts.title || "") + '</div></div>';
    var bodyHtml = opts.body ? '<div class="cs-modal__body">' + opts.body + "</div>" : "";
    var inputHtml = "";
    if (opts.input) {
      inputHtml = '<label class="cs-modal__field"><span>' + esc(opts.input.label || "") + "</span>" +
        '<input id="cs-modal-input" type="text" placeholder="' + esc(opts.input.placeholder || "") + '" value="' + esc(opts.input.value || "") + '" /></label>';
    }
    var foot = '<div class="cs-modal__foot">' +
      '<button class="csbtn csbtn--ghost" id="cs-modal-cancel">' + esc(opts.cancelText || "取消") + "</button>" +
      '<button class="csbtn ' + (opts.confirmKind === "danger" ? "csbtn--danger" : "csbtn--primary") + '" id="cs-modal-ok">' + esc(opts.confirmText || "确认") + "</button>" +
      "</div>";
    card.innerHTML = head + bodyHtml + inputHtml + foot;
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) closeCsModal(); });
    var cancelBtn = card.querySelector("#cs-modal-cancel");
    var okBtn = card.querySelector("#cs-modal-ok");
    cancelBtn.addEventListener("click", closeCsModal);
    var inp = card.querySelector("#cs-modal-input");
    function submit() {
      var val = inp ? inp.value : null;
      if (opts.onConfirm) opts.onConfirm(val, card, okBtn);
    }
    okBtn.addEventListener("click", submit);
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    }
    document.addEventListener("keydown", csModalEsc);
    return card;
  }
  function csModalEsc(e) { if (e.key === "Escape") closeCsModal(); }
  function closeCsModal() {
    document.querySelectorAll(".cs-modal__backdrop").forEach(function (b) { b.remove(); });
    document.removeEventListener("keydown", csModalEsc);
  }

  function renderKeys() {
    var a = aggregate(_usage || []);
    var view = document.getElementById("cs-view");
    var keys = (_keys && _keys.keys) || [];
    var apps = (_keys && _keys.applications) || [];
    var approved = apps.some(function (x) { return x.status === "approved"; });
    var head = '<p class="csc__lead">管理你的 API 密钥。一把密钥即可调用全部模型；请妥善保管，泄露后请立即撤销。</p>' +
      walletCard() + metricsHtml(a, "每日调用 / Token");
    var createBar = '<div class="cs-panel"><div class="cs-panel__head"><div class="cs-panel__title">密钥</div>' +
      '<button class="csbtn csbtn--primary" id="cs-newkey"' + (approved ? "" : " disabled title=\"申请通过后可创建\"") + '>+ 创建新密钥</button></div>';
    if (!keys.length) {
      view.innerHTML = head + createBar + '<div class="cs-empty">' + (approved ? "还没有密钥，点击右上角创建。" : "尚未获批 API 访问。请先到 申请页 提交申请。") + "</div></div>";
    } else {
      var body = keys.map(function (k) {
        var id = k.id || k.key_id || "";
        var prefix = k.prefix || k.key_prefix || (k.key ? k.key.slice(0, 12) : "cancri_sk_…");
        return "<tr><td>" + esc(k.name || "未命名") + "</td><td class='cs-mono'>" + esc(prefix) + "…</td>" +
          "<td class='cs-mono'>" + esc(k.created_at ? new Date(k.created_at).toLocaleDateString("zh-CN") : "—") + "</td>" +
          "<td class='num'>" + nf(k.used_tokens || k.tokens_used) + "</td>" +
          "<td><button class='cs-copy' data-del='" + esc(id) + "'>撤销</button></td></tr>";
      }).join("");
      view.innerHTML = head + createBar +
        '<table class="cs-table"><thead><tr><th>名称</th><th>前缀</th><th>创建时间</th><th class="num">已用 Token</th><th></th></tr></thead><tbody>' + body + "</tbody></table></div>";
    }
    drawChart(a);
    var nk = document.getElementById("cs-newkey");
    if (nk && approved) nk.addEventListener("click", createKey);
    view.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { deleteKey(b.getAttribute("data-del")); }); });
  }

  async function createKey() {
    var card = showModal({
      title: "创建新密钥",
      input: { label: "密钥名称（可留空）", placeholder: "default", value: "default" },
      confirmText: "创建",
      onConfirm: function (name, cardEl, okBtn) {
        okBtn.disabled = true;
        okBtn.textContent = "创建中…";
        call("api_generate_key", { name: name || "default" }).then(function (d) {
          closeCsModal();
          if (d && d.key) showNewKeyModal(d.key);
          return call("api_my_keys", {}).then(function (kk) { _keys = kk; renderKeys(); });
        }).catch(function (e) {
          okBtn.disabled = false;
          okBtn.textContent = "创建";
          var errEl = cardEl.querySelector(".cs-modal__err");
          if (!errEl) { errEl = el("div", "cs-modal__err"); cardEl.querySelector(".cs-modal__foot").before(errEl); }
          errEl.textContent = "创建失败：" + (e && e.message ? e.message : e);
        });
      },
    });
  }

  function showNewKeyModal(key) {
    showModal({
      title: "密钥已创建",
      kind: "success",
      body: '<p class="cs-modal__hint">这把密钥仅显示一次，请立即复制并妥善保管。关闭后将无法再次查看。</p>' +
        '<div class="cs-modal__keybox"><code id="cs-new-key-code">' + esc(key) + "</code></div>",
      confirmText: "我已复制",
      cancelText: "关闭",
      onConfirm: function () { closeCsModal(); },
    });
    // 复制按钮单独挂（body 里的 code 点击即复制）
    setTimeout(function () {
      var codeEl = document.getElementById("cs-new-key-code");
      if (codeEl) codeEl.addEventListener("click", function () { copyText(key); });
    }, 0);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var t = el("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch (e) {} t.remove();
    }
  }

  async function deleteKey(id) {
    if (!id) return;
    showModal({
      title: "撤销密钥",
      kind: "danger",
      body: '<p class="cs-modal__hint">确认撤销这把密钥？此操作不可恢复，撤销后该密钥立即失效。</p>',
      confirmText: "确认撤销",
      confirmKind: "danger",
      onConfirm: function (val, cardEl, okBtn) {
        okBtn.disabled = true;
        okBtn.textContent = "撤销中…";
        call("api_delete_key", { key_id: id, id: id }).then(function () {
          closeCsModal();
          return call("api_my_keys", {}).then(function (kk) { _keys = kk; renderKeys(); });
        }).catch(function (e) {
          okBtn.disabled = false;
          okBtn.textContent = "确认撤销";
          var errEl = cardEl.querySelector(".cs-modal__err");
          if (!errEl) { errEl = el("div", "cs-modal__err"); cardEl.querySelector(".cs-modal__foot").before(errEl); }
          errEl.textContent = "撤销失败：" + (e && e.message ? e.message : e);
        });
      },
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
