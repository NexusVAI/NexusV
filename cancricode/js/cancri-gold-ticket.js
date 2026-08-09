/**
 * Original Cloudflare Wallet golden ticket port (WebGL shader + card CSS).
 * Seed / palette / foil math mirrored from cloudflare-pay bundle.
 * Share copies a real html2canvas capture of the on-screen card.
 */
(function () {
  'use strict';

  var SHARE_HOST = 'www.nexusvai.xyz/cancricode';
  var SHARE_DOMAIN = 'www.nexusvai.xyz';
  var SHARE_URL = 'https://www.nexusvai.xyz/cancricode';
  var SEED_TAG = 'cancricode';

  var VERT = "\nattribute vec2 position;\nvoid main() { gl_Position = vec4(position, 0.0, 1.0); }\n";
  var FRAG = "\nprecision highp float;\nuniform vec2 resolution;\nuniform vec2 pointer;\nuniform float time;\nuniform float seed;\nuniform float mode;\nuniform vec4 variation;\nuniform vec3 color1;\nuniform vec3 color2;\nuniform vec3 color3;\nuniform vec3 color4;\n\nfloat hash(vec2 p) {\n  p = fract(p * vec2(123.34, 456.21));\n  p += dot(p, p + 45.32 + seed);\n  return fract(p.x * p.y);\n}\n\nfloat noise(vec2 p) {\n  vec2 i = floor(p), f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + 1.0), f.x), f.y);\n}\n\nfloat fbm(vec2 p) {\n  float v = 0.0, a = 0.52;\n  mat2 r = mat2(.80, -.60, .60, .80);\n  for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03 + 7.1; a *= .5; }\n  return v;\n}\n\nvoid main() {\n  vec2 uv = gl_FragCoord.xy / resolution.xy;\n  vec2 p = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);\n  float t = time * .13;\n  vec2 mouse = (pointer - .5) * vec2(resolution.x / resolution.y, 1.0);\n  p += mouse * .08;\n  float s = seed * 9.73;\n  float scale = .58 + variation.x * .92;\n  vec2 preDomain = p * (.42 + variation.z * .44) + vec2(s, -s);\n  vec2 domainWarp = vec2(noise(preDomain), noise(preDomain + 17.31)) - .5;\n  p += domainWarp * (.18 + variation.y * .88);\n  p.x *= .78 + variation.z * .52;\n  float q = fbm(p * scale + vec2(s, -s * .7) + t * (.08 + variation.w * .16));\n  float r = fbm(p * (1.02 + variation.z * .52) + q * (.48 + variation.y * .62) + vec2(-t * .12, t * .09));\n  float directionAngle = seed * 6.28318 + mode * .47;\n  vec2 direction = vec2(cos(directionAngle), sin(directionAngle));\n  float sweep = dot(p, direction) * .68 + q * .42 + r * .14 + s;\n  float satin = smoothstep(.08, .94, sin(sweep * (3.8 + variation.z * 4.8)) * .5 + .5);\n  float treatment;\n  float coolFilm = 0.0;\n  if (mode < .5) {\n    treatment = satin;\n  } else if (mode < 1.5) {\n    float microflake = noise(floor((p + q * .08) * 18.0) + s);\n    treatment = .43 + smoothstep(.54, .94, microflake) * .34;\n  } else if (mode < 2.5) {\n    treatment = smoothstep(.18, .88, sin((q * 1.4 + r + dot(p,direction) * .18) * 7.0) * .5 + .5);\n  } else if (mode < 3.5) {\n    treatment = smoothstep(.24, .82, fbm(p * 1.45 + vec2(q * 1.2, -r) + t * .08));\n  } else if (mode < 4.5) {\n    vec2 facetCell = floor((p + q * .08) * (15.0 + variation.z * 12.0));\n    float facet = hash(facetCell + s);\n    treatment = .44 + facet * .22 + satin * .09;\n  } else if (mode < 5.5) {\n    float brushed = sin((dot(p,direction) + r * .1) * 35.0 + s);\n    treatment = .52 + brushed * .07 + satin * .13;\n  } else if (mode < 6.5) {\n    float fold = sin((dot(p,direction) + q * .7) * 8.5 + s);\n    treatment = smoothstep(-.4,.92,fold)*.62; coolFilm = smoothstep(.35,.94,fold*.5+.5)*.09;\n  } else if (mode < 7.5) {\n    float m = sin((p.x*.82+p.y+q*.3)*16.0)*sin((p.x-p.y*.66+r*.2)*13.0);\n    treatment = .52 + m * .11;\n  } else if (mode < 8.5) {\n    treatment = .48 + sin((p.y + q*.5) * 11.0 + s) * .17;\n  } else if (mode < 9.5) {\n    vec2 perpendicular = vec2(-direction.y, direction.x);\n    float pleat = sin(dot(p,direction)*18.0 + sin(dot(p,perpendicular)*4.0)*1.5+s);\n    treatment = .51 + pleat * .14;\n  } else if (mode < 10.5) {\n    float warp = fbm(p*2.1 + vec2(r,-q)*1.6);\n    treatment = smoothstep(.2,.84,warp);\n  } else if (mode < 11.5) {\n    float ribbon = sin((dot(p,direction)+q*1.15+r*.35)*6.5+s);\n    treatment = .47 + ribbon * .19;\n  } else if (mode < 12.5) {\n    float weave = sin((p.x+q*.12)*24.0)*sin((p.y+r*.12)*22.0);\n    treatment = .53 + weave * .07;\n  } else if (mode < 13.5) {\n    float directionalFlare = smoothstep(-.72,.88,dot(p,direction)+q*.32);\n    treatment = .38 + directionalFlare * .42; coolFilm = directionalFlare * .055;\n  } else if (mode < 14.5) {\n    float broken = sin((floor((q+r)*8.0)/8.0 + dot(p,direction)) * 10.0);\n    treatment = .51 + broken * .12;\n  } else if (mode < 15.5) {\n    float cloud = fbm(p*.82 + vec2(q,-r)*.6 + t*.035);\n    treatment = .38 + smoothstep(.2,.82,cloud) * .38;\n  } else if (mode < 16.5) {\n    float hammered = noise(p * (7.0 + variation.z * 5.0) + vec2(q,r));\n    treatment = .40 + smoothstep(.24,.84,hammered) * .34;\n  } else if (mode < 17.5) {\n    float row = mod(floor((p.y + 2.0) * 8.0), 2.0);\n    float herringbone = sin((p.x * (row * 2.0 - 1.0) + p.y * .72) * 19.0 + s);\n    treatment = .51 + herringbone * .13;\n  } else if (mode < 18.5) {\n    float frost = noise(p * 4.8 + q * 1.7 + s);\n    treatment = .37 + smoothstep(.18,.88,frost) * .42; coolFilm = frost * .045;\n  } else if (mode < 19.5) {\n    float lattice = sin((p.x+p.y+q*.18)*18.0) * sin((p.x-p.y+r*.16)*7.0);\n    treatment = .51 + lattice * .12;\n  } else if (mode < 20.5) {\n    float flame = fbm(vec2(p.x * 1.45 + q * .4, p.y * .58 - t * .06) + vec2(r,-q));\n    treatment = .35 + smoothstep(.16,.86,flame) * .46;\n  } else if (mode < 21.5) {\n    vec2 tessera = floor((p + vec2(q,-r)*.07) * vec2(18.0,24.0));\n    treatment = .44 + hash(tessera + s) * .23;\n  } else if (mode < 22.5) {\n    float marble = fbm(p * 1.7 + vec2(q,-r) * 2.1 + t * .025);\n    treatment = .35 + smoothstep(.12,.9,marble) * .46;\n  } else {\n    float lacquer = sin((p.y + q*.24) * 29.0 + sin(p.x*3.0+s));\n    treatment = .52 + lacquer * .08 + satin * .10;\n  }\n  float shapedTreatment = clamp(.5 + (treatment - .5) * 1.38, 0.0, 1.0);\n  float depthRange = .48 + variation.y * .24;\n  float materialDepth = clamp(.66 + q * .18 + (shapedTreatment - .5) * depthRange, .46, .99);\n  vec3 liftedShadow = mix(color1, color2, .70);\n  vec3 col = mix(liftedShadow, color2, materialDepth);\n  col = mix(col, color3, max(0.0, shapedTreatment - .54) * (.24 + variation.w * .18));\n  vec3 coolPearl = mix(color3, color4, clamp(uv.x + uv.y * .35, 0.0, 1.0));\n  col = mix(col, coolPearl, coolFilm * (1.0 + variation.z * .45));\n  float pearlMix = sin(sweep * 1.15 + time * .055) * .5 + .5;\n  vec3 pearl = mix(color3, color4, pearlMix);\n  float interference = smoothstep(.54, .94, satin) * (.085 + r * (.06 + variation.w * .055));\n  col = mix(col, pearl, interference);\n  float specular = pow(max(0.0, 1.0 - abs(sin(sweep * 2.15))), 11.0 + variation.w * 15.0);\n  col += specular * vec3(.28, .23, .17);\n  float vignette = 1.0 - smoothstep(.55, 1.45, length(p * vec2(.68, 1.0)));\n  col *= .995 + vignette * .015;\n  col = pow(col, vec3(.94));\n  float grain = hash(gl_FragCoord.xy + fract(time * .1) * 91.0) - .5;\n  col += grain * .007;\n  gl_FragColor = vec4(col, 1.0);\n}\n";

  /* Gold-ticket palettes (not Cloudflare orange). Same shader, gold foil look. */
  var PALETTES = [
    ['#6b4a0a', '#d4af37', '#fcf6ba', '#fff8e0'],
    ['#7a5510', '#e0c060', '#fff1b8', '#ffe9a0'],
    ['#5c3f08', '#c9a227', '#f7e7a0', '#fff6d0'],
    ['#8a6414', '#e8c65a', '#fff4c4', '#ffe8a8'],
    ['#704c0c', '#d8b84a', '#fceed0', '#fff9e8'],
    ['#664208', '#c9a84a', '#f6e8b4', '#fff2c8'],
    ['#7d5812', '#e2bc4e', '#fff0b0', '#ffe29a'],
    ['#5a3c0a', '#b8922e', '#f0d98a', '#fff3c0'],
    ['#856216', '#ecc86a', '#fff6d4', '#ffeab4'],
    ['#6e4e10', '#d2aa3c', '#f8e8b0', '#fff8dc'],
    ['#4f3608', '#aa771c', '#e8d090', '#fcf6ba'],
    ['#7a5210', '#d4af37', '#fff0b8', '#fff8e6'],
    ['#684810', '#c9a227', '#f5e2a0', '#fff4cc'],
    ['#735214', '#e0b840', '#fceed8', '#fffaf0']
  ];
  var MODE_COUNT = 24;
  /* Exact NexusVAI SVGs from cloudflare-pay/index.html Chinese brand patch */
  var ICON_SVG = "<svg class=\"nexus-icon-svg\" viewBox=\"0 0 500 515\" style=\"height: 28px; width: auto; fill: currentColor; display: block; flex-shrink: 0;\"><g transform=\"translate(-262,802) scale(0.1,-0.1)\"><path d=\"M2620 5513 l0 -2508 550 550 550 550 2 1412 3 1413 200 -162 c110 -89 434 -354 720 -588 286 -234 581 -476 655 -536 74 -60 268 -218 430 -350 348 -283 749 -606 1165 -938 165 -132 393 -316 508 -408 l207 -168 0 1972 c0 1137 -4 1968 -9 1962 -5 -5 -79 -90 -166 -189 -87 -99 -228 -260 -314 -358 l-156 -178 -5 -676 -5 -676 -220 188 c-121 103 -323 276 -450 383 -604 515 -952 815 -1190 1027 -143 128 -285 254 -315 281 -30 27 -129 116 -220 199 -91 83 -204 185 -251 228 l-86 77 -802 0 -801 0 0 -2507z\"/><path d=\"M5620 7537 l0 -483 389 -332 c215 -182 464 -397 555 -477 l166 -145 0 502 0 503 103 105 c56 58 212 220 347 360 134 140 287 299 339 353 l96 97 -998 0 -997 0 0 -483z\"/><path d=\"M3949 6459 c-1 -2 -3 -387 -6 -856 l-4 -851 243 -185 c462 -349 846 -639 1540 -1162 l697 -525 596 0 595 0 0 313 0 314 -182 144 c-532 419 -1508 1201 -1928 1544 -310 253 -993 812 -1174 960 -94 77 -209 171 -256 209 -47 38 -93 76 -102 84 -10 8 -18 13 -19 11z\"/><path d=\"M3950 4453 c-1 -4 0 -116 0 -248 l0 -240 -540 -540 c-297 -297 -540 -542 -540 -545 0 -3 419 -4 930 -2 l930 2 -2 492 -3 491 -360 279 c-409 318 -415 322 -415 311z\"/></g></svg>";
  var LOGO_SVG = "<svg class=\"nexus-logo-svg\" viewBox=\"245 343 1330 200\" style=\"height: 22px; width: auto; fill: currentColor; display: block; flex-shrink: 0;\"><g transform=\"translate(0,887) scale(0.1,-0.1)\" stroke=\"none\"><path d=\"M2486 5418 c-14 -20 -16 -125 -16 -935 l0 -913 175 0 175 0 2 671 3 672 195 -214 c107 -117 243 -265 301 -329 252 -274 493 -536 609 -663 l125 -137 178 0 177 0 0 935 0 935 -175 0 -175 0 -2 -664 -3 -663 -131 141 c-72 78 -198 215 -279 306 -82 91 -207 230 -278 310 -71 80 -218 241 -326 357 l-196 213 -172 0 c-166 0 -172 -1 -187 -22z\"/><path d=\"M11183 5328 c3 -7 129 -270 280 -584 152 -314 337 -701 412 -860 74 -159 145 -298 156 -309 17 -18 35 -20 152 -23 208 -5 183 -26 308 244 58 126 180 387 269 579 321 691 440 950 440 961 0 3 -95 3 -211 2 l-211 -3 -27 -65 c-41 -94 -455 -1009 -506 -1115 l-42 -90 -33 70 c-43 93 -113 248 -189 420 -35 77 -96 212 -136 300 -40 88 -105 233 -145 323 l-73 162 -224 0 c-176 0 -224 -3 -220 -12z\"/><path d=\"M13619 5331 c-72 -4 -112 -11 -124 -21 -10 -8 -37 -55 -61 -105 -125 -267 -338 -725 -454 -980 -73 -159 -170 -372 -216 -473 -46 -101 -84 -187 -84 -193 0 -5 250 -9 651 -9 647 0 650 0 644 20 -19 59 -149 312 -168 325 -18 12 -66 15 -289 15 -148 0 -268 2 -268 5 0 3 9 24 20 46 12 22 50 104 85 182 60 134 202 446 276 604 19 40 37 73 40 73 5 0 266 -561 487 -1050 l98 -215 199 -3 c109 -1 202 1 207 6 4 4 -60 154 -143 332 -83 179 -206 447 -275 595 -273 591 -379 808 -404 827 -31 22 -85 27 -221 19z\"/><path d=\"M14150 5328 c0 -10 80 -185 263 -578 21 -47 75 -164 119 -260 44 -96 106 -231 138 -300 73 -160 136 -298 220 -485 l67 -150 199 -3 c109 -1 204 0 211 2 14 6 -15 70 -450 1021 -85 187 -198 435 -250 550 l-95 210 -211 2 c-151 1 -211 -1 -211 -9z\"/><path d=\"M5207 5044 c-142 -26 -278 -93 -376 -187 -208 -200 -278 -545 -169 -834 42 -111 91 -184 176 -265 161 -151 374 -209 723 -195 225 9 322 34 462 116 66 38 195 147 185 156 -145 126 -243 205 -252 205 -7 0 -28 -16 -47 -36 -44 -47 -115 -82 -198 -100 -77 -16 -355 -19 -444 -4 -149 24 -252 108 -291 238 l-7 22 650 0 651 0 0 151 c0 102 -5 173 -16 222 -63 279 -285 473 -589 517 -100 14 -366 11 -458 -6z m428 -314 c148 -22 251 -102 289 -227 l7 -23 -481 0 -481 0 6 23 c33 108 136 193 269 222 73 16 294 19 391 5z\"/><path d=\"M10054 5045 c-233 -50 -374 -232 -362 -463 3 -56 13 -108 27 -145 42 -108 139 -205 249 -249 54 -21 75 -23 367 -28 220 -3 316 -9 332 -17 42 -24 63 -63 63 -114 0 -42 -5 -55 -34 -87 l-34 -37 -470 -3 -471 -3 -6 -29 c-4 -17 -5 -91 -3 -165 l3 -135 487 0 c448 0 491 1 547 19 85 26 140 61 199 126 201 219 140 579 -120 711 -95 48 -142 54 -438 54 -255 0 -277 1 -307 20 -83 50 -83 171 1 215 27 14 86 17 466 18 l435 2 3 156 2 156 -166 6 c-283 12 -702 7 -770 -8z\"/><path d=\"M6280 5014 c0 -31 10 -46 69 -108 37 -39 173 -188 300 -330 l231 -260 -33 -35 c-19 -20 -76 -83 -127 -141 -51 -58 -171 -191 -266 -297 -166 -182 -174 -193 -174 -232 l0 -41 204 0 204 0 58 68 c88 103 355 397 364 400 7 2 215 -225 371 -405 l54 -62 208 -1 207 0 0 40 c0 37 -8 49 -117 168 -190 205 -478 533 -478 542 0 10 233 271 513 573 64 69 72 82 72 117 l0 40 -204 0 -204 0 -201 -224 c-110 -124 -206 -228 -213 -232 -6 -4 -20 4 -32 18 -12 15 -104 119 -206 232 l-184 206 -208 0 -208 0 0 -36z\"/><path d=\"M8052 4568 l4 -483 26 -80 c71 -211 229 -355 456 -417 111 -30 383 -30 492 0 261 71 431 243 481 487 17 80 19 140 19 533 l0 442 -175 0 -174 0 -3 -467 -3 -468 -23 -44 c-34 -64 -104 -126 -170 -153 -49 -19 -76 -22 -187 -23 -173 0 -228 17 -305 94 -91 91 -90 85 -90 612 l0 449 -176 0 -175 0 3 -482z\"/></g></svg>";

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function hexToRgb(hex) {
    var n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  function seedParams(seed) {
    var normalizedSeed = (seed % 10000) / 10000;
    var palette = PALETTES[(seed >>> 8) % PALETTES.length] || PALETTES[0];
    return {
      normalizedSeed: normalizedSeed,
      mode: seed % MODE_COUNT,
      variation: [
        ((seed >>> 3) & 255) / 255,
        ((seed >>> 11) & 255) / 255,
        ((seed >>> 19) & 255) / 255,
        ((((seed >>> 27) & 31) / 31) + normalizedSeed) % 1
      ],
      colors: palette.map(hexToRgb),
      style: foilStyle(seed)
    };
  }

  function foilStyle(seed) {
    var a = seed % 360;
    return {
      '--foil-a': String(a),
      '--foil-b': String((a + 72 + ((seed >>> 4) % 50)) % 360),
      '--foil-c': String((a + 185 + ((seed >>> 9) % 70)) % 360),
      '--wash-x': 15 + ((seed >>> 16) % 70) + '%',
      '--wash-y': 15 + ((seed >>> 23) % 65) + '%'
    };
  }

  async function hashTag(tag) {
    var key = String(tag || '').trim().toLocaleLowerCase() || 'cloudflare-wallet';
    var buf = new TextEncoder().encode(key);
    var dig = await crypto.subtle.digest('SHA-256', buf);
    return new DataView(dig).getUint32(0, false);
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[gold-ticket] shader compile', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function mountShader(canvas, seed, animated) {
    var gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: true
    });
    if (!gl) return { destroy: function () {} };

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return { destroy: function () {} };

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    var loc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, 'resolution');
    var uPtr = gl.getUniformLocation(prog, 'pointer');
    var uTime = gl.getUniformLocation(prog, 'time');
    var uSeed = gl.getUniformLocation(prog, 'seed');
    var uMode = gl.getUniformLocation(prog, 'mode');
    var uVar = gl.getUniformLocation(prog, 'variation');
    var uColors = [1, 2, 3, 4].map(function (i) {
      return gl.getUniformLocation(prog, 'color' + i);
    });

    var params = seedParams(seed);
    gl.uniform1f(uSeed, params.normalizedSeed);
    gl.uniform1f(uMode, params.mode);
    gl.uniform4f(uVar, params.variation[0], params.variation[1], params.variation[2], params.variation[3]);
    params.colors.forEach(function (c, i) {
      if (uColors[i] != null) gl.uniform3fv(uColors[i], c);
    });

    var raf = 0;
    var visible = true;
    var last = 0;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var animate = animated && !reduce;
    var t0 = performance.now();
    var pointer = { x: 0.5, y: 0.5 };

    function resize() {
      var r = canvas.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      var w = Math.max(1, Math.round(r.width * dpr));
      var h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
    }

    function draw(now) {
      if (!reduce && now - last < 32) {
        if (visible && animate) raf = requestAnimationFrame(draw);
        return;
      }
      last = now;
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uPtr, pointer.x, pointer.y);
      gl.uniform1f(uTime, animate ? (now - t0) / 1000 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (visible && animate) raf = requestAnimationFrame(draw);
    }

    var io = new IntersectionObserver(function (entries) {
      var was = visible;
      visible = !!(entries[0] && entries[0].isIntersecting);
      if (visible && !was && animate) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    raf = requestAnimationFrame(draw);

    return {
      setPointer: function (x, y) {
        pointer.x = x;
        pointer.y = y;
      },
      redraw: function () {
        draw(performance.now());
      },
      destroy: function () {
        cancelAnimationFrame(raf);
        io.disconnect();
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        gl.deleteBuffer(buf);
      }
    };
  }

  function editionLabel() {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })
      .format(new Date())
      .replace(' ', ' / ')
      .toUpperCase();
  }

  function cardHtml() {
    return (
      '<div class="wallet-card-stage">' +
      '<div class="wallet-card" data-cancri-gold-card="true">' +
      '<div class="card-base" aria-hidden="true"></div>' +
      '<canvas class="card-shader" aria-hidden="true"></canvas>' +
      '<div class="card-foil card-foil-color" aria-hidden="true"></div>' +
      '<div class="card-surface" aria-hidden="true"></div>' +
      '<div class="card-topline">' +
      '<div class="card-brand" data-nexus-brand="true">' +
      ICON_SVG +
      LOGO_SVG +
      '</div>' +
      '<span class="card-edition">' +
      editionLabel() +
      '</span>' +
      '</div>' +
      '<div class="card-name-wrap"><div class="card-name">' +
      SHARE_HOST +
      '</div></div>' +
      '<div class="card-bottomline">' +
      '<div><span class="card-label">CANCRICODEVITE</span><strong>TEST ACCESS PERMISSION</strong></div>' +
      '<div class="card-number"><span class="card-label">OFFICIAL DOMAIN</span><strong>' +
      SHARE_DOMAIN +
      '</strong></div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function styleNexusBrand(root) {
    root.querySelectorAll('.card-brand[data-nexus-brand="true"]').forEach(function (brand) {
      var svg1 = brand.children[0];
      var svg2 = brand.children[1];
      /* Match cloudflare-pay Chinese brand patch; size via CSS cqw */
      if (svg1) {
        svg1.classList.add('nexus-icon-svg');
        svg1.removeAttribute('style');
        svg1.style.color = '#362203';
        svg1.style.fill = 'currentColor';
        svg1.style.display = 'block';
        svg1.style.flexShrink = '0';
        svg1.style.filter = 'drop-shadow(0 1px 1px rgba(255,253,210,0.85))';
      }
      if (svg2) {
        svg2.classList.add('nexus-logo-svg');
        svg2.removeAttribute('style');
        svg2.style.color = '#362203';
        svg2.style.fill = 'currentColor';
        svg2.style.display = 'block';
        svg2.style.flexShrink = '0';
        svg2.style.filter = 'drop-shadow(0 1px 1px rgba(255,253,210,0.85))';
      }
    });
  }

  function bindTilt(card, shaderApi) {
    var raf = 0;
    card.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = card.getBoundingClientRect();
      var px = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      var py = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () {
        card.style.setProperty('--rx', (0.5 - py) * 9 + 'deg');
        card.style.setProperty('--ry', (px - 0.5) * 12 + 'deg');
        card.style.setProperty('--mx', (px - 0.5) * 24 + 'px');
        card.style.setProperty('--my', (py - 0.5) * 18 + 'px');
        if (shaderApi) shaderApi.setPointer(px, py);
      });
    });
    card.addEventListener('pointerleave', function () {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
      card.style.setProperty('--mx', '0px');
      card.style.setProperty('--my', '0px');
      if (shaderApi) shaderApi.setPointer(0.5, 0.5);
    });
  }

  function enhanceCard(root, seed, animated) {
    var card = qs('[data-cancri-gold-card]', root);
    if (!card) return null;
    var style = seedParams(seed).style;
    Object.keys(style).forEach(function (k) {
      card.style.setProperty(k, style[k]);
    });
    var canvas = qs('.card-shader', card);
    var api = canvas ? mountShader(canvas, seed, animated) : null;
    styleNexusBrand(root);
    bindTilt(card, api);
    return { card: card, api: api };
  }

  function ensureLightbox() {
    var existing = qs('.cancri-gold-ticket-lb');
    if (existing) return existing;
    var lb = document.createElement('div');
    lb.className = 'cancri-gold-ticket-lb';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', '金奖券分享');
    lb.innerHTML =
      '<div class="cancri-gold-ticket-lb__backdrop" data-gt-close="true"></div>' +
      '<div class="cancri-gold-ticket-lb__panel">' +
      '<div class="cancri-gold-ticket-lb__stage"></div>' +
      '<button type="button" class="cancri-gold-ticket-lb__share">分享</button>' +
      '</div>' +
      '<div class="cancri-gold-ticket-lb__toast" role="status" aria-live="polite"></div>';
    document.body.appendChild(lb);
    return lb;
  }

  function showToast(lb, msg) {
    var toast = qs('.cancri-gold-ticket-lb__toast', lb);
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('is-show');
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(function () {
      toast.classList.remove('is-show');
    }, 2400);
  }

  var lbHandle = null;

  function openLightbox(seed) {
    var lb = ensureLightbox();
    var stage = qs('.cancri-gold-ticket-lb__stage', lb);
    if (!stage) return;
    if (lbHandle && lbHandle.api) lbHandle.api.destroy();
    stage.innerHTML = cardHtml();
    lbHandle = enhanceCard(stage, seed, true);
    if (lbHandle && lbHandle.card) {
      lbHandle.card.style.setProperty('--rx', '0deg');
      lbHandle.card.style.setProperty('--ry', '0deg');
    }
    lb.classList.add('is-open');
    document.documentElement.style.overflow = 'hidden';
    var btn = qs('.cancri-gold-ticket-lb__share', lb);
    if (btn) btn.focus({ preventScroll: true });
  }

  function closeLightbox() {
    var lb = qs('.cancri-gold-ticket-lb');
    if (!lb) return;
    lb.classList.remove('is-open');
    document.documentElement.style.overflow = '';
    if (lbHandle && lbHandle.api) lbHandle.api.destroy();
    lbHandle = null;
    var stage = qs('.cancri-gold-ticket-lb__stage', lb);
    if (stage) stage.innerHTML = '';
  }

  async function captureCard(card) {
    if (!card) return null;
    if (lbHandle && lbHandle.api) lbHandle.api.redraw();
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    if (typeof html2canvas !== 'function') return null;
    var canvas = await html2canvas(card, {
      backgroundColor: null,
      scale: Math.min(2.5, (window.devicePixelRatio || 1) * 1.5),
      useCORS: true,
      logging: false,
      foreignObjectRendering: false
    });
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve(blob || null);
      }, 'image/png');
    });
  }

  async function copyShare(lb) {
    var btn = qs('.cancri-gold-ticket-lb__share', lb);
    if (btn) btn.setAttribute('aria-busy', 'true');
    try {
      var card = lbHandle && lbHandle.card;
      var blob = await captureCard(card);
      if (blob && navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast(lb, '金奖券截图已复制，可直接粘贴分享');
          return;
        } catch (e1) {
          /* fallthrough */
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(SHARE_URL);
        showToast(lb, '已复制链接 ' + SHARE_HOST);
      } else {
        showToast(lb, '复制失败，请手动分享 ' + SHARE_HOST);
      }
    } catch (err) {
      console.warn('[gold-ticket] share failed', err);
      try {
        await navigator.clipboard.writeText(SHARE_URL);
        showToast(lb, '已复制链接 ' + SHARE_HOST);
      } catch (e2) {
        showToast(lb, '复制失败，请手动分享 ' + SHARE_HOST);
      }
    } finally {
      if (btn) btn.removeAttribute('aria-busy');
    }
  }

  async function init() {
    var root = qs('[data-cancri-role="gold-ticket"]');
    if (!(root instanceof HTMLElement)) return;

    var seed = await hashTag(SEED_TAG);
    root.innerHTML =
      '<button type="button" class="cancri-gold-ticket__hit" aria-label="打开金奖券并分享">' +
      cardHtml() +
      '</button>';

    var preview = enhanceCard(root, seed, true);
    var hit = qs('.cancri-gold-ticket__hit', root);
    if (hit) {
      hit.addEventListener('click', function () {
        openLightbox(seed);
      });
    }

    var lb = ensureLightbox();
    lb.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-gt-close="true"]')) {
        closeLightbox();
        return;
      }
      if (t.closest('.cancri-gold-ticket-lb__share')) copyShare(lb);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && lb.classList.contains('is-open')) closeLightbox();
    });

    void preview;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
