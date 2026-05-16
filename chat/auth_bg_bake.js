/**
 * auth_bg_bake.js — 登录页背景 SVG → PNG 烘焦器
 *
 * 上下文：
 *   chat/index.html 的 .auth-bg 内嵌了 beij.html 的 inline SVG fractalNoise +
 *   diffuseLighting filter 链（参考 参考物体/beij.html）。.island / .islandt
 *   用 `filter: url(#octave1) brightness(20) contrast(1)` 应用 filter。
 *
 * 性能问题：
 *   浏览器对 CSS `filter: url(#xxx)` 引用 inline SVG filter 的可见 DOM 元素，
 *   每帧都重新光栅化 filter chain（fractalNoise × 11 + feMerge × 3 +
 *   feGaussianBlur × 3 + feDiffuseLighting）。在 1080p 屏单帧 30-80ms，
 *   登录态主线程长期 jank，用户报告 "点击都没响应"。
 *
 * 优化：
 *   DOMContentLoaded 后用 canvas 一次性烘焦成静态 PNG dataURL，赋给
 *   .island / .islandt 的 background-image，并移除它们的 filter。
 *   视觉 100% 不变（fractalNoise seed=4 固定输出），但从此 GPU 不再持续
 *   光栅化 filter chain。
 *
 * 流程：
 *   1. 读取 inline SVG 中的 #octave1 / #octave2 filter element
 *   2. 构造一个独立 SVG 字符串（含 filter defs + 应用 filter 的 rect）
 *   3. 转 base64 dataURL → <img>.src 加载（浏览器一次性光栅化 SVG）
 *   4. drawImage 到 canvas（同时通过 ctx.filter 复刻 brightness(20) contrast(1)）
 *   5. canvas.toDataURL('image/png') 拿到静态 PNG
 *   6. 赋给 .island / .islandt 的 background-image，filter: none
 *   7. 移除 inline SVG（filter defs 不再被引用，省一点内存）
 *
 * Fallback：
 *   任一步失败 → 保留 inline SVG filter（视觉不变，性能没优化但不破坏）。
 *
 * CSP 兼容（NexusV chat/index.html: script-src 'self', img-src 'self' data: blob:）：
 *   - 本文件外联，不需要 'unsafe-inline'
 *   - canvas.toDataURL 输出 'data:image/png;base64,...' 走 img-src data:
 *   - <img>.src = 'data:image/svg+xml;base64,...' 走 img-src data:
 *   - 不发任何外部网络请求
 */
(function bakeAuthBg() {
  "use strict";

  function run() {
    const authBg = document.querySelector(".auth-bg");
    if (!authBg) return;

    const island = authBg.querySelector(".island");
    const islandt = authBg.querySelector(".islandt");
    const inlineSvg = authBg.querySelector("svg");
    if (!island || !islandt || !inlineSvg) return;

    const f1 = inlineSvg.querySelector("#octave1");
    const f2 = inlineSvg.querySelector("#octave2");
    if (!f1 || !f2) return;

    // 渲染分辨率：viewport size × min(DPR, 2) 上限 2560×1600
    // 太大 PNG dataURL 体积爆炸；太小 background-size: cover 会糊
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.min(Math.round(window.innerWidth * dpr), 2560);
    const H = Math.min(Math.round(window.innerHeight * dpr), 1600);

    function bake(filterEl, fillColor) {
      return new Promise(function (resolve) {
        let url;
        try {
          const filterStr = new XMLSerializer().serializeToString(filterEl);
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
            // 复刻 .island { filter: url(#xxx) brightness(20) contrast(1) }
            // 中的 brightness/contrast 部分（SVG filter 已包在 url() 内一并应用）
            ctx.filter = "brightness(20) contrast(1)";
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

    Promise.all([bake(f1, "rgb(52,65,73)"), bake(f2, "rgb(52,65,73)")]).then(
      function (results) {
        const u1 = results[0];
        const u2 = results[1];
        if (u1) {
          // 保留 beij.html .island opacity:0.65，换 background + 撤 filter
          island.style.background =
            "url(" + u1 + ") center/cover no-repeat";
          island.style.filter = "none";
        }
        if (u2) {
          // 保留 beij.html .islandt opacity:0.5
          islandt.style.background =
            "url(" + u2 + ") center/cover no-repeat";
          islandt.style.filter = "none";
        }
        if (u1 && u2) {
          // 双双 bake 成功才移除 inline SVG（filter defs 不再被引用）
          // 失败 fallback 时保留 inline SVG 让原 filter url() 引用仍生效
          inlineSvg.remove();
          if (window.console && console.debug) {
            console.debug("[auth-bg-bake] baked, inline SVG removed");
          }
        }
      },
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    // 脚本是 defer，DOMContentLoaded 已触发或正在；直接跑
    run();
  }
})();
