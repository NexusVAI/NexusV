// 2026-05-23：管理员仪表盘前端逻辑（admin_dashboard.html 配套）。
// 调 chat-gateway 的 `admin_dashboard_stats` endpoint 拿汇总数据，
// 用 SVG 绘制订阅圆环 + 7 天调用趋势折线。不引 Chart.js。

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
let refreshTimer = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = String(s == null ? "" : s);
  return d.innerHTML;
};
const fmt = (n) => (n == null || isNaN(n) ? "—" : Number(n).toLocaleString("en-US"));
const fmtShort = (n) => {
  if (n == null || isNaN(n)) return "—";
  const x = Number(n);
  if (x >= 1e9) return (x / 1e9).toFixed(1) + "B";
  if (x >= 1e6) return (x / 1e6).toFixed(1) + "M";
  if (x >= 1e3) return (x / 1e3).toFixed(1) + "K";
  return String(x);
};

function showToast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "");
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => t.classList.remove("show"), 2400);
}

async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
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
  await loadDashboard();
  // 30 秒自动刷新
  refreshTimer = setInterval(loadDashboard, 30_000);
}

async function loadDashboard() {
  const session = await getSession();
  if (!session) return;
  const [statsR, opsR, pricingR] = await Promise.all([
    callGW({ endpoint: "admin_dashboard_stats" }, session),
    callGW({ endpoint: "admin_ops_alerts" }, session),
    // 2026-06-23：用 admin_get_model_pricing 拿 billing_mode（同 RPC 顺带返回）
    callGW({ endpoint: "admin_get_model_pricing" }, session),
  ]);
  if (!statsR.ok) {
    showToast("加载失败：" + (statsR.data?.message || statsR.status), "err");
    return;
  }
  renderDashboard(statsR.data);
  if (opsR.ok) renderOpsAlerts(opsR.data);
  // 2026-06-23：wallet_v3 指标
  renderWalletCards({ billing_mode: pricingR.ok ? pricingR.data?.billing_mode : null, stats: statsR.data });
}

function renderOpsAlerts(d) {
  const panel = $("ops-panel");
  const box = $("dash-ops-alerts");
  if (!panel || !box || !d) return;
  const dup = d.duplicate_submitted || [];
  const exp = d.expiring_subscriptions || [];
  if (dup.length === 0 && exp.length === 0) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  let html = '<div style="display:grid;gap:10px;">';
  if (dup.length > 0) {
    html += `<div style="padding:10px 12px;border-radius:10px;background:rgba(251,191,36,0.1);border:1px solid rgba(251,191,36,0.35);font-size:12.5px;">
      <strong>重复待审 ${dup.length} 用户</strong> · 共 ${fmt(d.pending_submitted_total)} 条 submitted
      <div style="margin-top:6px;color:var(--text-mute)">请去 <a href="./admin_orders.html">订单审核</a> 删除重复记录</div>
    </div>`;
  }
  if (exp.length > 0) {
    html += `<div style="padding:10px 12px;border-radius:10px;background:rgba(96,165,250,0.1);border:1px solid rgba(96,165,250,0.35);font-size:12.5px;">
      <strong>${exp.length} 个订阅 7 天内到期</strong>
      <ul style="margin:6px 0 0;padding-left:18px;color:var(--text-mute)">`;
    exp.slice(0, 5).forEach((s) => {
      html += `<li>${esc(String(s.user_id || "").slice(0, 8))}… · ${esc(s.plan_code)} · 剩 ${esc(s.days_remaining)} 天</li>`;
    });
    html += `</ul><div style="margin-top:6px"><a href="./admin_users.html">用户管理</a> 可续期/提醒</div></div>`;
  }
  html += "</div>";
  box.innerHTML = html;
}

