// api_models.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_models.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
// 本页原 inline 代码已使用 addEventListener / data-copy 委托，无 inline onclick。

function coalesce(value, fallback) {
    return value != null ? value : fallback;
}

const GW =
    (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
// 2026-06-20：Supabase egress 已封，紧急回退请改 wrangler USE_NEON=0 而非直连 supabase.co
const GW_SUPABASE_DIRECT =
    (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
const ANON = window.__SUPABASE_ANON_KEY__ || "";
let MODELS = [];
let activeCap = "all";
let activeTier = "all";
// 2026-05-17 按品牌分类：activeBrand 是品牌原名字符串（m.brand）或 "all"。
// 不用 normalize 后的 key 是为了 chip 按钮 ↔ m.brand 匹配一轮全字面判相等，
// 避免 normalize 造成不同品牌撞汇（如 "Inclusion AI" 与 "InclusionAI"则
// 合并为同一 chip）。buildBrandFilter 里会预先去重 × 归一。
let activeBrand = "all";

const $ = (id) => document.getElementById(id);
const esc = (s) => {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
};

// 2026-05-17 模型广场重构：用户指定从展示中移除的 model id 黑名单。
// 后端 catalog 仍包含这些（聊天页 / api-gateway 计费仍按原状），仅模型广场
// UI 隐藏。下面 9 条来自用户 2026-05-17 09:50 UTC+08 指令。
// 模型广场置顶：旗舰模型固定排在最前（其余保持原 catalog 顺序）。
// 仅列后端 catalog 仍存在的 id；已下线模型勿写死，避免与 model_public_catalog 漂移。
const FEATURED_MODEL_ORDER = [
    "gpt-5.5",
    "claude-opus-4-8",
    "grok-4.3",
    "gpt-image-2-pro",
    "minimax-m3",
    "kimi-k2.6",
    "glm-5.1",
    "deepseek-v4-pro",
];
const FEATURED_RANK = new Map(
    FEATURED_MODEL_ORDER.map((id, i) => [id.toLowerCase(), i]),
);

const GRID_COLLAPSE_MIN_ITEMS = 12;
let gridListExpanded = false;
let gridAnimating = false;

// 2026-06-10：catalog 偶发落后时的兜底补全（字段与 chat-gateway catalog 对齐）。
// 2026-06-19：不再硬编码已下线模型；模型广场以 model_public_catalog 为唯一权威源。
const CATALOG_ENSURE_MODELS = [];

function mergeEnsuredCatalogModels(byCanonical) {
    for (const patch of CATALOG_ENSURE_MODELS) {
        const cid = patch.canonicalId || patch.id;
        if (!byCanonical.has(cid)) {
            byCanonical.set(cid, { ...patch, id: cid, _lineCount: 1 });
        }
    }
    return byCanonical;
}

const HIDE_IDS = new Set([
    "z-image-turbo",
    "grok-imagine-image-lite",
    "gpt-image-2-all",
    "tongyi-xiaomi-analysis-pro",
    "gui-plus",
    "mistral-medium-3-5",
    "ministral-14b-2512",
    "mistral-large-2512",
    "mistral-small-2603",
    "or:arcee-ai/trinity-large-thinking",
]);

// 2026-05-17 模型广场档位二档化：仅 FREE / PAID。
//
// 历史：之前这里硬编码了 PAID_IDS Set + brand==="anthropic" 推断。但每次后端
// 调整 PAID 清单都要前后端两边一起改，容易漂移。
//
// 现状：chat-gateway 的 model_public_catalog 端口现在直接返回每条 model 的
// `gateCostTier: 'free' | 'paid'` + `freeUserBlocked: boolean`（与
// chat-gateway/modelscope-proxy 的 PAID_MODEL_IDS / FREE_USER_BLOCKED_IDS 同
// 一权威源）。前端只读这两字段。
//
// 兼容回退：万一 catalog 旧版本没返回 gateCostTier（部署时序错乱），就退回到
// 原来的本地推断（brand==="anthropic" || PAID_IDS Set）。这套兜底以后逐步
// 删除。
const FALLBACK_PAID_IDS = new Set([
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.5-high",
    "grok-4.20-0309",
    "grok-4.3",
    "gpt-image-2-all",
    "gpt-image-2-pro",
    "gemini-3.1-pro",
    "gemini-3.1-pro-preview",
    "glm-5.1",
    "deepseek-v4-pro",
    "deepseek-v4-pro-0608",
    // 2026-06-18: gemini-3.5-agent — prorisehub 上游，7× 倍率，PAID。
    "gemini-3.5-agent",
    // 2026-05-23 批次：10 个百炼 PAID 模型
    "qwen3.5-omni-plus-2026-03-15",
    "qwen3-coder-480b-a35b-instruct",
    "qwen-plus-2025-12-01",
    "qwen3-max-2025-09-23",
    "qwen-flash-2025-07-28",
    "qwen3.5-122b-a10b",
    "qwen3-235b-a22b-instruct-2507",
    "qwen3.5-flash",
    "qwen3-coder-flash",
    "qwen3-coder-plus-2025-09-23",
    "minimax-m3",
    "kimi-k2.6",
    "kimi-k2.7-code",
]);

// 2026-05-18 添加倍率列：与 chat-gateway MODEL_COST_MULTIPLIER 同步。
// 按列示例在模型卡片上额外渲染一个徽章，让用户一眼看到计费倍率。
const COST_TIER_MULTIPLIER = {
    free: 0.5,
    cheap: 1,
    normal: 2,
    expensive: 5,
    vip: 15,
};

function getCostMultiplier(m) {
    if (m && typeof m.customMultiplier === "number") {
        return m.customMultiplier;
    }
    const tier = (m && m.costTier) || "normal";
    return coalesce(COST_TIER_MULTIPLIER[tier], 1);
}

// 2026-05-22 限时倍率 5 折促销（与 chat-gateway / api-gateway / pricing-app.js
// 三个 PROMO_* 常量同窗口）。窗口（UTC+8）：05-22 20:30 → 05-24 00:00。
const PROMO_START_MS = 1779453000000; // 2026-05-22T12:30:00Z = 2026-05-22 20:30 UTC+8
const PROMO_END_MS = 1779552000000;   // 2026-05-23T16:00:00Z = 2026-05-24 00:00 UTC+8
const PROMO_DISCOUNT = 0.5;

function getPromoDiscount() {
    const now = Date.now();
    if (now >= PROMO_START_MS && now < PROMO_END_MS) return PROMO_DISCOUNT;
    return 1;
}

function isPromoActive() {
    return getPromoDiscount() < 1;
}

function fmtMult(n) {
    if (n === Math.round(n)) return n + "×";
    // 0.25 / 0.5 / 1.5 / 5 / 15 都能精确表达
    return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "×";
}

// 2026-05-24: 限量福利档（welfare）— 独立于 FREE / PAID 的第三类。
// 所有用户免费使用，但有「每用户并发 1 + 全局 100 RPM」的硬上限；
// 付费用户绕过限流。视觉上用 clay/amber 区别 FREE（中性）和 PAID（实心）。
const WELFARE_IDS = new Set([
    "claude-sonnet-4.5",
    "nex-n2-pro-welfare",
    "baichuan-m2-welfare",
    "baichuan4-air-welfare",
    "baichuan3-turbo-welfare",
    "baichuan2-turbo-welfare",
]);

function isWelfareModel(m) {
    if (!m) return false;
    const id = m.id || m.canonicalId || "";
    if (WELFARE_IDS.has(id)) return true;
    // 兜底：displayName 以「【福利」/ 「【限量福利」开头也算 welfare，
    // 让后端新加 welfare 模型不必同时改前端常量。
    const name = String(m.displayName || m.name || "");
    if (/^【(限量)?福利/.test(name)) return true;
    return false;
}

function getDisplayTier(m) {
    // 福利档优先（高于后端 gateCostTier 的 free / paid 判定）
    if (isWelfareModel(m)) return "welfare";
    // 优先读后端权威字段
    if (m && (m.gateCostTier === "paid" || m.gateCostTier === "free")) {
        return m.gateCostTier;
    }
    // 兼容回退：旧 catalog 没 gateCostTier，按本地规则推断
    const brand = (m.brand || "").toLowerCase();
    if (brand === "anthropic") return "paid";
    const id = m.id || m.canonicalId || "";
    if (FALLBACK_PAID_IDS.has(id)) return "paid";
    return "free";
}

// 2026-05-17 品牌 logo：从 chat/ 根下的 *-color.svg / *.svg 集反查。
// key 是品牌名归一化后的 slug（全小写 + 去空格），normalizeBrandKey()
// 会把 m.brand 转为该 slug 后查表。路径相对于 api_models.html（chat/）。
// 调试详细详细。
const BRAND_LOGO = {
    anthropic: "./claude-color.svg",
    openai: "./openai.svg",
    cancri: "../Logo/Cancri1.jpg",
    kwaikat: "./kwaikat.svg",
    google: "./gemini-color.svg",
    minimax: "./minimax-color.svg",
    stepfun: "./stepfun-color.svg",
    xai: "./grok.svg",
    // 文件名原本带中间空格 + (1)，用 encodeURI 避免 URL 解析问题。
    // 后续可考虑重命名为 deepseek-color.svg 让路径更干净。
    deepseek: encodeURI("./deepseek-color (1).svg"),
    doubao: "./doubao-color.svg",
    moonshot: "./moonshot.svg",
    zhipu: "./zhipu-color.svg",
    qwen: "./qwen-color.svg",
    meta: "./meta-color.svg",
    nvidia: "./nvidia-color.svg",
    sensenova: "./sensenova-color.svg",
    mistral: "./mistral-color.svg",
    huggingface: "./huggingface-color.svg",
    // 可选补充：以下品牌 catalog 里不成商并但可能出现，进 svg 集作为备选。
    bilibili: "./bilibili-color.svg",
    antgroup: "./antgroup-color.svg",
    spark: "./spark-color.svg",
    tencent: "./yuanbao-color.svg",
    hunyuan: "./yuanbao-color.svg",
    yuanbao: "./yuanbao-color.svg",
    kling: "./kling-color.svg",
    xiaomimimo: "./xiaomimimo-color.svg",
    baichuan: "./baichuan-color.svg",
    nex: "./NEX_logo.svg",
    microsoft: "./microsoft-color.svg",
    ibm: "./ibm.svg",
    cohere: "./cohere-color.svg",
    cursor: "./cursor.svg",
    swissai: "./huggingface-color.svg",
    utterproject: "./huggingface-color.svg",
    baidu: "./wenxin-color.svg",
};

function sortModelsFeaturedFirst(models) {
    return [...models].sort((a, b) => {
        const idA = String(a.id || a.canonicalId || "").toLowerCase();
        const idB = String(b.id || b.canonicalId || "").toLowerCase();
        const ra = FEATURED_RANK.has(idA) ? FEATURED_RANK.get(idA) : 9999;
        const rb = FEATURED_RANK.has(idB) ? FEATURED_RANK.get(idB) : 9999;
        if (ra !== rb) return ra - rb;
        return idA.localeCompare(idB);
    });
}

function getGridCollapsedMaxPx() {
    return Math.min(window.innerHeight * 0.68, 880);
}

function measureGridExpandedHeight() {
    const grid = $("grid");
    if (!grid) return 0;
    return grid.offsetHeight;
}

function getGridHeights() {
    const fullH = measureGridExpandedHeight();
    const collapsedH = Math.min(getGridCollapsedMaxPx(), fullH);
    return { fullH, collapsedH };
}

function applyGridStageHeight(px) {
    const stage = $("gridStage");
    if (!stage || !(px > 0)) return;
    stage.style.height = px + "px";
}

function setGridCollapseClasses(expanded) {
    const stage = $("gridStage");
    const wrap = $("gridScrollWrap");
    if (!stage || !wrap) return;
    stage.classList.toggle("is-expanded", expanded);
    stage.classList.toggle("is-collapsed", !expanded);
    wrap.classList.toggle("is-expanded", expanded);
    wrap.classList.toggle("is-collapsed", !expanded);
    if (!expanded) {
        stage.classList.remove("is-scrolled-end");
        wrap.classList.remove("is-scrolled-end");
        wrap.scrollTop = 0;
    }
}

function snapGridCollapse(expanded) {
    const { fullH, collapsedH } = getGridHeights();
    setGridCollapseClasses(expanded);
    applyGridStageHeight(expanded ? fullH : collapsedH);
    if (!expanded) syncGridFadeAtScrollEnd();
}

function setGridExpandBtnState(expanded) {
    const btn = $("gridExpandBtn");
    if (!btn) return;
    btn.textContent = expanded ? "收起全部" : "展开全部";
    btn.setAttribute("aria-expanded", String(expanded));
}

function syncGridFadeAtScrollEnd() {
    const stage = $("gridStage");
    const wrap = $("gridScrollWrap");
    if (!stage || !wrap || !stage.classList.contains("is-collapsed")) return;
    const atEnd =
        wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 10;
    stage.classList.toggle("is-scrolled-end", atEnd);
    wrap.classList.toggle("is-scrolled-end", atEnd);
}

function runGridHeightTween(stage, fromH, toH, onDone) {
    gridAnimating = true;
    stage.classList.add("is-animating");
    stage.style.height = fromH + "px";
    void stage.offsetHeight;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            stage.style.height = toH + "px";
        });
    });

    let settled = false;
    const settle = () => {
        if (settled) return;
        settled = true;
        gridAnimating = false;
        stage.removeEventListener("transitionend", onEnd);
        clearTimeout(fallbackTimer);
        if (typeof onDone === "function") onDone();
    };
    const onEnd = (e) => {
        if (e.target !== stage || e.propertyName !== "height") return;
        settle();
    };
    stage.addEventListener("transitionend", onEnd);
    const fallbackTimer = setTimeout(settle, 720);
}

