(function () {
  "use strict";

  // 2026-07-18：公告 UI 改为 ZenMux 通知中心时间线（连续滚动 + 展开）。
  // 抽屉 open/close / 红点 / dismiss 仍由 cancri_chat.js 控制。

  function initClampAndExpand() {
    const timeline = document.getElementById("announcementTimeline");
    if (!timeline) return;

    timeline.querySelectorAll("[data-zm-clamp]").forEach((el) => {
      const btn = el.parentElement && el.parentElement.querySelector("[data-zm-expand]");
      // measure overflow
      const needs = el.scrollHeight > el.clientHeight + 4 || el.classList.contains("zm-ann-clamped");
      // force measure unclamped
      const was = el.classList.contains("zm-ann-clamped");
      el.classList.remove("zm-ann-clamped");
      const fullH = el.scrollHeight;
      el.classList.toggle("zm-ann-clamped", was || fullH > 160);
      if (fullH > 160) {
        el.classList.add("zm-ann-clamped");
        if (btn) {
          btn.hidden = false;
          btn.textContent = "展开";
          btn.onclick = function () {
            const nowClamped = el.classList.toggle("zm-ann-clamped");
            btn.textContent = nowClamped ? "展开" : "收起";
          };
        }
      } else if (btn) {
        btn.hidden = true;
      }
    });
  }

  function initAnnouncementPager() {
    // 保留空实现兼容：旧 pager 已 hidden，时间线一次展示全部
    const modal = document.getElementById("announcementModal");
    if (!modal) return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.attributeName === "class" && modal.classList.contains("open")) {
          initClampAndExpand();
          const sc = modal.querySelector(".zm-ann-scroll");
          if (sc) sc.scrollTop = 0;
        }
      });
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["class"] });

    if (document.readyState === "complete") initClampAndExpand();
    else window.addEventListener("load", initClampAndExpand, { once: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAnnouncementPager, { once: true });
  } else {
    initAnnouncementPager();
  }
})();
