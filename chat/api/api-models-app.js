// api_models.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_models.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
// 本页原 inline 代码已使用 addEventListener / data-copy 委托，无 inline onclick。

const GW = window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";
const ANON = window.__SUPABASE_ANON_KEY__;
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
const HIDE_IDS = new Set([
    "grok-imagine-image-lite",
    "gpt-image-2",
    "tongyi-xiaomi-analysis-pro",
    "gui-plus",
    "mistral-medium-3-5",
    "ministral-14b-2512",
    "mistral-large-2512",
    "mistral-small-2603",
    "or:arcee-ai/trinity-large-thinking",
]);

// 2026-05-17 模型广场档位二档化：仅 FREE / PAID。
// 规则（用户 2026-05-17 09:50 UTC+08 指令字面对应）：
//   1) brand === "Anthropic" 全部 PAID（覆盖 Claude 全系列变体，包括
//      未来新增的 Sonnet / Haiku / Opus 子型，无需追加 ID）
//   2) 下面这份精确 ID 列表 PAID：GPT-5.4 / 5.5 / 5.3-codex、Gemini 3.1
//      Pro、GLM 5.1、DeepSeek V4 Pro、Qwen 3.6 Max、MiniMax M2.7、Kimi K2.6
//   3) 其余全部 FREE（包括 OSS、Nemotron、Gemma、Qwen3 子型、Doubao、Step、
//      DeepSeek V3 系、GLM 4.x、视频生成等）
// 不修改后端 costTier 字段：聊天页 / 速率表 / 计费仍按真实档位走。
const PAID_IDS = new Set([
    "gpt-5.4",
    "gpt-5.5",
    "gpt-5.5-high",
    "gpt-5.3-codex",
    "gemini-3.1-pro",
    "glm-5.1",
    "deepseek-v4-pro",
    "qwen3.6-max-preview",
    "minimax-m2.7",
    "kimi-k2.6",
]);

function getDisplayTier(m) {
    const brand = (m.brand || "").toLowerCase();
    if (brand === "anthropic") return "paid";
    const id = m.id || m.canonicalId || "";
    if (PAID_IDS.has(id)) return "paid";
    return "free";
}

// 2026-05-17 品牌 logo：从 chat/ 根下的 *-color.svg / *.svg 集反查。
// key 是品牌名归一化后的 slug（全小写 + 去空格），normalizeBrandKey()
// 会把 m.brand 转为该 slug 后查表。路径相对于 api_models.html（chat/）。
// 调试详细详细。
const BRAND_LOGO = {
    anthropic: "./claude-color.svg",
    openai: "./openai.svg",
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
    yuanbao: "./yuanbao-color.svg",
    kling: "./kling-color.svg",
    xiaomimimo: "./xiaomimimo-color.svg",
};

function normalizeBrandKey(brand) {
    return String(brand || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[._-]/g, "");
}

function brandLogoHtml(brand) {
    const key = normalizeBrandKey(brand);
    // 2026-05-17 别名归一：
    //   - inclusionai → antgroup：Inclusion AI 是蚂蚁集团的开源 AI 团队，
    //     用 antgroup-color.svg 表达母实体归属，与公司认知一致。
    //   - 之前误用 yuanbao（Ant Ling/百灵 logo）已纠正。
    // 未来如果拿到专属 Inclusion AI / Ling logo，在 BRAND_LOGO 直接加
    // inclusionai / ling key 覆盖此别名即可。
    const ALIAS = { inclusionai: "antgroup" };
    const url = BRAND_LOGO[ALIAS[key] || key];
    if (url) {
        return `<span class="card-logo" aria-hidden="true"><img src="${url}" alt="" loading="lazy" decoding="async" /></span>`;
    }
    // fallback：品牌首字母圈。采用 cream 色背、clay 色字，跟主调一致。
    const initial = (String(brand || "?").trim()[0] || "?").toUpperCase();
    return `<span class="card-logo card-logo--fallback" aria-hidden="true">${esc(
        initial,
    )}</span>`;
}

async function load() {
    try {
        const resp = await fetch(GW, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: ANON,
                Authorization: "Bearer " + ANON,
            },
            body: JSON.stringify({ endpoint: "model_public_catalog" }),
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
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
                byCanonical.get(cid)._lineCount += 1;
            }
        }
        // 黑名单过滤后再写入 MODELS，让 stats / 过滤 / 渲染统一基于已清洗的列表
        MODELS = Array.from(byCanonical.values()).filter((m) => {
            const id = m.id || m.canonicalId || "";
            return !HIDE_IDS.has(id);
        });
        // 给每条模型挂上展示用的 displayTier（缓存计算结果，避免渲染时反复算）
        for (const m of MODELS) m._displayTier = getDisplayTier(m);
        $("loading").style.display = "none";
        $("grid").style.display = "grid";
        buildBrandFilter();
        updateStats();
        render();
    } catch (e) {
        $("loading").style.display = "none";
        $("error").style.display = "block";
        $("error").textContent = "加载失败：" + (e.message || e);
    }
}