function animateGridExpandToggle(expanded) {
    const stage = $("gridStage");
    const wrap = $("gridScrollWrap");
    if (!stage || !wrap) return;

    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
        snapGridCollapse(expanded);
        return;
    }

    const { fullH, collapsedH } = getGridHeights();
    const fromH = stage.offsetHeight || (expanded ? collapsedH : fullH);
    const toH = expanded ? fullH : collapsedH;
    if (Math.abs(fromH - toH) < 2) {
        snapGridCollapse(expanded);
        return;
    }

    stage.classList.remove("is-expanding", "is-collapsing", "is-scrolled-end");
    wrap.classList.remove("is-scrolled-end");

    if (expanded) {
        // 展开：保持折叠态 + 底部分割线，stage 高度从 cutoff 缓慢长到全量
        stage.classList.add("is-expanding");
        stage.classList.remove("is-expanded");
        stage.classList.add("is-collapsed");
        wrap.classList.remove("is-expanded");
        wrap.classList.add("is-collapsed");
        wrap.scrollTop = 0;

        runGridHeightTween(stage, fromH, toH, () => {
            stage.classList.remove("is-animating", "is-expanding");
            setGridCollapseClasses(true);
            applyGridStageHeight(fullH);
        });
        return;
    }

    // 收起：从全高缓慢压回分割高度，分割线渐变始终贴在可视底边
    stage.classList.add("is-collapsing");
    stage.classList.remove("is-collapsed");
    stage.classList.add("is-expanded");
    wrap.classList.remove("is-collapsed");
    wrap.classList.add("is-expanded");
    wrap.scrollTop = 0;

    runGridHeightTween(stage, fromH, toH, () => {
        stage.classList.remove("is-animating", "is-collapsing");
        setGridCollapseClasses(false);
        applyGridStageHeight(collapsedH);
        syncGridFadeAtScrollEnd();
    });
}

