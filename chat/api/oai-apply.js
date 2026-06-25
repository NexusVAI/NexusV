/* NexusV 开放平台 — 联系销售人员 / API 申请。
 * 复用 api-apply-app.js 的鉴权与提交模式（supabase 会话 + api_apply 端点，
 * 后端仅存 `purpose` 自由文本）。本页 1:1 对标 openai.com/contact-sales，
 * 把"感兴趣方向 / 公司规模 / 公司 / 姓名 / 电话 / 业务需求"一并编入 purpose，
 * 使其随申请记录持久化。除业务需求外均为必填（与 OpenAI 一致）。 */
(function () {
  "use strict";

  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var sb = null;
  function $(id) { return document.getElementById(id); }

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
  function hide(id) { var el = $(id); if (el) el.style.display = "none"; }
  function show(id, disp) { var el = $(id); if (el) el.style.display = disp || "block"; }

  async function init() {
    try {
      getSupabase();
      var session = await getSession();
      hide("loading");
      if (!session || !session.user || session.user.is_anonymous) { show("login-section"); return; }
      var emailEl = $("email"); if (emailEl) emailEl.value = session.user.email || "";
      show("apply-section");
      await checkExisting();
    } catch (e) {
      hide("loading");
      show("login-section");
      var ls = $("login-section");
      if (ls) ls.querySelector("[data-cs-login-msg]") && (ls.querySelector("[data-cs-login-msg]").textContent =
        e && e.message === "supabase_not_loaded" ? "依赖脚本加载失败，请检查网络后刷新。" : "请先登录后再申请。");
    }
  }

  async function checkExisting() {
    try {
      var data = await callGateway("api_my_keys", {});
      if (data.applications && data.applications.length > 0) {
        var app = data.applications[0];
        var box = $("existing-status");
        var statusText = { pending: "审核中", approved: "已通过", rejected: "已拒绝" }[app.status] || app.status;
        box.innerHTML =
          '<div class="cs-state"><div>申请状态：<span class="cs-status-badge status-' + app.status + '">' + statusText + "</span></div>" +
          '<div style="color:var(--tertiary-text);font-size:12px;margin-top:8px">申请时间：' + new Date(app.created_at).toLocaleString("zh-CN") + "</div></div>";
        show("existing-status");
        hide("apply-form");
        if (app.status === "approved") show("key-section");
      }
    } catch (e) {
      showMsg("读取申请状态失败，请稍后刷新。", true);
    }
  }

  function composePurpose() {
    var interest = ($("cs-interest") && $("cs-interest").value || "").trim();
    var companysize = ($("cs-companysize") && $("cs-companysize").value || "").trim();
    var first = ($("cs-firstname") && $("cs-firstname").value || "").trim();
    var last = ($("cs-lastname") && $("cs-lastname").value || "").trim();
    var company = ($("cs-company") && $("cs-company").value || "").trim();
    var phone = ($("cs-phone") && $("cs-phone").value || "").trim();
    var need = ($("cs-need") && $("cs-need").value || "").trim();
    var name = (last + first).trim() || (first + last).trim();
    var parts = [];
    if (interest) parts.push("感兴趣方向：" + interest);
    if (companysize) parts.push("公司规模：" + companysize);
    if (name) parts.push("联系人：" + name);
    if (company) parts.push("公司：" + company);
    if (phone) parts.push("电话：" + phone);
    parts.push("业务需求与挑战：\n" + (need || "（未填写）"));
    return { need: need, purpose: parts.join("\n") };
  }

  function validateRequired() {
    var required = ["cs-interest", "email", "cs-companysize", "cs-company", "cs-lastname", "cs-firstname", "cs-phone"];
    var labels = {
      "cs-interest": "请选择感兴趣的方向。",
      "email": "工作电子邮件不能为空。",
      "cs-companysize": "请选择公司规模。",
      "cs-company": "请填写公司名称。",
      "cs-lastname": "请填写姓氏。",
      "cs-firstname": "请填写名字。",
      "cs-phone": "请填写电话号码。"
    };
    for (var i = 0; i < required.length; i++) {
      var el = $(required[i]);
      if (!el || !el.value || !el.value.trim()) return labels[required[i]];
    }
    return null;
  }

  async function submitApplication() {
    var err = validateRequired();
    if (err) { showMsg(err, true); return; }
    var composed = composePurpose();
    var btn = $("submit-btn");
    btn.disabled = true; var orig = btn.textContent; btn.textContent = "提交中…";
    try {
      await callGateway("api_apply", { purpose: composed.purpose });
      showMsg("已提交，我们的团队会尽快与你联系。", false);
      setTimeout(checkExisting, 1000);
    } catch (e) {
      showMsg((e.body && (e.body.message || e.body.error)) || e.message || "提交失败", true);
    }
    btn.disabled = false; btn.textContent = orig;
  }

  function bindUI() {
    // 本页使用 <base href="../">（站点根），跳转路径以站点根为基准。
    var s = $("submit-btn"); if (s) s.addEventListener("click", submitApplication);
    var lb = $("login-redirect-btn"); if (lb) lb.addEventListener("click", function () { location.href = "chat/index.html"; });
    var mk = $("manage-keys-btn"); if (mk) mk.addEventListener("click", function () { location.href = "chat/api/keys.html"; });
    var bc = $("back-to-chat-btn"); if (bc) bc.addEventListener("click", function () { location.href = "chat/index.html"; });
    if (window.OaiTrustedLogos) {
      var host = $("cs-trusted-logos");
      if (host) window.OaiTrustedLogos.init(host);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { bindUI(); init(); });
  else { bindUI(); init(); }
})();
