// oai-billing.js — API 控制台「结算」总览页逻辑
// 数据源：chat-gateway list_my_orders（一次请求带回 wallet / plan_v4 / orders）。
// 页面结构 1:1 搬运 OpenAI Billing overview：余额卡 + 操作按钮 + 功能磁贴。
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

  function renderWallet(data) {
    var wallet = data && data.wallet;
    var balEl = $("billing-balance");
    var metaEl = $("billing-balance-meta");
    if (balEl) balEl.textContent = wallet ? fmtCny(wallet.balance_cny) : "¥0.00";
    if (metaEl && wallet) {
      var bits = [];
      if (Number(wallet.debt_cny) > 0) bits.push("欠费 " + fmtCny(wallet.debt_cny));
      bits.push("累计充值 " + fmtCny(wallet.cumulative_recharge_cny));
      bits.push("限速档 Tier " + (wallet.tier || 0));
      metaEl.textContent = bits.join(" · ");
    }
    var planEl = $("billing-plan");
    var plan = data && data.plan_v4;
    if (planEl) {
      if (plan && plan.active) {
        var label = plan.display_name || { go: "Go", plus: "Plus", pro: "Pro" }[plan.plan_code] || plan.plan_code || "";
        planEl.textContent = label + " 套餐 · 本月剩余额度 " + fmtCny(plan.remaining_cny);
      } else {
        planEl.textContent = "未订阅 Chat/IDE 套餐";
      }
    }
  }

  async function init() {
    try {
      if (!window.PlatformAuth) throw new Error("supabase_not_loaded");
      getSupabase();
      var session = await PlatformAuth.requireSession({ timeoutMs: 6000 });
      if (!session) return;
      var data = await callGateway("list_my_orders", {});
      renderWallet(data);
    } catch (e) {
      var metaEl = $("billing-balance-meta");
      if (e && e.message === "supabase_not_loaded") {
        if (metaEl) metaEl.textContent = "依赖脚本加载失败，请检查网络后刷新。";
        return;
      }
      if (e && e.message === "not_logged_in") {
        if (window.PlatformAuth) PlatformAuth.redirectToLogin();
        return;
      }
      if (metaEl) metaEl.textContent = "余额加载失败，请刷新重试。";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