function setupGridCollapse() {
    const btn = $("gridExpandBtn");
    const wrap = $("gridScrollWrap");
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
        const count = Number(btn.dataset.visibleCount || 0);
        if (count < GRID_COLLAPSE_MIN_ITEMS || gridAnimating) return;
        gridListExpanded = !gridListExpanded;
        setGridExpandBtnState(gridListExpanded);
        animateGridExpandToggle(gridListExpanded);
    });
    if (wrap) {
        wrap.addEventListener(
            "scroll",
            () => {
                syncGridFadeAtScrollEnd();
            },
            { passive: true },
        );
    }
    window.addEventListener("resize", () => {
        const stage = $("gridStage");
        if (!stage || !stage.classList.contains("is-collapsed") &&
            !stage.classList.contains("is-expanded")) {
            return;
        }
        const { fullH, collapsedH } = getGridHeights();
        applyGridStageHeight(gridListExpanded ? fullH : collapsedH);
        syncGridFadeAtScrollEnd();
    });
}

function updateGridCollapse(visibleCount) {
    const stage = $("gridStage");
    const wrap = $("gridScrollWrap");
    const btn = $("gridExpandBtn");
    if (!stage || !wrap) return;
    if (btn) btn.dataset.visibleCount = String(visibleCount);

    if (visibleCount < GRID_COLLAPSE_MIN_ITEMS) {
        gridListExpanded = false;
        stage.style.height = "";
        stage.classList.remove("is-collapsed", "is-expanded", "is-scrolled-end");
        wrap.classList.remove("is-collapsed", "is-expanded", "is-scrolled-end");
        if (btn) {
            btn.hidden = true;
            setGridExpandBtnState(false);
        }
        return;
    }

    if (btn) btn.hidden = false;
    snapGridCollapse(gridListExpanded);
    setGridExpandBtnState(gridListExpanded);
}

function normalizeBrandKey(brand) {
    return String(brand || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[._-]/g, "");
}

// per-model 图标覆盖（优先级高于 BRAND_LOGO）
const MODEL_ICON_OVERRIDE = {
    "kat-coder-pro-v2": "./kwaikat.svg",
    "cancriv1-0.1b": "../Logo/Cancri1.jpg",
    "nex-n2-pro-welfare": "./NEX_logo.svg",
    "hunyuan-mt-7b": "./yuanbao-color.svg",
};

function brandLogoHtml(brand, modelId) {
    const override = modelId && MODEL_ICON_OVERRIDE[modelId];
    const key = normalizeBrandKey(brand);
    // 2026-05-17 别名归一：
    //   - inclusionai → antgroup：Inclusion AI 是蚂蚁集团的开源 AI 团队，
    //     用 antgroup-color.svg 表达母实体归属，与公司认知一致。
    //   - 之前误用 yuanbao（Ant Ling/百灵 logo）已纠正。
    // 未来如果拿到专属 Inclusion AI / Ling logo，在 BRAND_LOGO 直接加
    // inclusionai / ling key 覆盖此别名即可。
    const ALIAS = { inclusionai: "antgroup", "小米mimo": "xiaomimimo" };
    const url = override || BRAND_LOGO[ALIAS[key] || key];
    const themeAdaptive = window.CancriThemeIcons
        ? window.CancriThemeIcons.shouldUseThemeAdaptiveIcon(url, brand)
        : key === "openai" || key === "cancri";
    const themeClass = themeAdaptive ? "model-icon-theme-adaptive" : "";
    if (url) {
        return `<span class="card-logo" aria-hidden="true"><img${themeClass ? ` class="${themeClass}"` : ""} src="${url}" alt="" loading="lazy" decoding="async" /></span>`;
    }
    // fallback：品牌首字母圈。采用 cream 色背、clay 色字，跟主调一致。
    const initial = (String(brand || "?").trim()[0] || "?").toUpperCase();
    return `<span class="card-logo card-logo--fallback" aria-hidden="true">${esc(
        initial,
    )}</span>`;
}

function isQqBrowser() {
    return /QQBrowser|MQQBrowser|QQ\//i.test(navigator.userAgent || "");
}

function catalogFetchOptions() {
    return {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: ANON,
        },
        body: JSON.stringify({ endpoint: "model_public_catalog" }),
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
    };
}

/** 不用 AbortController：QQ 浏览器对 signal 兼容差，易误 abort 或一直挂起 */
function fetchCatalogOnce(url, options, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error("request_timeout"));
        }, timeoutMs);

        fetch(url, options)
            .then((resp) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(resp);
            })
            .catch((err) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
    });
}

function catalogGatewayCandidates() {
    const primary = (GW || "").replace(/\/+$/, "");
    const list = [];
    if (primary) list.push(primary);
    if (primary.indexOf("chat.nexusvai.xyz") !== -1) {
        list.push(GW_SUPABASE_DIRECT);
    } else if (primary.indexOf("supabase.co") === -1) {
        list.push(GW_SUPABASE_DIRECT);
    }
    return list.filter((url, idx, arr) => arr.indexOf(url) === idx);
}

async function fetchModelCatalog() {
    const options = catalogFetchOptions();
    const urls = catalogGatewayCandidates();
    if (!urls.length) throw new Error("网关地址未配置");

    // 2026-06-10：QQ 与其它浏览器统一优先 CF（chat.nexusvai.xyz）。
    // Supabase 仅作 CF 超时/失败后的回退。

    let lastErr = null;
    for (let i = 0; i < urls.length; i++) {
        const timeoutMs = i === 0 ? (isQqBrowser() ? 18000 : 10000) : 20000;
        try {
            const resp = await fetchCatalogOnce(urls[i], options, timeoutMs);
            if (resp.ok) return resp;
            lastErr = new Error("HTTP " + resp.status);
        } catch (e) {
            lastErr = e;
        }
    }

    if (lastErr && lastErr.message === "request_timeout") {
        throw new Error("请求超时，请检查网络后刷新");
    }
    throw lastErr || new Error("加载模型列表失败");
}

