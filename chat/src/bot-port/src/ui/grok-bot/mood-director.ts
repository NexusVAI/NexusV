// 移植自 cancri-code/src/ui/grok-bot/mood-director.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 表情切换调度器 —— 「动画播完再换」的唯一实现。
 *
 * 为什么需要它：引擎的 setState 会**立刻**重置眼睛插值、body 形变、正在飞的
 * 转圈/弹跳。agent 的状态在一次 turn 里可能每几百毫秒抖一次（工具开始/结束、
 * 正文 delta、参数流），直接透传就是每个动作都播到一半被砍掉，看起来是卡顿而不是流畅。
 *
 * 规则只有三条：
 *   1. 每个表情有 holdMs —— 播够这么久才允许被换走；
 *   2. 只有 urgency 更高的表情能提前抢占，且仍受 floorMs 地板保护（防两个高优先级互相打断）；
 *   3. desired 只有一个槽 —— 压着的这段时间里目标变了几次都不管，到点只播**最新**那个。
 *
 * 第 3 条是刻意不做队列：排队会把已经过时的状态补播一遍，视觉上比抖动更糟
 * （用户看到的表情落后于真实进度）。想被看见的短事件应该走一次性特效（粒子/弹跳），
 * 不要走状态。
 */

export interface MoodSpec {
  /** 至少占住多久（毫秒）才允许被换走 */
  holdMs: number;
  /** 越大越急；只有严格更大的才能在 holdMs 内抢占 */
  urgency: number;
}

export interface DirectorConfig<M extends string> {
  specs: Record<M, MoodSpec>;
  /** 无论多急都不允许比这个更快地连切，防高优先级之间互相打断 */
  floorMs: number;
  fallback: MoodSpec;
}

export interface DirectorState<M extends string> {
  /** 已经真正下发给引擎的表情 */
  applied: M;
  appliedAt: number;
  /** 最新想要的表情（只有一个槽，天然合并） */
  desired: M;
}

export const DEFAULT_FLOOR_MS = 420;

export function createDirector<M extends string>(initial: M, now: number): DirectorState<M> {
  return { applied: initial, appliedAt: now, desired: initial };
}

/** 记录「现在想变成什么」。不立刻生效，等 tick 判定。 */
export function requestMood<M extends string>(
  state: DirectorState<M>,
  mood: M,
  ): DirectorState<M> {
  if (mood === state.desired) return state;
  return { ...state, desired: mood };
}

function specOf<M extends string>(cfg: DirectorConfig<M>, mood: M): MoodSpec {
  return cfg.specs[mood] ?? cfg.fallback;
}

export interface TickResult<M extends string> {
  state: DirectorState<M>;
  /** 非 null 表示这一帧要调 engine.setState(emit) */
  emit: M | null;
}

/**
 * 判定这一帧要不要换。调用方按固定频率（或收到事件时）调用，幂等。
 */
export function tickDirector<M extends string>(
  state: DirectorState<M>,
  cfg: DirectorConfig<M>,
  now: number,
): TickResult<M> {
  if (state.desired === state.applied) return { state, emit: null };

  const elapsed = now - state.appliedAt;
  const current = specOf(cfg, state.applied);
  const next = specOf(cfg, state.desired);

  const playedOut = elapsed >= current.holdMs;
  const preempts = next.urgency > current.urgency && elapsed >= cfg.floorMs;
  if (!playedOut && !preempts) return { state, emit: null };

  return {
    state: { applied: state.desired, appliedAt: now, desired: state.desired },
    emit: state.desired,
  };
}

/**
 * 距离下一次「可能可以换」还有多久，用于把轮询间隔调稀。
 * 返回 0 表示现在就能换（或没有待办）。
 */
export function msUntilSwitchable<M extends string>(
  state: DirectorState<M>,
  cfg: DirectorConfig<M>,
  now: number,
): number {
  if (state.desired === state.applied) return 0;
  const elapsed = now - state.appliedAt;
  const current = specOf(cfg, state.applied);
  const next = specOf(cfg, state.desired);
  const gate = next.urgency > current.urgency
    ? Math.min(cfg.floorMs, current.holdMs)
    : current.holdMs;
  return Math.max(0, gate - elapsed);
}
