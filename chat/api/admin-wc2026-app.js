// admin_wc2026.html — 世界杯 2026 主队支持 · 胜场录入
// 走 CF 原生 wc2026-support（chat.nexusvai.xyz/functions/v1/wc2026-support）

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
const WC = window.__SUPABASE_URL__ + "/functions/v1/wc2026-support";

const state = {
  dashboard: null,
  recording: null,
};

const $ = (id) => document.getElementById(id);

function toast(msg, kind) {
  const t = $("toast");
  if (!t) {
    alert(msg);
    return;
  }
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

function flagImg(team, className) {
  const cls = className || "wc-admin-flag-img";
  const flag = team && team.flag ? team.flag : "unknown";
  const name = team && team.name ? team.name : "";
  return `<img class="${cls}" src="../assets/wc-flags/${flag}.png" alt="${escHtml(name)}" width="48" height="36" loading="lazy" decoding="async" />`;
}

function formatTokens(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + " 亿";
  if (n >= 1e4) return (n / 1e4).toFixed(1) + " 万";
  return n.toLocaleString("zh-CN");
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function callGw(endpoint, payload) {
  const {
    data: { session },
  } = await sb.auth.getSession();
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

async function callWc(body) {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) throw new Error("not_logged_in");
  const resp = await fetch(WC, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: window.__SUPABASE_ANON_KEY__,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.message || data.error || "request_failed");
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

function teamStats(code) {
  const by = (state.dashboard && state.dashboard.by_team) || {};
  const row = by[code] || {};
  return {
    supporters: row.supporters || 0,
    wins: row.wins || 0,
    tokens_distributed: row.tokens_distributed || 0,
  };
}

function renderSummary() {
  const d = state.dashboard || {};
  const t = d.totals || {};
  $("stat-supporters").textContent = String(t.supporters ?? "—");
  $("stat-wins").textContent = String(t.wins_recorded ?? "—");
  $("stat-tokens").textContent = formatTokens(t.tokens_distributed ?? 0);
  $("stat-per-win").textContent =
    "每场 " + formatTokens(d.tokens_per_win || 100000) + " Token";
}

function renderTeams() {
  const grid = $("team-admin-grid");
  const teams = window.WC2026_TEAMS || [];
  if (!grid) return;
  if (!teams.length) {
    grid.innerHTML = '<div class="empty">球队列表未加载</div>';
    return;
  }

  grid.innerHTML = teams
    .map((team) => {
      const st = teamStats(team.code);
      const disabled = state.recording === team.code;
      return `
        <article class="wc-admin-card" data-code="${escHtml(team.code)}">
          <div class="wc-admin-flag">${flagImg(team)}</div>
          <div class="wc-admin-name">${escHtml(team.name)}</div>
          <div class="wc-admin-code">${escHtml(team.code)}</div>
          <div class="wc-admin-meta">
            <span>支持者 <strong>${st.supporters}</strong></span>
            <span>胜场 <strong>${st.wins}</strong></span>
            <span>已发 <strong>${formatTokens(st.tokens_distributed)}</strong></span>
          </div>
          <button type="button" class="btn-win" data-win="${escHtml(team.code)}" ${disabled ? "disabled" : ""}>
            ${disabled ? "录入中…" : "+1 胜场 · 每人 10万 Token"}
          </button>
        </article>`;
    })
    .join("");

  grid.querySelectorAll(".btn-win").forEach((btn) => {
    btn.addEventListener("click", () => recordWin(btn.getAttribute("data-win")));
  });
}

function renderRecent() {
  const list = $("recent-wins");
  const recent = (state.dashboard && state.dashboard.recent_wins) || [];
  if (!list) return;
  if (!recent.length) {
    list.innerHTML = '<div class="empty">暂无胜场记录</div>';
    return;
  }
  list.innerHTML = recent
    .map((w) => {
      const team = (window.WC2026_TEAMS || []).find((t) => t.code === w.team_code);
      const name = team ? team.name : w.team_code;
      return `
        <div class="wc-recent-row">
          <span class="wc-recent-flag">${team ? flagImg(team, "wc-recent-flag-img") : ""}</span>
          <span class="wc-recent-name">${escHtml(name)}</span>
          <span class="wc-recent-meta">${escHtml(w.match_label || "胜场")} · ${w.supporters_rewarded} 人 · ${formatTokens(w.tokens_per_supporter)}</span>
          <span class="wc-recent-time">${formatTime(w.recorded_at)}</span>
        </div>`;
    })
    .join("");
}

async function reload() {
  const data = await callWc({ action: "admin_dashboard" });
  state.dashboard = data.dashboard || data;
  renderSummary();
  renderTeams();
  renderRecent();
}

async function recordWin(code) {
  if (!code || state.recording) return;
  const team = (window.WC2026_TEAMS || []).find((t) => t.code === code);
  const label = ($("match-label") && $("match-label").value.trim()) || "";
  const name = team ? team.name : code;
  const st = teamStats(code);
  const msg =
    `确认：${name} +1 胜场？\n将为 ${st.supporters} 名支持者各发放 10 万 Token。`;
  if (!confirm(msg)) return;

  state.recording = code;
  renderTeams();
  try {
    const data = await callWc({
      action: "admin_record_win",
      team_code: code,
      match_label: label,
    });
    state.dashboard = data.dashboard || state.dashboard;
    const r = data.result || {};
    toast(
      `${name} 胜场已录入 · ${r.supporters_rewarded || 0} 人各 +10万 Token`,
      "ok",
    );
    renderSummary();
    renderTeams();
    renderRecent();
  } catch (e) {
    toast(e.message || "录入失败", "err");
  } finally {
    state.recording = null;
    renderTeams();
  }
}

async function bootstrap() {
  const {
    data: { session },
  } = await sb.auth.getSession();
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
    $("reload-btn").addEventListener("click", () => reload().catch((e) => toast(e.message, "err")));
  } catch (e) {
    $("loading").style.display = "none";
    if (e.status === 403) $("deny-gate").style.display = "block";
    else $("login-gate").style.display = "block";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
  bootstrap();
}
