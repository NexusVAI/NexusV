/* OpenAI contact-sales “Trusted by” logo grid — mask + grayscale crossfade.
 * Timing scraped from openai.com live bundle (118hhaw.gm6l7.js + theme CSS):
 *   interval 3000ms, duration-long 400ms, stagger (frame+1)*120ms,
 *   translate-y-10 = 2.5rem, gap-x-16 = 4rem, max-w-40 = 10rem. */
(function (global) {
  "use strict";

  var DEFAULT_LOGOS = [
    "chat/assets/VAI-logo.svg",
    "chat/assets/partners/gemini-text.svg",
    "chat/assets/partners/anthropic-text.svg",
    "chat/assets/partners/openai-text.svg",
    "chat/assets/partners/gemini-text.svg",
  ];

  var INTERVAL_MS = 3000;
  var DURATION_MS = 400;
  var STAGGER_MS = 120;
  var PAGES = 3;

  function rotateLogos(logos, offset) {
    var out = [];
    var n = logos.length;
    for (var i = 0; i < n; i++) out.push(logos[(i + offset) % n]);
    return out;
  }

  function buildPages(logos) {
    var pages = [];
    for (var p = 0; p < PAGES; p++) pages.push(rotateLogos(logos, p));
    return pages;
  }

  function resolveUrl(path, base) {
    if (!path) return "";
    if (/^(https?:|data:|\/\/)/.test(path)) return path;
    if (base) return base.replace(/\/?$/, "/") + path.replace(/^\.\//, "");
    return path;
  }

  function createMark(url) {
    var mark = document.createElement("div");
    mark.className = "trusted-logos__mark";
    mark.style.webkitMaskImage = "url(\"" + url.replace(/"/g, "%22") + "\")";
    mark.style.maskImage = "url(\"" + url.replace(/"/g, "%22") + "\")";
    return mark;
  }

  function createLayer(pageIndex, colIndex, url, animate) {
    var layer = document.createElement("div");
    layer.className = "trusted-logos__layer";
    layer.setAttribute("aria-hidden", pageIndex === 0 ? "false" : "true");
    layer.dataset.page = String(pageIndex);
    layer.dataset.col = String(colIndex);
    var delay = animate ? (pageIndex + 1) * STAGGER_MS : 0;
    layer.style.transitionDelay = delay + "ms";
    layer.style.animationDelay = delay + "ms";
    var inner = document.createElement("div");
    inner.className = "trusted-logos__inner";
    inner.appendChild(createMark(url));
    layer.appendChild(inner);
    return layer;
  }

  function applyLayerState(layer, activePage, totalPages, animate) {
    var page = Number(layer.dataset.page || "0");
    var isActive = page === activePage;
    var isNext = page === (activePage + 1) % totalPages;
    var isPrev = page === (activePage - 1 + totalPages) % totalPages;
    layer.classList.toggle("is-active", isActive);
    layer.classList.toggle("is-next", !isActive && isNext);
    layer.classList.toggle("is-prev", !isActive && isPrev);
    layer.classList.toggle("is-hidden", !isActive && !isNext && !isPrev);
    layer.setAttribute("aria-hidden", isActive ? "false" : "true");
    if (animate) {
      var frame = Number(layer.dataset.page || "0");
      var delay = (frame + 1) * STAGGER_MS;
      layer.style.transitionDelay = delay + "ms";
      layer.style.animationDelay = delay + "ms";
    } else {
      layer.style.transitionDelay = "0ms";
      layer.style.animationDelay = "0ms";
    }
  }

  function buildColumn(colIndex, pages, assetBase, animate) {
    var slot = document.createElement("div");
    slot.className = "trusted-logos__slot";
    slot.dataset.col = String(colIndex);
    for (var p = 0; p < pages.length; p++) {
      var url = resolveUrl(pages[p][colIndex], assetBase);
      slot.appendChild(createLayer(p, colIndex, url, animate));
    }
    return slot;
  }

  function init(container, options) {
    if (!container || container.dataset.trustedLogosInit === "1") return;
    container.dataset.trustedLogosInit = "1";

    var opts = options || {};
    var logos = (opts.logos && opts.logos.length) ? opts.logos.slice() : DEFAULT_LOGOS.slice();
    var columns = Math.min(5, logos.length);
    var pages = buildPages(logos.slice(0, columns));
    var assetBase = opts.assetBase || "";
    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var animate = !reduceMotion && pages.length > 1;

    container.innerHTML = "";
    container.classList.add("trusted-logos__grid");
    for (var c = 0; c < columns; c++) {
      container.appendChild(buildColumn(c, pages, assetBase, false));
    }

    var activePage = 0;
    container.querySelectorAll(".trusted-logos__layer").forEach(function (layer) {
      applyLayerState(layer, activePage, pages.length, false);
    });

    if (!animate) return;

    var timer = null;
    function tick() {
      activePage = (activePage + 1) % pages.length;
      container.querySelectorAll(".trusted-logos__layer").forEach(function (layer) {
        applyLayerState(layer, activePage, pages.length, true);
      });
    }

    timer = window.setInterval(tick, INTERVAL_MS);
    container._trustedLogosCleanup = function () {
      if (timer) window.clearInterval(timer);
    };
  }

  global.OaiTrustedLogos = {
    init: init,
    INTERVAL_MS: INTERVAL_MS,
    DURATION_MS: DURATION_MS,
    STAGGER_MS: STAGGER_MS,
    DEFAULT_LOGOS: DEFAULT_LOGOS,
  };
})(window);
