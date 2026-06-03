// admin-orbit-app.js — 百万亿 Token 创造者激励 · 审核后台
// 配套 admin_orbit.html。需要 admin 权限（chat-gateway service-role 二次验权）。
//
// 端点：
//   • admin_orbit_list    列出申请（按状态过滤 + 计数）
//   • admin_orbit_review  通过(approve, tier=A/B/C) / 驳回(reject, reject_reason)

const sb = window.supabase.createClient(
  window.__SUPABASE_URL__,
  window.__SUPABASE_ANON_KEY__,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "cancri_supabase_auth",
    },
  },
);
const GW = window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";

const state = {
  filter: "pending",
  cache: [],
  counts: {},
};

const $ = (id) => document.getElementById(id);

function toast(msg, kind) {
  const t = $("toast");
  if (!t) { alert(msg); return; }
  t.textContent = msg;
  t.className = "toast " + (kind || "");
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => t.classList.remove("show"), 2800);
}

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shortId(s, n) {
  if (!s) return "—";
  const str = String(s);
  return str.length > (n || 8) ? str.slice(0, n || 8) + "…" : str;
}

async function callGw(endpoint, payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("not_logged_in");
  const resp = await fetch(GW, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.__SUPABASE_ANON_KEY__,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      endpoint,
      ...(payload || {}),
      __auth_token: session.access_token,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.message || data.error || "request_failed");
    err.status = resp.status;
    throw err;
  }
  return data;
}

const STATUS_LABEL = { pending: "待审核", approved: "待领取", granted: "已发放", rejected: "已驳回" };

function updateCounts() {
  const c = state.counts || {};
  for (const key of ["pending", "approved", "granted", "rejected"]) {
    const el = document.querySelector(`#statusFilter .count-badge[data-count-for="${key}"]`);
    if (el) el.textContent = c[key] != null ? c[key] : "0";
  }
}

function cardHtml(a) {
  const status = a.status || "pending";
  const userExists = a.user_exists === true;
  const existPill = status === "pending" || status === "approved"
    ? (userExists ? '<span class="pill ok2">账号已注册</span>' : '<span class="pill warn">账号未注册·将待领取</span>')
    : "";
  const grantInfo = (status === "granted")
    ? `<div class="oc-grant-info">已发放：${escHtml(a.award_plan_code || "")} · ${a.award_days || "?"} 天${a.grant_expires_at ? " · 到期 " + formatTime(a.grant_expires_at) : ""}${a.grant_note ? " · " + escHtml(a.grant_note) : ""}</div>`
    : "";
  const approvedInfo = (status === "approved")
    ? `<div class="oc-grant-info">已批档位：${escHtml(a.award_plan_code || "")} · ${a.award_days || "?"} 天（等待用户登录领取）</div>`
    : "";
  const reject = (status === "rejected" && a.reject_reason)
    ? `<div class="oc-grant-info" style="color:var(--err)">驳回原因：${escHtml(a.reject_reason)}</div>`
    : "";

  const canReview = status === "pending";
  const actions = canReview ? `
    <div class="oc-actions">
      <select class="tier-select" data-tier-for="${a.id}">
        <option value="A">A · Pro+ 14天（高质量）</option>
        <option value="B" selected>B · Pro 7天（标准）</option>
        <option value="C">C · Pro 3天（轻度）</option>
      </select>
      <button class="btn-approve" data-act="approve" data-id="${a.id}">通过并发放</button>
      <button class="btn-reject" data-act="reject" data-id="${a.id}">驳回</button>
    </div>` : "";

  return `
    <div class="orbit-card ${status}" data-id="${a.id}">
      <div class="oc-head">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="pill ${status}">${STATUS_LABEL[status] || status}</span>
          ${existPill}
          <span class="oc-email">${escHtml(a.email || "—")}</span>
        </div>
        <div>
          <span class="oc-id">#${a.id}</span>
          <span class="oc-time" style="margin-left:8px">${formatTime(a.created_at)}</span>
        </div>
      </div>
      <div class="oc-meta-row">
        <span>UID: <code>${a.user_id ? shortId(a.user_id, 8) : "—"}</code></span>
        <span>IP: <code>${escHtml(a.ip || "—")}</code></span>
        <span>指纹: <code>${a.fingerprint ? shortId(a.fingerprint, 16) : "—"}</code></span>
      </div>
      <div class="oc-fields">
        <div class="oc-field"><b>AI 工具</b>${escHtml(a.ai_tools || "—")}</div>
        <div class="oc-field"><b>底层模型</b>${escHtml(a.models || "—")}</div>
        <div class="oc-field"><b>证明材料</b>${escHtml(a.proof || "—")}</div>
      </div>
      <div class="oc-project">${escHtml(a.project_desc || "")}</div>
      ${approvedInfo}
      ${grantInfo}
      ${reject}
      ${actions}
    </div>`;
}

