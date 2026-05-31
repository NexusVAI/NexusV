(function () {
  'use strict';

  // 2026-05-31：公告由「居中弹卡 timeline」改为「顶部下拉抽屉 + 一页页翻」。
  // 这里只负责翻页（显示哪一条 + 圆点/上一条/下一条 + 抽屉打开时回到第 1 页）；
  // 抽屉的 open/close/红点/dismiss 仍由 cancri_chat.js 控制，零改动。
  function initAnnouncementPager() {
    const modal = document.getElementById('announcementModal');
    const timeline = document.getElementById('announcementTimeline');
    const dotsWrap = document.getElementById('announcementPagerDots');
    const prevBtn = document.getElementById('announcementPrev');
    const nextBtn = document.getElementById('announcementNext');
    if (!modal || !timeline) return;

    const items = Array.from(timeline.querySelectorAll('.timeline-item'));
    const total = items.length;
    if (total === 0) return;

    let current = 0;
    const dots = [];

    if (dotsWrap) {
      dotsWrap.innerHTML = '';
      items.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'ann-dot';
        dot.setAttribute('aria-label', '第 ' + (i + 1) + ' 条公告');
        dot.addEventListener('click', () => showPage(i));
        dotsWrap.appendChild(dot);
        dots.push(dot);
      });
    }

    function showPage(index) {
      current = Math.max(0, Math.min(total - 1, index));
      items.forEach((item, i) => {
        item.classList.toggle('ann-page-active', i === current);
      });
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === current);
      });
      if (prevBtn) prevBtn.disabled = current === 0;
      if (nextBtn) nextBtn.disabled = current === total - 1;
    }

    if (prevBtn) prevBtn.addEventListener('click', () => showPage(current - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => showPage(current + 1));

    // 抽屉每次打开（cancri_chat.js 给 modal 加 .open）→ 回到第 1 页（最新公告）。
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.attributeName === 'class' && modal.classList.contains('open')) {
          showPage(0);
        }
      });
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });

    showPage(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnnouncementPager, { once: true });
  } else {
    initAnnouncementPager();
  }
})();
