// api_keys.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_keys.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js 同款做法：
//   1. inline <script> -> 外联 .js
//   2. inline onclick="..." -> addEventListener
//   3. innerHTML 字符串里 onclick="deleteKey(...)" -> data-action 委托监听器
//   4. CSP <meta> 删 script-src 'unsafe-inline'
//
// 2026-05-23：扩展高级限额 (model whitelist / max tokens / max requests / RPM)
// + Key 详情面板 (用量统计 / by_model / by_day / 调用日志 / 编辑限额 / 重置已用)
// 2026-06-23：全量中文文案、内嵌式生成密钥卡片、内嵌全局日志、页面内确认弹窗、重命名、405 防护。

// IMPORTANT: storageKey must match cancri_chat.js so session is shared with main
// chat page (otherwise login on chat page won't be visible here).
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
const API_GW = window.__SUPABASE_URL__ + "/functions/v1/api-gateway";
let currentKeys = [];
let availableModels = []; // 从 /v1/models 拿到的模型 ID 列表
let currentDetailKeyId = "";
// 2026-05-17：effective tier 来自 user_subscriptions（cancri_get_user_tier RPC），
// 不再读 api_keys.tier 列（已废弃 / 不与权威订阅同步）。所有 key 共享同一 user
// 的 tier，所以一次拉，全部 key 复用。failed → 默认 'free'（保守，告诉用户
// 升级）。
let effectiveTier = "free";

async function init() {
    const loading = document.getElementById("loading");
    const auth = window.PlatformAuth;
    try {
        if (!window.supabase || !window.__SUPABASE_URL__ || !auth) {
            if (auth) auth.showAuthError("依赖脚本加载失败，请检查网络后刷新。", document.querySelector(".page-shell"));
            else if (loading) loading.textContent = "依赖脚本加载失败，请检查网络后刷新。";
            return;
        }
        const {
            data: { user },
        } = await sb.auth.getUser();
        if (!user || user.is_anonymous) {
            auth.redirectToLogin();
            return;
        }
        await loadData();
    } finally {
        if (auth) auth.hide(loading);
        else if (loading) loading.style.display = "none";
    }
}

async function fetchEffectiveTier(session) {
    try {
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify({ endpoint: "get_my_subscription", __auth_token: session.access_token }),
        });
        if (!resp.ok) return "free";
        const data = await resp.json();
        const sub = data && data.subscription;
        return sub && sub.tier === "paid" ? "paid" : "free";
    } catch (e) {
        return "free";
    }
}

async function getSession() {
    const {
        data: { session },
    } = await sb.auth.getSession();
    return session;
}

async function loadData() {
    const session = await getSession();
    if (!session) {
        if (window.PlatformAuth) PlatformAuth.redirectToLogin();
        return;
    }
    // 并行拉 keys、effective tier、可用模型清单
    const [resp, tierFromSub, models] = await Promise.all([
        fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify({ endpoint: "api_my_keys", __auth_token: session.access_token }),
        }),
        fetchEffectiveTier(session),
        fetchAvailableModels(),
    ]);
    effectiveTier = tierFromSub;
    availableModels = models;
    populateModelSelects();
    const data = await resp.json();
    const hasApproved =
        data.applications &&
        data.applications.some((a) => a.status === "approved");
    if (!hasApproved) {
        document.getElementById("no-approval").style.display = "block";
        return;
    }
    document.getElementById("main-section").style.display = "block";
    currentKeys = data.keys || [];
    renderKeys();
    loadUsage();
    loadApiLog();
}

// 2026-05-23：拉可用模型清单，填充 advanced & edit 限额面板的 <select multiple>。
// /v1/models 是 api-gateway 的公开 endpoint，不需要 auth。
async function fetchAvailableModels() {
    try {
        const r = await fetch(API_GW + "/v1/models");
        if (!r.ok) return [];
        const data = await r.json();
        if (!data || !Array.isArray(data.data)) return [];
        const ids = data.data
            .map((m) => String(m.id || "").trim())
            .filter(Boolean);
        // 按字母序，方便用户在长列表中找
        ids.sort();
        return ids;
    } catch (_e) {
        return [];
    }
}

function populateModelSelects() {
    const sel1 = document.getElementById("adv-models");
    const sel2 = document.getElementById("kd-edit-models");
    const html = availableModels
        .map((id) => `<option value="${esc(id)}">${esc(id)}</option>`)
        .join("");
    if (sel1) sel1.innerHTML = html;
    if (sel2) sel2.innerHTML = html;
}

function renderKeys() {
    const el = document.getElementById("keys-list");
    if (currentKeys.length === 0) {
        el.innerHTML =
            '<div class="empty">暂无密钥，请点击上方生成。</div>';
        return;
    }
    // 2026-05-17：tier chip 用 effectiveTier（来自 user_subscriptions 权威），
    // 而不是 k.tier（已废弃的 api_keys.tier 列）。所有 key 共享同一 tier。
    const tierLabel = effectiveTier === "paid" ? "付费" : "免费";
    const tierClass = effectiveTier === "paid"
        ? "key-tier-chip is-paid"
        : "key-tier-chip is-free";
    el.innerHTML = currentKeys.map((k) => renderKeyRow(k, tierLabel, tierClass)).join("");
}

