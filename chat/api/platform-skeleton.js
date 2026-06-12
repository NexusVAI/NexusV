/**
 * Cancri 开放平台 — 共享骨架屏（catalog / keys / orders / pricing 等后端拉取前）
 * 用法：容器加 data-platform-skeleton="model-grid|card-panel|orders-page|order-form"
 */
(function (win) {
  var WIDTHS = [92, 78, 85, 64, 88, 72, 80, 68, 90];

  function bar(w, h, cls) {
    h = h || 10;
    cls = cls ? " " + cls : "";
    return (
      '<span class="platform-skeleton-block platform-skeleton-shimmer' +
      cls +
      '" style="width:' +
      w +
      "%;height:" +
      h +
      'px"></span>'
    );
  }

  function modelCard(i) {
    var w = WIDTHS[i % WIDTHS.length];
    return (
      '<div class="platform-skeleton-card" aria-hidden="true">' +
      '<div class="platform-skeleton-card__head">' +
      bar(42, 18, "platform-skeleton-card__title") +
      bar(26, 20, "platform-skeleton-card__badge") +
      "</div>" +
      bar(55, 10) +
      bar(w, 12, "platform-skeleton-card__id") +
      '<div class="platform-skeleton-card__meta">' +
      bar(35, 10) +
      bar(42, 10) +
      "</div></div>"
    );
  }

  function modelGrid(count) {
    count = count || 9;
    var html = '<div class="platform-skeleton-grid">';
    for (var i = 0; i < count; i += 1) html += modelCard(i);
    return html + "</div>";
  }

  function cardPanel(rows) {
    rows = rows || 4;
    var html = '<div class="platform-skeleton-panel">';
    for (var i = 0; i < rows; i += 1) html += bar(WIDTHS[i % WIDTHS.length], 12);
    return html + "</div>";
  }

  function ordersPage() {
    return (
      '<div class="platform-skeleton-stack">' +
      '<div class="platform-skeleton-subcard">' +
      '<span class="platform-skeleton-block platform-skeleton-shimmer" style="width:56px;height:56px;border-radius:12px;flex-shrink:0"></span>' +
      '<div class="platform-skeleton-subcard__text">' +
      bar(40, 16) +
      bar(78, 10) +
      bar(62, 10) +
      "</div></div>" +
      '<div class="platform-skeleton-table">' +
      Array.from({ length: 5 })
        .map(function (_, r) {
          return (
            '<div class="platform-skeleton-table__row">' +
            bar(55 + r * 4, 12, "platform-skeleton-table__cell") +
            bar(48, 12, "platform-skeleton-table__cell") +
            bar(36, 12, "platform-skeleton-table__cell") +
            bar(52, 12, "platform-skeleton-table__cell") +
            "</div>"
          );
        })
        .join("") +
      "</div></div>"
    );
  }

  function orderForm() {
    return (
      '<div class="platform-skeleton-panel platform-skeleton-panel--form">' +
      bar(70, 14) +
      bar(55, 10) +
      bar(88, 40) +
      bar(88, 40) +
      bar(36, 36, "platform-skeleton-block--btn") +
      "</div>"
    );
  }

  var TEMPLATES = {
    "model-grid": modelGrid,
    "card-panel": cardPanel,
    "orders-page": ordersPage,
    "order-form": orderForm,
  };

  function render(type) {
    var fn = TEMPLATES[type];
    return fn ? fn() : "";
  }

  function mountAll(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-platform-skeleton]").forEach(function (el) {
      var type = el.getAttribute("data-platform-skeleton");
      if (!type || el.dataset.skeletonMounted === "1") return;
      el.innerHTML = render(type);
      el.setAttribute("aria-busy", "true");
      el.dataset.skeletonMounted = "1";
    });
  }

  function hide(id) {
    var el = typeof id === "string" ? document.getElementById(id) : id;
    if (!el) return;
    el.removeAttribute("aria-busy");
    el.style.display = "none";
  }

  function clearStatBlocks(selectors) {
    (selectors || []).forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      el.classList.remove("platform-skeleton-block", "platform-skeleton-shimmer");
      el.style.minWidth = "";
      el.style.minHeight = "";
    });
  }

  win.PlatformSkeleton = {
    render: render,
    mountAll: mountAll,
    hide: hide,
    clearStatBlocks: clearStatBlocks,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      mountAll();
    });
  } else {
    mountAll();
  }
})(window);
