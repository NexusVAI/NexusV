// admin_lines.html 的页面逻辑。2026-05-13 审查后从 inline <script> 抽出以便
// admin_lines.html 的 CSP 删除 'unsafe-inline'。

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
let GROUPS = [];
let TOTALS = { total_lines: 0, total_disabled: 0 };
let activeFilter = "all";
let activeSearch = "";

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
  // Pre-flight admin_check so non-admins see the deny gate immediately
  // instead of an empty page.
  const check = await callGW({ endpoint: "admin_check" }, session);
  if (!check.ok || !check.data?.is_admin) {
    $("deny-gate").style.display = "block";
    return;
  }
  await loadLines();
}

async function loadLines() {
  const session = await getSession();
  const r = await callGW({ endpoint: "admin_list_lines" }, session);
  if (r.status === 403) {
    $("deny-gate").style.display = "block";
    return;
  }
  if (!r.ok) {
    showToast("加载失败：HTTP " + r.status, "err");
    return;
  }
  GROUPS = Array.isArray(r.data?.groups) ? r.data.groups : [];
  TOTALS = {
    total_lines: r.data?.total_lines || 0,
    total_disabled: r.data?.total_disabled || 0,
  };
  $("main").style.display = "block";
  updateStats();
  render();
}

function updateStats() {
  const total = TOTALS.total_lines;
  const dead = TOTALS.total_disabled;
  const healthy = total - dead;
  $("stat-total").textContent = total;
  $("stat-groups").textContent = GROUPS.length;
  $("stat-disabled").textContent = dead;
  $("stat-healthy").textContent = healthy;

  let liveLines = 0;
  let deadLines = 0;
  GROUPS.forEach((g) => {
    g.lines.forEach((l) => {
      if (l.disabled) deadLines++;
      else liveLines++;
    });
  });
  $("cnt-all").textContent = liveLines + deadLines;
  $("cnt-dead").textContent = deadLines;
  $("cnt-live").textContent = liveLines;
}

function shortTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return Math.round(diff / 1000) + "s 前";
  if (diff < 3600_000) return Math.round(diff / 60000) + "m 前";
  if (diff < 86400_000) return Math.round(diff / 3600000) + "h 前";
  return d.toLocaleString("zh-CN", { hour12: false });
}

