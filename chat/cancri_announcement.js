(function () {
  "use strict";

  // 2026-07-18：公告 UI 改为 ZenMux 通知中心时间线（连续滚动 + 展开）。
  // 抽屉 open/close / 红点 / dismiss 仍由 cancri_chat.js 控制。

  // 截断高度不在这里写死：读 .zm-ann-md 的 --zm-clamp-h（定义在 styles/zenmux-announce.css）。
  // 任何时候只允许存在一个截断高度，否则会重演「CSS 剪 140 / JS 判 160」那个中间地带
  // 被剪掉又拿不到展开按钮的 bug。
  function clampHeightOf(el) {
    const px = parseFloat(getComputedStyle(el).getPropertyValue("--zm-clamp-h"));
    return px > 0 ? px : 140;
  }

  // 与 .zm-ann-md 的 transition 时长对齐（styles/zenmux-announce.css）。
  const EXPAND_MS = 320;

  // 动画收尾：放开 inline max-height。两个兜底都不是防御性冗余，是真实可达路径——
  // ① prefers-reduced-motion 下 transition 被关掉，transitionend 永远不来；
  // ② 用户快速连点展开/收起时，上一次的收尾会在新动画中途把 max-height 清掉。
  function afterMaxHeight(el, fn) {
    cancelPendingMaxHeight(el);
    let timer = 0;
    function detach() {
      el.removeEventListener("transitionend", handler);
      clearTimeout(timer);
      el._zmCancelMaxHeight = null;
    }
    function finish() {
      detach();
      fn();
    }
    function handler(e) {
      if (e.target !== el || e.propertyName !== "max-height") return;
      finish();
    }
    el.addEventListener("transitionend", handler);
    timer = setTimeout(finish, EXPAND_MS + 60);
    el._zmCancelMaxHeight = detach;
  }

  function cancelPendingMaxHeight(el) {
    if (el._zmCancelMaxHeight) el._zmCancelMaxHeight();
  }

  function expandBody(el, btn) {
    // 从当前的 clamp 高度过渡到实测像素高度，动画结束再放开成 auto——
    // 留着像素上限会在字体加载/换行变化后把内容卡住。
    el.style.maxHeight = el.scrollHeight + "px";
    el.classList.remove("zm-ann-clamped");
    btn.textContent = "收起";
    afterMaxHeight(el, () => { el.style.maxHeight = ""; });
  }

  function collapseBody(el, btn) {
    el.style.maxHeight = el.scrollHeight + "px";
    void el.offsetHeight; // 强制回流，给 transition 一个确定的起始值，否则 none→140px 直接跳变
    el.classList.add("zm-ann-clamped");
    el.style.maxHeight = clampHeightOf(el) + "px";
    btn.textContent = "展开";
    afterMaxHeight(el, () => { el.style.maxHeight = ""; });
  }

  // 必须在抽屉已经 .open（display 不再是 none）之后调用，否则 scrollHeight 全是 0。
  function initClampAndExpand() {
    const timeline = document.getElementById("announcementTimeline");
    if (!timeline) return;

    timeline.querySelectorAll("[data-zm-clamp]").forEach((el) => {
      const btn = el.parentElement && el.parentElement.querySelector("[data-zm-expand]");
      cancelPendingMaxHeight(el);
      el.style.maxHeight = "";
      // scrollHeight 报的是完整内容高度，不受 max-height 裁剪影响，
      // 所以不需要先摘 class 再量，也就不用临时关掉 transition。
      const clampH = clampHeightOf(el);
      const needsClamp = el.scrollHeight > clampH + 1;
      el.classList.toggle("zm-ann-clamped", needsClamp);
      if (!btn) return;
      btn.hidden = !needsClamp;
      btn.textContent = "展开";
      btn.onclick = needsClamp
        ? function () {
            if (el.classList.contains("zm-ann-clamped")) expandBody(el, btn);
            else collapseBody(el, btn);
          }
        : null;
    });
  }

  // 旧的分页 pager 已废弃（CSS 里 .zm-ann-drawer .announcement-pager 直接 display:none），
  // 时间线一次展示全部条目；这里只负责在抽屉每次打开时重新测量、重建展开态。
  function initAnnouncementPager() {
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
    // 刻意不在 load 时预跑一次：那时 .modal 还是 display:none（cancri_chat.css:5003），
    // 量到的 scrollHeight 全是 0，只会得出「谁都不用截断」的错误结论。
  }

  function initCtaActions() {
    document.addEventListener("click", (e) => {
      const cta = e.target.closest(".zm-ann-cta[data-zm-action='open-invite']");
      if (!cta) return;
      e.preventDefault();
      if (typeof window.openClaudeSettingsInvite === "function") {
        window.openClaudeSettingsInvite();
      } else {
        // 兜底：跳转 claude.html 让用户手动点「邀请」
        window.location.href = cta.getAttribute("href") || "./claude.html";
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { initAnnouncementPager(); initCtaActions(); }, { once: true });
  } else {
    initAnnouncementPager();
    initCtaActions();
  }
})();
