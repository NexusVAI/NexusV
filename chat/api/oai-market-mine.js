/* Cancri 我的上架 — market_mine.html 页面逻辑（基于 usage.html UI 框架填数据）。
 * 复用 usage.html 的统计卡/图表/Tab/汇总区 DOM，只填我的上架数据：
 *   - 统计卡 #mm-stat-value → 待结算收益（available_micro）
 *   - 汇总区 #mm-summary-value → 累计收益（total_credit_micro）
 *   - 图表 #mm-chart → 按天结算柱状图（复用 recharts 既有结构，简化为文本柱）
 *   - Tab "调用日志"/"提现工单" → 切换显示对应内容
 * 弹窗（上架/提现）用 inline style，因 usage.html 是 SingleFile 无 oai-platform.css。
 * 鉴权与 api-keys-app.js 一致；接口走 cancri-market。
 */
(function () {
  "use strict";
  var MARKET_BASE = (window.__SUPABASE_URL__ || "") + "/functions/v1/cancri-market";
  var GW = (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

  // 上架图标选择器（复用 api-models-app.js BRAND_LOGO 子集）
  var ICON_OPTIONS = [
    { key: "openai", label: "OpenAI", icon: "./api/openai.svg" },
    { key: "anthropic", label: "Anthropic", icon: "./api/claude-color.svg" },
    { key: "google", label: "Google", icon: "./api/gemini-color.svg" },
    { key: "deepseek", label: "DeepSeek", icon: "./api/" + encodeURI("deepseek-color (1).svg") },
    { key: "xai", label: "xAI", icon: "./api/grok.svg" },
    { key: "moonshot", label: "Moonshot", icon: "./api/moonshot.svg" },
    { key: "zhipu", label: "Zhipu", icon: "./api/zhipu-color.svg" },
    { key: "qwen", label: "Qwen", icon: "./api/qwen-color.svg" },
    { key: "minimax", label: "MiniMax", icon: "./api/minimax-color.svg" },
    { key: "doubao", label: "Doubao", icon: "./api/doubao-color.svg" },
    { key: "meta", label: "Meta", icon: "./api/meta-color.svg" },
    { key: "mistral", label: "Mistral", icon: "./api/mistral-color.svg" },
    { key: "cancri", label: "Cancri", icon: "./Logo/Cancri1.jpg" },
  ];

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function fmtCny(micro) { var v = (Number(micro) || 0) / 1e6; if (v === 0) return "¥0.00"; if (v < 0.01) return "¥" + v.toFixed(6); return "¥" + v.toFixed(2); }
  function fmtTime(s) { if (!s) return "—"; try { var d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString("zh-CN", { hour12: false }); } catch (e) { return String(s); } }
  function setText(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }

  var sb;
  function getClient() { if (sb) return sb; sb = window.supabase.createClient(window.__SUPABASE_URL__, ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cancri_supabase_auth" } }); return sb; }
  async function getSession() { var d = await getClient().auth.getSession(); return d.data && d.data.session; }
  async function hasApiAccess(token) {
    try { var r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON }, body: JSON.stringify({ endpoint: "api_my_keys", __auth_token: token }) }); if (!r.ok) return false; var d = await r.json(); return !!(d && d.applications && d.applications.some(function (a) { return a.status === "approved"; })); } catch (e) { return false; }
  }
  async function apiGet(path, token) { var r = await fetch(MARKET_BASE + path, { headers: { Authorization: "Bearer " + token } }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
  async function apiPost(path, body, token) { var r = await fetch(MARKET_BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) }); var d = await r.json().catch(function () { return {}; }); if (!r.ok) throw Object.assign(new Error(d.error || ("HTTP " + r.status)), { code: d.code, payload: d }); return d; }
  async function apiDelete(path, token) { var r = await fetch(MARKET_BASE + path, { method: "DELETE", headers: { Authorization: "Bearer " + token } }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }

  var state = { token: null, overview: null, withdrawChannel: null, selectedPlatform: "openai" };

  // 填统计卡 + 汇总区
  function renderOverview(o) {
    state.overview = o;
    var b = (o && o.balance) || {};
    var s = (o && o.summary) || {};
    setText("mm-stat-value", fmtCny(b.available_micro));
    setText("mm-summary-value", fmtCny(s.total_credit_micro));
    renderListings(o.listings || []);
  }

  // 我的挂单：塞进 Tab 内容区（替换原 recharts 图表区下方）
  function renderListings(listings) {
    var box = document.getElementById("mm-listings");
    if (!box) return;
    if (!Array.isArray(listings) || listings.length === 0) { box.innerHTML = '<div style="padding:16px;color:var(--gray-500,#888);">你还没有上架任何挂单。点上方"新增上架"开始。</div>'; return; }
    box.innerHTML = listings.map(function (l) {
      var sc = { active: "#4ade80", pending: "#f59e0b", failed: "#f87171", depleted: "#888" }[l.status] || "#888";
      var models = Array.isArray(l.model_whitelist) ? l.model_whitelist.join("、") : "—";
      return '<div style="display:flex;flex-direction:column;gap:6px;padding:12px;border:1px solid var(--gray-200,#e5e7eb);border-radius:8px;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;gap:8px;"><span style="font-weight:600;">' + esc(l.display_name || l.platform) + '</span><span style="font-size:11px;color:' + sc + ';">' + esc(l.status) + '</span></div>' +
        '<div style="font-size:12px;color:var(--gray-500,#888);">平台 ' + esc(l.platform) + ' · 倍率 ' + esc(l.rate_multiplier) + '× · 模型 ' + esc(models) + '</div>' +
        (l.status_detail ? '<div style="font-size:11px;color:var(--gray-400,#aaa);">' + esc(l.status_detail) + '</div>' : "") +
        '<button type="button" style="align-self:flex-start;font-size:12px;color:#f87171;background:none;border:none;cursor:pointer;" data-delist="' + esc(l.id) + '">下架</button>' +
        '</div>';
    }).join("");
    box.querySelectorAll("[data-delist]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (!confirm("确认下架此挂单？")) return;
        try { await apiDelete("/listings/" + btn.getAttribute("data-delist"), state.token); await refreshOverview(); } catch (e) { alert("下架失败：" + e.message); }
      });
    });
  }

  // 调用日志表
  function renderCalls(calls) {
    var box = document.getElementById("mm-calls");
    if (!box) return;
    if (!Array.isArray(calls) || calls.length === 0) { box.innerHTML = '<div style="padding:16px;color:var(--gray-500,#888);">暂无调用日志</div>'; return; }
    box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:var(--gray-75,rgba(0,0,0,0.05));">' +
      ["时间", "买家", "模型", "入tokens", "出tokens", "买家实付", "你的收益"].map(function (t) { return '<th style="padding:8px;text-align:' + (t.includes("tokens") || t.includes("实付") || t.includes("收益") ? "right" : "left") + ';border-bottom:1px solid var(--gray-200,#e5e7eb);">' + t + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      calls.map(function (c) {
        return '<tr style="border-bottom:1px solid var(--gray-100,#f3f4f6);">' +
          '<td style="padding:8px;">' + esc(fmtTime(c.created_at)) + "</td>" +
          '<td style="padding:8px;">' + esc(c.buyer_email || "匿名") + "</td>" +
          '<td style="padding:8px;">' + esc(c.model_id) + "</td>" +
          '<td style="padding:8px;text-align:right;">' + esc(c.tokens_in) + "</td>" +
          '<td style="padding:8px;text-align:right;">' + esc(c.tokens_out) + "</td>" +
          '<td style="padding:8px;text-align:right;color:var(--gray-500,#888);">' + esc(fmtCny(c.buyer_charged_micro)) + "</td>" +
          '<td style="padding:8px;text-align:right;font-weight:600;">' + esc(fmtCny(c.seller_credit_micro)) + "</td>" +
        "</tr>";
      }).join("") + "</tbody></table>";
  }

  // 提现工单表
  function renderTickets(tickets) {
    var box = document.getElementById("mm-tickets");
    if (!box) return;
    if (!Array.isArray(tickets) || tickets.length === 0) { box.innerHTML = '<div style="padding:16px;color:var(--gray-500,#888);">暂无提现工单</div>'; return; }
    var sl = { pending: "审核中", approved: "已通过", rejected: "已驳回", done: "已到账" };
    var sc = { pending: "#f59e0b", approved: "#4ade80", rejected: "#f87171", done: "#4ade80" };
    box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:var(--gray-75,rgba(0,0,0,0.05));">' +
      ["时间", "渠道", "金额", "微信/QQ", "状态", "备注"].map(function (t) { return '<th style="padding:8px;text-align:left;border-bottom:1px solid var(--gray-200,#e5e7eb);">' + t + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      tickets.map(function (t) {
        return '<tr style="border-bottom:1px solid var(--gray-100,#f3f4f6);">' +
          '<td style="padding:8px;">' + esc(fmtTime(t.created_at)) + "</td>" +
          '<td style="padding:8px;">' + esc(t.channel === "site" ? "站内余额" : "微信") + "</td>" +
          '<td style="padding:8px;">' + esc(fmtCny(t.amount_micro)) + "</td>" +
          '<td style="padding:8px;">' + esc(t.wechat_id || "—") + "</td>" +
          '<td style="padding:8px;color:' + (sc[t.status] || "#888") + ';">' + esc(sl[t.status] || t.status) + "</td>" +
          '<td style="padding:8px;color:var(--gray-500,#888);">' + esc(t.review_note || (t.reviewed_at ? fmtTime(t.reviewed_at) : "—")) + "</td>" +
        "</tr>";
      }).join("") + "</tbody></table>";
  }

  async function refreshOverview() { var o = await apiGet("/me/overview", state.token); renderOverview(o); }
  async function loadCalls() { var d = await apiGet("/me/calls?limit=50", state.token); renderCalls(d.calls || []); }
  async function loadTickets() { var d = await apiGet("/me/tickets", state.token); renderTickets(d.tickets || []); }

  // ── Tab 切换（复用 usage.html 的 Tab 按钮，切换显示我的内容区）──
  function setupTabs() {
    var tabs = document.querySelectorAll('[data-radix-collection-item]');
    var panels = { calls: document.getElementById("mm-panel-calls"), tickets: document.getElementById("mm-panel-tickets") };
    tabs.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var txt = btn.textContent || "";
        tabs.forEach(function (b) { b.setAttribute("data-state", "off"); b.setAttribute("aria-checked", "false"); });
        btn.setAttribute("data-state", "on"); btn.setAttribute("aria-checked", "true");
        if (txt.indexOf("调用日志") >= 0) { if (panels.calls) panels.calls.style.display = ""; if (panels.tickets) panels.tickets.style.display = "none"; }
        else if (txt.indexOf("提现工单") >= 0) { if (panels.calls) panels.calls.style.display = "none"; if (panels.tickets) panels.tickets.style.display = ""; }
      });
    });
  }

  // ── 弹窗：用 inline style（usage.html 无 oai-platform.css）──
  function modalStyle() {
    return 'position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);';
  }
  function cardStyle() {
    return 'width:100%;max-width:32rem;border-radius:16px;border:1px solid var(--gray-200,#e5e7eb);background:var(--gray-0,#fff);box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);padding:24px;display:flex;flex-direction:column;gap:16px;max-height:90vh;overflow-y:auto;';
  }
  function inputStyle() { return 'width:100%;padding:8px 12px;border:1px solid var(--gray-200,#e5e7eb);border-radius:8px;font-size:14px;background:var(--gray-0,#fff);color:var(--gray-900,#111);box-sizing:border-box;'; }
  function btnStyle(kind) { return 'padding:8px 16px;border-radius:9999px;border:none;font-size:14px;cursor:pointer;' + (kind === "primary" ? "background:#0080f7;color:#fff;" : "background:var(--gray-100,#f3f4f6);color:var(--gray-900,#111);"); }

  function ensureModals() {
    if (document.getElementById("mm-listing-modal")) return;
    // 上架弹窗
    var lm = document.createElement("div");
    lm.id = "mm-listing-modal";
    lm.setAttribute("data-open", "false");
    lm.style.cssText = modalStyle();
    lm.innerHTML = '<div style="' + cardStyle() + '">' +
      '<h2 style="font-size:20px;font-weight:600;margin:0;">新增上架</h2>' +
      '<div id="mm-lm-error" style="display:none;font-size:13px;color:#f87171;background:rgba(248,113,113,0.1);padding:8px;border-radius:6px;"></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">模型图标</label><div id="mm-icon-picker" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">模型名称</label><input type="text" id="mm-f-name" style="' + inputStyle() + '" placeholder="如 我的 GPT-4o" maxlength="80"></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">模型 ID（多个用逗号分隔）</label><input type="text" id="mm-f-models" style="' + inputStyle() + '" placeholder="gpt-4o-mini,gpt-4o"></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">端点地址（必含 /v1）</label><input type="text" id="mm-f-baseurl" style="' + inputStyle() + '" placeholder="https://api.openai.com/v1"></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">API Key（加密存储）</label><input type="password" id="mm-f-key" style="' + inputStyle() + '" placeholder="sk-..." autocomplete="off"></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">描述（可选）</label><textarea id="mm-f-desc" style="' + inputStyle() + 'height:60px;" maxlength="500"></textarea></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">卖家倍率</label><input type="number" id="mm-f-mult" style="' + inputStyle() + '" step="0.1" min="0.1" max="100" value="1.0"></div>' +
      '<label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;cursor:pointer;"><input type="checkbox" id="mm-f-disclaim" style="margin-top:2px;"><span>因上游内容问题导致的一切后果由卖家承担，平台有权随时下架违规 listing 并封禁账号。</span></label>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" id="mm-lm-cancel" style="' + btnStyle() + '">取消</button><button type="button" id="mm-lm-submit" style="' + btnStyle("primary") + '">发布上架</button></div>' +
      '</div>';
    document.body.appendChild(lm);

    // 提现弹窗
    var wm = document.createElement("div");
    wm.id = "mm-withdraw-modal";
    wm.setAttribute("data-open", "false");
    wm.style.cssText = modalStyle();
    wm.innerHTML = '<div style="' + cardStyle() + 'max-width:28rem;">' +
      '<h2 id="mm-wm-title" style="font-size:20px;font-weight:600;margin:0;">提现</h2>' +
      '<div id="mm-wm-error" style="display:none;font-size:13px;color:#f87171;background:rgba(248,113,113,0.1);padding:8px;border-radius:6px;"></div>' +
      '<div><label style="font-size:13px;display:block;margin-bottom:4px;">金额（¥）</label><input type="number" id="mm-wd-amount" style="' + inputStyle() + '" step="0.01" min="0.01" placeholder="0.00"><div style="font-size:11px;color:var(--gray-500,#888);margin-top:4px;">可提现：<span id="mm-wd-avail">¥0.00</span></div></div>' +
      '<div id="mm-wd-wechat" style="display:none;flex-direction:column;gap:4px;"><label style="font-size:13px;">微信号/QQ号</label><input type="text" id="mm-wd-wechatid" style="' + inputStyle() + '" placeholder="微信号或QQ号"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" id="mm-wm-cancel" style="' + btnStyle() + '">取消</button><button type="button" id="mm-wm-submit" style="' + btnStyle("primary") + '">确认提现</button></div>' +
      '</div>';
    document.body.appendChild(wm);

    // 图标选择器
    var picker = document.getElementById("mm-icon-picker");
    picker.innerHTML = ICON_OPTIONS.map(function (o) {
      return '<button type="button" data-platform="' + esc(o.key) + '" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--gray-200,#e5e7eb);border-radius:6px;background:var(--gray-0,#fff);cursor:pointer;font-size:12px;"><img src="' + esc(o.icon) + '" style="width:16px;height:16px;border-radius:3px;">' + esc(o.label) + '</button>';
    }).join("");
    function selPlatform(k) {
      state.selectedPlatform = k;
      picker.querySelectorAll("button").forEach(function (b) {
        b.style.borderColor = b.getAttribute("data-platform") === k ? "#0080f7" : "var(--gray-200,#e5e7eb)";
      });
    }
    picker.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { selPlatform(b.getAttribute("data-platform")); }); });
    selPlatform("openai");

    // 上架弹窗逻辑
    function openListing() {
      ["mm-f-name", "mm-f-models", "mm-f-baseurl", "mm-f-key", "mm-f-desc"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
      document.getElementById("mm-f-mult").value = "1.0";
      document.getElementById("mm-f-disclaim").checked = false;
      document.getElementById("mm-lm-error").style.display = "none";
      selPlatform("openai");
      lm.style.display = "flex";
    }
    document.getElementById("mm-lm-cancel").addEventListener("click", function () { lm.style.display = "none"; });
    document.getElementById("mm-lm-submit").addEventListener("click", async function () {
      var err = document.getElementById("mm-lm-error"); err.style.display = "none";
      function fail(m) { err.textContent = m; err.style.display = "block"; }
      var name = document.getElementById("mm-f-name").value.trim();
      var models = document.getElementById("mm-f-models").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var baseUrl = document.getElementById("mm-f-baseurl").value.trim();
      var key = document.getElementById("mm-f-key").value;
      var desc = document.getElementById("mm-f-desc").value.trim();
      var mult = parseFloat(document.getElementById("mm-f-mult").value) || 1.0;
      var disclaim = document.getElementById("mm-f-disclaim").checked;
      if (!name) return fail("请填写模型名称");
      if (models.length === 0) return fail("请填写至少一个模型 ID");
      if (!baseUrl || !baseUrl.includes("/v1")) return fail("端点地址必须包含 /v1");
      if (!key) return fail("请填写 API Key");
      if (!disclaim) return fail("必须勾选免责声明");
      var btn = document.getElementById("mm-lm-submit"); btn.disabled = true; btn.textContent = "提交中…";
      try { await apiPost("/listings", { platform: state.selectedPlatform, base_url: baseUrl, key: key, model_whitelist: models, rate_multiplier: mult, display_name: name, description: desc }, state.token); lm.style.display = "none"; await refreshOverview(); } catch (e) { fail("上架失败：" + (e.message || e) + (e.payload && e.payload.detail ? "（" + e.payload.detail + "）" : "")); } finally { btn.disabled = false; btn.textContent = "发布上架"; }
    });

    // 提现弹窗逻辑
    function openWithdraw(channel) {
      state.withdrawChannel = channel;
      document.getElementById("mm-wm-title").textContent = channel === "site" ? "提现到站内余额" : "提现到微信（提交工单）";
      document.getElementById("mm-wd-amount").value = "";
      document.getElementById("mm-wd-wechatid").value = "";
      document.getElementById("mm-wd-wechat").style.display = channel === "wechat" ? "flex" : "none";
      var avail = (state.overview && state.overview.balance && state.overview.balance.available_micro) || 0;
      document.getElementById("mm-wd-avail").textContent = fmtCny(avail);
      document.getElementById("mm-wm-error").style.display = "none";
      wm.style.display = "flex";
    }
    document.getElementById("mm-wm-cancel").addEventListener("click", function () { wm.style.display = "none"; });
    document.getElementById("mm-wm-submit").addEventListener("click", async function () {
      var err = document.getElementById("mm-wm-error"); err.style.display = "none";
      function fail(m) { err.textContent = m; err.style.display = "block"; }
      var amt = parseFloat(document.getElementById("mm-wd-amount").value);
      if (!amt || amt <= 0) return fail("请输入有效金额");
      var micro = Math.floor(amt * 1e6);
      var wid = document.getElementById("mm-wd-wechatid").value.trim();
      if (state.withdrawChannel === "wechat" && !wid) return fail("请填写微信号/QQ号");
      var btn = document.getElementById("mm-wm-submit"); btn.disabled = true; btn.textContent = "处理中…";
      try { await apiPost("/me/withdraw", { channel: state.withdrawChannel, amount_micro: micro, wechat_id: state.withdrawChannel === "wechat" ? wid : null }, state.token); wm.style.display = "none"; await Promise.all([refreshOverview(), loadTickets()]); } catch (e) { fail("提现失败：" + (e.message || e)); } finally { btn.disabled = false; btn.textContent = "确认提现"; }
    });

    // 暴露打开函数
    window.__mmOpenListing = openListing;
    window.__mmOpenWithdraw = openWithdraw;
  }

  // 注入操作按钮（新增上架 / 提现）+ Tab 内容面板到 usage.html 主区
  function injectControls() {
    // 在 h1 标题区附近加按钮。usage.html h1 是 <h1 ...>我的上架</h1>
    var h1 = document.querySelector('h1');
    if (h1 && h1.textContent.indexOf("我的上架") >= 0 && !document.getElementById("mm-controls")) {
      var ctrl = document.createElement("div");
      ctrl.id = "mm-controls";
      ctrl.style.cssText = "display:flex;gap:8px;margin-top:16px;";
      ctrl.innerHTML = '<button type="button" id="mm-btn-new" style="' + btnStyle("primary") + '">新增上架</button>' +
        '<button type="button" id="mm-btn-wsite" style="' + btnStyle() + '">提现到站内</button>' +
        '<button type="button" id="mm-btn-wwechat" style="' + btnStyle() + '">提现到微信</button>' +
        '<button type="button" id="mm-btn-refresh" style="' + btnStyle() + '">刷新</button>';
      h1.parentNode.insertBefore(ctrl, h1.nextSibling);
      document.getElementById("mm-btn-new").addEventListener("click", function () { window.__mmOpenListing(); });
      document.getElementById("mm-btn-wsite").addEventListener("click", function () { window.__mmOpenWithdraw("site"); });
      document.getElementById("mm-btn-wwechat").addEventListener("click", function () { window.__mmOpenWithdraw("wechat"); });
      document.getElementById("mm-btn-refresh").addEventListener("click", function () { Promise.all([refreshOverview(), loadCalls(), loadTickets()]).catch(function (e) { alert("刷新失败：" + e.message); }); });
    }
    // 在 Tab 内容区注入我的面板（调用日志 / 提现工单 / 我的挂单）
    // usage.html 的 Tab 下方是 <div class="grid grid-cols-1 gap-4 p-4 pb-20 lg:grid-cols-2">
    var grid = document.querySelector('.grid.grid-cols-1.gap-4.p-4.pb-20');
    if (grid && !document.getElementById("mm-panels")) {
      var panels = document.createElement("div");
      panels.id = "mm-panels";
      panels.style.cssText = "padding:0 16px 80px;";
      panels.innerHTML =
        '<div id="mm-panel-calls"><h3 style="font-size:16px;font-weight:600;margin:12px 0 8px;">调用日志</h3><div id="mm-calls"></div></div>' +
        '<div id="mm-panel-tickets" style="display:none;"><h3 style="font-size:16px;font-weight:600;margin:12px 0 8px;">提现工单</h3><div id="mm-tickets"></div></div>' +
        '<div id="mm-panel-listings"><h3 style="font-size:16px;font-weight:600;margin:24px 0 8px;">我的挂单</h3><div id="mm-listings"></div></div>';
      grid.parentNode.insertBefore(panels, grid.nextSibling);
    }
  }

  async function init() {
    if (!window.supabase || !window.__SUPABASE_URL__) { console.error("market-mine: deps missing"); return; }
    var session = await getSession().catch(function () { return null; });
    if (!session) { if (window.PlatformAuth) window.PlatformAuth.redirectToLogin(); return; }
    state.token = session.access_token;
    var approved = await hasApiAccess(session.access_token);
    if (!approved) {
      var h1 = document.querySelector("h1");
      if (h1) h1.textContent = "需先开通 API";
      var main = document.querySelector(".yaYrI") || document.querySelector("main");
      if (main) main.innerHTML += '<div style="padding:40px;text-align:center;"><a href="./api_apply.html" style="' + btnStyle("primary") + 'display:inline-block;text-decoration:none;line-height:32px;">去申请接入</a></div>';
      return;
    }
    ensureModals();
    injectControls();
    setupTabs();
    try { await Promise.all([refreshOverview(), loadCalls(), loadTickets()]); } catch (e) { console.error("market-mine load:", e); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
