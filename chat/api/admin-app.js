// admin.html 的页面逻辑。2026-05-13 审查后从 inline <script> 抽出以便
// admin.html 的 CSP 删除 'unsafe-inline'。

// IMPORTANT: storageKey must match cancri_chat.js so the admin's login
// session from the main chat page is visible here.
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
const INITIAL_LIMIT = 100;
let APPS = [];
let APPS_TOTAL = 0;
let LIST_STATS = null;
let isLoadingMore = false;
let activeStatus = "";
let activeSearch = "";
let activeIpFilter = "";
// IP -> count (across all APPS, regardless of current filter). Used to
// flag duplicates so the admin can mass-reject same-egress abuse.
let IP_COUNTS = new Map();
// Set of selected application ids for batch operations.
const SELECTED = new Set();
// 2026-05-16：展开了"详情"sub-row 的申请 id。打开一行不影响其他。
const EXPANDED = new Set();

const $ = (id) => document.getElementById(id);
const setText = (id, v) => {
  const el = $(id);
  if (el) el.textContent = v;
};
const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
};

const { fmtAgeDays, fmtTokens, fmtArr, fmtScreen, fmtTime, fmtIpGeo } = window.AdminFormatters;

// 风险信号 pills（在邮箱列下显示，吸引管理员注意）。
// 顺序按严重程度由重到轻：当前封禁 > 多账号 > 重复邮箱 > VPN > 同 IP > 代理 > 机房
function renderRiskPills(a) {
  const pills = [];
  if (a.ban && a.ban.active) pills.push('<span class="risk-pill danger">🚫 当前封禁</span>');
  else if (a.ban) pills.push('<span class="risk-pill warn">⚠ 曾被封禁</span>');
  if (a.suspect && a.suspect.distinct_users >= 2) {
    pills.push('<span class="risk-pill danger" title="同设备 ' + a.suspect.distinct_users + ' 个账号">同设备 ' + a.suspect.distinct_users + '号</span>');
  }
  if (a.duplicate_email && a.duplicate_email.count >= 2) {
    pills.push('<span class="risk-pill danger">同邮箱 ' + a.duplicate_email.count + '号</span>');
  }
  if (a.device && a.device.vpn_suspected) pills.push('<span class="risk-pill warn">VPN</span>');
  if (a.device && a.device.webrtc_leak_detected) pills.push('<span class="risk-pill warn">漏 IP</span>');
  if (a.ip_reuse && a.ip_reuse.user_count >= 2) {
    pills.push('<span class="risk-pill warn">同 IP ' + a.ip_reuse.user_count + '号</span>');
  }
  if (a.ip_geo && a.ip_geo.proxy) pills.push('<span class="risk-pill warn">代理</span>');
  if (a.ip_geo && a.ip_geo.hosting) pills.push('<span class="risk-pill warn">机房</span>');
  if (pills.length === 0) return "";
  return '<div class="risk-row">' + pills.join("") + "</div>";
}

// 用户上下文（注册时长 / 历史订单 / 用量），显示在邮箱列底
function renderUserContext(a) {
  const m = a.user_meta;
  const h = a.order_history;
  const u = a.recent_usage;
  const parts = [];
  if (m) parts.push('🕐 ' + esc(fmtAgeDays(m.age_days)));
  if (h && h.total > 0) {
    const segs = [];
    if (h.activated) segs.push(h.activated + "激活");
    if (h.approved) segs.push(h.approved + "通过");
    if (h.rejected) segs.push('<span class="ctx-warn">' + h.rejected + "被拒</span>");
    if (h.submitted) segs.push(h.submitted + "待审");
    if (segs.length) parts.push("📋 " + segs.join("/"));
  }
  if (u && u.call_count > 0) {
    parts.push("⚡ 7d " + u.call_count + "次");
  }
  if (parts.length === 0) return "";
  return '<div class="user-ctx">' + parts.join(' · ') + '</div>';
}

function renderTierPill(tier) {
  if (tier === "paid") return '<span class="tier-pill paid">PAID</span>';
  return '<span class="tier-pill free">FREE</span>';
}

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

