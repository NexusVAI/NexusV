/* =====================================================================
 * Auth Captcha — lightweight Canvas-based numeric captcha for login.
 * Replaces Cloudflare Turnstile with an inline "draw + type" challenge.
 *
 * Exposes window.NexusAuthCaptcha
 *   - init()        — render into #authCaptchaContainer
 *   - validate()    — returns true if user input matches current code
 *   - refresh()     — regenerate canvas + clear input
 *   - getCode()     — debug only; don't expose to end user
 * ===================================================================== */
(function () {
  "use strict";

  var state = {
    code: "",
    canvas: null,
    input: null,
    container: null,
  };

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------
  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function randColor(alpha) {
    var a = alpha === undefined ? rand(128, 220) / 255 : alpha;
    return "rgba(" + rand(60, 180) + "," + rand(60, 180) + "," + rand(60, 180) + "," + a + ")";
  }

  // -------------------------------------------------------------------
  // Draw a 4-digit numeric captcha with interference lines & noise
  // -------------------------------------------------------------------
  function draw() {
    var canvas = state.canvas;
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;

    // background — clear first, then opaque fill to prevent stacking
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "hsl(var(--bg-100, 240 5% 96%))";
    ctx.fillRect(0, 0, w, h);

    // generate 4 random digits
    var digits = "";
    for (var i = 0; i < 4; i++) digits += rand(0, 9);
    state.code = digits;

    // distortion grid (light)
    ctx.strokeStyle = "rgba(160,160,160,0.12)";
    ctx.lineWidth = 1;
    for (var y = 0; y < h; y += 10) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (var x = 0; x < w; x += 10) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // interference lines (horizontal + diagonal)
    for (var k = 0; k < 5; k++) {
      ctx.strokeStyle = randColor(0.25);
      ctx.lineWidth = rand(1, 3);
      ctx.beginPath();
      var lx = rand(0, w);
      var ly = rand(0, h);
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + rand(-60, 60), ly + rand(-10, 10));
      ctx.stroke();
    }

    // diagonal lines
    for (var d = 0; d < 3; d++) {
      ctx.strokeStyle = randColor(0.18);
      ctx.lineWidth = rand(1, 2);
      ctx.beginPath();
      ctx.moveTo(rand(0, w), rand(0, h));
      ctx.lineTo(rand(0, w), rand(0, h));
      ctx.stroke();
    }

    // draw digits
    var step = w / 5;
    for (var i = 0; i < 4; i++) {
      var ch = digits[i];
      var x = step * (i + 1);
      var y = h / 2 + rand(-6, 6);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rand(-20, 20) * Math.PI) / 180);
      ctx.font = "bold 26px 'Anthropic Sans', 'AnthropicSans', ui-monospace, monospace";
      ctx.fillStyle = randColor(0.85);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // slight shadow for depth
      ctx.shadowColor = "rgba(0,0,0,0.2)";
      ctx.shadowBlur = 2;
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }

    // noise dots
    for (var n = 0; n < 80; n++) {
      ctx.fillStyle = randColor(0.5);
      ctx.beginPath();
      ctx.arc(rand(0, w), rand(0, h), rand(0.5, 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // -------------------------------------------------------------------
  // Build DOM
  // -------------------------------------------------------------------
  function build() {
    var container = document.getElementById("authCaptchaContainer");
    if (!container) return;
    state.container = container;
    container.innerHTML = "";

    var wrap = document.createElement("div");
    wrap.className = "auth-captcha-wrap";

    // canvas
    var canvas = document.createElement("canvas");
    canvas.width = 140;
    canvas.height = 48;
    canvas.className = "auth-captcha-canvas";
    wrap.appendChild(canvas);
    state.canvas = canvas;

    // input
    var input = document.createElement("input");
    input.type = "text";
    input.className = "auth-input auth-captcha-input";
    input.placeholder = "输入数字";
    input.maxLength = 4;
    input.inputMode = "numeric";
    input.autocomplete = "off";
    wrap.appendChild(input);
    state.input = input;

    // refresh btn
    var refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "auth-captcha-refresh";
    refreshBtn.title = "换一张";
    refreshBtn.innerHTML = "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='23 4 23 10 17 10'></polyline><path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10'></path></svg>";
    refreshBtn.addEventListener("click", function () {
      refresh();
      if (input) input.value = "";
      input.focus();
    });
    wrap.appendChild(refreshBtn);

    container.appendChild(wrap);
    draw();
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------
  function init() {
    if (state.container) return; // already built
    build();
  }

  function refresh() {
    draw();
  }

  function validate() {
    if (!state.input || !state.code) return false;
    var val = (state.input.value || "").trim();
    return val === state.code;
  }

  function getCode() {
    return state.code;
  }

  function focusInput() {
    if (state.input) state.input.focus();
  }

  function clearInput() {
    if (state.input) state.input.value = "";
  }

  window.NexusAuthCaptcha = {
    init: init,
    refresh: refresh,
    validate: validate,
    getCode: getCode,
    focusInput: focusInput,
    clearInput: clearInput,
  };
})();
