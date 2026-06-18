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
// 2026-05-29 满月套餐折扣从后端拉：
//   • CLIENT_CATALOG 不再硬编码价位 / 配额 / token 数，改由 RPC
//     cancri_celebrate_get_pricing() 返回，与后端 ORDER_CATALOG 同步 source of truth
//   • 5/29-5/31 活动窗口期：Pro 5 折 / Pro+/Max 8 折自动生效，价格卡上
//     原价加删除线 + 折后价 + 折扣徽章
//   • 后台提交订单时仍会 server-side 重算金额（submit_payment_order），
//     前端显示仅供预览，不会引起 client/server 金额不一致
//
// 沿用 admin-*-app.js 同款做法：全部 addEventListener，无 inline onclick。

// ────────── 全局模型倍率促销（已过期，618 不做全站倍率折扣）──────────
// 窗口外 #promo-banner 自动 hidden。618 仅套餐降价，见 SUB_PROMO_*。
const PROMO_START_MS = 1779453000000; // 2026-05-22 20:30 UTC+8（已过期）
const PROMO_END_MS = 1779552000000;   // 2026-05-24 00:00 UTC+8（已过期）
const PROMO_DISCOUNT = 0.5;

// ────────── 2026-06-18 618 套餐限时折扣（3 天）──────────
// Pro 6.18折 / Pro+ 7折 / Pro Max 8折。与 celebrate_config.subscription_discount 同步。
// 后端 RPC 为主；此处作横幅倒计时 + RPC 失败时的展示兜底。
const SUB_PROMO_START_MS = 1781712000000; // 2026-06-18T00:00:00+08:00
const SUB_PROMO_END_MS   = 1781971200000; // 2026-06-21T00:00:00+08:00
const SUB_PROMO_DISCOUNTS = { pro: 0.618, pro_plus: 0.7, pro_max: 0.8 };

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

