// 移植自 cancri-code/src/ui/glass-dialog.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
import { attachLiquidPress } from "./liquid-press";
import { attachLongPressCancel } from "./long-press-cancel";
import {
  detectLiquidGlassSupport,
  syncGlassFilterGeometry,
} from "./liquid-glass-surface";

/** 大卡圆角 57px（r_eq 40，见 model-menu-duck.css 形状一节），对应比菜单更宽的边缘透镜。 */
const DIALOG_BEZEL_PX = 32;
/** 取不到计算半径时的兜底值：与 CSS 里的 border-radius 同值（2026-09-14 起 69 → 57）。 */
const DIALOG_RADIUS_FALLBACK = 57;

/**
 * 确认/输入弹窗共用的运行时材质。事件驱动，无常驻 rAF；返回值必须在摘 DOM 前调用。
 */
export function mountGlassDialog(
  card: HTMLElement,
  buttons: readonly HTMLButtonElement[],
): () => void {
  const detachPress = buttons.map((button) => attachLiquidPress(button));
  const detachLongPress = buttons.map((button) => attachLongPressCancel(button));
  const glassRefract = detectLiquidGlassSupport();
  let disposed = false;

  const syncGlass = (): void => {
    if (!glassRefract || disposed || !card.isConnected) return;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    if (width < 2 || height < 2) return;
    const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius);
    syncGlassFilterGeometry(
      "dialog",
      width,
      height,
      Number.isFinite(radius) && radius > 0 ? radius : DIALOG_RADIUS_FALLBACK,
      { bezel: DIALOG_BEZEL_PX },
    );
    card.classList.add("glass-refract");
  };

  const resizeObserver =
    glassRefract && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(syncGlass)
      : null;
  resizeObserver?.observe(card, { box: "border-box" });
  if (glassRefract) {
    syncGlass();
    window.addEventListener("resize", syncGlass);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    window.removeEventListener("resize", syncGlass);
    for (const detach of detachPress) detach();
    for (const detach of detachLongPress) detach();
  };
}
