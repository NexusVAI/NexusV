// 移植自 cancri-code/src/ui/grok-bot/chat-mascot.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 对话流里的吉祥物：跟着 agent 的运行状态换表情。
 *
 * 三条设计约束，改这个文件前先读：
 *
 * 1. **宿主元素必须活过重渲染。** `ChatPane.renderAll` / `refreshStreamingMessageDom`
 *    会 innerHTML / replaceWith 整块换掉气泡。所以气泡里渲染的只是一个空插槽
 *    `[data-mascot-slot]`，真正的 `<cancri-crab>` 由本模块长期持有，重渲染后 `adopt()` 把它
 *    再 appendChild 回新插槽。元素不重建，状态、装饰、眨眼计时都留着。
 *    如果哪天改成把小蟹直接写进 renderBubble 的 HTML 字符串里，每次重渲染都会新建一只。
 *
 * 2. **表情切换一律过 MoodDirector。** agent 事件在一轮里能抖几十次，直接 setState
 *    等于每个动作都播一半被砍。见 mood-director.ts。
 *
 * 3. **ChatMood → 小蟹动作走 crabStateForMood。** 表情的判定（agent-mood.ts）和
 *    「画成哪个动作」分开：干活类表情用本轮常驻动作，闲下来的随机，其余查 CHAT_MOOD_STATE。
 */
import type { AgentEvent } from "../../agent/types";
import {
  DEFAULT_THRESHOLDS,
  createSignals,
  decideChatMood,
  isWaitTool,
  readWaitDuration,
  type AgentSignals,
  type ChatMood,
  type MoodThresholds,
  type TurnPhase,
} from "./agent-mood";
import { CrabDriver, createCrabElement, loadCrab, type CrabState } from "./crab-body";
import { attachPersonalizePill } from "./crab-personalize";
import {
  DEFAULT_FLOOR_MS,
  createDirector,
  msUntilSwitchable,
  requestMood,
  tickDirector,
  type DirectorConfig,
  type DirectorState,
} from "./mood-director";

export const MASCOT_SLOT_ATTR = "data-mascot-slot";

/** 每个表情画成小蟹的哪个动作 */
export const CHAT_MOOD_STATE: Record<ChatMood, CrabState> = {
  alerting: "error",
  notifying: "question",
  listening: "heart",
  progress: "headphones",
  confused: "sweat",
  loading: "bubble",
  writing: "laptop",
  working: "work",
  receiving: "phone",
  searching: "think",
  dictating: "idle",
  humming: "dumbbell",
  thinking: "think",
  happy: "happy",
  sad: "sulk",
  drowsy: "sleep",
  idle: "idle",
};

/**
 * 一轮里「在干活」的这些表情不再各画各的：每轮开场随机挑 RESIDENT_POSES 之一常驻到收尾，
 * 免得想 / 查 / 写 / 跑命令来回换动作看着乱。流式重连（confused）也归这里——
 * 重连是内部机制，画成流汗只会让人以为出了什么事（用户实报「莫名其妙在流汗」）。
 */
export const RESIDENT_POSES: readonly CrabState[] = ["work", "laptop"];
export const RESIDENT_MOODS: ReadonlySet<ChatMood> = new Set<ChatMood>([
  "thinking", "searching", "writing", "working", "receiving", "confused",
]);
/** 「好一阵没动静 / 跑了很久」这两种闲下来的表情，每次进入时从这里随机挑一个 */
export const IDLE_FUN_MOODS: ReadonlySet<ChatMood> = new Set<ChatMood>(["loading", "humming"]);
export const IDLE_FUN_POSES: readonly CrabState[] = ["bubble", "dumbbell", "headphones", "phone", "chicken"];

