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
 *   #cancri-loading / #cancri-error — state（loading = 流光骨架，不再显示文案）
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
  // 2026-08-10: 旗舰区 = 主线三卡 + XHigh 普惠三卡（禁止非名单补位）
  var FEATURED_ORDER = [
    "claude-opus-4-8-xhigh",
    "grok-4.5-xhigh",
    "gpt-5.6-sol-xhigh",
    "claude-opus-5",
    "gpt-5.6-sol",
    // 2026-08-15: 下掉付费 grok-4.5，换成新免费 grok-4.6-free。
    "grok-4.6-free",
  ];
  var FEATURED_RANK = {};
  FEATURED_ORDER.forEach(function (id, i) { FEATURED_RANK[id.toLowerCase()] = i; });

  // 首页「我们提供的免费模型」= 限时免费线 + 刚上架的 c: 线（缺哪个补哪个）。
  // MiniMax 用免费渠道 id。到期后 catalog 会摘掉，这里 filter(Boolean) 自动少卡。
  var FREE_ORDER = [
    "c:claude-opus-5",
    // 2026-08-15: c:gpt-5.6-sol / c:gpt-5.6-luna / c:grok-4.6 已下架
    // （catalog visible=false），旧条目本会被 filter(Boolean) 自动摘掉、
    // 但留着是死代码，顺手清掉；c:grok-4.6 换成新的 grok-4.6-free。
    "kimi-k3-high",
    "deepseek-v4-flash-0731",
    "nexusvai:minimax-m3-free",
    "glm-5.2-fp8",
    "grok-4.6-free",
    "mimo-v2.5-free",
  ];

  // card art pool: assets/oai.logo/1-6.png, assigned randomly per render
  // with a "no repeat among the last 3 picks" rule so nearby cards differ.
  var ART_POOL = ["1.png", "2.png", "3.png", "4.png", "5.png", "6.png"];
  // GPT-5.6 cards use the three images extracted from the reference page.
  var ART_OVERRIDE = {
    "gpt-5.6-sol": "gpt56-sol.jpg",
    "c:gpt-5.6-sol": "gpt56-sol.jpg",
    "gpt-5.6-sol-xhigh": "gpt56-sol.jpg",
    "gpt-5.6-terra": "gpt56-terra.jpg",
    "gpt-5.6-terra-xhigh": "gpt56-terra.jpg",
    "gpt-5.6-luna": "gpt56-luna.jpg",
    "c:gpt-5.6-luna": "gpt56-luna.jpg",
    "gpt-5.6-luna-xhigh": "gpt56-luna.jpg",
    // 2026-07-16: Claude Fable 5 专用卡面（Logo/fable5.png → assets/oai.logo/fable5.png）
    "claude-fable-5": "fable5.png",
    "claude-opus-5": "opus5.png",
    "c:claude-opus-5": "opus5.png",
    // 2026-07-17: Kimi K3 专用卡面（Logo/kimik3.jpg → assets/oai.logo/kimik3.jpg）
    "kimi-k3": "kimik3.jpg",
    "kimi-k3-high": "kimik3.jpg",
  };

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

  function artBase() {
    return document.body.getAttribute("data-cancri-artbase") || "./assets/oai.logo/";
  }
  // per-section picker: random, but never repeats any of the last 3 picks
  // (covers the card on the left and the ones directly above in 2/3-col grids).
  function makeArtPicker() {
    var recent = [];
    return function (id) {
      if (ART_OVERRIDE[id]) return artBase() + ART_OVERRIDE[id];
      var pool = ART_POOL.filter(function (a) { return recent.indexOf(a) === -1; });
      var pick = pool[Math.floor(Math.random() * pool.length)];
      recent.push(pick);
      if (recent.length > 3) recent.shift();
      return artBase() + pick;
    };
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
  function isFreeTierModel(m) {
    return !!m && (m.gateCostTier === "free" || m.costTier === "free");
  }

  function priceHtml(m) {
    // backend may later supply a ready-to-show price string; prefer it.
    if (isFreeTierModel(m)) {
      return '<span class="cancri-price__tag cancri-price__tag--promo">Promo</span>' +
        '<span class="cancri-price__tag cancri-price__tag--free">Free</span>';
    }
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

  // 近 24h 状态条：数据来自 chat-gateway `model_health`（model_health_logs）。
  // 那是真实用户请求的抽样成功/失败，不是定时探测。用户侧 400/403/413/422 不计入。
  var healthById = {};

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function hourlyFor(id) {
    var row = healthById[String(id || "").toLowerCase()];
    return row && Array.isArray(row.hourly) ? row.hourly : null;
  }

  function hourTooltip(hourIso, total, rate) {
    var d = new Date(hourIso);
    if (!hourIso || isNaN(d.getTime())) {
      return total ? ("成功率 " + rate + "% · " + total + " 次") : "无调用样本";
    }
    var end = new Date(d.getTime() + 3600000);
    var span = pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + "–" + pad2(end.getHours()) + ":" + pad2(end.getMinutes());
    if (!total) return span + " 无调用样本";
    return span + " 成功率 " + rate + "% · " + total + " 次";
  }

  function uptimeHtml(hourly) {
    var hours = Array.isArray(hourly) ? hourly : [];
    var maxTotal = 1;
    var i;
    for (i = 0; i < hours.length; i++) {
      var t = Number(hours[i] && hours[i].total) || 0;
      if (t > maxTotal) maxTotal = t;
    }
    var segs = "";
    for (i = 0; i < 24; i++) {
      var h = hours[i] || { hour: "", total: 0, success_rate: null };
      var total = Number(h.total) || 0;
      var rate = typeof h.success_rate === "number" ? h.success_rate : null;
      var cls = "cancri-uptime__seg--empty";
      if (total > 0) cls = (rate != null && rate >= 90) ? "cancri-uptime__seg--ok" : "cancri-uptime__seg--bad";
      var ratio = total > 0 ? Math.max(0.42, total / maxTotal) : 0.34;
      segs += '<span class="cancri-uptime__seg ' + cls + '" style="height:' + Math.round(ratio * 100) + '%" title="' + escAttr(hourTooltip(h.hour, total, rate)) + '"></span>';
    }
    return '<div class="cancri-uptime" role="img" aria-label="近24小时用户请求成功率">' + segs + "</div>";
  }

  function applyUptime(map) {
    if (map) healthById = map;
    var nodes = document.querySelectorAll("[data-model-id] .cancri-uptime");
    var i = 0;
    function chunk() {
      var end = Math.min(i + 8, nodes.length);
      for (; i < end; i++) {
        var el = nodes[i];
        var card = el.closest("[data-model-id]");
        var id = card ? card.getAttribute("data-model-id") : "";
        el.outerHTML = uptimeHtml(hourlyFor(id));
      }
      if (i < nodes.length) requestAnimationFrame(chunk);
    }
    if (nodes.length) chunk();
  }

  function paintUptimeSlot(slot) {
    if (!slot || slot.getAttribute("data-uptime-slot") == null) return;
    var card = slot.closest("[data-model-id]");
    var id = card ? card.getAttribute("data-model-id") : "";
    slot.removeAttribute("data-uptime-slot");
    slot.innerHTML = uptimeHtml(hourlyFor(id));
  }

  function observeUptimeSlots() {
    var slots = document.querySelectorAll("[data-uptime-slot]");
    if (!slots.length) return;
    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < slots.length; i++) paintUptimeSlot(slots[i]);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var e = 0; e < entries.length; e++) {
        if (!entries[e].isIntersecting) continue;
        io.unobserve(entries[e].target);
        paintUptimeSlot(entries[e].target);
      }
    }, { rootMargin: "280px 0px" });
    for (var j = 0; j < slots.length; j++) io.observe(slots[j]);
  }

  function afterFirstPaint(fn) {
    requestAnimationFrame(function () {
      requestAnimationFrame(fn);
    });
  }

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
        '<div class="w-full" style="height:230px">' +
          '<div class="cancri-thumb flex h-full w-full flex-1 flex-row items-center justify-center gap-4 rounded-lg" ' +
               'style="background-image:url(\'' + escAttr(opts.art || (ART_OVERRIDE[id] ? artBase() + ART_OVERRIDE[id] : artBase() + ART_POOL[0])) + '\')">' +
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
            '<div class="cancri-spec__row cancri-spec__row--uptime" data-uptime-slot></div>' +
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
  function specializedCardHtml(m, art) {
    var id = m.id || m.canonicalId || "";
    var name = m.displayName || id;
    var desc = m.publicDescription || (m.brand ? m.brand + " 模型" : "");
    // 2026-08-15: 专项小卡名字右侧加 Free 绿胶囊（仅 Free，不带 Promo，复用
    // priceHtml 里同一个 CSS class，跟旗舰/全量大卡的胶囊视觉一致）。
    var freeTag = isFreeTierModel(m)
      ? ' <span class="cancri-price__tag cancri-price__tag--free">Free</span>'
      : "";
    // 专项小卡：页内锚到下方完整目录大卡（#model-<id>），不进详情页
    return (
      '<a href="#model-' + escAttr(id) + '" class="flex h-full flex-col gap-4 text-emphasis hover:text-emphasis">' +
        '<div class="group flex h-full w-full cursor-pointer flex-row items-center gap-4 rounded-lg p-2 hover:bg-primary-soft">' +
          '<div class="cancri-thumb-sm flex shrink-0 overflow-hidden rounded-lg" ' +
               'style="background-image:url(\'' + escAttr(art) + '\')"></div>' +
          '<div class="flex flex-col min-w-0">' +
            '<div class="flex items-center gap-2">' +
              '<div class="font-semibold truncate">' + esc(name) + '</div>' + freeTag +
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
      var pickArt = makeArtPicker();
      shown.forEach(function (m) { html += specializedCardHtml(m, pickArt(m.id || m.canonicalId || "")); });
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
      // 只展示 FEATURED_ORDER 命中项，禁止用非旗舰模型补位（曾冒出 gemini-3.1-flash-lite）
      var byIdFrontier = {};
      models.forEach(function (m) {
        var mid = String(m.id || m.canonicalId || "").toLowerCase();
        if (mid) byIdFrontier[mid] = m;
      });
      var top = FEATURED_ORDER.map(function (id) { return byIdFrontier[id.toLowerCase()]; }).filter(Boolean);
      var n = parseInt(frontier.getAttribute("data-cancri-limit") || "3", 10);
      if (n > 0) top = top.slice(0, n);
      // anchor ids only when there is no full grid on this page (e.g. landing),
      // otherwise the full grid owns the `model-<id>` anchors.
      var frontierAnchor = !document.getElementById("cancri-grid");
      var pickFrontier = makeArtPicker();
      frontier.innerHTML = top.length
        ? top.map(function (m) {
            return cardHtml(m, { flagshipBadge: true, anchor: frontierAnchor, art: pickFrontier(m.id || m.canonicalId || "") });
          }).join("")
        : '<div class="text-sm text-secondary py-6">暂无旗舰模型</div>';
    }

    var free = document.getElementById("cancri-free");
    if (free) {
      var byId = {};
      models.forEach(function (m) {
        var mid = String(m.id || m.canonicalId || "").toLowerCase();
        if (mid) byId[mid] = m;
      });
      var freeList = FREE_ORDER.map(function (id) { return byId[id.toLowerCase()]; }).filter(Boolean);
      var freeAnchor = !document.getElementById("cancri-grid");
      var pickFree = makeArtPicker();
      free.innerHTML = freeList.length
        ? freeList.map(function (m) {
            return cardHtml(m, { flagshipBadge: false, anchor: freeAnchor, art: pickFree(m.id || m.canonicalId || "") });
          }).join("")
        : '<div class="text-sm text-secondary py-6">暂无免费模型</div>';
    }

    var grid = document.getElementById("cancri-grid");
    if (grid) {
      var pickGrid = makeArtPicker();
      grid.innerHTML = models.map(function (m) {
        return cardHtml(m, { flagshipBadge: true, anchor: true, art: pickGrid(m.id || m.canonicalId || "") });
      }).join("");
    }

    renderSpecialized(models);
    bindSpecializedScroll();
    bindCardNav();
    locateHashModel(models);

    var counters = document.querySelectorAll("[data-cancri-count]");
    counters.forEach(function (el) { el.textContent = String(models.length); });
  }

  function locateHashModel(models) {
    var raw = String(window.location.hash || "");
    if (!raw) return;

    // GLM 营销弹窗等：滚到免费模型版块
    if (raw === "#cancri-free" || raw === "#cancri-free-section") {
      var freeSec = document.getElementById("cancri-free-section") || document.getElementById("cancri-free");
      if (!freeSec) return;
      window.setTimeout(function () {
        freeSec.scrollIntoView({ behavior: "smooth", block: "start" });
        freeSec.setAttribute("data-cancri-located", "true");
        window.setTimeout(function () { freeSec.removeAttribute("data-cancri-located"); }, 2200);
      }, 80);
      return;
    }

    if (raw.indexOf("#model-") !== 0) return;
    var requested = "";
    try { requested = decodeURIComponent(raw.slice(7)); } catch (_) { requested = raw.slice(7); }
    var target = document.getElementById("model-" + requested);
    if (!target && /glm-?5\.2/i.test(requested)) {
      var match = models.find(function (m) {
        var id = String(m.id || m.canonicalId || "");
        var name = String(m.displayName || "");
        return /glm-?5\.2/i.test(id + " " + name) && /fp8/i.test(id + " " + name);
      });
      if (match) target = document.getElementById("model-" + (match.id || match.canonicalId));
      // 旧锚点兼容：滚到免费版块（GLM 在其中）
      if (!target) {
        target = document.getElementById("cancri-free-section") || document.getElementById("cancri-free");
      }
    }
    if (!target) return;
    window.setTimeout(function () {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.setAttribute("data-cancri-located", "true");
      window.setTimeout(function () { target.removeAttribute("data-cancri-located"); }, 2200);
    }, 80);
  }

  var __specScrollBound = false;
  function bindSpecializedScroll() {
    var container = document.getElementById("cancri-specialized");
    if (!container || __specScrollBound) return;
    __specScrollBound = true;
    container.addEventListener("click", function (e) {
      var a = e.target.closest('a[href^="#model-"]');
      if (!a) return;
      var href = a.getAttribute("href") || "";
      var raw = href.slice("#model-".length);
      var id = raw;
      try { id = decodeURIComponent(raw); } catch (_) { /* keep raw */ }
      var target = document.getElementById("model-" + id);
      if (!target) return;
      e.preventDefault();
      if (history && history.pushState) history.pushState(null, "", href);
      else window.location.hash = href;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.setAttribute("data-cancri-located", "true");
      window.setTimeout(function () { target.removeAttribute("data-cancri-located"); }, 2200);
    });
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

  function healthFetchOptions() {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
      body: JSON.stringify({ endpoint: "model_health", window_days: 1 }),
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    };
  }

  async function loadHealth() {
    var urls = gatewayCandidates();
    for (var i = 0; i < urls.length; i++) {
      try {
        var r = await fetchOnce(urls[i], healthFetchOptions(), i === 0 ? 12000 : 20000);
        if (!r.ok) continue;
        var data = await r.json();
        var map = {};
        var rows = Array.isArray(data && data.models) ? data.models : [];
        for (var k = 0; k < rows.length; k++) {
          var id = String(rows[k].model_id || "").toLowerCase();
          if (id) map[id] = rows[k];
        }
        return map;
      } catch (_e) { /* 下一条网关 */ }
    }
    return {};
  }

  function skelLine(cls) {
    return '<span class="cancri-skel-line cancri-skel-shimmer ' + (cls || "") + '"></span>';
  }
  function skelFeatureCard() {
    return (
      '<div class="cancri-skel-card" aria-hidden="true">' +
        '<div class="cancri-skel-thumb cancri-skel-shimmer"></div>' +
        '<div class="cancri-skel-body">' +
          skelLine("cancri-skel-line--lg") +
          skelLine("cancri-skel-line--md") +
          '<div class="cancri-skel-spec">' +
            skelLine("cancri-skel-line--sm") +
            skelLine("cancri-skel-line--sm") +
            skelLine("cancri-skel-line--sm") +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }
  function skelFeatureGrid(n) {
    var html = "";
    for (var i = 0; i < n; i++) html += skelFeatureCard();
    return html;
  }
  function skelSpecChip() {
    return (
      '<div class="cancri-skel-chip" aria-hidden="true">' +
        '<div class="cancri-skel-chip__art cancri-skel-shimmer"></div>' +
        '<div class="cancri-skel-chip__text">' +
          skelLine("cancri-skel-line--lg") +
          skelLine("cancri-skel-line--md") +
        "</div>" +
      "</div>"
    );
  }
  function skelSpecialized() {
    var html = "";
    for (var r = 0; r < 2; r++) {
      html += '<div class="cancri-skel-spec-row">';
      html += '<div class="cancri-skel-spec-side">' + skelLine("cancri-skel-line--lg") + skelLine("cancri-skel-line--md") + "</div>";
      html += '<div class="cancri-skel-spec-grid">';
      for (var i = 0; i < 4; i++) html += skelSpecChip();
      html += "</div></div>";
      if (r === 0) html += '<div class="h-px w-full bg-primary-soft"></div>';
    }
    return html;
  }
  function showLoadingSkeletons() {
    var frontier = document.getElementById("cancri-frontier");
    if (frontier) {
      frontier.setAttribute("aria-busy", "true");
      var fn = parseInt(frontier.getAttribute("data-cancri-limit") || "6", 10);
      frontier.innerHTML = skelFeatureGrid(fn > 0 ? fn : 6);
    }
    var free = document.getElementById("cancri-free");
    if (free) {
      free.setAttribute("aria-busy", "true");
      free.innerHTML = skelFeatureGrid(FREE_ORDER.length);
    }
    var specialized = document.getElementById("cancri-specialized");
    if (specialized) {
      specialized.setAttribute("aria-busy", "true");
      specialized.innerHTML = skelSpecialized();
    }
    var loading = document.getElementById("cancri-loading");
    var grid = document.getElementById("cancri-grid");
    if (loading) {
      loading.removeAttribute("data-cancri-hidden");
      loading.setAttribute("aria-busy", "true");
      loading.innerHTML = skelFeatureGrid(6);
    }
    if (grid) grid.setAttribute("data-cancri-hidden", "");
  }

  function showError(msg) {
    var loading = document.getElementById("cancri-loading");
    if (loading) {
      loading.setAttribute("data-cancri-hidden", "");
      loading.removeAttribute("aria-busy");
    }
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
    showLoadingSkeletons();
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
      if (loading) {
        loading.setAttribute("data-cancri-hidden", "");
        loading.removeAttribute("aria-busy");
      }
      var grid = document.getElementById("cancri-grid");
      if (grid) grid.removeAttribute("data-cancri-hidden");
      render(models);
      ["cancri-frontier", "cancri-free", "cancri-specialized"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.removeAttribute("aria-busy");
      });
      afterFirstPaint(function () {
        observeUptimeSlots();
        loadHealth().then(function (map) {
          applyUptime(map);
        }).catch(function () {});
      });
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