function showLoadError(message) {
    if (window.PlatformSkeleton) PlatformSkeleton.hide("loading");
    const err = $("error");
    if (err) {
        err.style.display = "block";
        err.textContent = "加载失败：" + message;
    }
}

function clearStatsSkeleton() {
    ["#total", "#ct-free", "#ct-paid", "#ct-thinking"].forEach(function (sel) {
        var el = document.querySelector(sel);
        if (!el) return;
        el.classList.remove("platform-skeleton-block", "platform-skeleton-shimmer");
        el.style.minWidth = "";
        el.style.minHeight = "";
    });
}

function syncFilterSlider(group) {
    if (!group) return;
    const slider = group.querySelector(".filter-slider");
    const active = group.querySelector(".filter-btn.active");
    if (!slider || !active) return;
    slider.style.width = active.offsetWidth + "px";
    slider.style.transform = "translateX(" + active.offsetLeft + "px)";
}

function initFilterSliders() {
    syncFilterSlider($("capFilter"));
    syncFilterSlider($("tierFilter"));
}

function setActiveFilterBtn(group, btn, attr) {
    if (!group || !btn) return;
    group.querySelectorAll(".filter-btn").forEach((x) => {
        x.classList.remove("active");
    });
    btn.classList.add("active");
    syncFilterSlider(group);
    return btn.getAttribute(attr);
}

async function load() {
    try {
        if (!window.__SUPABASE_URL__ || !ANON) {
            throw new Error("站点配置未就绪，请刷新页面");
        }
        const resp = await fetchModelCatalog();
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        if (data && data.multiplier_legend) {
            Object.assign(COST_TIER_MULTIPLIER, data.multiplier_legend);
        }
        // Aggregate raw entries by canonicalId so this page never exposes
        // upstream-leaking ids (e.g. -iamhc / -api456 / -chunxue). Mirrors
        // the same dedup api-gateway does for /v1/models. The user-facing
        // model id is the clean brand canonicalId; multiple upstream lines
        // appear as one card with a redundancy badge.
        const raw = Array.isArray(data.models) ? data.models : [];
        const byCanonical = new Map();
        for (const m of raw) {
            const cid = m.canonicalId || m.id;
            if (!byCanonical.has(cid)) {
                byCanonical.set(cid, { ...m, id: cid, _lineCount: 1 });
            } else {
                const existing = byCanonical.get(cid);
                existing._lineCount += 1;
                const mergedDesc = m.publicDescription || existing.publicDescription;
                if (existing.available === false && m.available !== false) {
                    byCanonical.set(cid, {
                        ...existing,
                        ...m,
                        id: cid,
                        _lineCount: existing._lineCount,
                        publicDescription: mergedDesc,
                    });
                } else if (mergedDesc && !existing.publicDescription) {
                    existing.publicDescription = mergedDesc;
                }
            }
        }
        mergeEnsuredCatalogModels(byCanonical);
        // 黑名单过滤后再写入 MODELS，让 stats / 过滤 / 渲染统一基于已清洗的列表
        MODELS = sortModelsFeaturedFirst(
            Array.from(byCanonical.values()).filter((m) => {
                const id = m.id || m.canonicalId || "";
                return !HIDE_IDS.has(id);
            }),
        );
        // 给每条模型挂上展示用的 displayTier（缓存计算结果，避免渲染时反复算）
        for (const m of MODELS) m._displayTier = getDisplayTier(m);
        const loadingEl = $("loading");
        const gridEl = $("grid");
        if (window.PlatformSkeleton) PlatformSkeleton.hide(loadingEl);
        else if (loadingEl) loadingEl.style.display = "none";
        if (gridEl) gridEl.style.display = "grid";
        setupGridCollapse();
        buildBrandFilter();
        updateStats();
        render();
        requestAnimationFrame(() => {
            initFilterSliders();
            if ($("gridStage")) {
                const { fullH, collapsedH } = getGridHeights();
                applyGridStageHeight(
                    gridListExpanded ? fullH : collapsedH,
                );
            }
        });
    } catch (e) {
        const msg =
            e && e.name === "AbortError"
                ? "请求超时，请检查网络后刷新"
                : e && e.message
                  ? e.message
                  : String(e);
        showLoadError(msg);
    }
}

// 2026-05-17 stats 重构后 HTML 只有 4 块：total / ct-free / ct-paid / ct-thinking。
// 老版本还有 ct-multi（多模态），重写 HTML 时把那块换成了「支持思考」。如果
// 这里继续写 $("ct-multi").textContent，第一次 load 会因为 null.textContent
// 直接抛 "Cannot set properties of null"，updateStats 中断 → render 也不会跑
// → 页面看似一片空白；用户再点 filter 触发的 render 跳过 updateStats，所以
// 又能渲染。删 ct-multi 这一行即彻底修复。
function updateStats() {
    const totalEl = $("total");
    const freeEl = $("ct-free");
    const paidEl = $("ct-paid");
    const thinkingEl = $("ct-thinking");
    if (!totalEl || !freeEl || !paidEl || !thinkingEl) return;
    clearStatsSkeleton();
    totalEl.textContent = MODELS.length;
    freeEl.textContent = MODELS.filter(
        (m) => m._displayTier === "free",
    ).length;
    paidEl.textContent = MODELS.filter(
        (m) => m._displayTier === "paid",
    ).length;
    thinkingEl.textContent = MODELS.filter(
        (m) => m.enableThinking,
    ).length;
}

function passCap(m) {
    if (activeCap === "all") return true;
    if (activeCap === "chat") return m.chat;
    if (activeCap === "image") return m.image;
    if (activeCap === "multimodal") return m.multimodal;
    if (activeCap === "thinking") return m.enableThinking;
    return true;
}

function passTier(m) {
    if (activeTier === "all") return true;
    return m._displayTier === activeTier;
}

function passBrand(m) {
    if (activeBrand === "all") return true;
    // 同 key 同品牌：看 normalize 后的是否一致。这样 "Inclusion AI" 与
    // "InclusionAI" 点同一 chip 都能换运运走。
    return normalizeBrandKey(m.brand) === activeBrand;
}

