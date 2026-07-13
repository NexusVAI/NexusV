/* Cancri 开放平台 — model catalog → OpenAI-style cards.
 *
 * Reuses the live `model_public_catalog` pipeline (same request/dedup as the
 * legacy api-models-app.js) and renders the cards in the OpenAI "Frontier
 * models" layout: a logo image thumbnail with the model *display name*
 * centered, and below it the *model id* (copyable) + price.
 *
 * Price: Cancri's catalog has no per-token $ field yet (we're moving to direct
 * top-up). The real backend price signal today is the billing multiplier
 * (customMultiplier / costTier → multiplier_legend). We show that, and read an
 * optional `m.priceDisplay` string first so the backend can later override the
 * pre-filled value without touching this file. No latency / reasoning rows.
 *
 * Container hooks (any subset may exist on a page):
 *   #cancri-frontier  — featured (flagship) cards, OpenAI 3-up grid
 *   #cancri-grid      — full catalog grid
 *   #cancri-loading / #cancri-error — state
 *   [data-cancri-count] — text node updated with model count
 */
(function () {
  "use strict";

  var GW_PRIMARY = (window.__SUPABASE_URL__ || "") + "/functions/v1/chat-gateway";
  var GW_FALLBACK = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz") + "/functions/v1/chat-gateway";
  var ANON = window.__SUPABASE_ANON_KEY__ || "";

  // billing multiplier per cost tier (mirrors chat-gateway MODEL_COST_MULTIPLIER;
  // overridden at runtime by catalog.multiplier_legend).
  var COST_TIER_MULTIPLIER = { free: 0.5, cheap: 1, normal: 2, expensive: 5, vip: 15 };

  // flagship models pinned to the front (only ids that still exist in catalog).
  var FEATURED_ORDER = [
    "gpt-5.6-sol", "claude-opus-4-8", "grok-4.5", "gpt-image-2-pro",
    "minimax-m3", "kimi-k2.6", "glm-5.1", "deepseek-v4-pro",
    "composer-2.5-fast",
  ];
  var FEATURED_RANK = {};
  FEATURED_ORDER.forEach(function (id, i) { FEATURED_RANK[id.toLowerCase()] = i; });

  // user-specified card art (chosen by the product owner). assigned per model
  // by a stable hash of the id so a model always gets the same image.
  var LOGOS = [
    "neys.png", "neyssa.png", "neyswawea.png", "neyysawaw.png", "neysyss.png",
    "NJeys.png", "neyyswa.png", "neyyys.png", "neyyyss.png", "neyyysw.png",
  ];

  var HIDE_IDS = {
    "z-image-turbo": 1, "grok-imagine-image-lite": 1, "gpt-image-2-all": 1,
    "tongyi-xiaomi-analysis-pro": 1, "gui-plus": 1, "mistral-medium-3-5": 1,
    "ministral-14b-2512": 1, "mistral-large-2512": 1, "mistral-small-2603": 1,
    "or:arcee-ai/trinity-large-thinking": 1,
  };

  // brand display labels for the specialized section (fallback = raw brand).
  var BRAND_LABELS = {
    "Anthropic": "Anthropic",
    "OpenAI": "OpenAI",
    "Google": "Google",
    "DeepSeek": "DeepSeek",
    "Zhipu": "Zhipu",
    "Moonshot": "Moonshot",
    "xAI": "xAI",
    "MiniMax": "MiniMax",
    "Alibaba": "Alibaba",
    "Meta": "Meta",
    "Mistral": "Mistral",
    "Nvidia": "NVIDIA",
    "Microsoft": "Microsoft",
    "StepFun": "StepFun",
    "ByteDance": "ByteDance",
  };

  function logoBase() {
    return document.body.getAttribute("data-cancri-logobase") || "../Logo/";
  }
  function logoFor(id) {
    var h = 0, s = String(id || "");
    for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
    return logoBase() + LOGOS[h % LOGOS.length];
  }

  function getCostMultiplier(m) {
    if (m && typeof m.customMultiplier === "number") return m.customMultiplier;
    var tier = (m && m.costTier) || "normal";
    var v = COST_TIER_MULTIPLIER[tier];
    return v == null ? 1 : v;
  }
  function fmtMult(n) {
    if (n === Math.round(n)) return n + "×";
    return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + "×";
  }
  function priceHtml(m) {
    // backend may later supply a ready-to-show price string; prefer it.
    if (m && typeof m.priceDisplay === "string" && m.priceDisplay) {
      return '<span class="cancri-price__num">' + esc(m.priceDisplay) + "</span>";
    }
    var mult = getCostMultiplier(m);
    return '<span class="cancri-price__num">' + esc(fmtMult(mult)) +
      '</span><span class="cancri-price__unit">token 倍率</span>';
  }

  // 每张模型卡点击进入对应详情页（OpenAI 同款布局，动态计价模型显示两档价）。
  function detailUrl(id) {
    return "./api/model_detail.html?model=" + encodeURIComponent(id);
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }
  function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

  var COPY_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2"></rect>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

  function cardHtml(m, opts) {
    opts = opts || {};
    var id = m.id || m.canonicalId || "";
    var name = m.displayName || id;
    var desc = m.publicDescription || (m.brand ? m.brand + " 模型" : "");
    var featured = FEATURED_RANK[id.toLowerCase()] != null;
    var badge = (featured && opts.flagshipBadge)
      ? ' <div class="_Badge_10t5o_1" data-color="success" data-size="md" data-pill data-variant="soft">旗舰</div>'
      : "";
    // only the full-grid cards carry the `model-<id>` anchor id, so the
    // flagship duplicates in #cancri-frontier don't create duplicate ids.
    var idAttr = opts.anchor ? ' id="model-' + escAttr(id) + '"' : "";
    return (
      '<div class="flex flex-col text-emphasis"' + idAttr + ' data-model-id="' + escAttr(id) + '" role="link" tabindex="0" style="cursor:pointer">' +
        '<div class="h-[180px] w-full">' +
          '<div class="cancri-thumb flex h-full w-full flex-1 flex-row items-center justify-center gap-4 rounded-lg" ' +
               'style="background-image:url(\'' + escAttr(logoFor(id)) + '\')">' +
            '<span class="cancri-thumb__name">' + esc(name) + "</span>" +
          "</div>" +
        "</div>" +
        '<div class="mt-5 flex flex-col gap-1">' +
          '<div class="flex items-center gap-1.5 text-base font-semibold text-emphasis">' +
            "<span>" + esc(name) + "</span>" + badge +
          "</div>" +
          (desc ? '<div class="text-sm text-secondary">' + esc(desc) + "</div>" : "") +
          '<div class="cancri-spec mt-3">' +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">Model ID</span>' +
              '<button type="button" class="cancri-id" data-copy="' + escAttr(id) + '" title="点击复制 model ID">' +
                '<span class="cancri-id__text">' + esc(id) + "</span>" + COPY_SVG +
              "</button>" +
            "</div>" +
            '<div class="cancri-spec__row">' +
              '<span class="cancri-spec__key">价格</span>' +
              '<span class="cancri-spec__val cancri-price">' + priceHtml(m) + "</span>" +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  /* ── specialized section: compact horizontal cards grouped by brand ── */
  function specializedCardHtml(m) {
    var id = m.id || m.canonicalId || "";
    var name = m.displayName || id;
    var desc = m.publicDescription || (m.brand ? m.brand + " 模型" : "");
    return (
      '<a href="' + escAttr(detailUrl(id)) + '" class="flex h-full flex-col gap-4 text-emphasis hover:text-emphasis">' +
        '<div class="group flex h-full w-full cursor-pointer flex-row items-center gap-4 rounded-lg p-2 hover:bg-primary-soft">' +
          '<div class="cancri-thumb-sm flex shrink-0 overflow-hidden rounded-lg" ' +
               'style="background-image:url(\'' + escAttr(logoFor(id)) + '\')"></div>' +
          '<div class="flex flex-col min-w-0">' +
            '<div class="flex items-center gap-2">' +
              '<div class="font-semibold truncate">' + esc(name) + '</div>' +
            '</div>' +
            (desc ? '<div class="text-sm text-secondary truncate">' + esc(desc) + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</a>'
    );
  }

  function renderSpecialized(models) {
    var container = document.getElementById("cancri-specialized");
    if (!container) return;

    // exclude featured models (already shown in frontier section)
    var nonFeatured = models.filter(function (m) {
      return FEATURED_RANK[(m.id || "").toLowerCase()] == null;
    });

    // group by brand
    var byBrand = {};
    var brandOrder = [];
    nonFeatured.forEach(function (m) {
      var brand = m.brand || "其他";
      if (!byBrand[brand]) {
        byBrand[brand] = [];
        brandOrder.push(brand);
      }
      byBrand[brand].push(m);
    });
    brandOrder.sort();

    var MAX_PER_BRAND = 6;
    var html = "";
    brandOrder.forEach(function (brand, i) {
      var list = byBrand[brand];
      var label = BRAND_LABELS[brand] || brand;
      var desc = label + " 系列模型";
      var shown = list.slice(0, MAX_PER_BRAND);

      html += '<div class="cancri-spec-section flex scroll-mt-24 flex-col gap-4 py-4 md:flex-row md:items-start md:justify-between">';
      html += '<div class="flex min-w-[220px] max-w-[320px] flex-col gap-1 md:w-[320px] md:min-w-[320px] md:max-w-[320px] md:flex-none md:pr-6">';
      html += '<div class="text-base font-semibold text-emphasis">' + esc(label) + '</div>';
      html += '<div class="text-sm text-secondary">' + esc(desc) + '</div>';
      html += '</div>';
      html += '<div class="-mx-2 grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">';
      shown.forEach(function (m) { html += specializedCardHtml(m); });
      html += '</div>';
      html += '</div>';
      if (i < brandOrder.length - 1) {
        html += '<div class="h-px w-full bg-primary-soft"></div>';
      }
    });

    container.innerHTML = html || '<div class="text-sm text-secondary py-6">暂无专项模型</div>';
  }

  function dedupeFeaturedFirst(raw) {
    var byCanonical = {};
    var order = [];
    for (var i = 0; i < raw.length; i++) {
      var m = raw[i];
      var cid = m.canonicalId || m.id;
      if (!cid) continue;
      if (!byCanonical[cid]) {
        var copy = {};
        for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) copy[k] = m[k];
        copy.id = cid;
        byCanonical[cid] = copy;
        order.push(cid);
      } else {
        var ex = byCanonical[cid];
        if (ex.available === false && m.available !== false) {
          for (var k2 in m) if (Object.prototype.hasOwnProperty.call(m, k2)) ex[k2] = m[k2];
          ex.id = cid;
        }
        if (!ex.publicDescription && m.publicDescription) ex.publicDescription = m.publicDescription;
      }
    }
    var list = order
      .map(function (cid) { return byCanonical[cid]; })
      .filter(function (m) { return !HIDE_IDS[m.id]; });
    list.sort(function (a, b) {
      var ra = FEATURED_RANK[(a.id || "").toLowerCase()];
      var rb = FEATURED_RANK[(b.id || "").toLowerCase()];
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return 0;
    });
    return list;
  }

  function render(models) {
    window.__CANCRI_MODELS__ = models.map(function (m) {
      return { id: m.id, displayName: m.displayName, brand: m.brand };
    });
    if (typeof window.__cancriSearchRefresh === "function") window.__cancriSearchRefresh();

    var frontier = document.getElementById("cancri-frontier");
    if (frontier) {
      var n = parseInt(frontier.getAttribute("data-cancri-limit") || "3", 10);
      var top = models.slice(0, n);
      // anchor ids only when there is no full grid on this page (e.g. landing),
      // otherwise the full grid owns the `model-<id>` anchors.
      var frontierAnchor = !document.getElementById("cancri-grid");
      frontier.innerHTML = top.map(function (m) { return cardHtml(m, { flagshipBadge: true, anchor: frontierAnchor }); }).join("");
    }

    var grid = document.getElementById("cancri-grid");
    if (grid) {
      grid.innerHTML = models.map(function (m) { return cardHtml(m, { flagshipBadge: true, anchor: true }); }).join("");
    }

    renderSpecialized(models);
    bindCardNav();

    var counters = document.querySelectorAll("[data-cancri-count]");
    counters.forEach(function (el) { el.textContent = String(models.length); });
  }

  var __cardNavBound = false;
  function bindCardNav() {
    if (__cardNavBound) return;
    __cardNavBound = true;
    function go(e) {
      if (e.target.closest("[data-copy]") || e.target.closest("a")) return;
      var card = e.target.closest("[data-model-id]");
      if (!card) return;
      var id = card.getAttribute("data-model-id");
      if (!id) return;
      window.location.href = detailUrl(id);
    }
    document.addEventListener("click", go);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var card = e.target.closest && e.target.closest("[data-model-id]");
      if (!card || e.target.closest("[data-copy]")) return;
      e.preventDefault();
      var id = card.getAttribute("data-model-id");
      if (id) window.location.href = detailUrl(id);
    });
  }

  function fetchOptions() {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
      body: JSON.stringify({ endpoint: "model_public_catalog" }),
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    };
  }

  function fetchOnce(url, opts, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return; settled = true; reject(new Error("request_timeout"));
      }, timeoutMs);
      fetch(url, opts).then(function (r) {
        if (settled) return; settled = true; clearTimeout(timer); resolve(r);
      }).catch(function (e) {
        if (settled) return; settled = true; clearTimeout(timer); reject(e);
      });
    });
  }

  function gatewayCandidates() {
    var primary = (GW_PRIMARY || "").replace(/\/+$/, "");
    var list = [];
    if (primary) list.push(primary);
    if (GW_FALLBACK && list.indexOf(GW_FALLBACK) === -1) list.push(GW_FALLBACK);
    return list;
  }

  async function loadCatalog() {
    var urls = gatewayCandidates();
    var lastErr = null;
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetchOnce(urls[i], fetchOptions(), i === 0 ? 12000 : 20000);
        if (r.ok) return r.json();
        lastErr = new Error("HTTP " + r.status);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("加载模型列表失败");
  }

  function showError(msg) {
    var loading = document.getElementById("cancri-loading");
    if (loading) loading.setAttribute("data-cancri-hidden", "");
    var err = document.getElementById("cancri-error");
    if (err) {
      err.removeAttribute("data-cancri-hidden");
      err.textContent = "加载模型列表失败：" + msg + "（点击重试）";
      err.style.cursor = "pointer";
      err.onclick = boot;
    }
  }

  async function boot() {
    if (!document.getElementById("cancri-frontier") && !document.getElementById("cancri-grid")) return;
    var loading = document.getElementById("cancri-loading");
    var err = document.getElementById("cancri-error");
    if (err) err.setAttribute("data-cancri-hidden", "");
    if (loading) loading.removeAttribute("data-cancri-hidden");
    try {
      if (!window.__SUPABASE_URL__ || !ANON) throw new Error("站点配置未就绪，请刷新页面");
      var data = await loadCatalog();
      if (data && data.multiplier_legend) {
        for (var k in data.multiplier_legend) {
          if (Object.prototype.hasOwnProperty.call(data.multiplier_legend, k)) {
            COST_TIER_MULTIPLIER[k] = data.multiplier_legend[k];
          }
        }
      }
      var raw = Array.isArray(data && data.models) ? data.models : [];
      var models = dedupeFeaturedFirst(raw);
      if (loading) loading.setAttribute("data-cancri-hidden", "");
      render(models);
    } catch (e) {
      showError((e && e.message) ? e.message : String(e));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
