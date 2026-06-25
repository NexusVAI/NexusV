/* Trusted-by logo row — 5 logos visible at once, theme-aware mask fill. */
(function (global) {
  "use strict";

  var DEFAULT_LOGOS = [
    "chat/assets/VAI-logo.svg",
    "chat/assets/partners/gemini-text.svg",
    "chat/assets/partners/anthropic-text.svg",
    "chat/assets/partners/openai-text.svg",
    "chat/assets/partners/gemini-text.svg",
  ];

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

  function isWideLogo(path) {
    return /partners\/.+-text\.svg$/i.test(path || "");
  }

  function createMark(url, wide) {
    var wrap = document.createElement("div");
    wrap.className = "trusted-logos__inner" + (wide ? " trusted-logos__inner--wide" : " trusted-logos__inner--vai");
    var mark = document.createElement("div");
    mark.className = "trusted-logos__mark";
    mark.style.webkitMaskImage = maskUrl(url);
    mark.style.maskImage = maskUrl(url);
    wrap.appendChild(mark);
    return wrap;
  }

  function buildSlot(colIndex, path, assetBase) {
    var slot = document.createElement("div");
    slot.className = "trusted-logos__slot";
    slot.dataset.col = String(colIndex);
    var url = resolveUrl(path, assetBase);
    slot.appendChild(createMark(url, isWideLogo(path)));
    return slot;
  }

  function init(container, options) {
    if (!container || container.dataset.trustedLogosInit === "1") return;
    container.dataset.trustedLogosInit = "1";

    var opts = options || {};
    var logos = (opts.logos && opts.logos.length) ? opts.logos.slice() : DEFAULT_LOGOS.slice();
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
  };
})(window);
