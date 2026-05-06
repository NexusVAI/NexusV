const UI_PREFS_STORAGE_KEY = 'cancri_ui_prefs';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(UI_PREFS_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writePrefs(nextPrefs) {
  try {
    const prefs = { ...readPrefs(), ...nextPrefs };
    localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Local storage may be unavailable in restricted browser modes.
  }
}

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  const app = window.CancriApp;

  if (app?.state) {
    app.state.theme = normalized;
  }

  if (typeof app?.applyTheme === 'function') {
    app.applyTheme();
  } else {
    document.documentElement.setAttribute('data-theme', normalized);
    writePrefs({ theme: normalized });
  }

  updateThemeLabel(normalized);
}

function updateThemeLabel(theme = document.documentElement.getAttribute('data-theme')) {
  const label = document.getElementById('sidebarThemeLabel');
  if (!label) return;
  label.textContent = theme === 'dark' ? '浅色模式' : '深色模式';
}

export function initThemeBridge() {
  updateThemeLabel();

  document.getElementById('sidebarThemeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  const observer = new MutationObserver(() => updateThemeLabel());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

