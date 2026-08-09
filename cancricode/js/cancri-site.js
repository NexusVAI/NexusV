/**
 * CancriCode-owned page behavior (FAQ, hero CTA reveal, etc).
 * Theme toggle lives in js/cancri-theme.js — do not mix it in here.
 * Do not edit vendor Webflow bundles.
 */
(function () {
  'use strict';

  function initFaq() {
    var section = document.querySelector('[data-cancri-section="faq"]');
    if (!section || section.dataset.cancriReady === 'true') return;
    section.dataset.cancriReady = 'true';

    var triggers = section.querySelectorAll('.faq-trigger');
    triggers.forEach(function (trigger, index) {
      var item = trigger.closest('.faq-item');
      var answer = item && item.querySelector('.faq-answer-wrap');
      var icon = item && item.querySelector('.faq-icon');
      var iconBox = item && item.querySelector('.faq-icon-box');
      if (!item || !answer || !icon || !iconBox) return;

      var answerId = answer.id || 'faq-answer-' + (index + 1);
      answer.id = answerId;
      trigger.setAttribute('aria-controls', answerId);
      trigger.setAttribute('aria-expanded', 'false');

      trigger.addEventListener('click', function () {
        var isOpen = item.classList.toggle('is-open');
        trigger.setAttribute('aria-expanded', String(isOpen));
        answer.style.maxHeight = isOpen ? answer.scrollHeight + 'px' : '0px';
        answer.style.opacity = isOpen ? '1' : '0';
        icon.style.transform = isOpen ? 'rotate(45deg)' : 'rotate(0deg)';
        iconBox.style.backgroundColor = isOpen ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.06)';
      });
    });
  }

  /** Reveal hero pills when the title word animation starts (same IO threshold). */
  function initHeroCtas() {
    var hero = document.querySelector('[data-cancri-section="hero"]');
    if (!hero || hero.dataset.cancriCtasReady === 'true') return;
    hero.dataset.cancriCtasReady = 'true';

    var ctas = hero.querySelector('[data-cancri-role="hero-ctas"]');
    var title = hero.querySelector('h1.u-display-xl, h1');
    if (!ctas) return;

    function reveal() {
      ctas.classList.add('is-revealed');
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reveal();
      return;
    }

    var safety = window.setTimeout(reveal, 1600);

    if (!title || !('IntersectionObserver' in window)) {
      window.clearTimeout(safety);
      reveal();
      return;
    }

    var observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          window.clearTimeout(safety);
          requestAnimationFrame(reveal);
          obs.disconnect();
        });
      },
      { threshold: 0.2 }
    );

    observer.observe(title);
  }

  function init() {
    initFaq();
    initHeroCtas();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
