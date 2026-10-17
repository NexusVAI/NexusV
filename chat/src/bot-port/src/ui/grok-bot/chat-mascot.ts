// 移植自 cancri-code/src/ui/grok-bot/chat-mascot.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 对话流里的吉祥物：跟着 agent 的运行状态换表情。
 *
 * 三条设计约束，改这个文件前先读：
 *
 * 1. **宿主元素必须活过重渲染。** `ChatPane.renderAll` / `refreshStreamingMessageDom`
 *    会 innerHTML / replaceWith 整块换掉气泡。所以气泡里渲染的只是一个空插槽
 *    `[data-mascot-slot]`，真正的 `<svg>` 由本模块长期持有，重渲染后 `adopt()` 把它
 *    再 appendChild 回新插槽。元素被 reparent 不会重建，引擎的 rAF 和弹簧状态全都连续。
 *    如果哪天改成把 svg 直接写进 renderBubble 的 HTML 字符串里，动画会每帧重启。
 *
 * 2. **表情切换一律过 MoodDirector。** agent 事件在一轮里能抖几十次，直接 setState
 *    等于每个动作都播一半被砍。见 mood-director.ts。
 *
 * 3. **进度环只在拿得到真实时长时才画。** 拿不到就退回引擎自己的循环动画，
 *    绝不编一个假时长——环走完了还在等，比没有环更糟。
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
import type { GrokCharacter as GrokCharacterType } from "./engine.js";
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

