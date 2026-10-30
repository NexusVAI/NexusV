/**
 * 小蟹身体：加载 `<cancri-crab>` 组件 + 给宿主一个「基础状态 + 临时动作」的驱动。
 * 移植自 cancri-code/src/ui/grok-bot/crab-body.ts（去掉类型，逻辑一致）。
 *
 * 基础状态由宿主的 mood-director 决定；`pulse` 是戳一下、闲着耍个宝这类一次性动作，
 * 播完回到**最新的**基础状态（组件自带的 flash 回到的是切换前那一个，期间调度器换过表情就会回错）。
 */
import { bindCrabOutfit } from "./crab-outfit.js";

let loading = null;

/** 组件只在第一次需要时加载；失败后允许下次重试 */
export function loadCrab() {
  loading ??= import("./cancri-crab.js").catch((err) => {
    loading = null;
    throw err;
  });
  return loading.then(() => undefined);
}

/** 必须在 loadCrab() 之后调用，否则拿到的是未升级的元素 */
export function createCrabElement(className) {
  const el = document.createElement("cancri-crab");
  el.className = className;
  return el;
}

export class CrabDriver {
  constructor(el, initial) {
    this.el = el;
    this.base = initial;
    this.pulseTimer = null;
    el.state = initial;
    this.unbindOutfit = bindCrabOutfit(el);
  }

  setState(state) {
    this.base = state;
    if (this.pulseTimer === null) this.el.state = state;
  }

  pulse(state, ms) {
    this.clearPulse();
    this.el.state = state;
    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = null;
      this.el.state = this.base;
    }, ms);
  }

  destroy() {
    this.clearPulse();
    this.unbindOutfit();
    this.el.remove();
  }

  clearPulse() {
    if (this.pulseTimer !== null) window.clearTimeout(this.pulseTimer);
    this.pulseTimer = null;
  }
}
