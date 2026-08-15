/**
 * CancriCode landing theme controller
 * -----------------------------------
 * - Persists light/dark in localStorage
 * - Drives html[data-cancri-theme]
 * - Wires [data-cancri-role="theme-toggle"]
 *
 * Keep FAQ / other page behavior in cancri-site.js.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'cancri-landing-theme';
  var THEMES = { light: 'light', dark: 'dark' };

  function readStoredTheme() {
    try {
      var value = localStorage.getItem(STORAGE_KEY);
      return value === THEMES.dark ? THEMES.dark : THEMES.light;
    } catch (err) {
      return THEMES.light;
    }
  }

  function writeStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-cancri-theme') === THEMES.dark
      ? THEMES.dark
      : THEMES.light;
  }

  function syncToggle(theme) {
    var buttons = document.querySelectorAll('[data-cancri-role="theme-toggle"]');
    buttons.forEach(function (button) {
      var sun = button.querySelector('.cancri-theme-toggle__sun');
      var moon = button.querySelector('.cancri-theme-toggle__moon');
      var isDark = theme === THEMES.dark;
      if (sun) sun.hidden = !isDark;
      if (moon) moon.hidden = isDark;
      button.setAttribute('aria-label', isDark ? '切换浅色模式' : '切换深色模式');
      button.setAttribute('title', isDark ? '切换浅色模式' : '切换深色模式');
      button.setAttribute('aria-pressed', String(isDark));
    });
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return false;
    }
  }

  function commitTheme(next) {
    if (next === THEMES.dark) {
      document.documentElement.setAttribute('data-cancri-theme', THEMES.dark);
    } else {
      document.documentElement.removeAttribute('data-cancri-theme');
    }
    document.documentElement.style.colorScheme = next;
    writeStoredTheme(next);
    syncToggle(next);
    try {
      document.dispatchEvent(
        new CustomEvent('cancri:themechange', { detail: { theme: next } })
      );
    } catch (err) {
      /* older browsers without CustomEvent — ignore */
    }
  }

  /**
   * @param {string} theme
   * @param {{ animate?: boolean }} [options] — animate only on user toggle, not first paint
   */
  function applyTheme(theme, options) {
    var next = theme === THEMES.dark ? THEMES.dark : THEMES.light;
    var animate = !!(options && options.animate) && !prefersReducedMotion();
    var root = document.documentElement;

    if (!animate) {
      commitTheme(next);
      return;
    }

    // Prefer View Transitions API (whole-page crossfade).
    if (typeof document.startViewTransition === 'function') {
      root.classList.add('cancri-theme-vt');
      var transition = document.startViewTransition(function () {
        commitTheme(next);
      });
      var clearVt = function () {
        root.classList.remove('cancri-theme-vt');
      };
      if (transition && transition.finished && transition.finished.finally) {
        transition.finished.finally(clearVt);
      } else {
        window.setTimeout(clearVt, 500);
      }
      return;
    }

    // Fallback: brief CSS color/background transitions.
    root.classList.add('cancri-theme-animating');
    commitTheme(next);
    window.setTimeout(function () {
      root.classList.remove('cancri-theme-animating');
    }, 420);
  }

  function toggleTheme() {
    applyTheme(currentTheme() === THEMES.dark ? THEMES.light : THEMES.dark, {
      animate: true
    });
  }

  function initThemeToggle() {
    var buttons = document.querySelectorAll('[data-cancri-role="theme-toggle"]');
    buttons.forEach(function (button) {
      if (button.dataset.cancriReady === 'true') return;
      button.dataset.cancriReady = 'true';
      button.addEventListener('click', toggleTheme);
    });
    syncToggle(currentTheme());
  }

  function init() {
    applyTheme(readStoredTheme());
    initThemeToggle();
  }

  window.CancriTheme = {
    apply: applyTheme,
    toggle: toggleTheme,
    current: currentTheme
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
