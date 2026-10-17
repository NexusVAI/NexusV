// 移植自 cancri-code/src/ui/dialog-keyboard.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/** 确认/输入弹窗共享的按键归属；点击不可聚焦的正文后，Esc 仍交给最上层。 */
export function ownsDialogKeyEvent(card: HTMLElement, event: KeyboardEvent): boolean {
  if (event.target instanceof Node && card.contains(event.target)) return true;
  if (event.target !== document.body && event.target !== document.documentElement && event.target !== document) return false;
  const dialogs = document.querySelectorAll(".cc-confirm-backdrop:not([hidden])");
  return dialogs.item(dialogs.length - 1)?.contains(card) ?? false;
}

const DIALOG_FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** 卡片内此刻能 Tab 到的控件（hidden 祖先 / disabled 已排除）。 */
export function listDialogFocusables(card: HTMLElement): HTMLElement[] {
  return [...card.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
}

/**
 * Tab 焦点陷阱（2026-09-18 审计 U-09）。
 * 落到两端或焦点已跑出卡片时循环；中间位置交给浏览器原生顺序。
 * 返回 true = 已处理（调用方不要再当普通键）。
 */
export function trapDialogTab(card: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  const list = listDialogFocusables(card);
  if (list.length === 0) {
    event.preventDefault();
    return true;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && card.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
      return true;
    }
  } else if (!inside || active === last) {
    event.preventDefault();
    first.focus({ preventScroll: true });
    return true;
  }
  return false;
}