function renderDashboard(d) {
  if (!d) return;
  $("last-updated").textContent = d.generated_at
    ? "更新于 " + new Date(d.generated_at).toLocaleString("zh-CN", { hour12: false })
    : "—";

  // 顶部卡片
  const users = d.users || {};
  $("m-users-total").textContent = fmt(users.total);
  $("m-users-sub").textContent = users.anonymous != null ? `含匿名 ${fmt(users.anonymous)}` : "—";
  $("m-active-today").textContent = fmt(users.active_today);

  const calls = d.calls_24h || {};
  $("m-calls-24h").textContent = fmt(calls.total_calls);
  $("m-calls-users").textContent = `${fmt(calls.unique_users)} 个独立用户`;
  const totalTok = (calls.total_tokens_in || 0) + (calls.total_tokens_out || 0);
  $("m-tokens-24h").textContent = fmtShort(totalTok);
  $("m-tokens-sub").textContent = `↓${fmtShort(calls.total_tokens_in)} ↑${fmtShort(calls.total_tokens_out)}`;
  $("m-err-24h").textContent = fmt(calls.error_calls);
  const errRate = calls.total_calls > 0 ? ((calls.error_calls / calls.total_calls) * 100).toFixed(1) : "0";
  $("m-err-rate").textContent = errRate + "%";

  const orders = d.orders || {};
  $("m-orders-pending").textContent = fmt(orders.pending);
  $("m-orders-24h").textContent = `24h 通过 ${fmt(orders.approved_24h)}`;

  const apps = d.apps || {};
  $("m-apps-pending").textContent = fmt(apps.pending);
  $("m-apps-total").textContent = `历史共 ${fmt(apps.total)}`;

  const bans = d.bans || {};
  $("m-bans-active").textContent = fmt(bans.active);
  $("m-bans-total").textContent = `历史共 ${fmt(bans.total)}`;

  // 导航 badge
  const ordersBadge = $("nav-orders-badge");
  if (orders.pending > 0) {
    ordersBadge.textContent = String(orders.pending);
    ordersBadge.style.display = "inline-block";
  } else {
    ordersBadge.style.display = "none";
  }
  const appsBadge = $("nav-apps-badge");
  if (apps.pending > 0) {
    appsBadge.textContent = String(apps.pending);
    appsBadge.style.display = "inline-block";
  } else {
    appsBadge.style.display = "none";
  }

  // 订阅圆环
  renderSubDonut(users.paid_distribution || {}, users.paid_total || 0);
  // 模型 Top10
  renderTopModels(d.top_models_24h || []);
  // 7 天趋势
  renderTrend(d.daily_7d || []);
}

// ─── 2026-06-23：wallet_v3 指标卡 ──────────────────────────────
// 数据源有限：billing_mode 来自 admin_get_model_pricing；
// recharge pending 暂用 orders.pending（不区分 kind，后端无 filter）；
// wallet 总余额 + 24h 充值后端无 summary RPC，显示 "—" 待后端补。
function renderWalletCards(info) {
  const mode = info?.billing_mode || "—";
  const modeEl = $("m-billing-mode");
  if (modeEl) {
    modeEl.textContent = mode === "wallet_v3" ? "wallet_v3" : mode === "quota_v2" ? "quota_v2" : mode;
    modeEl.style.color = mode === "wallet_v3" ? "var(--ok, #22c55e)" : "var(--text)";
  }
  const modeSub = $("m-billing-mode-sub");
  if (modeSub) {
    modeSub.textContent = mode === "wallet_v3" ? "按量计费已启用" : "旧订阅模式";
  }
  // wallet 总余额：后端无 RPC，显示占位
  const totalEl = $("m-wallet-total");
  if (totalEl) totalEl.textContent = "—";
  const totalSubEl = $("m-wallet-users");
  if (totalSubEl) totalSubEl.textContent = "需后端 wallet summary RPC";
  // 24h 充值：后端无 RPC
  const rechargeEl = $("m-wallet-recharge-24h");
  if (rechargeEl) rechargeEl.textContent = "—";
  const rechargeSubEl = $("m-wallet-recharge-count");
  if (rechargeSubEl) rechargeSubEl.textContent = "需后端 wallet summary RPC";
  // 待审充值订单：暂用 orders.pending（含所有 kind）
  const pendingEl = $("m-wallet-pending");
  if (pendingEl) {
    const pending = info?.stats?.orders?.pending ?? "—";
    pendingEl.textContent = String(pending);
  }
}

// ─── SVG: 订阅分布圆环 ──────────────────────────────────────────
const PLAN_LABELS = { pro: "Pro", pro_plus: "Pro+", pro_max: "Pro Max" };
const PLAN_COLORS = { pro: "#60a5fa", pro_plus: "#f59e0b", pro_max: "#a855f7" };

