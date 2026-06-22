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

// 2026-05-29 积分化：统一走 window.CancriCredits（cancri_credits.js 先加载）。
// 兜底：按 1 积分 = 1 万 token 本地降级，避免订单页崩。
const CC = window.CancriCredits || {
    num: function (t) {
        const c = (Number(t) || 0) / 10000;
        return c >= 100 ? Math.round(c).toLocaleString("en-US")
            : String(Math.round(c * 10) / 10);
    },
};

const PLAN_LABEL = {
    pro: "PRO",
    pro_plus: "PRO+",
    pro_max: "PRO MAX",
};
const PLAN_DESC = {
    pro: "月度配额 2000 积分，解锁非 Opus 全模型",
    pro_plus: "月度配额 8000 积分，解锁 Claude Opus 全系",
    pro_max: "月度配额 30000 积分，全部模型 + 视频图像优先",
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
            apikey: window.__SUPABASE_ANON_KEY__,
        },
        body: JSON.stringify({ endpoint, ...(payload || {}), __auth_token: session.access_token }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok)
        throw Object.assign(new Error(data.error || resp.statusText), {
            status: resp.status,
            body: data,
        });
    return data;
}

function showMsg(el, text, kind, opts) {
    // 默认把 text 当纯文本转义，杜绝调用方忘记 esc() 造成 HTML 注入。
    // 需要富文本（<code>/<strong>）的调用方显式传 { html: true }，
    // 并自行 esc() 其中的动态片段。
    const body = (opts && opts.html)
        ? String(text == null ? "" : text)
        : esc(String(text == null ? "" : text));
    el.innerHTML =
        '<div class="alert alert-' + esc(kind || "info") + '">' + body + "</div>";
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
            CC.num(consumed) + " / " + CC.num(quota) + " 积分 (" + percent + "%)";
        quotaMonthlyFill.style.width = percent + "%";
        quotaMonthlyFill.className = "quota-bar__fill" +
            (percent >= 90 ? " danger" : percent >= 75 ? " warn" : "");
        quotaMonthlyHint.textContent = percent >= 90
            ? "配额即将耗尽，可购买加油包或升级到更高档位。"
            : "每 30 天订阅周期自动重置。";
        if (monthlyBox) monthlyBox.style.display = "";
    } else {
        // free 用户：隐藏月度配额块（free 用户用的是全站共享池，不是个人月度）
        if (monthlyBox) monthlyBox.style.display = "none";
    }

    // 加油包余额（所有用户都显示）
    quotaTopupText.textContent = topup > 0
        ? CC.num(topup) + " 积分"
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
    // 2026-06-22 按量计费：wallet_v3 模式下渲染¥钱包余额而非订阅配额。
    const billingMode = data.billing_mode || (data.subscription && data.subscription.billing_mode) || "quota_v2";
    if (billingMode === "wallet_v3" && data.wallet) {
        renderWalletBalance(data.wallet);
    } else {
        renderSubscription(data.subscription);
    }
    renderOrders(data.orders || []);
}

// ────────── 2026-06-22 ¥钱包余额卡（wallet_v3）──────────
function renderWalletBalance(wallet) {
    const badge = document.getElementById("sub-badge");
    const title = document.getElementById("sub-title");
    const desc = document.getElementById("sub-desc");
    const quotaTopupText = document.getElementById("quota-topup-text");
    const monthlyBox = document.getElementById("quota-monthly");
    const quotaMonthlyText = document.getElementById("quota-monthly-text");
    if (badge) { badge.className = "badge-tier pro_max"; badge.textContent = "WALLET"; }
    if (title) title.textContent = "按量充值账户";
    const bal = Number(wallet.balance_cny || 0).toFixed(2);
    const cum = Number(wallet.cumulative_recharge_cny || 0).toFixed(2);
    const tier = wallet.tier || 0;
    if (desc) desc.innerHTML = "累计充值 ¥" + esc(cum) + " · 限速档位 Tier" + esc(String(tier));
    if (quotaTopupText) quotaTopupText.textContent = "¥" + bal;
    if (monthlyBox) monthlyBox.style.display = "none";
    if (quotaMonthlyText) quotaMonthlyText.textContent = "—";
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
                "✅ 加油包激活成功！本次到账 <strong>" + CC.num(r.topup_tokens) +
                " 积分</strong>，当前余额 <strong>" + CC.num(r.topup_balance_after) +
                " 积分</strong>。永不过期。";
        } else {
            const planLabel = PLAN_LABEL[r.plan_code] || "PAID";
            const exp = r.expires_at
                ? new Date(r.expires_at).toLocaleString("zh-CN", { hour12: false })
                : "—";
            successMsg =
                "✅ 激活成功！您已是 <strong>" + esc(planLabel) +
                "</strong> 会员，月度配额 <strong>" + CC.num(r.monthly_quota) +
                " 积分</strong>，到期时间 <code>" + esc(exp) + "</code>";
        }
        showMsg(msg, successMsg, "ok", { html: true });
        document.getElementById("activate-code").value = "";
        await loadAll();
    } catch (err) {
        const m = (err.body && (err.body.message || err.body.error)) ||
                  err.message || "兑换失败";
        // m 走 showMsg 默认转义，无需再 esc()。
        showMsg(msg, "❌ " + m, "warn");
    } finally {
        btn.disabled = false;
        btn.textContent = "兑换";
    }
});

async function init() {
    const loading = document.getElementById("loading");
    const gate = document.getElementById("login-gate");
    const main = document.getElementById("main-section");
    const loadErr = document.getElementById("orders-load-error");
    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session || !session.user || session.user.is_anonymous) {
            if (window.PlatformSkeleton) PlatformSkeleton.hide(loading);
            else if (loading) loading.style.display = "none";
            if (gate) gate.style.display = "block";
            return;
        }
        if (main) main.style.display = "block";
        await loadAll();
    } catch (e) {
        console.error("orders init:", e);
        if (main) main.style.display = "block";
        if (loadErr) {
            loadErr.style.display = "block";
            loadErr.textContent =
                "订单加载失败：" +
                ((e.body && (e.body.message || e.body.error)) || e.message || "请刷新重试");
        } else {
            showMsg(document.getElementById("activate-msg"), "订单加载失败，请刷新页面。", "warn");
        }
    } finally {
        if (window.PlatformSkeleton) PlatformSkeleton.hide(loading);
        else if (loading) loading.style.display = "none";
    }
}

// 兑换码输入框自动大写
document.getElementById("activate-code").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
});

init();