// ─── 2026-08-14: 免费 Opus5（c:claude-opus-5）验证用户面板 ───────────
let OPUS5_MATCHES = [];

function renderOpus5Row(m) {
  const ageDays = m.created_at
    ? Math.floor((Date.now() - new Date(m.created_at).getTime()) / 86400000)
    : null;
  const verified = !!m.is_verified;
  const identity = m.email || m.name || "—";
  const subIdentity = m.name && m.email ? `<div class="user-id">${esc(m.name)}</div>` : "";
  const recharge = "¥" + (Number(m.cumulative_recharge_cny) || 0).toFixed(2);
  // 2026-08-18: 口径从「每日」改成自然周 / 自然月。这两行是漏改重灾区 —— 上一轮只改了
  // 下面的确认框和 admin.html 说明文字，胶囊还写着「100/日」，同一页出现两套口径。
  const statusPill = verified
    ? '<span class="tier-pill paid">已验证 · 100/周</span>'
    : '<span class="tier-pill free">未验证 · 10/月</span>';
  const actionLabel = verified ? "取消验证" : "标记已验证";
  const actionCls = verified ? "btn-reject" : "btn-approve";
  return `<tr data-uid="${esc(m.user_id)}">
    <td>${esc(identity)}${subIdentity}</td>
    <td><code style="font-size: 11px">${esc(m.user_id)}</code></td>
    <td>${esc(fmtAgeDays(ageDays))}</td>
    <td>${esc(recharge)}</td>
    <td>${statusPill}</td>
    <td>
      <button class="${actionCls}" data-action="opus5-toggle" data-verified="${verified ? "0" : "1"}" data-uid="${esc(m.user_id)}">${actionLabel}</button>
    </td>
  </tr>`;
}

function renderOpus5Table() {
  const tbody = $("opus5Rows");
  if (!tbody) return;
  if (OPUS5_MATCHES.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">没有匹配的用户</td></tr>`;
    return;
  }
  tbody.innerHTML = OPUS5_MATCHES.map(renderOpus5Row).join("");
  tbody.querySelectorAll('[data-action="opus5-toggle"]').forEach((btn) => {
    btn.addEventListener("click", () =>
      setOpus5Verified(btn.dataset.uid, btn.dataset.verified === "1"),
    );
  });
}

