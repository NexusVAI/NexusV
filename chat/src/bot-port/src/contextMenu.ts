// 移植自 cancri-code/src/contextMenu.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — 轻量右键菜单（0.20.0-beta.3）
 *
 * showContextMenu(x, y, items, opts?)：在坐标处弹出浮层菜单，点击项执行回调；
 * 点击外部 / Esc / 滚动自动关闭。单例，新菜单替换旧的。
 *
 * 传入 opts.trigger 时：
 * - 再点同一触发器 → toggle 关闭（不重开）
 * - 文档 pointerdown/mousedown 忽略该触发器（避免「先关后 click 再开」）
 *
 * 材质：与模型菜单同款液态玻璃（glass-active / glass-refract）。
 * 透明/Mica backdrop 在 SVG 输入前由液态玻璃滤镜垫主题底色，账户菜单和侧栏右键菜单
 * 都保留完整的三通道位移/色散折射链。
 * 开关：渐隐渐显（.closing 退场）。
 */

import { detectLiquidGlassSupport, syncGlassFilterGeometry } from "./ui/liquid-glass-surface";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  /** 可选图标（内联 SVG 字符串），卡片式菜单项左侧显示 */
  icon?: string;
  /** 置灰不可点 */
  disabled?: boolean;
  /** 在此项前加一条分隔线 */
  separatorBefore?: boolean;
}

export interface ShowContextMenuOptions {
  /** 触发按钮：再点同一按钮关闭，文档 mousedown 不把它当「点外部」 */
  trigger?: Element | null;
  /**
   * 定位锚元素：只参与「滚动关菜单」判定——锚点不动的滚动不关菜单。
   * 与 trigger 不同：不开 toggle、不把锚点上的点击当成「点触发器」。
   * 右键菜单没有按钮触发器，用它锚到被右击的那个标签上（2026-09-25 实报：
   * 不传的话模型每推一步聊天区追底滚动，window 捕获的 scroll 就把菜单关了）。
   */
  anchor?: Element | null;
  /**
   * 菜单真正销毁后回调（含被新菜单替换、点项、点外部、Esc）。
   * 侧栏靠它在「行菜单开着时推迟重建」之后补刷一次（BUG-001）。
   */
  onClose?: () => void;
}

/**
 * ⛔ 2026-08-20 移除 `backdropSource: "sidebar"`（用户实报）。
 *
 * 它的作用是打开侧栏右键菜单时给 `<html>` 挂 `ctx-menu-sidebar-open`，由 devin-ui.css
 * 把 `.sidebar` 临时刷成实色，好让菜单的 backdrop-filter 折射到项目/对话像素而不是
 * 透明 Mica 后面的桌面。代价是：用户正盯着的那条侧栏在右键瞬间从毛玻璃变实色。
 * 折射源不理想 << 面板换了个样子，所以整条通道连同 CSS 规则一起删。
 * 菜单浅色下是 rgba(250,250,251,0.66)，可读性从来不依赖这条规则。
 */
let activeMenu: HTMLElement | null = null;
let activeTrigger: Element | null = null;
let activeAnchor: Element | null = null;
let activeOnClose: (() => void) | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let activeGlassResizeObserver: ResizeObserver | null = null;

function unbindDismiss() {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("mousedown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("blur", onBlurClose);
  window.removeEventListener("scroll", onScrollClose, true);
}

function destroyMenu(menu: HTMLElement) {
  activeGlassResizeObserver?.disconnect();
  activeGlassResizeObserver = null;
  if (activeTrigger instanceof HTMLElement) {
    activeTrigger.setAttribute("aria-expanded", "false");
  }
  let onClose: (() => void) | null = null;
  if (activeMenu === menu) {
    activeMenu = null;
    activeTrigger = null;
    activeAnchor = null;
    onClose = activeOnClose;
    activeOnClose = null;
  }
  menu.remove();
  unbindDismiss();
  if (onClose) {
    try { onClose(); } catch (err) { console.warn("[ctxmenu] onClose throw:", err); }
  }
}

/** @param immediate 为 true 时跳过渐隐（例如立刻换成新菜单） */
function closeMenu(immediate = false) {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  const menu = activeMenu;
  if (!menu) return;
  if (immediate || menu.classList.contains("closing")) {
    destroyMenu(menu);
    return;
  }
  menu.classList.add("closing");
  menu.style.pointerEvents = "none";
  const finish = () => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    destroyMenu(menu);
  };
  menu.addEventListener("animationend", finish, { once: true });
  closeTimer = setTimeout(finish, 200);
}

