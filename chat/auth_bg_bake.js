/**
 * auth_bg_bake.js — 登录页等高线背景 SVG → PNG 烘焦器（theme 联动）
 *
 * 上下文：
 *   chat/index.html 的 .auth-bg 内嵌 inline SVG fractalNoise +
 *   diffuseLighting filter 链（参考 参考物体/beij.html）。.island / .islandt
 *   用 `filter: url(#octave1) brightness(20) contrast(1)` 应用 filter。
 *
 * 性能问题：
 *   浏览器对 CSS `filter: url(#xxx)` 引用 inline SVG filter 的可见 DOM 元素，
 *   每帧都重新光栅化 filter chain（fractalNoise × 11 + feMerge × 3 +
 *   feGaussianBlur × 3 + feDiffuseLighting）。在 1080p 屏单帧 30-80ms，
 *   登录态主线程长期 jank。
 *
 * 优化：
 *   DOMContentLoaded 后用 canvas 一次性烘焦成静态 PNG dataURL，赋给
 *   .island / .islandt 的 background-image，并清掉 filter。从此 GPU 不再
 *   持续光栅化 filter chain。
 *
 * 2026-05-16 改造（theme 联动）：
 *   原版 fillColor 写死 `rgb(52,65,73)` + brightness(20)，feDiffuseLighting
 *   lighting-color 是暖米 #d7bb98 / #d1bf96，最终烘出"接近全白 ridge"。在
 *   light mode 下覆盖整屏，叠在沙色 .auth-overlay 上仍是亮 ridge，配合
 *   深栗字色 #1a120c → 1.3:1 不可读对比度。
 *
 *   现在按 data-theme 选 bake 配置：
 *     dark  → fillColor: rgb(52,65,73), lightingColor: 沿用原 SVG defs（暖米）,
 *             ctxFilter: brightness(20) contrast(1)
 *             → 暖白 ridge on 深栗底（视觉跟原版一致）
 *     light → fillColor: rgb(52,65,73), lightingColor: #3b2818 (深棕),
 *             ctxFilter: brightness(2.5) contrast(1.5)
 *             → 深棕 ridge 叠在沙色 .auth-overlay 底上 → 深栗字对比度 ≥ 7:1
 *
 *   通过 MutationObserver 监听 documentElement.data-theme 变化，theme 切换
 *   时自动重烘（不再 remove inline SVG，保留供重烘）。bakeSeq 防快速切换
 *   时旧 bake 结果覆盖新 bake。
 *
 * Fallback：
 *   任一步失败 → 保留 inline SVG filter url() 引用（视觉不变，性能没优化但
 *   不破坏）。失败时也不重烘（避免无限重试）。
 *
 * CSP 兼容（chat/index.html: script-src 'self', img-src 'self' data: blob:）：
 *   - 本文件外联，不需要 'unsafe-inline'
 *   - canvas.toDataURL → 'data:image/png;base64,...' 走 img-src data:
 *   - <img>.src = 'data:image/svg+xml;base64,...' 走 img-src data:
 *   - 不发任何外部网络请求
 */
