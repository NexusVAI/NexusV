/**
 * Trae Distortion port (grid-distortion) via Three.js.
 * Source algorithm: Trae website Distortion component (module 55991).
 * Brand fill #2200FF + Cancri wordmark as the sampled texture.
 */
(function () {
  'use strict';

  var WORDMARK_SRC = './images/cancricode-wordmark.svg';
  var BRAND = '#2200ff';
  var LOGO_ASPECT = 1761 / 239;

  var GRID = 15;
  var MOUSE = 0.25;
  var STRENGTH = 0.15;
  var RELAXATION = 0.9;

  var VERT = [
    'uniform float time;',
    'varying vec2 vUv;',
    'varying vec3 vPosition;',
    'void main() {',
    '  vUv = uv;',
    '  vPosition = position;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D uDataTexture;',
    'uniform sampler2D uTexture;',
    'uniform vec4 resolution;',
    'varying vec2 vUv;',
    'void main() {',
    '  vec2 uv = vUv;',
    '  vec4 offset = texture2D(uDataTexture, vUv);',
    '  gl_FragColor = texture2D(uTexture, uv - 0.02 * offset.rg);',
    '}'
  ].join('\n');

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function buildBrandCanvas(width, height, logoImg) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(2, width);
    canvas.height = Math.max(2, height);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = BRAND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (logoImg && logoImg.complete && logoImg.naturalWidth) {
      var padX = Math.max(16, canvas.width * 0.05);
      var padY = Math.max(12, canvas.height * 0.22);
      var maxW = canvas.width - padX * 2;
      var maxH = canvas.height - padY * 2;
      var drawW = maxW;
      var drawH = drawW / LOGO_ASPECT;
      if (drawH > maxH) {
        drawH = maxH;
        drawW = drawH * LOGO_ASPECT;
      }
      ctx.drawImage(
        logoImg,
        (canvas.width - drawW) / 2,
        (canvas.height - drawH) / 2,
        drawW,
        drawH
      );
    }
    return canvas;
  }

  function initFooterMark() {
    var root = document.querySelector('[data-cancri-role="footer-distortion"]');
    if (!root || root.dataset.cancriReady === 'true') return;

    var band = root.querySelector('.cancri-footer-distortion__band');
    var mount = root.querySelector('.cancri-footer-distortion__mount');
    if (!band || !mount) return;

    var THREE = window.THREE;
    if (!THREE) {
      console.warn('[cancri-footer-mark] THREE is not loaded');
      return;
    }

    root.dataset.cancriReady = 'true';

    if (prefersReducedMotion()) {
      var img = new Image();
      img.onload = function () {
        var staticCanvas = buildBrandCanvas(band.clientWidth * 2, band.clientHeight * 2, img);
        staticCanvas.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;';
        mount.appendChild(staticCanvas);
      };
      img.src = WORDMARK_SRC;
      return;
    }

    var scene = new THREE.Scene();
    var renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x2200ff, 1);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';

    var camera = new THREE.OrthographicCamera(0, 0, 0, 0, -1000, 1000);
    camera.position.z = 2;

    var uniforms = {
      time: { value: 0 },
      resolution: { value: new THREE.Vector4() },
      uTexture: { value: null },
      uDataTexture: { value: null }
    };

    var size = GRID;
    var data = new Float32Array(4 * size * size);
    for (var i = 0; i < size * size; i++) {
      data[4 * i] = 255 * Math.random() - 125;
      data[4 * i + 1] = 255 * Math.random() - 125;
    }

    var dataTexture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    dataTexture.magFilter = THREE.LinearFilter;
    dataTexture.minFilter = THREE.LinearFilter;
    dataTexture.needsUpdate = true;
    uniforms.uDataTexture.value = dataTexture;

    var material = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG
    });

    var geometry = new THREE.PlaneGeometry(1, 1, size - 1, size - 1);
    var mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    var mouse = { x: 0, y: 0, prevX: 0, prevY: 0, vX: 0, vY: 0 };
    var brandTexture = null;
    var logoImg = new Image();
    logoImg.decoding = 'async';

    function syncBrandTexture() {
      var w = Math.max(2, Math.floor((mount.clientWidth || band.clientWidth) * Math.min(window.devicePixelRatio || 1, 2)));
      var h = Math.max(2, Math.floor((mount.clientHeight || band.clientHeight) * Math.min(window.devicePixelRatio || 1, 2)));
      var canvas = buildBrandCanvas(w, h, logoImg);
      if (brandTexture) brandTexture.dispose();
      brandTexture = new THREE.CanvasTexture(canvas);
      brandTexture.minFilter = THREE.LinearFilter;
      brandTexture.magFilter = THREE.LinearFilter;
      if ('SRGBColorSpace' in THREE) brandTexture.colorSpace = THREE.SRGBColorSpace;
      uniforms.uTexture.value = brandTexture;
      uniforms.uTexture.value.needsUpdate = true;
    }

    // Avoid first-frame black (null uTexture samples as black in WebGL).
    syncBrandTexture();

    function resize() {
      var width = mount.clientWidth || band.clientWidth;
      var height = mount.clientHeight || band.clientHeight;
      if (!width || !height) {
        width = Math.max(2, band.clientWidth || window.innerWidth);
        height = Math.max(2, band.clientHeight || Math.round(width / 3.83228));
      }

      renderer.setSize(width, height, false);
      var aspect = width / height;
      mesh.scale.set(aspect, 1, 1);

      camera.left = -aspect / 2;
      camera.right = aspect / 2;
      camera.top = 0.5;
      camera.bottom = -0.5;
      camera.updateProjectionMatrix();

      uniforms.resolution.value.set(width, height, 1, 1);
      syncBrandTexture();
    }

    function onMouseMove(event) {
      var rect = (mount.clientWidth ? mount : band).getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var x = (event.clientX - rect.left) / rect.width;
      var y = 1 - (event.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      mouse.vX = x - mouse.prevX;
      mouse.vY = y - mouse.prevY;
      mouse.x = x;
      mouse.y = y;
      mouse.prevX = x;
      mouse.prevY = y;
    }

    function onMouseLeave() {
      dataTexture.needsUpdate = true;
      mouse.x = 0;
      mouse.y = 0;
      mouse.prevX = 0;
      mouse.prevY = 0;
      mouse.vX = 0;
      mouse.vY = 0;
    }

    function tick() {
      requestAnimationFrame(tick);
      uniforms.time.value += 0.05;

      var e = dataTexture.image.data;
      var n = size;
      var u = RELAXATION;
      var a = STRENGTH;
      var r = MOUSE;
      var d;

      for (d = 0; d < n * n; d++) {
        e[4 * d] *= u;
        e[4 * d + 1] *= u;
      }

      var l = n * mouse.x;
      var c = n * mouse.y;
      var p = n * r;
      var m;
      var v;
      for (m = 0; m < n; m++) {
        for (v = 0; v < n; v++) {
          var f = Math.pow(l - m, 2) + Math.pow(c - v, 2);
          if (f < p * p) {
            var b = 4 * (m + n * v);
            var h = f > 0 ? Math.min(p / Math.sqrt(f), 10) : 10;
            e[b] += 100 * a * mouse.vX * h;
            e[b + 1] -= 100 * a * mouse.vY * h;
          }
        }
      }

      dataTexture.needsUpdate = true;
      renderer.render(scene, camera);
    }

    logoImg.onload = function () {
      resize();
    };
    logoImg.onerror = function () {
      resize();
    };
    logoImg.src = WORDMARK_SRC;

    // Hit target = whole brand band (Trae listens on the distortion container).
    band.addEventListener('mousemove', onMouseMove);
    band.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('resize', resize, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resize).observe(band);
    }

    resize();
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooterMark, { once: true });
  } else {
    initFooterMark();
  }
})();
