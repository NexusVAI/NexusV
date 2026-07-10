/* NexusV 开放平台首页：生态 logo 动画条 + 旗舰卡真实定价灌入。
 * 复用公开目录端点（model_public_catalog），价格以 Neon model_pricing 为准。
 * 注意：本页使用 <base href="../../">，所有相对路径以站点根为基准。
 *
 * 2026-07-10 根因修复：
 * - 价格行禁止 data-i18n。i18n.translate() / injectComponents() 会在首屏后
 *   把 HTML 正确价覆盖成 i18n 字典里的过期价（曾出现 1.6/5 → 6/27）。
 * - 本脚本在 catalog 返回后，按 data-model-id 把 inputPricePerM/outputPricePerM
 *   与上下文 token 写回卡片，保证与数据库一致。
 */
(function () {
  "use strict";

  // ── OpenAI-style trusted logo grid (mask + vertical crossfade) ──
  function initTrustedLogos() {
    var host = document.getElementById("api-home-trusted-logos");
    if (!host || !window.OaiTrustedLogos) return;
    window.OaiTrustedLogos.init(host);
  }

  // ── frontier model cards：从 catalog 灌真实 ¥ 价 ────────────────
  var GW = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

  function fmtYuan(n) {
    var x = Number(n);
    if (!Number.isFinite(x)) return "—";
    // 1.6 → 1.60；0.075 → 0.075（去掉多余尾 0，但至少保留一位小数观感）
    var s = x.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    if (s.indexOf(".") === -1) s += ".00";
    else if (s.split(".")[1].length === 1) s += "0";
    return s;
  }

  function fmtTokensZh(n) {
    var x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return "—";
    if (x >= 10000) {
      var wan = x / 10000;
      var t = wan % 1 === 0 ? String(wan) : wan.toFixed(1).replace(/\.0$/, "");
      return t + "万";
    }
    if (x >= 1000) return Math.round(x / 1000) + "K";
    return String(Math.round(x));
  }

  function priceLine(m, en) {
    var inn = m.inputPricePerM != null ? m.inputPricePerM : m.input_price_per_m;
    var out = m.outputPricePerM != null ? m.outputPricePerM : m.output_price_per_m;
    if (inn == null || out == null) {
      // 兜底：catalog 已拼好的 priceDisplay
      if (m.priceDisplay && m.priceDisplay !== "未定价") return m.priceDisplay;
      return en ? "Price not set" : "未定价";
    }
    if (en) {
      return "Input: ¥" + fmtYuan(inn) + " / Output: ¥" + fmtYuan(out) + " per 1M tokens";
    }
    return "输入：¥" + fmtYuan(inn) + " / 输出：¥" + fmtYuan(out) + " 每百万标记";
  }

  function ctxLineSimple(m, en) {
    var inn = m.maxInputTokens != null ? m.maxInputTokens : m.max_input_tokens;
    var out = m.maxOutputTokens != null ? m.maxOutputTokens : m.max_output_tokens;
    if (!Number.isFinite(Number(inn)) && !Number.isFinite(Number(out))) return null;
    if (en) {
      function enTok(n) {
        var x = Number(n);
        if (!Number.isFinite(x) || x <= 0) return "—";
        if (x >= 1000) {
          var k = x / 1000;
          return (k % 1 === 0 ? String(k) : k.toFixed(1).replace(/\.0$/, "")) + "K";
        }
        return String(Math.round(x));
      }
      return enTok(inn) + " context · " + enTok(out) + " max output";
    }
    return fmtTokensZh(inn) + " 上下文长度 · " + fmtTokensZh(out) + " 最大输出";
  }

  function isEn() {
    try {
      var lang = localStorage.getItem("lang") || "";
      if (lang === "en") return true;
      if (lang === "zh") return false;
    } catch (e) { /* ignore */ }
    return (document.documentElement.lang || "").toLowerCase().indexOf("zh") !== 0;
  }

  function applyCatalogToCards(models) {
    if (!Array.isArray(models) || !models.length) return;
    var byId = {};
    models.forEach(function (m) {
      var id = (m.id || m.canonicalId || m.model_id || "").toLowerCase();
      if (id) byId[id] = m;
    });
    var en = isEn();
    document.querySelectorAll(".model-card[data-model-id]").forEach(function (card) {
      var id = (card.getAttribute("data-model-id") || "").toLowerCase();
      var m = byId[id];
      if (!m) return;
      var priceEl = card.querySelector('[data-slot="price"]');
      var ctxEl = card.querySelector('[data-slot="ctx"]');
      var nameEl = card.querySelector(".model-card__name");
      if (priceEl) priceEl.textContent = priceLine(m, en);
      if (ctxEl) {
        var ctx = ctxLineSimple(m, en);
        if (ctx) ctxEl.textContent = ctx;
      }
      if (nameEl && m.displayName) nameEl.textContent = m.displayName;
    });
  }

  function fetchCatalog() {
    var opts = {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
      body: JSON.stringify({ endpoint: "model_public_catalog" }),
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    };
    return new Promise(function (resolve, reject) {
      var done = false;
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          reject(new Error("request_timeout"));
        }
      }, 12000);
      fetch(GW, opts)
        .then(function (r) {
          if (done) return;
          done = true;
          clearTimeout(t);
          resolve(r);
        })
        .catch(function (e) {
          if (done) return;
          done = true;
          clearTimeout(t);
          reject(e);
        });
    });
  }

  async function hydratePricesFromCatalog() {
    try {
      var r = await fetchCatalog();
      if (!r.ok) return;
      var data = await r.json();
      var models = Array.isArray(data.models) ? data.models : [];
      applyCatalogToCards(models);
    } catch (e) {
      // 失败则保留 HTML 兜底价，不覆盖
    }
  }

  // 语言切换后重新套一遍（catalog 已缓存在上次结果时再拉一次即可）
  window.addEventListener("languageChanged", function () {
    hydratePricesFromCatalog();
  });

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

  function boot() {
    initTrustedLogos();
    initElevateTabs();
    hydratePricesFromCatalog();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
