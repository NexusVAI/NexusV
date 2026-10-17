// 移植自 cancri-code/src/ui/long-press-cancel.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 应用功能按钮的长按取消手势。
 *
 * 短按仍走原生 click/键盘激活；主鼠标指针按住达到阈值后松开时，
 * 仅取消这次指针 click。这里不接管 pointer capture，因为液态按压层
 * 已经拥有它；窗口级终止监听保证移出按钮后仍能清理状态。
 */
export const LONG_PRESS_CANCEL_MS = 650;
export const LONG_PRESS_MOVE_PX = 8;
const CLICK_SUPPRESS_MS = 1000;

interface ActivePress {
  target: HTMLElement;
  pointerId: number;
  x: number;
  y: number;
  timer: number;
  moved: boolean;
  left: boolean;
  triggered: boolean;
}

function isPrimaryLeft(event: PointerEvent): boolean {
  return event.button === 0 && event.isPrimary !== false;
}

type LongPressRoot = Document | HTMLElement;
type TargetResolver = (target: EventTarget | null) => HTMLElement | null;

function createLongPressCancelController(
  root: LongPressRoot,
  resolveTarget: TargetResolver,
): () => void {
  let active: ActivePress | null = null;
  let suppressedTarget: HTMLElement | null = null;
  let suppressTimer: number | null = null;

  const clearSuppression = (): void => {
    suppressedTarget = null;
    if (suppressTimer !== null) {
      window.clearTimeout(suppressTimer);
      suppressTimer = null;
    }
  };
  const suppressNextPointerClick = (target: HTMLElement): void => {
    clearSuppression();
    suppressedTarget = target;
    suppressTimer = window.setTimeout(clearSuppression, CLICK_SUPPRESS_MS);
  };
  const clearActive = (): void => {
    if (!active) return;
    window.clearTimeout(active.timer);
    active = null;
  };
  const onPointerDown = (event: PointerEvent): void => {
    const target = resolveTarget(event.target);
    if (!target || !isPrimaryLeft(event) || active) return;
    const press: ActivePress = {
      target,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: 0,
      moved: false,
      left: false,
      triggered: false,
    };
    press.timer = window.setTimeout(() => {
      if (active === press && !press.moved && !press.left) press.triggered = true;
    }, LONG_PRESS_CANCEL_MS);
    active = press;
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!active || active.pointerId !== event.pointerId || active.triggered) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) <= LONG_PRESS_MOVE_PX) return;
    active.moved = true;
    window.clearTimeout(active.timer);
  };
  const onPointerLeave = (event: PointerEvent): void => {
    if (!active || active.pointerId !== event.pointerId || resolveTarget(event.target) !== active.target) return;
    active.left = true;
    window.clearTimeout(active.timer);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (!active || active.pointerId !== event.pointerId) return;
    const triggered = active.triggered;
    const target = active.target;
    clearActive();
    if (triggered) suppressNextPointerClick(target);
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (!active || active.pointerId !== event.pointerId) return;
    clearActive();
    clearSuppression();
  };
  const onBlur = (): void => {
    clearActive();
    clearSuppression();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      clearActive();
      clearSuppression();
    }
  };
  const onContextMenu = (event: MouseEvent): void => {
    const target = resolveTarget(event.target);
    if (active && target === active.target) clearActive();
    if (suppressedTarget && target === suppressedTarget) clearSuppression();
  };
  const onClickCapture = (event: MouseEvent): void => {
    const target = resolveTarget(event.target);
    if (!target || target !== suppressedTarget) return;
    // 键盘/辅助技术 click 的 detail 为 0：保留它的激活语义，并清掉前一次
    // 指针长按留下的抑制窗口，避免下一次真实点击被误伤。
    if (event.detail === 0) {
      clearSuppression();
      return;
    }
    clearSuppression();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // Document | HTMLElement 的 addEventListener 联合重载只接受 Event；事件类型已由
  // 各事件名确定，这几个适配器把该事实显式交给 TypeScript，同时保留可移除的同一引用。
  const onPointerDownRoot: EventListener = (event) => onPointerDown(event as PointerEvent);
  const onPointerLeaveRoot: EventListener = (event) => onPointerLeave(event as PointerEvent);
  const onContextMenuRoot: EventListener = (event) => onContextMenu(event as MouseEvent);
  const onClickCaptureRoot: EventListener = (event) => onClickCapture(event as MouseEvent);

  root.addEventListener("pointerdown", onPointerDownRoot, true);
  root.addEventListener("pointerleave", onPointerLeaveRoot, true);
  root.addEventListener("contextmenu", onContextMenuRoot, true);
  root.addEventListener("click", onClickCaptureRoot, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    clearActive();
    clearSuppression();
    root.removeEventListener("pointerdown", onPointerDownRoot, true);
    root.removeEventListener("pointerleave", onPointerLeaveRoot, true);
    root.removeEventListener("contextmenu", onContextMenuRoot, true);
    root.removeEventListener("click", onClickCaptureRoot, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

/**
 * 给一个按钮接上按压取消。保留单节点入口给有独立生命周期的玻璃弹窗。
 */
export function attachLongPressCancel(el: HTMLElement): () => void {
  return createLongPressCancelController(el, (target) => {
    if (!(target instanceof Node) || (target !== el && !el.contains(target))) return null;
    return el;
  });
}

/**
 * 给应用内所有原生按钮/语义按钮接上同一条长按安全规则。
 *
 * 事件委托不依赖初始 DOM，因此自动化、插件和各种运行时弹窗后来插入的按钮也会覆盖。
 * 玻璃确认弹窗已有自己的生命周期监听，跳过它们以免同一次指针被两层逻辑接管。
 */
export function mountLongPressCancel(root: Document | HTMLElement = document): () => void {
  return createLongPressCancelController(root, (target) => {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLElement>('button, [role="button"]');
    if (!button || !root.contains(button)) return null;
    if (button.closest(".cc-glass-dialog")) return null;
    if (button.matches(":disabled, [aria-disabled=\"true\"]")) return null;
    if (button.closest('[data-long-press-cancel="off"]')) return null;
    return button;
  });
}
