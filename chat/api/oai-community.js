/* Model-page community popover. Platform assets and captions live in the HTML.
 * Hover/focus shows it and leaving hides it; clicking the trigger pins it open
 * (outside clicks no longer close it) until the trigger is clicked again or Esc. */
(function () {
  "use strict";

  // 页面里没写死结构时，按 <div data-community-mount data-asset-base="…/assets/community/"> 现场生成。
  // 结构与 api_models.html 那份一致（api_models 另带欢迎引导，仍写在 HTML 里）。
  function mountFromTemplate() {
    var mount = document.querySelector("[data-community-mount]");
    if (!mount) return null;
    var a = mount.getAttribute("data-asset-base") || "./assets/community/";
    function platform(key, name, qr, alt, desc, icon, w, h, pressed) {
      return (
        '<button type="button" class="cancri-community__platform cancri-community__platform--' + key +
        '" data-community-platform="' + key + '" data-community-qr-src="' + a + qr +
        '" data-community-qr-alt="' + alt + '" data-community-description="' + desc +
        '" aria-pressed="' + pressed + '"><span class="cancri-community__icon"><img src="' + a + icon +
        '" width="' + w + '" height="' + h + '" alt="" /></span><span>' + name + "</span></button>"
      );
    }
    var aside = document.createElement("aside");
    aside.className = "cancri-community";
    aside.setAttribute("data-community-widget", "");
    aside.setAttribute("aria-label", "NexusVAI 社区");
    aside.innerHTML =
      '<button type="button" class="cancri-community__trigger" data-community-trigger aria-label="关注 NexusVAI 社区" aria-controls="cancri-community-panel" aria-expanded="false">' +
      '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M11.335 12.0829C11.3347 9.97236 9.44966 8.16498 7 8.16498C4.55034 8.16498 2.66527 9.97236 2.66504 12.0829C2.66504 12.8512 2.90887 13.5703 3.33691 14.1796C3.4302 14.3124 3.47218 14.4744 3.4541 14.6357C3.40535 15.0677 3.31415 15.4842 3.19922 15.8876C3.66136 15.8097 4.10651 15.6986 4.54297 15.5507L4.66699 15.5214C4.79159 15.5044 4.91938 15.5237 5.03516 15.5771C5.62294 15.848 6.2901 16.0019 7 16.0019C9.44981 16.0019 11.335 14.1937 11.335 12.0829ZM17.335 7.91302C17.3348 5.80241 15.4497 3.99506 13 3.99506C11.5595 3.99506 10.298 4.62919 9.51465 5.5849C9.28182 5.86885 8.86214 5.91044 8.57812 5.67767C8.29409 5.44487 8.25257 5.0252 8.48535 4.74115C9.52649 3.47088 11.1693 2.66498 13 2.66498C16.0729 2.66498 18.6648 4.96132 18.665 7.91302C18.665 8.87524 18.3824 9.77402 17.8984 10.5458C17.9867 11.1152 18.1604 11.6766 18.3848 12.2568C18.4665 12.468 18.4355 12.7068 18.3018 12.8896C18.1681 13.0722 17.9505 13.1738 17.7246 13.1601C16.8659 13.1075 16.0585 12.9616 15.2734 12.7177C15.1054 12.786 14.9347 12.8511 14.7588 12.9042C14.4073 13.0103 14.036 12.8113 13.9297 12.4599C13.8235 12.1084 14.0226 11.7371 14.374 11.6308C14.5782 11.5691 14.7758 11.4943 14.9648 11.4072L15.084 11.3652C15.2063 11.335 15.3361 11.3398 15.457 11.3808C15.8932 11.5286 16.338 11.6398 16.7998 11.7177C16.6849 11.3144 16.5946 10.8977 16.5459 10.4658C16.5278 10.3045 16.5698 10.1425 16.6631 10.0097C17.0911 9.40042 17.335 8.68125 17.335 7.91302ZM12.665 12.0829C12.665 15.0348 10.073 17.332 7 17.332C6.19184 17.332 5.42143 17.1731 4.72266 16.8886C4.04698 17.0982 3.35521 17.2365 2.62793 17.3036L2.27539 17.33C2.04946 17.3438 1.83192 17.2422 1.69824 17.0595C1.56452 16.8767 1.53354 16.638 1.61523 16.4267L1.79297 15.9374C1.93133 15.5278 2.03737 15.1237 2.10059 14.7158C1.61678 13.944 1.33496 13.045 1.33496 12.0829C1.33519 9.13127 3.92709 6.8349 7 6.8349C10.0729 6.8349 12.6648 9.13127 12.665 12.0829Z" /></svg>' +
      "<span>社区</span></button>" +
      '<section id="cancri-community-panel" class="cancri-community__panel" aria-labelledby="cancri-community-title" data-open="false"><div class="cancri-community__card">' +
      '<h2 id="cancri-community-title" class="cancri-community__title">关注 NexusVAI</h2>' +
      '<p class="cancri-community__intro">及时获取产品动态、更新与专属福利</p>' +
      '<div class="cancri-community__platforms" role="group" aria-label="选择社区平台">' +
      platform("bilibili", "B站", "Bilibili.jpg", "B站关注二维码", "B站 · 扫一扫关注我们", "bilibili.svg", 23, 23, false) +
      platform("qq", "QQ", "QQ.jpg", "QQ 交流群二维码", "QQ · 扫一扫进群", "tencent-qq.svg", 21, 24, true) +
      platform("xiaohongshu", "小红书", "XiaoHongShu.jpg", "小红书关注二维码", "小红书 · 扫一扫关注我们", "xiaohongshu.svg", 26, 26, false) +
      "</div>" +
      '<div class="cancri-community__qr-frame"><img src="' + a + 'QQ.jpg" data-community-qr alt="QQ 交流群二维码" width="138" height="138" loading="lazy" /></div>' +
      '<p class="cancri-community__caption" data-community-caption aria-live="polite" aria-atomic="true">QQ · 扫一扫进群</p>' +
      "</div></section>";
    mount.replaceWith(aside);
    return aside;
  }

  var widget = document.querySelector("[data-community-widget]") || mountFromTemplate();
  if (!widget) return;

  var trigger = widget.querySelector("[data-community-trigger]");
  var panel = widget.querySelector("#cancri-community-panel");
  var card = widget.querySelector(".cancri-community__card");
  var image = widget.querySelector("[data-community-qr]");
  var caption = widget.querySelector("[data-community-caption]");
  var platforms = widget.querySelectorAll("[data-community-platform]");
  var tour = widget.querySelector("[data-welcome-tour]");
  var isOpen = false;
  var pinned = false;
  var restoringFocus = false;
  var preloaded = false;

  function isTourOpen() {
    return Boolean(tour && !tour.hidden);
  }

  function dismissTour() {
    if (!tour || tour.hidden) return;
    tour.hidden = true;
    try {
      localStorage.setItem("cancri-api-models-welcome-v1", "1");
    } catch (_) {}
  }

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
    if (open) {
      if (!preloaded) {
        preloaded = true;
        platforms.forEach(function (button) {
          var preload = new Image();
          preload.src = button.getAttribute("data-community-qr-src");
        });
      }
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
    if (isTourOpen()) dismissTour();
    if (isOpen && pinned) {
      setOpen(false);
    } else {
      setOpen(true);
      pinned = true;
    }
  });
  [trigger, panel].forEach(function (el) {
    if (!el) return;
    el.addEventListener("pointerenter", function (event) {
      if (isTourOpen()) return;
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
    if (isTourOpen() || !inCommunityPopover(event.target)) return;
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
