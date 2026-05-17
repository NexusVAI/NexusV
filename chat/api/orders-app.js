// orders.html 的页面逻辑。
//
// 2026-05-17 Phase A 改版：
//   • 渲染 plan_code badge（PRO / PRO+ / PRO MAX 三色）
//   • 月度配额进度条（monthly_consumed / monthly_quota）
//   • 加油包余额（topup_balance）
//   • 订单列表加"类型 / 规格"列（订阅 vs 加油包，pro/pro_plus/pro_max 或 topup_*）
//   • 激活成功时按 order_kind 显示不同提示
//
// 后端 list_my_orders 返回的 subscription 已包含新字段：
//   plan_code / monthly_quota / monthly_consumed / monthly_remaining / topup_balance
// 订单行包含 order_kind / plan_code / topup_sku / topup_tokens / spec_label

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

const PLAN_LABEL = {
    pro: "PRO",
    pro_plus: "PRO+",
    pro_max: "PRO MAX",
};
const PLAN_DESC = {
    pro: "月度配额 2000 万 token，解锁非 Opus 全模型",
    pro_plus: "月度配额 8000 万 token，解锁 Claude Opus 全系",
    pro_max: "月度配额 3 亿 token，全部模型 + 视频图像优先",
};

async function getSession() {
    const { data: { session } } = await sb.auth.getSession();
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
        '<div class="alert alert-' + (kind || "info") + '">' + text + "</div>";
}

// 格式化 token 数为可读字符串（万 / 亿）
function formatTokens(n) {
    n = Number(n || 0);
    if (n >= 100000000) return (n / 100000000).toFixed(2).replace(/\.?0+$/, "") + " 亿";
    if (n >= 10000) return Math.round(n / 10000) + " 万";
    return n.toLocaleString();
}

// ────────── 订阅状态卡 ──────────
function renderSubscription(sub) {
    const badge = document.getElementById("sub-badge");
    const title = document.getElementById("sub-title");
    const desc = document.getElementById("sub-desc");
    const upgradeBtn = document.getElementById("upgrade-btn");
    const quotaMonthlyText = document.getElementById("quota-monthly-text");
    const quotaMonthlyFill = document.getElementById("quota-monthly-fill");
    const quotaMonthlyHint = document.getElementById("quota-monthly-hint");
    const quotaTopupText = document.getElementById("quota-topup-text");
    const monthlyBox = document.getElementById("quota-monthly");

    const isPaid = sub && sub.tier === "paid" && sub.days_remaining > 0;
    const plan = (sub && sub.plan_code) || (isPaid ? "pro" : null);

    if (isPaid) {
        badge.className = "badge-tier " + plan;
        badge.textContent = PLAN_LABEL[plan] || "PAID";
        title.textContent = plan === "pro_max" ? "Pro Max 会员"
                          : plan === "pro_plus" ? "Pro+ 会员"
                          : "Pro 会员";
        const exp = sub.expires_at
            ? new Date(sub.expires_at).toLocaleString("zh-CN", {
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit",
              })
            : "—";
        const renewHint = sub.days_remaining <= 7
            ? '<strong style="color:#f59e0b">即将到期，建议续费</strong> · '
            : "";
        desc.innerHTML =
            renewHint + (PLAN_DESC[plan] || "") +
            "<br>到期：" + esc(exp) + " · 剩余 " + sub.days_remaining + " 天";
        if (upgradeBtn) {
            upgradeBtn.textContent = plan === "pro_max" ? "续费 / 加油包 →" : "升级 / 续费 →";
        }
    } else {
        badge.className = "badge-tier free";
        badge.textContent = "FREE";
        title.textContent = "免费档";
        desc.textContent = "高峰期可能要排队，每日 PAID 模型试用 15 次。VIP 模型（Opus 等）需 Pro+。";
        if (upgradeBtn) upgradeBtn.textContent = "升级套餐 →";
    }

    // 月度配额进度条（仅 paid 用户显示真实数据；free 用户显示 0/0 提示）
    const quota = Number((sub && sub.monthly_quota) || 0);
    const consumed = Number((sub && sub.monthly_consumed) || 0);
    const topup = Number((sub && sub.topup_balance) || 0);

    if (isPaid && quota > 0) {
        const percent = Math.min(Math.round((consumed / quota) * 100), 100);
        quotaMonthlyText.textContent =
            formatTokens(consumed) + " / " + formatTokens(quota) + " (" + percent + "%)";
        quotaMonthlyFill.style.width = percent + "%";
        quotaMonthlyFill.className = "quota-bar__fill" +
            (percent >= 90 ? " danger" : percent >= 75 ? " warn" : "");
        quotaMonthlyHint.textContent = percent >= 90
            ? "配额即将耗尽，可购买加油包或升级到更高档位。"
            : "每月 UTC+8 1 号 00:00 自动重置。";
        if (monthlyBox) monthlyBox.style.display = "";
    } else {
        // free 用户：隐藏月度配额块（free 用户用的是全站共享池，不是个人月度）
        if (monthlyBox) monthlyBox.style.display = "none";
    }

    // 加油包余额（所有用户都显示）
    quotaTopupText.textContent = topup > 0
        ? formatTokens(topup) + " token"
        : "0";
}

