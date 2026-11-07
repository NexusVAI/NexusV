/* Behaviour for the OpenAI-style chrome on /api pages: theme picker, mobile drawer, search overlay,
 * right-hand TOC, heading links, code samples, "复制页面", sidebar scroll memory, community button.
 * Markup comes from api/_src/lib/shell.mjs + layouts.mjs. */
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var qs = function (sel, el) { return (el || doc).querySelector(sel); };
  var qsa = function (sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); };

  // OpenAI's CSS (html{overflow-y:auto} + html,body{height:100%} + body.overflow-x-hidden) makes <body>
  // the scroll container, so window scroll events and window.scrollY never move.
  function scroller() {
    var b = doc.body;
    return b && /(auto|scroll)/.test(getComputedStyle(b).overflowY) && b.scrollHeight > b.clientHeight
      ? b
      : doc.scrollingElement || root;
  }

  // ── OpenAI Sans preview (local machine only — the font files are never published) ──
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    var fontPreview = null;
    try {
      var requested = new URLSearchParams(location.search).get("font");
      if (requested) localStorage.setItem("api_font_preview", requested);
      fontPreview = localStorage.getItem("api_font_preview");
    } catch (e) {}
    if (fontPreview === "oai") {
      var fontLink = doc.createElement("link");
      fontLink.rel = "stylesheet";
      fontLink.href = "/api/_preview-fonts/oai-sans.css";
      doc.head.appendChild(fontLink);
    }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = doc.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      doc.body.appendChild(ta);
      ta.select();
      try { doc.execCommand("copy") ? resolve() : reject(new Error("copy failed")); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  // ── Theme picker ──────────────────────────────────────────────────────
  function syncThemeRadios() {
    var pref = window.__apiTheme ? window.__apiTheme.read() : "light";
    qsa("input[data-theme-preference]").forEach(function (input) { input.checked = input.value === pref; });
  }
  syncThemeRadios();
  doc.addEventListener("change", function (e) {
    var input = e.target;
    if (!input.matches || !input.matches("input[data-theme-preference]") || !window.__apiTheme) return;
    var still = doc.createElement("style");
    still.textContent = "*,*::before,*::after{transition:none!important}";
    doc.head.appendChild(still);
    window.__apiTheme.save(input.value);
    window.__apiTheme.apply(input.value);
    syncThemeRadios();
    requestAnimationFrame(function () { requestAnimationFrame(function () { still.remove(); }); });
    var details = input.closest("details[data-theme-picker]");
    if (details) {
      details.open = false;
      var summary = qs("summary", details);
      if (summary) summary.focus();
    }
  });
  window.addEventListener("storage", syncThemeRadios);
  doc.addEventListener("click", function (e) {
    qsa("details[data-theme-picker][open]").forEach(function (d) { if (!d.contains(e.target)) d.open = false; });
  });

  // ── Drawer (mobile) ───────────────────────────────────────────────────
  var drawer = qs("#drawer");
  var drawerBtn = qs("#header-drawer-button");
  function setDrawer(open) {
    if (!drawer || !drawerBtn) return;
    drawer.classList.toggle("open", open);
    drawerBtn.classList.toggle("open", open);
    drawerBtn.setAttribute("aria-expanded", String(open));
    drawerBtn.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
  }
  if (drawerBtn) drawerBtn.addEventListener("click", function () { setDrawer(!drawer.classList.contains("open")); });
  if (drawer) {
    drawer.addEventListener("click", function (e) {
      if (e.target.closest("[data-mobile-nav-link]")) setDrawer(false);
      var option = e.target.closest("[data-mobile-context-option]");
      if (!option) return;
      var id = option.getAttribute("data-mobile-context-option");
      qsa("[data-mobile-context-option]", drawer).forEach(function (b) { b.setAttribute("data-selected", String(b === option)); });
      qsa("[data-mobile-nav-variant-content]", drawer).forEach(function (v) { v.hidden = v.getAttribute("data-variant-id") !== id; });
    });
  }

  // ── Search ────────────────────────────────────────────────────────────
  var overlay = qs("#header-search-overlay");
  var input = qs("[data-site-search-input]");
  var resultsBox = qs("[data-site-search-results]");
  var emptyBox = qs("[data-site-search-empty-state]");
  var searchButtons = qsa("[data-header-search-button]");
  var indexPromise = null;
  var activeHit = -1;

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch("/api/assets/search-index.json", { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (data) { return Array.isArray(data) ? data : []; });
    }
    // Page scripts (e.g. the model catalog) may add entries after the index has loaded.
    return indexPromise.then(function (items) { return items.concat(window.__apiSearchExtra || []); });
  }

  function setSearch(open) {
    if (!overlay) return;
    overlay.classList.toggle("hidden", !open);
    overlay.classList.toggle("flex", open);
    overlay.setAttribute("data-open", String(open));
    overlay.setAttribute("aria-hidden", String(!open));
    root.classList.toggle("has-header-search-open", open);
    searchButtons.forEach(function (b) { b.setAttribute("aria-expanded", String(open)); });
    if (open) {
      setDrawer(false);
      loadIndex();
      setTimeout(function () { if (input) { input.focus(); input.select(); } }, 0);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  function mark(text, terms) {
    var out = escapeHtml(text);
    terms.forEach(function (t) {
      if (!t) return;
      var re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      out = out.replace(re, '<mark class="_emphasis_1wztd_63">$1</mark>');
    });
    return out;
  }

  function snippet(text, terms) {
    var lower = text.toLowerCase();
    var at = -1;
    terms.some(function (t) { at = lower.indexOf(t); return at >= 0; });
    var start = Math.max(0, at - 40);
    return (start > 0 ? "…" : "") + text.slice(start, start + 140) + (text.length > start + 140 ? "…" : "");
  }

  function runSearch(q) {
    var query = q.trim().toLowerCase();
    if (!query) {
      resultsBox.hidden = true;
      emptyBox.hidden = false;
      return;
    }
    var terms = query.split(/\s+/).filter(Boolean);
    loadIndex().then(function (items) {
      var hits = [];
      items.forEach(function (it) {
        var title = (it.t || "").toLowerCase();
        var hay = [it.t, it.d, it.s, it.x].concat((it.h || []).map(function (h) { return h[1]; })).join(" ").toLowerCase();
        if (!terms.every(function (t) { return hay.indexOf(t) >= 0; })) return;
        var score = 0;
        terms.forEach(function (t) {
          if (title === t) score += 50;
          else if (title.indexOf(t) === 0) score += 25;
          else if (title.indexOf(t) >= 0) score += 15;
        });
        var heading = null;
        (it.h || []).some(function (h) {
          if (terms.every(function (t) { return h[1].toLowerCase().indexOf(t) >= 0; })) { heading = h; return true; }
          return false;
        });
        if (heading) score += 8;
        hits.push({ it: it, score: score, heading: heading });
      });
      hits.sort(function (a, b) { return b.score - a.score; });
      hits = hits.slice(0, 30);
      emptyBox.hidden = true;
      resultsBox.hidden = false;
      activeHit = -1;
      if (!hits.length) {
        resultsBox.innerHTML = '<p class="px-3 py-6 text-sm text-secondary">没有找到与「' + escapeHtml(q.trim()) + '」相关的内容。</p>';
        return;
      }
      resultsBox.innerHTML = hits.map(function (h) {
        var it = h.it;
        var href = it.u + (h.heading ? "#" + h.heading[0] : "");
        var crumbs = [it.s, h.heading ? it.t : ""].filter(Boolean)
          .map(function (c) { return '<span class="_hitBreadcrumb_1wztd_32">' + escapeHtml(c) + "</span>"; })
          .join('<span class="_hitBreadcrumbSeparator_1wztd_47">›</span>');
        var title = h.heading ? h.heading[1] : it.t;
        var body = it.d || it.x || "";
        return '<a class="_hit_1wztd_5" href="' + escapeHtml(href) + '" data-search-hit>' +
          (crumbs ? '<div class="_hitBreadcrumbs_1wztd_32">' + crumbs + "</div>" : "") +
          '<div class="_hitTitle_1wztd_20">' + mark(title, terms) + "</div>" +
          (body ? '<div class="_hitSnippet_1wztd_52">' + mark(snippet(body, terms), terms) + "</div>" : "") +
          "</a>";
      }).join("");
    });
  }

  function moveHit(delta) {
    var hits = qsa("[data-search-hit]", resultsBox);
    if (!hits.length) return;
    activeHit = (activeHit + delta + hits.length) % hits.length;
    hits.forEach(function (h, i) { h.classList.toggle("api-hit-active", i === activeHit); });
    hits[activeHit].scrollIntoView({ block: "nearest" });
  }

  if (overlay && input) {
    searchButtons.forEach(function (b) { b.addEventListener("click", function () { setSearch(true); }); });
    qsa("[data-header-search-dismiss],[data-header-search-close]", overlay).forEach(function (el) {
      el.addEventListener("click", function () { setSearch(false); });
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) setSearch(false);
      var chip = e.target.closest("[data-search-query-button]");
      if (chip) {
        input.value = chip.getAttribute("data-search-query");
        runSearch(input.value);
        input.focus();
      }
      if (e.target.closest("[data-search-hit]")) setSearch(false);
    });
    input.addEventListener("input", function () { runSearch(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.isComposing) return;
      if (e.key === "ArrowDown") { e.preventDefault(); moveHit(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveHit(-1); }
      else if (e.key === "Enter") {
        var hits = qsa("[data-search-hit]", resultsBox);
        var target = hits[activeHit >= 0 ? activeHit : 0];
        if (target) { e.preventDefault(); location.href = target.getAttribute("href"); setSearch(false); }
      }
    });
  }

  doc.addEventListener("keydown", function (e) {
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setSearch(overlay && overlay.getAttribute("data-open") !== "true");
      return;
    }
    if (e.key !== "Escape") return;
    if (overlay && overlay.getAttribute("data-open") === "true") { setSearch(false); return; }
    var openPicker = qs("details[data-theme-picker][open]");
    if (openPicker) {
      openPicker.open = false;
      var s = qs("summary", openPicker);
      if (s) s.focus();
      return;
    }
    if (drawer && drawer.classList.contains("open")) { setDrawer(false); drawerBtn.focus(); }
  }, true);

  // ── Right-hand TOC (scroll spy + sliding indicator) ───────────────────
  var toc = qs("[data-api-toc]");
  if (toc) {
    var indicator = qs("[data-api-toc-indicator]", toc);
    var tocItems = qsa("li[data-id]", toc);
    var headings = tocItems.map(function (li) { return doc.getElementById(li.getAttribute("data-id")); }).filter(Boolean);
    var pauseUntil = 0;
    var current = null;
    var scrollOffset = function () {
      var v = parseFloat(getComputedStyle(doc.body).getPropertyValue("--docs-scroll-offset"));
      return isNaN(v) ? 110 : v;
    };
    var setActive = function (id) {
      if (id === current) return;
      current = id;
      tocItems.forEach(function (li) {
        var a = qs("a", li);
        var on = li.getAttribute("data-id") === id;
        a.classList.toggle("text-default", on);
        a.classList.toggle("text-tertiary", !on);
        a.classList.toggle("hover:text-secondary", !on);
        if (on && indicator) {
          indicator.style.transform = "translateY(" + li.offsetTop + "px)";
          indicator.style.height = li.offsetHeight + "px";
        }
      });
    };
    var spy = function () {
      if (Date.now() < pauseUntil || !headings.length) return;
      var offset = scrollOffset() + 1;
      var id = headings[0].id;
      headings.forEach(function (h) { if (h.getBoundingClientRect().top <= offset) id = h.id; });
      var s = scroller();
      if (s.scrollTop > 0 && s.scrollTop + s.clientHeight >= s.scrollHeight - 2) id = headings[headings.length - 1].id;
      setActive(id);
    };
    var ticking = false;
    // Capture phase: scroll events don't bubble, and the scrolling element is <body>, not window.
    doc.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; spy(); });
    }, { passive: true, capture: true });
    window.addEventListener("resize", function () { current = null; spy(); });
    toc.addEventListener("click", function (e) {
      var a = e.target.closest("a[href^='#']");
      if (!a) return;
      var target = doc.getElementById(a.getAttribute("href").slice(1));
      if (!target) return;
      e.preventDefault();
      pauseUntil = Date.now() + 700;
      setActive(target.id);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", "#" + target.id);
    });
    spy();
  }

  // ── Heading "copy link" buttons ───────────────────────────────────────
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-anchor-id]");
    if (!btn) return;
    var id = btn.getAttribute("data-anchor-id");
    var url = location.origin + location.pathname + "#" + id;
    copyText(url).catch(function () {});
    history.replaceState(null, "", "#" + id);
    var target = doc.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ── Code samples: copy + language switch ──────────────────────────────
  var LANG_KEY = "api-code-lang";
  function showPane(sample, key) {
    var panes = qsa("[data-code-pane]", sample);
    var match = panes.filter(function (p) { return p.getAttribute("data-code-pane") === key; })[0];
    if (!match) return false;
    panes.forEach(function (p) { p.classList.toggle("hidden", p !== match); });
    var label = qs("[data-code-lang-label]", sample);
    if (label) label.textContent = match.getAttribute("data-label");
    var select = qs("[data-code-lang-select]", sample);
    if (select) select.value = key;
    return true;
  }
  var savedLang = null;
  try { savedLang = localStorage.getItem(LANG_KEY); } catch (e) {}
  if (savedLang) qsa("[data-code-sample]").forEach(function (s) { showPane(s, savedLang); });
  doc.addEventListener("change", function (e) {
    var select = e.target.closest && e.target.closest("[data-code-lang-select]");
    if (!select) return;
    var key = select.value;
    try { localStorage.setItem(LANG_KEY, key); } catch (err) {}
    qsa("[data-code-sample]").forEach(function (s) { showPane(s, key); });
  });
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy-code]");
    if (!btn) return;
    var sample = btn.closest("[data-code-sample]");
    var pane = qsa("[data-code-pane]", sample).filter(function (p) { return !p.classList.contains("hidden"); })[0];
    if (!pane) return;
    var lines = qsa(".syntax-highlighter-line", pane).map(function (l) { return l.textContent.replace(/\n$/, ""); });
    copyText(lines.join("\n")).then(function () {
      var copyIcon = qs('[data-copy-icon="copy"]', btn);
      var checkIcon = qs('[data-copy-icon="check"]', btn);
      var status = qs("[data-copy-status]", sample);
      if (copyIcon && checkIcon) { copyIcon.hidden = true; checkIcon.hidden = false; }
      if (status) status.textContent = "已复制";
      clearTimeout(btn.__t);
      btn.__t = setTimeout(function () {
        if (copyIcon && checkIcon) { copyIcon.hidden = false; checkIcon.hidden = true; }
        if (status) status.textContent = "";
      }, 2000);
    }).catch(function () {});
  });

  // ── 复制页面 ───────────────────────────────────────────────────────────
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-page-copy-action]");
    if (!btn) return;
    var article = qs("#mainContent") || qs("main");
    var h1 = qs("main h1");
    var text = (h1 ? "# " + h1.textContent.trim() + "\n\n" : "") + (article ? article.innerText.trim() : "");
    copyText(text + "\n\n来源：" + location.href).then(function () {
      qsa("[data-page-copy-action]").forEach(function (b) {
        b.setAttribute("data-copied", "true");
        var label = qs("[data-page-copy-label]", b);
        if (label) label.textContent = "已复制";
      });
      setTimeout(function () {
        qsa("[data-page-copy-action]").forEach(function (b) {
          b.removeAttribute("data-copied");
          var label = qs("[data-page-copy-label]", b);
          if (label) label.textContent = "复制页面";
        });
      }, 1300);
    }).catch(function () {});
  });

  // ── Sidebar keeps its scroll position across pages ────────────────────
  var leftNav = qs("[data-left-nav]");
  if (leftNav) {
    var navKey = "left-nav-scroll:" + leftNav.getAttribute("data-left-nav-id");
    try {
      var saved = sessionStorage.getItem(navKey);
      if (saved !== null) leftNav.scrollTop = Number(saved);
      else {
        var active = qs('[aria-current="page"]', leftNav);
        if (active) active.scrollIntoView({ block: "center" });
      }
    } catch (e) {}
    window.addEventListener("pagehide", function () {
      try { sessionStorage.setItem(navKey, String(leftNav.scrollTop)); } catch (e) {}
    });
  }

  // ── Community button (replaces OpenAI's "Ask AI") ─────────────────────
  function openCommunity() {
    var trigger = qs("[data-community-trigger]");
    if (!trigger) return false;
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    trigger.focus({ preventScroll: true });
    return true;
  }
  doc.addEventListener("click", function (e) {
    var link = e.target.closest("[data-community-open]");
    if (!link) return;
    if (openCommunity()) {
      e.preventDefault();
      setDrawer(false);
    }
  });
  if (location.hash === "#community") window.addEventListener("load", openCommunity);
})();
