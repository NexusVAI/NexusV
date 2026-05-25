/* ============================================================
 * Cancri 满月页 · 编年史横向粘性滚动驱动
 * 工作原理：
 *   - .celebrate-timeline-scroll 给它一个超大 height（= 轨道宽度 - 视口宽度 + 100vh）
 *   - 内部 .celebrate-timeline-pin 用 position: sticky 钉在视口里
 *   - 用户向下滚动时，根据 sectionRect.top 算出 0→1 的进度
 *   - 把 .celebrate-timeline-track translateX(-progress * scrollDistance)
 *   - 小屏（<= 800px）走原生 overflow-x: auto，不参与 sticky 逻辑
 * 后端契约：纯前端，无任何外部依赖
 * ============================================================ */
(function () {
  "use strict";

  function init() {
    var section = document.querySelector(".celebrate-timeline-scroll");
    if (!section) return;
    var track = section.querySelector("[data-timeline-track]");
    var wrap = section.querySelector("[data-timeline-wrap]");
    if (!track || !wrap) return;

    var MOBILE_BP = 800;
    var ENDING_PAD = 80;

    function isMobile() {
      return window.innerWidth <= MOBILE_BP;
    }

    function recalc() {
      if (isMobile()) {
        section.style.height = "";
        track.style.transform = "";
        return null;
      }
      var trackWidth = track.scrollWidth;
      var wrapWidth = wrap.clientWidth;
      var scrollDistance = Math.max(0, trackWidth - wrapWidth + ENDING_PAD);
      section.style.height = scrollDistance + window.innerHeight + "px";
      return scrollDistance;
    }

    function update() {
      if (isMobile()) return;
      var trackWidth = track.scrollWidth;
      var wrapWidth = wrap.clientWidth;
      var scrollDistance = Math.max(0, trackWidth - wrapWidth + ENDING_PAD);
      if (scrollDistance <= 0) {
        track.style.transform = "translateX(0)";
        return;
      }
      var rect = section.getBoundingClientRect();
      var sectionHeight = section.offsetHeight;
      var totalScrollable = sectionHeight - window.innerHeight;
      if (totalScrollable <= 0) return;
      var progress = -rect.top / totalScrollable;
      if (progress < 0) progress = 0;
      if (progress > 1) progress = 1;
      var x = -progress * scrollDistance;
      track.style.transform = "translateX(" + x.toFixed(2) + "px)";
    }

    function setup() {
      recalc();
      update();
    }

    // 字体加载完会改变 track 宽度，听完字体再 recalc 一次
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(setup);
    }

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(setup, 120);
    });

    window.addEventListener("scroll", update, { passive: true });

    setup();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
