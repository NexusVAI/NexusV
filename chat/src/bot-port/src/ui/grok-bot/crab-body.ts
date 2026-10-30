// 移植自 cancri-code/src/ui/grok-bot/crab-body.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 小蟹身体：加载 `<cancri-crab>` 组件 + 给宿主一个「基础状态 + 临时动作」的驱动。
 *
 * 基础状态由宿主的 mood-director 决定；`pulse` 是戳一下、闲着耍个宝这类一次性动作，
 * 播完回到**最新的**基础状态（组件自带的 flash 回到的是切换前那一个，期间调度器换过表情就会回错）。
 */
import type { CancriCrabElement, CrabState } from "./cancri-crab.js";
import { bindCrabOutfit } from "./crab-outfit";

export type { CancriCrabElement, CrabState };

let loading: Promise<unknown> | null = null;

/** 组件只在第一次需要时加载；失败后允许下次重试 */
export function loadCrab(): Promise<void> {
  loading ??= import("./cancri-crab.js").catch((err) => {
    loading = null;
    throw err;
  });
  return loading.then(() => undefined);
}

/** 必须在 loadCrab() 之后调用，否则拿到的是未升级的元素 */
export function createCrabElement(className: string): CancriCrabElement {
  const el = document.createElement("cancri-crab");
  el.className = className;
  return el;
}

export class CrabDriver {
  private base: CrabState;
  private pulseTimer: number | null = null;
  private readonly unbindOutfit: () => void;

  constructor(readonly el: CancriCrabElement, initial: CrabState) {
    this.base = initial;
    el.state = initial;
    this.unbindOutfit = bindCrabOutfit(el);
  }

  setState(state: CrabState): void {
    this.base = state;
    if (this.pulseTimer === null) this.el.state = state;
  }

  pulse(state: CrabState, ms: number): void {
    this.clearPulse();
    this.el.state = state;
    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = null;
      this.el.state = this.base;
    }, ms);
  }

  destroy(): void {
    this.clearPulse();
    this.unbindOutfit();
    this.el.remove();
  }

  private clearPulse(): void {
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = null;
  }
}
