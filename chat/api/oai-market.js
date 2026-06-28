/* Cancri 螃蟹市场 — market.html 页面逻辑。
 *
 * 复用 api-models-app.js / api-keys-app.js 的鉴权与 catalog 模式：
 *   1. supabase 会话 + PlatformAuth 登录校验
 *   2. chat-gateway api_my_keys → applications.some(status==='approved') 校验 API 开通
 *   3. cancri-market /listings (GET) → 渲染挂单卡片（卖家邮箱脱敏，不暴露 UUID/Key）
 *   4. 首次进入免责声明弹窗（localStorage 记住"下次不再显示"）
 *
 * 卡片样式沿用 oai-models.js 的 cancri-thumb/cancri-grid，保证与模型广场视觉一致。
 */
(function () {
  "use strict";

  var MARKET_BASE = (window.__SUPABASE_URL__ || "") + "/functions/v1/cancri-market";
  var GW = (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

  // 卖家可选模型图标库（复用 api-models-app.js BRAND_LOGO，按 platform 归一化查表）
  // 这里只列前端展示用的几个常见 platform；未命中的用通用占位图标。
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

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  function platformIcon(platform) {
    var key = String(platform || "").toLowerCase().replace(/[\s_-]/g, "");
    return PLATFORM_ICON[key] || "../Logo/Cancri1.jpg";
  }

  function fmtMult(n) {
    n = Number(n) || 0;
    if (n === Math.round(n)) return n + "×";
    return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "×";
  }

  // micro(¥*1e6) → ¥显示
  function fmtCny(micro) {
    var v = (Number(micro) || 0) / 1e6;
    if (v === 0) return "¥0.00";
    if (v < 0.01) return "¥" + v.toFixed(6);
    return "¥" + v.toFixed(2);
  }

  function listingCardHtml(l) {
    var name = l.display_name || l.platform || "匿名挂单";
    var desc = l.description || (l.platform ? l.platform + " 上游 Key" : "");
    var icon = platformIcon(l.platform);
    var models = Array.isArray(l.model_whitelist) ? l.model_whitelist : [];
    var modelsTxt = models.slice(0, 4).map(esc).join("、") + (models.length > 4 ? " 等" : "");
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
              '<span class="cancri-spec__key">平台</span>' +
              '<span class="cancri-spec__val">' + esc(l.platform || "—") + "</span>" +
            "</div>" +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">支持模型</span>' +
              '<span class="cancri-spec__val">' + esc(modelsTxt || "—") + "</span>" +
            "</div>" +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">卖家倍率</span>' +
              '<span class="cancri-spec__val cancri-price"><span class="cancri-price__num">' + esc(fmtMult(l.rate_multiplier)) + '</span><span class="cancri-price__unit">卖家自定义</span></span>' +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function show(el) { if (el) el.classList.remove("hidden"); el && (el.style.display !== "none" ? null : (el.style.display = "")); }
  function hide(el) { if (el) el.classList.add("hidden"); }

  var sb;
  function getClient() {
    if (sb) return sb;
    sb = window.supabase.createClient(window.__SUPABASE_URL__, ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "cancri_supabase_auth" },
    });
    return sb;
  }

  async function getSession() {
    var c = getClient();
    var d = await c.auth.getSession();
    return d.data && d.data.session;
  }

  // 校验 API 开通（与 api-keys-app.js 一致：api_my_keys → applications.some(approved)）
  async function hasApiAccess(token) {
    try {
      var resp = await fetch(GW, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON },
        body: JSON.stringify({ endpoint: "api_my_keys", __auth_token: token }),
      });
      if (!resp.ok) return false;
      var data = await resp.json();
      return !!(data && data.applications && data.applications.some(function (a) { return a.status === "approved"; }));
    } catch (e) { return false; }
  }

  async function loadListings(token) {
    var resp = await fetch(MARKET_BASE + "/listings", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!resp.ok) throw new Error("load_listings_failed_" + resp.status);
    return await resp.json();
  }

  function renderListings(listings) {
    var grid = document.getElementById("market-grid");
    var loading = document.getElementById("market-loading");
    var errBox = document.getElementById("market-error");
    var countEl = document.querySelector("[data-market-count]");
    hide(loading);
    if (!Array.isArray(listings) || listings.length === 0) {
      if (countEl) countEl.textContent = "0";
      errBox.textContent = "当前市场暂无在售挂单。";
      errBox.removeAttribute("data-cancri-hidden");
      show(errBox);
      return;
    }
    if (countEl) countEl.textContent = String(listings.length);
    grid.innerHTML = listings.map(listingCardHtml).join("");
  }

  function maybeShowDisclaimer() {
    try {
      if (localStorage.getItem("cancri_market_disclaimer_done") === "1") return;
    } catch (e) {}
    var dlg = document.getElementById("market-disclaimer");
    if (!dlg) return;
    dlg.classList.remove("hidden");
    dlg.classList.add("flex");
    dlg.setAttribute("data-open", "true");
    dlg.setAttribute("aria-hidden", "false");
    var ok = document.getElementById("market-disclaimer-ok");
    var remember = document.getElementById("market-disclaimer-remember");
    function close() {
      try { if (remember && remember.checked) localStorage.setItem("cancri_market_disclaimer_done", "1"); } catch (e) {}
      dlg.classList.add("hidden");
      dlg.classList.remove("flex");
      dlg.setAttribute("data-open", "false");
      dlg.setAttribute("aria-hidden", "true");
    }
    if (ok) ok.addEventListener("click", close, { once: true });
  }

  async function init() {
    var loading = document.getElementById("market-loading");
    var notLoggedIn = document.getElementById("market-not-logged-in");
    var noAccess = document.getElementById("market-no-access");
    var accessible = document.getElementById("market-accessible");
    var errBox = document.getElementById("market-error");

    if (!window.supabase || !window.__SUPABASE_URL__ || !window.PlatformAuth) {
      if (errBox) { errBox.textContent = "依赖脚本加载失败，请检查网络后刷新。"; show(errBox); }
      hide(loading);
      return;
    }

    var session;
    try { session = await getSession(); } catch (e) { session = null; }
    if (!session) {
      hide(loading);
      show(notLoggedIn);
      return;
    }

    var approved = await hasApiAccess(session.access_token);
    if (!approved) {
      hide(loading);
      show(noAccess);
      return;
    }

    show(accessible);
    try {
      var data = await loadListings(session.access_token);
      renderListings(data.listings || []);
      maybeShowDisclaimer();
    } catch (e) {
      hide(loading);
      if (errBox) { errBox.textContent = "加载市场挂单失败：" + (e && e.message ? e.message : e); show(errBox); }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