function isOnTrigger(target: EventTarget | null): boolean {
  if (!activeTrigger || !(target instanceof Node)) return false;
  return activeTrigger === target || activeTrigger.contains(target);
}

/**
 * 点菜单外关闭；点在 trigger 上则忽略——交给 trigger 的 click / showContextMenu toggle。
 * 同时听 pointerdown + mousedown（WebView2 / 触控兜底）。
 */
function onDocPointerDown(e: Event) {
  if (!activeMenu) return;
  const target = (e as PointerEvent | MouseEvent).target;
  if (target instanceof Node && activeMenu.contains(target)) return;
  if (isOnTrigger(target)) return;
  closeMenu(false);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape") closeMenu(false);
}
function onBlurClose() {
  closeMenu(false);
}

/** 只有会让触发器锚点移动的滚动才关菜单；聊天区自动追底与右侧菜单互不相干。 */
export function shouldCloseContextMenuForScroll(
  eventTarget: EventTarget | null,
  trigger: Element | null,
): boolean {
  if (!trigger) return true;
  if (!(eventTarget instanceof Node)) return true;
  if (eventTarget === document || eventTarget === document.documentElement || eventTarget === document.body) {
    return true;
  }
  if (!(eventTarget instanceof Element)) return true;
  return eventTarget === trigger || eventTarget.contains(trigger) || trigger.contains(eventTarget);
}

function onScrollClose(e: Event) {
  if (shouldCloseContextMenuForScroll(e.target, activeTrigger ?? activeAnchor)) closeMenu(false);
}

const CTX_MENU_RADIUS = 24;

/** 当前是否正由该触发器打开（含退场动画中）。 */
export function isContextMenuOpenFor(trigger: Element | null | undefined): boolean {
  return !!(activeMenu && trigger && activeTrigger === trigger);
}

export function closeContextMenu(immediate = true): void {
  closeMenu(immediate);
}

export function showContextMenu(
  x: number,
  y: number,
  items: ContextMenuItem[],
  opts?: ShowContextMenuOptions,
): void {
  const trigger = opts?.trigger ?? null;

  // 再点同一触发器：关闭，绝不重开
  if (activeMenu && trigger && activeTrigger === trigger) {
    closeMenu(true);
    return;
  }

  closeMenu(true);
  const menu = document.createElement("div");
  menu.className = "ctx-menu glass-active";
  const glassRefract = detectLiquidGlassSupport();
  if (glassRefract) menu.classList.add("glass-refract");
  for (const item of items) {
    if (item.separatorBefore) {
      const sep = document.createElement("div");
      sep.className = "ctx-menu-sep";
      menu.appendChild(sep);
    }
    const el = document.createElement("button");
    el.type = "button";
    el.className = "ctx-menu-item";
    if (item.disabled) el.classList.add("disabled");
    if (item.icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "ctx-menu-icon";
      iconEl.setAttribute("aria-hidden", "true");
      iconEl.innerHTML = item.icon;
      el.appendChild(iconEl);
      const labelEl = document.createElement("span");
      labelEl.className = "ctx-menu-label";
      labelEl.textContent = item.label;
      el.appendChild(labelEl);
    } else {
      el.textContent = item.label;
    }
    if (!item.disabled) {
      el.addEventListener("click", () => {
        closeMenu(false);
        try { item.onClick(); } catch (err) { console.warn("[ctxmenu] item throw:", err); }
      });
    }
    menu.appendChild(el);
  }
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
  if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  menu.style.visibility = "visible";

  const syncGlassGeometry = () => {
    if (!menu.classList.contains("glass-refract")) return;
    const r = menu.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2) {
      syncGlassFilterGeometry("ctx", r.width, r.height, CTX_MENU_RADIUS);
    }
  };
  if (glassRefract) {
    if (typeof ResizeObserver !== "undefined") {
      activeGlassResizeObserver = new ResizeObserver(syncGlassGeometry);
      activeGlassResizeObserver.observe(menu);
    }
    // The first frame only establishes fixed layout; the second frame samples
    // the painted menu box, matching the model picker’s real glass lifecycle.
    requestAnimationFrame(() => requestAnimationFrame(syncGlassGeometry));
  }
  activeMenu = menu;
  activeTrigger = trigger;
  activeAnchor = opts?.anchor ?? null;
  activeOnClose = opts?.onClose ?? null;
  if (trigger instanceof HTMLElement) {
    trigger.setAttribute("aria-expanded", "true");
  }
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("mousedown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", onBlurClose);
  window.addEventListener("scroll", onScrollClose, true);
}
