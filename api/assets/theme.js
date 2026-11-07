/* Theme for /api pages. Runs blocking in <head> so the first paint already has the right colours.
 * Preference: cancri_oai_theme = light | dark | system. The main site's `theme` (light|dark|warm|blue,
 * honoured only when theme_user=1) also counts, so switching on either side keeps both in step.
 * Applied like OpenAI's theme.js: html.dark + data-theme. */
(function () {
  var KEY = "cancri_oai_theme";
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function read() {
    try {
      var pref = localStorage.getItem(KEY);
      if (pref === "system") return "system";
      if (localStorage.getItem("theme_user") === "1") {
        var site = localStorage.getItem("theme");
        if (site === "light") return "light";
        if (site === "dark" || site === "warm" || site === "blue") return "dark";
      }
      if (pref === "light" || pref === "dark") return pref;
    } catch (e) {}
    return "light";
  }

  function resolve(pref) {
    return pref === "system" ? (media && media.matches ? "dark" : "light") : pref;
  }

  function apply(pref) {
    var theme = resolve(pref);
    var root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-preference", pref);
  }

  function save(pref) {
    try {
      localStorage.setItem(KEY, pref);
      if (pref !== "system") {
        localStorage.setItem("theme", pref);
        localStorage.setItem("theme_user", "1");
      }
    } catch (e) {}
  }

  apply(read());
  if (media && media.addEventListener) {
    media.addEventListener("change", function () {
      if (read() === "system") apply("system");
    });
  }
  window.addEventListener("storage", function (e) {
    if (!e.key || e.key === KEY || e.key === "theme" || e.key === "theme_user") apply(read());
  });
  window.__apiTheme = { read: read, apply: apply, save: save };
})();
