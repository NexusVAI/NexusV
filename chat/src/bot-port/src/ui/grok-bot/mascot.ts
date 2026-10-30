// 移植自 cancri-code/src/ui/grok-bot/mascot.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 欢迎屏 / 欢迎卡 / 首页 / Bot 视图共用的吉祥物：小螃蟹 `<cancri-crab>`。
 *
 * 组件只负责「画成什么样」，这里负责「什么时候换表情」：
 *   点登录 → orbit ／ 长时间没动静 → sad ／ 人回来了 → happy ／ 连点它 → celebrate ／ 平时 idle 偶尔耍个宝。
 *
 * 判定逻辑全在 decideMood 这个纯函数里，DOM 与计时器只做输入采集和输出应用，方便单测。
 */
import { CrabDriver, createCrabElement, loadCrab, type CrabState } from "./crab-body";
import {
  DEFAULT_FLOOR_MS,
  createDirector,
  requestMood,
  tickDirector,
  type DirectorConfig,
} from "./mood-director";

export type MascotMood = "orbit" | "celebrate" | "happy" | "sad" | "idle";

export interface MascotTuning {
  /** 无任何输入多久算「没动静」 */
  idleToSadMs: number;
  /** 人回来后开心多久 */
  greetMs: number;
  /** 连点计数窗口 */
  pokeWindowMs: number;
  /** 窗口内点几下算「一直点」 */
  pokeThreshold: number;
  /** celebrate 持续多久 */
  celebrateMs: number;
}

export const DEFAULT_TUNING: MascotTuning = {
  idleToSadMs: 11000,
  greetMs: 3600,
  pokeWindowMs: 1500,
  pokeThreshold: 3,
  celebrateMs: 4600,
};

export interface MascotBrain {
  lastActivityAt: number;
  /** happy 到期时间；<= now 表示不在 happy */
  greetUntil: number;
  celebrateUntil: number;
  pokeCount: number;
  lastPokeAt: number;
  loginActive: boolean;
}

export function createBrain(now: number): MascotBrain {
  return {
    lastActivityAt: now,
    greetUntil: 0,
    celebrateUntil: 0,
    pokeCount: 0,
    lastPokeAt: -Infinity,
    loginActive: false,
  };
}

function isStale(brain: MascotBrain, tuning: MascotTuning, now: number): boolean {
  return now - brain.lastActivityAt >= tuning.idleToSadMs;
}

/** 有输入。只有「本来已经 sad」才触发 happy，否则单纯刷新活跃时间。 */
export function noteActivity(
  brain: MascotBrain,
  tuning: MascotTuning,
  now: number,
): MascotBrain {
  const cameBack = isStale(brain, tuning, now);
  return {
    ...brain,
    lastActivityAt: now,
    greetUntil: cameBack ? now + tuning.greetMs : brain.greetUntil,
  };
}

/** 戳一下。窗口内攒够次数就 celebrate；窗口断了从头数。 */
export function notePoke(
  brain: MascotBrain,
  tuning: MascotTuning,
  now: number,
): MascotBrain {
  const inWindow = now - brain.lastPokeAt <= tuning.pokeWindowMs;
  const count = (inWindow ? brain.pokeCount : 0) + 1;
  const hit = count >= tuning.pokeThreshold;
  return {
    ...noteActivity(brain, tuning, now),
    pokeCount: hit ? 0 : count,
    lastPokeAt: now,
    celebrateUntil: hit ? now + tuning.celebrateMs : brain.celebrateUntil,
  };
}

export function noteLogin(brain: MascotBrain, active: boolean): MascotBrain {
  return { ...brain, loginActive: active };
}

/** 优先级：登录 > 庆祝 > 久别重逢 > 没动静 > 日常 */
export function decideMood(
  brain: MascotBrain,
  tuning: MascotTuning,
  now: number,
): MascotMood {
  if (brain.loginActive) return "orbit";
  if (now < brain.celebrateUntil) return "celebrate";
  if (now < brain.greetUntil) return "happy";
  if (isStale(brain, tuning, now)) return "sad";
  return "idle";
}

/** 登录中在干活 / 连点发癫 / 人回来冒爱心 / 没动静睡着 */
const MOOD_STATE: Record<MascotMood, CrabState> = {
  orbit: "work",
  celebrate: "crazy",
  happy: "hearts",
  sad: "sleep",
  idle: "idle",
};

