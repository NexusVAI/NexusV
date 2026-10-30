/**
 * 首页 hero 吉祥物：小螃蟹 <cancri-crab>（替换原 .hero-icon-img 静态 logo）。
 *
 * 身体与大脑移植自 cancri-code src/ui/grok-bot/{cancri-crab,crab-body,mascot,home-mascot,mood-director}：
 * 组件只负责「画成什么样」，这里负责「什么时候换表情」：
 *   发出首条消息 → 干活 ／ 长时间没动静 → 睡着 ／ 人回来了 → 冒爱心 ／
 *   连点它 → 发癫 ／ 平时 idle 隔一阵自己耍个宝。
 *   （原版的「点登录 → orbit」在这里对应「首页 composer 提交」。）
 * 装饰（帽子 / 眼镜…）由用户在悬停出现的「个性化」胶囊里挑，存 localStorage，
 * 与 Bot 页、桌面端同一个键（crab-outfit.js）。
 *
 * 判定逻辑全在 decideMood 这个纯函数里，DOM 与计时器只做输入采集和输出应用。
 *
 * 与 hero_easter_egg.js 的关系：彩蛋脚本在 .hero-icon 上用 click 委托冒气泡，
 * 这里的戳击反馈走小蟹的 pointerdown（先于 click 触发），两者叠加互不冲突。
 *
 * 兜底：组件是动态 import 的；加载失败时保留原有 <img> logo，不留下空位。
 * mountHeroMascot 同步返回 handle——组件就位前调的 setBusy 会记在 brain 里，
 * 等组件起来后由 tick 补应用。
 */
import { CrabDriver, createCrabElement, loadCrab } from "./crab-body.js";
import { attachPersonalizePill } from "./crab-personalize.js";
import {
  DEFAULT_FLOOR_MS,
  createDirector,
  requestMood,
  tickDirector,
} from "./mood-director.js";

const TUNING = {
  /** 无任何输入多久算「没动静」（与 cancri-code home-mascot 一致） */
  idleToSadMs: 90000,
  /** 人回来后开心多久 */
  greetMs: 3600,
  /** 连点计数窗口 */
  pokeWindowMs: 1500,
  /** 窗口内点几下算「一直点」 */
  pokeThreshold: 3,
  /** celebrate 持续多久 */
  celebrateMs: 4600,
};

function createBrain(now) {
  return {
    lastActivityAt: now,
    /** happy 到期时间；<= now 表示不在 happy */
    greetUntil: 0,
    celebrateUntil: 0,
    pokeCount: 0,
    lastPokeAt: -Infinity,
    busy: false,
  };
}

function isStale(brain, now) {
  return now - brain.lastActivityAt >= TUNING.idleToSadMs;
}

/** 有输入。只有「本来已经 sad」才触发 happy，否则单纯刷新活跃时间。 */
function noteActivity(brain, now) {
  const cameBack = isStale(brain, now);
  return {
    ...brain,
    lastActivityAt: now,
    greetUntil: cameBack ? now + TUNING.greetMs : brain.greetUntil,
  };
}

/** 戳一下。窗口内攒够次数就 celebrate；窗口断了从头数。 */
function notePoke(brain, now) {
  const inWindow = now - brain.lastPokeAt <= TUNING.pokeWindowMs;
  const count = (inWindow ? brain.pokeCount : 0) + 1;
  const hit = count >= TUNING.pokeThreshold;
  return {
    ...noteActivity(brain, now),
    pokeCount: hit ? 0 : count,
    lastPokeAt: now,
    celebrateUntil: hit ? now + TUNING.celebrateMs : brain.celebrateUntil,
  };
}

function noteBusy(brain, active) {
  return { ...brain, busy: active };
}

/** 优先级：发送中 > 庆祝 > 久别重逢 > 没动静 > 日常 */
function decideMood(brain, now) {
  if (brain.busy) return "orbit";
  if (now < brain.celebrateUntil) return "celebrate";
  if (now < brain.greetUntil) return "happy";
  if (isStale(brain, now)) return "sad";
  return "idle";
}

/** 发送中在干活 / 连点发癫 / 人回来冒爱心 / 没动静睡着（与 cancri-code mascot.ts 一致） */
const MOOD_STATE = {
  orbit: "work",
  celebrate: "crazy",
  happy: "hearts",
  sad: "sleep",
  idle: "idle",
};

/**
 * 切换节流（与 cancri-code ONBOARDING_MOOD_CONFIG 一致）。直接 setState 会让
 * 连点几下就看到动作播一半被砍；celebrate 给到 2600ms，够发癫动作播几个来回。
 */
