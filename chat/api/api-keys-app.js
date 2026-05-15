// api_keys.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_keys.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js 同款做法：
//   1. inline <script> -> 外联 .js
//   2. inline onclick="..." -> addEventListener
//   3. innerHTML 字符串里 onclick="deleteKey(...)" -> data-action 委托监听器
//   4. CSP <meta> 删 script-src 'unsafe-inline'

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
let currentKeys = [];

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
    const resp = await fetch(GW, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({ endpoint: "api_my_keys" }),
    });
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

function renderKeys() {
    const el = document.getElementById("keys-list");
    if (currentKeys.length === 0) {
        el.innerHTML =
            '<div class="empty">暂无 Key，请点击上方生成。</div>';
        return;
    }
    el.innerHTML = currentKeys
        .map((k) => {
            const lastUsed = k.last_used_at
                ? new Date(k.last_used_at).toLocaleString("zh-CN")
                : "从未使用";
            return (
                '<div class="key-row"><div class="key-info"><div class="key-name">' +
                esc(k.name) +
                ' <span class="key-tier">(' +
                k.tier +
                ')</span></div><div class="key-prefix">' +
                esc(k.key_prefix) +
                '</div><div class="key-meta">创建：' +
                new Date(k.created_at).toLocaleDateString("zh-CN") +
                " | 最后使用：" +
                lastUsed +
                '</div></div><div class="key-actions"><button class="btn btn-danger" data-action="delete-key" data-key-id="' +
                esc(k.id) +
                '" data-key-prefix="' +
                esc(k.key_prefix) +
                '" title="撤销此 Key">撤销</button></div></div>'
            );
        })
        .join("");
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
                Authorization: "Bearer " + session.access_token,
            },
            body: JSON.stringify({
                endpoint: "api_delete_key",
                key_id: keyId,
            }),
        });
        const data = await resp.json();
        if (resp.ok && data.ok) {
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
                Authorization: "Bearer " + session.access_token,
            },
            body: JSON.stringify({ endpoint: "api_my_usage" }),
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
    // 原 inline onclick 依赖全局 `event`；addEventListener 给我们显式 event 参数，
    // 用 currentTarget 拿到绑定监听器的按钮（非冒泡命中元素），等价但更安全。
    const btn =
        (ev && ev.currentTarget) ||
        document.getElementById("generate-key-btn");
    btn.disabled = true;
    btn.textContent = "生成中...";
    try {
        const session = await getSession();
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + session.access_token,
            },
            body: JSON.stringify({
                endpoint: "api_generate_key",
                name,
            }),
        });
        const data = await resp.json();
        if (resp.ok && data.key) {
            document.getElementById("new-key-value").textContent =
                data.key;
            document.getElementById("new-key-box").style.display =
                "block";
            showMsg("Key 生成成功！", false);
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
    // 委托监听器用于 renderKeys() 动态渲染出来的「撤销」按钮：
    // 原 inline onclick="deleteKey('id', 'prefix')" 在字符串拼接的 innerHTML 里，
    // CSP 不允许 inline event handler 时同样被拒；改用 data-action 属性 + 单一委托。
    const keysList = document.getElementById("keys-list");
    if (keysList) {
        keysList.addEventListener("click", (e) => {
            const btn = e.target.closest('[data-action="delete-key"]');
            if (!btn) return;
            deleteKey(
                btn.getAttribute("data-key-id"),
                btn.getAttribute("data-key-prefix"),
            );
        });
    }
}

bindUI();
init();