// 2026-05-23：每个 key 卡片渲染。加：
//   - 限额状态 chip（白名单 N 个 / token 已用 X / Y / 请求已用 X / Y / RPM）
//   - 用量进度条（如果有 max_*）
//   - "详情/编辑" 按钮（打开 key 详情面板）
function renderKeyRow(k, tierLabel, tierClass) {
    const lastUsed = k.last_used_at
        ? new Date(k.last_used_at).toLocaleString("zh-CN")
        : "从未使用";
    const wl = Array.isArray(k.model_whitelist) ? k.model_whitelist : [];
    const usedTok = Number(k.used_total_tokens || 0);
    const usedReq = Number(k.used_request_count || 0);
    const maxTok = k.max_total_tokens == null ? null : Number(k.max_total_tokens);
    const maxReq = k.max_request_count == null ? null : Number(k.max_request_count);
    const rpm = k.rpm_limit == null ? null : Number(k.rpm_limit);

    const chips = [`<span class="${tierClass}">${tierLabel}</span>`];
    if (wl.length > 0) chips.push(`<span class="key-tier-chip" style="background:rgba(168,85,247,0.15);color:#a855f7">${wl.length} 个模型</span>`);
    if (rpm) chips.push(`<span class="key-tier-chip" style="background:rgba(96,165,250,0.15);color:#60a5fa">${rpm} RPM</span>`);

    let bars = "";
    if (maxTok || maxReq) {
        const pcts = [];
        if (maxTok) {
            const pct = Math.min(100, Math.round((usedTok / maxTok) * 100));
            const cls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "";
            pcts.push(`<div class="key-usage-bar">
                <div class="key-usage-bar__label">
                    <span>Token 用量</span>
                    <span>${usedTok.toLocaleString()} / ${maxTok.toLocaleString()} (${pct}%)</span>
                </div>
                <div class="key-usage-bar__track">
                    <div class="key-usage-bar__fill ${cls}" style="width:${pct}%"></div>
                </div>
            </div>`);
        }
        if (maxReq) {
            const pct = Math.min(100, Math.round((usedReq / maxReq) * 100));
            const cls = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "";
            pcts.push(`<div class="key-usage-bar">
                <div class="key-usage-bar__label">
                    <span>调用次数</span>
                    <span>${usedReq.toLocaleString()} / ${maxReq.toLocaleString()} (${pct}%)</span>
                </div>
                <div class="key-usage-bar__track">
                    <div class="key-usage-bar__fill ${cls}" style="width:${pct}%"></div>
                </div>
            </div>`);
        }
        bars = `<div class="key-usage-bars">${pcts.join("")}</div>`;
    } else {
        // 无上限：仍展示已用量做参考
        bars = `<div class="key-usage-bars"><div class="key-usage-bar" style="color:var(--text-faint)">已用 ${usedTok.toLocaleString()} tokens · ${usedReq.toLocaleString()} 次请求（未设上限）</div></div>`;
    }

    return `<div class="key-row">
        <div class="key-info">
            <div class="key-name">${esc(k.name)} ${chips.join(" ")}</div>
            <div class="key-prefix">${esc(k.key_prefix)}</div>
            <div class="key-meta">创建：${new Date(k.created_at).toLocaleDateString("zh-CN")} | 最后使用：${lastUsed}</div>
            ${bars}
        </div>
        <div class="key-actions" style="display:flex;flex-direction:column;gap:6px;">
            <button class="btn btn-secondary" data-action="detail-key" data-key-id="${esc(k.id)}" data-key-name="${esc(k.name)}">详情</button>
            <button class="btn btn-secondary" data-action="rename-key" data-key-id="${esc(k.id)}" data-key-name="${esc(k.name)}" data-key-prefix="${esc(k.key_prefix)}">重命名</button>
            <button class="btn btn-danger" data-action="delete-key" data-key-id="${esc(k.id)}" data-key-prefix="${esc(k.key_prefix)}" title="撤销此密钥">撤销</button>
        </div>
    </div>`;
}

async function deleteKey(keyId, keyPrefix) {
    const confirmed = await showConfirmDialog(
        "撤销密钥",
        `确认撤销密钥 <code>${esc(keyPrefix)}</code>？此操作不可恢复，撤销后该密钥立即失效。`,
        { danger: true, confirmText: "撤销", cancelText: "取消" },
    );
    if (!confirmed) return;
    try {
        const session = await getSession();
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify({
                endpoint: "api_delete_key",
                key_id: keyId,
                __auth_token: session.access_token,
            }),
        });
        const data = await resp.json();
        if (resp.ok && data.ok) {
            // 2026-05-22：撤销任意一把 Key 时，保守清掉 sessionStorage 里
            // 缓存的 cancri_recent_api_key（我们只能拿到 prefix，无法确定
            // 缓存的那把是不是这一把；清空避免代码示例里仍透出已撤销的 Key）。
            try {
                sessionStorage.removeItem("cancri_recent_api_key");
            } catch (_) {}
            showMsg("密钥已撤销", false);
            await loadData();
        } else {
            showMsg(data.error || "撤销失败", true);
        }
    } catch (e) {
        showMsg("网络错误", true);
    }
}

