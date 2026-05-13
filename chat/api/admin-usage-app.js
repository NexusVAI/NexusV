// admin_usage.html 的页面逻辑。2026-05-13 审查后从 inline <script> 抽出以便
// admin_usage.html 的 CSP 删除 'unsafe-inline'。

// Mirrors the storageKey used by the main chat UI so the admin's
// existing session is visible here without re-login.
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

let USAGE = [];
let STATS = null;
let activeWindowMs = 7 * 86400_000;
let activeSearch = "";
// Free-form filter chips: { type: 'ip' | 'user_id' | 'model', value }
const FILTERS = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
};
const fmt = (n) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");
const fmtTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
};

function showToast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show " + (kind || "");
  setTimeout(() => {
    t.classList.remove("show");
  }, 2500);
}

async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

async function init() {
  const session = await getSession();
  if (!session) {
    $("loading").style.display = "none";
    $("login-gate").style.display = "block";
    return;
  }
  // Pre-flight admin_check so non-admins see deny-gate immediately
  // instead of a brief "loading" flash before the 403 lands.
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
      $("loading").style.display = "none";
      $("deny-gate").style.display = "block";
      return;
    }
  } catch (_e) {
    $("loading").style.display = "none";
    $("deny-gate").style.display = "block";
    return;
  }
  await loadUsage();
}

async function loadUsage() {
  $("loading").style.display = "block";
  $("loading").textContent = "加载中…";
  try {
    const session = await getSession();
    const resp = await fetch(GW, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
      },
      body: JSON.stringify({
        endpoint: "admin_list_api_usage",
        since_ms: activeWindowMs,
        limit: 1000,
      }),
    });
    if (resp.status === 403) {
      $("loading").style.display = "none";
      $("deny-gate").style.display = "block";
      return;
    }
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    USAGE = Array.isArray(data.usage) ? data.usage : [];
    STATS = data.stats || null;
    $("loading").style.display = "none";
    $("main").style.display = "block";
    renderStats();
    render();
  } catch (e) {
    $("loading").style.display = "none";
    showToast("加载失败：" + (e.message || e), "err");
  }
}

function renderStats() {
  if (!STATS) return;
  $("stats").style.display = "grid";
  $("panels").style.display = "grid";
  $("stat-calls").textContent = fmt(STATS.total_calls);
  // Stats are computed across the full window in Postgres. The row
  // table below is capped at `rows_limit` for browser-side perf — we
  // disclose that explicitly so the totals card never disagrees with
  // what the table appears to show.
  if (STATS.rows_returned != null && STATS.rows_returned < STATS.total_calls) {
    $("stat-calls-sub").textContent =
      "明细仅展示最近 " + fmt(STATS.rows_returned) +
      " 条（共 " + fmt(STATS.total_calls) + " 条）";
  } else {
    $("stat-calls-sub").textContent = "";
  }
  $("stat-errors").textContent = fmt(STATS.error_calls);
  const errPct =
    STATS.total_calls > 0
      ? ((STATS.error_calls / STATS.total_calls) * 100).toFixed(1) + "%"
      : "—";
  $("stat-errors-sub").textContent = errPct;
  $("stat-tin").textContent = fmt(STATS.total_tokens_in);
  $("stat-tout").textContent = fmt(STATS.total_tokens_out);
  $("stat-users").textContent = fmt(STATS.unique_users);
  $("stat-ips").textContent = fmt(STATS.unique_ips);
  $("stat-models").textContent = fmt(STATS.unique_models);

  // Top panels
  $("top-models").innerHTML = (STATS.top_models || [])
    .map(
      (m) => `<div class="panel-row">
        <span class="key click" data-filter-type="model" data-filter-value="${esc(m.key)}">${esc(m.key)}</span>
        <span class="count">${fmt(m.count)}</span>
      </div>`,
    )
    .join("") || `<div class="panel-row"><span class="key">无数据</span></div>`;
  $("top-users").innerHTML = (STATS.top_users || [])
    .map(
      (u) => `<div class="panel-row">
        <span class="key click" data-filter-type="user_id" data-filter-value="${esc(u.user_id)}" title="${esc(u.user_id)}">${esc(u.email || u.user_id.slice(0, 13) + "…")}</span>
        <span class="count">${fmt(u.count)}</span>
      </div>`,
    )
    .join("") || `<div class="panel-row"><span class="key">无数据</span></div>`;
  $("top-ips").innerHTML = (STATS.top_ips || [])
    .map(
      (i) => `<div class="panel-row">
        <span class="key click" data-filter-type="ip" data-filter-value="${esc(i.key)}">${esc(i.key)}</span>
        <span class="count">${fmt(i.count)}</span>
      </div>`,
    )
    .join("") || `<div class="panel-row"><span class="key">无数据</span></div>`;

  // Bind click-to-filter on Top panels
  document
    .querySelectorAll("[data-filter-type]")
    .forEach((el) => {
      el.addEventListener("click", () => {
        addFilter(el.dataset.filterType, el.dataset.filterValue);
      });
    });
}

