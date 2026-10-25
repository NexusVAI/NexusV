/* Bottom-right community popover (B站 / QQ / 小红书). Platform assets and captions live in index.html.
 * Ported from A.CancriCode/GitHub chat/api/oai-community.js (api_models page), minus the welcome tour.
 * Hover/focus shows it and leaving hides it; clicking the trigger pins it open
 * (outside clicks no longer close it) until the trigger is clicked again or Esc. */
(function () {
  "use strict";

  var widget = document.querySelector("[data-community-widget]");
  if (!widget) return;

  var trigger = widget.querySelector("[data-community-trigger]");
  var panel = widget.querySelector("#cancri-community-panel");
  var card = widget.querySelector(".cancri-community__card");
  var image = widget.querySelector("[data-community-qr]");
  var caption = widget.querySelector("[data-community-caption]");
  var platforms = widget.querySelectorAll("[data-community-platform]");
  var isOpen = false;
  var pinned = false;
  var restoringFocus = false;
  var preloaded = false;

  function inCommunityPopover(node) {
    return Boolean(node && (trigger.contains(node) || panel.contains(node)));
  }

  function hasPopoverFocusVisible() {
    return Boolean(
      trigger.matches(":focus-visible") || panel.querySelector(":focus-visible")
    );
  }

  // ── Apple corners: the Bezier construction from cancri-code src/ui/squircle-path.ts ──
  // A circular arc in the middle of each corner, joined to the straight edges by two cubic
  // Beziers (zero curvature -> 1/r). p = (1+s)*r is the edge length one corner consumes;
  // s = 0.6 is iOS / Figma 60% smoothing. Applied as clip-path; border-radius in the CSS is
  // the fallback and is zeroed by .sq-active so the background fills the whole curve.
  //
  // Proportion is what makes it read as a squircle, not the radius alone:
  // · Mid-size squares (QR frame) use the iOS app-icon ratio r = 22.37% of the side,
  //   s = 0.6 -> p ~ 36% of the side, ~28% of each edge stays straight.
  // · Small squares (<= 48px: trigger, platform icons) can't show that ratio: at 48px,
  //   r 11 / s 0.6 differs from a plain 11px radius by ~15px^2 over all four corners,
  //   invisible at 1x. They use s = 1 with p = side/2 exactly (r = side/4): no arc, the
  //   edges bulge, and it reads as a squircle. A larger r is clamped to the same shape.
  // · The card is too large for the icon ratio, so it gets a long all-Bezier corner
  //   (s = 1, no arc, p = 64); at r 24 / s 0.6 it read as a plain rounded rect.
  // · The QR image is concentric with its frame: 35 - 10px frame padding.
  var CORNERS = [
    [trigger, 12, 1],
    [card, 32, 1],
    [widget.querySelector(".cancri-community__qr-frame"), 35, 0.6],
    [image, 25, 0.6]
  ];
  widget.querySelectorAll(".cancri-community__icon").forEach(function (icon) {
    CORNERS.push([icon, 11, 1]);
  });

  function toRad(deg) { return (deg * Math.PI) / 180; }
  function r2(n) { return Math.round(n * 100) / 100; }

  function cornerParams(radius, smoothing, budget) {
    var r = Math.max(0, Math.min(radius, budget));
    var s = Math.max(0, Math.min(1, smoothing));
    var arcMeasure = 90 * (1 - s);
    var arc = Math.sin(toRad(arcMeasure / 2)) * r * Math.SQRT2;
    var angleAlpha = (90 - arcMeasure) / 2;
    var p3ToP4 = r * Math.tan(toRad(angleAlpha / 2));
    var angleBeta = 45 * s;
    var c = p3ToP4 * Math.cos(toRad(angleBeta));
    var d = c * Math.tan(toRad(angleBeta));
    var p = (1 + s) * r;
    var b = (p - arc - c - d) / 3;
    var a = 2 * b;
    // Not enough room: scale everything so the S-shaped transition keeps its proportions.
    var k = p > budget ? budget / p : 1;
    return { p: p * k, radius: r * k, arc: arc * k, a: a * k, b: b * k, c: c * k, d: d * k };
  }

  function squirclePath(w, h, radius, smoothing) {
    var k = cornerParams(radius, smoothing, Math.min(w, h) / 2);
    var p = k.p, a = k.a, b = k.b, c = k.c, d = k.d, arc = k.arc;
    var rr = r2(k.radius);
    var hasArc = arc > 0.01;
    var arcCmd = "a " + rr + " " + rr + " 0 0 1 ";
    return [
      "M " + r2(w - p) + ",0",
      "c " + r2(a) + ",0 " + r2(a + b) + ",0 " + r2(a + b + c) + "," + r2(d),
      hasArc ? arcCmd + r2(arc) + "," + r2(arc) : "",
      "c " + r2(d) + "," + r2(c) + " " + r2(d) + "," + r2(b + c) + " " + r2(d) + "," + r2(a + b + c),
      "L " + r2(w) + "," + r2(h - p),
      "c 0," + r2(a) + " 0," + r2(a + b) + " " + r2(-d) + "," + r2(a + b + c),
      hasArc ? arcCmd + r2(-arc) + "," + r2(arc) : "",
      "c " + r2(-c) + "," + r2(d) + " " + r2(-b - c) + "," + r2(d) + " " + r2(-a - b - c) + "," + r2(d),
      "L " + r2(p) + "," + r2(h),
      "c " + r2(-a) + ",0 " + r2(-a - b) + ",0 " + r2(-a - b - c) + "," + r2(-d),
      hasArc ? arcCmd + r2(-arc) + "," + r2(-arc) : "",
      "c " + r2(-d) + "," + r2(-c) + " " + r2(-d) + "," + r2(-b - c) + " " + r2(-d) + "," + r2(-a - b - c),
      "L 0," + r2(p),
      "c 0," + r2(-a) + " 0," + r2(-a - b) + " " + r2(d) + "," + r2(-a - b - c),
      hasArc ? arcCmd + r2(arc) + "," + r2(-arc) : "",
      "c " + r2(c) + "," + r2(-d) + " " + r2(b + c) + "," + r2(-d) + " " + r2(a + b + c) + "," + r2(-d),
      "Z"
    ].filter(Boolean).join(" ");
  }

  function applySquircle(el, corner, w, h) {
    if (!el || w < 1 || h < 1) return;
    el.style.clipPath = 'path("' + squirclePath(r2(w), r2(h), corner[0], corner[1]) + '")';
    el.classList.add("sq-active");
  }

  // Fractional layout-box sizes (unaffected by the pressed icon's translateY); the observer
  // fires once on observe() and again on every resize, so no other call site is needed.
  if (window.ResizeObserver && window.CSS && CSS.supports("clip-path", 'path("M 0,0 Z")')) {
    var cornerOf = new Map(CORNERS.map(function (entry) { return [entry[0], entry.slice(1)]; }));
    var ro = new ResizeObserver(function (entries) {
      entries.forEach(function (entry) {
        var box = entry.borderBoxSize && entry.borderBoxSize[0];
        var el = entry.target;
        if (box) applySquircle(el, cornerOf.get(el), box.inlineSize, box.blockSize);
        else applySquircle(el, cornerOf.get(el), el.offsetWidth, el.offsetHeight);
      });
    });
    CORNERS.forEach(function (entry) {
      if (entry[0]) ro.observe(entry[0], { box: "border-box" });
    });
  }

  function setOpen(open, returnFocus) {
    isOpen = open;
    if (!open) pinned = false;
    panel.setAttribute("data-open", String(open));
    trigger.setAttribute("aria-expanded", String(open));
    if (open && !preloaded) {
      preloaded = true;
      platforms.forEach(function (button) {
        var preload = new Image();
        preload.src = button.getAttribute("data-community-qr-src");
      });
    }
    if (!open && returnFocus) {
      // Escape returns focus without immediately reopening via focusin.
      restoringFocus = true;
      trigger.focus({ preventScroll: true });
      restoringFocus = false;
    }
  }

  function selectPlatform(button) {
    platforms.forEach(function (platform) {
      platform.setAttribute("aria-pressed", String(platform === button));
    });
    image.src = button.getAttribute("data-community-qr-src");
    image.alt = button.getAttribute("data-community-qr-alt");
    caption.textContent = button.getAttribute("data-community-description");
  }

  trigger.addEventListener("click", function () {
    if (isOpen && pinned) {
      setOpen(false);
    } else {
      setOpen(true);
      pinned = true;
    }
  });
  [trigger, panel].forEach(function (el) {
    el.addEventListener("pointerenter", function (event) {
      if (event.pointerType === "mouse" || event.pointerType === "pen") setOpen(true);
    });
    el.addEventListener("pointerleave", function (event) {
      // Touch ends with pointerleave before click; hiding here would cancel the tap.
      if (event.pointerType === "touch" || pinned) return;
      if (inCommunityPopover(event.relatedTarget)) return;
      if (!hasPopoverFocusVisible()) setOpen(false);
    });
  });
  widget.addEventListener("focusin", function (event) {
    if (!inCommunityPopover(event.target)) return;
    if (!restoringFocus && event.target.matches(":focus-visible")) setOpen(true);
  });
  widget.addEventListener("focusout", function (event) {
    if (!inCommunityPopover(event.target)) return;
    if (!pinned && !inCommunityPopover(event.relatedTarget)) setOpen(false);
  });
  platforms.forEach(function (button) {
    button.addEventListener("pointerenter", function (event) {
      if (event.pointerType !== "touch") selectPlatform(button);
    });
    button.addEventListener("focus", function () { selectPlatform(button); });
    button.addEventListener("click", function () { selectPlatform(button); });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
})();