async function loadUsage() {
    try {
        const session = await getSession();
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify({ endpoint: "api_my_usage", __auth_token: session.access_token }),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        renderUsage(data.usage || []);
    } catch (e) {
        console.error(e);
    }
}

function renderMonitorChart(days, tokenByDay) {
    const svg = document.getElementById("monitor-chart-svg");
    const wrap = document.getElementById("monitor-chart-wrap");
    const tooltip = document.getElementById("monitor-tooltip");
    if (!svg || !wrap) return;

    const W = 800;
    const H = 200;
    const pad = { t: 16, r: 16, b: 8, l: 16 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;

    const calls = days.map(([, v]) => v);
    const tokens = days.map(([k]) => tokenByDay.get(k) || 0);
    const maxCalls = Math.max(1, ...calls);
    const maxTokens = Math.max(1, ...tokens);

    const pointsCalls = calls.map((v, i) => {
        const x = pad.l + (i / Math.max(1, calls.length - 1)) * innerW;
        const y = pad.t + innerH - (v / maxCalls) * innerH;
        return { x, y, v, day: days[i][0], tokens: tokens[i] };
    });

    const pointsTokens = tokens.map((v, i) => {
        const x = pad.l + (i / Math.max(1, tokens.length - 1)) * innerW;
        const y = pad.t + innerH - (v / maxTokens) * innerH * 0.85;
        return { x, y };
    });

    const lineCalls = pointsCalls.map((p) => `${p.x},${p.y}`).join(" ");
    const lineTokens = pointsTokens.map((p) => `${p.x},${p.y}`).join(" ");
    const areaCalls =
        `${pointsCalls[0].x},${pad.t + innerH} ` +
        lineCalls +
        ` ${pointsCalls[pointsCalls.length - 1].x},${pad.t + innerH}`;

    const gridLines = [0.25, 0.5, 0.75].map((f) => {
        const y = pad.t + innerH * (1 - f);
        return `<line class="monitor-chart__grid-line" x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}"/>`;
    });

    svg.innerHTML = `
      <defs>
        <linearGradient id="monitor-area-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4ade80" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
        </linearGradient>
        <pattern id="monitor-inactive-pattern" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,0.06)" stroke-width="4"/>
        </pattern>
      </defs>
      <rect x="${pad.l}" y="${pad.t}" width="${innerW}" height="${innerH}" class="monitor-chart__inactive" rx="4"/>
      ${gridLines.join("")}
      <polygon class="monitor-chart__area" points="${areaCalls}"/>
      <polyline class="monitor-chart__line" points="${lineTokens}" stroke="#6f6d66" stroke-width="1.5" stroke-dasharray="4 3"/>
      <polyline class="monitor-chart__line" points="${lineCalls}"/>
      ${pointsCalls
          .map(
              (p, i) =>
                  `<circle data-idx="${i}" cx="${p.x}" cy="${p.y}" r="4" fill="#4ade80" stroke="#141413" stroke-width="2" style="cursor:pointer"/>`,
          )
          .join("")}
    `;

    svg.querySelectorAll("circle[data-idx]").forEach((c) => {
        c.addEventListener("mouseenter", (e) => {
            const idx = Number(c.getAttribute("data-idx"));
            const p = pointsCalls[idx];
            if (!tooltip || !p) return;
            tooltip.hidden = false;
            tooltip.innerHTML = `<strong>${p.day}</strong>调用 ${p.v} 次 · Token ${p.tokens.toLocaleString()}`;
            const rect = wrap.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            tooltip.style.left = Math.min(rect.width - 160, Math.max(8, cx - 80)) + "px";
            tooltip.style.top = "24px";
        });
        c.addEventListener("mouseleave", () => {
            if (tooltip) tooltip.hidden = true;
        });
    });
}

function renderUsage(rows) {
    const chart = document.getElementById("usage-chart");
    const axis = document.getElementById("usage-axis");
    const empty = document.getElementById("usage-empty");
    const byModelEl = document.getElementById("usage-by-model");
    if (!rows.length) {
        chart.innerHTML = "";
        axis.innerHTML = "";
        byModelEl.innerHTML = "";
        const svg = document.getElementById("monitor-chart-svg");
        if (svg) svg.innerHTML = "";
        empty.style.display = "block";
        document.getElementById("u-total").textContent = "0";
        document.getElementById("u-tokens-in").textContent = "0";
        document.getElementById("u-tokens-out").textContent = "0";
        document.getElementById("u-error-rate").textContent = "0%";
        return;
    }
    empty.style.display = "none";

    // Aggregate per day for last 30 days
    const dayBuckets = new Map();
    const dayTokenBuckets = new Map();
    const modelBuckets = new Map();
    let totalIn = 0,
        totalOut = 0,
        totalCalls = rows.length,
        errorCalls = 0;
    const now = Date.now();
    const dayMs = 86400 * 1000;
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * dayMs);
        const k =
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0");
        dayBuckets.set(k, 0);
        dayTokenBuckets.set(k, 0);
    }
    rows.forEach((r) => {
        const d = new Date(r.created_at);
        const k =
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0");
        if (dayBuckets.has(k)) {
            dayBuckets.set(k, dayBuckets.get(k) + 1);
            dayTokenBuckets.set(
                k,
                dayTokenBuckets.get(k) +
                    (Number(r.tokens_in) || 0) +
                    (Number(r.tokens_out) || 0),
            );
        }
        const m = r.model || "unknown";
        if (!modelBuckets.has(m))
            modelBuckets.set(m, { calls: 0, tin: 0, tout: 0 });
        const mb = modelBuckets.get(m);
        mb.calls++;
        mb.tin += Number(r.tokens_in) || 0;
        mb.tout += Number(r.tokens_out) || 0;
        totalIn += Number(r.tokens_in) || 0;
        totalOut += Number(r.tokens_out) || 0;
        if (
            r.status_code &&
            Number(r.status_code) >= 400
        )
            errorCalls++;
    });

    const days = Array.from(dayBuckets.entries());
    const maxCount = Math.max(1, ...days.map(([_, v]) => v));
    chart.innerHTML = days
        .map(([day, count]) => {
            const h = Math.max(2, (count / maxCount) * 76);
            return `<div class="usage-chart-bar${count > 0 ? "" : " is-empty"}" title="${day}: ${count} 次" style="height:${h}px"></div>`;
        })
        .join("");
    renderMonitorChart(days, dayTokenBuckets);
    axis.innerHTML =
        `<span>${days[0][0].slice(5)}</span>` +
        `<span>${days[Math.floor(days.length / 2)][0].slice(5)}</span>` +
        `<span>${days[days.length - 1][0].slice(5)}</span>`;

    document.getElementById("u-total").textContent = totalCalls;
    document.getElementById("u-tokens-in").textContent =
        totalIn.toLocaleString();
    document.getElementById("u-tokens-out").textContent =
        totalOut.toLocaleString();
    document.getElementById("u-error-rate").textContent =
        totalCalls === 0
            ? "0%"
            : Math.round((errorCalls / totalCalls) * 100) + "%";

    // By-model breakdown (top 6)
    const sorted = Array.from(modelBuckets.entries()).sort(
        (a, b) => b[1].calls - a[1].calls,
    );
    const top = sorted.slice(0, 6);
    if (top.length === 0) {
        byModelEl.innerHTML = "";
    } else {
        const maxModelCalls = Math.max(
            ...top.map(([_, v]) => v.calls),
        );
        byModelEl.innerHTML =
            '<div class="model-bar-title">按模型</div>' +
            top
                .map(([m, v]) => {
                    const w = (v.calls / maxModelCalls) * 100;
                    return `<div class="model-bar-row">
                          <span class="model-bar-name" title="${esc(m)}">${esc(m)}</span>
                          <div class="model-bar-track"><div class="model-bar-fill" style="width:${w}%"></div></div>
                          <span class="model-bar-stat">${v.calls} · ${(v.tin + v.tout).toLocaleString()} tok</span>
                        </div>`;
                })
                .join("");
    }
}

