/* Cancri 我的上架 — market_mine.html 页面逻辑。
 *
 * 鉴权与 api-keys-app.js 一致；数据接口走 cancri-market：
 *   GET  /me/overview   → 余额(available/frozen/withdrawn) + 挂单 + 收益统计
 *   GET  /me/calls      → 调用日志（谁用了我的 Key，token/结算）
 *   GET  /me/tickets    → 提现工单列表
 *   POST /me/withdraw    → 申请提现（site 即时 / wechat 工单）
 *   POST /listings       → 上架（含 Key 验证）
 *   DELETE /listings/:id → 下架
 *
 * 字段严格对齐后端 spec，不发明字段。¥1 = 1_000_000 micro。
 */
(function () {
  "use strict";

  var MARKET_BASE = (window.__SUPABASE_URL__ || "") + "/functions/v1/cancri-market";
  var GW = (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

  // 模型图标选择器（复用 api-models-app.js BRAND_LOGO 子集，按 platform key）
  var ICON_OPTIONS = [
    { key: "openai", label: "OpenAI", icon: "./openai.svg" },
    { key: "anthropic", label: "Anthropic", icon: "./claude-color.svg" },
    { key: "google", label: "Google", icon: "./gemini-color.svg" },
    { key: "deepseek", label: "DeepSeek", icon: encodeURI("./deepseek-color (1).svg") },
    { key: "xai", label: "xAI", icon: "./grok.svg" },
    { key: "moonshot", label: "Moonshot", icon: "./moonshot.svg" },
    { key: "zhipu", label: "Zhipu", icon: "./zhipu-color.svg" },
    { key: "qwen", label: "Qwen", icon: "./qwen-color.svg" },
    { key: "minimax", label: "MiniMax", icon: "./minimax-color.svg" },
    { key: "doubao", label: "Doubao", icon: "./doubao-color.svg" },
    { key: "meta", label: "Meta", icon: "./meta-color.svg" },
    { key: "mistral", label: "Mistral", icon: "./mistral-color.svg" },
    { key: "cancri", label: "Cancri", icon: "../Logo/Cancri1.jpg" },
  ];

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function fmtCny(micro) {
    var v = (Number(micro) || 0) / 1e6;
    if (v === 0) return "¥0.00";
    if (v < 0.01) return "¥" + v.toFixed(6);
    return "¥" + v.toFixed(2);
  }
  function fmtTime(s) {
    if (!s) return "—";
    try { var d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString("zh-CN", { hour12: false }); } catch (e) { return String(s); }
  }
  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }
  function setStatus(el, text, color) { if (el) { el.textContent = text; el.style.color = color || ""; } }

  var sb;
  function getClient() {
    if (sb) return sb;
    sb = window.supabase.createClient(window.__SUPABASE_URL__, ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cancri_supabase_auth" },
    });
    return sb;
  }
  async function getSession() {
    var d = await getClient().auth.getSession();
    return d.data && d.data.session;
  }
  async function hasApiAccess(token) {
    try {
      var resp = await fetch(GW, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON },
        body: JSON.stringify({ endpoint: "api_my_keys", __auth_token: token }),
      });
      if (!resp.ok) return false;
      var data = await resp.json();
      return !!(data && data.applications && data.applications.some(function (a) { return a.status === "approved"; }));
    } catch (e) { return false; }
  }

  async function apiGet(path, token) {
    var r = await fetch(MARKET_BASE + path, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }
  async function apiPost(path, body, token) {
    var r = await fetch(MARKET_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw Object.assign(new Error(data.error || ("HTTP " + r.status)), { code: data.code, payload: data });
    return data;
  }
  async function apiDelete(path, token) {
    var r = await fetch(MARKET_BASE + path, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }

  var state = { token: null, overview: null, withdrawChannel: null, selectedPlatform: "openai" };

  function renderOverview(o) {
    state.overview = o;
    var b = (o && o.balance) || {};
    var s = (o && o.summary) || {};
    document.getElementById("stat-available").textContent = fmtCny(b.available_micro);
    document.getElementById("stat-frozen").textContent = fmtCny(b.frozen_micro);
    document.getElementById("stat-withdrawn").textContent = fmtCny(b.withdrawn_micro);
    document.getElementById("stat-total-credit").textContent = fmtCny(s.total_credit_micro);
    renderListings(o.listings || []);
  }

  function renderListings(listings) {
    var box = document.getElementById("mine-listings");
    if (!Array.isArray(listings) || listings.length === 0) {
      box.innerHTML = '<div class="text-sm text-secondary py-4 rounded-lg border border-primary-surface bg-surface p-4">你还没有上架任何挂单。点右上角"新增上架"开始。</div>';
      return;
    }
    box.innerHTML = listings.map(function (l) {
      var statusColor = { active: "text-green-500", pending: "text-yellow-500", failed: "text-red-500", depleted: "text-tertiary" }[l.status] || "text-secondary";
      var models = Array.isArray(l.model_whitelist) ? l.model_whitelist.join("、") : "—";
      return (
        '<div class="flex flex-col gap-2 rounded-lg border border-primary-surface bg-surface p-4 md:flex-row md:items-center md:justify-between">' +
          '<div class="flex flex-col gap-1 min-w-0 flex-1">' +
            '<div class="flex items-center gap-2"><span class="font-semibold text-default">' + esc(l.display_name || l.platform) + '</span><span class="text-xs ' + statusColor + '">' + esc(l.status) + '</span></div>' +
            '<div class="text-xs text-secondary">平台 ' + esc(l.platform) + ' · 倍率 ' + esc(l.rate_multiplier) + '× · 模型 ' + esc(models) + '</div>' +
            (l.status_detail ? '<div class="text-xs text-tertiary">' + esc(l.status_detail) + '</div>' : "") +
          '</div>' +
          '<div class="flex gap-2 shrink-0">' +
            '<button type="button" class="text-xs text-red-500 hover:underline" data-delist="' + esc(l.id) + '">下架</button>' +
          '</div>' +
        "</div>"
      );
    }).join("");
    box.querySelectorAll("[data-delist]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (!confirm("确认下架此挂单？下架后买家不再选用。")) return;
        try {
          await apiDelete("/listings/" + btn.getAttribute("data-delist"), state.token);
          await refreshOverview();
        } catch (e) { alert("下架失败：" + e.message); }
      });
    });
  }

  function renderCalls(calls) {
    var body = document.getElementById("mine-calls-body");
    hide(document.getElementById("mine-calls-loading"));
    if (!Array.isArray(calls) || calls.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="px-3 py-4 text-center text-secondary">暂无调用日志</td></tr>';
      return;
    }
    body.innerHTML = calls.map(function (c) {
      return (
        "<tr class=\"border-t border-primary-surface\">" +
          '<td class="px-3 py-2 text-secondary">' + esc(fmtTime(c.created_at)) + "</td>" +
          '<td class="px-3 py-2">' + esc(c.buyer_email || "匿名") + "</td>" +
          '<td class="px-3 py-2">' + esc(c.model_id) + "</td>" +
          '<td class="px-3 py-2 text-right">' + esc(c.tokens_in) + "</td>" +
          '<td class="px-3 py-2 text-right">' + esc(c.tokens_out) + "</td>" +
          '<td class="px-3 py-2 text-right text-secondary">' + esc(fmtCny(c.buyer_charged_micro)) + "</td>" +
          '<td class="px-3 py-2 text-right font-semibold text-default">' + esc(fmtCny(c.seller_credit_micro)) + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderTickets(tickets) {
    var body = document.getElementById("mine-tickets-body");
    if (!Array.isArray(tickets) || tickets.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="px-3 py-4 text-center text-secondary">暂无提现工单</td></tr>';
      return;
    }
    var statusLabel = { pending: "审核中", approved: "已通过", rejected: "已驳回", done: "已到账" };
    var statusColor = { pending: "text-yellow-500", approved: "text-green-500", rejected: "text-red-500", done: "text-green-500" };
    body.innerHTML = tickets.map(function (t) {
      return (
        "<tr class=\"border-t border-primary-surface\">" +
          '<td class="px-3 py-2 text-secondary">' + esc(fmtTime(t.created_at)) + "</td>" +
          '<td class="px-3 py-2">' + esc(t.channel === "site" ? "站内余额" : "微信") + "</td>" +
          '<td class="px-3 py-2 text-right">' + esc(fmtCny(t.amount_micro)) + "</td>" +
          '<td class="px-3 py-2">' + esc(t.wechat_id || "—") + "</td>" +
          '<td class="px-3 py-2 ' + (statusColor[t.status] || "") + '">' + esc(statusLabel[t.status] || t.status) + "</td>" +
          '<td class="px-3 py-2 text-secondary">' + esc(t.review_note || (t.reviewed_at ? fmtTime(t.reviewed_at) : "—")) + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  async function refreshOverview() {
    var o = await apiGet("/me/overview", state.token);
    renderOverview(o);
  }
  async function loadCalls() {
    var d = await apiGet("/me/calls?limit=50", state.token);
    renderCalls(d.calls || []);
  }
  async function loadTickets() {
    var d = await apiGet("/me/tickets", state.token);
    renderTickets(d.tickets || []);
  }

  // ── Tab 切换 ──
  function setupTabs() {
    document.querySelectorAll(".mine-tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tab = btn.getAttribute("data-tab");
        document.querySelectorAll(".mine-tab-btn").forEach(function (b) {
          b.classList.remove("text-default", "font-semibold", "border-b-2", "border-current");
          b.classList.add("text-secondary");
        });
        btn.classList.add("text-default", "font-semibold", "border-b-2", "border-current");
        btn.classList.remove("text-secondary");
        document.querySelectorAll(".mine-tab-panel").forEach(function (p) { p.classList.add("hidden"); });
        var panel = document.getElementById("mine-tab-" + tab);
        if (panel) panel.classList.remove("hidden");
      });
    });
  }

  // ── 上架弹窗 ──
  function setupListingModal() {
    var modal = document.getElementById("listing-modal");
    var picker = document.getElementById("icon-picker");
    picker.innerHTML = ICON_OPTIONS.map(function (o) {
      return '<button type="button" data-platform="' + esc(o.key) + '" class="flex items-center gap-1 rounded-md border border-primary-surface bg-surface px-2 py-1 text-xs text-default hover:border-current icon-opt" title="' + esc(o.label) + '">' +
        '<img src="' + esc(o.icon) + '" alt="" class="h-4 w-4 rounded-sm" />' +
        '<span>' + esc(o.label) + '</span></button>';
    }).join("");
    function selectPlatform(key) {
      state.selectedPlatform = key;
      document.getElementById("f-platform").value = key;
      picker.querySelectorAll(".icon-opt").forEach(function (b) {
        var on = b.getAttribute("data-platform") === key;
        b.style.borderColor = on ? "var(--color-text, currentColor)" : "";
        b.style.background = on ? "var(--gray-75, rgba(0,0,0,0.05))" : "";
      });
    }
    picker.querySelectorAll(".icon-opt").forEach(function (b) {
      b.addEventListener("click", function () { selectPlatform(b.getAttribute("data-platform")); });
    });
    selectPlatform("openai");

    function openModal() {
      ["f-display-name", "f-model-whitelist", "f-base-url", "f-key", "f-description"].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ""; });
      document.getElementById("f-rate-multiplier").value = "1.0";
      document.getElementById("f-disclaimer").checked = false;
      hide(document.getElementById("listing-modal-error"));
      selectPlatform("openai");
      modal.classList.remove("hidden"); modal.classList.add("flex");
      modal.setAttribute("data-open", "true"); modal.setAttribute("aria-hidden", "false");
    }
    function closeModal() {
      modal.classList.add("hidden"); modal.classList.remove("flex");
      modal.setAttribute("data-open", "false"); modal.setAttribute("aria-hidden", "true");
    }
    document.getElementById("btn-new-listing").addEventListener("click", openModal);
    document.getElementById("listing-modal-cancel").addEventListener("click", closeModal);

    document.getElementById("listing-modal-submit").addEventListener("click", async function () {
      var errBox = document.getElementById("listing-modal-error");
      hide(errBox);
      function fail(msg) { errBox.textContent = msg; show(errBox); }
      var platform = state.selectedPlatform;
      var displayName = document.getElementById("f-display-name").value.trim();
      var modelWhitelist = document.getElementById("f-model-whitelist").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      var baseUrl = document.getElementById("f-base-url").value.trim();
      var key = document.getElementById("f-key").value;
      var description = document.getElementById("f-description").value.trim();
      var rateMultiplier = parseFloat(document.getElementById("f-rate-multiplier").value) || 1.0;
      var disclaimer = document.getElementById("f-disclaimer").checked;
      if (!platform) return fail("请选择模型图标");
      if (!displayName) return fail("请填写模型名称");
      if (modelWhitelist.length === 0) return fail("请填写至少一个模型 ID");
      if (!baseUrl || !baseUrl.includes("/v1")) return fail("端点地址必须包含 /v1");
      if (!key) return fail("请填写 API Key");
      if (!disclaimer) return fail("必须勾选免责声明才能上架");
      var btn = document.getElementById("listing-modal-submit");
      btn.disabled = true; btn.textContent = "提交中…";
      try {
        await apiPost("/listings", {
          platform: platform, base_url: baseUrl, key: key,
          model_whitelist: modelWhitelist, rate_multiplier: rateMultiplier,
          display_name: displayName, description: description,
        }, state.token);
        closeModal();
        await refreshOverview();
      } catch (e) {
        var detail = e.payload && e.payload.detail ? "（" + e.payload.detail + "）" : "";
        fail("上架失败：" + (e.message || e) + detail);
      } finally {
        btn.disabled = false; btn.textContent = "发布上架";
      }
    });
  }

  // ── 提现弹窗 ──
  function setupWithdrawModal() {
    var modal = document.getElementById("withdraw-modal");
    function open(channel) {
      state.withdrawChannel = channel;
      document.getElementById("withdraw-modal-title").textContent = channel === "site" ? "提现到站内余额" : "提现到微信（提交工单）";
      document.getElementById("wd-amount").value = "";
      document.getElementById("wd-wechat-id").value = "";
      var wf = document.getElementById("wd-wechat-fields");
      if (channel === "wechat") { wf.classList.remove("hidden"); wf.classList.add("flex"); }
      else { wf.classList.add("hidden"); wf.classList.remove("flex"); }
      var avail = (state.overview && state.overview.balance && state.overview.balance.available_micro) || 0;
      document.getElementById("wd-available").textContent = fmtCny(avail);
      hide(document.getElementById("withdraw-modal-error"));
      modal.classList.remove("hidden"); modal.classList.add("flex");
      modal.setAttribute("data-open", "true"); modal.setAttribute("aria-hidden", "false");
    }
    function close() {
      modal.classList.add("hidden"); modal.classList.remove("flex");
      modal.setAttribute("data-open", "false"); modal.setAttribute("aria-hidden", "true");
    }
    document.getElementById("btn-withdraw-site").addEventListener("click", function () { open("site"); });
    document.getElementById("btn-withdraw-wechat").addEventListener("click", function () { open("wechat"); });
    document.getElementById("withdraw-modal-cancel").addEventListener("click", close);
    document.getElementById("withdraw-modal-submit").addEventListener("click", async function () {
      var errBox = document.getElementById("withdraw-modal-error");
      hide(errBox);
      function fail(msg) { errBox.textContent = msg; show(errBox); }
      var amountCny = parseFloat(document.getElementById("wd-amount").value);
      if (!amountCny || amountCny <= 0) return fail("请输入有效金额");
      var amountMicro = Math.floor(amountCny * 1e6);
      var wechatId = document.getElementById("wd-wechat-id").value.trim();
      if (state.withdrawChannel === "wechat" && !wechatId) return fail("请填写微信号/QQ号");
      var btn = document.getElementById("withdraw-modal-submit");
      btn.disabled = true; btn.textContent = "处理中…";
      try {
        await apiPost("/me/withdraw", {
          channel: state.withdrawChannel, amount_micro: amountMicro,
          wechat_id: state.withdrawChannel === "wechat" ? wechatId : null,
        }, state.token);
        close();
        await Promise.all([refreshOverview(), loadTickets()]);
      } catch (e) {
        fail("提现失败：" + (e.message || e));
      } finally {
        btn.disabled = false; btn.textContent = "确认提现";
      }
    });
  }

  async function init() {
    if (!window.supabase || !window.__SUPABASE_URL__ || !window.PlatformAuth) return;
    var session = await getSession().catch(function () { return null; });
    if (!session) { show(document.getElementById("mine-not-logged-in")); return; }
    state.token = session.access_token;
    var approved = await hasApiAccess(session.access_token);
    if (!approved) { show(document.getElementById("mine-no-access")); return; }
    show(document.getElementById("mine-accessible"));
    setupTabs();
    setupListingModal();
    setupWithdrawModal();
    document.getElementById("btn-refresh").addEventListener("click", function () {
      Promise.all([refreshOverview(), loadCalls(), loadTickets()]).catch(function (e) { alert("刷新失败：" + e.message); });
    });
    try {
      await Promise.all([refreshOverview(), loadCalls(), loadTickets()]);
    } catch (e) {
      alert("加载失败：" + (e && e.message ? e.message : e));
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