// 2026-05-17 构建品牌筛选 chip 行。按 (品牌, 模型数) 降序。同名不同大
// 小写的品牌合并（以 normalizeBrandKey 为唯一 key）。显示名字取首次
// 出现的原始字符串（最能代表品牌原貌，如 "DeepSeek" 而非全小写 slug）。
function buildBrandFilter() {
    const host = $("brandFilter");
    if (!host) return;
    // 聚合：key -> { displayName, count }
    const agg = new Map();
    for (const m of MODELS) {
        const raw = (m.brand || "").trim();
        if (!raw) continue;
        const key = normalizeBrandKey(raw);
        if (!key) continue;
        const prev = agg.get(key);
        if (prev) {
            prev.count += 1;
        } else {
            agg.set(key, { displayName: raw, count: 1 });
        }
    }
    const sorted = Array.from(agg.entries()).sort(
        (a, b) => b[1].count - a[1].count || a[1].displayName.localeCompare(b[1].displayName),
    );

    const pieces = [
        `<button class="brand-chip ${activeBrand === "all" ? "is-active" : ""}" type="button" data-brand="all">
           <span class="brand-chip-all" aria-hidden="true">✱</span>
           <span class="brand-chip-name">全部品牌</span>
           <span class="brand-chip-count">${MODELS.length}</span>
         </button>`,
    ];
    for (const [key, info] of sorted) {
        const active = key === activeBrand ? "is-active" : "";
        pieces.push(
            `<button class="brand-chip ${active}" type="button" data-brand="${esc(key)}" title="${esc(info.displayName)}">
              ${brandLogoHtml(info.displayName)}
              <span class="brand-chip-name">${esc(info.displayName)}</span>
              <span class="brand-chip-count">${info.count}</span>
            </button>`,
        );
    }
    host.innerHTML = pieces.join("");
}

function passSearch(m, q) {
    if (!q) return true;
    const t = q.toLowerCase();
    return (
        (m.id || "").toLowerCase().includes(t) ||
        (m.displayName || "").toLowerCase().includes(t) ||
        (m.brand || "").toLowerCase().includes(t) ||
        (m.canonicalId || "").toLowerCase().includes(t)
    );
}

function render() {
    const q = $("search").value.trim();
    const filtered = MODELS.filter(
        (m) => passCap(m) && passTier(m) && passBrand(m) && passSearch(m, q),
    );
    if (filtered.length === 0) {
        $("grid").style.display = "none";
        $("empty").style.display = "block";
        updateGridCollapse(0);
        return;
    }
    $("grid").style.display = "grid";
    $("empty").style.display = "none";
    $("grid").innerHTML = filtered.map(card).join("");
    updateGridCollapse(filtered.length);
    $("grid")
        .querySelectorAll("[data-copy]")
        .forEach((el) => {
            let copyTimer = null;
            el.addEventListener("click", () => {
                navigator.clipboard.writeText(el.dataset.copy).then(() => {
                    if (copyTimer) clearTimeout(copyTimer);
                    const orig = el.textContent;
                    el.textContent = "已复制";
                    el.classList.add("copied");
                    copyTimer = setTimeout(() => {
                        el.textContent = orig;
                        el.classList.remove("copied");
                        copyTimer = null;
                    }, 1200);
                }).catch(() => {});
            });
        });
}

function card(m) {
    const disabled = m.available === false || m.disabled === true;
    const caps = [];
    if (m.chat) caps.push("聊天");
    if (m.image) caps.push("图像");
    if (m.multimodal) caps.push("多模态");
    if (m.enableThinking) caps.push("思考");
    if (m.arena) caps.push("竞技场");
    // 2026-05-17 二档化：tier badge 仅两种（FREE / PAID）。CSS 类名
    // 与二者同名：.tier-free / .tier-paid。原 .tier-cheap / -normal /
    // -expensive / -vip 在 api_models.html 重写后也被删。
    const displayTier = m._displayTier || getDisplayTier(m);
    const tierClass = "tier-" + displayTier;
    // 2026-05-24: 福利档 = "福利" 标签，区别于 FREE / PAID。
    const tierLabel = displayTier === "paid" ? "PAID"
        : displayTier === "welfare" ? "福利"
        : "FREE";
    // 2026-05-17 Phase A：vip 模型（costTier === 'vip'）= Claude Opus 系列，
    // 需要 Pro+ 以上订阅。在 PAID badge 旁多挂一个 PRO+ 标识，让用户一眼看出。
    const isProPlusOnly = m.costTier === "vip";
    const proPlusBadge = isProPlusOnly
        ? '<span class="tier" style="background:rgba(96,165,250,.18);color:#60a5fa" title="该模型仅 Pro+ 以上订阅可用">PRO+</span>'
        : "";
    const proMaxBadge = m && m.proMaxOnly
        ? '<span class="tier" style="background:rgba(168,85,247,.18);color:#a855f7" title="该模型仅 Pro Max 订阅可用">PRO MAX</span>'
        : "";
    // 2026-05-18 计费倍率徽章：显示 0.5× / 1× / 2× / 5× / 15×（2026-05-29 下调）。
    // 与 chat-gateway MODEL_COST_MULTIPLIER 一致：free=0.5, cheap=1, normal=2,
    // expensive=5, vip=15（实时还会被 catalog 的 multiplier_legend 覆盖）。样式跟 PRO+ 徽章同位，颜色 amber/clay。
    // 2026-05-22 限时 5 折促销期间：徽章变红，显示折后倍率，title 标明原价。
    const mult = getCostMultiplier(m);
    const promoActive = isPromoActive();
    const effMult = mult * getPromoDiscount();
    const multiplierBadge = promoActive
        ? `<span class="tier" style="background:rgba(212,160,77,.16);color:#d4a04d;font-weight:600" title="限时 5 折：原 ${fmtMult(mult)} → 折后 ${fmtMult(effMult)}（窗口截止 05-24 00:00 UTC+8）">${fmtMult(effMult)} <span style="opacity:.55;font-size:10px;text-decoration:line-through">${fmtMult(mult)}</span></span>`
        : `<span class="tier" style="background:rgba(212,160,77,.16);color:#d4a04d" title="计费倍率：上游 token × ${mult} 后进入配额决算">${mult}×</span>`;
    // 2026-05-18 FREE 不可用提示：GPT-5.5 系列 / gemini-3.1-pro / gpt-5.4-mini
    // 对 FREE 用户硬挡。freeUserBlocked 字段来自 chat-gateway model_public_catalog。
    const freeBlockedBadge = m && m.freeUserBlocked
        ? '<span class="tier" style="background:rgba(232,90,90,.16);color:#e85a5a" title="FREE 用户禁止调用该模型">FREE 不可用</span>'
        : "";
    const disabledBadge = disabled
        ? '<span class="tier tier-disabled" title="该模型线路当前不可用">不可用</span>'
        : "";
    const inputK = m.maxInputTokens
        ? m.maxInputTokens >= 1000
            ? Math.round(m.maxInputTokens / 1000) + "K"
            : m.maxInputTokens
        : "—";
    const outputK = m.maxOutputTokens
        ? m.maxOutputTokens >= 1000
            ? Math.round(m.maxOutputTokens / 1000) + "K"
            : m.maxOutputTokens
        : "—";
    // 2026-05-17 head 改版：左边 logo + 右边 （名称 / brand 子标题 / id）
    // brand 从 .meta badge 升级为名称下面的 sub-title，逻辑上与 logo 互补，
    // 避免 brand badge 与 logo 重复。
    const unavailableMessage = m.unavailableMessage || "该模型线路当前不可用，请稍后重试或切换其他模型。";
    const metaHtml = (m._lineCount > 1 || disabled)
        ? `<div class="meta">
            ${m._lineCount > 1 ? `<span class="badge" title="多条上游冷备，后端自动选最优">${m._lineCount} 条冷备</span>` : ""}
            ${disabled ? `<span class="badge badge-disabled">${esc(unavailableMessage)}</span>` : ""}
          </div>`
        : "";
    const capsHtml = caps.length
        ? `<div class="caps">${caps.map((c) => `<span class="cap">${esc(c)}</span>`).join("")}</div>`
        : "";
    // 2026-05-22 增 data-model-id：抽屉点击委托靠它从 MODELS 反查模型对象。
    // 2026-06-21：将头部所有徽章合并为一条 status bar，能力标签移到 specs 下方。
    return `<div class="card${disabled ? " is-disabled" : ""}" data-tier="${displayTier}" data-model-id="${esc(m.id)}" tabindex="0" role="button" aria-label="${esc(m.displayName || m.id)} — 查看详情"${disabled ? ` title="${esc(unavailableMessage)}"` : ""}>
          <div class="card-head">
            ${brandLogoHtml(m.brand, m.id)}
            <div class="card-head-text">
              <div class="card-name">${esc(m.displayName || m.id)}</div>
              ${m.brand ? `<div class="card-brand">${esc(m.brand)}</div>` : ""}
              <div class="card-id" title="点击复制">${esc(m.id)}</div>
              ${m.publicDescription ? `<div class="card-desc">${esc(m.publicDescription)}</div>` : ""}
            </div>
            <div class="card-status">
              <span class="tier ${tierClass}">${tierLabel}</span>
              ${multiplierBadge}
              ${proPlusBadge}
              ${proMaxBadge}
              ${freeBlockedBadge}
              ${disabledBadge}
            </div>
          </div>
          ${metaHtml}
          <div class="specs">
            <span class="spec"><span class="spec-key">输入</span><b>${inputK}</b></span>
            <span class="spec"><span class="spec-key">输出</span><b>${outputK}</b></span>
          </div>
          ${capsHtml}
          <button class="copy-btn" data-copy="${esc(m.id)}">复制 model ID</button>
        </div>`;
}