// 2026-06-23：全局内嵌 API 调用日志（最近 100 条）。
async function loadApiLog() {
    const list = document.getElementById("api-log-list");
    const empty = document.getElementById("api-log-empty");
    if (!list) return;
    try {
        const session = await getSession();
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify({ endpoint: "api_my_usage", limit: 100, __auth_token: session.access_token }),
        });
        if (!resp.ok) {
            list.innerHTML = '<div style="color:var(--err);padding:14px;text-align:center;">加载失败</div>';
            if (empty) empty.style.display = "none";
            return;
        }
        const data = await resp.json();
        renderApiLog(data.usage || []);
    } catch (e) {
        if (list) list.innerHTML = '<div style="color:var(--err);padding:14px;text-align:center;">加载失败</div>';
        if (empty) empty.style.display = "none";
        console.error(e);
    }
}

function renderApiLog(rows) {
    const list = document.getElementById("api-log-list");
    const empty = document.getElementById("api-log-empty");
    if (!list) return;
    if (rows.length === 0) {
        list.innerHTML = "";
        if (empty) empty.style.display = "block";
        return;
    }
    if (empty) empty.style.display = "none";
    list.innerHTML = rows.slice(0, 100).map((u) => {
        const sc = u.status_code || 0;
        const scCls = sc >= 500 ? "err" : sc >= 400 ? "warn" : "ok";
        return `<div class="kd-detail-row">
            <div class="model">${esc(u.model || "—")}</div>
            <div class="tok">${((u.tokens_in || 0) + (u.tokens_out || 0)).toLocaleString()}<div style="font-size:10px;color:var(--text-faint)">↓${(u.tokens_in || 0).toLocaleString()} ↑${(u.tokens_out || 0).toLocaleString()}</div></div>
            <div class="sc ${scCls}">${sc}</div>
            <div class="when">${new Date(u.created_at).toLocaleString("zh-CN", { hour12: false })}</div>
        </div>`;
    }).join("");
}

let lastGeneratedKeyId = "";