function addFilter(type, value) {
  if (!type || !value) return;
  // Replace any existing filter of the same type (single-value per
  // type — keeps the chip bar tidy).
  const existing = FILTERS.findIndex((f) => f.type === type);
  if (existing >= 0) FILTERS.splice(existing, 1);
  FILTERS.push({ type, value });
  render();
}

function removeFilter(type) {
  const i = FILTERS.findIndex((f) => f.type === type);
  if (i >= 0) FILTERS.splice(i, 1);
  render();
}

function applyFilters(rows) {
  let out = rows;
  for (const f of FILTERS) {
    if (f.type === "ip") out = out.filter((r) => r.ip === f.value);
    else if (f.type === "user_id")
      out = out.filter((r) => r.user_id === f.value);
    else if (f.type === "model")
      out = out.filter((r) => r.model === f.value);
  }
  if (activeSearch) {
    const q = activeSearch.toLowerCase();
    out = out.filter(
      (r) =>
        (r.email || "").toLowerCase().includes(q) ||
        (r.ip || "").toLowerCase().includes(q) ||
        (r.model || "").toLowerCase().includes(q) ||
        (r.user_id || "").toLowerCase().includes(q) ||
        (r.key_prefix || "").toLowerCase().includes(q),
    );
  }
  return out;
}

function renderChips() {
  const bar = $("chipBar");
  if (FILTERS.length === 0) {
    bar.classList.remove("show");
    bar.innerHTML = "";
    return;
  }
  bar.classList.add("show");
  const labelMap = { ip: "IP", user_id: "用户", model: "模型" };
  bar.innerHTML = FILTERS.map(
    (f) =>
      `<span class="chip">${labelMap[f.type] || f.type}: <code>${esc(f.value)}</code><button data-rm="${esc(f.type)}">×</button></span>`,
  ).join("");
  bar.querySelectorAll("button[data-rm]").forEach((b) => {
    b.addEventListener("click", () => removeFilter(b.dataset.rm));
  });
}

function render() {
  renderChips();
  const filtered = applyFilters(USAGE);
  $("row-count").textContent = `共 ${filtered.length} 条`;
  const tbody = $("rows");
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">没有匹配的调用</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(rowHtml).join("");
  // IP click-to-filter (rows only — Top panel handled separately)
  tbody.querySelectorAll(".ip-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      addFilter("ip", el.dataset.ip);
    });
  });
  tbody.querySelectorAll(".user-link").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      addFilter("user_id", el.dataset.uid);
    });
  });
}

function rowHtml(r) {
  const sc = r.status_code || 0;
  const sClass = sc >= 500 ? "s-5xx" : sc >= 400 ? "s-4xx" : "s-2xx";
  const isErr = sc >= 400;
  const userCell = r.user_id
    ? `<a class="user-link" href="#" data-uid="${esc(r.user_id)}">${esc(r.email || r.user_id.slice(0, 13) + "…")}</a><span class="uid" title="${esc(r.user_id)}">${esc(r.user_id.slice(0, 13))}…</span>`
    : `<span style="color:var(--text-faint)">—</span>`;
  const ipCell = r.ip
    ? `<a class="ip-link" href="#" data-ip="${esc(r.ip)}">${esc(r.ip)}</a>`
    : `<span style="color:var(--text-faint)">—</span>`;
  return `<tr${isErr ? ' class="row-error"' : ""}>
    <td class="email">${userCell}</td>
    <td class="ip">${ipCell}</td>
    <td class="model">${esc(r.model || "—")}</td>
    <td class="tokens">
      ${fmt((r.tokens_in || 0) + (r.tokens_out || 0))}
      <div class="in-out">↓${fmt(r.tokens_in)} ↑${fmt(r.tokens_out)}</div>
    </td>
    <td><span class="status-pill ${sClass}">${sc}</span></td>
    <td class="tokens" title="${esc(r.key_name || "")}">${esc(r.key_prefix || "—")}</td>
    <td class="created">${esc(fmtTime(r.created_at))}</td>
  </tr>`;
}

$("windowFilter").addEventListener("click", (e) => {
  const b = e.target.closest("[data-window]");
  if (!b) return;
  $("windowFilter")
    .querySelectorAll(".filter-btn")
    .forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  activeWindowMs = Number(b.dataset.window);
  loadUsage();
});

$("reload-btn").addEventListener("click", () => loadUsage());

$("search").addEventListener("input", (e) => {
  activeSearch = e.target.value.trim();
  render();
});

init();
