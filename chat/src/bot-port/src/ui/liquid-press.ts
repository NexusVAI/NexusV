// 移植自 cancri-code/src/ui/liquid-press.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 液态按钮的按压挤压 —— 移植自 liquid-glass-webgl 的 `computeElementTransform`
 * （其上游是 Compose 的 `LiquidButton.kt` layerBlock）。
 *
 * 数学逐行照搬：按下整体放大 4/48，拖拽时沿拖动方向额外拉伸、并用 tanh 阻尼位移，
 * 松手由欠阻尼弹簧（ζ=0.5, k=300）弹回。
 *
 * ⚠ 与上游的**唯一有意差异**：上游 Dialog 的 Cancel/Okay 文字是独立的 WebGL
 * `kind:'text'` 元素，`fgScaleX/Y` 恒为 1（`methods-render-nonglass-text.ts`），
 * 所以胶囊被挤压时字是钉住不动的——看着像字浮在一块会变形的板上。
 * 这里把 transform 打在**按钮元素本身**，label 是它的子节点，于是文字跟着一起挤压，
 * 也就是上游 Buttons 演示页那条 `uv = localCoord / uSize` 路径的效果。
 * 别改成给内层 label 反向 transform 抵消——那正是要修的 bug。
 *
 * 除了形变，本模块还输出**按压高光**（上游 `InteractiveHighlight.kt`，见
 * `renderer/methods-render-glass-post-passes-glow.ts:76-161`）所需的四个 CSS 变量。
 * 高光本身由 CSS 的 `::after` 画（见 model-menu-duck.css），这里只喂数据。
 */

import { createSpring, type Spring } from "../components/liquid-controls/spring";

/** 按满时整体放大比例（上游 4dp / 48dp 按钮高） */
export const PRESS_SCALE_RATIO = 4 / 48;
/** tanh 位移的初始斜率：手指移 1px，按钮只跟 0.05px 起步 */
export const DRAG_INITIAL_DERIVATIVE = 0.05;
/** 按压/拖拽弹簧：欠阻尼，松手有一点回弹 */
export const PRESS_SPRING = { stiffness: 300, dampingRatio: 0.5 } as const;
/**
 * 按压高光的半径系数。上游 `uRadius = min(w,h) * 1.5`
 * （`methods-render-glass-post-passes-glow.ts:132-133`），配合 shader 的
 * `smoothstep(radius, radius*0.5, dist)` = 内半径处满强度、到外半径衰减为 0。
 */
export const GLOW_RADIUS_RATIO = 1.5;

export interface PressInput {
  /** 按钮静止尺寸（CSS px） */
  width: number;
  height: number;
  /** 指针相对按下点的位移 */
  dragX: number;
  dragY: number;
  /** 按压进度 0..1（弹簧输出，可能略微过冲出界） */
  press: number;
}

