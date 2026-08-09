/**
 * Devin.ai Rimlight — faithful port.
 *
 * Source model:
 *   parent (relative)
 *     .o-rimlight          // behind, 1px larger via ::before/::after
 *     .opaque-surface      // covers center; only edge ring shows
 *
 * Downloads cards use CornerKit squircles, so the rim is a SIBLING wrapper
 * layer (also CornerKit-clipped) sitting under the card — not a child inside
 * the clipped package_banner (that was why the glow never hugged the edge).
 */
(function () {
  'use strict';

  var DOWNLOAD_SEL = '[data-cancri-section="downloads"] .package_banner';
  var CODEX_SEL =
    '[data-cancri-section="codex-workflow"] .codex-col-img:not(.cancri-rimlight-host--codex)';
  // Desktop scroll cards + morph slides: NO rimlight (leaks / unwanted).
  // Mobile fixed cards + mobile plan cards only.
  var INTEGRATION_CARD_SEL =
    '#home-integration__cards-mobile .o-integration-card__wrapper:not([data-cancri-no-rimlight="true"])';
  var INTEGRATION_PLAN_SEL =
    '#home-integration__highlights-mobile .cancri-plan-card';
  var CK_RADIUS = 40;
  var CK_RADIUS_CODEX_MAX = 100;
  var CK_RADIUS_INTEGRATION = 100;
  var CK_SMOOTHING = 1;

  /**
   * Fixed r=100 on narrow/short Codex images becomes a capsule (corners "collapse").
   * Scale with the shorter side; never exceed half-min − 8.
   */
  function codexRadiusFor(el) {
    var rect = el.getBoundingClientRect();
    var w = rect.width || el.offsetWidth || 1;
    var h = rect.height || el.offsetHeight || 1;
    var shorter = Math.min(w, h);
    var r = Math.round(shorter * 0.18);
    if (r > CK_RADIUS_CODEX_MAX) r = CK_RADIUS_CODEX_MAX;
    if (r < 20) r = 20;
    var cap = Math.floor(shorter / 2) - 8;
    if (cap < 12) cap = 12;
    if (r > cap) r = cap;
    return r;
  }

  function cubicOut(t) {
    var n = t - 1;
    return n * n * n + 1;
  }

  function fit(value, inMin, inMax, outMin, outMax, easeFn) {
    var t = (value - inMin) / (inMax - inMin);
    if (t <= 0) return outMin;
    if (t >= 1) return outMax;
    if (easeFn) t = easeFn(t);
    return outMin + (outMax - outMin) * t;
  }

  function Rimlight(el) {
    this.domElement = el;
    this.animation = 0;
    this.prevAnimation = -1;
    this.isActive = false;
    this.width = 1;
    this.height = 1;
    this.showSpeed = 1.5;
    this.hideSpeed = 2.5;
    this.angle = 0;
    this.opacity = 0;
    // Light surfaces need a stronger peak than Devin's dark-card *0.5
    this.opacityGain = 1;
  }

  Rimlight.prototype.resize = function () {
    var host = this.domElement.parentElement;
    var rect = (host || this.domElement).getBoundingClientRect();
    this.width = rect.width || 1;
    this.height = rect.height || 1;
  };

  Rimlight.prototype.update = function (dt) {
    var i = this.animation;
    var step = dt * (i <= 1 ? this.showSpeed : this.hideSpeed);
    if (i > 0) {
      i = i + step;
      if (this.animation <= 1 && i > 1 && this.isActive) i = 1;
    } else if (this.isActive) {
      i = i + step;
    }
    if (i >= 2) i = 0;
    this.angle = -i * 360;
    this.animation = i;
    if (this.prevAnimation === i) return;

    var r = i < 1 ? fit(i, 0, 1, 0, 1, cubicOut) : fit(i, 1, 2, 1, 2);
    var opacity =
      fit(r, 0, 0.3, 0, 1) *
      fit(r, 0.3, 1, 1, 0.75) *
      fit(r, 1, 2, 1, 0) *
      0.5 *
      this.opacityGain;
    var angle = fit(r, 0, 1, 0, -45) + fit(r, 1, 2, 0, -25);

    // Aspect-correct sweep — identical to Devin Rimlight
    angle = (angle / 180) * Math.PI;
    var lx = Math.cos(angle) * this.height;
    var ly = Math.sin(angle) * this.width;
    angle = (Math.atan2(ly, lx) * 180) / Math.PI;

    this.domElement.style.setProperty('--rim-angle', angle + 'deg');
    this.domElement.style.opacity = String(opacity);
    this.domElement.style.visibility = opacity ? 'visible' : 'hidden';
    this.prevAnimation = this.animation;
  };

  var instances = [];
  var rafId = 0;
  var lastTs = 0;
  var ck = null;

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    var anyLive = false;
    for (var i = 0; i < instances.length; i++) {
      instances[i].update(dt);
      if (instances[i].isActive || instances[i].animation > 0) anyLive = true;
    }
    if (anyLive) rafId = requestAnimationFrame(tick);
    else {
      rafId = 0;
      lastTs = 0;
    }
  }

  function ensureLoop() {
    if (!rafId) {
      lastTs = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  function isLightTheme() {
    return document.documentElement.getAttribute('data-cancri-theme') !== 'dark';
  }

  function themeGain(kind) {
    var light = isLightTheme();
    // Peak opacity ≈ curve(≤0.75) * 0.5 * gain  (see Rimlight.update)
    if (kind === 'integration') return light ? 2.2 : 2;
    // Slightly above download — photo edges need a bit more peak, still thin (1px gutter).
    if (kind === 'codex') return light ? 2.15 : 1.6;
    return light ? 1.85 : 1.35;
  }

  function bindHover(host, rim, kind) {
    host.addEventListener('mouseenter', function () {
      rim.resize();
      rim.opacityGain = themeGain(kind);
      rim.isActive = true;
      ensureLoop();
    });
    host.addEventListener('mouseleave', function () {
      rim.isActive = false;
      ensureLoop();
    });
  }

  function ensureCornerKit(el, radius) {
    var r = radius == null ? CK_RADIUS : radius;
    if (!window.CornerKit) return;
    if (!ck) ck = new window.CornerKit({ radius: r, smoothing: CK_SMOOTHING });
    try {
      if (ck.inspect(el)) {
        ck.update(el, { radius: r, smoothing: CK_SMOOTHING });
      } else {
        ck.apply(el, { radius: r, smoothing: CK_SMOOTHING });
      }
    } catch (e) {
      // ignore
    }
  }

  function isDisabledCard(card) {
    if (card.classList.contains('is-disabled')) return true;
    if (card.getAttribute('aria-disabled') === 'true') return true;
    var style = card.getAttribute('style') || '';
    if (/opacity\s*:\s*0?\.\d+/i.test(style)) return true;
    if (/pointer-events\s*:\s*none/i.test(style)) return true;
    if (/grayscale\s*\(/i.test(style)) return true;
    var cs = window.getComputedStyle(card);
    if (parseFloat(cs.opacity) < 0.999) return true;
    if (cs.pointerEvents === 'none') return true;
    return false;
  }

  function attachDownload(card) {
    if (!(card instanceof HTMLElement) || card.dataset.cancriRimlight === 'true') return;
    // Semi-transparent disabled cards would reveal the full conic fill behind them.
    if (isDisabledCard(card)) {
      card.classList.add('is-disabled');
      return;
    }
    card.dataset.cancriRimlight = 'true';

    var parent = card.parentNode;
    if (!parent) return;

    var wrap = document.createElement('div');
    wrap.className = 'cancri-rimlight-host cancri-rimlight-host--download';

    var rimEl = document.createElement('div');
    rimEl.className = 'cancri-rimlight';
    rimEl.setAttribute('aria-hidden', 'true');

    parent.insertBefore(wrap, card);
    wrap.appendChild(rimEl);
    wrap.appendChild(card);

    // Match the card's squircle edge (CornerKit path), not CSS border-radius.
    ensureCornerKit(rimEl);

    var rim = new Rimlight(rimEl);
    rim.opacityGain = themeGain('download');
    rim.resize();
    instances.push(rim);
    bindHover(wrap, rim, 'download');
  }

  function attachCodex(surface) {
    if (!(surface instanceof HTMLElement) || surface.dataset.cancriRimlight === 'true') return;
    if (surface.classList.contains('cancri-rimlight-host--codex')) return;
    surface.dataset.cancriRimlight = 'true';

    var parent = surface.parentNode;
    if (!parent) return;

    // Same structure as attachDownload:
    // host > rim (CornerKit, 1px larger) + opaque surface (CornerKit)
    var wrap = document.createElement('div');
    wrap.className =
      'codex-col-img cancri-rimlight-host cancri-rimlight-host--codex';
    // Keep layout flex bits; drop inline box-shadow (CSS host rule owns it).
    var prev = surface.getAttribute('style') || '';
    wrap.setAttribute('style', prev);
    wrap.style.overflow = 'visible';
    wrap.style.position = 'relative';
    wrap.style.boxShadow = '';
    wrap.removeAttribute('data-cancri-corner');

    var rimEl = document.createElement('div');
    rimEl.className = 'cancri-rimlight';
    rimEl.setAttribute('aria-hidden', 'true');

    surface.className = 'cancri-codex-surface';
    surface.removeAttribute('style');
    surface.style.width = '100%';
    surface.style.display = 'block';
    surface.style.position = 'relative';
    surface.style.zIndex = '1';
    surface.setAttribute('data-cancri-corner', '100');

    parent.insertBefore(wrap, surface);
    wrap.appendChild(rimEl);
    wrap.appendChild(surface);

    var img = surface.querySelector('img');
    if (img) {
      img.style.borderRadius = '0';
      img.style.display = 'block';
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.position = 'relative';
      img.style.zIndex = '1';
    }

    function applyCodexCorners() {
      var r = codexRadiusFor(surface);
      ensureCornerKit(surface, r);
      // Rim is 1px larger — +1 keeps a parallel ring on both diagonals.
      ensureCornerKit(rimEl, r + 1);
      return r;
    }

    applyCodexCorners();

    var rim = new Rimlight(rimEl);
    rim.opacityGain = themeGain('codex');
    rim.resize();
    instances.push(rim);
    bindHover(wrap, rim, 'codex');

    // Image decode / resize change host size — recompute adaptive radius.
    function settleCodex() {
      applyCodexCorners();
      rim.resize();
    }
    if (img) {
      if (img.complete) {
        requestAnimationFrame(settleCodex);
      } else {
        img.addEventListener('load', settleCodex, { once: true });
      }
    }
  }

  function attachIntegrationCard(wrapper) {
    if (!(wrapper instanceof HTMLElement) || wrapper.dataset.cancriRimlight === 'true') {
      return;
    }
    if (wrapper.getAttribute('data-cancri-no-rimlight') === 'true') return;
    if (wrapper.parentElement && wrapper.parentElement.classList.contains('cancri-rimlight-host--integration')) {
      return;
    }
    wrapper.dataset.cancriRimlight = 'true';

    var parent = wrapper.parentNode;
    if (!parent) return;

    var host = document.createElement('div');
    host.className = 'cancri-rimlight-host cancri-rimlight-host--integration';

    var rimEl = document.createElement('div');
    rimEl.className = 'cancri-rimlight';
    rimEl.setAttribute('aria-hidden', 'true');

    parent.insertBefore(host, wrapper);
    host.appendChild(rimEl);
    host.appendChild(wrapper);

    ensureCornerKit(wrapper, CK_RADIUS_INTEGRATION);
    ensureCornerKit(rimEl, CK_RADIUS_INTEGRATION);

    var rim = new Rimlight(rimEl);
    rim.opacityGain = themeGain('integration');
    rim.resize();
    instances.push(rim);
    bindHover(host, rim, 'integration');
  }

  function attachPlanCard(card) {
    if (!(card instanceof HTMLElement) || card.dataset.cancriRimlight === 'true') return;
    if (card.parentElement && card.parentElement.classList.contains('cancri-rimlight-host--plan')) {
      return;
    }
    card.dataset.cancriRimlight = 'true';

    var parent = card.parentNode;
    if (!parent) return;

    var host = document.createElement('div');
    host.className = 'cancri-rimlight-host cancri-rimlight-host--plan';

    var rimEl = document.createElement('div');
    rimEl.className = 'cancri-rimlight';
    rimEl.setAttribute('aria-hidden', 'true');

    parent.insertBefore(host, card);
    host.appendChild(rimEl);
    host.appendChild(card);

    card.setAttribute('data-cancri-corner', '100');
    ensureCornerKit(card, CK_RADIUS_INTEGRATION);
    ensureCornerKit(rimEl, CK_RADIUS_INTEGRATION);

    var rim = new Rimlight(rimEl);
    rim.opacityGain = themeGain('integration');
    rim.resize();
    instances.push(rim);
    bindHover(host, rim, 'integration');
  }

  function init() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.querySelectorAll(DOWNLOAD_SEL).forEach(attachDownload);
    document.querySelectorAll(CODEX_SEL).forEach(attachCodex);
    document.querySelectorAll(INTEGRATION_CARD_SEL).forEach(attachIntegrationCard);
    document.querySelectorAll(INTEGRATION_PLAN_SEL).forEach(attachPlanCard);

    function refreshCornerKits() {
      document
        .querySelectorAll('.cancri-rimlight-host--download > .cancri-rimlight')
        .forEach(function (el) {
          ensureCornerKit(el, CK_RADIUS);
        });
      document
        .querySelectorAll('.cancri-rimlight-host--codex')
        .forEach(function (host) {
          var surface = host.querySelector(':scope > .cancri-codex-surface');
          var rimEl = host.querySelector(':scope > .cancri-rimlight');
          if (!surface || !rimEl) return;
          var r = codexRadiusFor(surface);
          ensureCornerKit(surface, r);
          ensureCornerKit(rimEl, r + 1);
        });
      document
        .querySelectorAll(
          '.cancri-rimlight-host--integration > .cancri-rimlight, .cancri-rimlight-host--plan > .cancri-rimlight'
        )
        .forEach(function (el) {
          ensureCornerKit(el, CK_RADIUS_INTEGRATION);
        });
      document
        .querySelectorAll(
          '.cancri-rimlight-host--integration > .o-integration-card__wrapper, .cancri-rimlight-host--plan > .cancri-plan-card'
        )
        .forEach(function (el) {
          ensureCornerKit(el, CK_RADIUS_INTEGRATION);
        });
    }

    function settle() {
      refreshCornerKits();
      instances.forEach(function (rim) {
        rim.resize();
      });
    }

    // Layout may not be final on DOMContentLoaded (images / flex).
    requestAnimationFrame(function () {
      settle();
      requestAnimationFrame(settle);
    });
    window.addEventListener('load', settle, { once: true });

    var layoutScheduled = false;
    function onLayout() {
      if (layoutScheduled) return;
      layoutScheduled = true;
      requestAnimationFrame(function () {
        layoutScheduled = false;
        settle();
      });
    }

    window.addEventListener('resize', onLayout, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
