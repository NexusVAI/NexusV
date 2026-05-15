// orders.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// orders.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
// 本页原 inline 代码已使用 addEventListener / data-copy 委托，无 inline onclick。

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
const GW =
    window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";

async function getSession() {
    const {
        data: { session },
    } = await sb.auth.getSession();
    return session;
}

function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
}

async function callGateway(endpoint, payload) {
    const session = await getSession();
    if (!session) throw new Error("not_logged_in");
    const resp = await fetch(GW, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({ endpoint, ...payload }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok)
        throw Object.assign(new Error(data.error || resp.statusText), {
            status: resp.status,
            body: data,
        });
    return data;
}

function showMsg(el, text, kind) {
    el.innerHTML =
        '<div class="alert alert-' +
        (kind || "info") +
        '">' +
        text +
        "</div>";
}

function renderSubscription(sub) {
    const badge = document.getElementById("sub-badge");
    const title = document.getElementById("sub-title");
    const desc = document.getElementById("sub-desc");
    if (sub && sub.tier === "paid" && sub.days_remaining > 0) {
        badge.className = "badge-tier paid";
        badge.textContent = "PAID";
        title.textContent = "付费会员";
        const exp = sub.expires_at
            ? new Date(sub.expires_at).toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
              })
            : "—";
        const renewHint =
            sub.days_remaining <= 7
                ? '<strong style="color:#f59e0b">即将到期，建议续费</strong> · '
                : "";
        desc.innerHTML =
            renewHint +
            "到期时间：" +
            esc(exp) +
            " · 剩余 " +
            sub.days_remaining +
            " 天";
    } else {
        badge.className = "badge-tier free";
        badge.textContent = "FREE";
        title.textContent = "免费档";
        desc.textContent =
            "高峰期可能要排队，单模型最多 3 个免费用户同时使用。";
    }
}

function renderOrders(orders) {
    const empty = document.getElementById("orders-empty");
    const wrap = document.getElementById("orders-wrap");
    const tbody = document.getElementById("orders-rows");
    if (!orders || orders.length === 0) {
        empty.style.display = "block";
        wrap.style.display = "none";
        return;
    }
    empty.style.display = "none";
    wrap.style.display = "block";
    tbody.innerHTML = orders
        .map((o) => {
            const created = new Date(o.created_at).toLocaleString(
                "zh-CN",
                { hour12: false },
            );
            const statusPill =
                '<span class="status-pill ' +
                esc(o.status) +
                '">' +
                esc(o.status_label || o.status) +
                "</span>";
            const code =
                o.activation_code && o.status === "approved"
                    ? '<span class="code-cell"><code>' +
                      esc(o.activation_code) +
                      "</code> <button class=\"btn btn-secondary\" data-copy=\"" +
                      esc(o.activation_code) +
                      '" style="padding:3px 10px;font-size:11px">复制</button></span>'
                    : o.activation_code && o.status === "activated"
                    ? '<span class="code-cell"><code style="opacity:.5">' +
                      esc(o.activation_code) +
                      "</code></span>"
                    : '<span style="color:var(--text-faint)">—</span>';
            const note = o.admin_note
                ? esc(o.admin_note)
                : '<span style="color:var(--text-faint)">—</span>';
            return (
                "<tr><td>" +
                esc(created) +
                "</td><td>¥" +
                esc(o.amount_cny) +
                "</td><td>" +
                statusPill +
                "</td><td>" +
                code +
                "</td><td class=\"muted\">" +
                note +
                "</td></tr>"
            );
        })
        .join("");

    tbody.querySelectorAll("[data-copy]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const code = btn.getAttribute("data-copy");
            navigator.clipboard.writeText(code).then(() => {
                btn.textContent = "已复制";
                setTimeout(() => (btn.textContent = "复制"), 1500);
            });
        });
    });
}

async function loadAll() {
    const data = await callGateway("list_my_orders", {});
    renderSubscription(data.subscription);
    renderOrders(data.orders || []);
}

document
    .getElementById("activate-form")
    .addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("activate-submit");
        const msg = document.getElementById("activate-msg");
        btn.disabled = true;
        btn.textContent = "兑换中…";
        msg.innerHTML = "";
        try {
            const code = document
                .getElementById("activate-code")
                .value.trim()
                .toUpperCase();
            const r = await callGateway("activate_order_code", {
                code,
            });
            const exp = r.expires_at
                ? new Date(r.expires_at).toLocaleString("zh-CN", {
                      hour12: false,
                  })
                : "—";
            showMsg(
                msg,
                "✅ 激活成功！您已是付费会员，到期时间 <code>" +
                    esc(exp) +
                    "</code>",
                "ok",
            );
            document.getElementById("activate-code").value = "";
            await loadAll();
        } catch (err) {
            const m =
                (err.body &&
                    (err.body.message || err.body.error)) ||
                err.message ||
                "兑换失败";
            showMsg(msg, "❌ " + esc(m), "warn");
        } finally {
            btn.disabled = false;
            btn.textContent = "兑换";
        }
    });

async function init() {
    const loading = document.getElementById("loading");
    const gate = document.getElementById("login-gate");
    const main = document.getElementById("main-section");
    const {
        data: { user },
    } = await sb.auth.getUser();
    loading.style.display = "none";
    if (!user || user.is_anonymous) {
        gate.style.display = "block";
        return;
    }
    main.style.display = "block";
    try {
        await loadAll();
    } catch (e) {
        console.error("loadAll:", e);
    }
}

// Uppercase the activation code as the user types
document
    .getElementById("activate-code")
    .addEventListener("input", (e) => {
        e.target.value = e.target.value.toUpperCase();
    });

init();