function passFilter(line) {
  if (activeFilter === "dead" && !line.disabled) return false;
  if (activeFilter === "live" && line.disabled) return false;
  if (activeSearch) {
    const q = activeSearch.toLowerCase();
    const hay = (
      line.id +
      " " +
      (line.canonicalId || "") +
      " " +
      (line.brand || "") +
      " " +
      (line.displayName || "")
    ).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function render() {
  const root = $("groups");
  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    lines: g.lines.filter(passFilter),
  })).filter((g) => g.lines.length > 0);

  if (visibleGroups.length === 0) {
    root.innerHTML = '<div class="empty">没有匹配的线路。</div>';
    return;
  }

  root.innerHTML = visibleGroups
    .map((g) => {
      const dead = g.lines.filter((l) => l.disabled).length;
      const headClass = dead > 0 ? "group has-dead" : "group";
      const lines = g.lines
        .map((l) => {
          const disabled = !!l.disabled;
          const pill = disabled
            ? '<span class="pill dead">已禁用</span>'
            : !l.visible
              ? '<span class="pill hidden">隐藏</span>'
              : '<span class="pill live">健康</span>';
          const reason = disabled
            ? `<div class="reason">${esc(l.reason || "—")}${l.status_code ? " · " + l.status_code : ""}<span class="when">${esc(shortTime(l.disabled_at))} · ${esc(l.disabled_by || "")}</span></div>`
            : '<div class="reason"></div>';
          const action = disabled
            ? `<button class="btn-restore" data-act="enable" data-id="${esc(l.id)}">恢复</button>`
            : `<button class="btn-disable" data-act="disable" data-id="${esc(l.id)}">禁用</button>`;
          const capBadges = [
            l.public !== false ? '<span class="cap on">公开 API</span>' : '<span class="cap off">仅内部</span>',
            l.visible !== false ? '<span class="cap on">聊天可见</span>' : '<span class="cap off">已隐藏</span>',
            l.enabled !== false ? '' : '<span class="cap off">已禁用(注册表)</span>',
            l.chat ? '<span class="cap on">chat</span>' : '',
            l.arena ? '<span class="cap on">arena</span>' : '',
            l.image ? '<span class="cap on">image</span>' : '',
            l.video ? '<span class="cap on">video</span>' : '',
            l.multimodal ? '<span class="cap on">多模态</span>' : '',
            l.costTier ? `<span class="cap tier">${esc(l.costTier)}</span>` : '',
            l.maxInputTokens ? `<span class="cap tokens">in:${esc(l.maxInputTokens)}</span>` : '',
            l.maxOutputTokens ? `<span class="cap tokens">out:${esc(l.maxOutputTokens)}</span>` : '',
          ].filter(Boolean).join('');
          return `<div class="line${disabled ? " disabled" : ""}">
            <div class="line-id">${esc(l.id)}<span class="label">${esc(l.lineLabel || "")}</span><div class="caps">${capBadges}</div></div>
            ${pill}
            <div class="reason-cell">${reason}</div>
            <div class="meta">${esc(l.brand || "")}</div>
            <div class="actions">${action}</div>
          </div>`;
        })
        .join("");
      return `<div class="${headClass}">
        <div class="group-head">
          <div class="group-name">${esc(g.displayName)}<span class="canonical">${esc(g.canonicalId)}</span></div>
          <div class="group-meta">
            ${g.total} 条线路${dead > 0 ? `<span class="dead-count">· ${dead} 已禁用</span>` : ""}
          </div>
        </div>
        <div class="lines">${lines}</div>
      </div>`;
    })
    .join("");

  root.querySelectorAll("button[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.getAttribute("data-act");
      const id = btn.getAttribute("data-id");
      if (act === "enable") doEnable(id, btn);
      else if (act === "disable") doDisable(id, btn);
    });
  });
}

async function doEnable(modelId, btn) {
  const session = await getSession();
  btn.disabled = true;
  btn.textContent = "恢复中…";
  const r = await callGW(
    { endpoint: "admin_enable_line", model_id: modelId },
    session,
  );
  if (!r.ok) {
    showToast("恢复失败：" + (r.data?.message || r.status), "err");
    btn.disabled = false;
    btn.textContent = "恢复";
    return;
  }
  showToast("已恢复 " + modelId, "ok");
  await loadLines();
}

async function doDisable(modelId, btn) {
  if (
    !confirm(
      "手动禁用线路 " +
        modelId +
        "？\n它会立刻从路由中移除，需要在本页点恢复才能再次启用。",
    )
  )
    return;
  const session = await getSession();
  btn.disabled = true;
  btn.textContent = "禁用中…";
  const r = await callGW(
    {
      endpoint: "admin_disable_line",
      model_id: modelId,
      reason: "manual",
    },
    session,
  );
  if (!r.ok) {
    showToast("禁用失败：" + (r.data?.message || r.status), "err");
    btn.disabled = false;
    btn.textContent = "禁用";
    return;
  }
  showToast("已禁用 " + modelId, "ok");
  await loadLines();
}

// Filter buttons
document.querySelectorAll("#statusFilter .filter-btn").forEach((b) => {
  b.addEventListener("click", () => {
    document
      .querySelectorAll("#statusFilter .filter-btn")
      .forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    activeFilter = b.getAttribute("data-filter");
    render();
  });
});

// Search box (debounced)
let searchTimer = null;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    activeSearch = e.target.value.trim();
    render();
  }, 150);
});

$("reload-btn").addEventListener("click", () => loadLines());

init();