function renderSubDonut(dist, total) {
  const svg = $("sub-donut");
  $("sub-hint").textContent = `活跃付费订阅 ${total} 个`;
  const cx = 70, cy = 70, r = 50, ringW = 18;
  // 背景圆
  let paths = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${ringW}" />`;

  // 按顺序排列 pro / pro_plus / pro_max
  const order = ["pro", "pro_plus", "pro_max"];
  const C = 2 * Math.PI * r;
  let acc = 0;
  if (total > 0) {
    for (const code of order) {
      const v = Number(dist[code] || 0);
      if (v <= 0) continue;
      const frac = v / total;
      const len = C * frac;
      const dasharray = `${len} ${C - len}`;
      // SVG stroke-dasharray + rotate 实现弧段。-90deg 让起点在 12 点。
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
        stroke="${PLAN_COLORS[code]}" stroke-width="${ringW}"
        stroke-dasharray="${dasharray}"
        stroke-dashoffset="${-C * acc}"
        transform="rotate(-90 ${cx} ${cy})" />`;
      acc += frac;
    }
  }
  paths += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" class="donut-center">${total}</text>`;
  paths += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" class="donut-center-sub">付费用户</text>`;
  svg.innerHTML = paths;

  // 图例
  const legend = $("sub-legend");
  legend.innerHTML = order.map((code) => {
    const v = Number(dist[code] || 0);
    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
    return `<div class="donut-legend__item">
      <span class="donut-legend__dot" style="background:${PLAN_COLORS[code]}"></span>
      <span class="donut-legend__name">${PLAN_LABELS[code]}</span>
      <span class="donut-legend__val">${v} · ${pct}%</span>
    </div>`;
  }).join("");
}

// ─── 模型 Top10 横向条形 ────────────────────────────────────────
function renderTopModels(top) {
  const root = $("top-models");
  if (!top.length) {
    root.innerHTML = '<div style="color:var(--text-mute);padding:8px;">24h 内无调用</div>';
    return;
  }
  const max = top.reduce((m, r) => Math.max(m, r.count), 0) || 1;
  root.innerHTML = top.map((m) => {
    const pct = Math.round((m.count / max) * 100);
    return `<div class="topbar-row">
      <div class="topbar-row__top">
        <span class="topbar-row__name">${esc(m.model)}</span>
        <span class="topbar-row__stat">${fmt(m.count)} 次 · ${fmtShort(m.tokens)} tok</span>
      </div>
      <div class="topbar-row__track"><div class="topbar-row__fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join("");
}

// ─── 7 天调用趋势：双 Y 轴 SVG 折线 ────────────────────────────
// 蓝色线 = calls；紫色线 = tokens（用各自的最大值做归一化映射到 0..1）
function renderTrend(days) {
  const svg = $("trend-svg");
  const axis = $("trend-axis");
  if (!days.length) {
    svg.innerHTML = `<text x="400" y="90" text-anchor="middle" fill="var(--text-mute)" font-size="12">暂无数据</text>`;
    axis.innerHTML = "";
    return;
  }
  const W = 800, H = 180, pad = 24;
  const maxCalls = Math.max(1, ...days.map((d) => d.calls));
  const maxTokens = Math.max(1, ...days.map((d) => d.tokens));
  const n = days.length;
  const xStep = (W - pad * 2) / Math.max(1, n - 1);
  function pt(arr, key, max) {
    return arr.map((d, i) => {
      const x = pad + xStep * i;
      const y = H - pad - ((d[key] / max) * (H - pad * 2));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }
  const callsPath = pt(days, "calls", maxCalls);
  const tokensPath = pt(days, "tokens", maxTokens);

  // 简单网格线 + 点 + 折线
  let inner = "";
  for (let i = 0; i <= 3; i++) {
    const y = pad + ((H - pad * 2) / 3) * i;
    inner += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="var(--border)" stroke-width="1" opacity="0.5" />`;
  }
  // 折线
  inner += `<polyline points="${tokensPath}" fill="none" stroke="#a855f7" stroke-width="2" opacity="0.85" />`;
  inner += `<polyline points="${callsPath}" fill="none" stroke="#60a5fa" stroke-width="2.4" />`;
  // 数据点
  days.forEach((d, i) => {
    const x = pad + xStep * i;
    const yCalls = H - pad - ((d.calls / maxCalls) * (H - pad * 2));
    const yTok = H - pad - ((d.tokens / maxTokens) * (H - pad * 2));
    inner += `<circle cx="${x}" cy="${yCalls}" r="3" fill="#60a5fa"><title>${d.day_utc8}: ${d.calls} 次</title></circle>`;
    inner += `<circle cx="${x}" cy="${yTok}" r="2.5" fill="#a855f7" opacity="0.85"><title>${d.day_utc8}: ${fmtShort(d.tokens)} tok</title></circle>`;
  });
  svg.innerHTML = inner;

  // x 轴标签：只显示首中末三处
  const labels = [];
  if (n >= 1) labels.push(days[0].day_utc8.slice(5));
  if (n >= 3) labels.push(days[Math.floor(n / 2)].day_utc8.slice(5));
  if (n >= 2) labels.push(days[n - 1].day_utc8.slice(5));
  axis.innerHTML = labels.map((l) => `<span>${esc(l)}</span>`).join("");
}

// 页面隐藏时停止自动刷新（省 RTT）；显示时重新加载 + 重启 timer
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  } else if (document.getElementById("main").style.display === "block") {
    loadDashboard();
    if (!refreshTimer) refreshTimer = setInterval(loadDashboard, 30_000);
  }
});

init();
