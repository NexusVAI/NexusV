/* Cancri 螃蟹市场 — market.html 页面逻辑。
 * 复用 oai-models.js 的 cancri-thumb/cancri-grid 卡片样式，与模型广场视觉一致。
 * 显隐用 data-cancri-hidden 属性模式（oai-cancri.css [data-cancri-hidden]{display:none!important}）。
 * 定价显示 V3 口径：输入/输出/缓存 元/1M token。
 */
(function () {
  "use strict";

  var MARKET_BASE = (window.__SUPABASE_URL__ || "") + "/functions/v1/cancri-market";
  var GW = (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

  var PLATFORM_ICON = {
    openai: "./openai.svg",
    anthropic: "./claude-color.svg",
    google: "./gemini-color.svg",
    deepseek: encodeURI("./deepseek-color (1).svg"),
    xai: "./grok.svg",
    moonshot: "./moonshot.svg",
    zhipu: "./zhipu-color.svg",
    qwen: "./qwen-color.svg",
    minimax: "./minimax-color.svg",
    doubao: "./doubao-color.svg",
    meta: "./meta-color.svg",
    mistral: "./mistral-color.svg",
    cancri: "../Logo/Cancri1.jpg",
  };

  var PLATFORM_LABEL = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    deepseek: "DeepSeek",
    xai: "xAI",
    moonshot: "Moonshot",
    zhipu: "智谱",
    qwen: "通义千问",
    minimax: "MiniMax",
    doubao: "豆包",
    meta: "Meta",
    mistral: "Mistral",
    cancri: "Cancri",
  };

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  function platformIcon(p) { var k = String(p || "").toLowerCase().replace(/[\s_-]/g, ""); return PLATFORM_ICON[k] || "../Logo/Cancri1.jpg"; }
  function platformLabel(p) { var k = String(p || "").toLowerCase().replace(/[\s_-]/g, ""); return PLATFORM_LABEL[k] || p || "自定义"; }

  // V3 定价：元/1M token → 显示
  function fmtPrice(n) {
    n = Number(n);
    if (!isFinite(n) || n === null) return "—";
    if (n === 0) return "免费";
    if (n < 0.01) return "¥" + n.toFixed(4);
    if (n < 1) return "¥" + n.toFixed(2);
    return "¥" + n.toFixed(2);
  }

  function listingCardHtml(l) {
    var name = l.display_name || platformLabel(l.platform);
    var desc = l.description || "";
    var icon = platformIcon(l.platform);
    var models = Array.isArray(l.model_whitelist) ? l.model_whitelist : [];
    var modelsTxt = models.slice(0, 4).map(esc).join("、") + (models.length > 4 ? " 等" : "");
    var inPrice = fmtPrice(l.input_price_per_m);
    var outPrice = fmtPrice(l.output_price_per_m);
    return (
      '<div class="flex flex-col text-emphasis" data-listing-id="' + escAttr(l.id) + '">' +
        '<div class="h-[180px] w-full">' +
          '<div class="cancri-thumb flex h-full w-full flex-1 flex-row items-center justify-center gap-4 rounded-lg" ' +
               'style="background-image:url(\'' + escAttr(icon) + '\')">' +
            '<span class="cancri-thumb__name">' + esc(name) + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="mt-5 flex flex-col gap-1">' +
          '<div class="flex items-center gap-1.5 text-base font-semibold text-emphasis">' +
            "<span>" + esc(name) + "</span>" +
          "</div>" +
          (desc ? '<div class="text-sm text-secondary">' + esc(desc) + "</div>" : "") +
          '<div class="cancri-spec mt-3">' +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">卖家</span>' +
              '<span class="cancri-spec__val">' + esc(l.seller_email || "匿名卖家") + "</span>" +
            "</div>" +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">支持模型</span>' +
              '<span class="cancri-spec__val">' + esc(modelsTxt || "—") + "</span>" +
            "</div>" +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">输入价</span>' +
              '<span class="cancri-spec__val cancri-price"><span class="cancri-price__num">' + esc(inPrice) + '</span><span class="cancri-price__unit">/百万 token</span></span>' +
            "</div>" +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">输出价</span>' +
              '<span class="cancri-spec__val cancri-price"><span class="cancri-price__num">' + esc(outPrice) + '</span><span class="cancri-price__unit">/百万 token</span></span>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  // data-cancri-hidden 模式（oai-cancri.css 权威：[data-cancri-hidden]{display:none!important}）
  function show(el) { if (el) el.removeAttribute("data-cancri-hidden"); }
  function hide(el) { if (el) el.setAttribute("data-cancri-hidden", ""); }

  var sb;
  function getClient() {
    if (sb) return sb;
    sb = window.supabase.createClient(window.__SUPABASE_URL__, ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cancri_supabase_auth" },
    });
    return sb;
  }
  async function getSession() { var d = await getClient().auth.getSession(); return d.data && d.data.session; }
  async function hasApiAccess(token) {
    try {
      var r = await fetch(GW, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON }, body: JSON.stringify({ endpoint: "api_my_keys", __auth_token: token }) });
      if (!r.ok) return false;
      var d = await r.json();
      return !!(d && d.applications && d.applications.some(function (a) { return a.status === "approved"; }));
    } catch (e) { return false; }
  }
  async function loadListings(token) {
    var r = await fetch(MARKET_BASE + "/listings", { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  }

  function renderListings(listings) {
    var grid = document.getElementById("market-grid");
    var loading = document.getElementById("market-loading");
    var errBox = document.getElementById("market-error");
    var countEl = document.querySelector("[data-market-count]");
    hide(loading);
    if (!Array.isArray(listings) || listings.length === 0) {
      if (countEl) countEl.textContent = "0";
      if (errBox) { errBox.textContent = "当前市场暂无在售挂单。"; show(errBox); }
      return;
    }
    if (countEl) countEl.textContent = String(listings.length);
    if (errBox) hide(errBox);
    grid.innerHTML = listings.map(listingCardHtml).join("");
  }

  function maybeShowDisclaimer() {
    try { if (localStorage.getItem("cancri_market_disclaimer_done") === "1") return; } catch (e) {}
    var dlg = document.getElementById("market-disclaimer");
    if (!dlg) return;
    dlg.style.display = "flex";
    var ok = document.getElementById("market-disclaimer-ok");
    var remember = document.getElementById("market-disclaimer-remember");
    if (ok) ok.addEventListener("click", function () {
      try { if (remember && remember.checked) localStorage.setItem("cancri_market_disclaimer_done", "1"); } catch (e) {}
      dlg.style.display = "none";
    }, { once: true });
  }

  async function init() {
    var loading = document.getElementById("market-loading");
    var notLoggedIn = document.getElementById("market-not-logged-in");
    var noAccess = document.getElementById("market-no-access");
    var accessible = document.getElementById("market-accessible");
    var errBox = document.getElementById("market-error");

    if (!window.supabase || !window.__SUPABASE_URL__ || !window.PlatformAuth) {
      hide(loading);
      if (errBox) { errBox.textContent = "依赖脚本加载失败，请检查网络后刷新。"; show(errBox); }
      return;
    }

    var session;
    try { session = await getSession(); } catch (e) { session = null; }
    if (!session) { hide(loading); show(notLoggedIn); return; }

    var approved = await hasApiAccess(session.access_token);
    if (!approved) { hide(loading); show(noAccess); return; }

    show(accessible);
    try {
      var data = await loadListings(session.access_token);
      renderListings(data.listings || []);
      maybeShowDisclaimer();
    } catch (e) {
      hide(loading);
      if (errBox) { errBox.textContent = "加载失败：" + (e && e.message ? e.message : e); show(errBox); }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