function bindFilterEvents() {
    const searchEl = $("search");
    if (searchEl) searchEl.addEventListener("input", render);

    const capFilter = $("capFilter");
    if (capFilter) {
        capFilter.addEventListener("click", (e) => {
            const b = e.target.closest("[data-cap]");
            if (!b) return;
            activeCap = setActiveFilterBtn(capFilter, b, "data-cap") || "all";
            render();
        });
    }

    const tierFilter = $("tierFilter");
    if (tierFilter) {
        tierFilter.addEventListener("click", (e) => {
            const b = e.target.closest("[data-tier]");
            if (!b) return;
            activeTier = setActiveFilterBtn(tierFilter, b, "data-tier") || "all";
            render();
        });
    }

    window.addEventListener("resize", () => {
        initFilterSliders();
    });
}

// 品牌 chip 路线与上面两组一致：事件委托 + 独点切换。同一个 chip 再点
// 一次不会切回 "all"（与 segmented 一致）。
const brandFilterEl = $("brandFilter");
if (brandFilterEl) {
    brandFilterEl.addEventListener("click", (e) => {
        const b = e.target.closest("[data-brand]");
        if (!b) return;
        brandFilterEl
            .querySelectorAll(".brand-chip")
            .forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        activeBrand = b.dataset.brand;
        render();
    });
}

// ── 模型卡片右侧抽屉 (2026-05-22 新增) ────────────────────────────────────
// 点击卡片任意非 .copy-btn 区域 → openDrawer(model)；展示：
//   1) 模型 head + tier/multiplier badges
//   2) 倍率与档位说明（基于 m.costTier 推断）
//   3) 近期状态：聚合 chat-gateway model_health 的成功率 / 平均延迟 / 24h
//      hourly 列；用 SVG bar sparkline 渲染请求量
//   4) 调用代码：curl / Node.js / Python，自动从 sessionStorage('cancri_recent_api_key')
//      读最近一次在 Keys 页生成的 Key（仅当前会话有效），未有则用占位符
//      cancri_sk_YOUR_KEY，并在底部提示用户去 Keys 页生成。
// ─────────────────────────────────────────────────────────────────────

const SESSION_KEY_NAME = "cancri_recent_api_key";
const KEY_PAGE_URL = "./api_keys.html";
const API_BASE_URL =
    (window.__SUPABASE_URL__ || "") + "/functions/v1/api-gateway";

const COST_TIER_EXPLAIN = {
    free: "FREE 档：所有用户免费调用，受免费档限速 (10 RPM / 60 RPH / 1000 RPD，并发 2)。",
    cheap: "Cheap：1× 倍率。轻量、低成本模型；价格友好。",
    normal: "Normal：3× 倍率。GPT-4 类标准模型 / Doubao / Kimi / Haiku 等。",
    expensive:
        "Expensive：10× 倍率。GPT-5.x 系列、Mistral Large 等前沿旗舰模型。",
    vip: "VIP：30× 倍率。Claude Opus 4.5 / Gemini 3.1 Pro / 视频生成等顶配（仅 Pro+ 起可用）。",
};

const drawer = document.getElementById("modelDrawer");
const drawerBackdrop = document.getElementById("modelDrawerBackdrop");
const drawerClose = document.getElementById("modelDrawerClose");
const drawerCodeTabs = document.getElementById("drawerCodeTabs");
const drawerCodeEl = document.getElementById("drawerCode");
const drawerCodeCopyBtn = document.getElementById("drawerCodeCopy");
const drawerSpark = document.getElementById("drawerSpark");

let drawerActiveModel = null;
let drawerActiveLang = "curl";
let modelHealthMap = null;
let modelHealthFetchPromise = null;
let drawerCloseTimer = null;

function getCachedApiKey() {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY_NAME);
        if (!raw) return null;
        // 只接受合法 cancri_sk_ + 48 字 base64url。防止用户随手往
        // sessionStorage 塞了不合法字符串导致代码示例破损。
        return /^cancri_sk_[A-Za-z0-9_-]{48}$/.test(raw) ? raw : null;
    } catch (_) {
        return null;
    }
}

function openDrawer(model) {
    if (!drawer) return;
    drawerActiveModel = model;
    if (drawerCloseTimer) {
        clearTimeout(drawerCloseTimer);
        drawerCloseTimer = null;
    }
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    // requestAnimationFrame 让 transition 从 hidden→visible 生效
    requestAnimationFrame(() => drawer.classList.add("is-open"));
    document.body.style.overflow = "hidden";
    populateDrawer(model);
    fetchModelHealthOnce()
        .then(() => renderDrawerStatus(model))
        .catch(() => renderDrawerStatusError());
}

function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    drawerCloseTimer = setTimeout(() => {
        drawer.hidden = true;
        drawerCloseTimer = null;
    }, 280);
    document.body.style.overflow = "";
    drawerActiveModel = null;
}