// ────────── 订单列表 ──────────
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
            const created = new Date(o.created_at).toLocaleString("zh-CN", { hour12: false });
            const kindLabel = o.order_kind_label || (o.order_kind === "topup" ? "加油包" : "订阅");
            const specLabel = o.spec_label || "—";
            const typeCell =
                '<div style="font-size:12.5px">' +
                    '<strong>' + esc(kindLabel) + '</strong>' +
                    '<div style="color:var(--text-mute);font-size:11.5px;margin-top:2px">' + esc(specLabel) + '</div>' +
                '</div>';
            const statusPill =
                '<span class="status-pill ' + esc(o.status) + '">' +
                esc(o.status_label || o.status) + "</span>";
            const code =
                o.activation_code && o.status === "approved"
                    ? '<span class="code-cell"><code>' + esc(o.activation_code) +
                      "</code> <button class=\"btn btn-secondary\" data-copy=\"" +
                      esc(o.activation_code) +
                      '" style="padding:3px 10px;font-size:11px">复制</button></span>'
                    : o.activation_code && o.status === "activated"
                    ? '<span class="code-cell"><code style="opacity:.5">' +
                      esc(o.activation_code) + "</code></span>"
                    : '<span style="color:var(--text-faint)">—</span>';
            const note = o.admin_note
                ? esc(o.admin_note)
                : '<span style="color:var(--text-faint)">—</span>';
            return (
                "<tr><td>" + esc(created) +
                "</td><td>" + typeCell +
                "</td><td>¥" + esc(o.amount_cny) +
                "</td><td>" + statusPill +
                "</td><td>" + code +
                "</td><td class=\"muted\">" + note +
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

// ────────── 兑换激活码 ──────────
document.getElementById("activate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("activate-submit");
    const msg = document.getElementById("activate-msg");
    btn.disabled = true;
    btn.textContent = "兑换中…";
    msg.innerHTML = "";
    try {
        const code = document.getElementById("activate-code").value.trim().toUpperCase();
        const r = await callGateway("activate_order_code", { code });
        let successMsg;
        if (r.order_kind === "topup") {
            successMsg =
                "✅ 加油包激活成功！本次到账 <strong>" + formatTokens(r.topup_tokens) +
                " token</strong>，当前余额 <strong>" + formatTokens(r.topup_balance_after) +
                " token</strong>。永不过期。";
        } else {
            const planLabel = PLAN_LABEL[r.plan_code] || "PAID";
            const exp = r.expires_at
                ? new Date(r.expires_at).toLocaleString("zh-CN", { hour12: false })
                : "—";
            successMsg =
                "✅ 激活成功！您已是 <strong>" + esc(planLabel) +
                "</strong> 会员，月度配额 <strong>" + formatTokens(r.monthly_quota) +
                " token</strong>，到期时间 <code>" + esc(exp) + "</code>";
        }
        showMsg(msg, successMsg, "ok");
        document.getElementById("activate-code").value = "";
        await loadAll();
    } catch (err) {
        const m = (err.body && (err.body.message || err.body.error)) ||
                  err.message || "兑换失败";
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
    const { data: { user } } = await sb.auth.getUser();
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

// 兑换码输入框自动大写
document.getElementById("activate-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
});

init();