async function generateKey(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    const name =
        document.getElementById("key-name").value.trim() ||
        "default";
    // 2026-05-23：收集高级限额（可选，留空则不设）
    const advWhitelist = Array.from(
        document.getElementById("adv-models").selectedOptions,
    ).map((o) => o.value);
    const advMaxTokensRaw = document.getElementById("adv-max-tokens").value.trim();
    const advMaxRequestsRaw = document.getElementById("adv-max-requests").value.trim();
    const advRpmRaw = document.getElementById("adv-rpm").value.trim();
    const advMaxTokens = advMaxTokensRaw ? Number(advMaxTokensRaw) : null;
    const advMaxRequests = advMaxRequestsRaw ? Number(advMaxRequestsRaw) : null;
    const advRpm = advRpmRaw ? Number(advRpmRaw) : null;

    // 原 inline onclick 依赖全局 `event`；addEventListener 给我们显式 event 参数，
    // 用 currentTarget 拿到绑定监听器的按钮（非冒泡命中元素），等价但更安全。
    const btn =
        (ev && ev.currentTarget) ||
        document.getElementById("generate-key-btn");
    btn.disabled = true;
    btn.textContent = "生成中...";
    try {
        const session = await getSession();
        const payload = {
            endpoint: "api_generate_key",
            name,
            __auth_token: session.access_token,
        };
        if (advWhitelist.length > 0) payload.model_whitelist = advWhitelist;
        if (advMaxTokens) payload.max_total_tokens = advMaxTokens;
        if (advMaxRequests) payload.max_request_count = advMaxRequests;
        if (advRpm) payload.rpm_limit = advRpm;

        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (resp.ok && data.key) {
            document.getElementById("new-key-value").textContent =
                data.key;
            const box = document.getElementById("new-key-box");
            box.style.display = "block";
            box.classList.add("is-visible");
            // 记录新密钥 id，方便生成后立即重命名。
            lastGeneratedKeyId = data.key_data && data.key_data.id ? data.key_data.id : "";
            // 隐藏重命名输入框，重置其值。
            const renameBox = document.getElementById("new-key-rename-box");
            if (renameBox) renameBox.style.display = "none";
            const renameInput = document.getElementById("new-key-rename-input");
            if (renameInput) renameInput.value = "";
            // 2026-05-22：把刚生成的完整 Key 存入 sessionStorage（仅当前会话）。
            // 模型广场抽屉里的「调用代码」会读取此 Key 直接填入示例。
            // 关闭浏览器/标签页后会被自动清空，避免 Key 在磁盘里长期残留。
            // 用户在 Keys 页主动撤销该 Key 时也会清除（见 deleteKey 内部清理）。
            try {
                sessionStorage.setItem("cancri_recent_api_key", data.key);
            } catch (_) {
                // sessionStorage 不可用（如隐私模式）也不影响主流程
            }
            showMsg("密钥生成成功！本会话内已自动同步到模型广场代码示例。", false);
            await loadData();
        } else {
            showMsg(data.error || "生成失败", true);
        }
    } catch (e) {
        showMsg("网络错误", true);
    }
    btn.disabled = false;
    btn.textContent = "生成";
}

function copyKey() {
    const key =
        document.getElementById("new-key-value").textContent;
    const btn = document.getElementById("copy-key-btn");
    navigator.clipboard.writeText(key).then(() => {
        showMsg("已复制到剪贴板", false);
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = "已复制";
            btn.classList.add("is-ok");
            setTimeout(() => {
                btn.textContent = orig;
                btn.classList.remove("is-ok");
            }, 1400);
        }
    });
}

// 2026-06-23：生成后直接在结果卡片里重命名。
function showNewKeyRename() {
    const box = document.getElementById("new-key-rename-box");
    if (box) {
        box.style.display = "flex";
        const input = document.getElementById("new-key-rename-input");
        if (input) {
            input.value = "";
            input.focus();
        }
    }
}

async function saveNewKeyName() {
    if (!lastGeneratedKeyId) {
        showMsg("请先生成密钥", true);
        return;
    }
    const input = document.getElementById("new-key-rename-input");
    const name = input ? input.value.trim() : "";
    if (!name) {
        showMsg("请输入名称", true);
        return;
    }
    try {
        const session = await getSession();
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify({
                endpoint: "api_update_key",
                key_id: lastGeneratedKeyId,
                name,
                __auth_token: session.access_token,
            }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.ok) {
            showMsg("密钥已重命名", false);
            const box = document.getElementById("new-key-rename-box");
            if (box) box.style.display = "none";
            await loadData();
        } else {
            showMsg("重命名失败：" + (data.message || data.error || resp.status), true);
        }
    } catch (e) {
        showMsg("网络错误", true);
    }
}

function showMsg(text, isErr) {
    const el = document.getElementById("gen-msg");
    el.textContent = text;
    el.className = "msg " + (isErr ? "err" : "ok");
    el.style.display = "block";
    setTimeout(() => {
        el.style.display = "none";
    }, 5000);
}

function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

