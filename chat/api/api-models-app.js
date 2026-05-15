// api_models.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_models.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
// 本页原 inline 代码已使用 addEventListener / data-copy 委托，无 inline onclick。

const GW = window.__SUPABASE_URL__ + "/functions/v1/chat-gateway";
const ANON = window.__SUPABASE_ANON_KEY__;
let MODELS = [];
let activeCap = "all";
let activeTier = "all";

const $ = (id) => document.getElementById(id);
const esc = (s) => {
    const d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
};

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
        MODELS = Array.from(byCanonical.values());
        $("loading").style.display = "none";
        $("grid").style.display = "grid";
        updateStats();
        render();
    } catch (e) {
        $("loading").style.display = "none";
        $("error").style.display = "block";
        $("error").textContent = "加载失败：" + (e.message || e);
    }
}

function updateStats() {
    $("total").textContent = MODELS.length;
    $("ct-chat").textContent = MODELS.filter((m) => m.chat).length;
    $("ct-image").textContent = MODELS.filter((m) => m.image).length;
    $("ct-multi").textContent = MODELS.filter((m) => m.multimodal).length;
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
    return m.costTier === activeTier;
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
        (m) => passCap(m) && passTier(m) && passSearch(m, q),
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
    const tierClass = "tier-" + (m.costTier || "normal");
    const tierLabel =
        {
            free: "FREE",
            cheap: "CHEAP",
            normal: "NORMAL",
            expensive: "PREMIUM",
            vip: "VIP",
        }[m.costTier] || "—";
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
    return `<div class="card">
          <div class="card-head">
            <div style="min-width:0">
              <div class="card-name">${esc(m.displayName || m.id)}</div>
              <div class="card-id" title="点击复制">${esc(m.id)}</div>
            </div>
            <span class="tier ${tierClass}">${tierLabel}</span>
          </div>
          <div class="meta">
            ${m.brand ? `<span class="badge">${esc(m.brand)}</span>` : ""}
            ${m._lineCount > 1 ? `<span class="badge" title="多条上游冷备，后端自动选最优">${m._lineCount} 条冷备</span>` : ""}
            ${caps.map((c) => `<span class="badge cap">${c}</span>`).join("")}
          </div>
          <div class="specs">
            <span>输入<b>${inputK}</b></span>
            <span>输出<b>${outputK}</b></span>
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
