// 2026-09-25 地址栏去掉 .html：/chat/api/keys.html → /chat/api/keys，…/index.html → …/
// GitHub Pages 本就支持无后缀访问，所以刷新/分享干净地址都能打开；目录不变，相对链接照常解析。
// 在 <head> 里同步加载，保证后续脚本读到的 location.pathname 已是干净形式 ——
// ⚠️ 因此任何按 pathname 判断页面的代码都必须同时认「带/不带 .html」两种写法。
(function () {
  try {
    var p = location.pathname;
    var clean = p.replace(/\/index\.html$/i, "/").replace(/\.html$/i, "");
    if (clean !== p && window.history && history.replaceState) {
      history.replaceState(history.state, "", clean + location.search + location.hash);
    }
  } catch (_) { /* file:// 等环境不允许改地址，保持原样 */ }
})();