// 2026-06-23：页面内确认 / 输入弹窗（替代原生 confirm / prompt）。
// 返回 Promise，resolve(true/false) 或 resolve(inputValue/null)。
function pageDialog(title, body, options) {
    options = options || {};
    return new Promise((resolve) => {
        const overlay = document.getElementById("page-dialog");
        const titleEl = document.getElementById("page-dialog-title");
        const bodyEl = document.getElementById("page-dialog-body");
        const inputEl = document.getElementById("page-dialog-input");
        const confirmBtn = document.getElementById("page-dialog-confirm");
        const cancelBtn = document.getElementById("page-dialog-cancel");
        if (!overlay || !titleEl || !bodyEl || !confirmBtn || !cancelBtn) {
            resolve(options.input ? null : false);
            return;
        }
        titleEl.textContent = title || "确认";
        bodyEl.innerHTML = body || "是否继续？";
        if (options.input) {
            inputEl.style.display = "block";
            inputEl.value = options.defaultValue || "";
            inputEl.placeholder = options.placeholder || "";
            setTimeout(() => inputEl.focus(), 50);
        } else {
            inputEl.style.display = "none";
            inputEl.value = "";
        }
        if (options.confirmText) confirmBtn.textContent = options.confirmText;
        else confirmBtn.textContent = "确认";
        if (options.cancelText) cancelBtn.textContent = options.cancelText;
        else cancelBtn.textContent = "取消";
        if (options.danger) {
            confirmBtn.classList.remove("btn-primary", "btn-secondary");
            confirmBtn.classList.add("btn-danger");
        } else {
            confirmBtn.classList.remove("btn-danger", "btn-secondary");
            confirmBtn.classList.add("btn-primary");
        }
        overlay.classList.add("is-visible");
        overlay.setAttribute("aria-hidden", "false");

        const cleanup = () => {
            overlay.classList.remove("is-visible");
            overlay.setAttribute("aria-hidden", "true");
            confirmBtn.removeEventListener("click", onConfirm);
            cancelBtn.removeEventListener("click", onCancel);
            overlay.removeEventListener("click", onOverlay);
            inputEl.removeEventListener("keydown", onInputKey);
        };
        const onConfirm = () => {
            cleanup();
            resolve(options.input ? inputEl.value.trim() : true);
        };
        const onCancel = () => {
            cleanup();
            resolve(options.input ? null : false);
        };
        const onOverlay = (e) => {
            if (e.target === overlay) onCancel();
        };
        const onInputKey = (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                onConfirm();
            } else if (e.key === "Escape") {
                onCancel();
            }
        };
        confirmBtn.addEventListener("click", onConfirm);
        cancelBtn.addEventListener("click", onCancel);
        overlay.addEventListener("click", onOverlay);
        if (options.input) inputEl.addEventListener("keydown", onInputKey);
    });
}

function showConfirmDialog(title, body, options) {
    return pageDialog(title, body, Object.assign({}, options, { input: false }));
}

function showPromptDialog(title, body, options) {
    return pageDialog(title, body, Object.assign({}, options, { input: true }));
}

// 2026-06-23：重命名密钥。
async function renameKey(keyId, currentName, keyPrefix) {
    const label = keyPrefix || currentName || "未命名";
    const newName = await showPromptDialog(
        "重命名密钥",
        `为 <code>${esc(label)}</code> 起个新名称：`,
        {
            defaultValue: currentName || "",
            placeholder: "例如：my-project",
            confirmText: "保存",
            cancelText: "取消",
        },
    );
    if (newName === null) return;
    if (newName === currentName) return;
    try {
        const session = await getSession();
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__,
            },
            body: JSON.stringify({
                endpoint: "api_update_key",
                key_id: keyId,
                name: newName,
                __auth_token: session.access_token,
            }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.ok) {
            showMsg("密钥已重命名", false);
            await loadData();
            if (currentDetailKeyId === keyId) {
                document.getElementById("key-detail-title").textContent = "密钥详情：" + newName;
            }
        } else {
            showMsg("重命名失败：" + (data.message || data.error || resp.status), true);
        }
    } catch (e) {
        showMsg("网络错误", true);
    }
}