function render(list) {
  const listEl = $("list");
  if (!list || !list.length) {
    listEl.innerHTML = '<div class="empty">没有符合条件的申请。</div>';
    return;
  }
  listEl.innerHTML = list.map(cardHtml).join("");
  listEl.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => act(Number(btn.getAttribute("data-id")), btn.getAttribute("data-act"), btn));
  });
}

async function act(id, decision, btn) {
  if (decision === "reject") {
    const reason = prompt("驳回原因（可留空，默认：不符合本期评估标准）：");
    if (reason === null) return; // 取消
    await doReview(id, "reject", null, reason, btn);
    return;
  }
  // approve：读取该卡片选中的档位
  const sel = document.querySelector(`select[data-tier-for="${id}"]`);
  const tier = sel ? sel.value : "B";
  const tierLabel = { A: "Pro+ 14天", B: "Pro 7天", C: "Pro 3天" }[tier] || tier;
  if (!confirm(`确认通过 #${id}？\n将按档位 ${tier}（${tierLabel}）发放。\n若该邮箱已注册账号会立即到账并发邮件，否则标记为待领取。`)) return;
  await doReview(id, "approve", tier, null, btn);
}

async function doReview(id, decision, tier, rejectReason, btn) {
  if (btn) btn.disabled = true;
  try {
    const payload = { application_id: id, decision };
    if (tier) payload.tier = tier;
    if (rejectReason != null) payload.reject_reason = rejectReason;
    const res = await callGw("admin_orbit_review", payload);
    const r = (res && res.result) || {};
    const grant = r.grant && typeof r.grant === "object" ? r.grant : {};
    if (decision === "approve") {
      if (grant.duplicate === true) {
        toast(`#${id} 该用户已领过 Orbit 权益，本申请已关闭`, "ok");
      } else if (r.pending_claim) {
        toast(`#${id} 已通过，等待用户登录领取`, "ok");
      } else if (r.granted) {
        toast(`#${id} 已通过并立即到账（${r.plan_code} ${r.days}天）`, "ok");
      } else {
        toast(`#${id} 已通过`, "ok");
      }
    } else {
      toast(`#${id} 已驳回`, "ok");
    }
    await reload();
  } catch (e) {
    toast("操作失败：" + e.message, "err");
    if (btn) btn.disabled = false;
  }
}

async function reload() {
  const listEl = $("list");
  listEl.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const data = await callGw("admin_orbit_list", { status: state.filter });
    state.cache = data.applications || [];
    state.counts = data.counts || {};
    updateCounts();
    render(state.cache);
  } catch (e) {
    if (e.status === 403) {
      listEl.innerHTML = '<div class="empty err">无权访问</div>';
    } else {
      listEl.innerHTML = `<div class="empty err">加载失败：${escHtml(e.message)}</div>`;
    }
  }
}

async function bootstrap() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    $("loading").style.display = "none";
    $("login-gate").style.display = "block";
    return;
  }
  try {
    await callGw("admin_check", {});
    $("loading").style.display = "none";
    $("main").style.display = "block";
    await reload();
  } catch (e) {
    $("loading").style.display = "none";
    if (e.status === 403) $("deny-gate").style.display = "block";
    else $("login-gate").style.display = "block";
    return;
  }

  document.querySelectorAll("#statusFilter .filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#statusFilter .filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.getAttribute("data-filter");
      reload();
    });
  });

  const reloadBtn = $("reloadBtn");
  if (reloadBtn) reloadBtn.addEventListener("click", reload);
}

bootstrap();
