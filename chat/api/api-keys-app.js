// api_keys.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_keys.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js 同款做法：
//   1. inline <script> -> 外联 .js
//   2. inline onclick="..." -> addEventListener
//   3. innerHTML 字符串里 onclick="deleteKey(...)" -> data-action 委托监听器
//   4. CSP <meta> 删 script-src 'unsafe-inline'
//
// 2026-05-23：扩展高级限额 (model whitelist / max tokens / max requests / RPM)
// + Key 详情面板 (用量统计 / by_model / by_day / 调用日志 / 编辑限额 / 重置已用)

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
    const {
        data: { user },
    } = await sb.auth.getUser();
    document.getElementById("loading").style.display = "none";
    if (!user || user.is_anonymous) {
        document.getElementById("login-section").style.display = "block";
        return;
    }
    await loadData();
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
        document.getElementById("login-section").style.display = "block";
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
            '<div class="empty">暂无 Key，请点击上方生成。</div>';
        return;
    }
    // 2026-05-17：tier chip 用 effectiveTier（来自 user_subscriptions 权威），
    // 而不是 k.tier（已废弃的 api_keys.tier 列）。所有 key 共享同一 tier。
    const tierLabel = effectiveTier === "paid" ? "PAID" : "FREE";
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
            <button class="btn btn-danger" data-action="delete-key" data-key-id="${esc(k.id)}" data-key-prefix="${esc(k.key_prefix)}" title="撤销此 Key">撤销</button>
        </div>
    </div>`;
}

async function deleteKey(keyId, keyPrefix) {
    if (
        !confirm(
            '确认撤销 Key "' +
                keyPrefix +
                '"？此操作不可恢复，撤销后该 Key 立即失效。',
        )
    )
        return;
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
            showMsg("Key 已撤销。", false);
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

function renderUsage(rows) {
    const chart = document.getElementById("usage-chart");
    const axis = document.getElementById("usage-axis");
    const empty = document.getElementById("usage-empty");
    const byModelEl = document.getElementById("usage-by-model");
    if (!rows.length) {
        chart.innerHTML = "";
        axis.innerHTML = "";
        byModelEl.innerHTML = "";
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
    }
    rows.forEach((r) => {
        const d = new Date(r.created_at);
        const k =
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0");
        if (dayBuckets.has(k)) dayBuckets.set(k, dayBuckets.get(k) + 1);
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

async function generateKey(ev) {
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
            document.getElementById("new-key-box").style.display =
                "block";
            // 2026-05-22：把刚生成的完整 Key 存入 sessionStorage（仅当前会话）。
            // 模型广场抽屉里的「调用代码」会读取此 Key 直接填入示例。
            // 关闭浏览器/标签页后会被自动清空，避免 Key 在磁盘里长期残留。
            // 用户在 Keys 页主动撤销该 Key 时也会清除（见 deleteKey 内部清理）。
            try {
                sessionStorage.setItem("cancri_recent_api_key", data.key);
            } catch (_) {
                // sessionStorage 不可用（如隐私模式）也不影响主流程
            }
            showMsg("Key 生成成功！本会话内已自动同步到模型广场代码示例。", false);
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
    navigator.clipboard.writeText(key).then(() => {
        showMsg("已复制到剪贴板", false);
    });
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

// 2026-05-23：Key 详情面板逻辑
async function openKeyDetail(keyId, keyName) {
    currentDetailKeyId = keyId;
    const panel = document.getElementById("key-detail-panel");
    document.getElementById("key-detail-title").textContent = "Key 详情：" + keyName;
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
        msgEl.textContent = "已保存。";
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
    if (!confirm("确认重置此 Key 的已用 token 与调用次数到 0？此操作不影响历史调用日志。")) return;
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
        msgEl.textContent = "已重置已用计数。";
        msgEl.className = "msg ok";
        msgEl.style.display = "block";
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
        await loadData();
        await openKeyDetail(currentDetailKeyId, document.getElementById("key-detail-title").textContent.replace("Key 详情：", ""));
    } else {
        msgEl.textContent = "重置失败：" + (data.message || resp.status);
        msgEl.className = "msg err";
        msgEl.style.display = "block";
    }
}

// 绑定 UI 监听器（替代原 inline onclick="..." 属性，因为 CSP 删除 'unsafe-inline'
// 后这些 inline handler 会被浏览器拒绝执行）。
function bindUI() {
    const loginBtn = document.getElementById("login-redirect-btn");
    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            location.href = "./";
        });
    }
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
    const copyBtn = document.getElementById("copy-key-btn");
    if (copyBtn) {
        copyBtn.addEventListener("click", copyKey);
    }
    // 委托监听器用于 renderKeys() 动态渲染出来的「撤销」/「详情」按钮：
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
        });
    }
    const closeBtn = document.getElementById("key-detail-close");
    if (closeBtn) closeBtn.addEventListener("click", closeKeyDetail);
    const saveBtn = document.getElementById("kd-save");
    if (saveBtn) saveBtn.addEventListener("click", saveKeyLimits);
    const resetBtn = document.getElementById("kd-reset-usage");
    if (resetBtn) resetBtn.addEventListener("click", resetKeyUsage);
}

bindUI();
init();
