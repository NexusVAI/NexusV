/* Trusted-by logo row — 5 logos, 统一 cap-height + 各自自然宽度。
 *
 * 为什么不能靠 CSS 把格子做成等宽再 contain（2026-08-16 之前的做法就是这样，结果 Grok 巨大）：
 * mask-size:contain 只认「viewBox 的外框」，不认字形墨迹。各 SVG 的
 * viewBox 长宽比差 3 倍以上（anthropic 7.58:1、grok 2.63:1、NexusVAI 原图 2.00:1），
 * 同一个等宽格子里 contain 出来的字高必然差 3 倍。
 *
 * 所以尺寸必须由「字高」反推盒子，而不是由盒子反推字高：
 *   盒高 = --trusted-cap × capScale      （capScale = viewBoxH / capHeight）
 *   盒宽 = 盒高 × aspect                  （aspect  = viewBoxW / viewBoxH）
 * 这样每枚 logo 的大写字母高度严格一致，宽度各随字标本身长短。
 *
 * capScale / aspect / baseOff 由 path 数据实测（含贝塞尔极值 + 弧线采样）得出：
 * cap = 「底边落在基线上的那些子路径」的最高顶到基线的距离；
 * baseOff = (基线 − viewBox 垂直中心) / cap，用来把各枚字标的基线对齐到同一条线。
 *
 * NexusVAI 用 nexusvai-wordmark-tight.svg（紧 viewBox）而不是
 * nexusvai_logo_transparent.svg：后者 1774×887 里字形只占 1290×189，
 * 留白会被 contain 一起算进去，字被缩到 1/4。原文件仍被 chat/index.html 等
 * 以 <img> 引用，不要动它。
 */
(function (global) {
  "use strict";

  /** 基线对齐基准（多数字标的 baseOff 都在 0.49 附近） */
  var BASELINE_REF = 0.49;

  /** 顺序：Anthropic | Grok | NexusVAI(中) | OpenAI | Gemini */
  var LOGO_ENTRIES = [
    { path: "chat/assets/partners/anthropic-text.svg", aspect: 7.5833, capScale: 1.2195, baseOff: 0.4919 },
    { path: "chat/assets/partners/grok-text.svg", aspect: 2.625, capScale: 1.222, baseOff: 0.4908 },
    { path: "chat/assets/nexusvai-wordmark-tight.svg", aspect: 6.8254, capScale: 1.0107, baseOff: 0.4947 },
    { path: "chat/assets/partners/openai-text.svg", aspect: 3.5833, capScale: 1.3785, baseOff: 0.4256 },
    { path: "chat/assets/partners/gemini-text.svg", aspect: 4.0833, capScale: 1.2115, baseOff: 0.4952 },
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
    // 未登记的 SVG：按 1:1 方形图标处理，cap 当作整个 viewBox
    return { path: path, aspect: 1, capScale: 1, baseOff: BASELINE_REF };
  }

  function createMark(url, entry) {
    var wrap = document.createElement("div");
    wrap.className = "trusted-logos__inner trusted-logos__inner--sized";
    wrap.style.setProperty("--mark-cap-scale", String(entry.capScale));
    wrap.style.setProperty("--mark-aspect", String(entry.aspect));
    // 基线对齐：baseOff 越大说明基线在盒内越低，需要整盒上移
    wrap.style.setProperty("--mark-baseline-shift", String(BASELINE_REF - entry.baseOff));
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
