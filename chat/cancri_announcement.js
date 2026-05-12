(function () {
  'use strict';

  function initAnnouncementCarousel() {
    const carousel = document.getElementById('announcementCarousel');
    if (!carousel) return;

    const items = carousel.querySelectorAll('.announcement-item');
    const indicators = carousel.querySelectorAll('.indicator');
    const total = items.length;
    if (total === 0) return;

    let currentIndex = 0;
    let intervalId = null;
    const intervalDuration = 4000;

    function showItem(index) {
      items.forEach((item, i) => {
        item.classList.toggle('active', i === index);
      });
      indicators.forEach((ind, i) => {
        ind.classList.toggle('active', i === index);
      });
      currentIndex = index;
    }

    function nextItem() {
      const next = (currentIndex + 1) % total;
      showItem(next);
    }

    function startAutoPlay() {
      if (intervalId) clearInterval(intervalId);
      intervalId = setInterval(nextItem, intervalDuration);
    }

    function stopAutoPlay() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    indicators.forEach((ind, i) => {
      ind.addEventListener('click', () => {
        showItem(i);
        startAutoPlay();
      });
    });

    carousel.addEventListener('mouseenter', stopAutoPlay);
    carousel.addEventListener('mouseleave', startAutoPlay);
    startAutoPlay();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnnouncementCarousel, { once: true });
  } else {
    initAnnouncementCarousel();
  }
})();
