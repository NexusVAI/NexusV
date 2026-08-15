/**
 * admin-nav.js — 管理员共享左侧栏导航（2026-07-06）
 *
 * 所有 admin_*.html 页面用 <nav id="admin-nav" data-active="X"> 占位，
 * 本脚本注入统一导航项 + ADMIN badge + 返回聊天链接。
 *
 * 用法：
 *   <nav id="admin-nav" data-active="dashboard"></nav>
 *   <script src="./admin-nav.js?v=20260706"></script>
 *
 * data-active 取值：
 *   dashboard | users | orders | usage | lines | models | pricing |
 *   descriptions | appeals | stories | api_apply
 */
(function () {
  "use strict";

  var NAV_ITEMS = [
    { key: "dashboard",    href: "./admin_dashboard.html",   label: "仪表盘" },
    { key: "users",        href: "./admin_users.html",       label: "用户" },
    { key: "orders",       href: "./admin_orders.html",      label: "订单" },
    { key: "usage",        href: "./admin_usage.html",       label: "调用日志" },
    { key: "lines",        href: "./admin_lines.html",       label: "线路" },
    { key: "models",       href: "./admin_models.html",      label: "模型配置" },
    { key: "pricing",      href: "./admin_pricing.html",     label: "按量定价" },
    { key: "descriptions", href: "./admin_descriptions.html", label: "模型描述" },
    { key: "appeals",      href: "./admin_appeals.html",     label: "申诉" },
    { key: "stories",      href: "./admin_stories.html",     label: "满月故事" },
    { key: "api_apply",    href: "./admin.html",             label: "工单/反馈" },
  ];

  function renderAdminNav() {
    var holder = document.getElementById("admin-nav");
    if (!holder) return;
    var active = holder.getAttribute("data-active") || "";
    var html = "";
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      var it = NAV_ITEMS[i];
      var cls = it.key === active ? ' class="active"' : "";
      var aria = it.key === active ? ' aria-current="page"' : "";
      html +=
        '<a href="' + it.href + '"' + cls + aria + ">" + it.label + "</a>";
    }
    html +=
      '<span class="badge-admin">ADMIN</span>' +
      '<span class="spacer"></span>' +
      '<a href="../" style="color: var(--text-faint)">←返回聊天</a>';
    holder.className = "nav";
    holder.innerHTML = html;
  }

  // 暴露给测试 / 手动重渲染
  window.__renderAdminNav = renderAdminNav;

  // ─── 2026-08-14: 鉴权前全屏黑屏遮罩 ────────────────────────────
  //
  // 根因：#admin-nav 侧边栏（含 admin_users / admin_models 等其余 10 个
  // 后台页链接）不受任何鉴权门控，DOMContentLoaded 即无条件渲染；而各页
  // 自己的 #login-gate / #deny-gate（未登录 / 非管理员）只覆盖 #main
  // 区域，侧边栏在这两种情况下始终可见——未登录访客也能看到全部后台
  // 功能入口列表。11 个 admin_*.html 的 init() 都是同一套
  // `$("loading").style.display='none'` → 二选一显示 login-gate/deny-gate
  // → 否则显示 #main 的流程（逐一核对过），故在这个唯一共同加载点
  // admin-nav.js 里用 MutationObserver 集中拦，不用改 11×2 个页面/脚本。
  //
  // 做法：把 #loading / #login-gate / #deny-gate 挪进一个 position:fixed
  // 全屏纯黑遮罩（z-index 高于侧边栏），只有当 #main 被对应页面的 init()
  // 置为可见（display !== 'none'）时才判定"确认是管理员"，移除遮罩。
  // 三个源 div 的原有内容/样式/文案完全不改，只是换了个父节点渲染位置。
  function installAdminAuthOverlay() {
    var main = document.getElementById("main");
    // 没有 #main 的页面（当前 11 个 admin_*.html 均有）不装遮罩，避免误伤。
    if (!main) return;
    var loading = document.getElementById("loading");
    var loginGate = document.getElementById("login-gate");
    var denyGate = document.getElementById("deny-gate");
    if (!loading && !loginGate && !denyGate) return;

    var overlay = document.createElement("div");
    overlay.id = "admin-auth-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.right = "0";
    overlay.style.bottom = "0";
    overlay.style.zIndex = "999999";
    overlay.style.background = "#000";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.padding = "24px";

    [loading, loginGate, denyGate].forEach(function (el) {
      if (!el) return;
      el.style.width = "100%";
      el.style.maxWidth = "520px";
      el.style.margin = "0";
      overlay.appendChild(el); // 从原位置挪走（reparent），侧边栏随即失去遮挡对象之外唯一的可见内容
    });
    document.body.appendChild(overlay);

    function maybeUnlock() {
      // 各页 init() 用 style.display = "block" 显示 #main 才代表鉴权通过；
      // 初始 inline style="display: none" 与其它任何值都视为"尚未通过"。
      if (main.style.display && main.style.display !== "none") {
        overlay.remove();
        observer.disconnect();
      }
    }
    var observer = new MutationObserver(maybeUnlock);
    observer.observe(main, { attributes: true, attributeFilter: ["style"] });
    maybeUnlock(); // 防御：极少数页面可能在本脚本执行前就已同步显示过 #main
  }

  // 遮罩必须先装（挪空 loading/gate 原位置），再渲染侧边栏内容——
  // 二者虽同一 task 内执行、浏览器理论上不会中间插入一次 paint，
  // 但顺序上遮罩先行更保险，makes nav 渲染完成时已经在遮罩之下。
  function boot() {
    installAdminAuthOverlay();
    renderAdminNav();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
