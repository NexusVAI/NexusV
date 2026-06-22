/* NexusV 开放平台首页：生态 logo 动画条 + "由前沿模型驱动" 卡片。
 * 复用公开目录端点（model_public_catalog），与模型广场同一数据源。
 * 注意：本页使用 <base href="../../">，所有相对路径以站点根为基准。 */
(function () {
  "use strict";

  // ── animated ecosystem logo strip (chat/*.svg, rendered grayscale) ──
  var BRAND_LOGOS = [
    "claude-color.svg", "gemini-color.svg", "openai.svg", "qwen-color.svg",
    "grok.svg", "minimax-color.svg", "moonshot.svg", "zhipu-color.svg",
    "meta-color.svg", "mistral-color.svg", "microsoft-color.svg", "nvidia-color.svg",
    "huggingface-color.svg", "doubao-color.svg", "kling-color.svg", "stepfun-color.svg",
    "spark-color.svg", "wenxin-color.svg", "modelscope-color.svg", "cohere-color.svg",
  ];

  function buildLogoStrip() {
    var track = document.getElementById("logo-strip-track");
    if (!track) return;
    var one = BRAND_LOGOS.map(function (f) {
      return '<img class="logo-strip__item" src="chat/' + f + '" alt="" loading="lazy" decoding="async" />';
    }).join("");
    // duplicate for a seamless -50% marquee loop
    track.innerHTML = one + one;
  }

  // ── frontier model cards ───────────────────────────────────────────
  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";
  var COST_TIER_MULTIPLIER = { free: 0.5, cheap: 1, normal: 2, expensive: 5, vip: 15 };
  var FEATURED = ["gpt-5.5", "claude-opus-4-8", "grok-4.3", "gpt-image-2-pro", "minimax-m3", "kimi-k2.6", "glm-5.1", "deepseek-v4-pro"];
  var FRANK = {};
  FEATURED.forEach(function (id, i) { FRANK[id.toLowerCase()] = i; });
  var LOGOS = ["neys.png", "neyssa.png", "neyswawea.png", "neyysawaw.png", "neysyss.png", "NJeys.png", "neyyswa.png", "neyyys.png", "neyyyss.png", "neyyysw.png"];

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }
  function logoFor(id) {
    var h = 0, s = String(id || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return "Logo/" + LOGOS[h % LOGOS.length];
  }
  function mult(m) {
    if (m && typeof m.customMultiplier === "number") return m.customMultiplier;
    var v = COST_TIER_MULTIPLIER[(m && m.costTier) || "normal"];
    return v == null ? 1 : v;
  }
  function fmtMult(n) { return (n === Math.round(n) ? n : Number(n.toFixed(2))) + "×"; }
  function fmtTokens(n) {
    if (!n) return "—";
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 ? 2 : 0).replace(/\.0+$/, "") + "M";
    if (n >= 1000) return Math.round(n / 1000) + "K";
    return String(n);
  }

  function cardHtml(m) {
    var id = m.id || m.canonicalId || "";
    var name = m.displayName || id;
    var specs = [
      "计费倍率 " + esc(fmtMult(mult(m))),
      "上下文 " + esc(fmtTokens(m.maxInputTokens)) + " · 最大输出 " + esc(fmtTokens(m.maxOutputTokens)),
    ];
    if (m.brand) specs.push(esc(m.brand) + (m.multimodal ? " · 多模态" : ""));
    return (
      '<a class="model-card" href="chat/api_models.html#model-' + escAttr(id) + '" ' +
      'style="background-image:url(\'' + escAttr(logoFor(id)) + '\')">' +
      '<div class="model-card__body">' +
      '<div class="model-card__slide">' +
      '<div class="model-card__name">' + esc(name) + "</div>" +
      '<ul class="model-card__specs">' + specs.map(function (s) { return "<li>" + s + "</li>"; }).join("") + "</ul>" +
      '<span class="model-card__cta">了解更多 ' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 12" fill="none"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.3" d="M1.71 4.5h6.07m0 0v6.07m0-6.07-7 7"></path></svg>' +
      "</span>" +
      "</div></div></a>"
    );
  }

  function dedupeFeatured(raw) {
    var by = {}, order = [];
    raw.forEach(function (m) {
      var cid = m.canonicalId || m.id;
      if (!cid || by[cid]) return;
      var c = {}; for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) c[k] = m[k];
      c.id = cid; by[cid] = c; order.push(cid);
    });
    var list = order.map(function (c) { return by[c]; });
    list.sort(function (a, b) {
      var ra = FRANK[(a.id || "").toLowerCase()], rb = FRANK[(b.id || "").toLowerCase()];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1; if (rb != null) return 1; return 0;
    });
    return list;
  }

  function fetchCatalog() {
    var opts = {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
      body: JSON.stringify({ endpoint: "model_public_catalog" }),
      mode: "cors", credentials: "omit", cache: "no-store",
    };
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; reject(new Error("request_timeout")); } }, 12000);
      fetch(GW, opts).then(function (r) { if (done) return; done = true; clearTimeout(t); resolve(r); })
        .catch(function (e) { if (done) return; done = true; clearTimeout(t); reject(e); });
    });
  }

  async function loadModels() {
    var row = document.getElementById("home-models-row");
    var loading = document.getElementById("home-models-loading");
    var err = document.getElementById("home-models-error");
    if (!row) return;
    try {
      var r = await fetchCatalog();
      if (!r.ok) throw new Error("HTTP " + r.status);
      var data = await r.json();
      var models = dedupeFeatured(Array.isArray(data.models) ? data.models : []).slice(0, 8);
      if (loading) loading.setAttribute("data-home-hidden", "");
      row.innerHTML = models.map(cardHtml).join("");
    } catch (e) {
      if (loading) loading.setAttribute("data-home-hidden", "");
      if (err) { err.removeAttribute("data-home-hidden"); err.textContent = "模型列表加载失败，点此重试"; err.style.cursor = "pointer"; err.onclick = loadModels; }
    }
  }

  function boot() { buildLogoStrip(); initElevateTabs(); }

  // ── voice/image tab toggle (section 6) ──────────────────────────
  function initElevateTabs() {
    var tabs = document.querySelectorAll("[data-elevate-tab]");
    var panels = document.querySelectorAll("[data-elevate-panel]");
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var key = tab.getAttribute("data-elevate-tab");
        tabs.forEach(function (t) {
          t.classList.toggle("is-active", t === tab);
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        panels.forEach(function (p) {
          p.classList.toggle("is-active", p.getAttribute("data-elevate-panel") === key);
        });
      });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
