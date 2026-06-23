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

// ────────── 全局模型倍率促销（已过期，2026-05-24 00:00 UTC+8 结束）──────────
// 窗口外 #promo-banner 自动 hidden。当前无全站倍率折扣。
const PROMO_START_MS = 1779453000000; // 2026-05-22 20:30 UTC+8（已过期）
const PROMO_END_MS = 1779552000000;   // 2026-05-24 00:00 UTC+8（已过期）
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
        pro: { amount: 9.9, label: "Pro", desc: "月 2000 积分" },
        pro_plus: { amount: 29, label: "Pro+", desc: "月 8000 积分 + Opus" },
        pro_max: { amount: 99, label: "Pro Max", desc: "月 30000 积分" },
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
// 价格格式化：整数不加小数点，含小数保留 2 位去尾零
function fmtPrice(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return v.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

async function loadPricing() {
    try {
        const { data, error } = await sb.rpc("cancri_celebrate_get_pricing");
        if (error || !data || data.ok !== true) {
            console.warn("[pricing] rpc error, fallback to hardcoded", error);
            return;
        }
        // 覆盖 CLIENT_CATALOG。订单提交后 server 会重算金额，前端值仅供显示。
        const sub = data.subscription || {};
        ["pro", "pro_plus", "pro_max"].forEach((code) => {
            const s = sub[code];
            if (!s || !CLIENT_CATALOG.subscription[code]) return;
            CLIENT_CATALOG.subscription[code].amount = Number(s.amount_cny);
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
        el.innerHTML =
            '<span class="currency">¥</span>' +
            esc(cur) +
            '<span class="period">/ 月</span>';
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
    el.textContent =
        "¥" + fmtPrice(pro.amount) +
        " / ¥" + fmtPrice(pp.amount) +
        " / ¥" + fmtPrice(pm.amount) +
        " 三档月度订阅 · ¥" + fmtPrice(topupFrom) + " 起加油包永不过期";
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
    // 2026-06-19: 已取消「补差价升级」。买更高档一律满价整月（server 端裁决：立即升档 +
    // 配额回满 + 到期顺延 30 天，无 90 天上限）。不再显示补差价预览，按普通满价订阅展示
    // （含促销折扣）。保留函数签名供调用点引用，恒返回 null。
    void planCode;
    return null;
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

// ────────── 当前订阅数据（仅用于升级补差价预览，不再渲染 badge）──────────
async function loadCurrentSubscription() {
    try {
        const r = await callGateway("get_my_subscription", {});
        currentSub = r.subscription || null;
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
        const priceCell = upg
            ? "¥" + esc(fmtPrice(upg.amount))
            : "¥" + esc(fmtPrice(catalog.amount));
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

        // 2026-06-22 按量计费：检测 billing_mode。wallet_v3 时切换为充值入口。
        const billingMode = await detectBillingMode();
        if (billingMode === "wallet_v3") {
            setupWalletRechargeMode(loading);
            return;
        }

        const { data: { session } } = await sb.auth.getSession();
        if (window.PlatformSkeleton) PlatformSkeleton.hide(loading);
        else if (loading) loading.style.display = "none";
        if (!session || !session.user || session.user.is_anonymous) {
            if (gate) gate.style.display = "block";
            return;
        }

        const user = session.user;
        // of-email 已移到 checkout 页（2026-06-23），本页不再预填邮箱。

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

// ────────── 2026-06-22 按量充值模式（wallet_v3）──────────
// 检测 billing_mode：调 model_public_catalog 端点拿 billing_mode 字段。
let __billingModeCache = null;
async function detectBillingMode() {
    if (__billingModeCache) return __billingModeCache;
    try {
        const resp = await fetch(GW, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: window.__SUPABASE_ANON_KEY__ },
            body: JSON.stringify({ endpoint: "model_public_catalog" }),
        });
        if (resp.ok) {
            const d = await resp.json();
            __billingModeCache = d.billing_mode || "quota_v2";
            return __billingModeCache;
        }
    } catch (e) { console.warn("detectBillingMode:", e); }
    __billingModeCache = "quota_v2";
    return __billingModeCache;
}

// wallet_v3 模式：隐藏旧订阅/加油包区块，注入充值入口（金额输入 + 去结账按钮）+ ¥余额显示。
// 2026-06-23：内联表单已移到 checkout.html，本页只负责金额选择 + 跳转。
function setupWalletRechargeMode(loadingEl) {
    // 隐藏旧套餐相关区块
    const hideSelectors = [
        "[data-plan-select]", ".plan-tier", ".topup-card",
        "#order-form-section", "#order-empty", "#order-card",
        ".pricing-faq", "#promo-banner",
    ];
    hideSelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => { el.style.display = "none"; });
    });

    // 在 main 区域顶部插入充值面板
    const main = document.querySelector("main.pricing-page") || document.querySelector("main");
    if (main && !document.getElementById("wallet-recharge-section")) {
        const section = document.createElement("section");
        section.id = "wallet-recharge-section";
        section.style.cssText = "max-width:640px;margin:0 auto 40px;padding:0 20px;";
        section.innerHTML =
            '<h2 style="text-align:center;font-size:28px;margin-bottom:8px">按量充值</h2>' +
            '<p style="text-align:center;color:var(--text-mute);margin-bottom:24px">¥1 = ¥1 钱包额度，按模型实际用量计费，永不过期</p>' +
            '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px">' +
                '<label style="display:block;font-size:14px;margin-bottom:8px">充值金额（¥1 ~ ¥2000）</label>' +
                '<div style="display:flex;gap:8px;margin-bottom:16px">' +
                    '<input id="recharge-amount" type="number" min="1" max="2000" step="1" placeholder="输入金额" ' +
                        'style="flex:1;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:16px;background:var(--bg);color:var(--text)" />' +
                    '<button id="recharge-quick-10" class="btn btn-secondary" style="padding:10px 16px">¥10</button>' +
                    '<button id="recharge-quick-50" class="btn btn-secondary" style="padding:10px 16px">¥50</button>' +
                    '<button id="recharge-quick-100" class="btn btn-secondary" style="padding:10px 16px">¥100</button>' +
                '</div>' +
                '<div id="recharge-msg" style="margin-top:12px"></div>' +
                '<button id="recharge-checkout-btn" class="btn" style="width:100%;padding:12px;font-size:16px">去结账 →</button>' +
            '</div>' +
            '<div style="margin-top:24px;text-align:center">' +
                '<a href="./orders.html" style="color:var(--text-mute);font-size:13px">查看我的订单 →</a>' +
            '</div>' +
            '<div style="margin-top:32px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px">' +
                '<h3 style="font-size:16px;margin-bottom:12px">代金券兑换</h3>' +
                '<div style="display:flex;gap:8px">' +
                    '<input id="voucher-code" type="text" placeholder="输入代金券码" ' +
                        'style="flex:1;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:var(--bg);color:var(--text);text-transform:uppercase" />' +
                    '<button id="voucher-submit" class="btn btn-secondary" style="padding:10px 20px">兑换</button>' +
                '</div>' +
                '<div id="voucher-msg" style="margin-top:12px"></div>' +
            '</div>';
        main.insertBefore(section, main.firstChild);

        // 快捷金额按钮
        ["10", "50", "100"].forEach((amt) => {
            const btn = document.getElementById("recharge-quick-" + amt);
            if (btn) btn.addEventListener("click", () => {
                document.getElementById("recharge-amount").value = amt;
            });
        });

        // 去结账按钮：校验金额后跳转 checkout.html
        const checkoutBtn = document.getElementById("recharge-checkout-btn");
        const msgEl = document.getElementById("recharge-msg");
        if (checkoutBtn) checkoutBtn.addEventListener("click", () => {
            const amount = Number(document.getElementById("recharge-amount").value);
            if (!Number.isFinite(amount) || amount < RECHARGE_MIN_CNY || amount > RECHARGE_MAX_CNY) {
                showMsg(msgEl, "❌ 充值金额需在 ¥" + RECHARGE_MIN_CNY + " ~ ¥" + RECHARGE_MAX_CNY + " 之间。", "warn");
                return;
            }
            const params = new URLSearchParams();
            params.set("kind", "recharge");
            params.set("amount", String(amount));
            params.set("label", "按量充值 ¥" + fmtPrice(amount));
            params.set("desc", "¥1 = ¥1 钱包额度，按模型实际用量计费，永不过期");
            location.href = "./api/checkout.html?" + params.toString();
        });

        // 代金券兑换
        const voucherBtn = document.getElementById("voucher-submit");
        if (voucherBtn) voucherBtn.addEventListener("click", async () => {
            await submitVoucherRedemption();
        });
    }

    if (window.PlatformSkeleton) PlatformSkeleton.hide(loadingEl);
    else if (loadingEl) loadingEl.style.display = "none";
}

const RECHARGE_MIN_CNY = 1;
const RECHARGE_MAX_CNY = 2000;

async function submitVoucherRedemption() {
    const btn = document.getElementById("voucher-submit");
    const msg = document.getElementById("voucher-msg");
    const code = document.getElementById("voucher-code").value.trim().toUpperCase();
    if (!code) { showMsg(msg, "❌ 请输入代金券码。", "warn"); return; }
    btn.disabled = true;
    btn.textContent = "兑换中…";
    msg.innerHTML = "";
    try {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) throw Object.assign(new Error("not_logged_in"), { body: { message: "请先登录" } });
        const resp = await fetch(GW, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: window.__SUPABASE_ANON_KEY__ },
            body: JSON.stringify({ endpoint: "redeem_voucher", code, __auth_token: session.access_token }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw Object.assign(new Error(data.error || resp.statusText), { body: data });
        showMsg(msg,
            "✅ 兑换成功！本次到账 <strong>¥" + esc(fmtPrice(data.value_cny)) +
            "</strong>，当前余额 <strong>¥" + esc(fmtPrice(data.balance_cny)) + "</strong>",
            "ok", { html: true });
        document.getElementById("voucher-code").value = "";
    } catch (err) {
        const m = (err.body && (err.body.message || err.body.error)) || err.message || "兑换失败";
        showMsg(msg, "❌ " + m, "warn");
    } finally {
        btn.disabled = false;
        btn.textContent = "兑换";
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

// ────────── 去结账（2026-06-23：改为跳转到 Stripe 风格 checkout 页）──────────
// 不再在本页直接 submit_payment_order。把当前 selection 编进 query 参数，
// 跳到 chat/api/checkout.html，由 checkout-app.js 收集邮箱/QQ/微信/备注并提交。
// 后端 handleSubmitPaymentOrder 会按 ORDER_CATALOG 重算真实金额（含升级补差价），
// 前端传的 amount 仅作预览，不会造成 client/server 金额不一致。
document.getElementById("order-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = document.getElementById("order-msg");
    if (!selection) {
        showMsg(msg, "❌ 请先在上方选择一个套餐档位或加油包。", "warn");
        return;
    }
    // 复用 renderSelectedSummary 的 catalog/upg 计算逻辑，拿到 label/desc/amount。
    let catalog = selection.kind === "subscription"
        ? CLIENT_CATALOG.subscription[selection.code]
        : CLIENT_CATALOG.topup[selection.code];
    if (!catalog) {
        showMsg(msg, "❌ 当前选择无效，请重新选择。", "warn");
        return;
    }
    if (selection.kind === "topup" && selection.code === "topup_custom") {
        const amt = Number(selection.customAmount) || 0;
        catalog = {
            amount: amt,
            label: "自定义加油包 ¥" + fmtPrice(amt),
            desc: (amt * TOPUP_CUSTOM_POINTS_PER_CNY) + " 积分（按量充值，永不过期）",
        };
    }
    const upg = selection.kind === "subscription" ? computeUpgradePreview(selection.code) : null;
    const payAmount = upg ? upg.amount : catalog.amount;

    const params = new URLSearchParams();
    params.set("kind", selection.kind);
    if (selection.kind === "subscription") {
        params.set("plan", selection.code);
    } else {
        params.set("sku", selection.code);
    }
    params.set("amount", String(payAmount));
    if (catalog.label) params.set("label", catalog.label);
    if (catalog.desc) params.set("desc", catalog.desc);
    // checkout.html 在 chat/api/ 下，本页在 chat/ 下，相对路径 ./api/checkout.html
    location.href = "./api/checkout.html?" + params.toString();
});

init();