async function searchOpus5Candidates() {
  const input = $("opus5SearchInput");
  const query = (input?.value || "").trim();
  if (query.length < 3) {
    showToast("至少输入 3 个字符", "err");
    return;
  }
  const btn = $("opus5SearchBtn");
  if (btn) btn.disabled = true;
  try {
    const session = await getSession();
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify({
        endpoint: "admin_search_opus5_candidates",
        query,
        __auth_token: session.access_token,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
    OPUS5_MATCHES = Array.isArray(data.matches) ? data.matches : [];
    renderOpus5Table();
  } catch (e) {
    showToast("搜索失败：" + (e.message || e), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function setOpus5Verified(userId, verified) {
  const verb = verified ? "标记为已验证" : "取消验证";
  if (!confirm(`确认${verb}？`)) return;
  const row = document.querySelector(`#opus5Rows tr[data-uid="${userId}"]`);
  row?.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const session = await getSession();
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify({
        endpoint: "admin_set_opus5_verified",
        user_id: userId,
        verified,
        __auth_token: session.access_token,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || "HTTP " + resp.status);
    const m = OPUS5_MATCHES.find((x) => x.user_id === userId);
    if (m) m.is_verified = verified;
    renderOpus5Table();
    showToast(`已${verb}`, "ok");
  } catch (e) {
    showToast(`${verb}失败：` + (e.message || e), "err");
    row?.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

$("opus5SearchBtn")?.addEventListener("click", searchOpus5Candidates);
$("opus5SearchInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchOpus5Candidates();
});

// 2026-08-14: 一键把所有人的免费 Opus5 已用次数清零。影响全站所有用户，二次确认。
// 2026-08-18: 计数改为自然周（已验证 100 次）/ 自然月（未验证 10 次）。清零只影响
// 当前周期的已用次数，不改变周期边界，所以后端不再回「下次重置时间」——两类用户的
// 重置时刻本就不同，显示单一时间戳对谁都不对。
async function resetOpus5DailyLimits() {
  if (
    !confirm(
      "确认清零所有人的免费 Opus5（C）已用次数？\n\n所有账号（已验证 100 次/周、未验证 10 次/月）当前周期的已用计数都会归零，周期重置时刻不变。此操作影响全站所有用户，不可撤销。",
    )
  )
    return;
  const btn = $("opus5ResetAllBtn");
  const statusEl = $("opus5ResetAllStatus");
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "重置中…";
  try {
    const session = await getSession();
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify({
        endpoint: "admin_reset_opus5_daily_limits",
        __auth_token: session.access_token,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) throw new Error(data.error || "HTTP " + resp.status);
    if (statusEl) statusEl.textContent = "已清零（周期重置时刻不变）";
    showToast("已清零所有人的 Opus5 免费额度已用次数", "ok");
  } catch (e) {
    if (statusEl) statusEl.textContent = "";
    showToast("重置失败：" + (e.message || e), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}
$("opus5ResetAllBtn")?.addEventListener("click", resetOpus5DailyLimits);

async function init() {
  const session = await getSession();
  $("loading").style.display = "none";
  if (!session || !session.user || session.user.is_anonymous) {
    $("login-gate").style.display = "block";
    return;
  }
  // Pre-flight admin_check so non-admins see deny-gate immediately
  // instead of a blank page (admin_list_api_applications would 403,
  // but the user-facing UX is better with an explicit pre-check).
  try {
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify({ endpoint: "admin_check", __auth_token: session.access_token }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.is_admin) {
      $("deny-gate").style.display = "block";
      return;
    }
  } catch (_e) {
    $("deny-gate").style.display = "block";
    return;
  }
  await loadApps();
}

async function loadApps(opts = {}) {
  const append = !!opts.append;
  const limit = Math.max(
    1,
    Math.min(
      500,
      Number(opts.limit) ||
        (append ? Number($("loadMoreSize")?.value || INITIAL_LIMIT) : INITIAL_LIMIT),
    ),
  );
  const offset = append ? APPS.length : 0;
  if (!append) {
    SELECTED.clear();
    EXPANDED.clear();
  }
  const session = await getSession();
  isLoadingMore = true;
  updateLoadMoreBar();
  try {
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify({
        endpoint: "admin_list_api_applications",
        limit,
        offset,
        __auth_token: session.access_token,
      }),
    });
    if (resp.status === 403) {
      $("deny-gate").style.display = "block";
      return;
    }
    if (!resp.ok) {
      throw new Error("HTTP " + resp.status);
    }
    const data = await resp.json();
    const incoming = Array.isArray(data.applications) ? data.applications : [];
    if (append) {
      const seen = new Set(APPS.map((a) => a.id));
      incoming.forEach((a) => {
        if (!seen.has(a.id)) APPS.push(a);
      });
    } else {
      APPS = incoming;
    }
    APPS_TOTAL = Number(data.total) || APPS.length;
    LIST_STATS = data.stats || LIST_STATS;
    if (data.ip_counts && typeof data.ip_counts === "object") {
      IP_COUNTS = new Map(Object.entries(data.ip_counts));
    }
    $("main").style.display = "block";
    updateStats();
    render();
    updateLoadMoreBar();
  } catch (e) {
    showToast("加载失败：" + (e.message || e), "err");
    updateLoadMoreBar();
  } finally {
    isLoadingMore = false;
    updateLoadMoreBar();
  }
}

function bumpListStats(oldStatus, newStatus) {
  if (!LIST_STATS || oldStatus === newStatus) return;
  if (oldStatus === "pending" && LIST_STATS.pending > 0) LIST_STATS.pending--;
  if (newStatus === "approved") LIST_STATS.approved++;
  else if (newStatus === "rejected") LIST_STATS.rejected++;
}

function updateStats() {
  if (LIST_STATS) {
    setText("stat-pending", LIST_STATS.pending);
    setText("stat-approved", LIST_STATS.approved);
    setText("stat-rejected", LIST_STATS.rejected);
    setText("stat-total", LIST_STATS.total);
    setText("cnt-all", LIST_STATS.total);
    setText("cnt-pending", LIST_STATS.pending);
    setText("cnt-approved", LIST_STATS.approved);
    setText("cnt-rejected", LIST_STATS.rejected);
    return;
  }
  const counts = { pending: 0, approved: 0, rejected: 0 };
  IP_COUNTS = new Map();
  APPS.forEach((a) => {
    if (counts[a.status] !== undefined) counts[a.status]++;
    if (a.ip) IP_COUNTS.set(a.ip, (IP_COUNTS.get(a.ip) || 0) + 1);
  });
  setText("stat-pending", counts.pending);
  setText("stat-approved", counts.approved);
  setText("stat-rejected", counts.rejected);
  setText("stat-total", APPS.length);
  setText("cnt-all", APPS.length);
  setText("cnt-pending", counts.pending);
  setText("cnt-approved", counts.approved);
  setText("cnt-rejected", counts.rejected);
}

function updateLoadMoreBar() {
  const bar = $("loadMoreBar");
  if (!bar) return;
  const loaded = APPS.length;
  const total = APPS_TOTAL || loaded;
  const hasMore = loaded < total;
  bar.style.display = hasMore ? "flex" : "none";
  setText("loadMoreMeta", `已加载 ${loaded} / ${total} 条`);
  const moreBtn = $("loadMoreBtn");
  const allBtn = $("loadAllBtn");
  if (moreBtn) moreBtn.disabled = isLoadingMore;
  if (allBtn) allBtn.disabled = isLoadingMore;
  if (moreBtn) moreBtn.textContent = isLoadingMore ? "加载中…" : "继续看";
  if (allBtn) allBtn.textContent = isLoadingMore ? "加载中…" : "加载全部";
}

async function loadAllApps() {
  while (APPS.length < APPS_TOTAL) {
    const before = APPS.length;
    const remaining = APPS_TOTAL - before;
    await loadApps({ append: true, limit: Math.min(500, remaining) });
    if (APPS.length === before) break;
  }
}

// Apply all filters (status / IP / free-text search) in order. Pulled
// out of render() so we can also reuse it when computing batch targets.
function getFilteredApps() {
  let list = activeStatus
    ? APPS.filter((a) => a.status === activeStatus)
    : APPS;
  if (activeIpFilter) {
    list = list.filter((a) => a.ip === activeIpFilter);
  }
  if (activeSearch) {
    const q = activeSearch.toLowerCase();
    list = list.filter(
      (a) =>
        (a.email || "").toLowerCase().includes(q) ||
        (a.ip || "").toLowerCase().includes(q) ||
        (a.purpose || "").toLowerCase().includes(q) ||
        (a.user_id || "").toLowerCase().includes(q),
    );
  }
  return list;
}

function refreshBatchBar() {
  const n = SELECTED.size;
  $("batchBar").classList.toggle("show", n > 0);
  $("batchCount").textContent = n;
  // Sync the header check-all box state (checked / partial / empty).
  const visible = getFilteredApps();
  const visibleSelected = visible.filter((a) =>
    SELECTED.has(a.id),
  ).length;
  const cb = $("checkAll");
  if (visible.length === 0) {
    cb.checked = false;
    cb.indeterminate = false;
  } else if (visibleSelected === visible.length) {
    cb.checked = true;
    cb.indeterminate = false;
  } else if (visibleSelected > 0) {
    cb.indeterminate = true;
  } else {
    cb.checked = false;
    cb.indeterminate = false;
  }
}

function render() {
  const filtered = getFilteredApps();
  const tbody = $("rows");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">没有匹配的工单</td></tr>`;
    refreshBatchBar();
    return;
  }
  // 每个申请渲染 main row + （展开时）detail sub-row
  tbody.innerHTML = filtered.map((a) =>
    rowHtml(a) + (EXPANDED.has(a.id) ? detailRowHtml(a) : "")
  ).join("");
  // Bind action buttons (approve / reject / details toggle)
  tbody.querySelectorAll("[data-action]").forEach((btn) => {
    const action = btn.dataset.action;
    if (action === "toggle-details") {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (EXPANDED.has(id)) EXPANDED.delete(id);
        else EXPANDED.add(id);
        render();  // 简单重渲整张表（≤500 行，性能可接受）
      });
    } else {
      btn.addEventListener("click", () => decide(btn));
    }
  });
  // Bind row checkboxes
  tbody.querySelectorAll("input.row-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id;
      if (cb.checked) SELECTED.add(id);
      else SELECTED.delete(id);
      refreshBatchBar();
    });
  });
  // Bind IP click-to-filter (only meaningful for duplicate IPs)
  tbody.querySelectorAll(".ip-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      setIpFilter(el.dataset.ip);
    });
  });
  refreshBatchBar();
}

