// pricing.html 的页面逻辑。
//
// 2026-05-17 Phase A 改版：
//   • 三档订阅（Pro 9.9 / Pro+ 29 / Pro Max 99）+ 三规格加油包（10 / 50 / 200）
//   • 用户在页面顶部点 plan-tier 或 topup-card → JS 记录 selection → 下方表单展开
//   • submit_payment_order 传 {order_kind, plan_code | topup_sku}，server 端 ORDER_CATALOG
//     决定真实金额，前端传的 amount 一律忽略（防篡改）
//   • 当前订阅 badge 渲染 plan_code（PRO / PRO+ / PRO MAX）和月配额进度
//
// 2026-05-22 限时倍率 5 折促销：
//   • 顶部红色横幅 + 倒计时（与 chat-gateway / api-gateway PROMO_* 常量同窗口）
//   • multiplier-info 卡内 5 个 [data-promo-mult] span 自动渲染折后倍率
//   • 窗口外横幅 hidden 不显示，折后倍率回退为原倍率
//
// 沿用 admin-*-app.js 同款做法：全部 addEventListener，无 inline onclick。

// ────────── 2026-05-22 限时倍率 5 折促销 ──────────
// 必须与后端 chat-gateway.ts / api-gateway.ts 的 PROMO_MULTIPLIER_DISCOUNT_*
// 三个常量完全同步。窗口（UTC+8）：05-22 20:30 → 05-24 00:00。
const PROMO_START_MS = 1779711000000; // 2026-05-22T12:30:00Z
const PROMO_END_MS = 1779840000000;   // 2026-05-23T16:00:00Z
const PROMO_DISCOUNT = 0.5;

function isPromoActive(now) {
    return now >= PROMO_START_MS && now < PROMO_END_MS;
}

function formatHMS(ms) {
    if (ms < 0) ms = 0;
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => (n < 10 ? "0" + n : "" + n);
    return pad(h) + ":" + pad(m) + ":" + pad(s);
}

function formatMultDisplay(n) {
    if (n === Math.round(n)) return n + "x";
    return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "x";
}

function renderPromoMultipliers() {
    // 把 multiplier-info 卡内所有带 data-promo-mult 的 span，
    // 改成「<strike>原倍率</strike> 限时 <promo-now>折后</promo-now>」。
    const nodes = document.querySelectorAll("#multiplier-info [data-promo-mult]");
    nodes.forEach((node) => {
        const base = parseFloat(node.getAttribute("data-promo-mult"));
        if (!Number.isFinite(base) || base <= 0) return;
        const now = base * PROMO_DISCOUNT;
        const code = node.querySelector("code");
        if (!code) return;
        // 用 textContent 拼出原文 "<原>x"，再覆盖整个 code innerHTML，
        // 防止重复渲染时叠加多层 strike + now。
        code.innerHTML =
            '<span class="promo-strike">' + formatMultDisplay(base) + "</span>" +
            '<span class="promo-now">限时 ' + formatMultDisplay(now) + "</span>";
    });
}

function startPromoBanner() {
    const banner = document.getElementById("promo-banner");
    if (!banner) return;
    const countdown = document.getElementById("promo-countdown");
    const closeBtn = document.getElementById("promo-banner-close");
    const tick = () => {
        const now = Date.now();
        if (!isPromoActive(now)) {
            banner.hidden = true;
            return false;
        }
        banner.hidden = false;
        if (countdown) countdown.textContent = formatHMS(PROMO_END_MS - now);
        return true;
    };
    if (!tick()) return;
    renderPromoMultipliers();
    const handle = setInterval(() => {
        if (!tick()) clearInterval(handle);
    }, 1000);
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            banner.hidden = true;
            clearInterval(handle);
        });
    }
}

// 横幅与 supabase 登录无关，DOM 就绪后立即启动。
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startPromoBanner);
} else {
    startPromoBanner();
}

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

