/* Live Grok card covers. Palettes and motion match the xAI mesh-gradient
 * shader (Grok 4.7 silver / 4.6 ice / 4.5 obsidian). One WebGL2 context
 * blits into every matching card thumbnail. */
(function () {
  "use strict";

  var VERT = [
    "#version 300 es",
    "precision mediump float;",
    "layout(location = 0) in vec4 a_position;",
    "uniform vec2 u_resolution;",
    "uniform float u_pixelRatio;",
    "uniform float u_originX;",
    "uniform float u_originY;",
    "uniform float u_worldWidth;",
    "uniform float u_worldHeight;",
    "uniform float u_fit;",
    "uniform float u_scale;",
    "uniform float u_rotation;",
    "uniform float u_offsetX;",
    "uniform float u_offsetY;",
    "out vec2 v_objectUV;",
    "vec3 getBoxSize(float boxRatio, vec2 givenBoxSize) {",
    "  vec2 box = vec2(0.0);",
    "  box.x = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);",
    "  if (u_fit == 1.0) {",
    "    box.x = boxRatio * min(u_resolution.x / boxRatio, u_resolution.y);",
    "  } else if (u_fit == 2.0) {",
    "    box.x = boxRatio * max(u_resolution.x / boxRatio, u_resolution.y);",
    "  }",
    "  box.y = box.x / boxRatio;",
    "  return vec3(box, box.x);",
    "}",
    "void main() {",
    "  gl_Position = a_position;",
    "  vec2 uv = gl_Position.xy * 0.5;",
    "  vec2 boxOrigin = vec2(0.5 - u_originX, u_originY - 0.5);",
    "  vec2 givenBoxSize = max(vec2(u_worldWidth, u_worldHeight), vec2(1.0)) * u_pixelRatio;",
    "  float r = u_rotation * 3.14159265358979323846 / 180.0;",
    "  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));",
    "  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);",
    "  vec2 fixedRatioBoxGivenSize = vec2(",
    "    (u_worldWidth == 0.0) ? u_resolution.x : givenBoxSize.x,",
    "    (u_worldHeight == 0.0) ? u_resolution.y : givenBoxSize.y",
    "  );",
    "  vec2 objectBoxSize = getBoxSize(1.0, fixedRatioBoxGivenSize).xy;",
    "  vec2 objectWorldScale = u_resolution.xy / objectBoxSize;",
    "  v_objectUV = uv;",
    "  v_objectUV *= objectWorldScale;",
    "  v_objectUV += boxOrigin * (objectWorldScale - 1.0);",
    "  v_objectUV += graphicOffset;",
    "  v_objectUV /= u_scale;",
    "  v_objectUV = graphicRotation * v_objectUV;",
    "}"
  ].join("\n");

  var FRAG = [
    "#version 300 es",
    "precision mediump float;",
    "uniform vec4 u_colors[10];",
    "uniform float u_colorsCount;",
    "uniform float u_positions;",
    "uniform float u_waveX;",
    "uniform float u_waveXShift;",
    "uniform float u_waveY;",
    "uniform float u_waveYShift;",
    "uniform float u_mixing;",
    "uniform float u_grainMixer;",
    "uniform float u_grainOverlay;",
    "in vec2 v_objectUV;",
    "out vec4 fragColor;",
    "#define TWO_PI 6.28318530718",
    "vec2 rotate(vec2 uv, float th) {",
    "  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;",
    "}",
    "float hash21(vec2 p) {",
    "  p = fract(p * vec2(0.3183099, 0.3678794)) + 0.1;",
    "  p += dot(p, p + 19.19);",
    "  return fract(p.x * p.y);",
    "}",
    "float valueNoise(vec2 st) {",
    "  vec2 i = floor(st);",
    "  vec2 f = fract(st);",
    "  float a = hash21(i);",
    "  float b = hash21(i + vec2(1.0, 0.0));",
    "  float c = hash21(i + vec2(0.0, 1.0));",
    "  float d = hash21(i + vec2(1.0, 1.0));",
    "  vec2 u = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);",
    "}",
    "vec2 getPosition(int i, float t) {",
    "  float a = float(i) * 0.37;",
    "  float b = 0.6 + mod(float(i), 3.0) * 0.3;",
    "  float c = 0.8 + mod(float(i + 1), 4.0) * 0.25;",
    "  float x = sin(t * b + a);",
    "  float y = cos(t * c + a * 1.5);",
    "  return 0.5 + 0.5 * vec2(x, y);",
    "}",
    "void main() {",
    "  vec2 uv = v_objectUV + 0.5;",
    "  vec2 grainUV = uv * 1000.0;",
    "  float grain = valueNoise(grainUV);",
    "  float mixerGrain = 0.4 * u_grainMixer * (grain - 0.5);",
    "  float radius = smoothstep(0.0, 1.0, length(uv - 0.5));",
    "  float center = 1.0 - radius;",
    "  for (float i = 1.0; i <= 2.0; i++) {",
    "    uv.x += u_waveX * center / i * cos(TWO_PI * u_waveXShift + i * 2.0 * smoothstep(0.0, 1.0, uv.y));",
    "    uv.y += u_waveY * center / i * cos(TWO_PI * u_waveYShift + i * 2.0 * smoothstep(0.0, 1.0, uv.x));",
    "  }",
    "  vec3 color = vec3(0.0);",
    "  float opacity = 0.0;",
    "  float totalWeight = 0.0;",
    "  float positionSeed = 25.0 + 0.33 * u_positions;",
    "  for (int i = 0; i < 10; i++) {",
    "    if (i >= int(u_colorsCount)) break;",
    "    vec2 pos = getPosition(i, positionSeed) + mixerGrain;",
    "    float dist = length(uv - pos);",
    "    vec3 colorFraction = u_colors[i].rgb * u_colors[i].a;",
    "    float opacityFraction = u_colors[i].a;",
    "    float mixing = pow(u_mixing, 0.7);",
    "    float power = mix(2.0, 1.0, mixing);",
    "    dist = pow(dist, power);",
    "    float w = 1.0 / (dist + 1e-3);",
    "    float baseSharpness = mix(0.0, 8.0, clamp(w, 0.0, 1.0));",
    "    float sharpness = mix(baseSharpness, 1.0, mixing);",
    "    w = pow(w, sharpness);",
    "    color += colorFraction * w;",
    "    opacity += opacityFraction * w;",
    "    totalWeight += w;",
    "  }",
    "  color /= max(1e-4, totalWeight);",
    "  opacity /= max(1e-4, totalWeight);",
    "  float grainOverlay = valueNoise(rotate(grainUV, 1.0) + vec2(3.0));",
    "  grainOverlay = mix(grainOverlay, valueNoise(rotate(grainUV, 2.0) + vec2(-1.0)), 0.5);",
    "  grainOverlay = pow(grainOverlay, 1.3);",
    "  float grainOverlayV = grainOverlay * 2.0 - 1.0;",
    "  vec3 grainOverlayColor = vec3(step(0.0, grainOverlayV));",
    "  float grainOverlayStrength = pow(u_grainOverlay * abs(grainOverlayV), 0.8);",
    "  color = mix(color, grainOverlayColor, 0.35 * grainOverlayStrength);",
    "  opacity = clamp(opacity + 0.5 * grainOverlayStrength, 0.0, 1.0);",
    "  fragColor = vec4(color, opacity);",
    "}"
  ].join("\n");

  var PRESETS = {
    grok47: {
      colors: ["#6E7480", "#10141A", "#2A3038", "#08090C", "#8A9098"],
      positions: 14, waveX: 0.5, waveY: 0.55, waveXShift: 0.2, waveYShift: 0.45,
      mixing: 0.6, grainMixer: 0.28, grainOverlay: 0.12, rotation: 200, scale: 1.25,
      offsetX: 0.05, offsetY: -0.08
    },
    grok46: {
      colors: ["#2A3040", "#10151F", "#EDEDED", "#050508", "#2E2745"],
      positions: 10, waveX: 0.5, waveY: 0.45, waveXShift: 0.25, waveYShift: 0.55,
      mixing: 0.55, grainMixer: 0.35, grainOverlay: 0.14, rotation: 0, scale: 1.3,
      offsetX: 0.25, offsetY: 0.1
    },
    grok45: {
      colors: ["#050505", "#000000", "#3A3A3A", "#0C0C0C", "#222222"],
      positions: 18, waveX: 0.55, waveY: 0.5, waveXShift: 0.3, waveYShift: 0.6,
      mixing: 0.65, grainMixer: 0.22, grainOverlay: 0.08, rotation: 210, scale: 1.3,
      offsetX: 0.1, offsetY: -0.05
    }
  };

  var HARMONICS = {
    positions: { amp: 11, phase: 0.2, harmonic: 1, harmonic2: 2, mix2: 0.42 },
    waveX: { amp: 0.24, phase: 1.1, harmonic: 2, useCos: true },
    waveY: { amp: 0.22, phase: 2.4, harmonic: 1, harmonic2: 3, mix2: 0.28 },
    waveXShift: { amp: 0.14, phase: 0.6, harmonic: 1, harmonic2: 2, mix2: 0.35 },
    waveYShift: { amp: 0.13, phase: 3.8, harmonic: 3, useCos: true },
    mixing: { amp: 0.18, phase: 1.85, harmonic: 1 },
    grainMixer: { amp: 0.15, phase: 4.2, harmonic: 2, harmonic2: 1, mix2: 0.3 },
    grainOverlay: { amp: 0.1, phase: 0.95, harmonic: 3 },
    rotation: { amp: 16, phase: 2.15, harmonic: 1, harmonic2: 2, mix2: 0.25 },
    scale: { amp: 0.11, phase: 5.1, harmonic: 2, useCos: true },
    offsetX: { amp: 0.15, phase: 0.4, harmonic: 1, useCos: true },
    offsetY: { amp: 0.14, phase: 1.55, harmonic: 1, harmonic2: 2, mix2: 0.32 }
  };

  var ID_PRESET = {
    "grok-4.7": "grok47",
    "grok-4.6": "grok46",
    "grok-4.6-free": "grok46",
    "grok-4.6-ide-auto": "grok46",
    "grok-4.5": "grok45",
    "grok-4.5-free": "grok45",
    "grok-4.5-xhigh": "grok45"
  };

  var glCanvas = null;
  var gl = null;
  var uniforms = null;
  var targets = [];
  var started = 0;
  var raf = 0;
  var period = 8 / 0.52;
  var PHI = 1.6180339887;

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  function hexToRgba(hex) {
    var h = hex.replace("#", "");
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
      1
    ];
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function boot() {
    if (gl) return true;
    glCanvas = document.createElement("canvas");
    glCanvas.width = 640;
    glCanvas.height = 360;
    gl = glCanvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) return false;
    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    gl.useProgram(prog);
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    uniforms = {};
    [
      "u_resolution", "u_pixelRatio", "u_originX", "u_originY", "u_worldWidth", "u_worldHeight",
      "u_fit", "u_scale", "u_rotation", "u_offsetX", "u_offsetY", "u_colors", "u_colorsCount",
      "u_positions", "u_waveX", "u_waveXShift", "u_waveY", "u_waveYShift", "u_mixing",
      "u_grainMixer", "u_grainOverlay"
    ].forEach(function (name) { uniforms[name] = gl.getUniformLocation(prog, name); });
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    return true;
  }

  function harmonic(key, m) {
    var conf = HARMONICS[key];
    if (!conf) return 0;
    function fn(harm, phase, useCos) {
      var angle = 2 * Math.PI * harm * m + phase;
      return useCos ? Math.cos(angle) : Math.sin(angle);
    }
    var val = conf.amp * fn(conf.harmonic, conf.phase, conf.useCos);
    // 第二谐波乘黄金比（无理数）：与主谐波永不同相 → 整体准周期，画面一直流动、不会「播完重来」。
    if (conf.harmonic2 != null) val += conf.amp * (conf.mix2 || 0.35) * fn(conf.harmonic2 * PHI, 1.618 * conf.phase, false);
    return val;
  }

  function hashId(id) {
    var h = 2166136261;
    for (var i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hslHex(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = ((h % 360) + 360) % 360 / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    function hex(v) {
      var n = Math.max(0, Math.min(255, Math.round((v + m) * 255)));
      return n.toString(16).padStart(2, "0");
    }
    return "#" + hex(r) + hex(g) + hex(b);
  }

  var seededPresets = {};

  function presetForId(id) {
    if (seededPresets[id]) return seededPresets[id];
    var rnd = mulberry32(hashId(id));
    var hue = rnd() * 360;
    var shift = 16 + rnd() * 48;
    var p = {
      colors: [
        hslHex(hue, 0.1 + rnd() * 0.22, 0.22 + rnd() * 0.16),
        hslHex(hue, 0.12 + rnd() * 0.28, 0.05 + rnd() * 0.07),
        hslHex(hue + shift, 0.06 + rnd() * 0.16, 0.68 + rnd() * 0.2),
        hslHex(hue, 0.04 + rnd() * 0.1, 0.02 + rnd() * 0.04),
        hslHex(hue + shift * 0.45, 0.08 + rnd() * 0.22, 0.38 + rnd() * 0.22)
      ],
      positions: 6 + rnd() * 16,
      waveX: 0.28 + rnd() * 0.48,
      waveY: 0.28 + rnd() * 0.48,
      waveXShift: rnd(),
      waveYShift: rnd(),
      mixing: 0.42 + rnd() * 0.3,
      grainMixer: 0.1 + rnd() * 0.28,
      grainOverlay: 0.05 + rnd() * 0.12,
      rotation: rnd() * 360,
      scale: 1.05 + rnd() * 0.4,
      offsetX: -0.18 + rnd() * 0.42,
      offsetY: -0.18 + rnd() * 0.42,
      speed: 0.55 + rnd() * 0.85,
      phase: rnd()
    };
    seededPresets[id] = p;
    return p;
  }

  function drawPreset(key, m) {
    var p = PRESETS[key] || presetForId(key);
    var speed = p.speed || 1;
    var phase = p.phase || 0;
    // m 是连续时间（单位：周期数），不取模 —— 以前 `% 1` 配上非整数 speed 会在每轮末尾跳帧。
    m = m * speed + phase;
    var colors = new Float32Array(40);
    for (var i = 0; i < 10; i++) {
      var rgba = i < p.colors.length ? hexToRgba(p.colors[i]) : [0, 0, 0, 1];
      colors[i * 4] = rgba[0];
      colors[i * 4 + 1] = rgba[1];
      colors[i * 4 + 2] = rgba[2];
      colors[i * 4 + 3] = rgba[3];
    }
    gl.uniform2f(uniforms.u_resolution, glCanvas.width, glCanvas.height);
    gl.uniform1f(uniforms.u_pixelRatio, 1);
    gl.uniform1f(uniforms.u_originX, 0.5);
    gl.uniform1f(uniforms.u_originY, 0.5);
    gl.uniform1f(uniforms.u_worldWidth, 0);
    gl.uniform1f(uniforms.u_worldHeight, 0);
    gl.uniform1f(uniforms.u_fit, 1);
    gl.uniform1f(uniforms.u_scale, clamp(p.scale + harmonic("scale", m), 0.5, 2.5));
    gl.uniform1f(uniforms.u_rotation, p.rotation + harmonic("rotation", m));
    gl.uniform1f(uniforms.u_offsetX, clamp(p.offsetX + harmonic("offsetX", m), -1, 1));
    gl.uniform1f(uniforms.u_offsetY, clamp(p.offsetY + harmonic("offsetY", m), -1, 1));
    gl.uniform4fv(uniforms.u_colors, colors);
    gl.uniform1f(uniforms.u_colorsCount, p.colors.length);
    gl.uniform1f(uniforms.u_positions, p.positions + harmonic("positions", m));
    gl.uniform1f(uniforms.u_waveX, clamp(p.waveX + harmonic("waveX", m), 0, 1.5));
    gl.uniform1f(uniforms.u_waveY, clamp(p.waveY + harmonic("waveY", m), 0, 1.5));
    gl.uniform1f(uniforms.u_waveXShift, ((p.waveXShift + harmonic("waveXShift", m)) % 1 + 1) % 1);
    gl.uniform1f(uniforms.u_waveYShift, ((p.waveYShift + harmonic("waveYShift", m)) % 1 + 1) % 1);
    gl.uniform1f(uniforms.u_mixing, clamp(p.mixing + harmonic("mixing", m), 0, 1));
    gl.uniform1f(uniforms.u_grainMixer, clamp(p.grainMixer + harmonic("grainMixer", m), 0, 1));
    gl.uniform1f(uniforms.u_grainOverlay, clamp(p.grainOverlay + harmonic("grainOverlay", m), 0, 1));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function ensureCanvas(host) {
    var canvas = host.querySelector(":scope > canvas.cancri-grok-fluid");
    if (canvas) return canvas;
    canvas = document.createElement("canvas");
    canvas.className = "cancri-grok-fluid";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;border-radius:inherit;";
    host.insertBefore(canvas, host.firstChild);
    return canvas;
  }

  function resize(canvas, host) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(host.clientWidth * dpr));
    var h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function presetKey(id) {
    id = String(id || "").toLowerCase();
    if (!id) return "";
    return ID_PRESET[id] || ("id:" + id);
  }

  function onScreen(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > -160 && r.top < window.innerHeight + 160 && r.right > 0 && r.left < window.innerWidth;
  }

  function pushTarget(found, id, host) {
    if (!host || host.getAttribute("data-cover") === "fixed") return;
    var preset = presetKey(id);
    if (!preset || preset === "id:") return;
    found.push({ preset: preset, canvas: ensureCanvas(host), host: host });
  }

  function collect() {
    var found = [];
    document.querySelectorAll("[data-model-id]").forEach(function (card) {
      pushTarget(found, card.getAttribute("data-model-id"), card.querySelector(".cancri-thumb"));
    });
    document.querySelectorAll("a[href^='#model-']").forEach(function (link) {
      var id = decodeURIComponent(String(link.getAttribute("href") || "").slice(7));
      pushTarget(found, id, link.querySelector(".cancri-thumb-sm"));
    });
    targets = found;
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!gl || !targets.length || document.hidden) return;
    var m = (now - started) / 1000 / period;
    var groups = {};
    for (var i = 0; i < targets.length; i++) {
      var item = targets[i];
      if (!item.host.isConnected || !onScreen(item.host)) continue;
      if (!groups[item.preset]) groups[item.preset] = [];
      groups[item.preset].push(item);
    }
    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      drawPreset(key, m);
      for (var j = 0; j < list.length; j++) {
        var card = list[j];
        if (card.host.clientWidth < 2) continue;
        resize(card.canvas, card.host);
        card.canvas.getContext("2d").drawImage(glCanvas, 0, 0, card.canvas.width, card.canvas.height);
      }
    });
  }

  function sync() {
    if (!boot()) return;
    collect();
    if (targets.length && !raf) {
      started = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  window.CancriGrokFluid = { sync: sync };
})();
