// 2026-05-24: 用户申诉审核 admin 页脚本。
//
// 后端（chat-gateway.ts）endpoint：
//   - admin_check          权限校验
//   - admin_list_appeals   { status?: 'pending'|'approved'|'rejected'|'all', limit? }
//   - admin_decide_appeal  { appeal_id, decision: 'approved'|'rejected', admin_note? }
//
// 流程：
//   1. 进页面 → admin_check 验权 → 失败显示 deny-gate
//   2. 拉默认 pending 列表渲染
//   3. 用户点 ✓ / ✗ → 弹小窗输入备注 → admin_decide_appeal → 局部刷新
//
// 注意：申诉表的 image_url 是用户上传的证据，前端不解析其内容（CSP 只允许
// img-src 'self' data: blob: https:），点击图标在新 tab 打开。

(function () {
  "use strict";

  const SUPABASE_URL =
    (window.__SUPABASE_URL__ || "").trim() ||
    `${window.location.origin}/api/supabase`;
  const SUPABASE_ANON_KEY = (window.__SUPABASE_ANON_KEY__ || "").trim();
  const EDGE = `${SUPABASE_URL}/functions/v1/chat-gateway`;

  let supabaseClient = null;
  let currentSession = null;
  let appeals = [];
  let activeStatus = "pending";

  function $(id) { return document.getElementById(id); }
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function fmtDate(s) {
    if (!s) return "—";
    try {
      const d = new Date(s);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return s; }
  }
  function toast(msg, kind = "ok") {
    const t = $("toast");
    if (!t) { alert(msg); return; }
    t.textContent = msg;
    t.className = "toast show " + (kind === "err" ? "err" : "ok");
    setTimeout(() => { t.className = "toast"; }, 2400);
  }

  async function callEdge(payload) {
    if (!currentSession?.access_token) throw new Error("未登录");
    const resp = await fetch(EDGE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${currentSession.access_token}`,
      },
      body: JSON.stringify({ __auth_token: currentSession.access_token, ...payload }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data?.message || data?.error || `HTTP ${resp.status}`);
      err.status = resp.status;
      err.code = data?.code;
      throw err;
    }
    return data;
  }

  async function init() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
      $("loading").style.display = "none";
      $("login-gate").style.display = "";
      return;
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { storageKey: "cancri_supabase_auth", persistSession: true, autoRefreshToken: true },
    });
    const { data: sessRes } = await supabaseClient.auth.getSession();
    currentSession = sessRes?.session || null;
    if (!currentSession) {
      $("loading").style.display = "none";
      $("login-gate").style.display = "";
      return;
    }
    // admin check
    try {
      await callEdge({ endpoint: "admin_check" });
    } catch (e) {
      $("loading").style.display = "none";
      $("deny-gate").style.display = "";
      return;
    }
    $("loading").style.display = "none";
    // 必须是 "block" 而不是 ""：admin-nav.js 的鉴权黑幕靠 #main 的 inline
    // display 判定是否解锁，置空会让它读到 "" 而永远不掀幕（=整页黑屏）。
    $("main").style.display = "block";
    bindUi();
    await refresh();
  }

  function bindUi() {
    $("statusFilter").addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-btn");
      if (!btn) return;
      const f = btn.dataset.filter;
      if (!f || f === activeStatus) return;
      activeStatus = f;
      for (const b of $("statusFilter").querySelectorAll(".filter-btn")) {
        b.classList.toggle("active", b.dataset.filter === f);
      }
      refresh();
    });
    $("reload-btn").addEventListener("click", () => refresh());
  }

  async function refresh() {
    $("list").innerHTML = '<div class="loading">加载中…</div>';
    try {
      const data = await callEdge({ endpoint: "admin_list_appeals", status: activeStatus, limit: 200 });
      appeals = Array.isArray(data?.appeals) ? data.appeals : [];
      updateStats();
      render();
    } catch (e) {
      $("list").innerHTML = `<div class="empty err">加载失败：${escapeHtml(e.message || "未知错误")}</div>`;
    }
  }

  function updateStats() {
    const all = appeals;
    const pending = all.filter(a => a.status === "pending").length;
    const approved = all.filter(a => a.status === "approved").length;
    const rejected = all.filter(a => a.status === "rejected").length;
    $("stat-total").textContent = all.length;
    $("stat-pending").textContent = pending;
    $("stat-approved").textContent = approved;
    $("stat-rejected").textContent = rejected;
  }

  function statusBadge(status) {
    if (status === "pending") return '<span class="pill pending">待处理</span>';
    if (status === "approved") return '<span class="pill ok">已通过</span>';
    if (status === "rejected") return '<span class="pill err">已驳回</span>';
    return `<span class="pill">${escapeHtml(status)}</span>`;
  }

  function banReasonLabel(reason) {
    if (!reason) return "—";
    const map = {
      captcha_failed_3_attempts: "CAPTCHA 三次答错",
      captcha_timeout: "CAPTCHA 超时未答",
      manual: "管理员手动封禁",
    };
    return map[reason] || reason;
  }

  function render() {
    if (appeals.length === 0) {
      $("list").innerHTML = '<div class="empty">当前 ' + escapeHtml(activeStatus === "all" ? "全部" : activeStatus) + ' 状态没有申诉记录。</div>';
      return;
    }
    const html = appeals.map(a => {
      const ban = a.ban_record || {};
      const isPending = a.status === "pending";
      return `<article class="appeal-card ${a.status}" data-id="${escapeHtml(a.id)}">
        <header class="ac-head">
          <div class="ac-id">
            <span class="ac-email">${escapeHtml(a.email || a.account_email || "—")}</span>
            ${statusBadge(a.status)}
          </div>
          <div class="ac-time">${escapeHtml(fmtDate(a.created_at))}</div>
        </header>
        <div class="ac-body">
          <div class="ac-meta">
            <div><span class="lab">用户 ID</span><code>${escapeHtml(a.user_id || a.ban_user_id || "—")}</code></div>
            <div><span class="lab">封禁原因</span>${escapeHtml(banReasonLabel(ban.reason))}</div>
            <div><span class="lab">封禁时间</span>${escapeHtml(fmtDate(ban.banned_at))}</div>
            <div><span class="lab">提交 IP</span><code>${escapeHtml(a.ip || "—")}</code></div>
          </div>
          <div class="ac-reason">
            <div class="lab">用户申诉理由</div>
            <pre>${escapeHtml(a.reason || "")}</pre>
          </div>
          ${a.image_url ? `
          <div class="ac-image">
            <a href="${escapeHtml(a.image_url)}" target="_blank" rel="noopener noreferrer">查看证据图片 ↗</a>
          </div>` : ""}
          ${a.admin_note ? `
          <div class="ac-note">
            <div class="lab">管理员备注</div>
            <pre>${escapeHtml(a.admin_note)}</pre>
          </div>` : ""}
        </div>
        ${isPending ? `
        <footer class="ac-actions">
          <input class="ac-note-input" placeholder="备注（可选，会随通知邮件发给用户）" />
          <button class="btn-approve" data-action="approved">通过 + 解封</button>
          <button class="btn-reject" data-action="rejected">驳回</button>
        </footer>` : ""}
      </article>`;
    }).join("");
    $("list").innerHTML = html;

    $("list").querySelectorAll(".btn-approve, .btn-reject").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        const card = btn.closest(".appeal-card");
        if (!card) return;
        const id = card.dataset.id;
        const decision = btn.dataset.action;
        const noteInput = card.querySelector(".ac-note-input");
        const adminNote = String(noteInput?.value || "").trim();
        if (decision === "rejected" && !adminNote) {
          if (!confirm("驳回时建议填写备注（用户会收到邮件）。确认无备注驳回？")) return;
        }
        btn.disabled = true;
        btn.textContent = "处理中…";
        try {
          const res = await callEdge({
            endpoint: "admin_decide_appeal",
            appeal_id: id,
            decision,
            admin_note: adminNote || null,
          });
          toast(decision === "approved"
            ? `已通过申诉，${res.unbanned ? "解封成功" : "解封失败（请检查 user_bans）"}`
            : "已驳回申诉");
          await refresh();
        } catch (err) {
          toast("操作失败：" + (err.message || ""), "err");
          btn.disabled = false;
          btn.textContent = decision === "approved" ? "通过 + 解封" : "驳回";
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