// 与后端 ORDER_CATALOG 保持同步。这里只用于前端渲染金额预览；
// 真实金额仍由 server 端写入订单，前端值不可信。
const CLIENT_CATALOG = {
    subscription: {
        pro: { amount: 9.9, label: "Pro", desc: "月 2000 万 token" },
        pro_plus: { amount: 29, label: "Pro+", desc: "月 8000 万 token + Opus" },
        pro_max: { amount: 99, label: "Pro Max", desc: "月 3 亿 token" },
    },
    topup: {
        topup_small: { amount: 10, label: "加油包 ¥10", desc: "1500 万 token" },
        topup_medium: { amount: 50, label: "加油包 ¥50", desc: "9000 万 token" },
        topup_large: { amount: 200, label: "加油包 ¥200", desc: "4 亿 token" },
    },
};

// 当前选中的订单（用户点 plan-tier 或 topup-card 后填充）
let selection = null; // { kind: 'subscription'|'topup', code: 'pro'|...|'topup_small'|... }

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
    if (!resp.ok) {
        throw Object.assign(new Error(data.error || resp.statusText), {
            status: resp.status,
            body: data,
        });
    }
    return data;
}

function showMsg(el, text, kind) {
    el.innerHTML =
        '<div class="alert alert-' + (kind || "info") + '">' + text + "</div>";
}

// ────────── 当前订阅 badge ──────────
function paintTierBadge(subscription) {
    const tierEl = document.getElementById("current-tier");
    if (!subscription || subscription.tier !== "paid") {
        tierEl.innerHTML = '<span class="badge-tier free">FREE</span>';
        return;
    }
    const plan = subscription.plan_code || "pro";
    const planLabel = plan === "pro_plus" ? "PRO+" : (plan === "pro_max" ? "PRO MAX" : "PRO");
    const days = subscription.days_remaining > 0
        ? subscription.days_remaining + " 天剩余"
        : "已过期";
    const exp = subscription.expires_at
        ? new Date(subscription.expires_at).toLocaleDateString("zh-CN")
        : "—";
    tierEl.innerHTML =
        '<span class="badge-tier ' + esc(plan) + '">' + esc(planLabel) + "</span> " +
        '<span style="font-size:13px;color:var(--text-mute);margin-left:8px">' +
        "到期 " + esc(exp) + " · " + esc(days) +
        "</span>";
}

async function loadCurrentSubscription() {
    try {
        const r = await callGateway("get_my_subscription", {});
        paintTierBadge(r.subscription || {});
    } catch (e) {
        if (e.message === "not_logged_in") return;
        console.error("loadCurrentSubscription:", e);
    }
}

// ────────── 选档 / 选加油包 ──────────
function renderSelectedSummary() {
    const card = document.getElementById("selected-summary");
    const qrAmount = document.getElementById("qr-amount");
    const orderEmpty = document.getElementById("order-empty");
    const formSection = document.getElementById("order-form-section");
    if (!selection) {
        if (card) card.innerHTML = "";
        if (qrAmount) qrAmount.textContent = "—";
        if (orderEmpty) orderEmpty.style.display = "block";
        if (formSection) formSection.style.display = "none";
        return;
    }
    const catalog = selection.kind === "subscription"
        ? CLIENT_CATALOG.subscription[selection.code]
        : CLIENT_CATALOG.topup[selection.code];
    if (!catalog) {
        return;
    }
    if (orderEmpty) orderEmpty.style.display = "none";
    if (formSection) formSection.style.display = "block";
    if (qrAmount) qrAmount.textContent = "¥" + catalog.amount;
    if (card) {
        const kindLabel = selection.kind === "subscription" ? "订阅" : "加油包";
        card.innerHTML =
            '<div class="selected-summary__row">' +
                '<span class="selected-summary__label">已选</span>' +
                '<span class="selected-summary__big">' + esc(catalog.label) + "</span>" +
            "</div>" +
            '<div class="selected-summary__row">' +
                '<span class="selected-summary__label">类型</span>' +
                '<span class="selected-summary__value">' + esc(kindLabel) + "</span>" +
            "</div>" +
            '<div class="selected-summary__row">' +
                '<span class="selected-summary__label">规格</span>' +
                '<span class="selected-summary__value">' + esc(catalog.desc) + "</span>" +
            "</div>" +
            '<div class="selected-summary__row">' +
                '<span class="selected-summary__label">应付金额</span>' +
                '<span class="selected-summary__big">¥' + catalog.amount + "</span>" +
            "</div>";
    }
}

