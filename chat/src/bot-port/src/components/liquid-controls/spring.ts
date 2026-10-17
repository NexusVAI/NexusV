// 移植自 cancri-code/src/components/liquid-controls/spring.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 弹簧物理引擎 —— 液态玻璃开关/滑块的「丝滑追手 + 挤压弹动」核心。
 *
 * 对应源组件 DampedDragAnimation.kt 的四条 Android SpringForce：
 *   value/pressProgress: spring(stiffness=1000, dampingRatio=1)  临界阻尼，无过冲
 *   scaleX:              spring(250, 0.6)                        欠阻尼 → 回弹
 *   scaleY:              spring(250, 0.7)
 *
 * 实现：半隐式欧拉积分 + 共享 rAF ticker（只在没有静止弹簧时停表）。
 * stepSpring 是纯函数，vitest（node 环境）直接锁收敛/过冲特性。
 */

export interface SpringState {
  /** 当前值 */
  x: number;
  /** 当前速度（单位/秒） */
  v: number;
}

/** 临界/欠/过阻尼系数：c = 2 · ratio · √k（mass=1）。 */
export function springDamping(stiffness: number, dampingRatio: number): number {
  return 2 * dampingRatio * Math.sqrt(stiffness);
}

/** 静止判定阈值（值/速度）。 */
export const SPRING_REST_DELTA = 1e-4;
export const SPRING_REST_VELOCITY = 1e-3;

/**
 * 推进一步（纯函数）。dt 单位秒，调用方必须钳制（帧间隔异常时 ≤32ms）。
 * 返回新状态；atRest=true 表示可停表（值已贴目标、速度近零，并强制贴齐）。
 */
export function stepSpring(
  state: SpringState,
  target: number,
  stiffness: number,
  dampingRatio: number,
  dt: number,
): { state: SpringState; atRest: boolean } {
  const c = springDamping(stiffness, dampingRatio);
  const a = -stiffness * (state.x - target) - c * state.v;
  const v = state.v + a * dt;
  const x = state.x + v * dt;
  const atRest = Math.abs(x - target) < SPRING_REST_DELTA && Math.abs(v) < SPRING_REST_VELOCITY;
  return { state: atRest ? { x: target, v: 0 } : { x, v }, atRest };
}

export interface SpringOptions {
  stiffness: number;
  dampingRatio: number;
  initial: number;
  /** 每帧回调（值变化时）。 */
  onFrame?: (value: number, velocity: number) => void;
}

export interface Spring {
  setTarget(target: number): void;
  /** 立即跳到某值（可选保留速度）。 */
  jumpTo(value: number, opts?: { keepVelocity?: boolean }): void;
  value(): number;
  velocity(): number;
  /** 注入速度冲量（拖拽松手时把旋钮速度灌进挤压弹簧 → 回弹）。 */
  impulse(velocity: number): void;
  destroy(): void;
}

/* ---- 共享 rAF ticker：活跃弹簧集合非空才跑，全静止自动停 ---- */
const activeSprings = new Set<SpringImpl>();
let rafId: number | null = null;
let lastTs = 0;

function tick(ts: number): void {
  // 钳制帧间隔：切后台/断点调试回来不至于一帧飞出去
  const dt = Math.min(0.032, Math.max(0.001, (ts - lastTs) / 1000));
  lastTs = ts;
  for (const s of Array.from(activeSprings)) s.step(dt);
  if (activeSprings.size === 0) {
    rafId = null;
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function ensureTicker(): void {
  if (rafId !== null || typeof requestAnimationFrame === "undefined") return;
  lastTs = performance.now();
  rafId = requestAnimationFrame(tick);
}

class SpringImpl implements Spring {
  private state: SpringState;
  private target: number;
  private readonly stiffness: number;
  private readonly dampingRatio: number;
  private readonly onFrame?: (value: number, velocity: number) => void;
  private destroyed = false;

  constructor(opts: SpringOptions) {
    this.stiffness = opts.stiffness;
    this.dampingRatio = opts.dampingRatio;
    this.state = { x: opts.initial, v: 0 };
    this.target = opts.initial;
    this.onFrame = opts.onFrame;
  }

  setTarget(target: number): void {
    if (this.destroyed || target === this.target) return;
    this.target = target;
    activeSprings.add(this);
    ensureTicker();
  }

  jumpTo(value: number, opts?: { keepVelocity?: boolean }): void {
    this.state = { x: value, v: opts?.keepVelocity ? this.state.v : 0 };
    this.target = value;
    activeSprings.delete(this);
    this.onFrame?.(this.state.x, this.state.v);
  }

  value(): number {
    return this.state.x;
  }

  velocity(): number {
    return this.state.v;
  }

  impulse(velocity: number): void {
    if (this.destroyed) return;
    this.state = { x: this.state.x, v: this.state.v + velocity };
    activeSprings.add(this);
    ensureTicker();
  }

  /** 供 ticker 调用：推进一帧；静止则自摘。 */
  step(dt: number): void {
    if (this.destroyed) {
      activeSprings.delete(this);
      return;
    }
    const { state, atRest } = stepSpring(this.state, this.target, this.stiffness, this.dampingRatio, dt);
    this.state = state;
    this.onFrame?.(state.x, state.v);
    if (atRest) activeSprings.delete(this);
  }

  destroy(): void {
    this.destroyed = true;
    activeSprings.delete(this);
  }
}

export function createSpring(opts: SpringOptions): Spring {
  return new SpringImpl(opts);
}
