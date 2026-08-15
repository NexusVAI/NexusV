/* p2m-loader.js — cover the white first paint, drop as soon as the skeleton exists.
   Do NOT wait for window.load (images / late scripts). */
(function () {
  function hideLoader() {
    var loader = document.getElementById("p2m-loader");
    if (!loader || loader.dataset.p2mReady) return;
    loader.dataset.p2mReady = "1";
    loader.classList.add("p2m-fade-out");
    setTimeout(function () {
      if (loader.parentNode) loader.parentNode.removeChild(loader);
    }, 220);
  }

  function hideAfterFirstPaint() {
    requestAnimationFrame(function () {
      requestAnimationFrame(hideLoader);
    });
  }

  if (document.readyState === "complete") {
    hideLoader();
  } else if (document.readyState === "interactive") {
    hideAfterFirstPaint();
  } else {
    document.addEventListener("DOMContentLoaded", hideAfterFirstPaint);
  }
  setTimeout(hideLoader, 2500);
})();
