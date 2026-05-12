/* ============================================================================
 * cancri_orb_loader.js
 * ----------------------------------------------------------------------------
 * 一个用 Canvas 绘制的"水滴/光晕点阵"加载动画，用作图像 / 视频生成的占位卡。
 *
 * 设计要点（相对原 image.html 的优化）：
 *   1. 去掉了五角星形状（distStar），只在 圆 ↔ 菱形 之间做轻微插值；圆形主导。
 *   2. 用两个移动的"势场中心"（c1, c2），把它们各自的高斯亮度叠加 —
 *      数学上等价于 metaball，视觉上就是两滴水靠近时自然黏成长条、远离
 *      时分裂成两团的效果，正是用户描述的"两个水滴接触中间黏在一起"。
 *   3. 加了 ease-out 渐入（前 0.85s 透明度从 0 平滑爬到 1），避免一开始
 *      就硬切显示一片满屏点阵那种"僵硬"感。
 *   4. 半径做轻微呼吸 + 形状插值幅度只有 0.18，整体动得更柔和、流体。
 *
 * 用法：
 *   const loader = window.CancriOrbLoader.create({ caption: "正在生成图片…" });
 *   parent.appendChild(loader.element);
 *   loader.setCaption("正在排队…");
 *   loader.destroy();   // 移除并停止 RAF
 * ========================================================================== */
