/* /api/ home page: live context + price on the featured model cards, and the click-to-play featured video.
 * Prices are read from the public catalog at runtime and never written into the page. */
(function () {
  "use strict";

  var CATALOG_URLS = ["https://chat.nexusvai.xyz/functions/v1/chat-gateway", "https://cn.nexusvai.xyz/functions/v1/chat-gateway"];
  var CATALOG_KEY = "neon-auth-via-cf-shim";

  function num(v) {
    if (v === null || v === undefined || v === "") return "";
    var n = Number(v);
    return isFinite(n) ? String(n) : "";
  }

  function contextText(tokens) {
    var n = Number(tokens);
    if (!isFinite(n) || n <= 0) return "";
    if (n >= 1e6) return num((n / 1e6).toFixed(2)) + "M 上下文";
    return Math.round(n / 1000) + "K 上下文";
  }

  function priceText(m) {
    if (m.gateCostTier === "free") return "免费";
    var input = num(m.inputPricePerM);
    var output = num(m.outputPricePerM);
    if (input && output) return "输入 ¥" + input + "，输出 ¥" + output + "（每百万 token）";
    return m.priceDisplay || "";
  }

  function fetchCatalog(i) {
    return fetch(CATALOG_URLS[i], {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CATALOG_KEY },
      body: JSON.stringify({ endpoint: "model_public_catalog" }),
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .catch(function (err) {
        if (i + 1 < CATALOG_URLS.length) return fetchCatalog(i + 1);
        throw err;
      });
  }

  function fillModelMeta() {
    var slots = document.querySelectorAll("[data-home-model-meta]");
    if (!slots.length || !window.fetch) return;
    fetchCatalog(0)
      .then(function (data) {
        var byId = {};
        ((data && data.models) || []).forEach(function (m) {
          if (m && m.id) byId[m.id] = m;
        });
        slots.forEach(function (el) {
          var m = byId[el.getAttribute("data-home-model-meta")];
          if (!m || m.disabled || m.available === false) return;
          var text = [contextText(m.maxInputTokens), priceText(m)].filter(Boolean).join(" · ");
          if (!text) return;
          el.textContent = text;
          el.hidden = false;
        });
      })
      .catch(function () {});
  }

  function playFeaturedVideo(button) {
    var host = button.closest("[data-featured-video]");
    var frame = host && host.querySelector("[data-featured-video-frame]");
    var src = host && host.getAttribute("data-video-src");
    if (!frame || !src) return;
    var poster = button.querySelector("img");
    var video = document.createElement("video");
    video.className = "home-video";
    video.src = src;
    if (poster) video.poster = poster.currentSrc || poster.src;
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("aria-label", host.getAttribute("data-video-title") || "");
    frame.replaceChildren(video);
    video.focus();
    var started = video.play();
    if (started && started.catch) started.catch(function () {});
  }

  // Same as OpenAI's home: from 768px up, stretch the featured grid so the sticky video and its caption
  // stay inside it until the last side tile has scrolled past.
  function syncFeaturedHeight() {
    var container = document.querySelector("[data-featured-container]");
    var sticky = document.querySelector("[data-featured-sticky]");
    var primary = document.querySelector("[data-featured-primary-image]");
    var tiles = container ? container.querySelectorAll("[data-featured-secondary-image]") : [];
    if (!container || !sticky || !primary || !tiles.length) return;
    var last = tiles[tiles.length - 1];
    var queued = false;
    function update() {
      queued = false;
      container.style.height = "";
      if (window.innerWidth < 768) return;
      var stickyHeight = sticky.getBoundingClientRect().height;
      var lastBottom = last.getBoundingClientRect().bottom - container.getBoundingClientRect().top;
      var height = Math.max(lastBottom + stickyHeight - primary.getBoundingClientRect().height, stickyHeight);
      if (isFinite(height)) container.style.height = height + "px";
    }
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    }
    update();
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    if (window.ResizeObserver) {
      var observer = new ResizeObserver(schedule);
      observer.observe(sticky);
      observer.observe(primary);
      observer.observe(last);
    }
  }

  document.addEventListener("click", function (e) {
    var button = e.target.closest && e.target.closest("[data-featured-video-play]");
    if (button) playFeaturedVideo(button);
  });

  function init() {
    fillModelMeta();
    syncFeaturedHeight();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
