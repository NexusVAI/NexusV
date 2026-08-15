/* NexusV 开放平台 — 联系我们（提交工单 / 反馈）。
 * 2026-08-04：API 申请制取消（注册即可建 Key），本页从「联系销售/申请 API」
 * 改为工单反馈：提交走网关 endpoint=contact_ticket，落库
 * api_applications(kind='contact')，管理员在 admin.html 处理。 */
(function () {
  "use strict";

  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var LOGIN_URL = "chat/index.html";
  var sb = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function getSupabase() {
    if (sb) return sb;
    if (!window.supabase || !window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) throw new Error("supabase_not_loaded");
    sb = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cancri_supabase_auth" },
    });
    return sb;
  }
  async function getSession() {
    var r = await getSupabase().auth.getSession();
    return r && r.data ? r.data.session : null;
  }
  async function callGateway(endpoint, payload) {
    var session = await getSession();
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

  function showMsg(text, isErr) {
    var el = $("msg"); if (!el) return;
    el.textContent = text;
    el.className = "cs-msg " + (isErr ? "err" : "ok");
  }
  function show(id, disp) { var el = $(id); if (el) el.style.display = disp || "block"; }

  function hideLoading() {
    var el = $("loading");
    if (!el) return;
    el.style.display = "none";
    el.removeAttribute("aria-busy");
  }

  function redirectToLogin() {
    location.replace(LOGIN_URL);
  }

  function showAuthError(text) {
    hideLoading();
    var host = $("auth-error");
    if (!host) {
      host = document.createElement("div");
      host.id = "auth-error";
      host.className = "cs-auth-error";
      var col = document.querySelector(".cs-col-right");
      if (col) col.insertBefore(host, col.firstChild);
    }
    host.textContent = text;
    host.style.display = "block";
  }

  async function init() {
    try {
      getSupabase();
      var session = await getSession();
      if (!session || !session.user || session.user.is_anonymous) {
        redirectToLogin();
        return;
      }
      hideLoading();
      var emailEl = $("email"); if (emailEl) emailEl.value = session.user.email || "";
      show("apply-section");
      show("key-section");
      await checkExisting();
    } catch (e) {
      if (e && e.message === "supabase_not_loaded") {
        showAuthError("依赖脚本加载失败，请检查网络后刷新。");
        return;
      }
      redirectToLogin();
    }
  }

  // 列出最近的工单状态（不再隐藏表单：工单可以提多张，上限由后端控制）。
  // 历史 kind='api_apply' 的旧申请不展示，避免让用户以为还需要审核。
  async function checkExisting() {
    try {
      var data = await callGateway("api_my_keys", {});
      var tickets = (data.applications || []).filter(function (a) { return a.kind === "contact"; });
      if (tickets.length === 0) return;
      var statusText = { pending: "待处理", approved: "已处理", rejected: "已关闭" };
      var box = $("existing-status");
      box.innerHTML =
        '<div class="cs-state"><div>最近的工单</div>' +
        tickets.slice(0, 5).map(function (t) {
          var st = esc(String(t.status || ""));
          return '<div style="margin-top:8px"><span class="cs-status-badge status-' + st + '">' +
            esc(statusText[t.status] || st) + '</span>' +
            '<span style="color:var(--tertiary-text);font-size:12px;margin-left:8px">' +
            new Date(t.created_at).toLocaleString("zh-CN") + "</span></div>";
        }).join("") +
        "</div>";
      show("existing-status");
    } catch (e) {
      showMsg("读取工单状态失败，请稍后刷新。", true);
    }
  }

  function composeTicket() {
    var kind = ($("cs-interest") && $("cs-interest").value || "").trim();
    var order = ($("cs-order") && $("cs-order").value || "").trim();
    var need = ($("cs-need") && $("cs-need").value || "").trim();
    var parts = [];
    if (order) parts.push("订单号：" + order);
    parts.push(need);
    return { subject: kind, content: parts.join("\n") };
  }

  function validateRequired() {
    if (!$("cs-interest") || !$("cs-interest").value) return "请选择工单类型。";
    var need = $("cs-need") && $("cs-need").value.trim();
    if (!need || need.length < 2) return "请填写问题描述（至少 2 个字符）。";
    return null;
  }

  async function submitTicket() {
    var err = validateRequired();
    if (err) { showMsg(err, true); return; }
    var ticket = composeTicket();
    var btn = $("submit-btn");
    btn.disabled = true; var orig = btn.textContent; btn.textContent = "提交中…";
    try {
      await callGateway("contact_ticket", ticket);
      showMsg("已提交，我们会通过注册邮箱回复你。", false);
      if ($("cs-need")) $("cs-need").value = "";
      setTimeout(checkExisting, 1000);
    } catch (e) {
      showMsg((e.body && (e.body.message || e.body.error)) || e.message || "提交失败", true);
    }
    btn.disabled = false; btn.textContent = orig;
  }

  function bindUI() {
    var s = $("submit-btn"); if (s) s.addEventListener("click", submitTicket);
    var mk = $("manage-keys-btn"); if (mk) mk.addEventListener("click", function () { location.href = "./api/keys.html"; });
    var bc = $("back-to-chat-btn"); if (bc) bc.addEventListener("click", function () { location.href = "chat/index.html"; });
    if (window.OaiTrustedLogos) {
      var host = $("cs-trusted-logos");
      if (host) window.OaiTrustedLogos.init(host);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bindUI(); init(); });
  else { bindUI(); init(); }
})();