/**
 * holdMs = 这个表情的入场动画至少要播多久；urgency = 谁能打断谁。
 *
 * 会改 body 形状的（progress/loading/writing/notifying/alerting）给得更长——它们要走
 * 一次形变弹簧再走回来，砍在中间是最难看的。urgency 顺序刻意和 decideChatMood 的
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

export function inkForScheme(scheme: string | null): string {
  return scheme === "light" ? "#2A92FE" : "#4AA6FF";
}

export interface ChatMascotOptions {
  thresholds?: MoodThresholds;
  config?: DirectorConfig<ChatMood>;
}

export class ChatMascot {
  private host: HTMLElement | null = null;
  private engine: GrokCharacterType | null = null;
  private loading = false;

  private signals: AgentSignals = createSignals(0);
  private director: DirectorState<ChatMood>;
  private readonly cfg: DirectorConfig<ChatMood>;
  private readonly th: MoodThresholds;

  private timer: number | null = null;
  private outroTimer: number | null = null;
  private schemeObserver: MutationObserver | null = null;
  /** 正在等待的工具 callId → 声明时长，用来在 tool-result 时精确销掉窗口 */
  private waitCallId: string | null = null;
  private burstPending = false;

  constructor(opts: ChatMascotOptions = {}) {
    this.cfg = opts.config ?? CHAT_MOOD_CONFIG;
    this.th = opts.thresholds ?? DEFAULT_THRESHOLDS;
    this.director = createDirector<ChatMood>("thinking", now());
    this.signals = createSignals(now());
  }

  // ── 生命周期 ─────────────────────────────────────────────

  /**
   * 把宿主挂进（或重新挂回）当前气泡的插槽。renderAll / refreshStreamingMessageDom
   * 之后必须调一次，否则插槽是新的、svg 还挂在被丢弃的旧节点上。
   */
  adopt(root: ParentNode): void {
    if (!findMascotSlot(root)) return;
    const fresh = !this.host;
    if (!this.host) {
      this.host = document.createElement("div");
      this.host.className = "chat-mascot";
    }
    adoptInto(root, this.host);
    if (fresh) void this.ensureEngine();
  }

  private async ensureEngine(): Promise<void> {
    if (this.engine || this.loading || !this.host) return;
    this.loading = true;
    try {
      const mod = await import("./engine.js");
      if (!this.host) return;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "chat-mascot-svg");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Cancri 运行状态");
      this.host.appendChild(svg);
      this.engine = new mod.GrokCharacter(svg, {
        shape: "cloud",
        color: "blue",
        mode: "hold",
        state: this.director.applied,
        followPointer: true,
        inkFlat: inkForScheme(document.documentElement.getAttribute("data-scheme")),
        eyeColor: "var(--cc-mascot-eye, var(--bg-primary, #ffffff))",
      });
      this.watchScheme();
      // 引擎是异步来的，这期间调度器可能已经切过好几次表情了（applyMood 在没有引擎时
      // 只更新状态、不下发）。这里补一次，否则进度环窗口和 data-mood 会漏掉，
      // 表情停在构造时的初值直到下一次切换。
      this.applyMood(this.director.applied, now());
      this.startTimer();
    } catch (err) {
      console.warn("[chat-mascot] 引擎加载失败，本轮不显示吉祥物：", err);
    } finally {
      this.loading = false;
    }
  }

  private watchScheme(): void {
    if (this.schemeObserver) return;
    this.schemeObserver = new MutationObserver(() => {
      this.engine?.setInk(inkForScheme(document.documentElement.getAttribute("data-scheme")));
    });
    this.schemeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-scheme"],
    });
  }

  /**
   * 拆掉引擎和 DOM，但对象本身可以复用：下一轮 adopt() 会重新建一份。
   * 之所以不常驻——引擎是 rAF 循环，回合结束后留着就是每帧空转。
   */
  destroy(): void {
    this.stopTimer();
    if (this.outroTimer !== null) window.clearTimeout(this.outroTimer);
    this.outroTimer = null;
    this.schemeObserver?.disconnect();
    this.schemeObserver = null;
    this.engine?.destroy();
    this.engine = null;
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
   * 喂一条 agent 事件。只更新信号，不直接碰引擎——表情由 pump/tick 统一决定。
   */
  onAgentEvent(ev: AgentEvent): void {
    const t = now();
    let s: AgentSignals = { ...this.signals, lastEventAt: t };

    switch (ev.type) {
      case "turn-start":
        s = { ...createSignals(t), phase: "running", turnStartedAt: t, lastEventAt: t };
        this.waitCallId = null;
        this.burstPending = false;
        this.cancelOutro();
        // 新一轮从 thinking 重新起算，否则上一轮的收尾表情会拿着它的 holdMs 压住开场
        this.director = createDirector<ChatMood>("thinking", t);
        this.engine?.setState("thinking");
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
        // 粒子是一次性特效，不占状态槽——攒到表情真正切过去那一刻再放，
        // 否则会在上一个表情还没播完时就先炸一次。
        this.burstPending = s.phase === "done-ok";
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
    if (res.emit) this.applyMood(res.emit, t);

    this.startTimer();
  }

  private applyMood(mood: ChatMood, t: number): void {
    const engine = this.engine;
    if (!engine) return;

    // 进度环：只有拿到真实时长才接管，否则让引擎走自己的循环动画
    if (mood === "progress" && this.signals.wait?.durationMs) {
      engine.setProgressWindow(this.signals.wait.durationMs, t - this.signals.wait.startedAt);
    } else {
      engine.setProgressWindow(null);
    }

    engine.setState(mood);
    this.host?.setAttribute("data-mood", mood);

    if (this.burstPending) {
      this.burstPending = false;
      engine.burstOnce();
    }
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

/** 气泡里那块占位；真正的 svg 由 ChatMascot.adopt 塞进来。 */
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
 * DOM 元素，引擎的 rAF、弹簧、正在飞的转圈全都连续；重建等于每次重渲染动画从头再来。
 * 返回是否发生了搬动，方便调用方判断/测试。
 */
export function adoptInto(root: ParentNode, host: HTMLElement): boolean {
  const slot = findMascotSlot(root);
  if (!slot || host.parentElement === slot) return false;
  slot.appendChild(host);
  return true;
}
