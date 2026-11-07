/* /api/docs/pricing/ — every model's ¥ price from the live catalog, in OpenAI's pricing-page markup:
 * 旗舰模型 (with a 默认分组 / 全部分组 segmented switch), 免费模型, one table per vendor, 按次计费.
 * The static 实时语音 / 计费说明 sections live in the page source. #price-<id> (linked from the detail
 * page) expands the right table and highlights the row. */
(function () {
  "use strict";

  var M = window.NexusModels;
  var root = document.querySelector('[data-models-page="pricing"]');
  if (!M || !root) return;

  var esc = M.esc;
  var body = root.querySelector("[data-pricing-body]");
  var skeleton = body.innerHTML;
  var COLLAPSE_AT = 6;
  var LINK_ICON =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" class="anchor-heading-icon" role="presentation"><path d="M18.2929 5.7071C16.4743 3.88849 13.5257 3.88849 11.7071 5.7071L10.7071 6.7071C10.3166 7.09763 9.68341 7.09763 9.29289 6.7071C8.90236 6.31658 8.90236 5.68341 9.29289 5.29289L10.2929 4.29289C12.8926 1.69322 17.1074 1.69322 19.7071 4.29289C22.3068 6.89255 22.3068 11.1074 19.7071 13.7071L18.7071 14.7071C18.3166 15.0976 17.6834 15.0976 17.2929 14.7071C16.9024 14.3166 16.9024 13.6834 17.2929 13.2929L18.2929 12.2929C20.1115 10.4743 20.1115 7.52572 18.2929 5.7071ZM15.7071 8.29289C16.0976 8.68341 16.0976 9.31658 15.7071 9.7071L9.7071 15.7071C9.31658 16.0976 8.68341 16.0976 8.29289 15.7071C7.90236 15.3166 7.90236 14.6834 8.29289 14.2929L14.2929 8.29289C14.6834 7.90236 15.3166 7.90236 15.7071 8.29289ZM6.7071 9.29289C7.09763 9.68341 7.09763 10.3166 6.7071 10.7071L5.7071 11.7071C3.88849 13.5257 3.88849 16.4743 5.7071 18.2929C7.52572 20.1115 10.4743 20.1115 12.2929 18.2929L13.2929 17.2929C13.6834 16.9024 14.3166 16.9024 14.7071 17.2929C15.0976 17.6834 15.0976 18.3166 14.7071 18.7071L13.7071 19.7071C11.1074 22.3068 6.89255 22.3068 4.29289 19.7071C1.69322 17.1074 1.69322 12.8926 4.29289 10.2929L5.29289 9.29289C5.68341 8.90236 6.31658 8.90236 6.7071 9.29289Z" fill="currentColor"></path></svg>';

  function heading(id, title, sub, first) {
    return (
      '<div class="' + (first ? "" : "pricing-subsection ") + 'pricing-section-heading mp-section"><div class="anchor-heading-wrapper">' +
      '<h2 id="' + esc(id) + '" class="anchor-heading" data-name="' + esc(id) + '" data-anchor-id="' + esc(id) + '"><span>' + esc(title) + "</span>" + LINK_ICON + "</h2></div>" +
      (sub ? '<div class="pricing-switcher-subheading">' + esc(sub) + "</div>" : "") +
      "</div>"
    );
  }
  function meta(text) {
    return '<p class="pricing-section-meta">' + esc(text) + "</p>";
  }

  // One row of a token table; per-call and free lines fit the same columns.
  function tokenRow(m, opts) {
    var p = M.priceOf(m);
    var cells =
      p.kind === "token" ? [M.yenFixed(p.input), M.yenFixed(p.output), M.yenFixed(p.cached)]
        : p.kind === "free" ? ["免费", "免费", "—"]
          : p.kind === "call" ? [M.yenFixed(p.call) + " / 次", "—", "—"]
            : [M.priceText(m), "—", "—"];
    var tag = opts.tag === false ? "" : M.variantOf(m);
    return (
      "<tr" + (opts.anchor ? ' id="price-' + esc(m.id) + '" class="models-anchor"' : "") + (opts.member ? " data-member" : "") + (opts.hidden ? " hidden" : "") + ">" +
      '<td><span class="mp-cell">' + M.brandLogo(m, "link") + '<a href="' + esc(M.detailUrl(m.id)) + '">' + esc(m.id) + "</a>" +
      (tag ? '<span class="models-tag">' + esc(tag) + "</span>" : "") +
      (p.kind === "free" ? M.badge("免费", "success") : "") +
      (m.available === false ? M.badge("暂不可用", "warning") : "") +
      "</span></td><td>" + esc(cells[0]) + "</td><td>" + esc(cells[1]) + '</td><td class="mp-cache">' + esc(cells[2]) + "</td></tr>"
    );
  }

  function tokenTable(rowsHtml) {
    return (
      '<div class="mp-scroll"><table class="mp-table"><colgroup><col style="width:40%" /><col style="width:18%" /><col style="width:18%" /><col style="width:24%" /></colgroup>' +
      '<thead><tr class="mp-caption"><th colspan="3"></th><th scope="colgroup" class="mp-cache"><div>提示缓存</div></th></tr>' +
      '<tr><th scope="col">模型</th><th scope="col">输入</th><th scope="col">输出</th><th scope="col" class="mp-cache">缓存命中</th></tr></thead>' +
      "<tbody>" + rowsHtml + "</tbody></table></div>"
    );
  }

  function moreButton(open, count) {
    return (
      '<div class="mp-more"><button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="outline" data-pill="" data-size="md" data-table-toggle aria-expanded="' + open + '">' +
      '<span class="_ButtonInner_6dmow_4"><span style="align-items:center;display:inline-flex;gap:0.375rem"><span>' + (open ? "收起" : "全部模型（" + count + "）") + "</span>" +
      M.icon.chevronDown("") + "</span></span></button></div>"
    );
  }

  function linesOf(cards) {
    var out = [];
    cards.forEach(function (c) {
      (c.groupInfo ? c.groupInfo.members : [c]).forEach(function (m) {
        out.push(m);
      });
    });
    return out;
  }

  function segmented() {
    var opt = function (value, label, on) {
      return (
        '<button type="button" data-state="' + (on ? "on" : "off") + '" role="radio" aria-checked="' + on + '" class="_SegmentedControlOption_16x8u_142" data-flagship-mode="' + value + '">' +
        '<span class="relative">' + esc(label) + "</span></button>"
      );
    };
    return (
      '<div class="pricing-context-selector not-prose" style="display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-top:20px;margin-bottom:20px">' +
      '<span style="color:var(--color-text-secondary);font-size:14px;line-height:20px;white-space:nowrap">分组</span>' +
      '<div role="radiogroup" dir="ltr" class="_SegmentedControl_16x8u_1" data-size="md" aria-label="分组" data-segmented>' +
      '<div class="_SegmentedControlThumb_16x8u_226" data-segmented-thumb></div>' +
      opt("rep", "默认分组", true) + opt("all", "全部分组", false) +
      "</div></div>"
    );
  }

  function render(cat) {
    var html = "";
    var sections = 0;

    // 旗舰模型: one row per flagship card; its other group lines appear with 全部分组.
    var flagship = cat.featured();
    if (flagship.length) {
      var frows = "";
      var hasMembers = false;
      flagship.forEach(function (card) {
        frows += tokenRow(card.groupInfo ? cat.get(card.id) || card : card, {});
        (card.groupInfo ? card.groupInfo.members : []).forEach(function (mem) {
          if (mem.id === card.id) return;
          hasMembers = true;
          frows += tokenRow(mem, { member: true, hidden: true });
        });
      });
      html +=
        heading("flagship", "旗舰模型", "", !sections++) +
        (hasMembers ? segmented() : "") +
        meta("每百万 token 价格。") +
        '<div class="not-prose" data-pricing-table>' + tokenTable(frows) + "</div>";
    }

    var free = cat.free();
    if (free.length) {
      html +=
        heading("free-models", "免费模型", "不扣余额，调用计入免费额度。", !sections++) +
        meta("每百万 token 价格。") +
        '<div class="not-prose" data-pricing-table>' + tokenTable(free.map(function (m) { return tokenRow(m, {}); }).join("")) + "</div>";
    }

    cat.vendors().forEach(function (v) {
      var lines = linesOf(v.list);
      var rows = lines.map(function (m, i) {
        return tokenRow(m, { anchor: true, hidden: i >= COLLAPSE_AT });
      }).join("");
      html +=
        heading("vendor-" + v.brand.toLowerCase().replace(/\s+/g, "-"), v.label, lines.length + " 个 Model ID。", !sections++) +
        meta("每百万 token 价格；按次计费的行标明每次价格。") +
        '<div class="not-prose" data-pricing-table>' + tokenTable(rows) + (lines.length > COLLAPSE_AT ? moreButton(false, lines.length) : "") + "</div>";
    });

    var perCall = cat.raw.filter(function (m) {
      return M.priceOf(m).kind === "call";
    });
    if (perCall.length) {
      html +=
        heading("per-call", "按次计费", "每次成功的请求按固定价格扣费，与 token 数量无关。", !sections++) +
        meta("每次请求价格。") +
        '<div class="not-prose" data-pricing-table><div class="mp-scroll"><table class="mp-table"><colgroup><col style="width:40%" /><col style="width:30%" /><col style="width:30%" /></colgroup>' +
        '<thead><tr><th scope="col">模型</th><th scope="col">厂商</th><th scope="col">每次请求</th></tr></thead><tbody>' +
        perCall.map(function (m) {
          var tag = M.variantOf(m);
          return (
            '<tr><td><span class="mp-cell">' + M.brandLogo(m, "link") + '<a href="' + esc(M.detailUrl(m.id)) + '">' + esc(m.id) + "</a>" + (tag ? '<span class="models-tag">' + esc(tag) + "</span>" : "") + "</span></td>" +
            "<td>" + esc(M.brandLabel(m.brand || "其他")) + "</td><td>" + esc(M.yenFixed(M.priceOf(m).call)) + "</td></tr>"
          );
        }).join("") +
        "</tbody></table></div></div>";
    }

    body.innerHTML = html;
    body.removeAttribute("aria-busy");
    body.removeAttribute("aria-label");
    body.querySelectorAll("[data-pricing-table]").forEach(markLast);
    placeThumb();
    buildToc();
    locate();
  }

  // The last *visible* row loses its border and gets the rounded cache cell (OpenAI styles the final row).
  function markLast(box) {
    var rows = box.querySelectorAll("tbody tr");
    var last = null;
    rows.forEach(function (tr) {
      tr.classList.remove("mp-last");
      if (!tr.hidden) last = tr;
    });
    if (last) last.classList.add("mp-last");
  }

  function setExpanded(box, open) {
    var rows = box.querySelectorAll("tbody tr");
    rows.forEach(function (tr, i) {
      tr.hidden = !open && i >= COLLAPSE_AT;
    });
    var btn = box.querySelector("[data-table-toggle]");
    if (btn) btn.parentNode.outerHTML = moreButton(open, rows.length);
    markLast(box);
  }

  function placeThumb() {
    var group = body.querySelector("[data-segmented]");
    if (!group) return;
    var on = group.querySelector('[data-state="on"]');
    var thumb = group.querySelector("[data-segmented-thumb]");
    var w = Math.floor(on.clientWidth);
    if (group.clientWidth - (w + on.offsetLeft) < 2) w--;
    thumb.style.width = w + "px";
    thumb.style.transform = "translateX(" + on.offsetLeft + "px)";
  }

  body.addEventListener("click", function (e) {
    var toggle = e.target.closest("[data-table-toggle]");
    if (toggle) {
      var box = toggle.closest("[data-pricing-table]");
      setExpanded(box, toggle.getAttribute("aria-expanded") !== "true");
      var again = box.querySelector("[data-table-toggle]");
      if (again) again.focus();
      return;
    }
    var mode = e.target.closest("[data-flagship-mode]");
    if (mode) {
      var all = mode.getAttribute("data-flagship-mode") === "all";
      body.querySelectorAll("[data-flagship-mode]").forEach(function (b) {
        var on = b === mode;
        b.setAttribute("data-state", on ? "on" : "off");
        b.setAttribute("aria-checked", String(on));
      });
      var table = body.querySelector("[data-pricing-table]");
      table.querySelectorAll("tr[data-member]").forEach(function (tr) {
        tr.hidden = !all;
      });
      markLast(table);
      placeThumb();
      return;
    }
    if (e.target.closest("[data-pricing-retry]")) boot(true);
  });
  window.addEventListener("resize", placeThumb);

  // ── right-hand TOC (same markup and behaviour as the docs layout's rail) ──
  var toc = root.querySelector("[data-pricing-toc]");
  var tocList = root.querySelector("[data-pricing-toc-list]");
  var indicator = root.querySelector("[data-pricing-toc-indicator]");
  var tocHeadings = [];
  var tocCurrent = null;
  var tocPauseUntil = 0;

  function buildToc() {
    tocHeadings = Array.prototype.slice.call(root.querySelectorAll("#mainContent h2.anchor-heading[id]"));
    tocList.innerHTML = tocHeadings
      .map(function (h, i) {
        return '<li data-id="' + esc(h.id) + '" class="leading-5 ml-0"><a href="#' + esc(h.id) + '" class="block text-sm ' + (i === 0 ? "text-default" : "text-tertiary hover:text-secondary") + ' pl-2 transition-colors">' + esc(h.textContent.trim()) + "</a></li>";
      })
      .join("");
    toc.hidden = !tocHeadings.length;
    tocCurrent = null;
    spy();
  }
  function setActive(id) {
    if (id === tocCurrent) return;
    tocCurrent = id;
    tocList.querySelectorAll("li[data-id]").forEach(function (li) {
      var a = li.querySelector("a");
      var on = li.getAttribute("data-id") === id;
      a.classList.toggle("text-default", on);
      a.classList.toggle("text-tertiary", !on);
      a.classList.toggle("hover:text-secondary", !on);
      if (on) {
        indicator.style.transform = "translateY(" + li.offsetTop + "px)";
        indicator.style.height = li.offsetHeight + "px";
      }
    });
  }
  // The vendored CSS gives html `overflow-y: auto` and html/body `height: 100%`, so with body.overflow-x-hidden
  // the <body> is the scroll container (as on OpenAI's site) — window.scrollY stays 0 there.
  function scroller() {
    var b = document.body;
    return b.scrollHeight > b.clientHeight + 1 && getComputedStyle(b).overflowY !== "visible" ? b : document.scrollingElement || document.documentElement;
  }
  function spy() {
    if (Date.now() < tocPauseUntil || !tocHeadings.length) return;
    var offset = (parseFloat(getComputedStyle(document.body).getPropertyValue("--docs-scroll-offset")) || 110) + 1;
    var id = tocHeadings[0].id;
    tocHeadings.forEach(function (h) {
      if (h.getBoundingClientRect().top <= offset) id = h.id;
    });
    var sc = scroller();
    if (sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) id = tocHeadings[tocHeadings.length - 1].id;
    setActive(id);
  }
  var ticking = false;
  document.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      spy();
    });
  }, { capture: true, passive: true });
  window.addEventListener("resize", function () {
    tocCurrent = null;
    spy();
  });
  toc.addEventListener("click", function (e) {
    var a = e.target.closest("a[href^='#']");
    var target = a && document.getElementById(a.getAttribute("href").slice(1));
    if (!target) return;
    e.preventDefault();
    tocPauseUntil = Date.now() + 700;
    setActive(target.id);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", "#" + target.id);
  });

  // #price-<id>: open the collapsed table that holds the row, then centre and highlight it.
  function locate() {
    var hash = location.hash.slice(1);
    if (!hash) return;
    try {
      hash = decodeURIComponent(hash);
    } catch (e) {}
    var target = document.getElementById(hash);
    if (!target) return;
    if (target.tagName === "TR" && target.hidden) setExpanded(target.closest("[data-pricing-table]"), true);
    setTimeout(function () {
      target.scrollIntoView({ behavior: "smooth", block: target.tagName === "TR" ? "center" : "start" });
      if (target.tagName !== "TR") return;
      target.setAttribute("data-located", "");
      setTimeout(function () {
        target.removeAttribute("data-located");
      }, 2200);
    }, 80);
  }
  window.addEventListener("hashchange", locate);

  function showError(err) {
    body.removeAttribute("aria-busy");
    body.innerHTML =
      '<div class="models-state not-prose" role="alert"><div class="text-base font-semibold text-emphasis">暂时无法加载价格</div>' +
      '<div class="text-sm text-secondary">' + esc(M.errorText(err)) + "。价格来自实时的模型目录，请检查网络后重试。</div>" +
      '<button type="button" class="_Button_6dmow_1" data-color="primary" data-variant="solid" data-pill="" data-size="md" data-pricing-retry><span class="_ButtonInner_6dmow_4">重试</span></button></div>';
    buildToc();
  }

  function boot(fresh) {
    if (fresh) {
      body.innerHTML = skeleton;
      body.setAttribute("aria-busy", "true");
    }
    M.load({ fresh: fresh }).then(render, showError);
  }
  boot(false);
})();