const HERO_MOOD_CONFIG = {
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

/** 戳一下的即时反馈时长 */
const POKE_PULSE_MS = 600;
/** idle 太安静时随机耍的宝：[动作, 播多久]，时长按各动作一个完整循环取 */
const IDLE_TRICKS = [
  ["bubble", 3000],
  ["hearts", 2000],
  ["happy", 1000],
];
const TICK_MS = 250;
const IDLE_TRICK_MIN_MS = 7000;
const IDLE_TRICK_MAX_MS = 14000;

/**
 * 把小蟹挂进 .hero-icon 占位 span。
 * @param {HTMLElement} heroIcon  .hero-icon 容器（里面那枚 <img> 是静态兜底）
 * @param {object} [opts]
 * @param {HTMLElement|null} [opts.homeView]  #homeView；.chatting 时 hero 隐藏，调度暂停
 */
export function mountHeroMascot(heroIcon, opts = {}) {
  if (!heroIcon || heroIcon.__heroMascotMounted) return null;
  heroIcon.__heroMascotMounted = true;

  let body = null;
  let brain = createBrain(performance.now());
  let director = createDirector("idle", performance.now());
  let nextIdleTrickAt = performance.now() + IDLE_TRICK_MIN_MS;
  let destroyed = false;

  // 以下都由组件就位后填充；destroy 在组件加载完成前调用也能干净收尾。
  let crab = null;
  let pill = null;
  let timer = null;
  let chatObserver = null;
  let onActivity = null;
  let onPoke = null;

  function teardownRuntime() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (onActivity) {
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
    }
    if (crab && onPoke) crab.removeEventListener("pointerdown", onPoke);
    chatObserver?.disconnect();
    body?.destroy();
    pill?.remove();
    heroIcon.classList.remove("crab-personalize-host");
  }

  const handle = {
    /** 首页 composer 提交（原版的「登录中」）：切 orbit，直到回到首页或调用方复位 */
    setBusy(active) {
      brain = noteBusy(brain, active);
    },
    currentMood() {
      return director.applied;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      teardownRuntime();
      heroIcon.__heroMascotMounted = false;
    },
  };

  (async () => {
    try {
      await loadCrab();
    } catch (err) {
      console.warn("[hero-mascot] 小蟹组件加载失败，保留静态 logo：", err);
      heroIcon.__heroMascotMounted = false;
      return;
    }
    if (destroyed) return;

    crab = createCrabElement("hero-mascot");
    crab.setAttribute("aria-hidden", "true");
    body = new CrabDriver(crab, MOOD_STATE.idle);

    // 组件就位才把静态 logo 撤下来——加载期间它一直是兜底。
    heroIcon.querySelector("img")?.remove();
    heroIcon.appendChild(crab);
    pill = attachPersonalizePill(heroIcon);

    onActivity = () => {
      brain = noteActivity(brain, performance.now());
    };
    onPoke = () => {
      brain = notePoke(brain, performance.now());
      // 每一下都给点反馈，不然攒 celebrate 的过程里它像死的
      body.pulse("happy", POKE_PULSE_MS);
    };

    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("wheel", onActivity, { passive: true });
    crab.addEventListener("pointerdown", onPoke);

    // hero 只在首页可见；#homeView.chatting 时 display:none，调度不再推进。
    // busy 只在「隐藏 → 重新可见」的边沿清掉——否则发送失败后 orbit 会卡住不回
    // idle；但首次挂载时若 homeView 本就没在 chatting，不能把挂载前记的 busy 误清。
    const homeView = opts.homeView || document.getElementById("homeView");
    let hidden = Boolean(homeView?.classList.contains("chatting"));
    const syncHidden = () => {
      const next = Boolean(homeView?.classList.contains("chatting"));
      if (hidden && !next && brain.busy) brain = noteBusy(brain, false);
      hidden = next;
    };
    if (homeView) {
      chatObserver = new MutationObserver(syncHidden);
      chatObserver.observe(homeView, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    timer = window.setInterval(() => {
      const now = performance.now();
      director = requestMood(director, decideMood(brain, now));
      const res = tickDirector(director, HERO_MOOD_CONFIG, now);
      director = res.state;
      if (res.emit) {
        body.setState(MOOD_STATE[res.emit]);
        nextIdleTrickAt = now + IDLE_TRICK_MIN_MS;
        return;
      }
      // idle 太安静了，隔一阵自己耍个宝（看不见时不耍）
      if (!hidden && director.applied === "idle" && now >= nextIdleTrickAt) {
        const [trick, ms] = IDLE_TRICKS[Math.floor(Math.random() * IDLE_TRICKS.length)];
        body.pulse(trick, ms);
        nextIdleTrickAt =
          now + ms + IDLE_TRICK_MIN_MS + Math.random() * (IDLE_TRICK_MAX_MS - IDLE_TRICK_MIN_MS);
      }
    }, TICK_MS);
  })();

  return handle;
}