// 2026-06-03 订阅折扣横幅倒计时
function startSubPromoBanner() {
    const banner = document.getElementById("sub-promo-banner");
    if (!banner) return;
    const countdown = document.getElementById("sub-promo-countdown");
    const closeBtn = document.getElementById("sub-promo-banner-close");
    const tick = () => {
        const now = Date.now();
        if (now < SUB_PROMO_START_MS || now >= SUB_PROMO_END_MS) {
            banner.style.display = "none";
            return false;
        }
        if (countdown) countdown.textContent = formatHMS(SUB_PROMO_END_MS - now);
        return true;
    };
    if (!tick()) return;
    const handle = setInterval(() => {
        if (!tick()) clearInterval(handle);
    }, 1000);
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            banner.style.display = "none";
            clearInterval(handle);
        });
    }
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startSubPromoBanner);
} else {
    startSubPromoBanner();
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

// 2026-05-29 积分化：统一走 window.CancriCredits（cancri_credits.js 先加载）。
// 后端 RPC 仍返回真实 token 数值（monthly_quota / tokens），前端按
// 1 积分 = 1 万 token 转换显示，不动后端。兜底避免工具未加载时崩。
const CC = window.CancriCredits || {
    num: function (t) {
        const c = (Number(t) || 0) / 10000;
        return c >= 100 ? Math.round(c).toLocaleString("en-US")
            : String(Math.round(c * 10) / 10);
    },
};

// 2026-05-29 改为后端拉。loadPricing() 会在 init 阶段调
// cancri_celebrate_get_pricing() 填充。初始值仅为 fallback（避免 RPC 失败时
// 选择逻辑拿不到 amount），与 HTML 中的 hardcoded 原价一致。
// 订单提交仍由 server 端重算金额，前端值不可信。
const CLIENT_CATALOG = {
    subscription: {
        pro: { amount: 6.12, amount_original: 9.9, discount: 0.618, label: "Pro", desc: "月 2000 积分" },
        pro_plus: { amount: 20.3, amount_original: 29, discount: 0.7, label: "Pro+", desc: "月 8000 积分 + Opus" },
        pro_max: { amount: 79.2, amount_original: 99, discount: 0.8, label: "Pro Max", desc: "月 30000 积分" },
    },
    topup: {
        topup_small: { amount: 10, label: "加油包 ¥10", desc: "1500 积分" },
        topup_medium: { amount: 50, label: "加油包 ¥50", desc: "9000 积分" },
        topup_large: { amount: 200, label: "加油包 ¥200", desc: "40000 积分" },
        // 自定义按量充值：金额由用户填，desc/amount 在选择时按下方费率动态算。
        topup_custom: { amount: 0, label: "自定义加油包", desc: "按量充值" },
    },
};
// 2026-06-12 自定义充值费率：与后端 TOPUP_CUSTOM_* 同步。¥1 = 150 积分（= 1_500_000 token）。
const TOPUP_CUSTOM_POINTS_PER_CNY = 150;
const TOPUP_CUSTOM_MIN_CNY = 1;
const TOPUP_CUSTOM_MAX_CNY = 1000;
let pricingMeta = { in_window: false, active_from: null, active_to: null };

// 价格格式化：整数不加小数点，含小数保留 2 位去尾零
function fmtPrice(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

// 折扣标签文本：0.5 → "5 折"，0.8 → "8 折"
function discountLabel(d) {
    const tenths = Math.round(d * 10);
    if (tenths >= 1 && tenths <= 9) return tenths + " 折";
    return Math.round((1 - d) * 100) + "% OFF";
}

async function loadPricing() {
    try {
        const { data, error } = await sb.rpc("cancri_celebrate_get_pricing");
        if (error || !data || data.ok !== true) {
            console.warn("[pricing] rpc error, fallback to hardcoded", error);
            return;
        }
        // 覆盖 CLIENT_CATALOG。amount 是折后（包含折扣），订单提交后
        // server 会重算 + 虚开发票防扣项 —— 前端值仅供显示。
        const sub = data.subscription || {};
        ["pro", "pro_plus", "pro_max"].forEach((code) => {
            const s = sub[code];
            if (!s || !CLIENT_CATALOG.subscription[code]) return;
            CLIENT_CATALOG.subscription[code].amount = Number(s.amount_cny);
            CLIENT_CATALOG.subscription[code].amount_original = Number(s.amount_cny_original);
            CLIENT_CATALOG.subscription[code].discount = Number(s.discount);
            if (s.label) CLIENT_CATALOG.subscription[code].label = String(s.label);
            if (Number.isFinite(Number(s.monthly_quota))) {
                // 2026-05-29 积分化：用数值字段算积分，不再用后端 token 文案
                CLIENT_CATALOG.subscription[code].desc = "月 " + CC.num(s.monthly_quota) + " 积分";
            }
        });
        const tp = data.topup || {};
        ["topup_small", "topup_medium", "topup_large"].forEach((code) => {
            const t = tp[code];
            if (!t || !CLIENT_CATALOG.topup[code]) return;
            CLIENT_CATALOG.topup[code].amount = Number(t.amount_cny);
            if (t.label) CLIENT_CATALOG.topup[code].label = String(t.label);
            if (Number.isFinite(Number(t.tokens))) CLIENT_CATALOG.topup[code].desc = CC.num(t.tokens) + " 积分";
        });
        pricingMeta = data.discount_window || pricingMeta;

        // 2026-06-18 618：客户端订阅折扣（后端 RPC 未覆盖时生效）。
        // 同时修改 data 和 CLIENT_CATALOG，确保 renderPlanCards 读到折后价。
        const subNow = Date.now();
        if (subNow >= SUB_PROMO_START_MS && subNow < SUB_PROMO_END_MS) {
            ["pro", "pro_plus", "pro_max"].forEach((code) => {
                const d = SUB_PROMO_DISCOUNTS[code];
                if (!d || d >= 1) return;
                const s = sub[code];
                const cat = CLIENT_CATALOG.subscription[code];
                if (!s || !cat) return;
                const baseOriginal = Number(s.amount_cny_original) || cat.amount_original;
                const discounted = Math.round(baseOriginal * d * 100) / 100;
                const currentAmount = Number(s.amount_cny) || cat.amount;
                if (discounted < currentAmount) {
                    // 修改 RPC 返回的 data（renderPlanCards 读这个）
                    s.amount_cny = discounted;
                    s.discount = d;
                    // 同步 CLIENT_CATALOG
                    cat.amount = discounted;
                    cat.discount = d;
                }
            });
        }

        renderPlanCards(data);
        renderTopupCards(data);
        renderPricingSubtitle();
    } catch (e) {
        console.warn("[pricing] loadPricing exception", e);
    }
}

function renderPlanCards(data) {
    const sub = (data && data.subscription) || {};
    document.querySelectorAll("[data-price-slot]").forEach((el) => {
        const code = el.getAttribute("data-price-slot");
        const s = sub[code];
        if (!s) return;
        const cur = fmtPrice(s.amount_cny);
        const orig = fmtPrice(s.amount_cny_original);
        const isDiscounted = Number(s.discount) > 0 && Number(s.discount) < 1;
        const badge = isDiscounted
            ? '<span class="price-discount-badge">' + esc(discountLabel(Number(s.discount))) + "</span>"
            : "";
        const strike = isDiscounted
            ? '<span class="price-original">¥' + esc(orig) + "</span>"
            : "";
        el.innerHTML =
            '<span class="currency">¥</span>' +
            strike +
            esc(cur) +
            '<span class="period">/ 月</span>' +
            badge;
    });
    document.querySelectorAll("[data-quota-slot]").forEach((el) => {
        const code = el.getAttribute("data-quota-slot");
        const s = sub[code];
        if (s && Number.isFinite(Number(s.monthly_quota))) {
            el.textContent = "月度配额 " + CC.num(s.monthly_quota) + " 积分";
        }
    });
}

function renderTopupCards(data) {
    const tp = (data && data.topup) || {};
    document.querySelectorAll("[data-topup-amount-slot]").forEach((el) => {
        const code = el.getAttribute("data-topup-amount-slot");
        const t = tp[code];
        if (!t) return;
        el.innerHTML = '<span class="currency">¥</span>' + esc(fmtPrice(t.amount_cny));
    });
    document.querySelectorAll("[data-topup-tokens-slot]").forEach((el) => {
        const code = el.getAttribute("data-topup-tokens-slot");
        const t = tp[code];
        if (t && Number.isFinite(Number(t.tokens))) {
            el.textContent = CC.num(t.tokens) + " 积分";
        }
    });
}

function renderPricingSubtitle() {
    const el = document.querySelector("[data-pricing-subtitle]");
    if (!el) return;
    const pro = CLIENT_CATALOG.subscription.pro;
    const pp = CLIENT_CATALOG.subscription.pro_plus;
    const pm = CLIENT_CATALOG.subscription.pro_max;
    const ts = CLIENT_CATALOG.topup.topup_small;
    const topupFrom = Math.max(0, Number(ts && ts.amount) || 10);
    if (pricingMeta && pricingMeta.in_window) {
        // source: 'window' = 满月一次性窗口；'weekly' = 每周末自动折扣
        const promoLabel = pricingMeta.source === "weekly"
            ? "周末限时折扣进行中"
            : (pricingMeta.active_from === "2026-06-18" ? "618 大促限时折扣" : "限时折扣进行中");
        el.innerHTML =
            '<span style="color:var(--accent);font-weight:600">' + esc(promoLabel) + '</span> · ' +
            "Pro ¥" + esc(fmtPrice(pro.amount)) +
            " / Pro+ ¥" + esc(fmtPrice(pp.amount)) +
            " / Pro Max ¥" + esc(fmtPrice(pm.amount)) +
            " · ¥" + esc(fmtPrice(topupFrom)) + " 起加油包永不过期";
    } else {
        el.textContent =
            "¥" + fmtPrice(pro.amount) +
            " / ¥" + fmtPrice(pp.amount) +
            " / ¥" + fmtPrice(pm.amount) +
            " 三档月度订阅 · ¥" + fmtPrice(topupFrom) + " 起加油包永不过期";
    }
}

// 当前选中的订单（用户点 plan-tier 或 topup-card 后填充）
let selection = null; // { kind: 'subscription'|'topup', code: 'pro'|...|'topup_small'|... }

// 2026-06-03 升级补差价预览：当前订阅有效且选了更高档 → 显示按剩余天数补差价的预览金额。
// 与后端 handleSubmitPaymentOrder 同口径（原价做差、最低 ¥1）。仅预览，真实金额以提交后订单为准。
let currentSub = null;
const PLAN_RANK = { pro: 1, pro_plus: 2, pro_max: 3 };
// 2026-06-18 与后端 ORDER_CATALOG.subscription.monthly_quota 同步（token / 10000 = 积分）。
// 升级补差价时配额也按剩余天数比例发（DB cancri_activate_paid_code_v2 upgrade 分支），
// 前端规格行必须按同口径显示，否则会误导成「¥7 拿满月 8000 积分」。
const PLAN_FULL_CREDITS = { pro: 2000, pro_plus: 8000, pro_max: 30000 };
// 2026-06-04 与后端同步：剩余 < 此天数不给 proration 升级（防临到期薅），改满价买新周期。
const UPGRADE_MIN_REMAINING_DAYS = 7;
function planLabelOf(code) {
    return code === "pro_plus" ? "Pro+" : (code === "pro_max" ? "Pro Max" : "Pro");
}
function computeUpgradePreview(planCode) {
    if (!currentSub || currentSub.tier !== "paid" || !currentSub.plan_code) return null;
    const cur = currentSub.plan_code;
    if (!PLAN_RANK[cur] || !PLAN_RANK[planCode]) return null;
    if (PLAN_RANK[planCode] <= PLAN_RANK[cur]) return null; // 同档/降档不是升级
    const days = Math.max(1, Math.floor(Number(currentSub.days_remaining) || 0));
    // 剩余不足阈值：后端不会按差价升级（改满价新周期）→ 前端也不显示升级差价预览，避免误导。
    if (days < UPGRADE_MIN_REMAINING_DAYS) return null;
    const tgt = Number((CLIENT_CATALOG.subscription[planCode] || {}).amount_original) || 0;
    const curMonth = Number((CLIENT_CATALOG.subscription[cur] || {}).amount_original) || 0;
    const prorated = ((tgt - curMonth) / 30) * days;
    const amount = Math.max(1, Math.round(prorated * 100) / 100);
    // 配额按 DB 同口径折算：new = old + floor((target_full - old) * days / 30)，
    // 钳制在 [old, target_full]；剩余 ≥30 天给满。下周期 reset 恢复 target_full。
    const oldCredits = PLAN_FULL_CREDITS[cur] || 0;
    const targetCredits = PLAN_FULL_CREDITS[planCode] || 0;
    const ratioDays = Math.min(30, days);
    const newCredits = Math.max(
        oldCredits,
        Math.min(targetCredits, oldCredits + Math.floor((targetCredits - oldCredits) * ratioDays / 30))
    );
    const deltaCredits = Math.max(0, newCredits - oldCredits);
    return {
        amount, days, fromLabel: planLabelOf(cur), toLabel: planLabelOf(planCode),
        newCredits, deltaCredits, targetCredits,
    };
}

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

function showMsg(el, text, kind, opts) {
    // 默认把 text 当纯文本转义，杜绝调用方忘记 esc() 造成 HTML 注入。
    // 需要富文本（<code>/<strong>/<a>）的调用方显式传 { html: true }，
    // 并自行 esc() 其中的动态片段。
    const body = (opts && opts.html)
        ? String(text == null ? "" : text)
        : esc(String(text == null ? "" : text));
    el.innerHTML =
        '<div class="alert alert-' + esc(kind || "info") + '">' + body + "</div>";
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
        currentSub = r.subscription || null;
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
    let catalog = selection.kind === "subscription"
        ? CLIENT_CATALOG.subscription[selection.code]
        : CLIENT_CATALOG.topup[selection.code];
    if (!catalog) {
        return;
    }
    // 自定义充值：金额/积分按用户输入的 customAmount 动态生成展示用 catalog。
    if (selection.kind === "topup" && selection.code === "topup_custom") {
        const amt = Number(selection.customAmount) || 0;
        catalog = {
            amount: amt,
            label: "自定义加油包 ¥" + fmtPrice(amt),
            desc: (amt * TOPUP_CUSTOM_POINTS_PER_CNY) + " 积分（按量充值，永不过期）",
        };
    }
    if (orderEmpty) orderEmpty.style.display = "none";
    if (formSection) formSection.style.display = "block";
    // 2026-06-03：当前订阅有效且选了更高档 → 升级，按剩余天数补差价（预览金额）。
    const upg = selection.kind === "subscription" ? computeUpgradePreview(selection.code) : null;
    const payAmount = upg ? upg.amount : catalog.amount;
    if (qrAmount) qrAmount.textContent = "¥" + fmtPrice(payAmount);
    if (card) {
        const kindLabel = upg ? "升级（补差价）" : (selection.kind === "subscription" ? "订阅" : "加油包");
        const isDiscounted = !upg && selection.kind === "subscription"
            && Number(catalog.discount) > 0 && Number(catalog.discount) < 1;
        const priceCell = upg
            ? "¥" + esc(fmtPrice(upg.amount))
            : (isDiscounted
                ? '<span class="price-original" style="font-size:0.85em">¥' + esc(fmtPrice(catalog.amount_original)) + "</span>"
                  + "¥" + esc(fmtPrice(catalog.amount))
                  + ' <span class="price-discount-badge" style="font-size:0.55em">' + esc(discountLabel(Number(catalog.discount))) + "</span>"
                : "¥" + esc(fmtPrice(catalog.amount)));
        const upgradeNote = upg
            ? '<div class="selected-summary__row">' +
                  '<span class="selected-summary__label">升级说明</span>' +
                  '<span class="selected-summary__value">立即生效，剩余 ' + esc(String(upg.days)) +
                  " 天从 " + esc(upg.fromLabel) + " 升到 " + esc(upg.toLabel) +
                  "，不延长到期日。最终金额以提交后订单为准。</span>" +
              "</div>"
            : "";
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
                '<span class="selected-summary__value">' +
                    (upg
                        ? "升级后月配额 " + esc(String(upg.newCredits).replace(/(\d)(?=(\d{3})+$)/g, "$1,")) +
                          " 积分（剩余 " + esc(String(upg.days)) + " 天按比例，下周期恢复 " +
                          esc(String(upg.targetCredits).replace(/(\d)(?=(\d{3})+$)/g, "$1,")) + "）"
                        : esc(catalog.desc)) +
                "</span>" +
            "</div>" +
            upgradeNote +
            '<div class="selected-summary__row">' +
                '<span class="selected-summary__label">应付金额</span>' +
                '<span class="selected-summary__big">' + priceCell + "</span>" +
            "</div>";
    }
}

function selectPlan(code) {
    if (!CLIENT_CATALOG.subscription[code]) return;
    selection = { kind: "subscription", code };
    highlightSelection();
    renderSelectedSummary();
}

function switchPricingTab(tab) {
    const seg = document.querySelector(".pricing-segment");
    const subPanel = document.getElementById("pricing-panel-subscription");
    const topupPanel = document.getElementById("pricing-panel-topup");
    if (!seg) return;
    seg.querySelectorAll("button[data-pricing-tab]").forEach((b) => {
        b.classList.toggle("is-active", b.getAttribute("data-pricing-tab") === tab);
    });
    if (subPanel) subPanel.hidden = tab !== "subscription";
    if (topupPanel) topupPanel.hidden = tab !== "topup";
}

function setupPricingTabs() {
    const seg = document.querySelector(".pricing-segment");
    if (!seg || seg.dataset.tabsBound === "1") return;
    seg.dataset.tabsBound = "1";
    seg.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pricing-tab]");
        if (!btn) return;
        switchPricingTab(btn.getAttribute("data-pricing-tab"));
    });
}