/** 戳一下的即时反馈时长 */
const POKE_PULSE_MS = 600;
/** idle 太安静时随机耍的宝：[动作, 播多久]，时长按各动作一个完整循环取 */
const IDLE_TRICKS: readonly (readonly [CrabState, number])[] = [
  ["bubble", 3000],
  ["hearts", 2000],
  ["happy", 1000],
];

export interface MascotHandle {
  /** 点了登录：切 orbit 并锁住，直到登录失败回滚 */
  setLoginActive(active: boolean): void;
  destroy(): void;
}

const TICK_MS = 250;
const IDLE_TRICK_MIN_MS = 7000;
const IDLE_TRICK_MAX_MS = 14000;

/**
 * 欢迎屏的切换节流。和对话流共用 mood-director —— 之前这里是「一发现 mood 变了就
 * setState」，连点几下就能看到动作播一半被砍。celebrate 给到 2600ms，够发癫动作播几个来回。
 */
export const ONBOARDING_MOOD_CONFIG: DirectorConfig<MascotMood> = {
  floorMs: DEFAULT_FLOOR_MS,
  fallback: { holdMs: 900, urgency: 40 },
  specs: {
    orbit: { holdMs: 1000, urgency: 90 },
    celebrate: { holdMs: 2600, urgency: 80 },
    happy: { holdMs: 1600, urgency: 50 },
    sad: { holdMs: 1400, urgency: 30 },
    idle: { holdMs: 700, urgency: 10 },
  },
};

/**
 * 把小蟹挂到 host 里。组件是动态 import 的，用不到吉祥物的页面不为它付包体。
 * 加载失败时静默返回一个空 handle —— 吉祥物不该挡住登录。
 */
export async function mountMascot(
  host: HTMLElement,
  tuning: MascotTuning = DEFAULT_TUNING,
): Promise<MascotHandle> {
  try {
    await loadCrab();
  } catch (err) {
    console.warn("[mascot] 小蟹组件加载失败：", err);
    return { setLoginActive: () => {}, destroy: () => {} };
  }
  const crab = createCrabElement("onb-bot");
  host.appendChild(crab);
  const body = new CrabDriver(crab, MOOD_STATE.idle);

  let brain = createBrain(performance.now());
  let director = createDirector<MascotMood>("idle", performance.now());
  let nextIdleTrickAt = performance.now() + IDLE_TRICK_MIN_MS;

  const onActivity = () => {
    brain = noteActivity(brain, tuning, performance.now());
  };
  const onPoke = () => {
    const now = performance.now();
    brain = notePoke(brain, tuning, now);
    // 每一下都给点反馈，不然攒 celebrate 的过程里它像死的
    body.pulse("happy", POKE_PULSE_MS);
  };

  window.addEventListener("pointermove", onActivity, { passive: true });
  window.addEventListener("pointerdown", onActivity, { passive: true });
  window.addEventListener("keydown", onActivity, { passive: true });
  window.addEventListener("wheel", onActivity, { passive: true });
  crab.addEventListener("pointerdown", onPoke);

  const timer = window.setInterval(() => {
    const now = performance.now();
    director = requestMood(director, decideMood(brain, tuning, now));
    const res = tickDirector(director, ONBOARDING_MOOD_CONFIG, now);
    director = res.state;
    if (res.emit) {
      body.setState(MOOD_STATE[res.emit]);
      nextIdleTrickAt = now + IDLE_TRICK_MIN_MS;
      return;
    }
    // idle 太安静了，隔一阵自己耍个宝
    if (director.applied === "idle" && now >= nextIdleTrickAt) {
      const [trick, ms] = IDLE_TRICKS[Math.floor(Math.random() * IDLE_TRICKS.length)]!;
      body.pulse(trick, ms);
      nextIdleTrickAt =
        now + ms + IDLE_TRICK_MIN_MS + Math.random() * (IDLE_TRICK_MAX_MS - IDLE_TRICK_MIN_MS);
    }
  }, TICK_MS);

  return {
    setLoginActive(active: boolean) {
      brain = noteLogin(brain, active);
    },
    destroy() {
      window.clearInterval(timer);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      crab.removeEventListener("pointerdown", onPoke);
      body.destroy();
    },
  };
}
