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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderAdminNav);
  } else {
    renderAdminNav();
  }

  // 暴露给测试 / 手动重渲染
  window.__renderAdminNav = renderAdminNav;
})();