(function () {
  "use strict";

  const DEFAULT_OPTS = {
    caption: "正在生成…",
    subCaption: "",
    aspectRatio: 1, // 1 = 正方形；视频可传 16/9 之类
    minSize: 1,
    maxSize: 7.5,
    spacing: 11,
    speed: 0.65,
    // 省略 color：默认会从 CSS 变量 / 当前主题里推断
  };

  function getThemeDotRGB() {
    // 在浅色主题下用深灰，在深色主题下用近白；通过 body 背景亮度判断
    try {
      const body = document.body;
      const cs = getComputedStyle(body);
      const bg = cs.backgroundColor || "rgb(0,0,0)";
      const m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        const lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
        if (lum > 160) return [40, 40, 48]; // light theme → 深灰点
      }
    } catch (_) {}
    return [235, 238, 245]; // dark theme → 近白
  }

  function setupCanvas(canvas, cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function buildDotGrid(cssW, cssH, spacing) {
    const cols = Math.max(8, Math.floor(cssW / spacing));
    const rows = Math.max(8, Math.floor(cssH / spacing));
    const stepX = cssW / (cols - 1 + 0.0001);
    const stepY = cssH / (rows - 1 + 0.0001);
    const dots = [];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        dots.push({ x: i * stepX, y: j * stepY });
      }
    }
    return dots;
  }

  function create(opts) {
    opts = Object.assign({}, DEFAULT_OPTS, opts || {});

    /* ---------- DOM ---------- */
    const card = document.createElement("div");
    card.className = "orb-loader-card";
    if (opts.aspectRatio && opts.aspectRatio !== 1) {
      card.style.aspectRatio = String(opts.aspectRatio);
    }

    const stage = document.createElement("div");
    stage.className = "orb-loader-stage";
    const canvas = document.createElement("canvas");
    canvas.className = "orb-loader-canvas";
    stage.appendChild(canvas);

    const captionEl = document.createElement("div");
    captionEl.className = "orb-loader-caption";
    captionEl.textContent = opts.caption || "";

    const subEl = document.createElement("div");
    subEl.className = "orb-loader-sub";
    subEl.textContent = opts.subCaption || "";
    if (!opts.subCaption) subEl.style.display = "none";

    card.appendChild(stage);
    card.appendChild(captionEl);
    card.appendChild(subEl);

    /* ---------- 动画 ---------- */
    let dots = [];
    let cssW = 0,
      cssH = 0;
    let ctx = null;
    let dotRGB = getThemeDotRGB();
    let baseR = 0;
    let rafId = 0;
    let startTs = 0;
    let destroyed = false;

    function recalcLayout() {
      // canvas 跟随 stage 的 css 大小
      const rect = stage.getBoundingClientRect();
      cssW = Math.max(1, Math.round(rect.width));
      cssH = Math.max(1, Math.round(rect.height));
      ctx = setupCanvas(canvas, cssW, cssH);
      dots = buildDotGrid(cssW, cssH, opts.spacing);
      // 基础"光晕半径"：跟卡片尺寸成比例，保证大卡和小卡都好看
      baseR = Math.min(cssW, cssH) * 0.28;
      dotRGB = getThemeDotRGB();
    }

    const ro = "ResizeObserver" in window ? new ResizeObserver(() => {
      if (!destroyed) recalcLayout();
    }) : null;

    function frame(ts) {
      if (destroyed) return;
      if (!ctx || cssW === 0) {
        recalcLayout();
        if (cssW === 0) {
          rafId = requestAnimationFrame(frame);
          return;
        }
      }
      if (!startTs) startTs = ts;
      const elapsed = (ts - startTs) / 1000;

      // 渐入：cubic ease-out，0 → 1 在前 0.85s 内完成
      const t01 = Math.min(1, elapsed / 0.85);
      const fade = 1 - Math.pow(1 - t01, 3);

      const time = elapsed * opts.speed;

      // 两个势场中心 —— 各自走互相错开的 Lissajous，使它们时近时远
      const ax = cssW * 0.18,
        ay = cssH * 0.16;
      const c1x = cssW * 0.5 + ax * Math.sin(time * 0.72 + 0.3);
      const c1y = cssH * 0.5 + ay * Math.cos(time * 0.93 + 1.0);

      const c2x = cssW * 0.5 + ax * 1.2 * Math.cos(time * 0.55 + 1.6);
      const c2y = cssH * 0.5 + ay * 1.15 * Math.sin(time * 0.81 + 2.3);

      // 半径呼吸（轻微）
      const r1 = baseR * (1 + 0.16 * Math.sin(time * 0.5));
      const r2 = baseR * (1 + 0.16 * Math.cos(time * 0.6 + 1.2));

      // 形状混合：圆 ↔ 菱形，幅度小 (0.05~0.21)，圆主导
      const shapeMix = 0.13 + 0.08 * Math.sin(time * 0.35);

      ctx.clearRect(0, 0, cssW, cssH);

      const minS = opts.minSize;
      const maxS = opts.maxSize;
      const r = dotRGB[0],
        g = dotRGB[1],
        b = dotRGB[2];

      for (let k = 0; k < dots.length; k++) {
        const dot = dots[k];

        const dx1 = dot.x - c1x;
        const dy1 = dot.y - c1y;
        const dx2 = dot.x - c2x;
        const dy2 = dot.y - c2y;

        // 距离：圆 + 菱形 轻微插值
        const dCircle1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const dDiamond1 = Math.abs(dx1) + Math.abs(dy1);
        const d1 =
          dCircle1 * (1 - shapeMix) + dDiamond1 * 0.55 * shapeMix;

        const dCircle2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        const dDiamond2 = Math.abs(dx2) + Math.abs(dy2);
        const d2 =
          dCircle2 * (1 - shapeMix) + dDiamond2 * 0.55 * shapeMix;

        // metaball：两个高斯场叠加 → 自然黏合
        const f1 = Math.exp(-(d1 * d1) / (2 * r1 * r1));
        const f2 = Math.exp(-(d2 * d2) / (2 * r2 * r2));
        let factor = f1 + f2;
        if (factor > 1) factor = 1;
        if (factor < 0) factor = 0;

        const size = minS + (maxS - minS) * factor;
        const alpha = (0.05 + 0.95 * factor) * fade;

        if (alpha < 0.01) continue;

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, size, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
        ctx.fill();
      }

      rafId = requestAnimationFrame(frame);
    }

    function start() {
      // 启动前先量一次（如果 stage 已经入树）；否则首帧 frame() 里也会再量
      if (stage.isConnected) recalcLayout();
      if (ro && stage.isConnected) ro.observe(stage);
      rafId = requestAnimationFrame(frame);
    }

    function destroy() {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      if (card.parentNode) card.parentNode.removeChild(card);
    }

    /* 因为 caller 经常先创建再 append，统一用 microtask 启动一次 */
    queueMicrotask(start);

    return {
      element: card,
      stage: stage,
      setCaption: (txt) => {
        captionEl.textContent = txt == null ? "" : String(txt);
      },
      setSubCaption: (txt) => {
        subEl.textContent = txt == null ? "" : String(txt);
        subEl.style.display = txt ? "" : "none";
      },
      destroy: destroy,
      isDestroyed: () => destroyed,
    };
  }

  window.CancriOrbLoader = { create: create };
})();
