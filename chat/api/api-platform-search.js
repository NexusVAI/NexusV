/*
 * Cancri 开放平台 — 顶栏全局搜索
 * 索引各 API 子页面正文；api_docs.html 复用页内 modal。
 */
(function () {
  "use strict";

  var SEARCH_ANIM_MS = 300;
  var indexReady = false;
  var indexLoading = false;
  var searchIndex = [];
  var activeResultIdx = -1;
  var searchCloseTimer = 0;

  var modal;
  var input;
  var resultsHost;
  var backdrop;
  var trigger;
  var ownsModal = false;
  var ownsShortcut = false;

  function chatRootPrefix() {
    var path = location.pathname || "";
    if (/\/api\/?$/.test(path) || /\/api\/index\.html$/i.test(path)) {
      return "../";
    }
    return "./";
  }

  function platformPages() {
    var root = chatRootPrefix();
    return [
      { url: root + "api/", label: "概览" },
      { url: root + "api_apply.html", label: "申请" },
      { url: root + "api_keys.html", label: "控制台" },
      { url: root + "api_models.html", label: "模型" },
      { url: root + "api_docs.html", label: "文档" },
      { url: root + "pricing.html", label: "套餐" },
      { url: root + "orders.html", label: "我的订单" },
    ];
  }

  function isDocsPage() {
    return !!document.getElementById("docsSearchModal");
  }

  function extractText(el) {
    if (!el) return "";
    if (el.classList && el.classList.contains("code-tabs")) return "";
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function indexGenericPage(doc, pageUrl, pageLabel) {
    var entries = [];
    var main = doc.querySelector("main") || doc.body;
    if (!main) return entries;

    var h1 =
      main.querySelector("h1.page-title") ||
      main.querySelector(".page-title") ||
      main.querySelector("h1");
    if (h1) {
      var sub =
        main.querySelector(".subtitle") ||
        main.querySelector(".lede") ||
        main.querySelector(".hero__lede");
      entries.push({
        url: pageUrl,
        hash: "",
        title: h1.textContent.trim(),
        crumbs: pageLabel,
        body: sub ? extractText(sub) : "",
      });
    }

    main.querySelectorAll("h2, h3, h4").forEach(function (h) {
      if (h.closest(".topbar, .site-footer, .cancri-promo-banner")) return;
      var body = "";
      var cursor = h.nextElementSibling;
      while (cursor) {
        if (/^H[2-4]$/.test(cursor.tagName)) break;
        body += " " + extractText(cursor);
        cursor = cursor.nextElementSibling;
      }
      var id = h.id || "";
      entries.push({
        url: pageUrl,
        hash: id,
        title: h.textContent.trim(),
        crumbs: pageLabel + (h.tagName === "H3" || h.tagName === "H4" ? " · " + (h1 ? h1.textContent.trim() : "") : ""),
        body: body.trim(),
      });
    });

    main.querySelectorAll("p, li, .entry-card__desc, .doc-card-text").forEach(function (el) {
      if (el.closest("nav, header, footer, .code-tabs, script, style")) return;
      var text = extractText(el);
      if (!text || text.length < 12) return;
      entries.push({
        url: pageUrl,
        hash: "",
        title: text.slice(0, 48) + (text.length > 48 ? "…" : ""),
        crumbs: pageLabel,
        body: text,
      });
    });

    return entries;
  }

  function indexDocsPage(doc, pageUrl, pageLabel) {
    var entries = [];
    doc.querySelectorAll("main section[id]").forEach(function (section) {
      var sectionH2 = section.querySelector("h2");
      var sectionTitle = sectionH2 ? sectionH2.textContent.trim() : section.id;
      var headings = section.querySelectorAll(":scope > h2, :scope > h3");
      headings.forEach(function (h, hi) {
        var nextH = headings[hi + 1] || null;
        var body = "";
        var cursor = h.nextElementSibling;
        while (cursor && cursor !== nextH) {
          body += " " + extractText(cursor);
          cursor = cursor.nextElementSibling;
        }
        var anchor = h.id || section.id;
        entries.push({
          url: pageUrl,
          hash: anchor,
          title: h.textContent.trim(),
          crumbs: pageLabel + (h.tagName === "H3" ? " · " + sectionTitle : ""),
          body: body.trim(),
        });
      });
    });

    doc.querySelectorAll(".toc a[href^='#']").forEach(function (a) {
      var hash = (a.getAttribute("href") || "").replace(/^#/, "");
      if (!hash) return;
      entries.push({
        url: pageUrl,
        hash: hash,
        title: a.textContent.trim(),
        crumbs: pageLabel + " · 目录",
        body: "",
      });
    });

    return entries;
  }

  function indexFromHtml(html, pageUrl, pageLabel) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    if (pageUrl.indexOf("api_docs") !== -1) {
      return indexDocsPage(doc, pageUrl, pageLabel);
    }
    return indexGenericPage(doc, pageUrl, pageLabel);
  }

  function dedupeEntries(entries) {
    var seen = {};
    return entries.filter(function (e) {
      var key = e.url + "#" + e.hash + "|" + e.title;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function buildLocalPageIndex() {
    var label = document.title.split("·")[0].trim() || "当前页";
    var path = location.pathname.split("/").pop() || "index.html";
    if (/\/api\/?$/.test(location.pathname)) {
      return indexGenericPage(document, chatRootPrefix() + "api/", "概览");
    }
    if (path === "api_docs.html") {
      return indexDocsPage(document, chatRootPrefix() + "api_docs.html", "文档");
    }
    return indexGenericPage(document, location.href.split("#")[0], label);
  }

  function loadRemoteIndex() {
    if (indexReady || indexLoading) return Promise.resolve();
    indexLoading = true;
    var pages = platformPages();
    var jobs = pages.map(function (page) {
      if (page.url === location.href.split("#")[0]) {
        return Promise.resolve({ page: page, html: null, local: true });
      }
      return fetch(page.url, { credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error("fetch_failed");
          return r.text();
        })
        .then(function (html) {
          return { page: page, html: html, local: false };
        })
        .catch(function () {
          return { page: page, html: null, local: false };
        });
    });

    return Promise.all(jobs).then(function (results) {
      var merged = [];
      results.forEach(function (res) {
        if (res.local) {
          merged = merged.concat(buildLocalPageIndex());
          return;
        }
        if (!res.html) return;
        merged = merged.concat(indexFromHtml(res.html, res.page.url, res.page.label));
      });
      searchIndex = dedupeEntries(merged);
      indexReady = true;
      indexLoading = false;
    });
  }

  function ensureModal() {
    if (modal) return;
    modal = document.createElement("div");
    modal.className = "docs-search-modal";
    modal.id = "platformSearchModal";
    modal.hidden = true;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "搜索开放平台");
    modal.innerHTML =
      '<div class="docs-search-backdrop" id="platformSearchBackdrop"></div>' +
      '<div class="docs-search-panel">' +
      '<div class="docs-search-input-row">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
      '<input type="search" class="docs-search-input" id="platformSearchInput" placeholder="搜索页面、文档章节与功能…" autocomplete="off" spellcheck="false" />' +
      "</div>" +
      '<div class="docs-search-results" id="platformSearchResults" role="listbox"></div>' +
      '<div class="docs-search-footer">' +
      "<span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>" +
      "<span><kbd>⏎</kbd> 跳转</span>" +
      "<span><kbd>Esc</kbd> 关闭</span>" +
      "</div></div>";
    document.body.appendChild(modal);
    input = modal.querySelector("#platformSearchInput");
    resultsHost = modal.querySelector("#platformSearchResults");
    backdrop = modal.querySelector("#platformSearchBackdrop");
    ownsModal = true;

    backdrop.addEventListener("click", closeSearch);
    input.addEventListener("input", function () {
      renderResults(input.value);
    });
    input.addEventListener("keydown", onSearchKeydown);
  }

  function injectTopbarTrigger() {
    var inner = document.querySelector(".topbar__inner");
    if (!inner || inner.querySelector(".topbar__search")) return;

    var wrap = document.createElement("div");
    wrap.className = "topbar__search";
    wrap.innerHTML =
      '<button class="topbar-search-trigger" type="button" id="platformSearchTrigger" aria-label="搜索开放平台">' +
      '<svg class="topbar-search-trigger__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>' +
      '<span class="topbar-search-trigger__label">搜索开放平台…</span>' +
      '<span class="topbar-search-kbd" aria-hidden="true">' +
      '<kbd id="platformSearchModKey">Ctrl</kbd><kbd>K</kbd></span></button>';

    var actions = inner.querySelector(".topbar__actions");
    var themeEl =
      inner.querySelector(".theme-picker") || inner.querySelector("[data-theme-toggle]");
    if (actions) {
      inner.insertBefore(wrap, actions);
    } else if (themeEl) {
      inner.insertBefore(wrap, themeEl);
    } else {
      inner.appendChild(wrap);
    }

    trigger = wrap.querySelector("#platformSearchTrigger");
    trigger.setAttribute("title", "搜索开放平台 (Ctrl+K)");
    trigger.addEventListener("click", openSearch);

    var modKey = wrap.querySelector("#platformSearchModKey");
    if (modKey && /Mac|iPhone|iPad/.test(navigator.platform)) {
      modKey.textContent = "⌘";
    }
  }

  function isSearchOpen() {
    if (!modal) return false;
    return !modal.hidden && modal.classList.contains("is-visible");
  }

  function openSearch() {
    if (isDocsPage()) {
      var docsTrigger = document.getElementById("docsSearchTrigger");
      if (docsTrigger) docsTrigger.click();
      return;
    }

    ensureModal();
    if (searchCloseTimer) {
      clearTimeout(searchCloseTimer);
      searchCloseTimer = 0;
    }
    modal.hidden = false;
    modal.classList.remove("is-closing");
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        modal.classList.add("is-visible");
      });
    });

    if (!indexReady) {
      resultsHost.innerHTML = '<div class="is-loading">正在索引各页面…</div>';
      loadRemoteIndex().then(function () {
        if (input) {
          input.value = "";
          input.focus();
          renderResults("");
        }
      });
    } else {
      input.value = "";
      input.focus();
      renderResults("");
    }
    document.body.style.overflow = "hidden";
  }

  function closeSearch() {
    if (!modal || modal.hidden) return;
    if (modal.classList.contains("is-closing")) return;
    if (!modal.classList.contains("is-visible")) {
      modal.hidden = true;
      return;
    }
    modal.classList.add("is-closing");
    activeResultIdx = -1;
    document.body.style.overflow = "";
    if (searchCloseTimer) clearTimeout(searchCloseTimer);
    searchCloseTimer = window.setTimeout(function () {
      modal.classList.remove("is-visible", "is-closing");
      modal.hidden = true;
      searchCloseTimer = 0;
    }, SEARCH_ANIM_MS);
  }

  function onSearchKeydown(e) {
    var results = resultsHost.querySelectorAll(".docs-search-result");
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeResultIdx = (activeResultIdx + 1) % results.length;
      highlightActive(results);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeResultIdx = (activeResultIdx - 1 + results.length) % results.length;
      highlightActive(results);
    } else if (e.key === "Enter") {
      e.preventDefault();
      var target = activeResultIdx >= 0 ? results[activeResultIdx] : results[0];
      if (target) target.click();
    }
  }

  function highlightActive(results) {
    results.forEach(function (r, i) {
      r.classList.toggle("is-active", i === activeResultIdx);
    });
    if (activeResultIdx >= 0) {
      results[activeResultIdx].scrollIntoView({ block: "nearest" });
    }
  }

  function scoreEntry(entry, tokens) {
    var title = entry.title.toLowerCase();
    var body = (entry.body || "").toLowerCase();
    var crumbs = (entry.crumbs || "").toLowerCase();
    var score = 0;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      var inTitle = title.indexOf(t) !== -1;
      var inBody = body.indexOf(t) !== -1;
      var inCrumbs = crumbs.indexOf(t) !== -1;
      if (!inTitle && !inBody && !inCrumbs) return 0;
      if (inTitle) score += 10;
      if (inCrumbs) score += 4;
      if (inBody) score += 1;
    }
    return score;
  }

  function truncateAround(text, tokens) {
    if (!text) return "";
    var lower = text.toLowerCase();
    var pos = -1;
    tokens.forEach(function (t) {
      var idx = lower.indexOf(t);
      if (idx !== -1 && (pos === -1 || idx < pos)) pos = idx;
    });
    if (pos === -1) return text.slice(0, 120);
    var start = Math.max(0, pos - 40);
    return (start > 0 ? "…" : "") + text.slice(start, start + 120) + (start + 120 < text.length ? "…" : "");
  }

  function appendHighlighted(host, text, tokens) {
    if (!text) return;
    var lower = text.toLowerCase();
    var ranges = [];
    tokens.forEach(function (t) {
      if (!t) return;
      var start = 0;
      while (true) {
        var idx = lower.indexOf(t, start);
        if (idx < 0) break;
        ranges.push([idx, idx + t.length]);
        start = idx + t.length;
      }
    });
    if (!ranges.length) {
      host.textContent = text;
      return;
    }
    ranges.sort(function (a, b) {
      return a[0] - b[0];
    });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });
    var cursor = 0;
    merged.forEach(function (r) {
      if (r[0] > cursor) host.appendChild(document.createTextNode(text.slice(cursor, r[0])));
      var mark = document.createElement("mark");
      mark.textContent = text.slice(r[0], r[1]);
      host.appendChild(mark);
      cursor = r[1];
    });
    if (cursor < text.length) host.appendChild(document.createTextNode(text.slice(cursor)));
  }

  function buildResultNode(entry, tokens, isFirst) {
    var a = document.createElement("a");
    a.className = "docs-search-result" + (isFirst ? " is-active" : "");
    a.href = entry.hash ? entry.url + "#" + entry.hash : entry.url;
    a.setAttribute("role", "option");

    if (entry.crumbs) {
      var crumbs = document.createElement("div");
      crumbs.className = "docs-search-result-crumbs";
      crumbs.textContent = entry.crumbs;
      a.appendChild(crumbs);
    }
    var title = document.createElement("div");
    title.className = "docs-search-result-title";
    appendHighlighted(title, entry.title, tokens);
    a.appendChild(title);
    if (entry.body) {
      var excerpt = document.createElement("div");
      excerpt.className = "docs-search-result-excerpt";
      appendHighlighted(excerpt, truncateAround(entry.body, tokens), tokens);
      a.appendChild(excerpt);
    }
    return a;
  }

  function renderResults(rawQuery) {
    if (!resultsHost) return;
    if (!indexReady) return;
    var q = (rawQuery || "").trim();
    resultsHost.innerHTML = "";
    activeResultIdx = q ? 0 : -1;
    if (!q) return;
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    var hits = searchIndex
      .map(function (entry) {
        return { entry: entry, score: scoreEntry(entry, tokens) };
      })
      .filter(function (x) {
        return x.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      })
      .slice(0, 28);

    if (!hits.length) {
      var empty = document.createElement("div");
      empty.className = "is-empty";
      empty.textContent = "没有匹配项";
      resultsHost.appendChild(empty);
      return;
    }
    hits.forEach(function (h, i) {
      resultsHost.appendChild(buildResultNode(h.entry, tokens, i === 0));
    });
  }

  function wireShortcut() {
    if (ownsShortcut) return;
    ownsShortcut = true;
    document.addEventListener("keydown", function (e) {
      if (isDocsPage()) return;
      var open = isSearchOpen();
      var busy =
        modal && !modal.hidden && modal.classList.contains("is-closing");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open || busy) closeSearch();
        else openSearch();
        return;
      }
      if ((open || busy) && e.key === "Escape") {
        e.preventDefault();
        closeSearch();
      }
    });
  }

  function init() {
    if (!document.querySelector(".topbar")) return;
    if (/\/api\/admin(?:_|\.html)/.test(location.pathname || "")) return;

    injectTopbarTrigger();

    if (isDocsPage()) return;

    wireShortcut();
    loadRemoteIndex();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