// 2026-05-23：Key 详情面板逻辑
async function openKeyDetail(keyId, keyName) {
    currentDetailKeyId = keyId;
    const panel = document.getElementById("key-detail-panel");
    document.getElementById("key-detail-title").textContent = "密钥详情：" + keyName;
    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    // 重置内容
    ["kd-calls", "kd-tin", "kd-tout", "kd-err"].forEach((id) => {
        document.getElementById(id).textContent = "…";
    });
    document.getElementById("kd-by-model").innerHTML = '<div style="color:var(--text-mute);padding:6px;">加载中…</div>';
    document.getElementById("kd-by-day").innerHTML = '<div style="color:var(--text-mute);padding:6px;">加载中…</div>';
    document.getElementById("kd-detail-list").innerHTML = '<div style="color:var(--text-mute);padding:14px;text-align:center;">加载中…</div>';
    document.getElementById("kd-msg").style.display = "none";

    const session = await getSession();
    const resp = await fetch(GW, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: window.__SUPABASE_ANON_KEY__,
        },
        body: JSON.stringify({
            endpoint: "api_my_key_usage",
            key_id: keyId,
            since_ms: 7 * 86400 * 1000,
            limit: 100,
            __auth_token: session.access_token,
        }),
    });
    if (!resp.ok) {
        document.getElementById("kd-detail-list").innerHTML = '<div style="color:var(--err);padding:14px;text-align:center;">加载失败</div>';
        return;
    }
    const data = await resp.json();
    const stats = data.stats || {};
    document.getElementById("kd-calls").textContent = (stats.total_calls || 0).toLocaleString();
    document.getElementById("kd-tin").textContent = (stats.total_tokens_in || 0).toLocaleString();
    document.getElementById("kd-tout").textContent = (stats.total_tokens_out || 0).toLocaleString();
    document.getElementById("kd-err").textContent = (stats.error_calls || 0).toLocaleString();

    // by_model
    const byModel = Array.isArray(data.by_model) ? data.by_model.slice(0, 10) : [];
    const maxMC = byModel.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    document.getElementById("kd-by-model").innerHTML = byModel.length === 0
        ? '<div style="color:var(--text-mute);padding:6px;">无数据</div>'
        : byModel.map((m) => {
            const pct = Math.round((m.count / maxMC) * 100);
            return `<div class="kd-bar">
                <div class="kd-bar__top"><span class="kd-bar__name">${esc(m.model)}</span><span class="kd-bar__stat">${m.count} 次 · ${(m.tokens_in + m.tokens_out).toLocaleString()} tok</span></div>
                <div class="kd-bar__track"><div class="kd-bar__fill model" style="width:${pct}%"></div></div>
            </div>`;
        }).join("");

    // by_day
    const byDay = Array.isArray(data.by_day) ? data.by_day : [];
    const maxDC = byDay.reduce((m, r) => Math.max(m, r.count), 0) || 1;
    document.getElementById("kd-by-day").innerHTML = byDay.length === 0
        ? '<div style="color:var(--text-mute);padding:6px;">无数据</div>'
        : byDay.map((d) => {
            const pct = Math.round((d.count / maxDC) * 100);
            return `<div class="kd-bar">
                <div class="kd-bar__top"><span class="kd-bar__name">${esc(d.day_utc8)}</span><span class="kd-bar__stat">${d.count} 次 · ${(d.tokens_in + d.tokens_out).toLocaleString()} tok</span></div>
                <div class="kd-bar__track"><div class="kd-bar__fill day" style="width:${pct}%"></div></div>
            </div>`;
        }).join("");

    // detail rows
    const detail = Array.isArray(data.usage) ? data.usage : [];
    document.getElementById("kd-detail-list").innerHTML = detail.length === 0
        ? '<div style="color:var(--text-mute);padding:14px;text-align:center;">该窗口内无调用记录</div>'
        : detail.map((u) => {
            const sc = u.status_code || 0;
            const scCls = sc >= 500 ? "err" : sc >= 400 ? "warn" : "ok";
            return `<div class="kd-detail-row">
                <div class="model">${esc(u.model || "—")}</div>
                <div class="tok">${((u.tokens_in || 0) + (u.tokens_out || 0)).toLocaleString()}<div style="font-size:10px;color:var(--text-faint)">↓${(u.tokens_in||0).toLocaleString()} ↑${(u.tokens_out||0).toLocaleString()}</div></div>
                <div class="sc ${scCls}">${sc}</div>
                <div class="when">${new Date(u.created_at).toLocaleString("zh-CN", { hour12: false })}</div>
            </div>`;
        }).join("");

    // 编辑限额：把 key_data 当前值填进 form
    const keyData = data.key_data || {};
    const wl = Array.isArray(keyData.model_whitelist) ? keyData.model_whitelist : [];
    const editSel = document.getElementById("kd-edit-models");
    Array.from(editSel.options).forEach((opt) => {
        opt.selected = wl.includes(opt.value);
    });
    document.getElementById("kd-edit-max-tokens").value = keyData.max_total_tokens || "";
    document.getElementById("kd-edit-max-requests").value = keyData.max_request_count || "";
    document.getElementById("kd-edit-rpm").value = keyData.rpm_limit || "";
}

function closeKeyDetail() {
    document.getElementById("key-detail-panel").style.display = "none";
    currentDetailKeyId = "";
}

async function saveKeyLimits() {
    if (!currentDetailKeyId) return;
    const wl = Array.from(
        document.getElementById("kd-edit-models").selectedOptions,
    ).map((o) => o.value);
    const maxTok = document.getElementById("kd-edit-max-tokens").value.trim();
    const maxReq = document.getElementById("kd-edit-max-requests").value.trim();
    const rpm = document.getElementById("kd-edit-rpm").value.trim();

    const session = await getSession();
    const resp = await fetch(GW, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: window.__SUPABASE_ANON_KEY__,
        },
        body: JSON.stringify({
            endpoint: "api_update_key",
            key_id: currentDetailKeyId,
            model_whitelist: wl,
            max_total_tokens: maxTok ? Number(maxTok) : null,
            max_request_count: maxReq ? Number(maxReq) : null,
            rpm_limit: rpm ? Number(rpm) : null,
            __auth_token: session.access_token,
        }),
    });
    const data = await resp.json().catch(() => ({}));
    const msgEl = document.getElementById("kd-msg");
    if (resp.ok && data.ok) {
        msgEl.textContent = "已保存";
        msgEl.className = "msg ok";
        msgEl.style.display = "block";
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
        await loadData();
    } else {
        msgEl.textContent = "保存失败：" + (data.message || resp.status);
        msgEl.className = "msg err";
        msgEl.style.display = "block";
    }
}

