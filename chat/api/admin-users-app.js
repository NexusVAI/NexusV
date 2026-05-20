// admin_users.html 的页面逻辑。2026-05-13 审查后从 inline <script> 抽出以便
// admin_users.html 的 CSP 删除 'unsafe-inline'。

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
let BANS = [];
let BANNED_SET = new Set();
let searchTimer = null;
let lastQuery = "";
let banSearchTimer = null;
let activeBanSearch = "";

const $ = (id) => document.getElementById(id);
const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
};

function showToast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "");
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => t.classList.remove("show"), 2400);
}

async function getSession() {
  const {
    data: { session },
  } = await sb.auth.getSession();
  return session;
}

async function callGW(payload, session) {
  const resp = await fetch(GW, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.__SUPABASE_ANON_KEY__,
    },
    body: JSON.stringify({ ...payload, __auth_token: session.access_token }),
  });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

async function init() {
  const session = await getSession();
  $("loading").style.display = "none";
  if (!session || !session.user || session.user.is_anonymous) {
    $("login-gate").style.display = "block";
    return;
  }
  const check = await callGW({ endpoint: "admin_check" }, session);
  if (!check.ok || !check.data?.is_admin) {
    $("deny-gate").style.display = "block";
    return;
  }
  $("main").style.display = "block";
  await loadBans();
}

async function loadBans() {
  const session = await getSession();
  const r = await callGW({ endpoint: "admin_list_bans" }, session);
  if (r.status === 403) {
    $("deny-gate").style.display = "block";
    return;
  }
  if (!r.ok) {
    showToast("加载失败：HTTP " + r.status, "err");
    return;
  }
  BANS = Array.isArray(r.data?.bans) ? r.data.bans : [];
  BANNED_SET = new Set(BANS.filter((b) => b.is_active).map((b) => b.user_id));
  const active = BANS.filter((b) => b.is_active).length;
  $("stat-active").textContent = active;
  $("stat-total").textContent = BANS.length;
  renderBans();
  // Re-run any pending search to refresh banned indicators.
  if (lastQuery) doSearch();
}

function shortTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return Math.round(diff / 1000) + "s 前";
  if (diff < 3600_000) return Math.round(diff / 60000) + "m 前";
  if (diff < 86400_000) return Math.round(diff / 3600000) + "h 前";
  return d.toLocaleString("zh-CN", { hour12: false });
}

function getFilteredBans() {
  if (!activeBanSearch) return BANS;
  const q = activeBanSearch.toLowerCase();
  return BANS.filter(
    (b) =>
      (b.email || "").toLowerCase().includes(q) ||
      (b.user_id || "").toLowerCase().includes(q) ||
      (b.reason || "").toLowerCase().includes(q) ||
      (b.notes || "").toLowerCase().includes(q) ||
      (b.banned_by_email || "").toLowerCase().includes(q) ||
      (b.banned_by || "").toLowerCase().includes(q),
  );
}

function renderBans() {
  const root = $("bansList");
  const list = getFilteredBans();
  if (!list.length) {
    root.innerHTML = activeBanSearch
      ? '<div class="empty-bans">没有匹配的封禁记录。</div>'
      : '<div class="empty-bans">暂无封禁记录。</div>';
    return;
  }
  root.innerHTML = list.map((b) => {
    const expires = b.expires_at
      ? `到期：${esc(new Date(b.expires_at).toLocaleString("zh-CN", { hour12: false }))}`
      : "永久";
    const status = b.is_active
      ? '<span class="pill banned">已封禁</span>'
      : '<span class="pill anon">已过期</span>';
    return `<div class="ban-row">
      <div>
        <div>${esc(b.email || "(未知邮箱)")}</div>
        <div class="uid">${esc(b.user_id)}</div>
      </div>
      <div>
        <div class="reason">${esc(b.reason || "—")}</div>
        <div class="when">${esc(shortTime(b.banned_at))} · ${esc(b.banned_by_email || b.banned_by || "system")}</div>
        <div class="when">${esc(expires)}</div>
        ${b.notes ? `<div class="when" style="margin-top:4px">${esc(b.notes)}</div>` : ""}
      </div>
      <div>${status}</div>
      <div class="actions">
        <button class="btn-unban" data-uid="${esc(b.user_id)}">解封</button>
      </div>
    </div>`;
  }).join("");
  root.querySelectorAll("button.btn-unban").forEach((btn) => {
    btn.addEventListener("click", () => doUnban(btn.dataset.uid, btn));
  });
}