function selectPlan(code) {
    if (!CLIENT_CATALOG.subscription[code]) return;
    selection = { kind: "subscription", code };
    highlightSelection();
    renderSelectedSummary();
}

function selectTopup(code) {
    if (!CLIENT_CATALOG.topup[code]) return;
    selection = { kind: "topup", code };
    highlightSelection();
    renderSelectedSummary();
}

function highlightSelection() {
    document.querySelectorAll("[data-plan-select]").forEach((btn) => {
        const isMatch = selection && selection.kind === "subscription" && btn.getAttribute("data-plan-select") === selection.code;
        btn.classList.toggle("btn-primary", isMatch);
        btn.classList.toggle("btn-secondary", !isMatch);
        if (isMatch) {
            btn.textContent = "✓ 已选";
        } else {
            const plan = btn.getAttribute("data-plan-select");
            btn.textContent = "选择 " + (CLIENT_CATALOG.subscription[plan] ? CLIENT_CATALOG.subscription[plan].label : "");
        }
    });
    document.querySelectorAll("[data-topup-select]").forEach((btn) => {
        const isMatch = selection && selection.kind === "topup" && btn.getAttribute("data-topup-select") === selection.code;
        btn.classList.toggle("btn-primary", isMatch);
        btn.classList.toggle("btn-secondary", !isMatch);
        btn.textContent = isMatch ? "✓ 已选" : "选这个";
    });
}

// ────────── 初始化 ──────────
async function init() {
    const loading = document.getElementById("order-loading");
    const gate = document.getElementById("order-login-gate");
    const formSection = document.getElementById("order-form-section");
    const orderEmpty = document.getElementById("order-empty");

    const { data: { user } } = await sb.auth.getUser();
    loading.style.display = "none";
    if (!user || user.is_anonymous) {
        gate.style.display = "block";
        return;
    }

    // 预填邮箱
    const emailInput = document.getElementById("of-email");
    if (user.email) emailInput.value = user.email;

    // 初始：未选档位 → 显示 empty 提示
    if (formSection) formSection.style.display = "none";
    if (orderEmpty) orderEmpty.style.display = "block";

    await loadCurrentSubscription();

    // 绑定档位选择按钮
    document.querySelectorAll("[data-plan-select]").forEach((btn) => {
        btn.addEventListener("click", () => {
            selectPlan(btn.getAttribute("data-plan-select"));
            const formCard = document.getElementById("order-card");
            if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
    document.querySelectorAll("[data-topup-select]").forEach((btn) => {
        btn.addEventListener("click", () => {
            selectTopup(btn.getAttribute("data-topup-select"));
            const formCard = document.getElementById("order-card");
            if (formCard) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
}

// ────────── 提交订单 ──────────
document.getElementById("order-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selection) {
        const msg = document.getElementById("order-msg");
        showMsg(msg, "❌ 请先在上方选择一个套餐档位或加油包。", "warn");
        return;
    }
    const btn = document.getElementById("of-submit");
    const msg = document.getElementById("order-msg");
    btn.disabled = true;
    btn.textContent = "提交中…";
    msg.innerHTML = "";
    try {
        const email = document.getElementById("of-email").value.trim();
        const qq = document.getElementById("of-qq").value.trim();
        const method = document.getElementById("of-method").value;
        const payload = {
            email,
            qq,
            method,
            order_kind: selection.kind,
        };
        if (selection.kind === "subscription") {
            payload.plan_code = selection.code;
        } else {
            payload.topup_sku = selection.code;
        }
        const r = await callGateway("submit_payment_order", payload);
        showMsg(
            msg,
            "✅ 订单已提交，订单号 <code>" +
                esc(r.order && r.order.id) +
                '</code>。金额 ¥' + esc(r.order && r.order.amount_cny) +
                '。请耐心等待管理员审核，审核结果会出现在 <a href="./orders.html">我的订单</a>。',
            "ok",
        );
        document.getElementById("of-qq").value = "";
    } catch (err) {
        const m = (err.body && (err.body.message || err.body.error)) ||
                  err.message || "提交失败";
        showMsg(msg, "❌ " + esc(m), "warn");
    } finally {
        btn.disabled = false;
        btn.textContent = "提交订单";
    }
});

init();
