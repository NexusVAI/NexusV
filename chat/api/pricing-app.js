// pricing.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// pricing.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
// 本页原 inline 代码已使用 addEventListener，无 inline onclick。

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
        '<div class="alert alert-' + (kind || "info") + '">' +
        text +
        "</div>";
}

async function paintTier() {
    const tierEl = document.getElementById("current-tier");
    try {
        const r = await callGateway("get_my_subscription", {});
        const sub = r.subscription || {};
        if (sub.tier === "paid") {
            const days =
                sub.days_remaining > 0
                    ? sub.days_remaining + " 天剩余"
                    : "已过期";
            const exp = sub.expires_at
                ? new Date(sub.expires_at).toLocaleDateString("zh-CN")
                : "—";
            tierEl.innerHTML =
                '<span class="badge-tier paid">PAID</span> ' +
                "<span style=\"font-size:13px;color:var(--text-mute)\">到期 " +
                esc(exp) +
                " · " +
                esc(days) +
                "</span>";
        } else {
            tierEl.innerHTML =
                '<span class="badge-tier free">FREE</span>';
        }
    } catch (e) {
        if (e.message === "not_logged_in") return;
        console.error("paintTier:", e);
    }
}

async function init() {
    const loading = document.getElementById("order-loading");
    const gate = document.getElementById("order-login-gate");
    const form = document.getElementById("order-form-section");

    const {
        data: { user },
    } = await sb.auth.getUser();
    loading.style.display = "none";
    if (!user || user.is_anonymous) {
        gate.style.display = "block";
        return;
    }
    form.style.display = "block";

    // Pre-fill email from user account
    const emailInput = document.getElementById("of-email");
    if (user.email) emailInput.value = user.email;

    await paintTier();
}

document
    .getElementById("order-form")
    .addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("of-submit");
        const msg = document.getElementById("order-msg");
        btn.disabled = true;
        btn.textContent = "提交中…";
        msg.innerHTML = "";
        try {
            const email = document
                .getElementById("of-email")
                .value.trim();
            const qq = document
                .getElementById("of-qq")
                .value.trim();
            const method = document
                .getElementById("of-method")
                .value;
            const r = await callGateway("submit_payment_order", {
                email,
                qq,
                method,
            });
            showMsg(
                msg,
                "✅ 订单已提交，订单号 <code>" +
                    esc(r.order && r.order.id) +
                    "</code>。请耐心等待管理员审核，审核结果会出现在 <a href=\"./orders.html\">我的订单</a>。",
                "ok",
            );
            document.getElementById("of-qq").value = "";
        } catch (err) {
            const m =
                (err.body &&
                    (err.body.message || err.body.error)) ||
                err.message ||
                "提交失败";
            showMsg(msg, "❌ " + esc(m), "warn");
        } finally {
            btn.disabled = false;
            btn.textContent = "提交订单";
        }
    });

init();
