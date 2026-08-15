/* Trusted-by logo row — 5 logos visible at once, theme-aware mask fill. */
(function (global) {
  "use strict";

  /** 顺序：Anthropic | Grok | NexusVAI(中) | OpenAI | Gemini
   * 尺寸不按 viewBox 耦合：槽位等宽、mask 盒同高同宽，由 CSS 统一。 */
  var LOGO_ENTRIES = [
    { path: "chat/assets/partners/anthropic-text.svg" },
    { path: "chat/assets/partners/grok-text.svg" },
    { path: "chat/assets/nexusvai_logo_transparent.svg" },
    { path: "chat/assets/partners/openai-text.svg" },
    { path: "chat/assets/partners/gemini-text.svg" },
  ];

  var DEFAULT_LOGOS = LOGO_ENTRIES.map(function (e) {
    return e.path;
  });

  function resolveUrl(path, base) {
    if (!path) return "";
    if (/^(https?:|data:|\/\/)/.test(path)) return path;
    try {
      return new URL(path, base || document.baseURI || global.location.href).href;
    } catch (e) {
      if (base) return base.replace(/\/?$/, "/") + path.replace(/^\.\//, "");
      return path;
    }
  }

  function maskUrl(url) {
    return "url(\"" + String(url).replace(/"/g, "%22") + "\")";
  }

  function normalizeEntry(pathOrEntry) {
    if (pathOrEntry && typeof pathOrEntry === "object") return pathOrEntry;
    var path = String(pathOrEntry || "");
    for (var i = 0; i < LOGO_ENTRIES.length; i++) {
      if (LOGO_ENTRIES[i].path === path) return LOGO_ENTRIES[i];
    }
    return { path: path };
  }

  function createMark(url) {
    var wrap = document.createElement("div");
    wrap.className = "trusted-logos__inner trusted-logos__inner--sized";
    var mark = document.createElement("div");
    mark.className = "trusted-logos__mark";
    mark.style.webkitMaskImage = maskUrl(url);
    mark.style.maskImage = maskUrl(url);
    wrap.appendChild(mark);
    return wrap;
  }

  function buildSlot(colIndex, pathOrEntry, assetBase) {
    var entry = normalizeEntry(pathOrEntry);
    var slot = document.createElement("div");
    slot.className = "trusted-logos__slot";
    slot.dataset.col = String(colIndex);
    var url = resolveUrl(entry.path, assetBase);
    slot.appendChild(createMark(url));
    return slot;
  }

  function init(container, options) {
    if (!container || container.dataset.trustedLogosInit === "1") return;
    container.dataset.trustedLogosInit = "1";

    var opts = options || {};
    var logos = opts.logos && opts.logos.length ? opts.logos.slice() : LOGO_ENTRIES.slice();
    var columns = Math.min(5, logos.length);
    var assetBase = opts.assetBase || document.baseURI || "";

    container.innerHTML = "";
    container.classList.add("trusted-logos__grid");
    for (var c = 0; c < columns; c++) {
      container.appendChild(buildSlot(c, logos[c], assetBase));
    }
  }

  global.OaiTrustedLogos = {
    init: init,
    DEFAULT_LOGOS: DEFAULT_LOGOS,
    LOGO_ENTRIES: LOGO_ENTRIES,
  };
})(window);