function rowHtml(a) {
  const created = a.created_at
    ? new Date(a.created_at).toLocaleString("zh-CN", { hour12: false })
    : "—";
  const statusKey = a.status || "pending";
  // 2026-08-04：本队列从「API 申请审核」改为「工单 / 反馈」（申请制取消），
  // 后端 status 枚举不变，仅换文案；kind='api_apply' 是历史旧申请。
  const statusLabel =
    { pending: "待处理", approved: "已处理", rejected: "已关闭" }[
      statusKey
    ] || statusKey;
  const kindPill =
    a.kind === "api_apply"
      ? '<span class="key-tier-chip" style="background:rgba(148,163,184,.18);color:var(--text-mute)">旧申请</span>'
      : "";
  const isPending = statusKey === "pending";
  const ip = a.ip || "";
  const ipCount = ip ? IP_COUNTS.get(ip) || 0 : 0;
  const ipDup = ipCount > 1;
  // IP 列：第一行 IP（含原有同 IP 申请计数）+ 第二行 IP 真实地理（小字）
  const geoLabel = fmtIpGeo(a.ip_geo);
  const ipLine = ip
    ? `<a class="ip-link${ipDup ? " ip-dup" : ""}" data-ip="${esc(ip)}" href="#" title="${ipDup ? "该 IP 共 " + ipCount + " 条记录，点击仅看这条 IP" : "点击仅看这条 IP"}">${esc(ip)}${ipDup ? `<span class="ip-count">×${ipCount}</span>` : ""}</a>`
    : `<span style="color:var(--text-faint)">—</span>`;
  const ipHtml = ipLine + (geoLabel ? `<div class="ip-geo">${esc(geoLabel)}</div>` : "");
  const checked = SELECTED.has(a.id) ? "checked" : "";
  // Only allow checkbox on pending rows (batch ops only target pending).
  const checkboxHtml = isPending
    ? `<input type="checkbox" class="row-check" data-id="${esc(a.id)}" ${checked} />`
    : "";
  const detailsBtnLabel = EXPANDED.has(a.id) ? "收起" : "详情";
  return `<tr class="app-row" data-id="${esc(a.id)}">
    <td>${checkboxHtml}</td>
    <td class="email">
      <div class="email-line">${esc(a.email || "—")} ${renderTierPill(a.tier)} ${kindPill}</div>
      <div class="user-id">${esc((a.user_id || "").slice(0, 13))}…</div>
      ${renderRiskPills(a)}
      ${renderUserContext(a)}
    </td>
    <td class="purpose">${esc(a.purpose || "—")}</td>
    <td class="ip">${ipHtml}</td>
    <td><span class="status status-${statusKey}">${statusLabel}</span></td>
    <td class="created">${esc(created)}</td>
    <td>
      <div class="actions">${actionButtonsHtml(a, statusKey)}
        <button class="btn-details" data-action="toggle-details" data-id="${esc(a.id)}">${detailsBtnLabel}</button>
      </div>
    </td>
  </tr>`;
}

