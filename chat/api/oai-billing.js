// oai-billing.js — API 控制台「结算」页逻辑（套餐 / API 额度 双 Tab）
// 数据源：chat-gateway plan_v4_status（套餐 + 档位目录）+ list_my_orders（钱包）。
(function () {
  "use strict";

  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var sb = null;

  function $(id) { return document.getElementById(id); }
  function fmtCny(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return "¥—";
    return "¥" + v.toFixed(2);
  }
  function fmtDate(s) {
    var d = new Date(s);
    if (isNaN(d.getTime())) return "—";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getSupabase() {
    if (sb) return sb;
    if (!window.supabase || !window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) {
      throw new Error("supabase_not_loaded");
    }
    sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cancri_supabase_auth" },
    });
    return sb;
  }

  async function callGateway(endpoint, payload) {
    var r = await getSupabase().auth.getSession();
    var session = r && r.data ? r.data.session : null;
    if (!session) throw new Error("not_logged_in");
    var resp = await fetch(GW, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: window.__SUPABASE_ANON_KEY__ },
      body: JSON.stringify(Object.assign({ endpoint: endpoint }, payload || {}, { __auth_token: session.access_token })),
    });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw Object.assign(new Error(data.message || data.error || resp.statusText), { status: resp.status, body: data });
    return data;
  }

  // ── Tabs（hash 记忆：#plan / #api / #bills）──
  function moveThumb(tab) {
    var thumb = $("bp-tab-thumb");
    var btn = $("bp-tab-" + tab);
    if (!thumb || !btn) return;
    thumb.style.width = btn.offsetWidth + "px";
    thumb.style.transform = "translateX(" + btn.offsetLeft + "px)";
  }
  function setTab(tab) {
    ["plan", "api", "bills"].forEach(function (t) {
      var on = t === tab;
      var btn = $("bp-tab-" + t);
      var panel = $("bp-panel-" + t);
      if (btn) {
        btn.dataset.state = on ? "on" : "off";
        btn.setAttribute("aria-checked", String(on));
      }
      if (panel) panel.hidden = !on;
    });
    moveThumb(tab);
    try { history.replaceState(null, "", "#" + tab); } catch (e) { /* ignore */ }
  }
  function tabFromHash() {
    if (location.hash === "#api") return "api";
    if (location.hash === "#bills") return "bills";
    return "plan";
  }
  function initTabs() {
    setTab(tabFromHash());
    ["plan", "api", "bills"].forEach(function (t) {
      var btn = $("bp-tab-" + t);
      if (btn) btn.addEventListener("click", function () { setTab(t); });
    });
    window.addEventListener("hashchange", function () { setTab(tabFromHash()); });
  }

  // ── API 额度（钱包）──
  function renderWallet(data) {
    var wallet = data && data.wallet;
    var balEl = $("billing-balance");
    var metaEl = $("billing-meta");
    if (balEl) balEl.textContent = wallet ? fmtCny(wallet.balance_cny) : "¥0.00";
    if (metaEl) {
      if (wallet) {
        var bits = [];
        if (Number(wallet.debt_cny) > 0) bits.push("欠费 " + fmtCny(wallet.debt_cny));
        bits.push("累计充值 " + fmtCny(wallet.cumulative_recharge_cny));
        bits.push("限速档 Tier " + (wallet.tier || 0));
        metaEl.textContent = bits.join(" · ");
      } else {
        metaEl.textContent = "余额加载失败，请刷新重试。";
      }
    }
  }

  // ── 套餐 ──
  function renderPlan(data) {
    var plan = data && data.plan;
    var nameEl = $("plan-name");
    var remainEl = $("plan-remaining");
    var metaEl = $("plan-meta");
    var ctaEl = $("plan-cta");
    if (plan && plan.active) {
      var label = plan.display_name || { go: "Go", plus: "Plus", pro: "Pro" }[plan.plan_code] || plan.plan_code || "";
      if (nameEl) nameEl.textContent = label + " 套餐";
      var total = Number(plan.allowance_cny);
      var remain = Number(plan.remaining_cny);
      if (remainEl) remainEl.textContent = fmtCny(remain);
      if (metaEl) metaEl.textContent = "月度额度 " + fmtCny(total) + "（已用 " + fmtCny(plan.used_cny) + "）· 有效期至 " + fmtDate(plan.period_end);
      if (ctaEl) { var s = ctaEl.querySelector(".NBPKZ"); (s || ctaEl).textContent = "续费 / 升级套餐"; }
    } else {
      if (nameEl) nameEl.textContent = "未订阅";
      if (remainEl) remainEl.textContent = "¥0.00";
      if (metaEl) metaEl.textContent = "订阅套餐后，Web Chat 与 Cancri Code IDE 的付费模型将从套餐月度额度扣费。";
      if (ctaEl) { var s2 = ctaEl.querySelector(".NBPKZ"); (s2 || ctaEl).textContent = "选择套餐"; }
    }
  }

  // ── 账单记录 ──
  function renderBills(data) {
    var orders = (data && data.orders) || [];
    var metaEl = $("bills-meta");
    var wrapEl = $("bills-table-wrap");
    if (!wrapEl) return;
    if (!orders.length) {
      if (metaEl) metaEl.textContent = "暂无账单记录。";
      wrapEl.innerHTML = "";
      return;
    }
    if (metaEl) metaEl.textContent = "共 " + orders.length + " 条记录";
    var rows = orders.map(function (o) {
      var created = fmtDate(o.created_at);
      var kind = o.order_kind_label || (o.order_kind === "topup" ? "充值" : "订阅");
      var spec = o.spec_label || "—";
      var status = o.status || "pending";
      var statusLabel = o.status_label || status;
      var code = o.activation_code ? "<code>" + esc(o.activation_code) + "</code>" : "—";
      var note = o.admin_note ? esc(o.admin_note) : "—";
      return "<tr><td>" + esc(created) + "</td><td>" + esc(kind) + "</td><td>" + esc(spec) +
        "</td><td>" + fmtCny(o.amount_cny) +
        '</td><td><span class="bills-status" data-s="' + esc(status) + '">' + esc(statusLabel) + "</span></td><td>" +
        code + "</td><td>" + note + "</td></tr>";
    }).join("");
    wrapEl.innerHTML = '<table class="bills-table"><thead><tr><th>日期</th><th>类型</th><th>规格</th><th>金额</th><th>工单状态</th><th>激活码</th><th>备注</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  async function init() {
    initTabs();
    try {
      if (!window.PlatformAuth) throw new Error("supabase_not_loaded");
      getSupabase();
      var session = await PlatformAuth.requireSession({ timeoutMs: 6000 });
      if (!session) return;
      var results = await Promise.allSettled([
        callGateway("plan_v4_status", {}),
        callGateway("list_my_orders", {}),
      ]);
      if (results[0].status === "fulfilled") renderPlan(results[0].value);
      else { var pm = $("plan-meta"); if (pm) pm.textContent = "套餐状态加载失败，请刷新重试。"; }
      if (results[1].status === "fulfilled") {
        renderWallet(results[1].value);
        renderBills(results[1].value);
      } else {
        renderWallet(null);
        var bm = $("bills-meta"); if (bm) bm.textContent = "账单记录加载失败，请刷新重试。";
      }
    } catch (e) {
      var metaEl = $("billing-meta");
      var planMeta = $("plan-meta");
      if (e && e.message === "supabase_not_loaded") {
        if (metaEl) metaEl.textContent = "依赖脚本加载失败，请检查网络后刷新。";
        if (planMeta) planMeta.textContent = "依赖脚本加载失败，请检查网络后刷新。";
        return;
      }
      if (e && e.message === "not_logged_in") {
        if (window.PlatformAuth) PlatformAuth.redirectToLogin();
        return;
      }
      if (metaEl) metaEl.textContent = "余额加载失败，请刷新重试。";
      if (planMeta) planMeta.textContent = "套餐状态加载失败，请刷新重试。";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
