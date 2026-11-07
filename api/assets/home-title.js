/* Home hero wordmark: OpenAI DevDay's "draw dots" title (DevDayHeroTitle + DrawDots), ported to vanilla JS.
 * Same DOM, CSS-module classes (api/assets/oai/pages.css), timings and per-letter hover state machine
 * (idle → playing → active → releasing). OpenAI gets letter outlines from OpenAI Sans via opentype.js;
 * we take them from our own wordmark SVG (the <img> in .devday-wordmark), one <path> per letter.
 * The SVG's <filter> (the "boil" wobble) is kept on each letter's fill. */
(function () {
  "use strict";

  var wordmark = document.querySelector("[data-devday-banner] .devday-wordmark");
  var img = wordmark && wordmark.querySelector("img");
  if (!img || !window.DOMParser || !window.fetch) return;
  // OpenAI renders no animated title at all with reduced motion; the static image stays.
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var C = {
    wrap: "_drawDotsWrap_56qia_3",
    stage: "_drawDotsStage_56qia_34",
    dots: "_drawDots_56qia_3",
    letter: "_animatedLetter_56qia_86",
    hit: "_letterHitArea_56qia_89",
    stroke: "_animatedLetterStroke_56qia_96",
    fill: "_animatedLetterFill_56qia_104",
    point: "_anchorPoint_56qia_109",
    animPoint: "_animatedAnchorPoint_56qia_113",
    animLarge: "_animatedAnchorPointLarge_56qia_166",
    animSmall: "_animatedAnchorPointSmall_56qia_174",
    hoverPoint: "_hoverAnchorPoint_56qia_205",
    hoverLarge: "_hoverAnchorPointLarge_56qia_260",
    hoverSmall: "_hoverAnchorPointSmall_56qia_267",
    colors: ["_anchorPointPurple_56qia_280", "_anchorPointGreen_56qia_284", "_anchorPointOrange_56qia_288"],
    title: "_title_1u09z_1",
  };

  // OpenAI's constants (DevDayHeroTitle.react.*.js): point stagger 35ms, stroke at +160ms, fill at +440ms,
  // letter stagger = 1100 − letterOverlap(1060) = 40ms, entrance sequence = min(1100, 40 × 6) ms,
  // hover pop 90ms, release 0.5s. Sizes are fractions of the font size; their title is 11.47cqw.
  var POINT_STAGGER = 35;
  var STROKE_DELAY = 160;
  var STROKE_PHASE = 280;
  var FILL_DELAY = 440;
  var LETTER_STAGGER = 40;
  var SEQUENCE = Math.min(1100, LETTER_STAGGER * 6);
  var POP = 90;
  var RELEASE = 501;
  var FONT_PER_WIDTH = 0.1147;
  var DOT = 0.047;
  var DOT_LARGE = 1.15;
  var DOT_SMALL = 0.7;
  var STROKE = 0.0215;
  var HIT_PAD = 0.08;
  var MIN_GAP_PER_FONT = 9 / 85.3; // 9px at the ~85px font size their title renders at
  // Second word in OpenAI green, like "DevDay" in theirs.
  var SECOND_WORD_FROM = 8; // N e x u s V A \ | D e v e l o p e r s
  var SECOND_WORD_DOT = "#04b84c";

  fetch(img.currentSrc || img.src)
    .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(String(r.status))); })
    .then(build)
    .catch(function () {});

  // ── SVG path → absolute commands ──────────────────────────────────────
  function parsePath(d) {
    var tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    var i = 0, cmd = "", out = [];
    var x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lqx = 0, lqy = 0, prev = "";
    var num = function () { return parseFloat(tokens[i++]); };
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
      var rel = cmd === cmd.toLowerCase();
      var C0 = cmd.toUpperCase();
      var ox = rel ? x : 0, oy = rel ? y : 0;
      if (C0 === "Z") { out.push({ t: "Z" }); x = sx; y = sy; prev = "Z"; continue; }
      if (C0 === "M") {
        x = ox + num(); y = oy + num(); sx = x; sy = y;
        out.push({ t: "M", x: x, y: y });
        cmd = rel ? "l" : "L"; prev = "M"; continue;
      }
      if (C0 === "L") { x = ox + num(); y = oy + num(); out.push({ t: "L", x: x, y: y }); }
      else if (C0 === "H") { x = ox + num(); out.push({ t: "L", x: x, y: y }); }
      else if (C0 === "V") { y = oy + num(); out.push({ t: "L", x: x, y: y }); }
      else if (C0 === "C" || C0 === "S") {
        var x1, y1;
        if (C0 === "C") { x1 = ox + num(); y1 = oy + num(); }
        else if (prev === "C" || prev === "S") { x1 = 2 * x - lcx; y1 = 2 * y - lcy; }
        else { x1 = x; y1 = y; }
        var x2 = ox + num(), y2 = oy + num();
        x = ox + num(); y = oy + num();
        out.push({ t: "C", x1: x1, y1: y1, x2: x2, y2: y2, x: x, y: y });
        lcx = x2; lcy = y2;
      } else if (C0 === "Q" || C0 === "T") {
        var qx, qy;
        if (C0 === "Q") { qx = ox + num(); qy = oy + num(); }
        else if (prev === "Q" || prev === "T") { qx = 2 * x - lqx; qy = 2 * y - lqy; }
        else { qx = x; qy = y; }
        x = ox + num(); y = oy + num();
        out.push({ t: "Q", x1: qx, y1: qy, x: x, y: y });
        lqx = qx; lqy = qy;
      } else {
        throw new Error("unsupported path command " + cmd); // arcs: keep the static image
      }
      prev = C0;
    }
    return out;
  }

  function matrixOf(el, root) {
    var m = [1, 0, 0, 1, 0, 0];
    for (var node = el; node && node !== root; node = node.parentNode) {
      var list = node.transform && node.transform.baseVal;
      var t = list && list.numberOfItems ? list.consolidate().matrix : null;
      if (t) m = multiply([t.a, t.b, t.c, t.d, t.e, t.f], m);
    }
    return m;
  }
  function multiply(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  }
  function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  var r2 = function (n) { return Number(n.toFixed(2)); };

  function toAbsolute(cmds, m) {
    var parts = [], pts = [];
    cmds.forEach(function (c) {
      if (c.t === "Z") { parts.push("Z"); pts.push(c); return; }
      var p = apply(m, c.x, c.y);
      if (c.t === "M" || c.t === "L") { parts.push(c.t + r2(p[0]) + " " + r2(p[1])); }
      else if (c.t === "C") {
        var a = apply(m, c.x1, c.y1), b = apply(m, c.x2, c.y2);
        parts.push("C" + r2(a[0]) + " " + r2(a[1]) + " " + r2(b[0]) + " " + r2(b[1]) + " " + r2(p[0]) + " " + r2(p[1]));
      } else {
        var q = apply(m, c.x1, c.y1);
        parts.push("Q" + r2(q[0]) + " " + r2(q[1]) + " " + r2(p[0]) + " " + r2(p[1]));
      }
      pts.push({ t: c.t, x: p[0], y: p[1] });
    });
    return { d: parts.join(""), ends: pts };
  }

  // OpenAI's anchor rule: every segment end point, skipping one closer than the gap to the last kept point.
  function anchors(ends, gap) {
    var out = [], last = null;
    ends.forEach(function (c) {
      if (c.t === "Z") return;
      if (c.t === "M") last = null;
      if (last && Math.hypot(last.x - c.x, last.y - c.y) < gap) return;
      last = { x: c.x, y: c.y };
      out.push(last);
    });
    return out;
  }

  function el(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    return node;
  }

  // ── build ─────────────────────────────────────────────────────────────
  function build(text) {
    var src = new DOMParser().parseFromString(text, "image/svg+xml").documentElement;
    if (!src || src.nodeName.toLowerCase() !== "svg") return;
    var vb = (src.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some(isNaN)) return;
    var width = vb[2];
    var font = width * FONT_PER_WIDTH;
    var rLarge = r2(font * DOT * DOT_LARGE), rSmall = r2(font * DOT * DOT_SMALL);
    var gap = font * MIN_GAP_PER_FONT, pad = font * HIT_PAD;

    var letters;
    try {
      letters = Array.prototype.map.call(src.querySelectorAll("path"), function (p) {
        var abs = toAbsolute(parsePath(p.getAttribute("d") || ""), matrixOf(p, src));
        return { d: abs.d, points: anchors(abs.ends, gap) };
      });
    } catch (e) {
      return;
    }
    if (!letters.length) return;

    var uid = "nvd-title-" + Math.random().toString(36).slice(2, 8);
    var svg = el("svg", { class: C.dots, viewBox: vb.join(" "), "aria-hidden": "true" });
    svg.style.cssText = "left:0;top:0;width:100%;height:100%;--draw-dots-stroke-width:" + r2(font * STROKE);
    var defs = el("defs", {});
    svg.appendChild(defs);

    var filterId = null;
    var srcFilter = src.querySelector("filter");
    if (srcFilter) {
      var f = document.importNode(srcFilter, true);
      filterId = uid + "-boil";
      f.setAttribute("id", filterId);
      // Per-letter region: wide enough for the displacement on narrow glyphs (the source sized it for the whole word).
      f.setAttribute("x", "-30%"); f.setAttribute("y", "-15%");
      f.setAttribute("width", "160%"); f.setAttribute("height", "130%");
      defs.appendChild(f);
    }

    var wrap = document.createElement("span");
    wrap.className = C.wrap;
    wrap.setAttribute("data-animate", "true");
    wrap.setAttribute("data-animation-paused", "true");
    wrap.setAttribute("data-animate-on-hover", "true");
    wrap.setAttribute("data-fit", "true");
    wrap.setAttribute("data-dot-color", "true");
    wrap.style.cssText = "height:100%;--draw-dots-dot-color:currentColor;--draw-dots-outline-color:currentColor;--draw-dots-text-color:currentColor;--draw-dots-point-sequence-duration:" + SEQUENCE + "ms";
    var stage = document.createElement("span");
    stage.className = C.stage;
    stage.style.height = "100%";
    var title = document.createElement("span");
    title.className = C.title;
    title.setAttribute("aria-hidden", "true");
    stage.appendChild(svg);
    wrap.appendChild(stage);
    title.appendChild(wrap);
    wordmark.appendChild(title);

    // Measure in place (the title is visibility:hidden until rendered), then order letters left → right.
    letters.forEach(function (L) {
      var probe = el("path", { d: L.d });
      svg.appendChild(probe);
      var b = probe.getBBox();
      L.bbox = { x: b.x, y: b.y, w: b.width, h: b.height };
      probe.remove();
    });
    letters.sort(function (a, b) { return a.bbox.x - b.bbox.x; });

    var offset = 0;
    letters.forEach(function (L, i) {
      L.id = uid + "-l" + i;
      L.index = i;
      var g = el("g", { class: C.letter });
      if (i >= SECOND_WORD_FROM) g.style.setProperty("--draw-dots-dot-color", SECOND_WORD_DOT);
      var clip = el("clipPath", { id: L.id });
      clip.appendChild(el("path", { d: L.d }));
      defs.appendChild(clip);
      var stroke = el("path", { class: C.stroke, "clip-path": "url(#" + L.id + ")", d: L.d });
      stroke.style.animationDelay = i * LETTER_STAGGER + STROKE_DELAY + "ms";
      var fill = el("path", { class: C.fill, d: L.d, filter: filterId ? "url(#" + filterId + ")" : null });
      fill.style.animationDelay = i * LETTER_STAGGER + FILL_DELAY + "ms";
      g.appendChild(stroke);
      g.appendChild(fill);
      L.points.forEach(function (p, n) {
        var color = C.colors[(offset + n) % C.colors.length];
        var dot = el("g", {});
        var entranceDelay = "--draw-dots-point-delay:" + (i * LETTER_STAGGER + n * POINT_STAGGER) + "ms";
        var hoverDelay = "--draw-dots-point-delay:" + n * POINT_STAGGER + "ms";
        [
          [[C.point, C.animPoint, C.animLarge, color], entranceDelay, rLarge],
          [[C.point, C.animPoint, C.animSmall, color], entranceDelay, rSmall],
          [[C.point, C.hoverPoint, C.hoverLarge, color], hoverDelay, rLarge],
          [[C.point, C.hoverPoint, C.hoverSmall, color], hoverDelay, rSmall],
        ].forEach(function (spec) {
          var c = el("circle", { class: spec[0].join(" "), cx: r2(p.x), cy: r2(p.y), r: spec[2] });
          c.setAttribute("style", spec[1]);
          dot.appendChild(c);
        });
        g.appendChild(dot);
      });
      offset += L.points.length;
      L.hit = { x1: L.bbox.x - pad, y1: L.bbox.y - pad, x2: L.bbox.x + L.bbox.w + pad, y2: L.bbox.y + L.bbox.h + pad };
      g.appendChild(el("rect", {
        "aria-hidden": "true", class: C.hit,
        x: r2(L.hit.x1), y: r2(L.hit.y1), width: r2(L.hit.x2 - L.hit.x1), height: r2(L.hit.y2 - L.hit.y1),
      }));
      L.g = g;
      svg.appendChild(g);
    });

    wireHover(svg, letters);
    wrap.setAttribute("data-rendered", "true");

    // Entrance: OpenAI starts the title together with the DevDay agent; we have no agent, so start on view.
    var start = function () {
      wrap.removeAttribute("data-animation-paused");
      var total = letters.reduce(function (acc, L) {
        var base = L.index * LETTER_STAGGER;
        return Math.max(acc, base + STROKE_DELAY + STROKE_PHASE, base + Math.max(0, L.points.length - 1) * POINT_STAGGER + SEQUENCE);
      }, 0) + 50;
      setTimeout(function () { wrap.setAttribute("data-animation-complete", "true"); }, total);
    };
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); requestAnimationFrame(start); }
      });
      io.observe(wordmark);
    } else {
      start();
    }
  }

  // ── Hover: per-letter state machine (OpenAI's Ze / Qe / Xe) ───────────
  function wireHover(svg, letters) {
    var state = {}, timers = {};
    var hoverEnabled = function () { return svg.closest("[data-animation-complete]") != null; };
    var playMs = function (L) { return Math.max(0, L.points.length - 1) * POINT_STAGGER + 1 + POP; };
    var clear = function (L) { if (timers[L.id] !== undefined) { clearTimeout(timers[L.id]); delete timers[L.id]; } };
    var set = function (L, phase, hovered) {
      state[L.id] = { phase: phase, hovered: hovered };
      if (phase === "idle") L.g.removeAttribute("data-hover-state");
      else L.g.setAttribute("data-hover-state", phase);
    };
    var release = function (L) {
      clear(L);
      set(L, "releasing", false);
      timers[L.id] = setTimeout(function () { clear(L); set(L, "idle", false); }, RELEASE + playMs(L));
    };
    var enter = function (L) {
      var s = state[L.id] || { phase: "idle", hovered: false };
      state[L.id] = { phase: s.phase, hovered: true };
      if (s.phase !== "idle") return;
      clear(L);
      set(L, "playing", true);
      timers[L.id] = setTimeout(function () {
        clear(L);
        var now = state[L.id];
        if (!now || now.phase !== "playing") return;
        if (now.hovered) set(L, "active", true);
        else release(L);
      }, playMs(L));
    };
    var leave = function (L) {
      var s = state[L.id] || { phase: "idle", hovered: false };
      state[L.id] = { phase: s.phase, hovered: false };
      if (s.phase === "active") release(L);
    };

    letters.forEach(function (L) {
      L.g.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse" && hoverEnabled()) enter(L); });
      L.g.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && hoverEnabled()) leave(L); });
    });

    // Touch / pen: press and scrub across letters.
    var current = null, pointer = null;
    var letterAt = function (e) {
      var m = svg.getScreenCTM();
      if (!m) return null;
      var pt = svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      var p = pt.matrixTransform(m.inverse());
      for (var i = letters.length - 1; i >= 0; i--) {
        var h = letters[i].hit;
        if (p.x >= h.x1 && p.x <= h.x2 && p.y >= h.y1 && p.y <= h.y2) return letters[i];
      }
      return null;
    };
    var focus = function (L) {
      if (current === L) return;
      if (current) leave(current);
      current = L;
      if (L) enter(L);
    };
    var end = function (e) {
      if (pointer !== e.pointerId) return;
      if (svg.hasPointerCapture && svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      pointer = null;
      focus(null);
    };
    svg.addEventListener("pointerdown", function (e) {
      if ((e.pointerType !== "touch" && e.pointerType !== "pen") || !hoverEnabled()) return;
      pointer = e.pointerId;
      svg.setPointerCapture(e.pointerId);
      e.preventDefault();
      focus(letterAt(e));
    });
    svg.addEventListener("pointermove", function (e) {
      if (pointer !== e.pointerId) return;
      e.preventDefault();
      focus(letterAt(e));
    });
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    svg.addEventListener("lostpointercapture", end);
  }
})();
