/* Shows the welcome coachmark once; 知道了 dismisses it for good (localStorage). */
(function () {
  var KEY = "cancri-api-models-welcome-v1";
  var tour = document.querySelector("[data-welcome-tour]");
  if (!tour || localStorage.getItem(KEY)) return;
  tour.hidden = false;
  tour.querySelector("[data-welcome-tour-ok]").addEventListener("click", function () {
    tour.hidden = true;
    localStorage.setItem(KEY, "1");
  });
})();