// 工单操作按钮：待处理可标完成/关闭；已处理可重开（改为已关闭）；已关闭可标为已处理。
// 后端 admin_review_api_application 允许对非 pending 行重复操作（直接 update status）。
function actionButtonsHtml(a, statusKey) {
  const id = esc(a.id);
  if (statusKey === "approved") {
    return `<button class="btn-reject" data-action="rejected" data-revoke="1" data-id="${id}">改为已关闭</button>`;
  }
  if (statusKey === "rejected") {
    return `<button class="btn-approve" data-action="approved" data-revoke="1" data-id="${id}">改为已处理</button>`;
  }
  return `<button class="btn-approve" data-action="approved" data-id="${id}">标为已处理</button>
        <button class="btn-reject" data-action="rejected" data-id="${id}">关闭</button>`;
}

// 展开详情 sub-row：完整设备指纹 + 同 IP / 同邮箱 / 同设备 的其他 user_id
function detailRowHtml(a) {
  const dev = a.device;
  const sus = a.suspect;
  const ipReuse = a.ip_reuse;
  const dupEmail = a.duplicate_email;
  const deviceIpGeo = dev && dev.ip_geo ? dev.ip_geo : null;

  if (!dev && !sus && !ipReuse && !dupEmail) {
    return `<tr class="detail-row"><td colspan="7" class="detail-empty">
      暂无设备指纹（用户登录访问任意挂了 fingerprint.js 的页面后才会采集）。当前只有 IP / 邮箱 / 用途等基础信息。
    </td></tr>`;
  }

  const rows = [];
  if (dev) {
    rows.push(detailLine("真实 IP",
      `<code>${esc(dev.server_ip || "—")}</code>` +
      (deviceIpGeo ? `<br><span class="detail-sub">${esc(fmtIpGeo(deviceIpGeo))}</span>` : "")
    ));
    rows.push(detailLine("WebRTC 公网", `<code>${esc(fmtArr(dev.webrtc_public_ips))}</code>`));
    rows.push(detailLine("WebRTC 内网", `<code>${esc(fmtArr(dev.webrtc_local_ips))}</code>`));
    rows.push(detailLine("时区 / 语言", esc(dev.timezone || "—") + " · " + esc(fmtArr(dev.languages))));
    rows.push(detailLine("UA", `<span class="detail-ua">${esc(dev.ua || "—")}</span>`));
    rows.push(detailLine("平台 / 厂商", esc(dev.platform || "—") + " · " + esc(dev.vendor || "—")));
    const hw = (dev.hardware_concurrency != null) ? (dev.hardware_concurrency + " 核") : "—";
    const mem = (dev.device_memory != null) ? (dev.device_memory + " GB") : "—";
    rows.push(detailLine("硬件", esc(hw) + " · " + esc(mem) + " · " + esc(fmtScreen(dev.screen))));
    rows.push(detailLine("visitor_id", `<code>${esc(dev.visitor_id || "—")}</code>`));
    rows.push(detailLine("指纹时间窗",
      "首次 " + esc(fmtTime(dev.first_seen)) + " · 最近 " + esc(fmtTime(dev.last_seen)) +
      ` · <span class="detail-sub">${dev.fingerprint_count || 0} 条记录</span>`
    ));
  }

  // 同设备 / 同 IP / 同邮箱的其他 user_id
  function listOtherUserIds(label, ids) {
    if (!ids || !ids.length) return "";
    const others = ids.filter((u) => u && u !== a.user_id);
    if (!others.length) return "";
    return detailLine(label, others.map((u) => `<code>${esc(u)}</code>`).join(" "));
  }
  rows.push(listOtherUserIds("同设备其他账号", sus ? sus.user_ids : []));
  rows.push(listOtherUserIds("同申请 IP 其他账号", ipReuse ? ipReuse.user_ids : []));
  rows.push(listOtherUserIds("同邮箱其他账号", dupEmail ? dupEmail.user_ids : []));

  return `<tr class="detail-row"><td colspan="7">
    <div class="detail-grid">${rows.filter(Boolean).join("")}</div>
  </td></tr>`;
}

