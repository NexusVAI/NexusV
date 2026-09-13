/**
 * 首页 hero 吉祥物：蓝色云朵（替换原 .hero-icon-img 静态 logo）。
 *
 * 引擎与大脑移植自 cancri-code src/ui/grok-bot/{engine,mascot,mood-director}：
 * 引擎只负责「画成什么样」，这里负责「什么时候换表情」：
 *   发出首条消息 → orbit ／ 长时间没动静 → sad ／ 人回来了 → happy ／
 *   连点它 → celebrate ／ 平时 idle 偶尔转圈。
 *   （原版的「点登录 → orbit」在这里对应「首页 composer 提交」。）
 *
 * 判定逻辑全在 decideMood 这个纯函数里，DOM 与计时器只做输入采集和输出应用。
 *
 * 与 hero_easter_egg.js 的关系：彩蛋脚本在 .hero-icon 上用 click 委托冒气泡，
 * 这里的戳击反馈走 svg 的 pointerdown（先于 click 触发），两者叠加互不冲突。
 *
 * 兜底：引擎是动态 import 的；加载失败时保留原有 <img> logo，不留下空位。
 * mountHeroMascot 同步返回 handle——引擎就位前调的 setBusy 会记在 brain 里，
 * 等引擎起来后由 tick 补应用。
 */
import {
  DEFAULT_FLOOR_MS,
  createDirector,
  requestMood,
  tickDirector,
} from "./mood-director.js";

const TUNING = {
  /** 无任何输入多久算「没动静」 */
  idleToSadMs: 11000,
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

const MOOD_STATE = {
  orbit: "orbit",
  celebrate: "celebrate",
  happy: "happy",
  sad: "sad",
  idle: "idle",
};

/**
 * 切换节流（与 cancri-code ONBOARDING_MOOD_CONFIG 一致）。直接 setState 会把
 * 正在飞的转圈/弹跳和眼睛插值直接归零；celebrate 给到 2600ms 是因为它要走完
 * spinWild 那一整套甩圈。
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

const TICK_MS = 250;
const IDLE_SPIN_MIN_MS = 7000;
const IDLE_SPIN_MAX_MS = 14000;

/**
 * 站点明暗 → 云朵墨色。chat 主题写在 <html data-theme>（light/dark/black），
 * PORT_SKIN 搬运页则是 data-theme="claude" + data-mode="light|dark"。
 * 深色底下用亮一档的蓝，不然糊在背景里。
 */
function currentScheme() {
  const el = document.documentElement;
  const theme = el.getAttribute("data-theme");
  if (theme === "light") return "light";
  if (theme === "claude") {
    return el.getAttribute("data-mode") === "light" ? "light" : "dark";
  }
  return "dark";
}

function inkForScheme(scheme) {
  return scheme === "light" ? "#2A92FE" : "#4AA6FF";
}

/**
 * 把云朵挂进 .hero-icon 占位 span。
 * @param {HTMLElement} heroIcon  .hero-icon 容器（里面那枚 <img> 是静态兜底）
 * @param {object} [opts]
 * @param {HTMLElement|null} [opts.homeView]  #homeView；.chatting 时 hero 隐藏，引擎暂停
 */
export function mountHeroMascot(heroIcon, opts = {}) {
  if (!heroIcon || heroIcon.__heroMascotMounted) return null;
  heroIcon.__heroMascotMounted = true;

  let engine = null;
  let brain = createBrain(performance.now());
  let director = createDirector("idle", performance.now());
  let nextIdleSpinAt = performance.now() + IDLE_SPIN_MIN_MS;
  let destroyed = false;

  // 以下都由引擎就位后填充；destroy 在引擎加载完成前调用也能干净收尾。
  let svg = null;
  let timer = null;
  let schemeObserver = null;
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
    if (svg && onPoke) svg.removeEventListener("pointerdown", onPoke);
    schemeObserver?.disconnect();
    chatObserver?.disconnect();
    engine?.destroy();
    svg?.remove();
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
    let mod;
    try {
      mod = await import("./engine.js");
    } catch (err) {
      console.warn("[hero-mascot] 云朵引擎加载失败，保留静态 logo：", err);
      heroIcon.__heroMascotMounted = false;
      return;
    }
    if (destroyed) return;

    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "hero-mascot");
    svg.setAttribute("aria-hidden", "true");
    try {
      engine = new mod.GrokCharacter(svg, {
        shape: "cloud",
        color: "blue",
        mode: "hold",
        state: "idle",
        followPointer: true,
        inkFlat: inkForScheme(currentScheme()),
        // 眼睛底色 = 页面底色，读起来像镂空
        eyeColor: "var(--c-bg, #FCFCFB)",
      });
    } catch (err) {
      console.warn("[hero-mascot] 云朵引擎初始化失败，保留静态 logo：", err);
      svg = null;
      heroIcon.__heroMascotMounted = false;
      return;
    }

    // 引擎构造时已画出第一帧，这时才把静态 logo 撤下来——加载期间它一直是兜底。
    heroIcon.appendChild(svg);
    heroIcon.querySelector("img")?.remove();

    onActivity = () => {
      brain = noteActivity(brain, performance.now());
    };
    onPoke = () => {
      const now = performance.now();
      brain = notePoke(brain, now);
      // 每一下都给点反馈，不然攒 celebrate 的过程里它像死的
      engine.bounceOnce();
      engine.spinOnce(1);
    };

    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("wheel", onActivity, { passive: true });
    svg.addEventListener("pointerdown", onPoke);

    schemeObserver = new MutationObserver(() => {
      engine.setInk(inkForScheme(currentScheme()));
    });
    schemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-mode", "data-scheme"],
    });

    // hero 只在首页可见；#homeView.chatting 时 display:none，引擎直接暂停省 rAF。
    // busy 只在「隐藏 → 重新可见」的边沿清掉——否则发送失败后 orbit 会卡住不回
    // idle；但首次挂载时若 homeView 本就没在 chatting，不能把挂载前记的 busy 误清。
    const homeView = opts.homeView || document.getElementById("homeView");
    let wasHidden = Boolean(homeView?.classList.contains("chatting"));
    const syncPause = () => {
      const hidden = Boolean(homeView?.classList.contains("chatting"));
      engine.setPaused(hidden);
      if (wasHidden && !hidden && brain.busy) brain = noteBusy(brain, false);
      wasHidden = hidden;
    };
    if (homeView) {
      chatObserver = new MutationObserver(syncPause);
      chatObserver.observe(homeView, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    syncPause();

    timer = window.setInterval(() => {
      const now = performance.now();
      director = requestMood(director, decideMood(brain, now));
      const res = tickDirector(director, HERO_MOOD_CONFIG, now);
      director = res.state;
      if (res.emit) {
        engine.setState(MOOD_STATE[res.emit]);
        nextIdleSpinAt = now + IDLE_SPIN_MIN_MS;
        return;
      }
      // idle 太安静了，隔一阵自己转一圈
      if (director.applied === "idle" && now >= nextIdleSpinAt) {
        engine.spinOnce(1);
        nextIdleSpinAt =
          now + IDLE_SPIN_MIN_MS + Math.random() * (IDLE_SPIN_MAX_MS - IDLE_SPIN_MIN_MS);
      }
    }, TICK_MS);
  })();

  return handle;
}
