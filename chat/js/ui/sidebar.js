function isMobileViewport() {
  return window.innerWidth <= 768;
}

function syncSidebarState(sidebar) {
  if (!sidebar) return;
  const collapsed = sidebar.classList.contains('collapsed');
  sidebar.dataset.collapsed = String(!isMobileViewport() && collapsed);
  sidebar.dataset.open = String(isMobileViewport() && !collapsed);
}

function openSettingsFallback() {
  const legacySettings = document.getElementById('settingsBtn');
  if (legacySettings) {
    legacySettings.click();
    return;
  }

  const modal = document.getElementById('settingsModal');
  const scrim = document.getElementById('scrim');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  scrim?.classList.add('show');
}

export function initSidebarWorkbench() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const syncSoon = () => requestAnimationFrame(() => syncSidebarState(sidebar));
  syncSidebarState(sidebar);

  document.getElementById('sidebarToggle')?.addEventListener('click', syncSoon);
  document.getElementById('mobileMenuBtn')?.addEventListener('click', syncSoon);
  document.getElementById('scrim')?.addEventListener('click', syncSoon);
  document.addEventListener('click', syncSoon);
  window.addEventListener('resize', syncSoon);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') syncSoon();
  });

}