function setupPricingFaq() {
    const list = document.getElementById("pricing-faq-list");
    if (!list || list.dataset.faqBound === "1") return;
    list.dataset.faqBound = "1";
    list.querySelectorAll(".pricing-faq-q").forEach((q) => {
        q.addEventListener("click", () => {
            const item = q.closest(".pricing-faq-item");
            if (!item) return;
            const wasActive = item.classList.contains("active");
            list.querySelectorAll(".pricing-faq-item").forEach((i) => i.classList.remove("active"));
            if (!wasActive) item.classList.add("active");
        });
    });
}

function selectTopup(code) {
    if (!CLIENT_CATALOG.topup[code]) return;
    if (code === "topup_custom") {
        const input = document.getElementById("topup-custom-amount");
        const amt = Math.round((Number(input && input.value) || 0) * 100) / 100;
        const msg = document.getElementById("order-msg");
        if (!Number.isFinite(amt) || amt < TOPUP_CUSTOM_MIN_CNY || amt > TOPUP_CUSTOM_MAX_CNY) {
            if (msg) showMsg(msg, "❌ 请先填写充值金额：¥" + TOPUP_CUSTOM_MIN_CNY + " ~ ¥" + TOPUP_CUSTOM_MAX_CNY + "。", "warn");
            if (input) input.focus();
            return;
        }
        selection = { kind: "topup", code, customAmount: amt };
    } else {
        selection = { kind: "topup", code };
    }
    switchPricingTab("topup");
    highlightSelection();
    renderSelectedSummary();
}

