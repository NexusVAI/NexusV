/**
 * cancri-motion.js — Apple-style motion layer (OWNED).
 *
 * Provides:
 *   1. Scroll reveal (IntersectionObserver, blur-to-sharp for text)
 *   2. Hero exit parallax (content scrolls slower + fades, scrubbed)
 *   3. Nav hairline class once scrolled
 *   4. Magnetic hover on hero / nav CTAs
 *   5. 3D tilt on the active download card
 *   6. Eased in-page anchor scrolling
 *
 * Zero dependencies (vendor GSAP untouched). Must run AFTER
 * cancri-rimlight.js so the download/codex wrappers already exist.
 * Fully skipped under prefers-reduced-motion; without JS nothing is hidden
 * because all states live behind html.cancri-motion (see cancri-motion.css).
 */
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var docEl = document.documentElement;

  /* ---------------- 1. Scroll reveal ---------------- */

  function inViewportNow(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || docEl.clientHeight;
    return r.top < vh * 0.92 && r.bottom > 0;
  }

  function collectRevealTargets() {
    var targets = [];

    function add(el, variant, delay) {
      if (el) targets.push({ el: el, variant: variant, delay: delay || 0 });
    }

    var codex = document.querySelector('[data-cancri-section="codex-workflow"]');
    if (codex) {
      add(codex.querySelector('.u-container > div:first-child'), 'blur', 0);
      codex.querySelectorAll('.codex-row').forEach(function (row) {
        add(row.querySelector('.codex-col-text'), 'blur', 0);
        // Outermost image col (rimlight host after wrapping) owns a
        // drop-shadow filter — use the non-blur variant there.
        add(row.querySelector('.codex-col-img'), 'soft', 0.12);
      });
    }

    var downloads = document.querySelector('[data-cancri-section="downloads"]');
    if (downloads) {
      add(downloads.querySelector('.g_heading'), 'blur', 0);
      downloads.querySelectorAll('.u-grid-desktop > .u-column-4').forEach(function (col, i) {
        add(col, 'soft', 0.08 + i * 0.1);
      });
    }

    var faq = document.querySelector('[data-cancri-section="faq"]');
    if (faq) {
      add(faq.querySelector('.g_heading'), 'blur', 0);
      faq.querySelectorAll('.faq-item').forEach(function (item, i) {
        add(item, 'soft', 0.05 + i * 0.06);
      });
    }

    return targets;
  }

  function initReveal() {
    if (!('IntersectionObserver' in window)) return;

    var targets = collectRevealTargets().filter(function (t) {
      // Elements already on screen (e.g. scroll restored on reload) stay
      // visible — animating them in would read as a glitch, not polish.
      return !inViewportNow(t.el);
    });
    if (!targets.length) return;

    var byEl = new Map();

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var t = byEl.get(entry.target);
          if (!t) return;
          observer.unobserve(entry.target);
          byEl.delete(entry.target);
          entry.target.classList.add('is-inview');
          // Return to native stylesheet state once settled: drops
          // will-change and our transition rules without a visual jump.
          window.setTimeout(function () {
            entry.target.removeAttribute('data-cancri-reveal');
            entry.target.classList.remove('is-inview');
            entry.target.style.removeProperty('--cancri-reveal-delay');
          }, 1000 + t.delay * 1000);
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -7% 0px' }
    );

    targets.forEach(function (t) {
      t.el.setAttribute('data-cancri-reveal', t.variant === 'blur' ? 'blur' : 'soft');
      if (t.delay) t.el.style.setProperty('--cancri-reveal-delay', t.delay.toFixed(2) + 's');
      byEl.set(t.el, t);
      observer.observe(t.el);
    });
  }

  /* ---------------- 2 + 3. Hero parallax & nav hairline ---------------- */

  function initScrollEffects() {
    var hero = document.querySelector('[data-cancri-section="hero"]');
    var heroInner = hero && hero.querySelector('.u-container');
    var heroH = hero ? hero.offsetHeight : 0;
    var heroDone = false;
    /* Direction-aware capsule: down → pill, up a bit → full bar (no need to hit top). */
    var NAV_TOP_RESET = 24;
    var NAV_DIR_DELTA = 6;
    var lastY = window.scrollY || window.pageYOffset || 0;
    var navScrolled = lastY > NAV_TOP_RESET;
    var ticking = false;
    if (navScrolled) docEl.classList.add('cancri-nav-scrolled');

    function apply() {
      ticking = false;
      var y = window.scrollY || window.pageYOffset || 0;
      var dy = y - lastY;
      lastY = y;

      var scrolled = navScrolled;
      if (y <= NAV_TOP_RESET) {
        scrolled = false;
      } else if (dy > NAV_DIR_DELTA) {
        scrolled = true;
      } else if (dy < -NAV_DIR_DELTA) {
        scrolled = false;
      }

      if (scrolled !== navScrolled) {
        navScrolled = scrolled;
        docEl.classList.toggle('cancri-nav-scrolled', scrolled);
        try {
          document.dispatchEvent(
            new CustomEvent('cancri:navscroll', { detail: { scrolled: scrolled } })
          );
        } catch (err) {
          /* ignore */
        }
      }

      if (!heroInner || heroH <= 0) return;
      if (y >= heroH) {
        if (!heroDone) {
          heroDone = true;
          heroInner.style.transform = '';
          heroInner.style.opacity = '0';
        }
        return;
      }
      heroDone = false;
      var p = Math.min(1, y / (heroH * 0.85));
      heroInner.style.transform = 'translate3d(0, ' + (y * 0.25).toFixed(1) + 'px, 0)';
      heroInner.style.opacity = Math.max(0, 1 - p * 1.08).toFixed(3);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(apply);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener(
      'resize',
      function () {
        heroH = hero ? hero.offsetHeight : 0;
        onScroll();
      },
      { passive: true }
    );
    apply();
  }

  /* ---------------- 4. Magnetic CTAs ---------------- */

  function initMagnetic() {
    var els = document.querySelectorAll(
      '[data-cancri-role="hero-ctas"] .cancri-hero-cta, [data-cancri-role="nav-cta"] .btn_main_wrap'
    );
    els.forEach(function (el) {
      if (el.dataset.cancriMagnetic === 'true') return;
      el.dataset.cancriMagnetic = 'true';

      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        el.style.setProperty('--cancri-mag-x', (nx * 4).toFixed(1) + 'px');
        el.style.setProperty('--cancri-mag-y', (ny * 3).toFixed(1) + 'px');
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--cancri-mag-x', '0px');
        el.style.setProperty('--cancri-mag-y', '0px');
      });
    });
  }

  /* ---------------- 5. Download card tilt ---------------- */

  function initTilt() {
    var hosts = document.querySelectorAll(
      '[data-cancri-section="downloads"] .cancri-rimlight-host--download'
    );
    hosts.forEach(function (host) {
      if (host.dataset.cancriTilt === 'true') return;
      host.dataset.cancriTilt = 'true';
      // Higher perspective + tiny angles = barely-there tilt
      if (host.parentElement) host.parentElement.style.perspective = '2000px';

      var cur = { rx: 0, ry: 0, s: 1 };
      var target = { rx: 0, ry: 0, s: 1 };
      var raf = 0;

      function step() {
        cur.rx += (target.rx - cur.rx) * 0.1;
        cur.ry += (target.ry - cur.ry) * 0.1;
        cur.s += (target.s - cur.s) * 0.1;
        var settled =
          Math.abs(cur.rx - target.rx) < 0.01 &&
          Math.abs(cur.ry - target.ry) < 0.01 &&
          Math.abs(cur.s - target.s) < 0.001;
        if (settled && target.rx === 0 && target.ry === 0 && target.s === 1) {
          host.style.transform = '';
          raf = 0;
          return;
        }
        host.style.transform =
          'rotateX(' + cur.rx.toFixed(2) + 'deg) rotateY(' + cur.ry.toFixed(2) +
          'deg) scale(' + cur.s.toFixed(4) + ')';
        raf = window.requestAnimationFrame(step);
      }

      function ensureRaf() {
        if (!raf) raf = window.requestAnimationFrame(step);
      }

      host.addEventListener('pointermove', function (e) {
        var r = host.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        // Was ±2.2° / ±2.8° — dialed to near-imperceptible
        target.rx = -ny * 0.45;
        target.ry = nx * 0.55;
        target.s = 1.0015;
        ensureRaf();
      });
      host.addEventListener('pointerleave', function () {
        target.rx = 0;
        target.ry = 0;
        target.s = 1;
        ensureRaf();
      });
    });
  }

  /* ---------------- 6. Eased anchor scrolling ---------------- */

  function initAnchorScroll() {
    var animating = false;
    var cancelled = false;

    function cancel() {
      cancelled = true;
    }

    function easeInOutQuint(t) {
      return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
    }

    function navOffset() {
      var nav = document.querySelector('.nav_wrap');
      return nav ? nav.getBoundingClientRect().height + 12 : 72;
    }

    function scrollToY(destY) {
      var startY = window.scrollY || 0;
      var dist = destY - startY;
      if (Math.abs(dist) < 2) return;
      var duration = Math.min(1100, Math.max(550, Math.abs(dist) * 0.35));
      var start = 0;
      animating = true;
      cancelled = false;

      window.addEventListener('wheel', cancel, { passive: true, once: true });
      window.addEventListener('touchstart', cancel, { passive: true, once: true });

      function frame(ts) {
        if (cancelled) {
          animating = false;
          return;
        }
        if (!start) start = ts;
        var t = Math.min(1, (ts - start) / duration);
        window.scrollTo(0, startY + dist * easeInOutQuint(t));
        if (t < 1) window.requestAnimationFrame(frame);
        else animating = false;
      }
      window.requestAnimationFrame(frame);
    }

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || animating) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = (a.getAttribute('href') || '').slice(1);
      if (!id) return;
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      var destY = target.getBoundingClientRect().top + (window.scrollY || 0) - navOffset();
      scrollToY(Math.max(0, destY));
      if (window.history && window.history.pushState) {
        window.history.pushState(null, '', '#' + id);
      }
    });
  }

  /* ---------------- boot ---------------- */

  function init() {
    if (docEl.dataset.cancriMotionReady === 'true') return;
    docEl.dataset.cancriMotionReady = 'true';
    docEl.classList.add('cancri-motion');

    initReveal();
    initScrollEffects();
    initMagnetic();
    initTilt();
    initAnchorScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
