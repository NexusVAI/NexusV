/**
 * CornerKit squircles:
 * - download cards + nested (concentric) button corners
 * - engineering CTA panel (pre-fullscreen card state)
 * - integration grid cards + morph slides (radius 100)
 *
 * Nested formula: R_inner = max(0, R_outer - padding)
 */
(function () {
  'use strict';

  var CARD_SELECTOR = '[data-cancri-section="downloads"] .package_banner';
  var CTA_SELECTOR =
    '[data-cancri-section="engineering-problems"] .big-cta_scroll-bg.is-kt3';
  var CORNER_100_SELECTOR = '[data-cancri-corner="100"]';
  var INTEGRATION_CARD_SEL =
    '[data-cancri-section="integrations"] .o-integration-card__wrapper';
  var INTEGRATION_SLIDE_SEL =
    '[data-cancri-section="integrations"] .home-integration__slide';
  var RADIUS = 40;
  var RADIUS_LARGE = 100;
  var SMOOTHING = 1;

  function paddingInset(el) {
    var style = window.getComputedStyle(el);
    var left = parseFloat(style.paddingLeft) || 0;
    var right = parseFloat(style.paddingRight) || 0;
    var top = parseFloat(style.paddingTop) || 0;
    var bottom = parseFloat(style.paddingBottom) || 0;
    return Math.min(left, right, top, bottom);
  }

  function isNearFullscreen(el) {
    var width = el.getBoundingClientRect().width;
    return width >= window.innerWidth - 2;
  }

  function applyLarge(ck, el) {
    if (!(el instanceof HTMLElement)) return;
    try {
      if (ck.inspect(el)) {
        ck.update(el, { radius: RADIUS_LARGE, smoothing: SMOOTHING });
      } else {
        ck.apply(el, { radius: RADIUS_LARGE, smoothing: SMOOTHING });
      }
    } catch (e) {
      // ignore
    }
  }

  function initDownloads(ck) {
    var cards = document.querySelectorAll(CARD_SELECTOR);
    cards.forEach(function (card) {
      if (!(card instanceof HTMLElement)) return;

      ck.apply(card, { radius: RADIUS, smoothing: SMOOTHING });

      var inset = paddingInset(card);
      var btnRadius = Math.max(0, RADIUS - inset);
      card.style.setProperty('--cancri-download-btn-radius', btnRadius + 'px');

      card.querySelectorAll('.btn_main_wrap').forEach(function (btn) {
        if (!(btn instanceof HTMLElement)) return;
        ck.apply(btn, { radius: btnRadius, smoothing: SMOOTHING });
      });
    });
  }

  function initCorner100(ck) {
    document.querySelectorAll(CORNER_100_SELECTOR).forEach(function (el) {
      // Codex images use adaptive radius in cancri-rimlight.js (r=100 collapses on mobile).
      if (el.closest('[data-cancri-section="codex-workflow"]')) return;
      applyLarge(ck, el);
    });
  }

  function initIntegrationSquircles(ck) {
    document.querySelectorAll(INTEGRATION_CARD_SEL).forEach(function (el) {
      el.setAttribute('data-cancri-corner', '100');
      applyLarge(ck, el);
    });
    document.querySelectorAll(INTEGRATION_SLIDE_SEL).forEach(function (el) {
      el.setAttribute('data-cancri-corner', '100');
      applyLarge(ck, el);
    });
  }

  function refreshIntegrationSquircles(ck) {
    document
      .querySelectorAll(
        INTEGRATION_CARD_SEL +
          ', ' +
          INTEGRATION_SLIDE_SEL +
          ', #home-integration__cards-mobile .cancri-rimlight-host--integration > .cancri-rimlight' +
          ', .cancri-rimlight-host--plan > .cancri-rimlight' +
          ', .cancri-rimlight-host--plan > .cancri-plan-card'
      )
      .forEach(function (el) {
        applyLarge(ck, el);
      });
  }

  function initCta(ck) {
    var cta = document.querySelector(CTA_SELECTOR);
    if (!(cta instanceof HTMLElement)) return;

    function sync() {
      var radius = isNearFullscreen(cta) ? 0 : RADIUS;
      if (ck.inspect(cta)) {
        ck.update(cta, { radius: radius, smoothing: SMOOTHING });
      } else {
        ck.apply(cta, { radius: radius, smoothing: SMOOTHING });
      }
    }

    sync();

    // GSAP writes inline styles while scrolling to fullscreen — keep squircle in sync.
    var scheduled = false;
    function scheduleSync() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        sync();
      });
    }

    window.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync, { passive: true });

    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(scheduleSync).observe(cta, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });
    }
  }

  function init() {
    var CornerKit = window.CornerKit;
    if (!CornerKit) {
      console.warn('[cancri-cornerkit] CornerKit is not loaded');
      return;
    }

    var ck = new CornerKit({ radius: RADIUS, smoothing: SMOOTHING });
    initDownloads(ck);
    initCta(ck);
    initCorner100(ck);
    initIntegrationSquircles(ck);

    // Slides resize during scroll morph — keep squircle path in sync.
    var scheduled = false;
    function scheduleIntegrationRefresh() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        refreshIntegrationSquircles(ck);
      });
    }
    window.addEventListener('scroll', scheduleIntegrationRefresh, { passive: true });
    window.addEventListener('resize', scheduleIntegrationRefresh, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