async function doSearch() {
  const q = $("searchInput").value.trim();
  const matchesEl = $("matches");
  if (q.length < 3) {
    matchesEl.innerHTML = "";
    lastQuery = "";
    return;
  }
  lastQuery = q;
  const session = await getSession();
  const r = await callGW(
    { endpoint: "admin_find_user", query: q },
    session,
  );
  if (!r.ok) {
    matchesEl.innerHTML = `<div class="match-row" style="color:var(--err);cursor:default">查询失败：${esc(r.data?.message || r.status)}</div>`;
    return;
  }
  const matches = Array.isArray(r.data?.matches) ? r.data.matches : [];
  if (!matches.length) {
    matchesEl.innerHTML =
      '<div class="match-row" style="color:var(--text-mute);cursor:default">无匹配。</div>';
    return;
  }
  matchesEl.innerHTML = matches
    .map((m) => {
      const isBanned = BANNED_SET.has(m.user_id);
      const banPill = isBanned
        ? '<span class="pill banned">已封禁</span>'
        : "";
      const anonPill = m.is_anonymous
        ? '<span class="pill anon">匿名</span>'
        : "";
      return `<div class="match-row${isBanned ? " banned" : ""}" data-uid="${esc(m.user_id)}" data-email="${esc(m.email || '')}">
        <div class="email">${esc(m.email || "(无邮箱)")}</div>
        ${anonPill}
        ${banPill}
        <div class="uid">${esc(m.user_id.slice(0, 8))}…</div>
        <div class="meta">${esc(shortTime(m.last_sign_in_at || m.created_at))}</div>
      </div>`;
    })
    .join("");
  matchesEl.querySelectorAll(".match-row[data-uid]").forEach((row) => {
    row.addEventListener("click", () => {
      $("userIdInput").value = row.dataset.uid;
      matchesEl
        .querySelectorAll(".match-row")
        .forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      // Load selected user's quota details into the Control Panel
      loadUserQuota(row.dataset.uid, row.dataset.email || row.dataset.uid);
    });
  });
}

async function doBan() {
  const userId = $("userIdInput").value.trim().toLowerCase();
  const reason = $("reasonInput").value.trim() || "manual";
  const notes = $("notesInput").value.trim();
  const expiresLocal = $("expiresAtInput").value.trim();
  let expiresIso = null;
  if (expiresLocal) {
    const d = new Date(expiresLocal);
    if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
      showToast("到期时间必须在未来", "err");
      return;
    }
    expiresIso = d.toISOString();
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    showToast("user_id 必须是 UUID", "err");
    return;
  }
  if (
    !confirm(
      "确定封禁此用户？\nuser_id: " +
        userId +
        "\n原因: " +
        reason +
        "\n" +
        (expiresIso ? "到期: " + expiresIso : "永久"),
    )
  ) {
    return;
  }
  const session = await getSession();
  const btn = $("banBtn");
  btn.disabled = true;
  btn.textContent = "封禁中…";
  const r = await callGW(
    {
      endpoint: "admin_ban_user",
      user_id: userId,
      reason,
      notes,
      expires_at: expiresIso,
    },
    session,
  );
  btn.disabled = false;
  btn.textContent = "封禁此用户";
  if (!r.ok) {
    showToast("封禁失败：" + (r.data?.message || r.status), "err");
    return;
  }
  // 2026-05-16：admin_ban_user 用 Resend HTTP API 异步发邮件（fire-and-forget，
  // 避免阻塞封禁响应导致按钮卡 30s+）。后端只确认入队（email_queued），
  // 实际投递结果要去 Resend Dashboard 或 Edge logs 看（ban_email_sent / ban_email_resend_failed）。
  let emailNote = "";
  if (r.data && r.data.email_queued === true) {
    emailNote = " · 邮件已发送";
  } else if (r.data && r.data.email_skip_reason) {
    const reason = r.data.email_skip_reason;
    if (reason === "no_email_on_record") emailNote = " · 用户无邮箱";
    else if (reason === "email_not_configured") emailNote = " · 邮件未配置";
    else if (reason === "skip_email") emailNote = "";
    else emailNote = " · 邮件未发(" + reason + ")";
  }
  showToast("已封禁 " + userId.slice(0, 8) + "…" + emailNote, "ok");
  $("userIdInput").value = "";
  $("reasonInput").value = "";
  $("notesInput").value = "";
  $("expiresAtInput").value = "";
  await loadBans();
}

async function doUnban(userId, btn) {
  if (!confirm("确定解封 " + userId + "？")) return;
  const session = await getSession();
  btn.disabled = true;
  btn.textContent = "解封中…";
  const r = await callGW(
    { endpoint: "admin_unban_user", user_id: userId },
    session,
  );
  if (!r.ok) {
    showToast("解封失败：" + (r.data?.message || r.status), "err");
    btn.disabled = false;
    btn.textContent = "解封";
    return;
  }
  showToast("已解封 " + userId.slice(0, 8) + "…", "ok");
  await loadBans();
}

$("searchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 250);
});
$("banSearch").addEventListener("input", () => {
  clearTimeout(banSearchTimer);
  banSearchTimer = setTimeout(() => {
    activeBanSearch = $("banSearch").value.trim();
    renderBans();
  }, 200);
});
$("banBtn").addEventListener("click", doBan);
$("reload-btn").addEventListener("click", loadBans);

// ─── Quota Control Panel Logic ───
let selectedQuotaUserId = "";
let selectedQuotaUserEmail = "";

