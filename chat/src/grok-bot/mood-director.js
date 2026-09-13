/**
 * 表情切换调度器 —— 「动画播完再换」的唯一实现。
 * 移植自 cancri-code src/ui/grok-bot/mood-director.ts（去类型，逻辑逐字保留）。
 *
 * 为什么需要它：引擎的 setState 会**立刻**重置眼睛插值、body 形变、正在飞的
 * 转圈/弹跳。直接透传就是每个动作都播到一半被砍掉，看起来是卡顿而不是流畅。
 *
 * 规则只有三条：
 *   1. 每个表情有 holdMs —— 播够这么久才允许被换走；
 *   2. 只有 urgency 更高的表情能提前抢占，且仍受 floorMs 地板保护（防两个高优先级互相打断）；
 *   3. desired 只有一个槽 —— 压着的这段时间里目标变了几次都不管，到点只播**最新**那个。
 */

export const DEFAULT_FLOOR_MS = 420;

export function createDirector(initial, now) {
  return { applied: initial, appliedAt: now, desired: initial };
}

/** 记录「现在想变成什么」。不立刻生效，等 tick 判定。 */
export function requestMood(state, mood) {
  if (mood === state.desired) return state;
  return { ...state, desired: mood };
}

function specOf(cfg, mood) {
  return cfg.specs[mood] ?? cfg.fallback;
}

/**
 * 判定这一帧要不要换。调用方按固定频率（或收到事件时）调用，幂等。
 */
export function tickDirector(state, cfg, now) {
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
export function msUntilSwitchable(state, cfg, now) {
  if (state.desired === state.applied) return 0;
  const elapsed = now - state.appliedAt;
  const current = specOf(cfg, state.applied);
  const next = specOf(cfg, state.desired);
  const gate = next.urgency > current.urgency
    ? Math.min(cfg.floorMs, current.holdMs)
    : current.holdMs;
  return Math.max(0, gate - elapsed);
}