export interface PressTransform {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

export const IDENTITY_TRANSFORM: PressTransform = {
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
};

/**
 * 纯函数。零尺寸时返回单位变换——按钮还没布局就算，会得到 NaN 并把 transform 写坏。
 */
export function computePressTransform(input: PressInput): PressTransform {
  const { width, height, dragX, dragY, press } = input;
  if (!(width > 0) || !(height > 0)) return { ...IDENTITY_TRANSFORM };

  const maxDim = Math.max(width, height);
  const maxOffset = Math.min(width, height);
  const scale = 1 + PRESS_SCALE_RATIO * press;

  const translateX = maxOffset * Math.tanh((DRAG_INITIAL_DERIVATIVE * dragX) / maxOffset);
  const translateY = maxOffset * Math.tanh((DRAG_INITIAL_DERIVATIVE * dragY) / maxOffset);

  // 沿拖动方向额外拉伸；whCap/hwCap 保证细长按钮不会在短边方向被拉爆
  const angle = Math.atan2(dragY, dragX);
  const whCap = Math.min(width / height, 1);
  const hwCap = Math.min(height / width, 1);
  const scaleX = scale + PRESS_SCALE_RATIO * Math.abs((Math.cos(angle) * dragX) / maxDim) * whCap;
  const scaleY = scale + PRESS_SCALE_RATIO * Math.abs((Math.sin(angle) * dragY) / maxDim) * hwCap;

  return { scaleX, scaleY, translateX, translateY };
}

/** 静止态不写 transform，省得凭空给按钮建合成层。 */
export function pressTransformCss(t: PressTransform): string {
  const flat =
    Math.abs(t.scaleX - 1) < 1e-4 &&
    Math.abs(t.scaleY - 1) < 1e-4 &&
    Math.abs(t.translateX) < 1e-3 &&
    Math.abs(t.translateY) < 1e-3;
  if (flat) return "";
  return (
    `translate(${t.translateX.toFixed(2)}px, ${t.translateY.toFixed(2)}px)` +
    ` scale(${t.scaleX.toFixed(4)}, ${t.scaleY.toFixed(4)})`
  );
}

export interface LiquidPressOptions {
  /** 关掉动效（默认跟随系统 prefers-reduced-motion） */
  reduceMotion?: boolean;
  /**
   * 可选的 pointer capture 宿主。形变可以挂在外层 surface 上，但让真正的
   * button 继续收到 pointerup/click；不传时仍由形变元素自己 capture。
   */
  pointerCaptureTarget?: HTMLElement;
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * 给一个按钮接上按压挤压。返回解绑函数。
 *
 * 用 pointer capture：手指按住往外滑再松开，仍然由本元素收到 pointerup，
 * 不会留下一个永远回不去的按下态。
 */
export function attachLiquidPress(
  el: HTMLElement,
  opts: LiquidPressOptions = {},
): () => void {
  const reduce = opts.reduceMotion ?? prefersReducedMotion();
  if (reduce) return () => {};
  const pointerCaptureTarget = opts.pointerCaptureTarget ?? el;

  let width = 0;
  let height = 0;
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;
  /** 指尖在按钮内的**局部坐标**（不是位移量）——高光要画在手指下面 */
  let glowX = 0;
  let glowY = 0;

  const springs: Spring[] = [];
  const paint = () => {
    const t = computePressTransform({
      width,
      height,
      dragX: dragXSpring.value(),
      dragY: dragYSpring.value(),
      press: pressSpring.value(),
    });
    el.style.transform = pressTransformCss(t);
    // 高光强度跟弹簧走（松手渐隐）；弹簧是欠阻尼的，会冲到 0 以下，钳一下免得
    // opacity 收到负值（Chromium 会当 0，但 Firefox/jsdom 上是无效值 → 整条被丢弃）。
    const press = Math.max(0, pressSpring.value());
    el.style.setProperty("--lp-press", press.toFixed(4));
  };
  /**
   * 位置**不过弹簧**：上游取的是 `st.dragX/dragY` 原始指尖位置
   * （glow.ts:155-156），高光紧跟手指、body 靠弹簧滞后，两者的时间差正是"液体"的手感。
   */
  const paintGlowPos = () => {
    el.style.setProperty("--lp-x", `${glowX.toFixed(1)}px`);
    el.style.setProperty("--lp-y", `${glowY.toFixed(1)}px`);
    el.style.setProperty("--lp-r", `${(Math.min(width, height) * GLOW_RADIUS_RATIO).toFixed(1)}px`);
  };
  /** 指尖位置钳在按钮内（上游 `clamp(0, sw)` / `clamp(0, sh)`）。 */
  const setGlowFromClient = (clientX: number, clientY: number) => {
    const rect = el.getBoundingClientRect();
    glowX = Math.max(0, Math.min(width, clientX - rect.left));
    glowY = Math.max(0, Math.min(height, clientY - rect.top));
    paintGlowPos();
  };

  const pressSpring = createSpring({ ...PRESS_SPRING, initial: 0, onFrame: paint });
  const dragXSpring = createSpring({ ...PRESS_SPRING, initial: 0, onFrame: paint });
  const dragYSpring = createSpring({ ...PRESS_SPRING, initial: 0, onFrame: paint });
  springs.push(pressSpring, dragXSpring, dragYSpring);

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== null || e.button !== 0) return;
    const rect = el.getBoundingClientRect();
    // 量的是**静止**尺寸：rect 已经含上一帧的 transform，拿它当基准会自激放大
    width = el.offsetWidth || rect.width;
    height = el.offsetHeight || rect.height;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    setGlowFromClient(e.clientX, e.clientY);
    try {
      pointerCaptureTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境不支持捕获；退化成只认本元素上的事件 */
    }
    pressSpring.setTarget(1);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    dragXSpring.setTarget(e.clientX - startX);
    dragYSpring.setTarget(e.clientY - startY);
    setGlowFromClient(e.clientX, e.clientY);
  };

  const release = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    try {
      pointerCaptureTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 已经自动释放 */
    }
    pressSpring.setTarget(0);
    dragXSpring.setTarget(0);
    dragYSpring.setTarget(0);
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", release);
    el.removeEventListener("pointercancel", release);
    for (const s of springs) s.destroy();
    el.style.transform = "";
    for (const v of ["--lp-press", "--lp-x", "--lp-y", "--lp-r"]) el.style.removeProperty(v);
  };
}
