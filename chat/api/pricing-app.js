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

// ────────── 2026-05-22 限时倍率 5 折促销 ──────────
// 必须与后端 chat-gateway.ts / api-gateway.ts 的 PROMO_MULTIPLIER_DISCOUNT_*
// 三个常量完全同步。窗口（UTC+8）：05-22 20:30 → 05-24 00:00。
const PROMO_START_MS = 1779453000000; // 2026-05-22T12:30:00Z = 2026-05-22 20:30 UTC+8
const PROMO_END_MS = 1779552000000;   // 2026-05-23T16:00:00Z = 2026-05-24 00:00 UTC+8
const PROMO_DISCOUNT = 0.5;

// ────────── 2026-06-03 订阅限时折扣（4 天）──────────
// Pro 8折 / Pro+ 85折 / Pro Max 不打折。窗口（UTC+8）：06-03 → 06-07。
const SUB_PROMO_START_MS = 1780416000000; // 2026-06-03T00:00:00+08:00
const SUB_PROMO_END_MS   = 1780761600000; // 2026-06-07T00:00:00+08:00
const SUB_PROMO_DISCOUNTS = { pro: 0.8, pro_plus: 0.85 };

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
        pro: { amount: 7.92, amount_original: 9.9, discount: 0.8, label: "Pro", desc: "月 2000 积分" },
        pro_plus: { amount: 24.65, amount_original: 29, discount: 0.85, label: "Pro+", desc: "月 8000 积分 + Opus" },
        pro_max: { amount: 99, amount_original: 99, discount: 1.0, label: "Pro Max", desc: "月 30000 积分" },
    },
    topup: {
        topup_small: { amount: 10, label: "加油包 ¥10", desc: "1500 积分" },
        topup_medium: { amount: 50, label: "加油包 ¥50", desc: "9000 积分" },
        topup_large: { amount: 200, label: "加油包 ¥200", desc: "40000 积分" },
    },
};
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

        // 2026-06-03: 客户端订阅折扣（后端 RPC 未覆盖时生效）。
        // 与后端 cancri_celebrate_apply_subscription_discount 取更优惠者。
        const subNow = Date.now();
        if (subNow >= SUB_PROMO_START_MS && subNow < SUB_PROMO_END_MS) {
            ["pro", "pro_plus"].forEach((code) => {
                const d = SUB_PROMO_DISCOUNTS[code];
                if (!d || d >= 1) return;
                const s = CLIENT_CATALOG.subscription[code];
                if (!s) return;
                const discounted = Math.round(s.amount_original * d * 100) / 100;
                if (discounted < s.amount) {
                    s.amount = discounted;
                    s.discount = d;
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
    if (pricingMeta && pricingMeta.in_window) {
        // source: 'window' = 满月一次性窗口；'weekly' = 每周末自动折扣
        const promoLabel = pricingMeta.source === "weekly"
            ? "周末限时折扣进行中"
            : "满月折扣并未结束";
        el.innerHTML =
            '<span style="color:var(--accent);font-weight:600">' + esc(promoLabel) + '</span> · ' +
            "Pro ¥" + esc(fmtPrice(pro.amount)) +
            " / Pro+ ¥" + esc(fmtPrice(pp.amount)) +
            " / Pro Max ¥" + esc(fmtPrice(pm.amount)) +
            " · ¥" + esc(fmtPrice(ts.amount)) + " 起加油包永不过期";
    } else {
        el.textContent =
            "¥" + fmtPrice(pro.amount) +
            " / ¥" + fmtPrice(pp.amount) +
            " / ¥" + fmtPrice(pm.amount) +
            " 三档月度订阅 · ¥" + fmtPrice(ts.amount) + " 起加油包永不过期";
    }
}

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
    if (qrAmount) qrAmount.textContent = "¥" + fmtPrice(catalog.amount);
    if (card) {
        const kindLabel = selection.kind === "subscription" ? "订阅" : "加油包";
        const isDiscounted = selection.kind === "subscription"
            && Number(catalog.discount) > 0 && Number(catalog.discount) < 1;
        const priceCell = isDiscounted
            ? '<span class="price-original" style="font-size:0.85em">¥' + esc(fmtPrice(catalog.amount_original)) + "</span>"
              + "¥" + esc(fmtPrice(catalog.amount))
              + ' <span class="price-discount-badge" style="font-size:0.55em">' + esc(discountLabel(Number(catalog.discount))) + "</span>"
            : "¥" + esc(fmtPrice(catalog.amount));
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

    // 2026-05-29 价位 / 折扣拉取：在鉴权之前跑，同时适用于未登录浏览
    // （RPC GRANT 了 anon）。不 await 会走 fallback、但初渲染拿不到折后价。
    loadPricing();

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
    setupPaymentMethodTabs();
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
