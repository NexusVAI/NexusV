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
let APPS = [];
let activeStatus = "";
let activeSearch = "";
let activeIpFilter = "";
// IP -> count (across all APPS, regardless of current filter). Used to
// flag duplicates so the admin can mass-reject same-egress abuse.
let IP_COUNTS = new Map();
// Set of selected application ids for batch operations.
const SELECTED = new Set();

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
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({ endpoint: "admin_check" }),
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

async function loadApps() {
  const session = await getSession();
  try {
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        endpoint: "admin_list_api_applications",
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
    APPS = Array.isArray(data.applications) ? data.applications : [];
    $("main").style.display = "block";
    updateStats();
    render();
  } catch (e) {
    showToast("加载失败：" + (e.message || e), "err");
  }
}

function updateStats() {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  IP_COUNTS = new Map();
  APPS.forEach((a) => {
    if (counts[a.status] !== undefined) counts[a.status]++;
    if (a.ip) IP_COUNTS.set(a.ip, (IP_COUNTS.get(a.ip) || 0) + 1);
  });
  $("stat-pending").textContent = counts.pending;
  $("stat-approved").textContent = counts.approved;
  $("stat-rejected").textContent = counts.rejected;
  $("stat-total").textContent = APPS.length;
  $("cnt-all").textContent = APPS.length;
  $("cnt-pending").textContent = counts.pending;
  $("cnt-approved").textContent = counts.approved;
  $("cnt-rejected").textContent = counts.rejected;
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
    tbody.innerHTML = `<tr><td colspan="7" class="empty">没有匹配的申请</td></tr>`;
    refreshBatchBar();
    return;
  }
  tbody.innerHTML = filtered.map(rowHtml).join("");
  // Bind action buttons
  tbody.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => decide(btn));
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
  const statusLabel =
    { pending: "待审核", approved: "已通过", rejected: "已拒绝" }[
      statusKey
    ] || statusKey;
  const isPending = statusKey === "pending";
  const ip = a.ip || "";
  const ipCount = ip ? IP_COUNTS.get(ip) || 0 : 0;
  const ipDup = ipCount > 1;
  const ipHtml = ip
    ? `<a class="ip-link${ipDup ? " ip-dup" : ""}" data-ip="${esc(ip)}" href="#" title="${ipDup ? "该 IP 共 " + ipCount + " 条申请，点击仅看这条 IP" : "点击仅看这条 IP"}">${esc(ip)}${ipDup ? `<span class="ip-count">×${ipCount}</span>` : ""}</a>`
    : `<span style="color:var(--text-faint)">—</span>`;
  const checked = SELECTED.has(a.id) ? "checked" : "";
  // Only allow checkbox on pending rows (batch ops only target pending).
  const checkboxHtml = isPending
    ? `<input type="checkbox" class="row-check" data-id="${esc(a.id)}" ${checked} />`
    : "";
  return `<tr data-id="${esc(a.id)}">
    <td>${checkboxHtml}</td>
    <td class="email">
      ${esc(a.email || "—")}
      <div class="user-id" style="margin-top:4px">${esc((a.user_id || "").slice(0, 13))}…</div>
    </td>
    <td class="purpose">${esc(a.purpose || "—")}</td>
    <td class="ip">${ipHtml}</td>
    <td><span class="status status-${statusKey}">${statusLabel}</span></td>
    <td class="created">${esc(created)}</td>
    <td>
      <div class="actions">
        <button class="btn-approve" data-action="approved" data-id="${esc(a.id)}" ${isPending ? "" : "disabled"}>通过</button>
        <button class="btn-reject" data-action="rejected" data-id="${esc(a.id)}" ${isPending ? "" : "disabled"}>拒绝</button>
      </div>
    </td>
  </tr>`;
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
    showToast("所选申请里没有待审核的", "err");
    return;
  }
  const verb = newStatus === "approved" ? "通过" : "拒绝";
  if (!confirm(`确认${verb} ${pendingIds.length} 条申请？`)) return;
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
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        endpoint: "admin_batch_review_api_applications",
        application_ids: pendingIds,
        status: newStatus,
      }),
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      showToast(`已${verb} ${data.updated ?? pendingIds.length} 条`, "ok");
      // Update local state and re-render without a full reload.
      const idSet = new Set(pendingIds);
      APPS.forEach((a) => {
        if (idSet.has(a.id)) a.status = newStatus;
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
  const verb = action === "approved" ? "通过" : "拒绝";
  if (!confirm(`确认${verb}这个申请？`)) return;
  const row = btn.closest("tr");
  row.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    const session = await getSession();
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        endpoint: "admin_review_api_application",
        application_id: id,
        status: action,
      }),
    });
    const data = await resp.json();
    if (resp.ok && data.ok) {
      showToast(`已${verb}`, "ok");
      // Update local data and re-render
      const app = APPS.find((a) => a.id === id);
      if (app) app.status = action;
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

$("reload-btn").addEventListener("click", () => loadApps());

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
