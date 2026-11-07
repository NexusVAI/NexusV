/* /api/docs/models/ — model catalog: flagship cards, free models, then every model by use case and vendor.
 * Markup is OpenAI's ModelOverview (cards with a spec list + "specialized models" rows); data, prices and
 * covers come from models.js. Old links /chat/api_models.html#model-<id> land here with their hash. */
(function () {
  "use strict";

  var M = window.NexusModels;
  var root = document.querySelector('[data-models-page="catalog"]');
  if (!M || !root) return;

  var FLAGSHIP_LIMIT = 12;
  var esc = M.esc;
  var ROW = "flex min-h-12 items-start justify-between gap-x-4 gap-y-2 py-3 text-sm text-emphasis";
  var MORE_ROW = "flex min-h-12 flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 text-sm text-emphasis";
  var CHIP = "rounded-sm bg-primary-outline-active px-2 py-0.5 text-sm font-normal text-emphasis shadow-[inset_0_0_0_1px_var(--color-background-primary-soft-alpha)]";
  var MORE_CLOSED = "max-h-0 overflow-hidden opacity-0 transition-all duration-300 ease-in-out [&>*+*]:border-t [&>*+*]:border-default";
  var MORE_OPEN = "max-h-[360px] overflow-hidden opacity-100 transition-all duration-300 ease-in-out [&>*+*]:border-t [&>*+*]:border-default";
  // GPT-Live is not in the catalog (realtime only); it is listed by hand under 实时语音.
  var LIVE_MODEL = { id: "gpt-live-1", brand: "OpenAI" };

  var cat = null;
  var healthReady = false;
  var picked = {};
  var expanded = { flagship: false, free: false };
  var skeletons = {};
  var brandFilter = readBrandFilter();

  function readBrandFilter() {
    try {
      return new URLSearchParams(location.search).get("brand") || "";
    } catch (e) {
      return "";
    }
  }
  function matchesBrand(m) {
    return !brandFilter || M.brandOf(m) === brandFilter;
  }

  function row(label, value, opts) {
    opts = opts || {};
    return (
      '<div class="' + ROW + (opts.nowrap ? " flex-nowrap" : " flex-wrap") + '">' +
      '<div class="shrink-0 whitespace-nowrap text-emphasis">' + label + "</div>" +
      '<div class="ml-auto min-w-0 text-right font-semibold text-emphasis' + (opts.narrow ? " max-w-[60%]" : "") + '">' + value + "</div></div>"
    );
  }
  function moreRow(label, value) {
    return '<div class="' + MORE_ROW + '"><div class="shrink-0 whitespace-nowrap text-emphasis">' + label + '</div><div class="ml-auto min-w-0 text-right font-semibold text-emphasis">' + value + "</div></div>";
  }
  function withTag(tag, text) {
    return tag ? '<span class="inline-flex flex-wrap items-center justify-end gap-1.5"><span class="models-tag">' + esc(tag) + "</span>" + esc(text) + "</span>" : esc(text);
  }
  function capabilities(m) {
    var caps = [];
    if (m.enableThinking) caps.push("思考");
    if (m.multimodal) caps.push("图像输入");
    return caps.length ? caps.join("、") : "文本";
  }
  function priceRows(m, tag) {
    var p = M.priceOf(m);
    if (p.kind === "token") {
      return (
        row("输入价格", withTag(tag, M.yen(p.input) + " / 百万 token")) +
        row("输出价格", withTag(tag, M.yen(p.output) + " / 百万 token")) +
        row("缓存价格", withTag(tag, p.cached != null ? M.yen(p.cached) + " / 百万 token" : "—"))
      );
    }
    if (p.kind === "free") return row("价格", '<span class="inline-flex justify-end">' + M.badge("免费", "success") + "</span>");
    if (p.kind === "call") return row("价格", withTag(tag, M.yen(p.call) + " / 次"));
    return row("价格", withTag(tag, M.priceText(m)));
  }

  // What a card currently shows: the picked line, or the card itself with the group's cheapest price.
  function cardState(card) {
    var gi = card.groupInfo;
    var pick = picked[card.id] ? cat.get(picked[card.id]) : null;
    var priceFrom = pick || M.cheapestMember(card);
    return {
      shown: pick || card,
      priceFrom: priceFrom,
      tag: gi && !pick && M.modelId(priceFrom) !== M.modelId(card) ? M.variantOf(priceFrom) : "",
      healthIds: pick ? [pick.id] : gi ? gi.variants.map(function (v) { return v.id; }) : [card.id],
    };
  }

  function specsHtml(card, section) {
    var gi = card.groupInfo;
    var st = cardState(card);
    var shownId = M.modelId(st.shown);
    var html = row("Model ID", '<div class="flex items-center justify-end gap-1">' + M.copyButton(shownId, "复制 Model ID") + '<span class="' + CHIP + ' models-id-chip font-mono">' + esc(shownId) + "</span></div>");
    if (gi && gi.variants.length > 1) {
      html += row(
        "分组",
        '<div class="flex max-w-[220px] flex-wrap justify-end gap-0.5" role="group" aria-label="切换分组">' +
          gi.variants
            .map(function (v) {
              var on = picked[card.id] === v.id;
              return '<button type="button" class="models-variant ' + CHIP + '" data-variant-pick="' + esc(v.id) + '" aria-pressed="' + on + '" title="' + esc(v.id) + '">' + esc(v.variant) + "</button>";
            })
            .join("") +
          "</div>",
        { nowrap: true, narrow: true },
      );
    } else if (section === "free" && M.variantOf(card)) {
      html += row("分组", '<span class="' + CHIP + '">' + esc(M.variantOf(card)) + "</span>");
    }
    html += priceRows(st.priceFrom, st.tag);
    html += row("近 24 小时", '<div class="flex justify-end" data-uptime-slot>' + M.uptimeHtml(healthReady ? M.bestHourly(st.healthIds) : null) + "</div>");
    var maxOut = M.compactTokens(st.shown.maxOutputTokens);
    html +=
      '<div class="' + (expanded[section] ? MORE_OPEN : MORE_CLOSED) + '" data-card-more>' +
      moreRow("上下文窗口", esc(M.compactTokens(st.shown.maxInputTokens) || "—")) +
      moreRow("最大输出", esc(maxOut ? maxOut + " tokens" : "—")) +
      moreRow("能力", esc(capabilities(st.shown))) +
      "</div>";
    return html;
  }

  function bigCard(card, section) {
    var id = M.modelId(card);
    var name = card.displayName || id;
    var desc = M.description(card);
    var mark = M.wordmark(name);
    var badges = (section === "free" ? M.badge("免费", "success") : "") + (card.available === false ? M.badge("暂不可用", "warning") : "");
    // The whole top (cover, name, description) opens the model; a stretched link keeps the vendor logo clickable.
    return (
      '<div class="flex flex-col text-emphasis" data-card="' + esc(id) + '" data-card-section="' + section + '" data-model-id="' + esc(id) + '"' +
      (section === "flagship" ? ' data-flagship="' + esc(id) + '"' : "") + ">" +
      '<div class="relative flex flex-col text-emphasis">' +
      '<a href="' + esc(M.detailUrl(id)) + '" class="models-stretched" data-card-link aria-label="' + esc(name) + '"></a>' +
      '<div class="h-[180px] w-full"><div aria-hidden="true" class="cancri-thumb flex h-full w-full flex-1 flex-row items-center justify-center gap-4 rounded-lg [container-type:inline-size]" style="' + M.coverStyle(id) + '">' +
      '<span class="models-wordmark w-full px-[9%] text-left leading-none font-semibold tracking-tight whitespace-nowrap text-white text-[clamp(2rem,18cqw,5rem)]"' + M.wordmarkAttrs(mark) + ">" + esc(mark) + "</span></div></div>" +
      '<div class="mt-5 flex flex-col gap-1"><div class="flex items-center gap-1.5 text-base font-semibold text-emphasis">' + M.brandLogo(card) + "<span>" + esc(name) + "</span>" + badges + "</div>" +
      (desc ? '<div class="text-sm text-secondary">' + esc(desc) + "</div>" : "") +
      "</div></div>" +
      '<div class="mt-8"><div class="flex flex-col gap-4"><div class="_SectionContent_1tiej_1" data-card-specs>' + specsHtml(card, section) + "</div></div></div></div>"
    );
  }

  function rowHtml(m, href, name, badges, desc, meta, anchor) {
    var id = M.modelId(m);
    return (
      '<div class="models-row relative flex h-full flex-col gap-4 text-emphasis' + (anchor ? ' models-anchor" id="model-' + esc(id) : "") + '" data-model-id="' + esc(id) + '">' +
      '<a href="' + esc(href) + '" class="models-stretched" aria-label="' + esc(name) + '"></a>' +
      '<div class="models-row-inner group flex h-full w-full cursor-pointer flex-row items-start gap-4 rounded-lg p-2">' +
      '<div class="cancri-thumb flex shrink-0 overflow-hidden rounded-lg w-12 h-12" style="' + M.coverStyle(id) + '"></div>' +
      '<div class="flex min-w-0 flex-col"><div class="flex items-center gap-2">' + M.brandLogo(m) + '<div class="font-semibold">' + esc(name) + "</div>" + badges + "</div>" +
      (desc ? '<div class="text-sm text-secondary">' + esc(desc) + "</div>" : "") +
      '<div class="mt-0.5 text-xs text-tertiary">' + esc(meta) + "</div></div></div></div>"
    );
  }

  function rowItem(m, anchor) {
    var id = M.modelId(m);
    var gi = m.groupInfo;
    var price = M.priceText(M.cheapestMember(m)) + (gi && gi.variants.length > 1 ? " · " + gi.variants.length + " 个分组" : "");
    var badges = (M.isFree(m) ? M.badge("免费", "success") : "") + (m.available === false ? M.badge("暂不可用", "warning") : "");
    return rowHtml(m, M.detailUrl(id), m.displayName || id, badges, M.description(m), price, anchor);
  }

  function liveItem() {
    return rowHtml(LIVE_MODEL, "/api/docs/guides/realtime/", "GPT-Live 1", "", "边听边说的全双工实时语音，通过 WebSocket 接入，不能用 Chat Completions 调用。", "gpt-live-1 · 按秒计费，后端另计", false);
  }

  // Shown above 旗舰模型 while a vendor filter is on.
  var brandBar = document.createElement("div");
  brandBar.className = "models-brand-bar";
  brandBar.setAttribute("data-brand-bar", "");
  brandBar.hidden = true;
  var flagshipSection = root.querySelector("#flagship");
  flagshipSection.parentNode.insertBefore(brandBar, flagshipSection);

  function paintBrandBar() {
    brandBar.hidden = !brandFilter;
    if (!brandFilter) {
      brandBar.innerHTML = "";
      return;
    }
    var vendor = cat.vendors().filter(function (v) { return v.brand === brandFilter; })[0];
    var label = M.brandLabel(brandFilter);
    brandBar.innerHTML =
      '<div class="models-brand-bar__text">' + M.brandLogo({ brand: brandFilter }) +
      (vendor ? "<span>只显示 <strong>" + esc(label) + "</strong> 的模型 · 共 " + vendor.list.length + " 个</span>" : "<span>没有找到 <strong>" + esc(label) + "</strong> 的模型</span>") +
      "</div>" +
      '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="outline" data-pill="" data-size="md" data-brand-clear><span class="_ButtonInner_6dmow_4">清除筛选</span></button>';
  }

  function setBrandFilter(brand) {
    brandFilter = brand;
    try {
      var url = new URL(location.href);
      if (brand) url.searchParams.set("brand", brand);
      else url.searchParams.delete("brand");
      history.replaceState(null, "", url.pathname + url.search);
    } catch (e) {}
    render();
    (brand ? brandBar : root).scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function groupBlock(id, title, sub, items) {
    return (
      '<div><div id="' + esc(id) + '" class="models-anchor flex scroll-mt-24 flex-col gap-4 py-4 md:flex-row md:items-start md:justify-between">' +
      '<div class="flex min-w-[220px] max-w-[320px] flex-col gap-1 md:w-[320px] md:min-w-[320px] md:max-w-[320px] md:flex-none md:pr-6">' +
      '<div class="text-base font-semibold text-emphasis">' + esc(title) + '</div><div class="text-sm text-secondary">' + esc(sub) + "</div></div>" +
      '<div class="-mx-2 grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-2">' + items + "</div></div>" +
      '<div class="h-px w-full bg-primary-soft"></div></div>'
    );
  }

  function moreButton(section) {
    var on = expanded[section];
    return (
      '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="outline" data-pill="" data-size="md" data-more-toggle="' + section + '" aria-expanded="' + on + '">' +
      '<span class="_ButtonInner_6dmow_4"><span>' + (on ? "收起" : "查看更多") + "</span>" + M.icon.chevronDown(on ? "h-3 w-3 rotate-180" : "h-3 w-3") + "</span></button>"
    );
  }

  function note(text) {
    return '<div class="models-grid-full py-6 text-sm text-secondary">' + esc(text) + "</div>";
  }

  function fillGrid(section, cards, three) {
    var grid = root.querySelector('[data-models-grid="' + section + '"]');
    var more = root.querySelector('[data-models-more="' + section + '"]');
    grid.removeAttribute("aria-busy");
    grid.removeAttribute("aria-label");
    grid.classList.toggle("xl:grid-cols-3", three);
    grid.classList.toggle("xl:grid-cols-4", !three);
    grid.innerHTML = cards.length ? cards.map(function (c) { return bigCard(c, section); }).join("") : note(section === "free" ? "当前没有免费模型。" : "暂无旗舰模型。");
    more.innerHTML = cards.length ? moreButton(section) : "";
    more.hidden = !cards.length;
  }

  function render() {
    var flagship = cat.featured().filter(matchesBrand).slice(0, FLAGSHIP_LIMIT);
    var free = cat.free().filter(matchesBrand);
    // Full flagship rows: three columns when the count splits into threes but not fours (9 → 3×3), else
    // four. The free grid follows so cards keep one width down the page.
    var three = flagship.length % 4 !== 0 && flagship.length % 3 === 0;
    fillGrid("flagship", flagship, three);
    fillGrid("free", free, three);
    // With a vendor filter on, sections that have none of its models disappear.
    flagshipSection.hidden = Boolean(brandFilter) && !flagship.length;
    root.querySelector('[data-models-section="free"]').hidden = Boolean(brandFilter) && !free.length;
    paintBrandBar();

    var groups = root.querySelector("[data-models-groups]");
    var html = '<div class="h-px w-full bg-primary-soft"></div>';
    var pareto = cat.pareto().filter(matchesBrand);
    if (pareto.length) html += groupBlock("group-pareto", "高性价比", "综合能力与价格挑选的高性价比模型。", pareto.map(function (m) { return rowItem(m, false); }).join(""));
    if (matchesBrand(LIVE_MODEL)) html += groupBlock("group-realtime", "实时语音", "全双工语音模型，接入方式见实时语音文档。", liveItem());
    cat.vendors().filter(function (v) { return !brandFilter || v.brand === brandFilter; }).forEach(function (v) {
      html += groupBlock("vendor-" + v.brand.toLowerCase().replace(/\s+/g, "-"), v.label, v.list.length + " 个模型", v.list.map(function (m) { return rowItem(m, true); }).join(""));
    });
    groups.innerHTML = html;
    groups.removeAttribute("aria-busy");
    groups.removeAttribute("aria-label");

    var count = root.querySelector("[data-models-count]");
    if (count) count.textContent = String(cat.count);
    // The recommendation in 选择模型 names a model; fall back to the first flagship if it left the catalog.
    root.querySelectorAll("[data-model-link]").forEach(function (a) {
      var m = cat.get(a.getAttribute("data-model-link")) || cat.featured()[0];
      if (!m) return;
      a.href = M.detailUrl(m.id);
      a.textContent = m.displayName || m.id;
    });
    M.syncCovers();
  }

  // Flagship cards are folded group cards (or a standalone member); free cards are always single lines.
  function modelForCard(el) {
    var id = el.getAttribute("data-card");
    var card = cat.card(id);
    return el.getAttribute("data-card-section") === "free" || !card || M.modelId(card) !== id ? cat.get(id) : card;
  }

  function paintUptime(scope) {
    scope.querySelectorAll("[data-uptime-slot]").forEach(function (slot) {
      var model = modelForCard(slot.closest("[data-card]"));
      if (model) slot.innerHTML = M.uptimeHtml(M.bestHourly(cardState(model).healthIds));
    });
  }

  function refreshCard(el) {
    var model = modelForCard(el);
    if (!model) return;
    var st = cardState(model);
    el.querySelector("[data-card-specs]").innerHTML = specsHtml(model, el.getAttribute("data-card-section"));
    el.querySelector("[data-card-link]").href = M.detailUrl(st.shown.id);
  }

  root.addEventListener("click", function (e) {
    var logo = e.target.closest("[data-brand-filter]");
    if (logo) {
      e.preventDefault();
      var brand = logo.getAttribute("data-brand-filter");
      setBrandFilter(brandFilter === brand ? "" : brand);
      return;
    }
    if (e.target.closest("[data-brand-clear]")) {
      setBrandFilter("");
      return;
    }
    var pick = e.target.closest("[data-variant-pick]");
    if (pick) {
      var el = pick.closest("[data-card]");
      var cardId = el.getAttribute("data-card");
      var id = pick.getAttribute("data-variant-pick");
      picked[cardId] = picked[cardId] === id ? null : id;
      refreshCard(el);
      var again = el.querySelector('[data-variant-pick="' + id.replace(/["\\]/g, "\\$&") + '"]');
      if (again) again.focus();
      return;
    }
    var toggle = e.target.closest("[data-more-toggle]");
    if (toggle) {
      var section = toggle.getAttribute("data-more-toggle");
      expanded[section] = !expanded[section];
      root.querySelectorAll('[data-card-section="' + section + '"] [data-card-more]').forEach(function (block) {
        block.className = expanded[section] ? MORE_OPEN : MORE_CLOSED;
      });
      var box = root.querySelector('[data-models-more="' + section + '"]');
      box.innerHTML = moreButton(section);
      box.querySelector("button").focus();
      return;
    }
    if (e.target.closest("[data-models-retry]")) boot(true);
  });

  // #model-<id> (also a group member's id) → its flagship card if it has one, else its row in 全部模型.
  function locate() {
    if (!cat) return;
    var hash = location.hash || "";
    var target = null;
    var block = "center";
    if (hash === "#cancri-free" || hash === "#cancri-free-section") {
      target = document.getElementById("free-models");
      block = "start";
    } else if (hash.indexOf("#model-") === 0) {
      var requested = hash.slice(7);
      try {
        requested = decodeURIComponent(requested);
      } catch (e) {}
      var rid = cat.repId(requested);
      var member = cat.get(requested);
      target = root.querySelector('[data-flagship="' + rid.replace(/["\\]/g, "\\$&") + '"]');
      // A link to one line of a folded card opens the card on that line.
      if (target && member && member.id !== rid && cat.members(member.id)) {
        picked[rid] = member.id;
        refreshCard(target);
      }
      target = target || document.getElementById("model-" + rid) || document.getElementById("model-" + requested);
    }
    if (!target) return;
    setTimeout(function () {
      target.scrollIntoView({ behavior: "smooth", block: block });
      if (block === "start") return;
      target.setAttribute("data-located", "");
      setTimeout(function () {
        target.removeAttribute("data-located");
      }, 2200);
    }, 80);
  }
  window.addEventListener("hashchange", locate);

  function showError(err) {
    var grid = root.querySelector('[data-models-grid="flagship"]');
    grid.removeAttribute("aria-busy");
    grid.innerHTML =
      '<div class="models-state models-grid-full" role="alert">' +
      '<div class="text-base font-semibold text-emphasis">暂时无法加载模型目录</div>' +
      '<div class="text-sm text-secondary">' + esc(M.errorText(err)) + "。请检查网络后重试。</div>" +
      '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="solid" data-pill="" data-size="md" data-models-retry><span class="_ButtonInner_6dmow_4">重试</span></button></div>';
    root.querySelector('[data-models-section="free"]').hidden = true;
    root.querySelector('[data-models-section="all"]').hidden = true;
  }

  function boot(fresh) {
    if (fresh) {
      Object.keys(skeletons).forEach(function (sel) {
        var el = root.querySelector(sel);
        el.innerHTML = skeletons[sel];
        el.setAttribute("aria-busy", "true");
      });
      root.querySelector('[data-models-section="free"]').hidden = false;
      root.querySelector('[data-models-section="all"]').hidden = false;
    }
    M.load({ fresh: fresh }).then(
      function (data) {
        cat = data;
        render();
        locate();
        requestAnimationFrame(function () {
          M.loadHealth().then(function () {
            healthReady = true;
            paintUptime(root);
          });
        });
      },
      showError,
    );
  }

  ['[data-models-grid="flagship"]', '[data-models-grid="free"]', "[data-models-groups]"].forEach(function (sel) {
    skeletons[sel] = root.querySelector(sel).innerHTML;
  });
  boot(false);
})();
