/* ============================================================================
 * cancri_image_loader.js
 * ----------------------------------------------------------------------------
 * 图像生成占位卡 —— 1:1 移植自 chat/IMAGE-PRO.html 的「伪 3D 波浪点阵 +
 * 液态玻璃胶囊」效果，用来替换原本 cancri_orb_loader 的 metaball 点阵。
 *
 * 相对原 IMAGE-PRO.html 的三处改造（其余逐像素保持一致）：
 *   1. 响应式：canvas 跟随父容器尺寸（ResizeObserver），而非写死 768x500。
 *   2. 深浅色适配：背景填充取卡片实际计算背景色；点阵在深色主题用亮灰、
 *      浅色主题用暗灰；液态玻璃胶囊文字 / 描边随主题反转（CSS 负责）。
 *   3. 对外暴露与 CancriOrbLoader 一致的接口（create / setCaption /
 *      destroy / isDestroyed），调用方零改动即可替换。
 *
 * 用法：
 *   const loader = window.CancriImageLoader.create({ caption: "正在生成图片…" });
 *   parent.appendChild(loader.element);
 *   loader.destroy();
 * ========================================================================== */
(function () {
  "use strict";

  const GLASS_FILTER_ID = "cancri-img-glass-filter";

  /* ── 液态玻璃 SVG 滤镜：全局只注入一次（图像生成是互斥的，同一时刻
   *    只有一个 loader 在跑，单例 feImage href 不会串台）── */
  function ensureGlassFilter() {
    if (document.getElementById(GLASS_FILTER_ID)) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    svg.style.width = "0";
    svg.style.height = "0";
    svg.innerHTML =
      '<defs>' +
      '<filter id="' + GLASS_FILTER_ID + '"' +
      ' x="0" y="0" width="100%" height="100%"' +
      ' filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse"' +
      ' color-interpolation-filters="sRGB">' +
      '<feImage id="' + GLASS_FILTER_ID + '-img" href="" result="MAP" preserveAspectRatio="xMidYMid slice" />' +
      '<feColorMatrix in="MAP" type="matrix" result="EDGE_GREY"' +
      ' values="0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0 0 0 1 0" />' +
      '<feComponentTransfer in="EDGE_GREY" result="EDGE_MASK">' +
      '<feFuncA type="discrete" tableValues="0 0.15 1" /></feComponentTransfer>' +
      '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="16" xChannelSelector="R" yChannelSelector="G" result="DISP_R" />' +
      '<feColorMatrix in="DISP_R" type="matrix" result="CH_R"' +
      ' values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />' +
      '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="14" xChannelSelector="R" yChannelSelector="G" result="DISP_G" />' +
      '<feColorMatrix in="DISP_G" type="matrix" result="CH_G"' +
      ' values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />' +
      '<feDisplacementMap in="SourceGraphic" in2="MAP" scale="12" xChannelSelector="R" yChannelSelector="G" result="DISP_B" />' +
      '<feColorMatrix in="DISP_B" type="matrix" result="CH_B"' +
      ' values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />' +
      '<feBlend in="CH_G" in2="CH_B" mode="screen" result="GB" />' +
      '<feBlend in="CH_R" in2="GB" mode="screen" result="ABERRATED" />' +
      '<feComposite in="ABERRATED" in2="EDGE_MASK" operator="in" result="RIM_CHROMA" />' +
      '<feComponentTransfer in="EDGE_MASK" result="INV_MASK">' +
      '<feFuncA type="table" tableValues="1 0" /></feComponentTransfer>' +
      '<feComposite in="DISP_G" in2="INV_MASK" operator="in" result="CENTER_CLEAN" />' +
      '<feComposite in="RIM_CHROMA" in2="CENTER_CLEAN" operator="over" result="COMBINED" />' +
      '<feGaussianBlur in="COMBINED" stdDeviation="0.4" />' +
      '</filter></defs>';
    document.body.appendChild(svg);
  }

  /* ── 圆角矩形液态玻璃的位移贴图（凸透镜折射）——逐像素移植自 IMAGE-PRO ── */
  function generateDisplacementMap(width, height) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const cx = c.getContext("2d");
    const img = cx.createImageData(width, height);
    const data = img.data;

    const smoothStep = (a, b, t) => {
      t = Math.max(0, Math.min(1, (t - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const len = (x, y) => Math.sqrt(x * x + y * y);
    const sdfRoundedRect = (x, y, w, h, r) => {
      const qx = Math.abs(x) - w + r;
      const qy = Math.abs(y) - h + r;
      return (
        Math.min(Math.max(qx, qy), 0) +
        len(Math.max(qx, 0), Math.max(qy, 0)) -
        r
      );
    };

    const raw = new Float32Array(width * height * 2);
    let maxScale = 0,
      i = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const ix = x / width - 0.5;
        const iy = y / height - 0.5;
        const d = sdfRoundedRect(ix, iy, 0.32, 0.26, 0.5);
        const bulge = smoothStep(0.8, 0, d - 0.12);
        const k = smoothStep(0, 1, bulge);
        const dx = ix * k * width;
        const dy = iy * k * height;
        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
        raw[i++] = dx;
        raw[i++] = dy;
      }
    }
    maxScale = Math.max(maxScale, 1);

    let p = 0,
      j = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = raw[p++],
          dy = raw[p++];
        const edgeDist = Math.min(x, y, width - 1 - x, height - 1 - y);
        const edgeFactor = Math.min(1, edgeDist / 2);
        const rr = ((dx * edgeFactor) / maxScale) * 0.5 + 0.5;
        const gg = ((dy * edgeFactor) / maxScale) * 0.5 + 0.5;
        data[j++] = Math.max(0, Math.min(255, rr * 255));
        data[j++] = Math.max(0, Math.min(255, gg * 255));
        data[j++] = Math.max(0, Math.min(255, gg * 255));
        data[j++] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    return c.toDataURL();
  }

  /* ── 主题探测：返回卡片当前的背景填充色 + 点阵基调（亮/暗）── */
  function probeTheme(cardEl) {
    let bgFill = "#111111";
    let isLight = false;
    try {
      const cs = getComputedStyle(cardEl);
      let bg = cs.backgroundColor || "";
      const m = bg.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3) {
        const lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
        isLight = lum > 150;
        bgFill = "rgb(" + Math.round(+m[0]) + "," + Math.round(+m[1]) + "," + Math.round(+m[2]) + ")";
      }
    } catch (_) {}
    return { bgFill, isLight };
  }

  function create(opts) {
    opts = opts || {};
    ensureGlassFilter();

    /* ---------- DOM ---------- */
    const card = document.createElement("div");
    card.className = "img-loader-card";

    const canvas = document.createElement("canvas");
    canvas.className = "img-loader-canvas";
    card.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.className = "img-loader-overlay";

    const badge = document.createElement("div");
    badge.className = "img-loader-badge";

    const warp = document.createElement("div");
    warp.className = "img-loader-glass-warp";
    const rim = document.createElement("div");
    rim.className = "img-loader-glass-rim";

    const content = document.createElement("div");
    content.className = "img-loader-badge-content";
    const baseSpan = document.createElement("span");
    baseSpan.className = "img-loader-badge-base";
    const shimmerSpan = document.createElement("span");
    shimmerSpan.className = "img-loader-badge-shimmer";
    const captionText = opts.caption == null ? "正在生成图片…" : String(opts.caption);
    baseSpan.textContent = captionText;
    shimmerSpan.textContent = captionText;
    content.appendChild(baseSpan);
    content.appendChild(shimmerSpan);

    badge.appendChild(warp);
    badge.appendChild(rim);
    badge.appendChild(content);
    overlay.appendChild(badge);
    card.appendChild(overlay);

    /* glass-warp 指向单例滤镜（带 @supports 降级，见 css） */
    warp.style.backdropFilter =
      "url(#" + GLASS_FILTER_ID + ") blur(2px) saturate(150%) brightness(1.08)";
    warp.style.webkitBackdropFilter =
      "url(#" + GLASS_FILTER_ID + ") blur(2px) saturate(150%) brightness(1.08)";

    /* ---------- 点阵波浪场（移植自 IMAGE-PRO） ---------- */
    const DOT_SPACING = 26;
    const DOT_RADIUS = 1.5;
    const PAD = 2;

    const waves = [
      { kx: 0.011, ky: 0.014, v: 0.0016, a: 9 },
      { kx: 0.019, ky: -0.009, v: 0.0023, a: 6 },
      { kx: -0.007, ky: 0.011, v: 0.0011, a: 7 },
    ];
    const MAX_A = waves.reduce((s, w) => s + w.a, 0);

    const Lx = -0.45,
      Ly = -0.65,
      Lz = 0.62;
    const Llen = Math.hypot(Lx, Ly, Lz);
    const lx = Lx / Llen,
      ly = Ly / Llen,
      lz = Lz / Llen;

    const HEIGHT_LIFT = 1.5;
    const SLOPE_PARALLAX = 30;
    const NORMAL_SLOPE = 7;
    const SWEEP_PERIOD = 3200;
    const SWEEP_WIDTH = 160;

    let ctx = null;
    let cssW = 0,
      cssH = 0;
    let dots = [];
    let theme = { bgFill: "#111111", isLight: false };
    let time = 0;
    let rafId = 0;
    let destroyed = false;

    function setupCanvas() {
      const rect = card.getBoundingClientRect();
      cssW = Math.max(1, Math.round(rect.width));
      cssH = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.ceil(cssW / DOT_SPACING) + PAD * 2;
      const rows = Math.ceil(cssH / DOT_SPACING) + PAD * 2;
      dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({
            ox: (c - PAD) * DOT_SPACING + DOT_SPACING / 2,
            oy: (r - PAD) * DOT_SPACING + DOT_SPACING / 2,
          });
        }
      }
      theme = probeTheme(card);
    }

    const ro =
      "ResizeObserver" in window
        ? new ResizeObserver(() => {
            if (!destroyed) setupCanvas();
          })
        : null;

    function draw() {
      if (destroyed) return;
      if (!ctx || cssW === 0) {
        setupCanvas();
        if (cssW === 0) {
          rafId = requestAnimationFrame(draw);
          return;
        }
      }

      ctx.fillStyle = theme.bgFill;
      ctx.fillRect(0, 0, cssW, cssH);

      const sweepT = (time % SWEEP_PERIOD) / SWEEP_PERIOD;
      const sweepX = -SWEEP_WIDTH + sweepT * (cssW + SWEEP_WIDTH * 2);
      const sweepSigma2 = 2 * (SWEEP_WIDTH / 2.4) ** 2;
      const light = theme.isLight;

      for (const d of dots) {
        let hgt = 0,
          dhdx = 0,
          dhdy = 0;
        for (const w of waves) {
          const ph = d.ox * w.kx + d.oy * w.ky + time * w.v;
          const s = Math.sin(ph),
            co = Math.cos(ph);
          hgt += w.a * s;
          dhdx += w.a * w.kx * co;
          dhdy += w.a * w.ky * co;
        }

        const sx = d.ox + dhdx * SLOPE_PARALLAX;
        const sy = d.oy - hgt * HEIGHT_LIFT;

        const nx = -dhdx * NORMAL_SLOPE;
        const ny = -dhdy * NORMAL_SLOPE;
        const ninv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const shade = Math.max(0, (nx * lx + ny * ly + lz) * ninv);
        const depth = (hgt + MAX_A) / (2 * MAX_A);

        const sweepDist = Math.abs(sx - sweepX);
        const sweepGlow = Math.exp(-(sweepDist * sweepDist) / sweepSigma2);

        let alpha = 0.1 + 0.3 * shade + 0.18 * depth + sweepGlow * 0.55;
        alpha = Math.min(alpha, 0.96);

        const r =
          DOT_RADIUS *
          (0.7 + depth * 0.55 + shade * 0.25 + sweepGlow * 1.8);

        const intensity = shade * 40 + depth * 20 + sweepGlow * 50;
        // 深色主题：亮灰点（越亮越突出）；浅色主题：暗灰点（越暗越突出）
        let ch = light
          ? Math.round(150 - intensity * 0.95)
          : Math.round(165 + intensity);
        ch = Math.max(20, Math.min(255, ch));

        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + ch + "," + ch + "," + ch + "," + alpha + ")";
        ctx.fill();
      }

      time += 16;
      rafId = requestAnimationFrame(draw);
    }

    function applyBadgeGlass() {
      if (destroyed) return;
      const w = Math.max(1, Math.round(badge.offsetWidth));
      const h = Math.max(1, Math.round(badge.offsetHeight));
      if (w <= 1 || h <= 1) return;
      const url = generateDisplacementMap(w, h);
      const feImage = document.getElementById(GLASS_FILTER_ID + "-img");
      if (feImage) {
        feImage.setAttribute("href", url);
        feImage.setAttribute("xlink:href", url);
      }
    }

    function start() {
      if (card.isConnected) setupCanvas();
      if (ro && card.isConnected) ro.observe(card);
      // 等布局/字体稳定后再量胶囊尺寸生成折射贴图
      requestAnimationFrame(() => requestAnimationFrame(applyBadgeGlass));
      rafId = requestAnimationFrame(draw);
    }

    function destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      if (card.parentNode) card.parentNode.removeChild(card);
    }

    function setCaption(txt) {
      const t = txt == null ? "" : String(txt);
      baseSpan.textContent = t;
      shimmerSpan.textContent = t;
      requestAnimationFrame(applyBadgeGlass);
    }

    queueMicrotask(start);

    return {
      element: card,
      setCaption: setCaption,
      // 与 OrbLoader 接口对齐：图像卡没有副标题，留空实现避免调用方报错
      setSubCaption: function () {},
      destroy: destroy,
      isDestroyed: () => destroyed,
    };
  }

  window.CancriImageLoader = { create: create };
})();
