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

const fmtCreditsFromTokens = (tokens) =>
  window.AdminFormatters ? window.AdminFormatters.fmtCreditsFromTokens(tokens) : String(tokens);
const creditsToTokens = (credits) =>
  window.AdminFormatters ? window.AdminFormatters.creditsToTokens(credits) : Math.round(Number(credits) * 10000);
const fmtCreditInput = (credits) =>
  window.CancriCredits && window.CancriCredits.fmtCreditAmount
    ? window.CancriCredits.fmtCreditAmount(credits)
    : `${credits} 积分`;

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
        ${isBanned ? '' : `<button class="btn-quick-ban" data-uid="${esc(m.user_id)}" data-email="${esc(m.email || '')}" title="立即封禁此用户">封禁</button>`}
        <div class="uid">${esc(m.user_id.slice(0, 8))}…</div>
        <div class="meta">${esc(shortTime(m.last_sign_in_at || m.created_at))}</div>
      </div>`;
    })
    .join("");
  matchesEl.querySelectorAll(".match-row[data-uid]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".btn-quick-ban")) return;
      $("userIdInput").value = row.dataset.uid;
      matchesEl
        .querySelectorAll(".match-row")
        .forEach((r) => r.classList.remove("selected"));
      row.classList.add("selected");
      // Load selected user's quota details into the Control Panel
      loadUserQuota(row.dataset.uid, row.dataset.email || row.dataset.uid);
    });
  });
  matchesEl.querySelectorAll(".btn-quick-ban").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const uid = btn.dataset.uid;
      const email = btn.dataset.email;
      if (!confirm("确定立即封禁 " + (email || uid) + " ？")) return;
      btn.disabled = true;
      btn.textContent = "封禁中…";
      const session = await getSession();
      const r = await callGW(
        { endpoint: "admin_ban_user", user_id: uid, reason: "admin_quick_ban", notes: "管理员快速封禁（" + email + "）" },
        session,
      );
      if (!r.ok) {
        showToast("封禁失败：" + (r.data?.message || r.status), "err");
        btn.disabled = false;
        btn.textContent = "封禁";
        return;
      }
      showToast("已封禁 " + (email || uid.slice(0, 8) + "…"), "ok");
      await loadBans();
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

// ─── Wallet Control Panel Logic (2026-06-23 wallet_v3) ───
let selectedQuotaUserId = "";
let selectedQuotaUserEmail = "";

const fmtCny = (n) => (n == null || isNaN(n) ? "—" : "¥" + Number(n).toFixed(2));
const TIER_LABELS = ["Tier 0", "Tier 1", "Tier 2", "Tier 3", "Tier 4", "Tier 5"];

async function loadUserQuota(userId, email) {
  selectedQuotaUserId = userId;
  selectedQuotaUserEmail = email || userId;

  $("quotaPanel").style.display = "block";
  $("quotaPanelUserEmail").textContent = selectedQuotaUserEmail;
  // 2026-05-23：选中用户后顺带加载调用日志面板
  $("usagePanel").style.display = "block";
  $("usagePanelUserEmail").textContent = selectedQuotaUserEmail;
  loadUserUsage(userId);
  loadUserOrders(userId);
  loadCreditLedger(userId);

  $("wallet-balance").textContent = "加载中…";
  $("wallet-debt").textContent = "加载中…";
  $("wallet-cumulative").textContent = "加载中…";
  $("wallet-tier").textContent = "加载中…";

  const session = await getSession();
  const r = await callGW({ endpoint: "admin_get_user_wallet", user_id: userId }, session);
  if (!r.ok) {
    showToast("获取钱包信息失败：" + (r.data?.message || r.status), "err");
    $("wallet-balance").textContent = "错误";
    $("wallet-debt").textContent = "错误";
    $("wallet-cumulative").textContent = "错误";
    $("wallet-tier").textContent = "错误";
    return;
  }

  const w = r.data.wallet || {};
  $("wallet-balance").textContent = fmtCny(w.balance_cny);
  $("wallet-debt").textContent = fmtCny(w.debt_cny);
  $("wallet-cumulative").textContent = fmtCny(w.cumulative_recharge_cny);
  const tierIdx = Math.max(0, Math.min(5, Number(w.tier || 0)));
  $("wallet-tier").textContent = TIER_LABELS[tierIdx] || ("Tier " + tierIdx);
}

// 2026-06-23：钱包余额调整（¥，可正可负）。复用 admin_adjust_user_topup 的 delta_tokens 字段，
// 但语义已改为「¥ × 10000 = micro_cny」近似（user_topup_credits 表在 wallet_v3 下不再使用，
// 此处改为直接调 admin_adjust_user_wallet —— 若后端未部署则回退提示）。
// 实际生产路径：调用 cancri_recharge_wallet RPC（admin 侧）。此处先实现为前端 → gateway 新端点。
async function adjustWallet(userId, deltaCny) {
  if (!userId) {
    showToast("请先在搜索结果中选择用户", "err");
    return;
  }
  const actionText = deltaCny > 0 ? `增加 ${fmtCny(deltaCny)}` : `扣除 ${fmtCny(Math.abs(deltaCny))}`;
  if (!confirm(`确认向用户 ${selectedQuotaUserEmail} ${actionText} 钱包余额？`)) return;
  const session = await getSession();
  const r = await callGW({
    endpoint: "admin_adjust_user_wallet",
    user_id: userId,
    delta_cny: deltaCny,
  }, session);
  if (r.ok) {
    showToast("钱包余额调整成功！", "ok");
    await loadUserQuota(userId, selectedQuotaUserEmail);
    await loadCreditLedger(userId);
  } else {
    showToast("调整失败：" + (r.data?.message || r.status), "err");
  }
}

// Bind Wallet Control Panel Button Clicks
$("btnWalletPlus10").addEventListener("click", () => adjustWallet(selectedQuotaUserId, 10));
$("btnWalletPlus50").addEventListener("click", () => adjustWallet(selectedQuotaUserId, 50));
$("btnWalletPlus100").addEventListener("click", () => adjustWallet(selectedQuotaUserId, 100));
$("btnWalletMinus10").addEventListener("click", () => adjustWallet(selectedQuotaUserId, -10));
$("btnCustomWallet").addEventListener("click", () => {
  const val = Number($("customWalletInput").value);
  if (!isFinite(val) || val === 0) {
    showToast("请输入合法的金额（¥，可负，非零）！", "err");
    return;
  }
  adjustWallet(selectedQuotaUserId, val);
  $("customWalletInput").value = "";
});

async function loadUserOrders(userId) {
  const el = $("userOrdersList");
  if (!el || !userId) return;
  el.innerHTML = '<div style="padding:10px;color:var(--text-mute)">加载中…</div>';
  const session = await getSession();
  const r = await callGW({ endpoint: "admin_list_user_orders", user_id: userId, limit: 20 }, session);
  if (!r.ok) {
    el.innerHTML = '<div style="padding:10px;color:var(--err)">加载失败</div>';
    return;
  }
  const orders = Array.isArray(r.data?.orders) ? r.data.orders : [];
  if (!orders.length) {
    el.innerHTML = '<div style="padding:10px;color:var(--text-mute)">无订单记录</div>';
    return;
  }
  el.innerHTML = orders.map((o) => {
    const payable = o.user_payable_cny != null ? o.user_payable_cny : o.amount_cny;
    const del = o.status !== "activated"
      ? ` <button type="button" class="btn-ban user-order-del" data-oid="${esc(o.id)}" style="padding:2px 8px;font-size:10px;margin-left:6px">删</button>`
      : "";
    return `<div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
      <span class="status-pill ${esc(o.status)}" style="font-size:10px">${esc(o.status)}</span>
      <span>应付 ¥${esc(payable)}</span>
      <span style="color:var(--text-mute)">${esc(new Date(o.created_at).toLocaleString("zh-CN", { hour12: false }))}</span>
      ${del}
    </div>`;
  }).join("");
  el.querySelectorAll(".user-order-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const oid = btn.getAttribute("data-oid");
      if (!oid || !confirm("删除此订单记录？")) return;
      const session = await getSession();
      const dr = await callGW({ endpoint: "admin_delete_order", order_id: oid }, session);
      if (dr.ok) {
        showToast("订单已删除", "ok");
        await loadUserOrders(userId);
      } else {
        showToast("删除失败：" + (dr.data?.message || dr.status), "err");
      }
    });
  });
}

async function loadCreditLedger(userId) {
  const el = $("creditLedgerList");
  if (!el || !userId) return;
  el.innerHTML = '<div style="padding:10px;color:var(--text-mute)">加载中…</div>';
  const session = await getSession();
  const r = await callGW({ endpoint: "admin_list_credit_ledger", user_id: userId, limit: 40 }, session);
  if (!r.ok) {
    el.innerHTML = '<div style="padding:10px;color:var(--err)">加载失败</div>';
    return;
  }
  const rows = Array.isArray(r.data?.ledger) ? r.data.ledger : [];
  if (!rows.length) {
    el.innerHTML = '<div style="padding:10px;color:var(--text-mute)">无额度流水</div>';
    return;
  }
  el.innerHTML = rows.map((row) => {
    const n = Number(row.delta_tokens);
    const label = fmtCreditsFromTokens(n);
    const display = n > 0 ? "+" + label : label;
    return `<div style="padding:6px 10px;border-bottom:1px solid var(--border-mute);display:grid;grid-template-columns:100px 1fr 110px;gap:8px;">
      <span style="color:var(--text-mute);font-size:10.5px">${esc(new Date(row.created_at).toLocaleString("zh-CN", { hour12: false }))}</span>
      <span><code style="font-size:10.5px">${esc(row.kind)}</code> · ${esc(row.source_bucket || "—")} · ${esc(row.source_ref || "")}</span>
      <span style="text-align:right;font-family:var(--font-mono);color:${n >= 0 ? "var(--ok)" : "var(--err)"}">${esc(display)}</span>
    </div>`;
  }).join("");
}

// ─── 2026-05-23：单用户调用日志 + 聚合 ───
const fmtN = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
};

async function loadUserUsage(userId) {
  if (!userId) return;
  const sinceMs = Number($("usageWindowSelect").value) || 7 * 86400_000;
  $("usage-total-calls").textContent = "…";
  $("usage-total-in").textContent = "…";
  $("usage-total-out").textContent = "…";
  $("usage-errors").textContent = "…";
  $("usage-uniq-models").textContent = "…";
  $("usage-uniq-ips").textContent = "…";
  $("usage-by-model").innerHTML = '<div style="color:var(--text-mute);padding:6px;">加载中…</div>';
  $("usage-by-day").innerHTML = '<div style="color:var(--text-mute);padding:6px;">加载中…</div>';
  $("usage-detail").innerHTML = '<div style="color:var(--text-mute);padding:14px;text-align:center;">加载中…</div>';

  const session = await getSession();
  const r = await callGW({ endpoint: "admin_get_user_usage", user_id: userId, since_ms: sinceMs, limit: 200 }, session);
  if (!r.ok) {
    showToast("获取调用日志失败：" + (r.data?.message || r.status), "err");
    $("usage-by-model").innerHTML = '<div style="color:var(--err);padding:6px;">加载失败</div>';
    $("usage-by-day").innerHTML = '<div style="color:var(--err);padding:6px;">加载失败</div>';
    $("usage-detail").innerHTML = '<div style="color:var(--err);padding:14px;text-align:center;">加载失败</div>';
    return;
  }
  const data = r.data || {};
  const stats = data.stats || {};
  $("usage-total-calls").textContent = fmtN(stats.total_calls);
  $("usage-total-in").textContent = fmtN(stats.total_tokens_in);
  $("usage-total-out").textContent = fmtN(stats.total_tokens_out);
  $("usage-errors").textContent = fmtN(stats.error_calls);
  $("usage-uniq-models").textContent = fmtN(stats.unique_models);
  $("usage-uniq-ips").textContent = fmtN(stats.unique_ips);

  // by_model top 10：横向条形图（百分比 width）
  const byModel = Array.isArray(data.by_model) ? data.by_model.slice(0, 10) : [];
  const maxModelCount = byModel.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  if (byModel.length === 0) {
    $("usage-by-model").innerHTML = '<div style="color:var(--text-mute);padding:6px;">无数据</div>';
  } else {
    $("usage-by-model").innerHTML = byModel.map((m) => {
      const pct = Math.round((m.count / maxModelCount) * 100);
      return `<div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;margin-bottom:2px;">
          <span style="color:var(--text);font-family:ui-monospace,monospace;">${esc(m.model)}</span>
          <span style="color:var(--text-mute);">${fmtN(m.count)} 次 · ↓${fmtN(m.tokens_in)} ↑${fmtN(m.tokens_out)}${m.error_calls > 0 ? ` · <span style="color:var(--err);">${m.error_calls} 错</span>` : ""}</span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),#a855f7);"></div>
        </div>
      </div>`;
    }).join("");
  }

  // by_day：每天一行迷你柱状图
  const byDay = Array.isArray(data.by_day) ? data.by_day : [];
  const maxDayCount = byDay.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  if (byDay.length === 0) {
    $("usage-by-day").innerHTML = '<div style="color:var(--text-mute);padding:6px;">无数据</div>';
  } else {
    $("usage-by-day").innerHTML = byDay.map((d) => {
      const pct = Math.round((d.count / maxDayCount) * 100);
      return `<div style="margin-bottom:5px;">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;margin-bottom:2px;">
          <span style="color:var(--text);font-family:ui-monospace,monospace;">${esc(d.day_utc8)}</span>
          <span style="color:var(--text-mute);">${fmtN(d.count)} 次 · ${fmtN(d.tokens_in + d.tokens_out)} tok</span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#22c55e,#4ade80);"></div>
        </div>
      </div>`;
    }).join("");
  }

  // detail rows
  const usage = Array.isArray(data.usage) ? data.usage : [];
  if (usage.length === 0) {
    $("usage-detail").innerHTML = '<div style="color:var(--text-mute);padding:14px;text-align:center;">该窗口内无调用记录</div>';
  } else {
    $("usage-detail").innerHTML = usage.map((u) => {
      const sc = u.status_code || 0;
      const scColor = sc >= 500 ? "var(--err)" : sc >= 400 ? "#94a3b8" : "var(--ok)";
      const totalTok = (u.tokens_in || 0) + (u.tokens_out || 0);
      return `<div style="padding:7px 11px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:1fr 90px 70px 130px;gap:8px;align-items:center;font-size:11.5px;">
        <div style="font-family:ui-monospace,monospace;">
          <div style="color:var(--text);">${esc(u.model || "—")}</div>
          <div style="color:var(--text-faint);font-size:10.5px;">${esc(u.key_prefix || "—")} · ${esc(u.ip || "—")}</div>
        </div>
        <div style="font-family:ui-monospace,monospace;text-align:right;">
          ${fmtN(totalTok)}
          <div style="font-size:10px;color:var(--text-faint);">↓${fmtN(u.tokens_in)} ↑${fmtN(u.tokens_out)}</div>
        </div>
        <div style="text-align:center;">
          <span style="display:inline-block;padding:2px 7px;border-radius:10px;background:rgba(0,0,0,0.08);color:${scColor};font-weight:600;font-size:10.5px;">${sc}</span>
        </div>
        <div style="color:var(--text-mute);font-size:10.5px;text-align:right;">${esc(fmtTime(u.created_at))}</div>
      </div>`;
    }).join("");
  }

  if (data.aggregation_capped) {
    showToast("窗口内调用极多，聚合数据已截断到最近 5000 条。", "err");
  }
}

$("usageWindowSelect").addEventListener("change", () => {
  if (selectedQuotaUserId) loadUserUsage(selectedQuotaUserId);
});
$("usageReloadBtn").addEventListener("click", () => {
  if (selectedQuotaUserId) loadUserUsage(selectedQuotaUserId);
});

init();