async function resetKeyUsage() {
    if (!currentDetailKeyId) return;
    const confirmed = await showConfirmDialog(
        "重置已用计数",
        "确认重置此密钥的已用 token 与调用次数到 0？此操作不影响历史调用日志。",
        { danger: true, confirmText: "重置", cancelText: "取消" },
    );
    if (!confirmed) return;
    const session = await getSession();
    const resp = await fetch(GW, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: window.__SUPABASE_ANON_KEY__,
        },
        body: JSON.stringify({
            endpoint: "api_update_key",
            key_id: currentDetailKeyId,
            reset_usage: true,
            __auth_token: session.access_token,
        }),
    });
    const data = await resp.json().catch(() => ({}));
    const msgEl = document.getElementById("kd-msg");
    if (resp.ok && data.ok) {
        msgEl.textContent = "已重置已用计数";
        msgEl.className = "msg ok";
        msgEl.style.display = "block";
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
        await loadData();
        await openKeyDetail(currentDetailKeyId, document.getElementById("key-detail-title").textContent.replace("密钥详情：", ""));
    } else {
        msgEl.textContent = "重置失败：" + (data.message || resp.status);
        msgEl.className = "msg err";
        msgEl.style.display = "block";
    }
}

// 绑定 UI 监听器（替代原 inline onclick="..." 属性，因为 CSP 删除 'unsafe-inline'
// 后这些 inline handler 会被浏览器拒绝执行）。
function bindUI() {
    const applyBtn = document.getElementById("apply-redirect-btn");
    if (applyBtn) {
        applyBtn.addEventListener("click", () => {
            location.href = "./api_apply.html";
        });
    }
    const genBtn = document.getElementById("generate-key-btn");
    if (genBtn) {
        genBtn.addEventListener("click", generateKey);
    }
    const keyNameInput = document.getElementById("key-name");
    if (keyNameInput) {
        keyNameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                generateKey();
            }
        });
    }
    const copyBtn = document.getElementById("copy-key-btn");
    if (copyBtn) {
        copyBtn.addEventListener("click", copyKey);
    }
    const renameBtn = document.getElementById("rename-key-btn");
    if (renameBtn) {
        renameBtn.addEventListener("click", showNewKeyRename);
    }
    const saveNewNameBtn = document.getElementById("save-new-key-name-btn");
    if (saveNewNameBtn) {
        saveNewNameBtn.addEventListener("click", saveNewKeyName);
    }
    const newKeyRenameInput = document.getElementById("new-key-rename-input");
    if (newKeyRenameInput) {
        newKeyRenameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                saveNewKeyName();
            }
        });
    }
    // 委托监听器用于 renderKeys() 动态渲染出来的「撤销」/「详情」/「重命名」按钮：
    // 原 inline onclick="deleteKey('id', 'prefix')" 在字符串拼接的 innerHTML 里，
    // CSP 不允许 inline event handler 时同样被拒；改用 data-action 属性 + 单一委托。
    const keysList = document.getElementById("keys-list");
    if (keysList) {
        keysList.addEventListener("click", (e) => {
            const delBtn = e.target.closest('[data-action="delete-key"]');
            if (delBtn) {
                deleteKey(
                    delBtn.getAttribute("data-key-id"),
                    delBtn.getAttribute("data-key-prefix"),
                );
                return;
            }
            const detBtn = e.target.closest('[data-action="detail-key"]');
            if (detBtn) {
                openKeyDetail(
                    detBtn.getAttribute("data-key-id"),
                    detBtn.getAttribute("data-key-name"),
                );
                return;
            }
            const renBtn = e.target.closest('[data-action="rename-key"]');
            if (renBtn) {
                renameKey(
                    renBtn.getAttribute("data-key-id"),
                    renBtn.getAttribute("data-key-name"),
                    renBtn.getAttribute("data-key-prefix"),
                );
                return;
            }
        });
    }
    const closeBtn = document.getElementById("key-detail-close");
    if (closeBtn) closeBtn.addEventListener("click", closeKeyDetail);
    const saveBtn = document.getElementById("kd-save");
    if (saveBtn) saveBtn.addEventListener("click", saveKeyLimits);
    const resetBtn = document.getElementById("kd-reset-usage");
    if (resetBtn) resetBtn.addEventListener("click", resetKeyUsage);
    const refreshBtn = document.getElementById("usage-refresh-btn");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            refreshBtn.disabled = true;
            loadUsage().finally(() => {
                refreshBtn.disabled = false;
            });
        });
    }
    const logRefreshBtn = document.getElementById("api-log-refresh-btn");
    if (logRefreshBtn) {
        logRefreshBtn.addEventListener("click", () => {
            logRefreshBtn.disabled = true;
            loadApiLog().finally(() => {
                logRefreshBtn.disabled = false;
            });
        });
    }
    const generateForm = document.getElementById("generate-key-form");
    if (generateForm) {
        generateForm.addEventListener("submit", (e) => {
            e.preventDefault();
            return false;
        });
    }
}

bindUI();
init();