function populateDrawer(m) {
    // Header
    const logoHost = document.getElementById("modelDrawerLogo");
    if (logoHost) logoHost.innerHTML = brandLogoHtml(m.brand, m.id);
    const nameEl = document.getElementById("modelDrawerName");
    if (nameEl) nameEl.textContent = m.displayName || m.id;
    const brandEl = document.getElementById("modelDrawerBrand");
    if (brandEl) brandEl.textContent = m.brand || "";
    const idEl = document.getElementById("modelDrawerId");
    if (idEl) idEl.textContent = m.id;

    // Badges
    const tier = m._displayTier || getDisplayTier(m);
    const mult = getCostMultiplier(m);
    const drawerPromoActive = isPromoActive();
    const drawerEffMult = mult * getPromoDiscount();
    const tierLabel = tier === "paid" ? "PAID" : "FREE";
    const multBadge = drawerPromoActive
        ? `<span class="tier" style="background:rgba(212,160,77,.16);color:#d4a04d;font-weight:600" title="限时 5 折：原 ${fmtMult(mult)} → 折后 ${fmtMult(drawerEffMult)}（窗口截止 05-24 00:00 UTC+8）">${fmtMult(drawerEffMult)} <span style="opacity:.55;font-size:10px;text-decoration:line-through">${fmtMult(mult)}</span></span>`
        : `<span class="tier" style="background:rgba(212,160,77,.16);color:#d4a04d" title="计费倍率：上游 token × ${mult} 后入桶">${mult}×</span>`;
    const badges = [
        `<span class="tier tier-${tier}">${tierLabel}</span>`,
        multBadge,
    ];
    if (m.costTier === "vip") {
        badges.push(
            '<span class="tier" style="background:rgba(96,165,250,.18);color:#60a5fa" title="该模型仅 Pro+ 以上订阅可用">PRO+</span>',
        );
    }
    if (m && m.proMaxOnly) {
        badges.push(
            '<span class="tier" style="background:rgba(168,85,247,.18);color:#a855f7" title="该模型仅 Pro Max 订阅可用">PRO MAX</span>',
        );
    }
    if (m && m.freeUserBlocked) {
        badges.push(
            '<span class="tier" style="background:rgba(232,90,90,.16);color:#e85a5a" title="FREE 用户禁止调用该模型">FREE 不可用</span>',
        );
    }
    if (m.available === false || m.disabled === true) {
        badges.push(
            '<span class="tier tier-disabled" title="该模型线路当前不可用">不可用</span>',
        );
    }
    const badgeHost = document.getElementById("modelDrawerBadges");
    if (badgeHost) badgeHost.innerHTML = badges.join("");

    // Pricing / multiplier
    const multNumEl = document.getElementById("drawerMultNum");
    if (multNumEl) {
        if (drawerPromoActive) {
            multNumEl.innerHTML =
                `<span style="color:var(--accent)">${fmtMult(drawerEffMult)}</span>` +
                ` <span style="font-size:.45em;color:var(--text-faint);text-decoration:line-through;font-weight:400">${fmtMult(mult)}</span>`;
        } else {
            multNumEl.textContent = mult + "×";
        }
    }
    const tierLabelEl = document.getElementById("drawerTierLabel");
    if (tierLabelEl) {
        const promoTag = drawerPromoActive
            ? ' · <span style="color:var(--accent);font-weight:600">限时 5 折</span>'
            : "";
        tierLabelEl.innerHTML = `<span class="tier tier-${tier}">${tierLabel}</span> · costTier <code>${esc(m.costTier || "normal")}</code>${promoTag}`;
    }
    const explainEl = document.getElementById("drawerPricingExplain");
    if (explainEl) {
        let baseExplain = COST_TIER_EXPLAIN[m.costTier || "normal"] || "";
        if (m && typeof m.customMultiplier === "number") {
            const defMult = coalesce(
                COST_TIER_MULTIPLIER[m.costTier || "normal"],
                1,
            );
            if (m.customMultiplier < defMult) {
                baseExplain += ` (已为您特惠降费：该模型原定为 ${defMult}x 倍率，当前特殊降为 ${m.customMultiplier}x 倍率，高频聊天或 IDE 开发极其经用划算！)`;
            } else if (m.customMultiplier > defMult) {
                baseExplain += ` (自定义计费调整：为了对齐昂贵的上游进货成本，该模型特殊调整为 ${m.customMultiplier}x 倍率。)`;
            }
        }
        const formula = drawerPromoActive
            ? `<code>effective_pool_tokens × <s>${mult}</s> ${fmtMult(drawerEffMult)}</code>（5 折促销窗口截止 05-24 00:00 UTC+8）`
            : `<code>effective_pool_tokens × ${mult}</code>`;
        explainEl.innerHTML =
            esc(baseExplain) +
            ` 每次成功调用扣减 ${formula}。`;
    }

    // Status placeholder（fetch 完成后会被覆盖）
    const setStat = (id, text, state) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        if (state) el.dataset.state = state;
        else el.removeAttribute("data-state");
    };
    setStat("dsSuccessRate", "—");
    setStat("dsLatency", "—");
    setStat("dsRequests", "—");
    if (drawerSpark) drawerSpark.innerHTML = "";
    const hint = document.getElementById("drawerStatusHint");
    if (hint) {
        hint.textContent = "数据加载中…";
        hint.classList.remove("drawer-status-hint--err");
    }

    // Code tab：每次打开抽屉默认回到 curl，避免上一次 model 选 py 的状态泄露
    drawerActiveLang = "curl";
    if (drawerCodeTabs) {
        drawerCodeTabs.querySelectorAll(".drawer-code-tab").forEach((t) =>
            t.classList.toggle("is-active", t.dataset.lang === "curl"),
        );
    }
    renderDrawerCode(m);
}

function renderDrawerCode(m) {
    if (!drawerCodeEl) return;
    const id = m.id;
    const apiKey = getCachedApiKey() || "cancri_sk_YOUR_KEY";
    let code = "";
    if (drawerActiveLang === "curl") {
        code = `curl ${API_BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${id}",
    "messages": [{"role":"user","content":"你好"}]
  }'`;
    } else if (drawerActiveLang === "js") {
        code = `// npm i openai
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${apiKey}",
  baseURL: "${API_BASE_URL}/v1",
});

const r = await client.chat.completions.create({
  model: "${id}",
  messages: [{ role: "user", content: "你好" }],
});
console.log(r.choices[0].message.content);`;
    } else if (drawerActiveLang === "py") {
        code = `# pip install openai
from openai import OpenAI

client = OpenAI(
    api_key="${apiKey}",
    base_url="${API_BASE_URL}/v1",
)

r = client.chat.completions.create(
    model="${id}",
    messages=[{"role": "user", "content": "你好"}],
)
print(r.choices[0].message.content)`;
    }
    drawerCodeEl.textContent = code;

    const hintEl = document.getElementById("drawerCodeHint");
    if (hintEl) {
        if (getCachedApiKey()) {
            hintEl.innerHTML = `代码已自动填入本会话生成的 Key。关闭浏览器后此 Key 会被清空，需要再次到 <a href="${KEY_PAGE_URL}">Keys 页</a> 重新生成。`;
        } else {
            hintEl.innerHTML = `代码中 <code>cancri_sk_YOUR_KEY</code> 为占位符。请到 <a href="${KEY_PAGE_URL}">Keys 页</a> 生成新 Key 后回到本页，会话内即可自动填入完整 Key。`;
        }
    }
}

