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
      Authorization: "Bearer " + session.access_token,
    },
    body: JSON.stringify(payload),
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

function renderBans() {
  const root = $("bansList");
  if (!BANS.length) {
    root.innerHTML = '<div class="empty-bans">暂无封禁记录。</div>';
    return;
  }
  root.innerHTML = BANS.map((b) => {
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
      return `<div class="match-row${isBanned ? " banned" : ""}" data-uid="${esc(m.user_id)}">
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
  showToast("已封禁 " + userId.slice(0, 8) + "…", "ok");
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
$("banBtn").addEventListener("click", doBan);
$("reload-btn").addEventListener("click", loadBans);

init();