(function bakeAuthBg() {
  "use strict";

  let inlineSvgRef = null;
  let islandRef = null;
  let islandtRef = null;
  let bakeSeq = 0;

  function getBakeConfig() {
    const theme =
      document.documentElement.getAttribute("data-theme") || "dark";
    if (theme === "light") {
      return {
        fillColor: "rgb(52,65,73)",
        lightingColor: "#3b2818",
        ctxFilter: "brightness(2.5) contrast(1.5)",
      };
    }
    return {
      fillColor: "rgb(52,65,73)",
      lightingColor: null,
      ctxFilter: "brightness(20) contrast(1)",
    };
  }

  function bake(filterEl, fillColor, lightingColor, ctxFilter, W, H) {
    return new Promise(function (resolve) {
      let url;
      try {
        // clone filter 后改 lighting-color，避免污染原 inline SVG defs
        const filterClone = filterEl.cloneNode(true);
        if (lightingColor) {
          const all = filterClone.querySelectorAll("feDiffuseLighting");
          for (let i = 0; i < all.length; i++) {
            all[i].setAttribute("lighting-color", lightingColor);
          }
        }
        const filterStr = new XMLSerializer().serializeToString(filterClone);
        const svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' +
          W +
          '" height="' +
          H +
          '">' +
          "<defs>" +
          filterStr +
          "</defs>" +
          '<rect width="100%" height="100%" fill="' +
          fillColor +
          '" filter="url(#' +
          filterEl.id +
          ')"/>' +
          "</svg>";
        // utf-8 safe base64（svg 含中文注释也安全）
        url =
          "data:image/svg+xml;base64," +
          btoa(unescape(encodeURIComponent(svg)));
      } catch (e) {
        if (window.console && console.warn) {
          console.warn("[auth-bg-bake] svg serialize failed:", e);
        }
        return resolve(null);
      }

      const img = new Image();
      img.onload = function () {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext("2d");
          ctx.filter = ctxFilter;
          ctx.drawImage(img, 0, 0, W, H);
          resolve(canvas.toDataURL("image/png"));
        } catch (e) {
          if (window.console && console.warn) {
            console.warn("[auth-bg-bake] canvas toDataURL failed:", e);
          }
          resolve(null);
        }
      };
      img.onerror = function () {
        if (window.console && console.warn) {
          console.warn("[auth-bg-bake] img load failed:", filterEl.id);
        }
        resolve(null);
      };
      img.src = url;
    });
  }

  function applyBake() {
    if (!inlineSvgRef || !islandRef || !islandtRef) return;
    const f1 = inlineSvgRef.querySelector("#octave1");
    const f2 = inlineSvgRef.querySelector("#octave2");
    if (!f1 || !f2) return;

    // 渲染分辨率：viewport size × min(DPR, 2) 上限 2560×1600
    // 太大 PNG dataURL 体积爆炸；太小 background-size: cover 会糊
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.min(Math.round(window.innerWidth * dpr), 2560);
    const H = Math.min(Math.round(window.innerHeight * dpr), 1600);

    const cfg = getBakeConfig();
    const seq = ++bakeSeq;

    Promise.all([
      bake(f1, cfg.fillColor, cfg.lightingColor, cfg.ctxFilter, W, H),
      bake(f2, cfg.fillColor, cfg.lightingColor, cfg.ctxFilter, W, H),
    ]).then(function (results) {
      // 防止快速切 theme 时旧 bake 结果覆盖新 bake（异步竞争）
      if (seq !== bakeSeq) return;
      const u1 = results[0];
      const u2 = results[1];
      if (u1) {
        islandRef.style.background =
          "url(" + u1 + ") center/cover no-repeat";
        islandRef.style.filter = "none";
      }
      if (u2) {
        islandtRef.style.background =
          "url(" + u2 + ") center/cover no-repeat";
        islandtRef.style.filter = "none";
      }
    });
  }

  function run() {
    const authBg = document.querySelector(".auth-bg");
    if (!authBg) return;

    islandRef = authBg.querySelector(".island");
    islandtRef = authBg.querySelector(".islandt");
    inlineSvgRef = authBg.querySelector("svg");
    if (!islandRef || !islandtRef || !inlineSvgRef) return;

    // index.html 内 inline <style> 的 .island/.islandt 写死了
    // background: rgb(52,65,73)（深蓝灰）。在 light mode 下这个值跟沙色
    // .auth-overlay 不协调，会先于 bake 完成短暂闪烁。立即清掉让 .auth-overlay
    // 底色透出来直到 bake 完成（< 200ms）。
    islandRef.style.background = "transparent";
    islandtRef.style.background = "transparent";

    applyBake();

    // theme 切换：重新 bake。MutationObserver 监听 data-theme attribute。
    const observer = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          applyBake();
          break;
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    // 脚本是 defer，DOMContentLoaded 已触发或正在；直接跑
    run();
  }
})();