function detailLine(label, valueHtml) {
  return `<div class="detail-line"><span class="detail-k">${esc(label)}</span><span class="detail-v">${valueHtml}</span></div>`;
}

function setIpFilter(ip) {
  activeIpFilter = ip || "";
  const bar = $("ipFilterBar");
  if (activeIpFilter) {
    $("ipFilterValue").textContent = activeIpFilter;
    bar.classList.add("show");
  } else {
    bar.classList.remove("show");
  }
  render();
}

async function batchDecide(newStatus) {
  const ids = Array.from(SELECTED);
  if (ids.length === 0) return;
  // Filter to only pending ones (server will skip non-pending via update
  // but we want accurate confirm count).
  const pendingIds = APPS.filter(
    (a) => SELECTED.has(a.id) && a.status === "pending",
  ).map((a) => a.id);
  if (pendingIds.length === 0) {
    showToast("所选工单里没有待处理的", "err");
    return;
  }
  const verb = newStatus === "approved" ? "标为已处理" : "关闭";
  if (!confirm(`确认${verb} ${pendingIds.length} 条工单？`)) return;
  // Disable the bar buttons during the call.
  const aBtn = $("batchApprove");
  const rBtn = $("batchReject");
  aBtn.disabled = true;
  rBtn.disabled = true;
  try {
    const session = await getSession();
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify({
        endpoint: "admin_batch_review_api_applications",
        application_ids: pendingIds,
        status: newStatus,
        __auth_token: session.access_token,
      }),
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      showToast(`已${verb} ${data.updated ?? pendingIds.length} 条`, "ok");
      // Update local state and re-render without a full reload.
      const idSet = new Set(pendingIds);
      APPS.forEach((a) => {
        if (idSet.has(a.id)) {
          bumpListStats(a.status, newStatus);
          a.status = newStatus;
        }
      });
      SELECTED.clear();
      updateStats();
      render();
    } else {
      showToast(data.error || `批量${verb}失败`, "err");
    }
  } catch (e) {
    showToast("网络错误：" + (e.message || e), "err");
  } finally {
    aBtn.disabled = false;
    rBtn.disabled = false;
  }
}