// 自定义金额输入时实时更新积分预览
function setupCustomTopupInput() {
    const input = document.getElementById("topup-custom-amount");
    const out = document.getElementById("topup-custom-tokens");
    if (!input || !out || input.dataset.bound === "1") return;
    input.dataset.bound = "1";
    const update = () => {
        const amt = Math.round((Number(input.value) || 0) * 100) / 100;
        if (!Number.isFinite(amt) || amt < TOPUP_CUSTOM_MIN_CNY || amt > TOPUP_CUSTOM_MAX_CNY) {
            out.textContent = "输入 ¥" + TOPUP_CUSTOM_MIN_CNY + "~" + TOPUP_CUSTOM_MAX_CNY;
        } else {
            out.textContent = (amt * TOPUP_CUSTOM_POINTS_PER_CNY) + " 积分";
        }
        // 已选中自定义档时，改金额同步刷新订单摘要。
        if (selection && selection.kind === "topup" && selection.code === "topup_custom"
            && Number.isFinite(amt) && amt >= TOPUP_CUSTOM_MIN_CNY && amt <= TOPUP_CUSTOM_MAX_CNY) {
            selection.customAmount = amt;
            renderSelectedSummary();
        }
    };
    input.addEventListener("input", update);
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
    setupPricingTabs();
    setupPricingFaq();
    const loading = document.getElementById("order-loading");
    const gate = document.getElementById("order-login-gate");
    const formSection = document.getElementById("order-form-section");
    const orderEmpty = document.getElementById("order-empty");

    try {
        await loadPricing();

        const { data: { session } } = await sb.auth.getSession();
        if (window.PlatformSkeleton) PlatformSkeleton.hide(loading);
        else if (loading) loading.style.display = "none";
        if (!session || !session.user || session.user.is_anonymous) {
            if (gate) gate.style.display = "block";
            return;
        }

        const user = session.user;
        const emailInput = document.getElementById("of-email");
        if (user.email && emailInput) emailInput.value = user.email;

        if (formSection) formSection.style.display = "none";
        if (orderEmpty) orderEmpty.style.display = "block";

        await loadCurrentSubscription();

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
        setupPaymentMethodTabs();
        setupCustomTopupInput();
    } catch (e) {
        console.error("pricing init:", e);
        if (window.PlatformSkeleton) PlatformSkeleton.hide(loading);
        else if (loading) loading.style.display = "none";
        if (gate) {
            gate.style.display = "block";
            gate.innerHTML =
                '<p style="color:var(--err);margin-bottom:12px">页面加载失败，请刷新重试。</p>' +
                '<a href="./" class="btn-secondary">返回聊天</a>';
        }
    }
}

