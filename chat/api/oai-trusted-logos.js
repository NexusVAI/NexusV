/* Trusted-by logo row — 5 logos visible at once, theme-aware mask fill. */
(function (global) {
  "use strict";

  /** viewBox 宽高用于按真实比例计算 mask 容器尺寸
   * 顺序：Anthropic | Grok | NexusVAI(中) | OpenAI | Gemini
   * 高度：伙伴字标同档 ~1–1.35rem；自家 brand 更大（中心强调）。
   * Anthropic 略矮是因为字标极宽（182×24），同高会占满整列。 */
  var LOGO_ENTRIES = [
    {
      path: "chat/assets/partners/anthropic-text.svg",
      vw: 182,
      vh: 24,
      markH: "clamp(0.875rem, 1.9vw, 1.2rem)",
    },
    {
      path: "chat/assets/partners/grok-text.svg",
      vw: 63,
      vh: 24,
      markH: "clamp(1rem, 2.1vw, 1.35rem)",
    },
    {
      path: "chat/assets/nexusvai_logo_transparent.svg",
      vw: 1774,
      vh: 887,
      brand: true,
      markH: "clamp(2.5rem, 5.2vw, 3.5rem)",
    },
    {
      path: "chat/assets/partners/openai-text.svg",
      vw: 86,
      vh: 24,
      markH: "clamp(1rem, 2.1vw, 1.35rem)",
    },
    {
      path: "chat/assets/partners/gemini-text.svg",
      vw: 98,
      vh: 24,
      markH: "clamp(1rem, 2.1vw, 1.35rem)",
    },
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
    return { path: path, vw: 24, vh: 24, markH: "clamp(1.35rem, 2.8vw, 1.85rem)" };
  }

  function createMark(url, entry) {
    var aspect = entry.vw / entry.vh;
    var wrap = document.createElement("div");
    wrap.className = "trusted-logos__inner trusted-logos__inner--sized" + (entry.brand ? " trusted-logos__inner--brand" : "");
    wrap.style.setProperty("--mark-aspect", String(aspect));
    wrap.style.setProperty("--mark-h", entry.markH || "clamp(1.35rem, 2.8vw, 1.85rem)");
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
    slot.appendChild(createMark(url, entry));
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