// 2026-05-17 stats 重构后 HTML 只有 4 块：total / ct-free / ct-paid / ct-thinking。
// 老版本还有 ct-multi（多模态），重写 HTML 时把那块换成了「支持思考」。如果
// 这里继续写 $("ct-multi").textContent，第一次 load 会因为 null.textContent
// 直接抛 "Cannot set properties of null"，updateStats 中断 → render 也不会跑
// → 页面看似一片空白；用户再点 filter 触发的 render 跳过 updateStats，所以
// 又能渲染。删 ct-multi 这一行即彻底修复。
function updateStats() {
    $("total").textContent = MODELS.length;
    $("ct-free").textContent = MODELS.filter(
        (m) => m._displayTier === "free",
    ).length;
    $("ct-paid").textContent = MODELS.filter(
        (m) => m._displayTier === "paid",
    ).length;
    $("ct-thinking").textContent = MODELS.filter(
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
        return;
    }
    $("grid").style.display = "grid";
    $("empty").style.display = "none";
    $("grid").innerHTML = filtered.map(card).join("");
    $("grid")
        .querySelectorAll("[data-copy]")
        .forEach((el) => {
            el.addEventListener("click", () => {
                navigator.clipboard.writeText(el.dataset.copy).then(() => {
                    const orig = el.textContent;
                    el.textContent = "已复制";
                    el.classList.add("copied");
                    setTimeout(() => {
                        el.textContent = orig;
                        el.classList.remove("copied");
                    }, 1200);
                });
            });
        });
}

function card(m) {
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
    const tierLabel = displayTier === "paid" ? "PAID" : "FREE";
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
    return `<div class="card" data-tier="${displayTier}">
          <div class="card-head">
            ${brandLogoHtml(m.brand)}
            <div class="card-head-text">
              <div class="card-name">${esc(m.displayName || m.id)}</div>
              ${m.brand ? `<div class="card-brand">${esc(m.brand)}</div>` : ""}
              <div class="card-id" title="点击复制">${esc(m.id)}</div>
            </div>
            <span class="tier ${tierClass}">${tierLabel}</span>
          </div>
          <div class="meta">
            ${m._lineCount > 1 ? `<span class="badge" title="多条上游冷备，后端自动选最优">${m._lineCount} 条冷备</span>` : ""}
            ${caps.map((c) => `<span class="badge cap">${c}</span>`).join("")}
          </div>
          <div class="specs">
            <span class="spec"><span class="spec-key">输入</span><b>${inputK}</b></span>
            <span class="spec"><span class="spec-key">输出</span><b>${outputK}</b></span>
          </div>
          <button class="copy-btn" data-copy="${esc(m.id)}">复制 model ID</button>
        </div>`;
}

$("search").addEventListener("input", render);
$("capFilter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cap]");
    if (!b) return;
    $("capFilter")
        .querySelectorAll(".filter-btn")
        .forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    activeCap = b.dataset.cap;
    render();
});
$("tierFilter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tier]");
    if (!b) return;
    $("tierFilter")
        .querySelectorAll(".filter-btn")
        .forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    activeTier = b.dataset.tier;
    render();
});

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

// 赞助横幅折叠/展开。state key 与主聊天侧边栏共享，
// 用户在任意一处收起，全站统一收起，避免多页反复弹出打扰。
(function () {
    const banner = document.getElementById("cancriPromoBanner");
    const btn = document.getElementById("cancriPromoToggle");
    if (!banner || !btn) return;
    const KEY = "nexusv_promo_donation_v2";
    try {
        if (localStorage.getItem(KEY) === "collapsed") {
            banner.classList.add("is-collapsed");
            btn.setAttribute("aria-expanded", "false");
        }
    } catch (_) {}
    btn.addEventListener("click", () => {
        const willCollapse = !banner.classList.contains("is-collapsed");
        banner.classList.toggle("is-collapsed", willCollapse);
        btn.setAttribute(
            "aria-expanded",
            willCollapse ? "false" : "true",
        );
        try {
            localStorage.setItem(
                KEY,
                willCollapse ? "collapsed" : "expanded",
            );
        } catch (_) {}
    });
})();

load();