async function loadUserQuota(userId, email) {
  selectedQuotaUserId = userId;
  selectedQuotaUserEmail = email || userId;

  $("quotaPanel").style.display = "block";
  $("quotaPanelUserEmail").textContent = selectedQuotaUserEmail;

  $("quota-plan").textContent = "加载中…";
  $("quota-monthly").textContent = "加载中…";
  $("quota-consumed").textContent = "加载中…";
  $("quota-topup").textContent = "加载中…";
  $("quota-expires").textContent = "加载中…";

  const session = await getSession();
  const r = await callGW({ endpoint: "admin_get_user_quota", user_id: userId }, session);
  if (!r.ok) {
    showToast("获取额度信息失败：" + (r.data?.message || r.status), "err");
    $("quota-plan").textContent = "错误";
    $("quota-monthly").textContent = "错误";
    $("quota-consumed").textContent = "错误";
    $("quota-topup").textContent = "错误";
    $("quota-expires").textContent = "错误";
    return;
  }

  const sub = r.data.subscription;
  const topup = r.data.topup;
  const fmtTokens = window.AdminFormatters ? window.AdminFormatters.fmtTokens : (n) => String(n);

  if (sub) {
    const plans = { pro: "PRO", pro_plus: "PRO+", pro_max: "PRO MAX" };
    $("quota-plan").textContent = plans[sub.plan_code] || String(sub.plan_code).toUpperCase();
    $("quota-monthly").textContent = fmtTokens(sub.monthly_quota);
    $("quota-consumed").textContent = fmtTokens(sub.monthly_consumed);
    $("quota-expires").textContent = new Date(sub.expires_at).toLocaleString("zh-CN", { hour12: false });
  } else {
    $("quota-plan").textContent = "FREE";
    $("quota-monthly").textContent = "—";
    $("quota-consumed").textContent = "—";
    $("quota-expires").textContent = "无有效订阅";
  }

  $("quota-topup").textContent = topup ? fmtTokens(topup.balance_tokens) : "0";
}

async function grantSubscription(userId, days, planCode) {
  const plans = { pro: "PRO", pro_plus: "PRO+", pro_max: "PRO MAX" };
  if (!confirm(`确认赠送用户 ${selectedQuotaUserEmail} ${days}天 ${plans[planCode]} 订阅？`)) return;

  const session = await getSession();
  const r = await callGW({
    endpoint: "admin_grant_subscription",
    user_id: userId,
    days: days,
    plan_code: planCode
  }, session);

  if (r.ok) {
    showToast("订阅赠送成功！", "ok");
    await loadUserQuota(userId, selectedQuotaUserEmail);
  } else {
    showToast("赠送失败：" + (r.data?.message || r.status), "err");
  }
}

async function resetConsumption(userId) {
  if (!confirm(`确认清零用户 ${selectedQuotaUserEmail} 本月的已用额度？`)) return;

  const session = await getSession();
  const r = await callGW({
    endpoint: "admin_reset_user_consumption",
    user_id: userId
  }, session);

  if (r.ok) {
    showToast("本月已用额度已成功归零！", "ok");
    await loadUserQuota(userId, selectedQuotaUserEmail);
  } else {
    showToast("清空失败：" + (r.data?.message || r.status), "err");
  }
}

async function adjustTopup(userId, delta) {
  const actionText = delta > 0 ? `增加 ${delta}` : `扣除 ${Math.abs(delta)}`;
  if (!confirm(`确认向用户 ${selectedQuotaUserEmail} ${actionText} tokens 加油包？`)) return;

  const session = await getSession();
  const r = await callGW({
    endpoint: "admin_adjust_user_topup",
    user_id: userId,
    delta_tokens: delta
  }, session);

  if (r.ok) {
    showToast("加油包余额调整成功！", "ok");
    await loadUserQuota(userId, selectedQuotaUserEmail);
  } else {
    showToast("调整失败：" + (r.data?.message || r.status), "err");
  }
}

// Bind Quota Control Panel Button Clicks
$("btnGrant30Pro").addEventListener("click", () => grantSubscription(selectedQuotaUserId, 30, "pro"));
$("btnGrant30ProPlus").addEventListener("click", () => grantSubscription(selectedQuotaUserId, 30, "pro_plus"));
$("btnGrant30ProMax").addEventListener("click", () => grantSubscription(selectedQuotaUserId, 30, "pro_max"));
$("btnResetConsumption").addEventListener("click", () => resetConsumption(selectedQuotaUserId));
$("btnTopup10").addEventListener("click", () => adjustTopup(selectedQuotaUserId, 10000000));
$("btnTopup50").addEventListener("click", () => adjustTopup(selectedQuotaUserId, 50000000));
$("btnTopup100").addEventListener("click", () => adjustTopup(selectedQuotaUserId, 100000000));
$("btnCustomTopup").addEventListener("click", () => {
  const val = parseInt($("customTopupInput").value, 10);
  if (isNaN(val) || val === 0) {
    showToast("请输入合法的自定义充值 tokens 量！", "err");
    return;
  }
  adjustTopup(selectedQuotaUserId, val);
  $("customTopupInput").value = "";
});

init();
