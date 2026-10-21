/* Shows the welcome coachmark once; 知道了 dismisses it for good (localStorage). */
(function () {
  var KEY = "cancri-api-models-welcome-v1";
  var tour = document.querySelector("[data-welcome-tour]");
  if (!tour) return;
  try {
    if (localStorage.getItem(KEY)) return;
  } catch (_) {}
  tour.hidden = false;
  var okBtn = tour.querySelector("[data-welcome-tour-ok]");
  if (okBtn) {
    okBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      tour.hidden = true;
      try {
        localStorage.setItem(KEY, "1");
      } catch (_) {}
    });
  }
})();
