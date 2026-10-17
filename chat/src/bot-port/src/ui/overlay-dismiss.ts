// 移植自 cancri-code/src/ui/overlay-dismiss.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/** 设置页 / API 配置 / 新建文件等卡片：点空白处是否关闭。 */

export const OVERLAY_DISMISS_KEY = "cancri.overlay.backdrop-dismiss";

export type OverlayDismissMode = "x-only" | "backdrop";

export type OverlayStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function parseOverlayDismissMode(raw: string | null): OverlayDismissMode {
  return raw === "x-only" ? "x-only" : "backdrop";
}

export function overlayBackdropDismissEnabled(storage: OverlayStorage = localStorage): boolean {
  try {
    return parseOverlayDismissMode(storage.getItem(OVERLAY_DISMISS_KEY)) === "backdrop";
  } catch {
    return true;
  }
}

export function setOverlayDismissMode(mode: OverlayDismissMode, storage: OverlayStorage = localStorage): void {
  try {
    storage.setItem(OVERLAY_DISMISS_KEY, mode);
  } catch {
    /* quota */
  }
}

export function dismissOverlayIfBackdropClick(
  event: { target: unknown },
  overlayEl: unknown,
  close: () => void,
  storage: OverlayStorage = localStorage,
): boolean {
  if (!overlayEl || event.target !== overlayEl) return false;
  // 按下与松开必须都落在遮罩本身：卡内按下拖到遮罩上松手（或反过来），浏览器会把
  // click 派发给两者的公共祖先 = 遮罩，旧判定因此误关（2026-09-28 用户实报）。
  if (pointerTracked && (lastPointerDown !== overlayEl || lastPointerUp !== overlayEl)) return false;
  if (!overlayBackdropDismissEnabled(storage)) return false;
  close();
  return true;
}

// ── 拖出浮层不算「点外面」（2026-09-28 用户实报：在菜单里按住、拖到外面松手，菜单被关）──
//
// 按下与松开不在同一元素时，click 派发给两者的最近公共祖先。各处「点外面就关」的监听
// 看到的 target 于是落在菜单外（body / 遮罩 / 主区），把一次拖出误判成外部点击。
// 这里在 window 捕获阶段统一拦：若 click 落在按下点的祖先上、且二者之间隔着一个浮层
// （菜单 / 弹层 / 下拉 / 对话框 / 卡片），就吞掉这次 click。按下与松开在同一个按钮里的
// 正常点击（click.target 就是那个按钮）不受影响。

/** 「浮层」判定：角色或类名。宁宽勿窄 —— 误判的代价只是一次拖出的 click 不生效。 */
const SURFACE_SELECTOR = [
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="listbox"]',
  '[class*="menu"]',
  '[class*="popover"]',
  '[class*="dropdown"]',
  '[class*="dialog"]',
  '[class*="modal"]',
  '[class*="palette"]',
  '[class*="card"]',
].join(",");

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "label",
  "summary",
  "input",
  "select",
  "textarea",
  '[role="button"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
].join(",");

let lastPointerDown: EventTarget | null = null;
let lastPointerUp: EventTarget | null = null;
let pointerTracked = false;

function parentAcrossShadow(n: Node): Node | null {
  const p = n.parentNode;
  if (p && typeof ShadowRoot !== "undefined" && p instanceof ShadowRoot) return p.host;
  return p;
}

/**
 * 纯判定：`clickTarget` 是 `downTarget` 的严格祖先，且二者之间（不含 clickTarget）有浮层。
 * 导出供单测。
 */
export function isDragOutOfSurface(downTarget: unknown, clickTarget: unknown): boolean {
  if (!(downTarget instanceof Node) || !(clickTarget instanceof Node)) return false;
  if (downTarget === clickTarget) return false;
  // click 落在一个可交互元素（或其内部）上 = 按下与松开都在同一个控件里，是正常点击。
  if (clickTarget instanceof Element && clickTarget.closest(INTERACTIVE_SELECTOR)) return false;
  let n: Node | null = downTarget;
  let crossedSurface = false;
  while (n && n !== clickTarget) {
    if (n instanceof Element && n.matches(SURFACE_SELECTOR)) crossedSurface = true;
    n = parentAcrossShadow(n);
  }
  // n === null：clickTarget 不是按下点的祖先（另一种派发路径），不干预。
  return n === clickTarget && crossedSurface;
}

let guardInstalled = false;

/** 启动时挂一次（main.ts）。重复调用无副作用。 */
export function installDragOutClickGuard(win: Window = window): void {
  if (guardInstalled) return;
  guardInstalled = true;
  pointerTracked = true;
  const pathTarget = (e: Event): EventTarget | null => e.composedPath?.()[0] ?? e.target;
  win.addEventListener("pointerdown", (e) => { lastPointerDown = pathTarget(e); lastPointerUp = null; }, true);
  win.addEventListener("pointerup", (e) => { lastPointerUp = pathTarget(e); }, true);
  win.addEventListener(
    "click",
    (e) => {
      // 键盘触发的 click（Enter/空格，detail=0）没有指针过程，不参与判定。
      if (e.detail === 0 || e.button !== 0) return;
      if (!isDragOutOfSurface(lastPointerDown, pathTarget(e))) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
}