export function pickPose(pool: readonly CrabState[], rand: () => number = Math.random): CrabState {
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

/** 表情 → 这一刻实际画的动作（常驻 / 随机 / 查表三选一） */
export function crabStateForMood(
  mood: ChatMood,
  resident: CrabState,
  rand: () => number = Math.random,
): CrabState {
  if (RESIDENT_MOODS.has(mood)) return resident;
  if (IDLE_FUN_MOODS.has(mood)) return pickPose(IDLE_FUN_POSES, rand);
  return CHAT_MOOD_STATE[mood];
}

/**
 * holdMs = 这个表情的入场动画至少要播多久；urgency = 谁能打断谁。
 *
 * 带入场段的动作（loading 吹泡泡、writing 掏电脑、alerting 抖动）给得更长，砍在中间最难看。
 * urgency 顺序刻意和 decideChatMood 的
 * 优先级一致，避免出现「映射说该换、调度器却不让抢」的拧巴组合。
 */
export const CHAT_MOOD_CONFIG: DirectorConfig<ChatMood> = {
  floorMs: DEFAULT_FLOOR_MS,
  fallback: { holdMs: 900, urgency: 50 },
  specs: {
    alerting: { holdMs: 1600, urgency: 100 },
    notifying: { holdMs: 1100, urgency: 95 },
    listening: { holdMs: 900, urgency: 90 },
    progress: { holdMs: 1400, urgency: 85 },
    confused: { holdMs: 1100, urgency: 80 },
    loading: { holdMs: 1600, urgency: 75 },
    writing: { holdMs: 1300, urgency: 70 },
    working: { holdMs: 1000, urgency: 68 },
    receiving: { holdMs: 1100, urgency: 67 },
    searching: { holdMs: 1000, urgency: 66 },
    dictating: { holdMs: 1000, urgency: 55 },
    humming: { holdMs: 1400, urgency: 50 },
    thinking: { holdMs: 800, urgency: 45 },
    happy: { holdMs: 1800, urgency: 40 },
    sad: { holdMs: 1800, urgency: 40 },
    drowsy: { holdMs: 1400, urgency: 40 },
    idle: { holdMs: 600, urgency: 10 },
  },
};

/** 停手多久算「不在输入了」。宿主用它 debounce composer 的 input 事件。 */
export const TYPING_IDLE_MS = 1800;
/** 收尾表情播完后隔多久开始淡出 */
const OUTRO_MS = 2400;
/** 淡出动画时长，跟 CSS .chat-mascot.is-leaving 对齐 */
const FADE_MS = 420;
/** 空闲时的兜底轮询；有待切换时会按 msUntilSwitchable 提前醒 */
const IDLE_TICK_MS = 500;

export interface ChatMascotOptions {
  thresholds?: MoodThresholds;
  config?: DirectorConfig<ChatMood>;
  /** 悬停时渐显「个性化」胶囊（主对话流开，Bot 视图不开） */
  personalize?: boolean;
}

export class ChatMascot {
  private host: HTMLElement | null = null;
  private body: CrabDriver | null = null;
  private loading = false;
  private readonly personalize: boolean;

  /** 本轮常驻动作，turn-start 时重抽 */
  private resident: CrabState = pickPose(RESIDENT_POSES);
  private signals: AgentSignals = createSignals(0);
  private director: DirectorState<ChatMood>;
  private readonly cfg: DirectorConfig<ChatMood>;
  private readonly th: MoodThresholds;

  private timer: number | null = null;
  private outroTimer: number | null = null;
  /** 正在等待的工具 callId，用来在 tool-result 时精确销掉等待窗口 */
  private waitCallId: string | null = null;

  constructor(opts: ChatMascotOptions = {}) {
    this.cfg = opts.config ?? CHAT_MOOD_CONFIG;
    this.th = opts.thresholds ?? DEFAULT_THRESHOLDS;
    this.personalize = opts.personalize ?? false;
    this.director = createDirector<ChatMood>("thinking", now());
    this.signals = createSignals(now());
  }

  // ── 生命周期 ─────────────────────────────────────────────

  /**
   * 把宿主挂进（或重新挂回）当前气泡的插槽。renderAll / refreshStreamingMessageDom
   * 之后必须调一次，否则插槽是新的、小蟹还挂在被丢弃的旧节点上。
   */
  adopt(root: ParentNode): void {
    if (!findMascotSlot(root)) return;
    const fresh = !this.host;
    if (!this.host) {
      this.host = document.createElement("div");
      this.host.className = "chat-mascot";
      if (this.personalize) attachPersonalizePill(this.host);
    }
    adoptInto(root, this.host);
    if (fresh) void this.ensureBody();
  }

  private async ensureBody(): Promise<void> {
    if (this.body || this.loading || !this.host) return;
    this.loading = true;
    try {
      await loadCrab();
      if (!this.host) return;
      const crab = createCrabElement("chat-mascot-crab");
      this.host.prepend(crab);
      this.body = new CrabDriver(crab, crabStateForMood(this.director.applied, this.resident));
      // 组件是异步来的，这期间调度器可能已经切过好几次表情了（applyMood 在没有身体时
      // 只更新状态、不下发）。这里补一次，否则 data-mood 会漏掉，
      // 表情停在构造时的初值直到下一次切换。
      this.applyMood(this.director.applied);
      this.startTimer();
    } catch (err) {
      console.warn("[chat-mascot] 小蟹组件加载失败，本轮不显示吉祥物：", err);
    } finally {
      this.loading = false;
    }
  }

  /**
   * 拆掉小蟹和 DOM，但对象本身可以复用：下一轮 adopt() 会重新建一份。
   * 之所以不常驻——回合结束后留着，它的动画和计时器就一直空转。
   */
  destroy(): void {
    this.stopTimer();
    if (this.outroTimer !== null) window.clearTimeout(this.outroTimer);
    this.outroTimer = null;
    this.body?.destroy();
    this.body = null;
    this.host?.remove();
    this.host = null;
  }

  // ── 输入信号 ─────────────────────────────────────────────

  setUserTyping(on: boolean): void {
    if (this.signals.userTyping === on) return;
    this.signals = { ...this.signals, userTyping: on };
    this.pump();
  }

  /**
   * 喂一条 agent 事件。只更新信号，不直接碰小蟹——表情由 pump/tick 统一决定。
   */
  onAgentEvent(ev: AgentEvent): void {
    const t = now();
    let s: AgentSignals = { ...this.signals, lastEventAt: t };

    switch (ev.type) {
      case "turn-start":
        s = { ...createSignals(t), phase: "running", turnStartedAt: t, lastEventAt: t };
        this.waitCallId = null;
        this.cancelOutro();
        // 新一轮从 thinking 重新起算，否则上一轮的收尾表情会拿着它的 holdMs 压住开场。
        // 下面这句和 createDirector 是一对：新调度器 applied 已是 thinking、不会再 emit，
        // 不在这里直接下发，小蟹会停在上一轮的收尾动作上。
        this.director = createDirector<ChatMood>("thinking", t);
        this.resident = pickPose(RESIDENT_POSES);
        this.body?.setState(crabStateForMood("thinking", this.resident));
        break;

      case "stream-retry":
        s.retrying = true;
        break;

      case "tool-call-pending":
        s.awaitingApproval = true;
        break;

      case "tool-call-executing": {
        s.retrying = false;
        s.awaitingApproval = false;
        if (ev.toolName === "ask_user_question") {
          s.awaitingAsk = true;
          break;
        }
        s.activeTool = ev.toolName;
        if (isWaitTool(ev.toolName)) {
          this.waitCallId = ev.callId;
          s.wait = { startedAt: t, durationMs: readWaitDuration(ev.toolName, ev.args) };
        }
        break;
      }

      case "tool-result":
        if (ev.toolName === "ask_user_question") s.awaitingAsk = false;
        if (s.activeTool === ev.toolName) s.activeTool = null;
        s.awaitingApproval = false;
        if (this.waitCallId === ev.callId) {
          this.waitCallId = null;
          s.wait = null;
        }
        break;

      case "text-delta":
      case "reasoning-delta":
      case "tool-args-delta":
        s.retrying = false;
        break;

      case "error":
        s.errored = true;
        s.activeTool = null;
        s.wait = null;
        break;

      case "turn-done":
        s.phase = ev.reason === "abort"
          ? "done-abort"
          : ev.reason === "error" || s.errored
            ? "done-error"
            : "done-ok";
        s.activeTool = null;
        s.wait = null;
        s.awaitingAsk = false;
        s.awaitingApproval = false;
        s.retrying = false;
        this.waitCallId = null;
        this.scheduleOutro();
        break;

      default:
        break;
    }

    this.signals = s;
    this.pump();
  }

  /** 当前该显示什么（给测试和调试用） */
  currentMood(): ChatMood {
    return this.director.applied;
  }

  // ── 驱动 ────────────────────────────────────────────────

  private pump(): void {
    const t = now();
    const want = decideChatMood(this.signals, t, this.th);
    this.director = requestMood(this.director, want);

    const res = tickDirector(this.director, this.cfg, t);
    this.director = res.state;
    if (res.emit) this.applyMood(res.emit);

    this.startTimer();
  }

  private applyMood(mood: ChatMood): void {
    if (!this.body) return;
    this.body.setState(crabStateForMood(mood, this.resident));
    this.host?.setAttribute("data-mood", mood);
  }

  private startTimer(): void {
    this.stopTimer();
    const wait = msUntilSwitchable(this.director, this.cfg, now());
    const delay = wait > 0 ? wait : IDLE_TICK_MS;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(60, delay));
  }

  private stopTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private cancelOutro(): void {
    if (this.outroTimer !== null) window.clearTimeout(this.outroTimer);
    this.outroTimer = null;
    this.host?.classList.remove("is-leaving");
  }

  /** 收尾表情播完再淡出，不在 turn-done 当帧就把节点摘掉 */
  private scheduleOutro(): void {
    this.cancelOutro();
    this.outroTimer = window.setTimeout(() => {
      this.host?.classList.add("is-leaving");
      this.outroTimer = window.setTimeout(() => {
        this.outroTimer = null;
        this.destroy();
      }, FADE_MS);
    }, OUTRO_MS);
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** 气泡里那块占位；真正的小蟹由 ChatMascot.adopt 塞进来。 */
export function renderMascotSlot(phase: TurnPhase): string {
  if (phase !== "running") return "";
  return `<span class="chat-mascot-slot" ${MASCOT_SLOT_ATTR} aria-hidden="true"></span>`;
}

/**
 * 取**最后一个**插槽 = 最新那条进行中的气泡。
 * ⛔ 别改回 querySelector（第一个）：上一轮的吉祥物行要等退场动画播完才摘，新一轮在这期间
 * 开始时 DOM 里会同时有两个插槽，取第一个就把吉祥物留在对话中间（BUG-007）。
 */
export function findMascotSlot(root: ParentNode): HTMLElement | null {
  const slots = root.querySelectorAll<HTMLElement>(`[${MASCOT_SLOT_ATTR}]`);
  return slots.length > 0 ? slots[slots.length - 1]! : null;
}

/**
 * 把宿主搬进当前插槽。**必须是搬（appendChild）而不是重建**：reparent 保住同一个
 * DOM 元素，状态、装饰、眨眼计时全都留着；重建等于每次重渲染都换一只新的小蟹。
 * 返回是否发生了搬动，方便调用方判断/测试。
 */
export function adoptInto(root: ParentNode, host: HTMLElement): boolean {
  const slot = findMascotSlot(root);
  if (!slot || host.parentElement === slot) return false;
  slot.appendChild(host);
  return true;
}