async function fetchModelHealthOnce() {
    if (modelHealthMap) return;
    if (modelHealthFetchPromise) return modelHealthFetchPromise;
    modelHealthFetchPromise = (async () => {
        const r = await fetch(GW, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: ANON },
            body: JSON.stringify({ endpoint: "model_health", window_days: 1 }),
        });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const data = await r.json();
        modelHealthMap = new Map();
        for (const m of data.models || []) {
            modelHealthMap.set(m.model_id, m);
        }
    })();
    return modelHealthFetchPromise;
}

function renderDrawerStatus(model) {
    if (!modelHealthMap) return;
    if (!drawerActiveModel || drawerActiveModel.id !== model.id) return;
    const h = modelHealthMap.get(model.id);
    const setStat = (id, text, state) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        if (state) el.dataset.state = state;
        else el.removeAttribute("data-state");
    };

    if (!h) {
        setStat("dsSuccessRate", "—");
        setStat("dsLatency", "—");
        setStat("dsRequests", "0");
        const hint = document.getElementById("drawerStatusHint");
        if (hint) {
            hint.textContent = "近 24 小时无调用数据。";
            hint.classList.remove("drawer-status-hint--err");
        }
        if (drawerSpark) renderSparkline([]);
        return;
    }

    const sr = Number.isFinite(h.success_rate) ? h.success_rate : null;
    if (sr !== null) {
        setStat(
            "dsSuccessRate",
            sr + "%",
            sr >= 95 ? "good" : sr >= 80 ? "warn" : "bad",
        );
    } else {
        setStat("dsSuccessRate", "—");
    }

    const lat = Number.isFinite(h.avg_latency_ms) ? h.avg_latency_ms : null;
    if (lat !== null) {
        const text = lat < 1000 ? lat + " ms" : (lat / 1000).toFixed(1) + " s";
        setStat(
            "dsLatency",
            text,
            lat < 2000 ? "good" : lat < 5000 ? "warn" : "bad",
        );
    } else {
        setStat("dsLatency", "—");
    }

    setStat("dsRequests", (h.total_requests || 0).toLocaleString());

    const hint = document.getElementById("drawerStatusHint");
    if (hint) {
        const status = h.status || "unknown";
        hint.classList.remove("drawer-status-hint--err");
        if (status === "operational") {
            hint.textContent = `近 24 小时共 ${h.total_requests || 0} 次请求，状态正常。`;
        } else if (status === "degraded") {
            hint.textContent = `近 24 小时部分降级（成功率 ${coalesce(sr, "?")}%），建议优先选其他模型。`;
            hint.classList.add("drawer-status-hint--err");
        } else if (status === "down") {
            hint.textContent = `近 24 小时不可用（成功率 ${coalesce(sr, "?")}%），暂时跳过此模型。`;
            hint.classList.add("drawer-status-hint--err");
        } else {
            hint.textContent = "近 24 小时数据样本较少，状态未知。";
        }
    }

    renderSparkline(h.hourly || []);
}

function renderSparkline(hourly) {
    if (!drawerSpark) return;
    const W = 320;
    const H = 60;
    if (!hourly.length || hourly.every((h) => !h.total)) {
        drawerSpark.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" dominant-baseline="middle" fill="currentColor" font-size="11" opacity="0.55">暂无 24h 调用样本</text>`;
        return;
    }
    const maxTotal = Math.max(1, ...hourly.map((h) => h.total));
    const slot = (W - 4) / hourly.length;
    let svg = "";
    hourly.forEach((h, i) => {
        const ratio = h.total / maxTotal;
        const barH = ratio * (H - 8);
        const x = 2 + i * slot;
        const y = H - 4 - barH;
        const w = Math.max(1, slot - 2);
        const sr = Number.isFinite(h.success_rate) ? h.success_rate : null;
        const isDown = h.total > 0 && sr !== null && sr < 50;
        const cls = isDown
            ? "drawer-spark-bar drawer-spark-bar--down"
            : "drawer-spark-bar";
        svg += `<rect class="${cls}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${Math.max(0.5, barH).toFixed(2)}" rx="0.8"></rect>`;
    });
    drawerSpark.innerHTML = svg;
}

function renderDrawerStatusError() {
    const hint = document.getElementById("drawerStatusHint");
    if (hint) {
        hint.textContent = "状态数据获取失败，请稍后重试。";
        hint.classList.add("drawer-status-hint--err");
    }
}

if (drawer) {
    drawerClose && drawerClose.addEventListener("click", closeDrawer);
    drawerBackdrop && drawerBackdrop.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !drawer.hidden) closeDrawer();
    });

    if (drawerCodeTabs) {
        drawerCodeTabs.addEventListener("click", (e) => {
            const btn = e.target.closest(".drawer-code-tab");
            if (!btn) return;
            drawerActiveLang = btn.dataset.lang;
            drawerCodeTabs.querySelectorAll(".drawer-code-tab").forEach((t) =>
                t.classList.toggle("is-active", t === btn),
            );
            if (drawerActiveModel) renderDrawerCode(drawerActiveModel);
        });
    }
    if (drawerCodeCopyBtn && drawerCodeEl) {
        let copyTimer = null;
        drawerCodeCopyBtn.addEventListener("click", () => {
            const text = drawerCodeEl.textContent;
            if (!text) return;
            navigator.clipboard
                .writeText(text)
                .then(() => {
                    if (copyTimer) clearTimeout(copyTimer);
                    drawerCodeCopyBtn.textContent = "已复制";
                    drawerCodeCopyBtn.classList.add("is-copied");
                    copyTimer = setTimeout(() => {
                        drawerCodeCopyBtn.textContent = "复制";
                        drawerCodeCopyBtn.classList.remove("is-copied");
                        copyTimer = null;
                    }, 1200);
                })
                .catch(() => {});
        });
    }
}

// 卡片点击委托：用 #grid 一个 listener 处理所有 card；render() 重置
// innerHTML 时不会丢监听，因为 #grid 本身从不被替换。
const gridEl = $("grid");
if (gridEl && drawer) {
    gridEl.addEventListener("click", (e) => {
        const card = e.target.closest(".card");
        if (!card) return;
        // 复制按钮的点击有自己的处理（写剪贴板），不开抽屉
        if (e.target.closest(".copy-btn")) return;
        const modelId = card.dataset.modelId;
        if (!modelId) return;
        const m = MODELS.find((x) => x.id === modelId);
        if (!m) return;
        openDrawer(m);
    });
    // 键盘可达：Enter / Space 也能打开抽屉
    gridEl.addEventListener("keydown", (e) => {
        const card = e.target.closest(".card");
        if (!card) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest(".copy-btn")) return;
        e.preventDefault();
        const modelId = card.dataset.modelId;
        const m = MODELS.find((x) => x.id === modelId);
        if (m) openDrawer(m);
    });
}

function boot() {
    try {
        bindFilterEvents();
        initFilterSliders();
        load();
    } catch (e) {
        showLoadError((e && e.message) || String(e));
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
    boot();
}
