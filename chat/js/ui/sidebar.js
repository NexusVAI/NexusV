function isMobileViewport() {
  return window.innerWidth <= 768;
}

function syncSidebarState(sidebar) {
  if (!sidebar) return;
  const collapsed = sidebar.classList.contains('collapsed');
  sidebar.dataset.collapsed = String(!isMobileViewport() && collapsed);
  // 2026-08-12 审计#4：移动端 open 语义必须读 is-mobile-open / body.sidebar-open，
  // 不能用 !collapsed 推导——.collapsed 自 08-11 起延迟 220ms 落地（关闭滑出期间
  // 内容需可见），原推导会在关闭窗口期把 dataset.open 回写成 "true"，毒化
  // claude_ui.js isDrawerOpen() 的三源判定，导致关后第一次点汉堡被吞。
  const mobileOpen =
    sidebar.classList.contains('is-mobile-open') ||
    document.body.classList.contains('sidebar-open');
  sidebar.dataset.open = String(isMobileViewport() && mobileOpen);
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

