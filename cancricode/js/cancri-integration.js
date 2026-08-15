/**
 * Devin home-integration scroll morph — native-scroll port.
 * Logic mirrors HomeIntegration / HomeIntegrationDesktopCard from script_1.js.
 */
(function () {
  'use strict';

  var COL_COUNT = 7;
  var SLIDE_COUNT = 3;
  var SLIDE_SPACING = 16;
  var MQ = window.matchMedia('(max-width: 939.98px)');

  function fit(value, inMin, inMax, outMin, outMax, easeFn) {
    var t = (value - inMin) / (inMax - inMin);
    if (t <= 0) return outMin;
    if (t >= 1) return outMax;
    if (easeFn) t = easeFn(t);
    return outMin + (outMax - outMin) * t;
  }
  function saturate(v) {
    return Math.min(1, Math.max(0, v));
  }
  function mix(a, b, t) {
    return a + (b - a) * t;
  }
  function quadIn(t) {
    return t * t;
  }
  function cubicInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /** Devin ScrollPane.getDomRange equivalent for native window scroll */
  function getDomRange(el) {
    var rect = el.getBoundingClientRect();
    var vh = window.innerHeight || 1;
    var screenY = rect.top;
    var height = rect.height;
    var showScreenOffset = (vh - screenY) / vh;
    var hideScreenOffset = -(screenY + height) / vh;
    var isActive = screenY < vh && screenY + height > 0;
    return {
      screenY: screenY,
      screenX: rect.left,
      width: rect.width,
      height: height,
      showScreenOffset: showScreenOffset,
      hideScreenOffset: hideScreenOffset,
      isActive: isActive,
    };
  }

  function DesktopCard(nodeList, col, row) {
    this.domElement = nodeList[row];
    this.domWrapperElement = this.domElement.querySelector('.o-integration-card__wrapper');
    // Rimlight host wraps the wrapper — scroll transform must move BOTH together
    // or the conic rim body leaks under the card while it translates up.
    this.domMoveElement =
      (this.domWrapperElement &&
        this.domWrapperElement.closest('.cancri-rimlight-host--integration')) ||
      this.domWrapperElement;
    this.col = col;
    this.row = row;
    this.toCenterColumn = col - (COL_COUNT - 1) / 2;
    var isLast = row === nodeList.length - 1;
    this.keyIdx = isLast ? this.toCenterColumn + 1 : -1;
    if (this.keyIdx < 0 || this.keyIdx > 2) this.keyIdx = -1;
    this.isKey = this.keyIdx > -1;
    this.keyCardLeft = 0;
  }

  DesktopCard.prototype.update = function (showScreenOffset, progress) {
    var range = getDomRange(this.domElement);
    var vh = window.innerHeight;
    var midY = range.screenY + range.height * 0.5;
    var y = 0;
    var visible = progress < 1;
    var above = Math.max(0, -midY + vh * 0.5);
    y -=
      Math.pow(above / vh, 2) * vh * 0.5 +
      Math.abs(this.toCenterColumn) * Math.max(0, showScreenOffset - 1) * vh * 0.2;
    if (this.isKey) {
      y = Math.max(vh * 0.5, midY + y) - midY;
      visible = progress < 0.7;
    }
    this.domElement.style.visibility = visible ? 'visible' : 'hidden';
    var moveEl =
      (this.domWrapperElement &&
        this.domWrapperElement.closest('.cancri-rimlight-host--integration')) ||
      this.domMoveElement ||
      this.domWrapperElement;
    if (visible && moveEl) {
      moveEl.style.transform = 'translate3d(0,' + y + 'px,0)';
    } else if (moveEl) {
      moveEl.style.transform = '';
    }
    // Keep wrapper free of a conflicting translate when the host owns motion.
    if (
      this.domWrapperElement &&
      moveEl !== this.domWrapperElement &&
      this.domWrapperElement.style.transform
    ) {
      this.domWrapperElement.style.transform = '';
    }
  };

  function Integration(root) {
    this.root = root;
    this.title = root.querySelector('#home-integration__title');
    this.titleWrapper = root.querySelector('#home-integration__title-wrapper');
    this.slidesContainer = root.querySelector('#home-integration__slides');
    this.cardList = [];
    this.keyCardList = [];
    this.slideList = [];
    this.slideActiveIdx = 1;
    this.cardWidth = 0;
    this.cardHeight = 0;
    this.slideExpandedWidth = 0;
    this.slidesContainerLeft = 0;
    this.slidesContainerWidth = 0;
    this.slidesContainerHeight = 0;
    this._last = performance.now();

    var cols = root.querySelectorAll(
      '#home-integration__cards-desktop .home-integration__cards-column'
    );
    for (var c = 0; c < cols.length; c++) {
      var cards = cols[c].querySelectorAll('.o-integration-card');
      for (var r = 0; r < cards.length; r++) {
        var card = new DesktopCard(cards, c, r);
        this.cardList.push(card);
        if (card.isKey) this.keyCardList[card.keyIdx] = card;
      }
    }

    var slides = root.querySelectorAll('.home-integration__slide');
    var wrappers = root.querySelectorAll('.home-integration__slide-wrapper');
    var self = this;
    for (var i = 0; i < SLIDE_COUNT; i++) {
      (function (idx) {
        var dom = slides[idx];
        if (!dom) return;
        dom.addEventListener('mouseenter', function () {
          self.slideActiveIdx = idx;
        });
        self.slideList.push({
          activeRatio: idx === self.slideActiveIdx ? 1 : 0,
          dom: dom,
          // Rimlight may wrap the slide; size/position the host when present.
          layoutDom:
            (dom.parentElement &&
              dom.parentElement.classList.contains('cancri-rimlight-host--slide') &&
              dom.parentElement) ||
            dom,
          innerDom: dom.querySelector('.home-integration__slide-bg'),
          domWrapper: wrappers[idx],
        });
      })(i);
    }
  }

  Integration.prototype.resize = function () {
    if (!this.slidesContainer) return;
    var i = this.slidesContainer.getBoundingClientRect();
    this.slidesContainerLeft = i.left;
    this.slidesContainerWidth = i.width;
    this.slidesContainerHeight = i.height;
    var n = null;
    for (var r = 0; r < this.keyCardList.length; r++) {
      var o = this.keyCardList[r];
      if (!o) continue;
      n = o.domElement.getBoundingClientRect();
      o.keyCardLeft = n.left;
    }
    if (!n) return;
    this.cardWidth = n.width;
    this.cardHeight = n.height;
    this.slideExpandedWidth =
      this.slidesContainerWidth - (SLIDE_COUNT - 1) * (SLIDE_SPACING + this.cardWidth);
    for (var s = 0; s < this.slideList.length; s++) {
      var slide = this.slideList[s];
      if (!slide.domWrapper) continue;
      slide.domWrapper.style.width = this.slideExpandedWidth + 'px';
      slide.domWrapper.style.height = this.slidesContainerHeight + 'px';
    }
  };

  Integration.prototype.update = function (dt) {
    if (!this.root) return;
    var useMobile = MQ.matches;
    var t = getDomRange(this.root);
    var active = t.isActive;
    var desktopAnim = active && !useMobile;
    var vh = window.innerHeight || 1;
    var progress = t.showScreenOffset / (t.height / vh || 1);

    if (desktopAnim) {
      if (this.titleWrapper && this.title) {
        var titleRange = getDomRange(this.title);
        var titleY =
          Math.max(titleRange.screenY - t.screenY, titleRange.screenY) -
          titleRange.screenY +
          fit(t.showScreenOffset, 0, 1, -50, 0, quadIn);
        var titleOpacity = fit(progress, 0.5, 0.65, 1, 0);
        var titleBlur = fit(progress, 0.5, 0.65, 0, 10);
        this.titleWrapper.style.transform = 'translateY(' + titleY + 'px)';
        this.titleWrapper.style.opacity = String(titleOpacity);
        this.titleWrapper.style.visibility = titleOpacity > 0 ? 'visible' : 'hidden';
        this.titleWrapper.style.filter = 'blur(' + titleBlur + 'px)';
      }

      for (var c = 0; c < this.cardList.length; c++) {
        this.cardList[c].update(t.showScreenOffset, progress);
      }

      var showSlides = progress >= 0.7;
      if (this.slidesContainer) {
        this.slidesContainer.style.visibility = showSlides ? 'visible' : 'hidden';
      }

      if (showSlides && this.slidesContainer && this.keyCardList[0] && this.keyCardList[1]) {
        var u = getDomRange(this.slidesContainer);
        var h = fit(progress, 0.7, 0.95, 0, 1, cubicInOut);
        var m = mix(this.cardHeight, this.slidesContainerHeight, h);
        var g = -u.screenY + (vh - m) * 0.5;
        g = Math.min(g, 0);

        var pSum = 0;
        for (var i = 0; i < this.slideList.length; i++) {
          var y = this.slideList[i];
          var bgFade = fit(h, 0.35, 0.65, 1, 0);
          if (y.innerDom) y.innerDom.style.opacity = String(bgFade);
          if (y.domWrapper) {
            y.domWrapper.style.visibility = bgFade < 1 ? 'visible' : 'hidden';
          }
          var target = i === this.slideActiveIdx ? 1 : 0;
          y.activeRatio = saturate(mix(y.activeRatio, target, 1 - Math.exp(-7 * dt)));
          y.dom.classList.toggle('is-active', i === this.slideActiveIdx);
          pSum += y.activeRatio;
        }
        if (pSum <= 0) pSum = 1;

        var f = mix(
          -this.slidesContainerLeft + this.keyCardList[0].keyCardLeft,
          0,
          h
        );
        var v = mix(
          this.keyCardList[1].keyCardLeft -
            this.keyCardList[0].keyCardLeft -
            this.cardWidth,
          SLIDE_SPACING,
          h
        );

        for (var M = 0; M < this.slideList.length; M++) {
          var slide = this.slideList[M];
          var b = slide.activeRatio / pSum;
          var T = f;
          var R = mix(this.cardWidth, mix(this.cardWidth, this.slideExpandedWidth, b), h);
          var F = (SLIDE_SPACING + this.cardWidth) * M;
          var layout =
            (slide.dom.parentElement &&
              slide.dom.parentElement.classList.contains('cancri-rimlight-host--slide') &&
              slide.dom.parentElement) ||
            slide.layoutDom ||
            slide.dom;
          layout.style.transform = 'translate3d(' + T + 'px,' + g + 'px,0)';
          layout.style.width = R + 'px';
          layout.style.height = m + 'px';
          if (slide.domWrapper) {
            slide.domWrapper.style.transform = 'translate3d(' + (F - T) + 'px,0,0)';
          }
          f += R + v;
        }
      }
    } else if (active && this.titleWrapper) {
      this.titleWrapper.style.transform = 'translateZ(0)';
      this.titleWrapper.style.opacity = '1';
      this.titleWrapper.style.visibility = 'visible';
      this.titleWrapper.style.filter = 'none';
      if (this.slidesContainer) this.slidesContainer.style.visibility = 'hidden';
    }
  };

  Integration.prototype.tick = function (now) {
    var dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;
    this.update(dt);
    this._raf = requestAnimationFrame(this.tick.bind(this));
  };

  Integration.prototype.start = function () {
    this.resize();
    var self = this;
    window.addEventListener(
      'resize',
      function () {
        self.resize();
      },
      { passive: true }
    );
    MQ.addEventListener('change', function () {
      self.resize();
    });
    this._raf = requestAnimationFrame(this.tick.bind(this));
  };

  function init() {
    var root = document.querySelector(
      '[data-cancri-section="integrations"]#home-integration, #home-integration[data-cancri-section="integrations"]'
    );
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var integration = new Integration(root);
    // layout settle
    requestAnimationFrame(function () {
      integration.start();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