// ────────── 支付方式切换胶囊 ──────────
function setupPaymentMethodTabs() {
    const tabs = document.getElementById("pay-method-tabs");
    const qrImg = document.getElementById("qr-img");
    const qrRecommend = document.getElementById("qr-recommend");
    const methodSelect = document.getElementById("of-method");
    if (!tabs || !qrImg || !qrRecommend || !methodSelect) return;

    const QR_SRC = {
        wechat: "../Logo/1107.jpg",
        alipay: "../Logo/ZFB.jpg",
    };
    const QR_ALT = {
        wechat: "微信收款码",
        alipay: "支付宝收款码",
    };
    const RECOMMEND_TEXT = {
        wechat: "推荐使用微信支付",
        alipay: "推荐使用支付宝",
    };

    function switchMethod(method) {
        if (!QR_SRC[method]) return;
        tabs.querySelectorAll("button").forEach((btn) => {
            btn.classList.toggle("is-active", btn.getAttribute("data-pay-method") === method);
        });
        qrImg.src = QR_SRC[method];
        qrImg.alt = QR_ALT[method];
        qrRecommend.textContent = RECOMMEND_TEXT[method];
        if (methodSelect.value !== method) {
            methodSelect.value = method;
        }
    }

    tabs.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
            switchMethod(btn.getAttribute("data-pay-method"));
        });
    });

    methodSelect.addEventListener("change", () => {
        const val = methodSelect.value;
        if (val === "wechat" || val === "alipay") {
            switchMethod(val);
        }
    });

    const initial = (methodSelect.value === "alipay") ? "alipay" : "wechat";
    switchMethod(initial);
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
            if (selection.code === "topup_custom") {
                // server 端会按 [MIN,MAX] 钳制并按费率重算 token，此处只是把用户填的金额传过去。
                payload.amount_cny = selection.customAmount;
            }
        }
        const r = await callGateway("submit_payment_order", payload);
        showMsg(
            msg,
            "✅ 订单已提交，订单号 <code>" +
                esc(r.order && r.order.id) +
                '</code>。金额 ¥' + esc(r.order && r.order.amount_cny) +
                '。请耐心等待管理员审核，审核结果会出现在 <a href="./orders.html">我的订单</a>。',
            "ok",
            { html: true },
        );
        document.getElementById("of-qq").value = "";
    } catch (err) {
        const m = (err.body && (err.body.message || err.body.error)) ||
                  err.message || "提交失败";
        // m 走 showMsg 默认转义，无需再 esc()。
        showMsg(msg, "❌ " + m, "warn");
    } finally {
        btn.disabled = false;
        btn.textContent = "提交订单";
    }
});

init();
