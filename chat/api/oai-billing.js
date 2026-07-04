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

  // ── Tabs（hash 记忆：#plan / #api）──
  function setTab(tab) {
    ["plan", "api"].forEach(function (t) {
      var btn = $("bp-tab-" + t);
      var panel = $("bp-panel-" + t);
      if (btn) btn.dataset.active = String(t === tab);
      if (panel) panel.dataset.active = String(t === tab);
    });
    try { history.replaceState(null, "", "#" + tab); } catch (e) { /* ignore */ }
  }
  function initTabs() {
    var initial = location.hash === "#api" ? "api" : "plan";
    setTab(initial);
    ["plan", "api"].forEach(function (t) {
      var btn = $("bp-tab-" + t);
      if (btn) btn.addEventListener("click", function () { setTab(t); });
    });
  }

  // ── API 额度（钱包）──
  function renderWallet(data) {
    var wallet = data && data.wallet;
    var balEl = $("billing-balance");
    var metaEl = $("billing-balance-meta");
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
    var badgeEl = $("plan-badge");
    var metaEl = $("plan-meta");
    var ctaEl = $("plan-cta");
    var progWrap = $("plan-progress");
    var progFill = $("plan-progress-fill");
    if (plan && plan.active) {
      var label = plan.display_name || { go: "Go", plus: "Plus", pro: "Pro" }[plan.plan_code] || plan.plan_code || "";
      if (nameEl) nameEl.textContent = label + " 套餐";
      if (badgeEl) { badgeEl.textContent = "有效期至 " + fmtDate(plan.period_end); badgeEl.hidden = false; }
      var total = Number(plan.allowance_cny);
      var remain = Number(plan.remaining_cny);
      if (metaEl) metaEl.textContent = "本月剩余额度 " + fmtCny(remain) + " / " + fmtCny(total) + "（已用 " + fmtCny(plan.used_cny) + "）";
      if (progWrap && progFill && total > 0) {
        progWrap.hidden = false;
        progFill.style.width = Math.max(0, Math.min(100, (remain / total) * 100)).toFixed(1) + "%";
      }
      if (ctaEl) ctaEl.textContent = "续费 / 升级套餐";
    } else {
      if (nameEl) nameEl.textContent = "未订阅";
      if (badgeEl) badgeEl.hidden = true;
      if (metaEl) metaEl.textContent = "订阅套餐后，Web Chat 与 Cancri Code IDE 的付费模型将从套餐月度额度扣费。";
      if (ctaEl) ctaEl.textContent = "选择套餐";
    }
    var catEl = $("plan-catalog");
    var catalog = (data && Array.isArray(data.catalog)) ? data.catalog : [];
    if (catEl && catalog.length) {
      catEl.innerHTML = catalog.map(function (c) {
        var current = plan && plan.active && plan.plan_code === c.plan_code;
        return '<a class="bp-tile" href="../pricing.html">' +
          '<div class="bp-tile-title">' + esc(c.display_name || c.plan_code) + ' · ¥' + esc(c.price_cny) + '/月' + (current ? "（当前）" : "") + "</div>" +
          '<div class="bp-tile-desc">月度额度 ' + fmtCny(c.allowance_cny) + (Number(c.overflow_discount) < 1 ? " · 溢出按量 " + Math.round(Number(c.overflow_discount) * 100) / 10 + "折" : "") + "</div>" +
          "</a>";
      }).join("");
    }
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
      if (results[1].status === "fulfilled") renderWallet(results[1].value);
      else renderWallet(null);
    } catch (e) {
      var metaEl = $("billing-balance-meta");
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
