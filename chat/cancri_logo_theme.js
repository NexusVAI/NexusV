/* =====================================================================
 * Cancri 双主题 logo 同步
 *
 * 项目用自定义属性 `html[data-theme="dark|light"]` 切换主题（不是
 * `prefers-color-scheme`），所以 <picture> + media query 不能跟随
 * 用户在 sidebar 主题按钮里的手动切换。
 *
 * 这段脚本：
 *   1. 找到所有标 `class="cancri-logo"` 且带 `data-light-src` /
 *      `data-dark-src` 两个属性的 <img>，按当前主题写 src；
 *   2. 用 MutationObserver 监听 <html data-theme> 变化，主题切换时
 *      实时同步所有 logo（不需要刷新页面）；
 *   3. DOMContentLoaded 后再扫一遍兜底（避免脚本被放在 head 时
 *      <img> 还没解析）。
 *
 * 主题判定：
 *   • chat 主页（cancri_chat.js）切换时一定会 set `data-theme="light"`
 *     或 `data-theme="dark"`；
 *   • chat/api 平台页（api-platform.js）切到暗色时 removeAttribute，
 *     即没有 data-theme 属性 = 默认暗色。
 *   故 isLight = theme === "light"；其它（dark / null）皆视为暗色。
 *
 * 不引入任何依赖；纯原生 DOM API；无副作用。
 * ===================================================================== */
(function () {
  "use strict";
  var DARK_ATTR = "data-dark-src";
  var LIGHT_ATTR = "data-light-src";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme");
  }

  function syncOne(img, isLight) {
    var next = isLight
      ? img.getAttribute(LIGHT_ATTR)
      : img.getAttribute(DARK_ATTR);
    if (!next) return;
    if (img.getAttribute("src") !== next) img.setAttribute("src", next);
  }

  function syncAll() {
    var isLight = currentTheme() === "light";
    var nodes = document.querySelectorAll(
      "img.cancri-logo[" + DARK_ATTR + "][" + LIGHT_ATTR + "]",
    );
    for (var i = 0; i < nodes.length; i++) syncOne(nodes[i], isLight);
  }

  // 立即跑一次（脚本可能在 head 里被同步执行；此时 <img> 已解析的
  // 节点先同步，剩下的等 DOMContentLoaded 兜底）。
  syncAll();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncAll, { once: true });
  }

  // 主题切换实时跟随：cancri_chat.js / api-platform.js / theme.js
  // 都通过 documentElement.setAttribute("data-theme", ...) 切换主题，
  // MutationObserver 能捕获所有这些写入。
  if (typeof MutationObserver === "function") {
    var obs = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        if (records[i].attributeName === "data-theme") {
          syncAll();
          return;
        }
      }
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
})();
