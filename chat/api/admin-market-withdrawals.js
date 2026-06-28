// admin_market_withdrawals.html — 蟹市提现工单审批。
// 鉴权：JWT 用户 ∈ ADMIN_USER_IDS（后端 cancri-market /admin/* 校验）。
// 接口：GET /admin/tickets（待审列表）、POST /admin/review（通过/驳回）。
(function () {
  "use strict";
  var MARKET_BASE = (window.__SUPABASE_URL__ || "") + "/functions/v1/cancri-market";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

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
  async function apiGet(path, token) {
    var r = await fetch(MARKET_BASE + path, { headers: { Authorization: "Bearer " + token, apikey: ANON } });
    if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status });
    return await r.json();
  }
  async function apiPost(path, body, token) {
    var r = await fetch(MARKET_BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, apikey: ANON },
      body: JSON.stringify(body),
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw Object.assign(new Error(data.error || ("HTTP " + r.status)), { status: r.status, body: data });
    return data;
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function fmtCny(micro) { var v = (Number(micro) || 0) / 1e6; return "¥" + (v < 0.01 ? v.toFixed(6) : v.toFixed(2)); }
  function fmtTime(s) { if (!s) return "—"; try { var d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleString("zh-CN", { hour12: false }); } catch (e) { return String(s); } }
  function toast(text, kind) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = text; t.className = "toast" + (kind ? " " + kind : "");
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () { t.classList.remove("show"); }, 3500);
  }

  var state = { token: null, tickets: [] };

  function render() {
    var tbody = document.getElementById("tbody");
    var empty = document.getElementById("empty");
    document.getElementById("count").textContent = String(state.tickets.length);
    if (state.tickets.length === 0) {
      tbody.innerHTML = "";
      empty.style.display = "";
      return;
    }
    empty.style.display = "none";
    tbody.innerHTML = state.tickets.map(function (t) {
      return (
        "<tr data-id=\"" + esc(t.id) + "\">" +
          "<td>" + esc(fmtTime(t.created_at)) + "</td>" +
          "<td>" + esc(t.seller_email || "—") + "</td>" +
          '<td class="num">' + esc(fmtCny(t.amount_micro)) + "</td>" +
          "<td>" + esc(t.wechat_id || "—") + "</td>" +
          '<td><span class="status-pill pending">待审</span></td>' +
          '<td><button type="button" class="btn primary" data-approve="' + esc(t.id) + '">通过</button> ' +
          '<button type="button" class="btn danger" data-reject="' + esc(t.id) + '">驳回</button></td>' +
        "</tr>"
      );
    }).join("");
    tbody.querySelectorAll("[data-approve]").forEach(function (b) {
      b.addEventListener("click", function () { review(Number(b.getAttribute("data-approve")), true, ""); });
    });
    tbody.querySelectorAll("[data-reject]").forEach(function (b) {
      b.addEventListener("click", function () {
        var note = prompt("驳回原因（可选）：") || "";
        review(Number(b.getAttribute("data-reject")), false, note);
      });
    });
  }

  async function review(ticketId, approve, note) {
    try {
      await apiPost("/admin/review", { ticket_id: ticketId, approve: approve, note: note }, state.token);
      toast(approve ? "已通过，已出账" : "已驳回，已解冻", approve ? "" : "error");
      await load();
    } catch (e) {
      toast("操作失败：" + (e.message || e), "error");
    }
  }

  async function load() {
    try {
      var d = await apiGet("/admin/tickets", state.token);
      state.tickets = d.tickets || [];
      render();
    } catch (e) {
      if (e.status === 403) {
        document.getElementById("forbidden").style.display = "";
        document.getElementById("main").style.display = "none";
      } else {
        toast("加载失败：" + (e.message || e), "error");
      }
    }
  }

  async function init() {
    if (!window.supabase || !window.__SUPABASE_URL__) { toast("依赖加载失败", "error"); return; }
    var session = await getSession().catch(function () { return null; });
    if (!session) {
      document.getElementById("loading").style.display = "none";
      document.getElementById("login-hint").style.display = "";
      return;
    }
    state.token = session.access_token;
    document.getElementById("loading").style.display = "none";
    document.getElementById("main").style.display = "";
    document.getElementById("btn-refresh").addEventListener("click", load);
    await load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
