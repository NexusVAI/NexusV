/**
 * Liquid glass (from cancri-code/src/ui/liquid-glass-surface.ts)
 * Chromium: backdrop-filter blur + SVG edge refraction / light RGB dispersion.
 * Fallback: frosted blur only (.cancri-glass-refract omitted).
 */
(function () {
  'use strict';

  var SVG_HOST_ID = 'cc-lg-defs';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var GLASS_BEZEL_PX = 20;
  var DISPLACE_SCALE = 26;
  var DISPERSION_RATIO = 0.07;
  var CHANNEL_EXTRACT = {
    R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
    G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
    B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'
  };

  /** @type {Map<string, {filter: SVGFilterElement, feImage: SVGFEImageElement, geometryKey: string}>} */
  var filters = new Map();

  function glassFilterId(key) {
    return 'cc-lg-' + key;
  }

  function detectLiquidGlassSupport() {
    try {
      if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
      var probe = 'url(#' + glassFilterId('nav-desktop') + ')';
      return (
        CSS.supports('backdrop-filter', probe) ||
        CSS.supports('-webkit-backdrop-filter', probe)
      );
    } catch (e) {
      return false;
    }
  }

  function buildDisplacementMap(width, height, cornerRadius, bezel) {
    bezel = bezel == null ? GLASS_BEZEL_PX : bezel;
    var w = Math.max(1, Math.round(width));
    var h = Math.max(1, Math.round(height));
    var r = Math.max(0, Math.min(cornerRadius, Math.min(w, h) / 2));
    var out = new Uint8ClampedArray(w * h * 4);
    var cx = w / 2;
    var cy = h / 2;
    var halfW = w / 2 - r;
    var halfH = h / 2 - r;
    var x;
    var y;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        var px = x + 0.5 - cx;
        var py = y + 0.5 - cy;
        var qx = Math.abs(px) - halfW;
        var qy = Math.abs(py) - halfH;
        var ox = Math.max(qx, 0);
        var oy = Math.max(qy, 0);
        var sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
        var depth = -sdf;
        var dr = 128;
        var dg = 128;

        if (depth < bezel) {
          var nx;
          var ny;
          if (qx > 0 && qy > 0) {
            var len = Math.hypot(qx, qy) || 1;
            nx = (qx / len) * Math.sign(px);
            ny = (qy / len) * Math.sign(py);
          } else if (qx > qy) {
            nx = Math.sign(px);
            ny = 0;
          } else {
            nx = 0;
            ny = Math.sign(py);
          }
          var t = 1 - Math.max(depth, 0) / bezel;
          var strength = t * t;
          dr = 128 + nx * strength * 127;
          dg = 128 + ny * strength * 127;
        }

        var i = (y * w + x) * 4;
        out[i] = dr;
        out[i + 1] = dg;
        out[i + 2] = 128;
        out[i + 3] = 255;
      }
    }
    return out;
  }

  function pixelsToDataUrl(pixels, width, height) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      var ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  function ensureSvgDefs() {
    var existing = document.getElementById(SVG_HOST_ID);
    if (existing) {
      var defs = existing.querySelector('defs');
      if (defs) return defs;
      existing.remove();
    }
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = SVG_HOST_ID;
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.left = '-9999px';
    svg.style.top = '0';
    var defsEl = document.createElementNS(SVG_NS, 'defs');
    svg.appendChild(defsEl);
    document.body.appendChild(svg);
    return defsEl;
  }

  function ensureFilter(key) {
    var cached = filters.get(key);
    if (cached && cached.filter.isConnected) return cached;

    var defs = ensureSvgDefs();
    if (!defs) return null;

    var filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = glassFilterId(key);
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');

    var feImage = document.createElementNS(SVG_NS, 'feImage');
    feImage.setAttribute('x', '0');
    feImage.setAttribute('y', '0');
    feImage.setAttribute('preserveAspectRatio', 'none');
    feImage.setAttribute('result', 'map');
    filter.appendChild(feImage);

    var channels = [
      { name: 'R', scaleFactor: 1 - DISPERSION_RATIO, matrix: CHANNEL_EXTRACT.R },
      { name: 'G', scaleFactor: 1, matrix: CHANNEL_EXTRACT.G },
      { name: 'B', scaleFactor: 1 + DISPERSION_RATIO, matrix: CHANNEL_EXTRACT.B }
    ];
    var c;
    for (c = 0; c < channels.length; c++) {
      var ch = channels[c];
      var disp = document.createElementNS(SVG_NS, 'feDisplacementMap');
      disp.setAttribute('in', 'SourceGraphic');
      disp.setAttribute('in2', 'map');
      disp.setAttribute('scale', String(DISPLACE_SCALE * ch.scaleFactor));
      disp.setAttribute('xChannelSelector', 'R');
      disp.setAttribute('yChannelSelector', 'G');
      disp.setAttribute('result', 'disp' + ch.name);
      filter.appendChild(disp);

      var cm = document.createElementNS(SVG_NS, 'feColorMatrix');
      cm.setAttribute('in', 'disp' + ch.name);
      cm.setAttribute('type', 'matrix');
      cm.setAttribute('values', ch.matrix);
      cm.setAttribute('result', 'ch' + ch.name);
      filter.appendChild(cm);
    }

    var addRG = document.createElementNS(SVG_NS, 'feComposite');
    addRG.setAttribute('in', 'chR');
    addRG.setAttribute('in2', 'chG');
    addRG.setAttribute('operator', 'arithmetic');
    addRG.setAttribute('k1', '0');
    addRG.setAttribute('k2', '1');
    addRG.setAttribute('k3', '1');
    addRG.setAttribute('k4', '0');
    addRG.setAttribute('result', 'chRG');
    filter.appendChild(addRG);

    var addRGB = document.createElementNS(SVG_NS, 'feComposite');
    addRGB.setAttribute('in', 'chRG');
    addRGB.setAttribute('in2', 'chB');
    addRGB.setAttribute('operator', 'arithmetic');
    addRGB.setAttribute('k1', '0');
    addRGB.setAttribute('k2', '1');
    addRGB.setAttribute('k3', '1');
    addRGB.setAttribute('k4', '0');
    addRGB.setAttribute('result', 'chRGB');
    filter.appendChild(addRGB);

    var restoreAlpha = document.createElementNS(SVG_NS, 'feComposite');
    restoreAlpha.setAttribute('in', 'chRGB');
    restoreAlpha.setAttribute('in2', 'dispG');
    restoreAlpha.setAttribute('operator', 'in');
    filter.appendChild(restoreAlpha);

    defs.appendChild(filter);
    var entry = { filter: filter, feImage: feImage, geometryKey: '' };
    filters.set(key, entry);
    return entry;
  }

  function syncGlassFilterGeometry(surface, cssWidth, cssHeight, cornerRadius) {
    var w = Math.max(1, Math.round(cssWidth));
    var h = Math.max(1, Math.round(cssHeight));
    var geometryKey = w + 'x' + h + 'r' + cornerRadius;
    var entry = ensureFilter(surface);
    if (!entry) return;
    if (entry.geometryKey === geometryKey) return;

    var pixels = buildDisplacementMap(w, h, cornerRadius);
    var dataUrl = pixelsToDataUrl(pixels, w, h);
    if (!dataUrl) return;

    entry.filter.setAttribute('width', String(w));
    entry.filter.setAttribute('height', String(h));
    entry.feImage.setAttribute('width', String(w));
    entry.feImage.setAttribute('height', String(h));
    entry.feImage.setAttribute('href', dataUrl);
    entry.feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl);
    entry.geometryKey = geometryKey;
  }

  function readCornerRadius(el) {
    var cs = window.getComputedStyle(el);
    var tl = parseFloat(cs.borderTopLeftRadius) || 0;
    return Math.max(0, tl);
  }

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  }

  function menuIsOpen(nav) {
    return !!(nav && nav.querySelector('.w-nav-button.w--open'));
  }

  /* Shared: menu clip-path + CTA morph must not fight glass compositing */
  var menuBusy = false;
  var menuBusyTimer = 0;
  var MENU_CLOSE_HOLD_MS = 480;

  function setMenuBusy(on) {
    menuBusy = !!on;
    document.documentElement.classList.toggle('cancri-nav-menu-busy', menuBusy);
  }

  function initMenuPerfGuard() {
    var buttons = document.querySelectorAll('.nav_btn_wrap.w-nav-button');
    if (!buttons.length || typeof MutationObserver === 'undefined') return;

    function anyOpen() {
      for (var i = 0; i < buttons.length; i++) {
        if (buttons[i].classList.contains('w--open')) return true;
      }
      return false;
    }

    function publish() {
      document.dispatchEvent(
        new CustomEvent('cancri:navmenu', { detail: { busy: menuBusy } })
      );
    }

    function onMenuClassChange() {
      if (anyOpen()) {
        if (menuBusyTimer) {
          window.clearTimeout(menuBusyTimer);
          menuBusyTimer = 0;
        }
        setMenuBusy(true);
        publish();
        return;
      }
      /* Keep busy through close animation, then restore glass/CTA */
      setMenuBusy(true);
      publish();
      if (menuBusyTimer) window.clearTimeout(menuBusyTimer);
      menuBusyTimer = window.setTimeout(function () {
        menuBusyTimer = 0;
        setMenuBusy(false);
        publish();
      }, MENU_CLOSE_HOLD_MS);
    }

    buttons.forEach(function (btn) {
      new MutationObserver(onMenuClassChange).observe(btn, {
        attributes: true,
        attributeFilter: ['class']
      });
    });
  }

  function attachNavGlass(el, key) {
    if (!(el instanceof HTMLElement) || el.dataset.cancriLiquidGlass === 'true') return;
    el.dataset.cancriLiquidGlass = 'true';
    el.classList.add('cancri-glass-active');

    var supported = detectLiquidGlassSupport();
    var syncTimer = 0;
    var morphing = false;

    function setRefract(on) {
      if (!supported) return;
      if (
        on &&
        isVisible(el) &&
        !menuIsOpen(el) &&
        !menuBusy &&
        !morphing
      ) {
        el.classList.add('cancri-glass-refract');
      } else {
        el.classList.remove('cancri-glass-refract');
      }
    }

    function sync() {
      if (
        !supported ||
        !isVisible(el) ||
        menuIsOpen(el) ||
        menuBusy ||
        morphing
      ) {
        setRefract(false);
        return;
      }
      var r = el.getBoundingClientRect();
      /* Pill radius: use half-height so displacement matches capsule */
      var radius = readCornerRadius(el);
      if (radius > r.height) radius = r.height / 2;
      syncGlassFilterGeometry(key, r.width, r.height, radius);
      setRefract(true);
    }

    function syncDebounced() {
      if (syncTimer) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(function () {
        syncTimer = 0;
        sync();
      }, 120);
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(sync);
    });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(function () {
        if (menuBusy || morphing) return;
        syncDebounced();
      }).observe(el);
    }
    window.addEventListener(
      'resize',
      function () {
        if (menuBusy || morphing) return;
        syncDebounced();
      },
      { passive: true }
    );
    document.addEventListener('cancri:themechange', syncDebounced);

    /* During capsule morph: drop expensive SVG filter, restore once at end */
    document.addEventListener('cancri:navscroll', function () {
      morphing = true;
      setRefract(false);
      window.setTimeout(function () {
        morphing = false;
        if (!menuBusy) sync();
      }, 580);
    });

    el.addEventListener(
      'transitionend',
      function (e) {
        if (
          e.target === el &&
          (e.propertyName === 'border-radius' ||
            e.propertyName === 'width' ||
            e.propertyName === 'max-width')
        ) {
          morphing = false;
          if (!menuBusy) sync();
        }
      },
      false
    );

    document.addEventListener('cancri:navmenu', function (e) {
      if (e.detail && e.detail.busy) {
        setRefract(false);
        return;
      }
      /* Wait for CTA morph before rebuilding SVG refraction */
      window.setTimeout(function () {
        if (!menuBusy) sync();
      }, 560);
    });
  }

  function initCapsuleCta() {
    document.querySelectorAll('.nav_btn_wrap.w-nav-button').forEach(function (btn) {
      if (!(btn instanceof HTMLElement) || btn.dataset.cancriCapsuleCta === 'true') return;
      btn.dataset.cancriCapsuleCta = 'true';
      btn.classList.add('cancri-nav-capsule-cta');

      if (!btn.querySelector('.cancri-nav-capsule-cta__label')) {
        var label = document.createElement('span');
        label.className = 'cancri-nav-capsule-cta__label';
        label.textContent = '试试 Cancri Code';
        label.setAttribute('aria-hidden', 'true');
        btn.appendChild(label);
      }

      function syncAria() {
        var scrolled = document.documentElement.classList.contains('cancri-nav-scrolled');
        var open = btn.classList.contains('w--open');
        if (scrolled && !open) {
          btn.setAttribute('aria-label', '试试 Cancri Code');
          btn.setAttribute('role', 'link');
        } else {
          btn.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
          btn.removeAttribute('role');
        }
      }

      syncAria();
      document.addEventListener('cancri:navscroll', syncAria);
      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(syncAria).observe(btn, {
          attributes: true,
          attributeFilter: ['class']
        });
      }

      btn.addEventListener(
        'click',
        function (e) {
          var scrolled = document.documentElement.classList.contains('cancri-nav-scrolled');
          var open = btn.classList.contains('w--open');
          if (!scrolled || open) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          var target = document.getElementById('downloads');
          if (target) {
            var nav = document.querySelector('.nav_wrap');
            var offset = nav ? nav.getBoundingClientRect().height + 16 : 72;
            var y =
              target.getBoundingClientRect().top + (window.scrollY || 0) - offset;
            window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
          } else {
            window.location.hash = 'downloads';
          }
        },
        true
      );
    });
  }

  function init() {
    initMenuPerfGuard();
    attachNavGlass(document.querySelector('.nav_wrap.is-desktop'), 'nav-desktop');
    attachNavGlass(document.querySelector('.nav_wrap.is-mobile'), 'nav-mobile');
    if (!document.querySelector('.nav_wrap.cancri-glass-active')) {
      var first = document.querySelector('.nav_wrap');
      if (first) attachNavGlass(first, 'nav-desktop');
    }
    initCapsuleCta();
  }

  window.CancriLiquidGlass = {
    detect: detectLiquidGlassSupport,
    sync: syncGlassFilterGeometry
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