async function decide(btn) {
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const isRevoke = btn.dataset.revoke === "1";
  const verb = action === "approved" ? "标为已处理" : "关闭";
  const tip = isRevoke
    ? action === "rejected"
      ? `确认把这张已处理的工单改为已关闭？`
      : `确认把这张已关闭的工单改为已处理？`
    : `确认${verb}这张工单？`;
  if (!confirm(tip)) return;
  const row = btn.closest("tr");
  row.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const session = await getSession();
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: window.__SUPABASE_ANON_KEY__,
      },
      body: JSON.stringify({
        endpoint: "admin_review_api_application",
        application_id: id,
        status: action,
        __auth_token: session.access_token,
      }),
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      showToast(`已${verb}`, "ok");
      // Update local data and re-render
      const app = APPS.find((a) => a.id === id);
      if (app) {
        bumpListStats(app.status, action);
        app.status = action;
      }
      // Remove from batch selection — the row is no longer pending so
      // its checkbox won't render anyway, but the count badge would
      // stay stale otherwise.
      SELECTED.delete(id);
      updateStats();
      render();
    } else {
      showToast(data.error || `${verb}失败`, "err");
      row.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  } catch (e) {
    showToast("网络错误：" + (e.message || e), "err");
    row.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}

$("statusFilter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-status]");
  if (!b) return;
  $("statusFilter")
    .querySelectorAll(".filter-btn")
    .forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  activeStatus = b.dataset.status;
  render();
});

$("reload-btn").addEventListener("click", () => loadApps({ append: false }));
$("loadMoreBtn").addEventListener("click", () => loadApps({ append: true }));
$("loadAllBtn").addEventListener("click", () => loadAllApps());

// Search box (instant filter; debounce not needed for ≤500 rows).
$("search").addEventListener("input", (e) => {
  activeSearch = e.target.value.trim();
  render();
});

// IP filter clear
$("ipFilterClear").addEventListener("click", () => setIpFilter(""));

// Batch bar
$("batchApprove").addEventListener("click", () => batchDecide("approved"));
$("batchReject").addEventListener("click", () => batchDecide("rejected"));
$("batchClear").addEventListener("click", () => {
  SELECTED.clear();
  render();
});

// Header check-all toggles all currently visible pending rows.
$("checkAll").addEventListener("change", (e) => {
  const visible = getFilteredApps().filter((a) => a.status === "pending");
  if (e.target.checked) {
    visible.forEach((a) => SELECTED.add(a.id));
  } else {
    visible.forEach((a) => SELECTED.delete(a.id));
  }
  render();
});

init();
