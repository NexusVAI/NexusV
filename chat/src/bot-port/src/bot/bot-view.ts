// 移植自 cancri-code/src/bot/bot-view.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 左上角 Agent / Bot 切到 Bot 时的主区视图。
 *
 * 流程：欢迎使用 Cancri Bot → 每个 Bot 有自己的云电脑 → 每个 Bot 负责一类工作 → Bot 会话页。
 * 走完一遍后记进状态，以后再切 Bot 直接进会话页。
 *
 * 和蓝图一样用绝对定位盖住 main-stage（理由见 blueprint.css 顶部注释），
 * 不进 showMainView 的模式枚举，所以不碰 devin-ui.css 里那批 :not(.app-view-*) 规则。
 *
 * 分工：
 *   · bot-store   数据与持久化        · bot-memory  记忆 → 上下文
 *   · bot-runtime agent loop 装配     · bot-tools   Bot 的工具
 *   · bot-computer 云电脑 / 画面 / 接管 · bot-thread / bot-panel  渲染
 * 本文件只做编排：事件委托、发送与排队、流式气泡、状态反馈、弹层。
 *
 * 工具调用不显示成卡片（Bot 是「人」，不是 IDE）：只在底部给一行「正在…」+ 吉祥物，
 * 让用户知道它没死；出网闸门命中时才出一张确认卡。
 *
 * 吉祥物是 rAF 引擎：只给当前可见的插槽挂，隐藏 / 重绘时把脱离文档的全部 destroy。
 */
import "./bot-view.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyImageToClipboard, openImageViewer } from "../ui/image-viewer";
import { showContextMenu } from "../contextMenu";
import { DEFAULT_TUNING, mountMascot, type MascotHandle } from "../ui/grok-bot/mascot";
import { ChatMascot, renderMascotSlot } from "../ui/grok-bot/chat-mascot";
import { auth } from "../auth";
import { uuidv4 } from "../core/id";
import { escapeAttr, escapeHtml } from "../core/escape";
import { showConfirmDialog } from "../ui/confirm-dialog";
import { showToast } from "../ui/toast";
import { syncScrollFade } from "../ui/settings-scroll-fade";
import { patchStreamingHtml } from "../chat/render/streaming-patch";
import type { AgentEvent } from "../agent/types";
import {
  BOT_DEFAULT_NAME,
  GROUP_NAME_MAX,
  NOTE_KINDS,
  createBot,
  createGroup,
  loadBotState,
  nextBotName,
  renameBot,
  saveBotState,
  setBotReaction,
  toggleReaction,
  type BotChatMessage,
  type BotGroup,
  type BotNoteKind,
  type BotProfile,
  type BotState,
} from "./bot-store";
import { BotRuntime, groupSessionKey } from "./bot-runtime";
import {
  GROUP_MAX_MEMBERS,
  groupMembers,
  groupTitle,
  mentionTargets,
  mightBePass,
  pendingFor,
  formatTranscript,
} from "./bot-group";
import {
  GROUP_ACTIVITIES,
  advanceRead,
  parseBotReply,
  planFollowUps,
  planUserRound,
  resolveRef,
  typingDelayMs,
  type GroupActivity,
  type PlannedSpeaker,
  type Rng,
  type SocialMember,
} from "./bot-social";
import {
  avatarStackHtml,
  groupAddMenuHtml,
  groupNoticeHtml,
  groupPreview,
  groupReceipt,
  groupScope,
  mentionInsertText,
  mentionMenuHtml,
  mentionOptions,
  mentionQueryAt,
  newGroupOptions,
  newGroupParts,
  renderGroupPanel,
  renderNewGroup,
  type NewGroupDraft,
} from "./bot-group-render";
import { ComputerPool, LEGACY_COMPUTER, botComputer, computerErrorMessage, type BotComputer, type ComputerKey, type ComputerView } from "./bot-computer";
import { sandboxBackend } from "../sandbox/backend";
import { cloudSandboxDriver } from "../tools/builtin/sandbox-cloud";
import type { ChatProvider } from "../providers/types";
import { BOT_REACTIONS, describeToolActivity, uploadLocalFiles, type LocalFile, type WorkspaceAccess } from "./bot-tools";
import { base64ToBlob, deleteBotImages, getBotImage, putBotImage } from "./bot-images";
import { COMPOSER_MAX_IMAGES, fileToImageAttachment, isImageFile, readFileAsDataUrl, type ComposerImageAttachment } from "../composer-media";
import { THREAD_PAGE, botScope, plainPreview, receiptHtml, renderBotText, renderMessage, renderThread, singleReceipt, splitBubbles, type ThreadScope } from "./bot-thread";
import { PHASE_LABEL, ScreenHost, renderPanel, renderPanelBody, renderPanelTags, renderScreenOverlay, type PanelTab } from "./bot-panel";
import type { SandboxTrialQuota } from "../sandbox/backend";
import { CF_GATEWAY_URL } from "../gateway-config";
import { BotCloudLink, cloudCardHtml } from "./bot-cloud-link";
import { hubErrorText } from "./bot-cloud";

const NAME_OPTIONS = ["小云", "Cancri", BOT_DEFAULT_NAME];
const ONBOARDING_STEPS = 3;
/** 引导页上人不会一直动鼠标，别让它 11 秒就哭丧着脸 */
const BOT_TUNING = { ...DEFAULT_TUNING, idleToSadMs: 10 * 60_000 };
const QUICK_REACTIONS = BOT_REACTIONS.slice(0, 5);
const MORE_EMOJIS = [
  "👍", "👎", "❤️", "😂", "🎉", "😮", "😢", "🙏", "🔥", "👀",
  "😊", "😍", "🤔", "😅", "😭", "😎", "🥳", "😴", "🤯", "😡",
  "👏", "💪", "🙌", "👌", "✌️", "🤝", "💯", "✅", "❌", "⭐",
  "☕", "🍻", "🎂", "🌹", "🌞", "🌙", "🚀", "💡", "📌", "💤",
];

function owner(): string {
  return auth.getUserId() ?? "anon";
}

function initials(): string {
  const st = auth.getState();
  const email = st.kind === "signed-in" ? st.session.user_email : "";
  const base = (email.split("@")[0] || "我").replace(/[^a-zA-Z0-9一-鿿]/g, "");
  return (/[a-zA-Z]/.test(base) ? base.slice(0, 2).toUpperCase() : base.slice(0, 1)) || "我";
}

const ICON_SEARCH = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_PLUS = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const ICON_SEND = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_STOP = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.6" fill="currentColor"/></svg>`;
const ICON_DOWN = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_BACK = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CLOSE = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_MONITOR = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2.8" width="12" height="8.4" rx="1.6" stroke="currentColor" stroke-width="1.3"/><path d="M6 13.6h4M8 11.2v2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const ICON_UPLOAD = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 10.5V2.8M4.8 6 8 2.8 11.2 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.8 10.5v1.4c0 .8.6 1.4 1.4 1.4h7.6c.8 0 1.4-.6 1.4-1.4v-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

const CURSOR_SVG = `<svg class="bot-illus-cursor" width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><path d="M1 1v14.2l3.6-3.4 2.4 5.2 2.3-1-2.4-5.1H12L1 1Z" fill="#111" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
const WINDOW_DOTS = `<span class="bot-win-dots"><i></i><i></i><i></i></span>`;

function stepHtml(step: number): string {
  if (step === 0) {
    return `
      <h1 class="bot-onb-title">欢迎使用 Cancri Bot</h1>
      <div class="bot-onb-stage bot-onb-stage--hero">
        <span class="bot-cloud bot-cloud--hero" data-bot-cloud></span>
      </div>`;
  }
  if (step === 1) {
    return `
      <h1 class="bot-onb-title">每个 Bot 都有自己的云电脑</h1>
      <div class="bot-onb-stage">
        <div class="bot-illus" aria-hidden="true">
          <div class="bot-win bot-win--back">
            <div class="bot-win-bar">${WINDOW_DOTS}</div>
            <div class="bot-win-body">
              <div class="bot-win-row">
                <div class="bot-tile bot-tile--avatar"><span class="bot-cloud bot-cloud--illus" data-bot-cloud></span>${CURSOR_SVG}</div>
                <div class="bot-tile"></div><div class="bot-tile"></div><div class="bot-tile"></div>
              </div>
              <div class="bot-tile bot-tile--tall"></div>
            </div>
          </div>
          <div class="bot-win bot-win--front">
            <div class="bot-win-bar">${WINDOW_DOTS}</div>
            <div class="bot-win-body bot-win-body--split">
              <div class="bot-win-side"></div>
              <div class="bot-win-main">
                <div class="bot-line"><i class="bot-check"></i><b class="bot-bar bot-bar--long"></b></div>
                <div class="bot-line"><i class="bot-check"></i><b class="bot-bar"></b></div>
                <div class="bot-block"></div>
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }
  return `
      <h1 class="bot-onb-title">每个 Bot 负责一类工作</h1>
      <div class="bot-onb-stage">
        <div class="bot-crew" aria-hidden="true">
          <div class="bot-crew-item bot-crew-item--top"><span class="bot-cloud bot-cloud--crew" data-bot-cloud></span><span class="bot-crew-tag">催款助手</span></div>
          <div class="bot-crew-item bot-crew-item--left"><span class="bot-cloud bot-cloud--crew" data-bot-cloud></span><span class="bot-crew-tag">每周站会</span></div>
          <div class="bot-crew-item bot-crew-item--right"><span class="bot-cloud bot-cloud--crew" data-bot-cloud></span><span class="bot-crew-tag">销售预测</span></div>
        </div>
      </div>`;
}

interface Approval {
  callId: string;
  toolName: string;
  label: string;
}

/** Bot 在等用户从本机挑文件（request_local_file） */
interface FileRequest {
  reason: string;
  multiple: boolean;
  finish: (files: LocalFile[] | null) => void;
}

/** 一个会话正在跑的那一轮（群聊里是一整轮：成员依次发言） */
interface LiveTurn {
  /** 会话 id：单聊 = Bot id，群聊 = 群 id */
  botId: string;
  /** 群聊：现在是哪个 Bot 在说话 */
  authorId?: string;
  /** 群聊：用户点了停止，后面的 Bot 不再发言 */
  stopped?: boolean;
  /** 群聊：这个 Bot 本次说出的全部文字（找它 @ 了谁） */
  spoken?: string;
  /** 群聊：这次开口的身份（被点名 / 领头 / 接话），决定头部要不要先亮「正在输入」 */
  role?: GroupSpeaker;
  /** 群聊：叫醒它的那条消息（[PASS:👍] 的表情点在这条上） */
  triggerId?: string;
  /** 群聊：这一段第一个字到的时间。逐条发出时扣掉已经「打字」的这段时间 */
  textStartedAt?: number;
  /** 群聊：已经写完、正按打字速度一条条往外发 */
  composing?: boolean;
  /** 群聊：逐条发布的链；一轮结束前要等它发完 */
  posting?: Promise<void>;
  /** 群聊：成员之间「等它看到消息」的那段空档，点停止要立刻醒 */
  wake?: () => void;
  text: string;
  status: string;
  startedAt: number;
  approvals: Approval[];
  fileRequest: FileRequest | null;
  wroteText: boolean;
  error: string | null;
  mascot: ChatMascot;
  /** 云端那一轮的占位（只显示「正在输入」，没有本地 agent loop） */
  cloud?: boolean;
}

type Popover =
  | { kind: "react"; id: string; anchor: HTMLElement }
  | { kind: "emoji-grid"; id: string; anchor: HTMLElement }
  | { kind: "more"; id: string; anchor: HTMLElement }
  /** 左侧列表右键：跟着鼠标出，id 是 Bot 或群组的 id */
  | { kind: "bot-menu"; id: string; anchor: HTMLElement; x: number; y: number }
  | { kind: "plus"; anchor: HTMLElement }
  /** 群资料面板「添加成员」 */
  | { kind: "group-add"; anchor: HTMLElement };

type Convo = BotProfile | BotGroup;

/** 群里排着要开口的一个成员：dueAt = 它「看到」消息、开始回的时间点 */
type GroupSpeaker = PlannedSpeaker & { dueAt: number; followUp?: boolean };
/** 一轮群聊的安排：谁开口（speakers）、谁什么时候已读（readers）、由哪条消息引起 */
interface GroupRound {
  speakers: Array<PlannedSpeaker & { followUp?: boolean }>;
  readers: Array<{ botId: string; delayMs: number }>;
  triggerId?: string;
}
const isGroup = (c: Convo): c is BotGroup => "memberIds" in c;

const ICON_PEOPLE = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6" cy="5.6" r="2.3" stroke="currentColor" stroke-width="1.3"/><path d="M1.9 13c.4-2.3 2-3.6 4.1-3.6s3.7 1.3 4.1 3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M10.6 3.6a2.2 2.2 0 0 1 0 4.2M12.2 9.7c1 .5 1.7 1.6 1.9 3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;

export interface BotViewHandle {
  show(): void;
  hide(): void;
  readonly visible: boolean;
  /** 打开某个会话（`bot:<id>` / `group:<id>` / 裸 id）；还没同步到的先记着，到了再开（网页通知点进来） */
  open(conv: string): void;
}

export interface BotViewDeps {
  /** 测试注入；缺省走已登录网关 */
  provider?: ChatProvider;
  computer?: BotComputer;
  /**
   * 群聊「活人感」的节奏（bot-social.ts）：pace 是所有等待的倍率（0 = 不等，测试用），
   * rng 换成确定的序列就能断言谁开口。缺省 = 真实节奏 + Math.random。
   */
  social?: { pace?: number; rng?: Rng };
  /** 云端运行（BotHub）。缺省：注入了 provider（测试）时不接，否则接真实网关；传 null 显式关掉 */
  cloud?: BotCloudLink | null;
  /**
   * 网页 / 手机端（GitHub/chat 的 bot.html 移植了这一整套界面）：本地不跑 agent loop，
   * 发消息走云端 `/send`，回复、正在输入、已读都从云端事件来。必须配 cloud。
   */
  remote?: boolean;
  /** 桌面端打开的工作区（main.ts 注入）：Bot 的 workspace_files 工具用它挑文件传到云电脑 */
  workspace?: WorkspaceAccess;
  /** 打开的会话变了（null = 手机布局回到列表）：网页端据此改地址栏 #hash、让通知别打扰正在看的会话 */
  onActive?: (conv: string | null) => void;
}

export function createBotView(stage: HTMLElement, deps: BotViewDeps = {}): BotViewHandle {
  const root = document.createElement("section");
  root.className = "bot-view";
  root.id = "bot-view";
  root.hidden = true;
  root.setAttribute("aria-label", "Bot");
  /** 窄屏（手机）一次只显示一栏：list = 会话列表，convo = 打开的会话 */
  root.dataset.botPane = "list";
  const remote = !!deps.remote;
  if (remote) root.dataset.botRemote = "";
  stage.appendChild(root);

  /**
   * 每个 Bot 一台电脑、每个群一台共用（ComputerPool）。测试注入了 deps.computer 时退回老行为：大家共用那一台。
   * `computer` 是当前打开的会话的那台（面板、画面、上传都看它），切会话时 bindComputer() 换绑。
   */
  const makePool = (): ComputerPool | null => deps.computer ? null : new ComputerPool({
    backend: sandboxBackend,
    assignments: () => (state.computers ??= {}),
    commit: () => persist(),
    legacyDriver: cloudSandboxDriver,
  });
  let pool: ComputerPool | null = null;
  const fallbackComputer = deps.computer ?? botComputer();
  const keyOf = (c: Convo): ComputerKey => (isGroup(c) ? `group:${c.id}` : `bot:${c.id}`);
  const computerOf = (c: Convo): BotComputer => (pool ? pool.get(keyOf(c)) : fallbackComputer);
  let computer: BotComputer = fallbackComputer;
  const pace = Math.max(0, deps.social?.pace ?? 1);
  const rng: Rng = deps.social?.rng ?? Math.random;
  /** 改版前的存档（没有 computers）：那台共用电脑迁给第一个 Bot，它接着用原来的驱动 */
  const loadState = (who: string): BotState => {
    const s = loadBotState(who);
    if (!s.computers) s.computers = { [`bot:${s.bots[0].id}`]: LEGACY_COMPUTER };
    return s;
  };
  let state: BotState = loadState(owner());
  pool = makePool();
  computer = computerOf(state.bots.find((b) => b.id === state.activeId) ?? state.groups.find((g) => g.id === state.activeId) ?? state.bots[0]);
  let visible = false;
  let step = 0;
  let page: "onboarding" | "chat" = state.onboardedAt ? "chat" : "onboarding";
  let searching = false;
  let query = "";
  let panelOpen = false;
  let panelTab: PanelTab = "details";
  let screenOpen = false;
  let replyTo: string | null = null;
  let threadLimit = THREAD_PAGE;
  let popover: Popover | null = null;
  let pcView: ComputerView = computer.view();
  /** 云电脑试用额度。null = 还不知道（面板据此既不画卡片也不说「计入套餐」）。 */
  let pcQuota: SandboxTrialQuota | null = null;
  let quotaAt = 0;
  let quotaBusy = false;
  let flashId: string | null = null;
  const lives = new Map<string, LiveTurn>();
  const queues = new Map<string, BotChatMessage[]>();
  const pendingReactions = new Map<string, string[]>();
  /** 每次离开一个 Bot 就压栈。删掉当前这个时弹栈，回到删除前最近打开的那个。 */
  const openedBefore: string[] = [];
  const screen = new ScreenHost(root, () => computer.noteUserInput(), () => computer.sessionId);
  const mascots = new Map<HTMLElement, MascotHandle>();
  let liveFrame = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  /** 新建群聊页（「收件人：」）；null = 没在建 */
  let composing: NewGroupDraft | null = null;
  /** 群聊输入框里正在打的 @：起点、关键字、高亮项 */
  let mention: { start: number; query: string; cursor: number } | null = null;

  const findBot = (id: string | undefined): BotProfile | undefined => (id ? state.bots.find((b) => b.id === id) : undefined);
  const findGroup = (id: string): BotGroup | undefined => state.groups.find((g) => g.id === id);
  const findConvo = (id: string): Convo | undefined => findBot(id) ?? findGroup(id);
  const activeGroup = (): BotGroup | null => findGroup(state.activeId) ?? null;
  /** 当前打开的 Bot；打开的是群时退回第一个 Bot —— 只给面板 / 电脑这类「必须有个 Bot」的地方用 */
  const active = (): BotProfile => findBot(state.activeId) ?? state.bots[0];
  /** 当前打开的会话（Bot 或群）：线程、草稿、回复这类两边都有的东西走它 */
  const current = (): Convo => activeGroup() ?? active();
  const scopeOf = (c: Convo): ThreadScope => (isGroup(c) ? groupScope(c, state.bots) : botScope(c));
  const titleOf = (c: Convo): string => (isGroup(c) ? groupTitle(c, state.bots) : c.name);

  const persistLocal = (): void => {
    try {
      saveBotState(state);
    } catch {
      showToast("保存失败：本地存储空间不足。");
    }
  };
  /** 落盘；开着云端运行时 3 秒后顺带同步一次（多次改动合并） */
  const persist = (): void => {
    persistLocal();
    cloud?.dirty();
  };

  /**
   * 云端运行（BotHub，见 bot-cloud-link.ts）：关掉电脑后 Bot 也在线。
   * 登录即接（没有开关）。云端发来的消息 / 已读 / 审批合进本地状态后只落盘不回推。
   */
  const cloud: BotCloudLink | null = deps.cloud !== undefined ? deps.cloud : deps.provider ? null : new BotCloudLink({
    owner: () => owner(),
    state: () => state,
    baseUrl: CF_GATEWAY_URL,
    token: () => auth.ensureAccessToken(),
    putImage: (id, blob) => putBotImage(id, blob),
    onChanged: (convs) => onCloudChanged(convs),
    onInfo: () => refreshCloudCard(),
    onNotice: (text) => showToast(text),
    onTyping: (t) => onCloudTyping(t),
    onContextReset: (convs) => {
      for (const key of convs) {
        const id = key.replace(/^(bot|group):/, "");
        stopConvo(id);
        if (key.startsWith("group:")) runtime.forgetGroup(id);
        else runtime.forget(id);
        queues.delete(id);
      }
    },
    ...(remote ? { remote: true } : {}),
  });
  const runtime = new BotRuntime({
    computer: fallbackComputer,
    ...(cloud ? { cloud } : {}),
    ...(deps.workspace ? { workspace: deps.workspace } : {}),
    ...(pool ? {
      computers: {
        mine: (bot: BotProfile) => computerOf(bot),
        shared: (group: BotGroup) => computerOf(group),
        using: (bot: BotProfile, group: BotGroup) => (group.ownComputer?.includes(bot.id) ? "mine" as const : "shared" as const),
        use: (bot: BotProfile, group: BotGroup, target: "mine" | "shared") => {
          const own = new Set(group.ownComputer ?? []);
          if (target === "mine") own.add(bot.id);
          else own.delete(bot.id);
          group.ownComputer = [...own];
          persist();
        },
      },
    } : {}),
    ...(deps.provider ? { provider: deps.provider } : {}),
    commit: (bot) => {
      persist();
      if (visible && page === "chat" && bot.id === state.activeId && panelOpen && panelTab !== "computer") renderPanelDom();
    },
    rename: (bot, name, group) => {
      const prev = bot.name;
      const next = renameBot(bot, name);
      if (!next) return null;
      const room: Convo = group ?? bot;
      if (next !== prev) room.thread.push({ id: uuidv4(), role: "event", text: group ? `${prev} 已重命名为 ${next}` : `已重命名为 ${next}`, at: Date.now() });
      persist();
      if (visible && page === "chat") {
        renderList();
        renderHead();
        if (room.id === state.activeId) renderThreadDom();
      }
      return next;
    },
    react: (bot, emoji, group) => {
      // 群里：点在叫醒它的那条上，算它自己的（一人一个，换表情就是改）
      if (group) return !!groupReact(group, bot.id, emoji, lives.get(group.id)?.triggerId);
      const room: Convo = bot;
      const target = [...room.thread].reverse().find((m) => m.role === "user");
      if (!target) return false;
      if (!target.reactions?.some((r) => r.by === "bot" && r.emoji === emoji)) toggleReaction(target, emoji, "bot");
      persist();
      if (visible && page === "chat" && room.id === state.activeId) patchRow(target);
      return true;
    },
    showImage: (bot, img, group) => {
      const imageId = uuidv4();
      void putBotImage(imageId, base64ToBlob(img.base64)).catch(() => showToast("截图保存失败，重启后将无法查看。"));
      const room: Convo = group ?? bot;
      const post = (): void => {
        room.thread.push({ id: uuidv4(), role: "bot", text: img.caption ?? "", at: Date.now(), image: { id: imageId }, ...(group ? { authorId: bot.id } : {}) });
        persist();
        if (visible && page === "chat") {
          if (room.id === state.activeId) renderThreadDom();
          renderList();
        }
      };
      // 群里文字是按打字速度逐条发的：截图排在它前面那几句后面，不插队
      const live = group ? lives.get(group.id) : undefined;
      if (live?.posting) live.posting = live.posting.then(post);
      else post();
    },
    requestLocalFiles: (bot, req, signal, group) => new Promise<LocalFile[] | null>((resolve) => {
      // 群里发起的请求挂在群的那一轮上
      const convoId = group?.id ?? bot.id;
      const live = lives.get(convoId);
      if (!live || signal.aborted) {
        resolve(null);
        return;
      }
      live.fileRequest?.finish(null);
      const onAbort = () => request.finish(null);
      const request: FileRequest = {
        reason: group ? `${bot.name}：${req.reason}` : req.reason,
        multiple: req.multiple,
        finish: (files) => {
          if (live.fileRequest !== request) return;
          live.fileRequest = null;
          signal.removeEventListener("abort", onAbort);
          resolve(files);
          if (visible && page === "chat") refreshBadge(convoId);
          if (visible && page === "chat" && convoId === state.activeId) renderLive();
        },
      };
      live.fileRequest = request;
      if (visible && page === "chat") refreshBadge(convoId);
      signal.addEventListener("abort", onAbort, { once: true });
      if (visible && page === "chat" && convoId === state.activeId) renderLive();
    }),
  });

  // ── 吉祥物 ────────────────────────────────────────────────────────────────

  const sweepMascots = (): void => {
    for (const [slot, h] of mascots) {
      if (!slot.isConnected) {
        h.destroy();
        mascots.delete(slot);
      }
    }
  };

  /**
   * 带 key 的云朵（列表头像 / 顶部胶囊 / 右侧面板）跨重渲染常驻：renderList 等会 innerHTML 整块重写，
   * 旧插槽随之丢弃；这里把常驻的 holder 搬进新插槽，svg 与引擎不重建，所以切会话不会闪回初始。
   */
  const keepers = new Map<string, { holder: HTMLElement; handle: MascotHandle | null; dead: boolean }>();

  const dropKeeper = (key: string): void => {
    const k = keepers.get(key);
    if (!k) return;
    k.dead = true;
    k.handle?.destroy();
    k.holder.remove();
    keepers.delete(key);
  };

  const mountMascots = (scope: ParentNode = root): void => {
    sweepMascots();
    scope.querySelectorAll<HTMLElement>("[data-bot-cloud]").forEach((slot) => {
      const key = slot.dataset.botCloud;
      if (key) {
        let k = keepers.get(key);
        if (!k) {
          const holder = document.createElement("span");
          holder.style.display = "contents";
          const entry: { holder: HTMLElement; handle: MascotHandle | null; dead: boolean } = { holder, handle: null, dead: false };
          k = entry;
          keepers.set(key, entry);
          void mountMascot(holder, BOT_TUNING).then((h) => {
            if (entry.dead || !visible) h.destroy();
            else entry.handle = h;
          });
        }
        if (k.holder.parentElement !== slot) slot.appendChild(k.holder);
        return;
      }
      if (mascots.has(slot) || slot.querySelector("svg")) return;
      mascots.set(slot, { setLoginActive() {}, destroy() {} });
      void mountMascot(slot, BOT_TUNING).then((h) => {
        if (!slot.isConnected || !visible) {
          h.destroy();
          mascots.delete(slot);
        } else mascots.set(slot, h);
      });
    });
  };

  const destroyMascots = (): void => {
    for (const h of mascots.values()) h.destroy();
    mascots.clear();
    for (const key of [...keepers.keys()]) dropKeeper(key);
  };

  // ── 引导页 ────────────────────────────────────────────────────────────────

  const renderOnboarding = (): void => {
    destroyMascots();
    root.dataset.botPage = "onboarding";
    root.innerHTML = `
      <div class="bot-onb" data-step="${step}">
        <div class="bot-onb-content">${stepHtml(step)}</div>
        <div class="bot-onb-actions">
          <button type="button" class="bot-btn bot-btn--primary" data-bot-action="next">${step + 1 >= ONBOARDING_STEPS ? "开始使用" : "下一步"}</button>
          ${step > 0 ? `<button type="button" class="bot-btn bot-btn--ghost" data-bot-action="back">返回</button>` : ""}
        </div>
      </div>`;
    mountMascots();
  };

  // ── 会话页骨架 ────────────────────────────────────────────────────────────

  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);

  const renderChat = (): void => {
    const chatEl = q(".bot-chat");
    if (root.dataset.botPage === "chat" && chatEl) {
      chatEl.classList.toggle("has-panel", panelOpen);
      renderList();
      renderHead();
      renderThreadDom();
      renderLive();
      renderComposer();
      renderPcPill();
      if (panelOpen) renderPanelDom();
      if (screenOpen) renderScreen();
      renderNewGroupDom();
      const input = q<HTMLTextAreaElement>("[data-bot-input]");
      if (input) {
        input.value = current().draft;
        autoGrow(input);
        watchComposerWidth(input);
      }
      renderMentionMenu();
      watchScrollFade();
      scrollToBottom(true);
      return;
    }

    destroyMascots();
    screen.disconnect();
    root.dataset.botPage = "chat";
    root.innerHTML = `
      <div class="bot-chat${panelOpen ? " has-panel" : ""}">
        <aside class="bot-list" aria-label="Bot 列表">
          <div class="bot-list-top">
            <button type="button" class="bot-icon-btn bot-icon-btn--round${searching ? " is-on" : ""}" data-bot-action="search" aria-label="搜索" title="搜索">${ICON_SEARCH}</button>
            <button type="button" class="bot-icon-btn bot-icon-btn--round" data-bot-action="new-group" aria-label="新建群聊" title="新建群聊">${ICON_PEOPLE}</button>
            <button type="button" class="bot-icon-btn bot-icon-btn--round" data-bot-action="new-bot" aria-label="新建 Bot" title="新建 Bot">${ICON_PLUS}</button>
          </div>
          <div class="bot-search" data-bot-search ${searching ? "" : "hidden"}>
            <input class="bot-input" type="search" placeholder="搜索 Bot 和聊天记录" value="${escapeAttr(query)}" data-bot-search-input aria-label="搜索" />
          </div>
          <div class="bot-list-items" data-bot-list></div>
          <div class="bot-list-bottom">
            <span class="bot-me" title="我">${escapeHtml(initials())}</span>
            <button type="button" class="bot-connect" data-bot-action="pc-panel" data-bot-pc-pill></button>
          </div>
        </aside>
        <div class="bot-convo bot-convo--new" data-bot-newgroup hidden></div>
        <div class="bot-convo" data-bot-convo>
          <header class="bot-convo-head" data-bot-head></header>
          <div class="bot-convo-scroll" data-bot-scroll>
            <div class="bot-convo-inner">
              <div class="bot-thread" data-bot-thread></div>
              <div class="bot-live" data-bot-live></div>
            </div>
          </div>
          <div class="bot-composer-wrap">
            <button type="button" class="bot-jump" data-bot-action="jump-bottom" aria-label="回到最新" hidden>${ICON_DOWN}</button>
            <div class="bot-mention-menu" data-bot-mention role="listbox" aria-label="提及" hidden></div>
            <div class="bot-replybar" data-bot-replybar hidden></div>
            <div class="bot-attachments" data-bot-images hidden></div>
            <div class="bot-composer">
              <button type="button" class="bot-icon-btn bot-icon-btn--round" data-bot-action="plus" aria-label="更多操作" title="更多操作">${ICON_PLUS}</button>
              <textarea class="bot-composer-input" rows="1" data-bot-input></textarea>
              <button type="button" class="bot-send" data-bot-action="send" aria-label="发送"></button>
            </div>
          </div>
        </div>
        <aside class="bot-panel" data-bot-panel ${panelOpen ? "" : "hidden"} aria-label="Bot 信息"></aside>
      </div>
      <div class="bot-screen" data-bot-screen ${screenOpen ? "" : "hidden"} role="dialog" aria-label="云电脑画面"></div>
      <div class="bot-pop" data-bot-pop hidden></div>
      <input type="file" multiple hidden data-bot-file />
      <input type="file" hidden data-bot-pick />`;
    renderList();
    renderHead();
    renderThreadDom();
    renderLive();
    renderComposer();
    renderPcPill();
    if (panelOpen) renderPanelDom();
    if (screenOpen) renderScreen();
    renderNewGroupDom();
    const input = q<HTMLTextAreaElement>("[data-bot-input]");
    if (input) {
      input.value = current().draft;
      autoGrow(input);
      watchComposerWidth(input);
    }
    watchScrollFade();
    scrollToBottom(true);
  };

  // ── 列表 ──────────────────────────────────────────────────────────────────

  const matches = (convo: Convo): number => {
    if (!query.trim()) return 0;
    const needle = query.trim().toLowerCase();
    return convo.thread.filter((m) => m.text.toLowerCase().includes(needle)).length;
  };

  const previewOf = (convo: Convo): string => {
    const live = lives.get(convo.id);
    if (isGroup(convo)) {
      // 群里不报「谁在思考、还有几个在排队」：和真群一样，只在有人真在打字时显示
      const typing = live ? groupTypingText(live) : "";
      return typing || groupPreview(convo, state.bots);
    }
    if (live) return live.status || "正在输入…";
    const bot = convo;
    const last = [...bot.thread].reverse().find((m) => m.role !== "event");
    if (!last) return "";
    return (last.role === "user" ? "你：" : "") + (plainPreview(last.text, 120) || (last.image ? "[截图]" : last.images?.length ? "[图片]" : ""));
  };

  /** 一轮结束后还没看的结果：done = 正常结束，error = 异常终止。切到该会话即清掉。 */
  const unread = new Map<string, "done" | "error">();
  /** 列表头像状态点上一次画的状态：重绘后先按旧状态出生，下一帧再切，颜色才有过渡 */
  const shownBadge = new Map<string, string>();

  const badgeOf = (botId: string): string => {
    const live = lives.get(botId);
    if (live) return live.approvals.length || live.fileRequest ? "ask" : "busy";
    return unread.get(botId) ?? "";
  };

  const badgeLabel: Record<string, string> = { busy: "正在忙", ask: "等你确认", error: "异常终止", done: "已完成，未读" };

  const refreshBadge = (botId: string): void => {
    const el = root.querySelector<HTMLElement>(`[data-bot-dot="${CSS.escape(botId)}"]`);
    const next = badgeOf(botId);
    shownBadge.set(botId, next);
    if (!el) return;
    el.dataset.state = next;
    if (next) el.setAttribute("aria-label", badgeLabel[next]!);
    else el.removeAttribute("aria-label");
  };

  const renderList = (): void => {
    const host = q("[data-bot-list]");
    if (!host) return;
    if (visible) unread.delete(state.activeId);
    const needle = query.trim().toLowerCase();
    const convos: Convo[] = [...state.bots, ...state.groups];
    const bots = convos
      .map((b) => ({ b, hits: matches(b) }))
      .filter(({ b, hits }) => !needle || titleOf(b).toLowerCase().includes(needle) || hits > 0)
      .sort((x, y) => (y.b.pinnedAt ?? 0) - (x.b.pinnedAt ?? 0)
        || (y.b.thread.at(-1)?.at ?? y.b.createdAt) - (x.b.thread.at(-1)?.at ?? x.b.createdAt));
    const avatarOf = (b: Convo): string => isGroup(b)
      ? avatarStackHtml(groupMembers(b, state.bots), "sm")
      : `<span class="bot-cloud bot-cloud--avatar" data-bot-cloud="list:${escapeAttr(b.id)}"></span>`;
    host.innerHTML = bots.length
      ? bots.map(({ b, hits }) => `
        <button type="button" class="bot-list-item${isGroup(b) ? " bot-list-item--group" : ""}${b.id === state.activeId && !composing ? " is-active" : ""}" data-bot-action="select" data-id="${escapeAttr(b.id)}">
          <span class="bot-avatar${isGroup(b) ? " bot-avatar--group" : ""}">${avatarOf(b)}<i class="bot-avatar-dot" data-bot-dot="${escapeAttr(b.id)}" data-state="${shownBadge.get(b.id) ?? badgeOf(b.id)}"></i></span>
          <span class="bot-list-text">
            <span class="bot-list-name">${escapeHtml(titleOf(b))}</span>
            <span class="bot-list-preview" data-preview="${escapeAttr(b.id)}">${needle && hits ? `${hits} 条相关消息` : escapeHtml(previewOf(b))}</span>
          </span>
        </button>`).join("")
      : `<div class="bot-empty bot-empty--list">没有找到「${escapeHtml(query.trim())}」</div>`;
    mountMascots(host);
    // 列表里已不存在的 Bot（删除 / 被搜索过滤掉）：释放它的常驻云朵
    const shown = new Set(bots.map(({ b }) => `list:${b.id}`));
    for (const key of [...keepers.keys()]) if (key.startsWith("list:") && !shown.has(key)) dropKeeper(key);
    requestAnimationFrame(() => {
      for (const { b } of bots) refreshBadge(b.id);
    });
  };

  const patchPreview = (botId: string): void => {
    const el = root.querySelector<HTMLElement>(`[data-preview="${CSS.escape(botId)}"]`);
    const convo = findConvo(botId);
    if (el && convo && !query.trim()) el.textContent = previewOf(convo);
  };

  const renderPcPill = (): void => {
    const pill = q("[data-bot-pc-pill]");
    if (!pill) return;
    pill.innerHTML = `${ICON_MONITOR}<span>电脑</span><span class="bot-dot bot-dot--${pcView.phase}"></span><span class="bot-connect-state">${PHASE_LABEL[pcView.phase]}</span>`;
  };

  // ── 新建群聊 / @ 提及 ─────────────────────────────────────────────────────

  /**
   * 「收件人：」页盖住会话区。第一次整块画，之后只换 chip / 候选 / 底栏，
   * 输入框原样保留（换掉会打断输入法组字）；选中后清空关键字由这里同步回输入框。
   */
  const renderNewGroupDom = (): void => {
    const host = q("[data-bot-newgroup]");
    const convoEl = q("[data-bot-convo]");
    if (!host || !convoEl) return;
    host.hidden = !composing;
    convoEl.hidden = !!composing;
    if (!composing) {
      host.innerHTML = "";
      return;
    }
    let input = host.querySelector<HTMLInputElement>("[data-bot-recipient-input]");
    if (!input) {
      host.innerHTML = renderNewGroup(composing, state.bots);
      input = host.querySelector<HTMLInputElement>("[data-bot-recipient-input]");
    } else {
      const parts = newGroupParts(composing, state.bots);
      host.querySelector("[data-bot-chips]")!.innerHTML = parts.chips;
      host.querySelector("[data-bot-recipient-list]")!.innerHTML = parts.list;
      host.querySelector("[data-bot-newgroup-footer]")!.innerHTML = parts.footer;
      input.placeholder = parts.placeholder;
      input.disabled = parts.full;
      if (input.value !== composing.query) input.value = composing.query;
    }
    input?.focus();
    host.querySelector(".bot-recipient-option.is-active")?.scrollIntoView({ block: "nearest" });
  };

  const renderMentionMenu = (): void => {
    const host = q("[data-bot-mention]");
    if (!host) return;
    const group = activeGroup();
    if (!mention || !group) {
      host.hidden = true;
      host.innerHTML = "";
      return;
    }
    const opts = mentionOptions(mention.query, groupMembers(group, state.bots));
    mention.cursor = Math.min(mention.cursor, Math.max(0, opts.length - 1));
    host.hidden = false;
    host.innerHTML = mentionMenuHtml(opts, mention.cursor);
  };

  /** 输入框内容 / 光标变了：光标前是不是正在打 @xxx */
  const syncMention = (input: HTMLTextAreaElement): void => {
    const group = activeGroup();
    const hit = group ? mentionQueryAt(input.value, input.selectionStart ?? input.value.length) : null;
    mention = hit ? { ...hit, cursor: mention && mention.query === hit.query ? mention.cursor : 0 } : null;
    renderMentionMenu();
  };

  const pickMention = (index: number): void => {
    const group = activeGroup();
    const input = q<HTMLTextAreaElement>("[data-bot-input]");
    if (!group || !mention || !input) return;
    const opt = mentionOptions(mention.query, groupMembers(group, state.bots))[index];
    if (!opt) return;
    const caret = input.selectionStart ?? input.value.length;
    const insert = `@${mentionInsertText(opt)} `;
    input.value = input.value.slice(0, mention.start) + insert + input.value.slice(caret);
    const pos = mention.start + insert.length;
    mention = null;
    renderMentionMenu();
    input.focus();
    input.setSelectionRange(pos, pos);
    group.draft = input.value;
    autoGrow(input);
    renderComposer();
  };

  // ── 头部 / 线程 ───────────────────────────────────────────────────────────

  /** 窄屏：会话页左上角回到列表（宽屏 CSS 藏掉） */
  const backBtn = `<button type="button" class="bot-icon-btn bot-icon-btn--round bot-back" data-bot-action="back-list" aria-label="返回" title="返回">${ICON_BACK}</button>`;
  const setPane = (pane: "list" | "convo"): void => {
    root.dataset.botPane = pane;
  };

  const renderHead = (): void => {
    const head = q("[data-bot-head]");
    if (!head) return;
    const group = activeGroup();
    if (group) {
      const title = groupTitle(group, state.bots);
      const members = groupMembers(group, state.bots);
      head.innerHTML = `${backBtn}
      <button type="button" class="bot-convo-pill bot-convo-pill--group${panelOpen ? " is-on" : ""}" data-bot-action="panel-toggle" aria-expanded="${panelOpen}" title="查看群成员">
        ${avatarStackHtml(members, "sm")}<span>${escapeHtml(title)}</span><span class="bot-convo-pill-count">${members.length}</span>
      </button>
      <span class="bot-convo-typing" data-bot-typing-head aria-live="polite" hidden></span>`;
      patchTypingHead();
      const input = q<HTMLTextAreaElement>("[data-bot-input]");
      if (input) {
        // 和 Grok Bot 一样：起过名叫名字，没起过就叫「群组」
        const placeholder = group.name.trim() ? `给 ${group.name.trim()} 发消息` : "给群组发消息";
        input.placeholder = placeholder;
        input.setAttribute("aria-label", placeholder);
      }
      return;
    }
    const bot = active();
    head.innerHTML = `${backBtn}
      <button type="button" class="bot-convo-pill${panelOpen ? " is-on" : ""}" data-bot-action="panel-toggle" aria-expanded="${panelOpen}" title="查看 ${escapeAttr(bot.name)} 的资料">
        <span class="bot-cloud bot-cloud--pill" data-bot-cloud="pill"></span><span>${escapeHtml(bot.name)}</span>
      </button>`;
    mountMascots(head);
    const input = q<HTMLTextAreaElement>("[data-bot-input]");
    if (input) {
      input.placeholder = `给 ${bot.name} 发消息`;
      input.setAttribute("aria-label", `给 ${bot.name} 发消息`);
    }
  };

  const nameAskHtml = (): string => `
    <div class="bot-ask" data-bot-ask>
      <div class="bot-ask-head">
        <span>给 Bot 起个名字，之后可以随时修改。</span>
        <button type="button" class="bot-icon-btn bot-ask-close" data-bot-action="ask-dismiss" aria-label="跳过">${ICON_CLOSE}</button>
      </div>
      <div class="bot-ask-options">
        ${NAME_OPTIONS.map((opt, i) => `
          <button type="button" class="bot-ask-option" data-bot-action="pick-name" data-name="${escapeAttr(opt)}">
            <span class="bot-ask-key">${String.fromCharCode(65 + i)}</span><span>${escapeHtml(opt)}</span>
          </button>`).join("")}
      </div>
      <input class="bot-ask-input" type="text" maxlength="24" placeholder="或输入其他名字" data-bot-ask-input />
    </div>`;

  /** 截图本体在 IndexedDB：线程里先出占位 <img>，读到再填 src；一张图只建一个 object URL */
  const imageUrls = new Map<string, string>();
  const hydrateImages = (host: ParentNode): void => {
    host.querySelectorAll<HTMLImageElement>("img[data-bot-img]").forEach((img) => {
      const id = img.dataset.botImg ?? "";
      const cached = imageUrls.get(id);
      if (cached) {
        img.src = cached;
        return;
      }
      void getBotImage(id).then((blob) => {
        if (!blob) {
          const gone = document.createElement("span");
          gone.className = "bot-msg-img-missing";
          gone.textContent = id.startsWith("hub-") ? "云端截图加载中…" : "截图已不在本机";
          img.replaceWith(gone);
          return;
        }
        let url = imageUrls.get(id);
        if (!url) {
          url = URL.createObjectURL(blob);
          imageUrls.set(id, url);
        }
        img.src = url;
      });
    });
  };

  const imageIdsOf = (msgs: BotChatMessage[]): string[] =>
    msgs.flatMap((m) => [...(m.image?.id ? [m.image.id] : []), ...(m.images ?? []).map((i) => i.id)]);

  // ── 输入框粘贴图片 ────────────────────────────────────────────────────────

  /** 还没发出去的图片，按 Bot 分开放：切走再切回来还在 */
  const draftImages = new Map<string, ComposerImageAttachment[]>();
  /** 刚发出去、还没交给模型的图片原件（排队中的消息要等上一轮结束才跑）；之后以 IndexedDB 为准 */
  const sentImages = new Map<string, Array<{ url: string; name?: string }>>();
  const draftImagesOf = (botId: string): ComposerImageAttachment[] => draftImages.get(botId) ?? [];

  const renderImageStrip = (): void => {
    const host = q("[data-bot-images]");
    if (!host) return;
    const list = draftImagesOf(state.activeId);
    const key = list.map((i) => i.id).join(",");
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    host.hidden = !list.length;
    host.innerHTML = list
      .map((img) => `<div class="bot-attach"><img src="${escapeAttr(img.dataUrl)}" alt="${escapeAttr(img.name)}" title="${escapeAttr(img.name)}"><button type="button" class="bot-attach-remove" data-bot-action="image-remove" data-id="${escapeAttr(img.id)}" aria-label="移除图片" title="移除">${ICON_CLOSE}</button></div>`)
      .join("");
  };

  const addDraftImages = async (files: File[]): Promise<void> => {
    const botId = state.activeId;
    for (const file of files) {
      if (draftImagesOf(botId).length >= COMPOSER_MAX_IMAGES) {
        showToast(`一条消息最多 ${COMPOSER_MAX_IMAGES} 张图片`);
        break;
      }
      try {
        const att = await fileToImageAttachment(file);
        if (att) draftImages.set(botId, [...draftImagesOf(botId), att]);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "图片读取失败");
      }
    }
    if (visible && page === "chat") renderComposer();
  };

  const dataUrlToBlob = (url: string): Blob | null => {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    return m ? base64ToBlob(m[2], m[1]) : null;
  };

  /** 这一轮要交给模型的图：先用刚发出时留的原件，没有（重试 / 重启后）再从 IndexedDB 读 */
  const collectTurnImages = async (msgs: BotChatMessage[]): Promise<Array<{ url: string; name?: string }>> => {
    const out: Array<{ url: string; name?: string }> = [];
    for (const m of msgs) {
      const cached = sentImages.get(m.id);
      sentImages.delete(m.id);
      if (cached) { out.push(...cached); continue; }
      for (const ref of m.images ?? []) {
        const blob = await getBotImage(ref.id).catch(() => null);
        if (blob) out.push({ url: await readFileAsDataUrl(new File([blob], "image", { type: blob.type })) });
      }
    }
    return out;
  };

  const renderThreadDom = (): void => {
    const host = q("[data-bot-thread]");
    if (!host) return;
    const group = activeGroup();
    if (group) {
      host.innerHTML = (group.noticeDismissed ? "" : groupNoticeHtml(true)) + renderThread(groupScope(group, state.bots), threadLimit);
    } else {
      const bot = active();
      host.innerHTML = renderThread(botScope(bot), threadLimit) + (bot.named ? "" : nameAskHtml());
    }
    hydrateImages(host);
    if (flashId) {
      const el = host.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(flashId)}"]`);
      el?.classList.add("is-flash");
      el?.scrollIntoView({ block: "center" });
      flashId = null;
    }
  };

  const patchRow = (msg: BotChatMessage): void => {
    const el = root.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(msg.id)}"]`);
    if (!el) return;
    const tpl = document.createElement("template");
    // 原位替换：这一条是不是一段作者的开头，沿用整段渲染时的判断
    tpl.innerHTML = renderMessage(scopeOf(current()), msg, { showAuthor: el.classList.contains("is-run-start") }).trim();
    const next = tpl.content.firstElementChild;
    if (next) {
      el.replaceWith(next);
      hydrateImages(next);
    }
  };

  // ── 进行中的一轮：流式气泡 + 状态行 + 确认卡 ──────────────────────────────

  const elapsedLabel = (live: LiveTurn): string => {
    const s = Math.floor((Date.now() - live.startedAt) / 1000);
    return s >= 4 ? `（${s < 60 ? `${s}秒` : `${Math.floor(s / 60)}分${s % 60}秒`}）` : "";
  };

  /** 单聊的状态行 */
  const typingText = (live: LiveTurn): string => `${live.status || "思考中…"}${elapsedLabel(live)}`;

  /**
   * 群聊头部那行小字（取代原来线程底部的「X 思考中…，待回复 N」）：
   * 只有真在「打字」（有了不是 [PASS] 的字 / 正在逐条发 / 被点名必回）才说「X 正在输入…」；
   * 在用电脑、搜网页时说它在干什么；纯思考、可能 PASS 的时候什么都不显示 —— 真人没开口前你也看不出它在想。
   */
  const groupTypingText = (live: LiveTurn): string => {
    const speaker = findBot(live.authorId);
    if (!speaker || live.stopped) return "";
    if (live.composing || (live.text.trim() && !mightBePass(live.text))) return `${speaker.name} 正在输入…`;
    const status = live.status;
    if (status && status !== "思考中…" && status !== "遇到问题，正在调整…") return `${speaker.name} ${status}`;
    if (live.role?.mustReply && (status || live.text)) return `${speaker.name} 正在输入…`;
    return "";
  };

  const patchTypingHead = (): void => {
    const el = q("[data-bot-typing-head]");
    if (!el) return;
    const live = lives.get(state.activeId);
    const text = live && activeGroup() ? groupTypingText(live) : "";
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text;
  };

  const liveRowHtml = (): string =>
    `<div class="bot-bubble-wrap"><div class="bot-msg bot-msg--bot is-streaming"><div class="bot-msg-body"></div></div></div>`;

  const liveBodyHtml = new WeakMap<Element, string>();
  const liveExtrasHtml = new WeakMap<Element, string>();
  const renderLive = (): void => {
    liveFrame = 0;
    const host = q("[data-bot-live]");
    if (!host) return;
    const live = lives.get(state.activeId);
    if (!live) {
      host.innerHTML = "";
      liveExtrasHtml.delete(host);
      patchTypingHead();
      return;
    }
    // 群里不流式出气泡、也没有底部状态行：写完一段按打字速度一条条「发」出来（commitSegment），
    // 进行中只在头部显示「X 正在输入…」。这里只剩确认卡 / 要文件的卡。
    const inGroup = !!findGroup(live.botId);
    patchTypingHead();
    const bubbles = live.text.trim() && !inGroup ? splitBubbles(live.text) : [];
    const approvals = live.approvals.map((a) => `
      <div class="bot-approve" data-call-id="${escapeAttr(a.callId)}">
        <div class="bot-approve-text">${escapeHtml(a.label)}</div>
        <div class="bot-approve-actions">
          <button type="button" class="bot-btn bot-btn--primary bot-btn--sm" data-bot-action="approve" data-id="${escapeAttr(a.callId)}">允许</button>
          <button type="button" class="bot-btn bot-btn--ghost bot-btn--sm" data-bot-action="deny" data-id="${escapeAttr(a.callId)}">拒绝</button>
        </div>
      </div>`).join("");
    const fileReq = live.fileRequest
      ? `
      <div class="bot-approve" data-file-request>
        <div class="bot-approve-text">${escapeHtml(live.fileRequest.reason)}</div>
        <div class="bot-approve-actions">
          <button type="button" class="bot-btn bot-btn--primary bot-btn--sm" data-bot-action="file-pick">选择文件</button>
          <button type="button" class="bot-btn bot-btn--ghost bot-btn--sm" data-bot-action="file-deny">拒绝</button>
        </div>
      </div>`
      : "";
    const showStatus = !inGroup && (!bubbles.length || live.status);
    // 按节点对账，不整块 innerHTML：每个 delta 一帧，整块重写会把气泡换成新节点，
    // .is-streaming 的淡入动画从透明重播 → 每蹦一个字闪一次。气泡只改正文，其余没变就不碰。
    const rows = [...host.querySelectorAll<HTMLElement>(":scope > [data-live-bubble]")];
    const afterBubbles = (): Element | null => host.querySelector(":scope > .bot-approve, :scope > .bot-typing");
    bubbles.forEach((b, i) => {
      let row = rows[i];
      if (!row) {
        row = document.createElement("div");
        row.className = "bot-row bot-row--bot";
        row.dataset.liveBubble = "";
        row.innerHTML = liveRowHtml();
        host.insertBefore(row, afterBubbles());
      }
      const body = row.querySelector<HTMLElement>(".bot-msg-body")!;
      const html = renderBotText(b);
      // 增量补丁而不是 innerHTML：只有新增的字包进 .chat-stream-fade 淡入（和 Agent 同一份）。
      // 正文里混着淡入 span，所以比对用上一帧的 html 字符串，不能读 body.innerHTML。
      if (liveBodyHtml.get(body) !== html) {
        patchStreamingHtml(body, html);
        liveBodyHtml.set(body, html);
      }
    });
    for (const row of rows.slice(bubbles.length)) row.remove();
    const extras = approvals + fileReq;
    if (liveExtrasHtml.get(host) !== extras) {
      for (const el of host.querySelectorAll(":scope > .bot-approve")) el.remove();
      const tpl = document.createElement("template");
      tpl.innerHTML = extras;
      host.insertBefore(tpl.content, host.querySelector(":scope > .bot-typing"));
      liveExtrasHtml.set(host, extras);
    }
    let typing = host.querySelector<HTMLElement>(":scope > .bot-typing");
    if (showStatus) {
      if (!typing) {
        const tpl = document.createElement("template");
        tpl.innerHTML = `<div class="bot-typing" aria-live="polite">${renderMascotSlot("running")}<span class="bot-typing-text"></span></div>`;
        typing = tpl.content.firstElementChild as HTMLElement;
        host.appendChild(typing);
      }
      const text = typingText(live);
      const textEl = typing.querySelector(".bot-typing-text")!;
      if (textEl.textContent !== text) textEl.textContent = text;
    } else {
      typing?.remove();
    }
    live.mascot.adopt(host);
    stickToBottom();
  };

  const scheduleLive = (): void => {
    if (!liveFrame) liveFrame = requestAnimationFrame(renderLive);
  };

  // ── 滚动 ──────────────────────────────────────────────────────────────────

  let pinned = true;
  const scrollToBottom = (force = false): void => {
    const sc = q("[data-bot-scroll]");
    if (!sc) return;
    if (force || pinned) sc.scrollTop = sc.scrollHeight;
    syncScrollFade(sc);
  };
  const stickToBottom = (): void => scrollToBottom(false);

  // ── 输入框 ────────────────────────────────────────────────────────────────

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 152)}px`;
    syncScrollFade(el);
  };
  // 输入框内部滚动：上下边缘渐隐（与 Agent 输入框同一条 .has-scroll-fade 规则）
  const fadeBound = new WeakSet<HTMLTextAreaElement>();
  const bindComposerFade = (el: HTMLTextAreaElement): void => {
    if (fadeBound.has(el)) return;
    fadeBound.add(el);
    el.addEventListener("scroll", () => syncScrollFade(el), { passive: true });
  };

  // 高度是按「当时的宽度」量的。登录回调到达时窗口还是欢迎页的 400px 小窗，renderChat
  // 在窄宽度下把空输入框（placeholder 折行）量高了，窗口恢复后没人重量 → 一直偏高，
  // 直到用户再打字（2026-10-13 实报）。宽度一变就重量一次；只看宽度，autoGrow 自己改高度不回触。
  let composerWidthObserver: ResizeObserver | null = null;
  const watchComposerWidth = (el: HTMLTextAreaElement): void => {
    bindComposerFade(el);
    composerWidthObserver?.disconnect();
    composerWidthObserver = null;
    if (typeof ResizeObserver === "undefined") return;
    let lastWidth = -1;
    composerWidthObserver = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (width === lastWidth) return;
      lastWidth = width;
      if (width > 0) autoGrow(el);
    });
    composerWidthObserver.observe(el);
  };

  // 会话区上下渐隐：滚动之外，内容长高 / 窗口变高 / 回复条出现都会改「两端还剩多少可滚」
  let scrollFadeObserver: ResizeObserver | null = null;
  const watchScrollFade = (): void => {
    scrollFadeObserver?.disconnect();
    scrollFadeObserver = null;
    const sc = q("[data-bot-scroll]");
    if (!sc || typeof ResizeObserver === "undefined") return;
    scrollFadeObserver = new ResizeObserver(() => syncScrollFade(sc));
    scrollFadeObserver.observe(sc);
    if (sc.firstElementChild) scrollFadeObserver.observe(sc.firstElementChild);
  };

  const renderComposer = (): void => {
    const btn = q<HTMLButtonElement>('[data-bot-action="send"]');
    const input = q<HTMLTextAreaElement>("[data-bot-input]");
    if (!btn || !input) return;
    const running = lives.has(state.activeId);
    const empty = !input.value.trim() && !draftImagesOf(state.activeId).length;
    renderImageStrip();
    const stop = running && empty;
    btn.innerHTML = stop ? ICON_STOP : ICON_SEND;
    btn.classList.toggle("is-stop", stop);
    btn.disabled = !stop && empty;
    btn.setAttribute("aria-label", stop ? "停止" : "发送");
    btn.title = stop ? "停止" : "发送（Enter）";
    const bar = q("[data-bot-replybar]");
    if (bar) {
      const convo = current();
      const target = replyTo ? convo.thread.find((m) => m.id === replyTo) : null;
      bar.hidden = !target;
      bar.innerHTML = target
        ? `<span class="bot-replybar-text">回复 <b>${escapeHtml(scopeOf(convo).nameOf(target))}</b>：${escapeHtml(plainPreview(target.text, 60) || (target.image ? "[截图]" : target.images?.length ? "[图片]" : ""))}</span><button type="button" class="bot-icon-btn" data-bot-action="reply-cancel" aria-label="取消回复">${ICON_CLOSE}</button>`
        : "";
    }
  };

  // ── 面板 / 全屏电脑 ───────────────────────────────────────────────────────

  /** 额度卡片只在「从无到有」那一次淡入；之后的重绘（计费心跳、开关机）保持静止 */
  let quotaCardShown = false;
  const markQuotaEnter = (host: ParentNode): void => {
    const card = host.querySelector<HTMLElement>(".bot-quota");
    if (card && !quotaCardShown) card.classList.add("is-enter");
    quotaCardShown = Boolean(card);
  };

  const renderPanelDom = (): void => {
    renderPanelDomInner();
    refreshCloudCard();
  };

  /** 资料面板（单聊「详情」/ 群「成员」页）里那张「云端运行」卡片；没开放给这个账号时不画 */
  const refreshCloudCard = (): void => {
    const panel = q("[data-bot-panel]");
    if (!panel || !panelOpen) return;
    panel.querySelector("[data-cloud-card]")?.remove();
    if (!cloud || panelTab === "computer") return;
    const html = cloudCardHtml(cloud.info, escapeHtml);
    if (!html) return;
    const anchor = panel.querySelector(".bot-danger, .bot-group-danger");
    anchor?.insertAdjacentHTML("beforebegin", html);
  };

  /** 云端改了本地状态：只落盘（不回推），重画受影响的会话 */
  const onCloudChanged = (convs: string[]): void => {
    persistLocal();
    for (const key of convs) {
      const id = key.replace(/^(bot|group):/, "");
      if (!findConvo(id)) {
        // 别的端删掉了：本机这边正在跑的、排着的、它的电脑一并收掉（和本地删除一样）
        stopConvo(id);
        if (key.startsWith("group:")) runtime.forgetGroup(id);
        else runtime.forgetBot(id);
        void pool?.drop(key as ComputerKey).catch(() => {});
        queues.delete(id);
        unread.delete(id);
        continue;
      }
      if (id !== state.activeId || !visible || page !== "chat") unread.set(id, "done");
    }
    // 网页端第一次打开：云端已经有 Bot 了就不走引导
    if (remote && page === "onboarding" && state.onboardedAt) {
      page = "chat";
      if (visible) renderChat();
      if (visible && pendingOpen && findConvo(pendingOpen)) {
        selectBot(pendingOpen);
        pendingOpen = null;
      }
      return;
    }
    if (!visible || page !== "chat") return;
    if (pendingOpen && findConvo(pendingOpen)) {
      const id = pendingOpen;
      pendingOpen = null;
      selectBot(id);
      return;
    }
    renderList();
    const cur = current();
    if (convs.includes(isGroup(cur) ? `group:${cur.id}` : `bot:${cur.id}`)) {
      renderHead();
      renderThreadDom();
      renderLive();
      stickToBottom();
    }
  };

  /**
   * 云端 Bot 正在输入 / 在用工具：在本地 lives 里挂一个「云端那一轮」的占位（没有 agent loop），
   * 复用同一套状态行 / 群头部「X 正在输入…」。说完（on=false 或它的消息到了）就撤掉；90 秒没动静兜底撤掉。
   */
  const cloudTyping = new Map<string, ReturnType<typeof setTimeout>>();
  /** handle.open() 要开的会话还没从云端同步下来：到了再开 */
  let pendingOpen: string | null = null;
  const onCloudTyping = (t: { conv: string; botId: string; on: boolean; tool?: string }): void => {
    const convoId = t.conv.replace(/^(bot|group):/, "");
    const group = findGroup(convoId);
    const existing = lives.get(convoId);
    // 本机正在跑真的那一轮：别用云端的占位盖掉它
    if (existing && !existing.cloud) return;
    const clear = (): void => {
      const cur = lives.get(convoId);
      if (!cur?.cloud) return;
      if (group && cur.authorId && cur.authorId !== t.botId && t.on === false) return;
      cur.mascot.destroy();
      lives.delete(convoId);
      clearTimeout(cloudTyping.get(convoId));
      cloudTyping.delete(convoId);
      if (visible && page === "chat") {
        if (convoId === state.activeId) { renderLive(); renderComposer(); }
        refreshBadge(convoId);
      }
    };
    if (!t.on) {
      clear();
      return;
    }
    const status = t.tool ? describeToolActivity(t.tool, {}) : "思考中…";
    const live: LiveTurn = existing ?? {
      botId: convoId, text: "", status, startedAt: Date.now(), approvals: [], fileRequest: null,
      wroteText: false, error: null, mascot: new ChatMascot(), cloud: true,
    };
    live.status = status;
    if (group) {
      live.authorId = t.botId;
      live.role = { botId: t.botId, mustReply: true, lead: false, readDelayMs: 0, dueAt: Date.now() };
    }
    lives.set(convoId, live);
    ensureTicker();
    clearTimeout(cloudTyping.get(convoId));
    cloudTyping.set(convoId, setTimeout(() => {
      const cur = lives.get(convoId);
      if (cur === live) {
        cur.mascot.destroy();
        lives.delete(convoId);
        cloudTyping.delete(convoId);
        if (visible && page === "chat" && convoId === state.activeId) { renderLive(); renderComposer(); }
      }
    }, 90_000));
    if (visible && page === "chat") {
      if (convoId === state.activeId) { renderLive(); renderComposer(); }
      refreshBadge(convoId);
    }
  };

  const decideCloudApproval = async (btn: HTMLElement, approve: boolean): Promise<void> => {
    if (!cloud) return;
    const id = btn.dataset.approval ?? "";
    const scope = btn.dataset.scope === "hour" ? "hour" : "once";
    btn.closest(".bot-event-approval")?.querySelectorAll("button").forEach((b) => b.setAttribute("disabled", ""));
    try {
      await cloud.decideApproval(id, approve, scope);
    } catch (e) {
      showToast(hubErrorText(e));
      btn.closest(".bot-event-approval")?.querySelectorAll("button").forEach((b) => b.removeAttribute("disabled"));
    }
  };

  const renderPanelDomInner = (): void => {
    const panel = q("[data-bot-panel]");
    if (!panel) return;
    panel.hidden = !panelOpen;
    q(".bot-chat")?.classList.toggle("has-panel", panelOpen);
    if (!panelOpen) {
      quotaCardShown = false;
      panel.innerHTML = "";
      sweepMascots();
      screen.sync(false, false);
      return;
    }

    const group = activeGroup();
    if (group) {
      // 群资料：成员 + 电脑（电脑是大家共用的那台）。内容少，每次整块重画
      const members = groupMembers(group, state.bots);
      const tab = panelTab === "computer" ? "computer" : "members";
      const computerBody = tab === "computer" && members[0]
        ? renderPanelBody({ ...members[0], name: groupTitle(group, state.bots) }, "computer", pcView, Date.now(), pcQuota)
        : "";
      const prevScroll = panel.scrollTop;
      panel.dataset.kind = "group";
      panel.innerHTML = renderGroupPanel(group, state.bots, tab, computerBody);
      panel.scrollTop = prevScroll;
      markQuotaEnter(panel);
      screen.sync(pcView.phase === "running", pcView.userControl);
      if (tab === "computer") refreshQuota();
      return;
    }

    const curBot = active();
    // 刚从群资料切过来：骨架是群的，不能原位更新
    const wasGroup = panel.dataset.kind === "group";
    panel.dataset.kind = "bot";
    const heroEl = wasGroup ? null : panel.querySelector(".bot-panel-hero");
    const bodyEl = wasGroup ? null : panel.querySelector<HTMLElement>(".bot-panel-body");

    // 骨架已在 DOM 中时做原位局部更新：保留头像吉祥物、标签与选项卡，避免整栏销毁重建导致闪烁
    if (heroEl && bodyEl) {
      const nameBtn = panel.querySelector<HTMLElement>(".bot-panel-name");
      if (nameBtn && nameBtn.textContent !== curBot.name) {
        nameBtn.textContent = curBot.name;
      }
      const tagsEl = panel.querySelector<HTMLElement>(".bot-tags");
      if (tagsEl) {
        tagsEl.innerHTML = renderPanelTags(curBot.tags);
      }
      panel.querySelectorAll<HTMLElement>(".bot-tab").forEach((tabEl) => {
        const isCur = tabEl.dataset.tab === panelTab;
        tabEl.classList.toggle("is-active", isCur);
        tabEl.setAttribute("aria-selected", String(isCur));
      });

      const activeEl = document.activeElement;
      const isEditingMemory = Boolean(activeEl?.matches?.("[data-bot-memory]") && panel.contains(activeEl));
      if (!isEditingMemory) {
        const prevScroll = panel.scrollTop;
        bodyEl.dataset.tabBody = panelTab;
        bodyEl.innerHTML = renderPanelBody(curBot, panelTab, pcView, Date.now(), pcQuota);
        markQuotaEnter(bodyEl);
        panel.scrollTop = prevScroll;
      }

      screen.sync(pcView.phase === "running", pcView.userControl);
      if (panelTab === "computer") refreshQuota();
      return;
    }

    quotaCardShown = false;
    panel.innerHTML = renderPanel(curBot, panelTab, pcView, Date.now(), pcQuota);
    markQuotaEnter(panel);
    mountMascots(panel);
    screen.sync(pcView.phase === "running", pcView.userControl);
    if (panelTab === "computer") refreshQuota();
  };

  /**
   * 拉一次试用额度。15s 内不重复拉（面板会因为别的原因频繁重绘）；`force` 用在计费心跳之后。
   * 失败保留上一份 —— 网络抖一下不该让卡片闪没。⚠ 失败也要记时间，否则重绘→再拉→再失败会打转。
   */
  const refreshQuota = (force = false): void => {
    if (quotaBusy || (!force && Date.now() - quotaAt < 15_000)) return;
    quotaBusy = true;
    void computer.quota(AbortSignal.timeout(20_000))
      .then((q) => q, () => pcQuota)
      .then((q) => {
        quotaBusy = false;
        quotaAt = Date.now();
        const changed = JSON.stringify(q) !== JSON.stringify(pcQuota);
        pcQuota = q;
        if (changed && visible && page === "chat" && panelOpen && panelTab === "computer") renderPanelDom();
      });
  };

  const renderScreen = (): void => {
    const host = q("[data-bot-screen]");
    if (!host) return;
    host.hidden = !screenOpen;
    host.innerHTML = screenOpen ? renderScreenOverlay(titleOf(current()), pcView) : "";
    screen.sync(pcView.phase === "running" && (screenOpen || (panelOpen && panelTab === "computer")), pcView.userControl);
  };

  const onComputerView = (v: ComputerView): void => {
    const changed = v.phase !== pcView.phase || v.userControl !== pcView.userControl || v.error !== pcView.error || v.hasBrowser !== pcView.hasBrowser;
    const billedChanged = v.billedSeconds !== pcView.billedSeconds;
    pcView = v;
    if (!visible || page !== "chat") return;
    if (!changed && !billedChanged) return;
    renderPcPill();
    if (v.phase !== "running" && v.userControl) computer.setUserControl(false);
    if (panelOpen && panelTab === "computer" && changed) renderPanelDom();
    // 每次计费心跳 / 开关机后额度都变了：卡片跟着刷新
    if (panelOpen && panelTab === "computer") refreshQuota(true);
    if (screenOpen && changed) renderScreen();
  };
  let unsubscribeComputer = computer.subscribe(onComputerView);

  /** 打开的会话换了：面板 / 画面 / 上传改看这个会话的那台电脑 */
  const bindComputer = (): void => {
    const next = computerOf(current());
    if (next === computer) return;
    unsubscribeComputer();
    computer.setUserControl(false);
    screen.disconnect();
    computer = next;
    pcView = computer.view();
    unsubscribeComputer = computer.subscribe(onComputerView);
  };

  // ── 发送与一轮的生命周期 ──────────────────────────────────────────────────

  /** 群聊里的等待：按 pace 缩放；点停止（live.wake）立刻醒 */
  const pause = (ms: number, live?: LiveTurn): Promise<void> => new Promise((resolve) => {
    const wait = Math.max(0, Math.round(ms * pace));
    if (live?.stopped) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      if (live?.wake === done) live.wake = undefined;
      resolve();
    };
    const timer = setTimeout(done, wait);
    if (live) live.wake = done;
  });

  const socialMembers = (group: BotGroup): SocialMember[] =>
    groupMembers(group, state.bots).map((b) => ({ id: b.id, name: b.name, tags: b.tags }));

  /** 当前打开的会话里这几条用户消息的回执重画一遍（只换行，不整页重绘） */
  const patchReceipts = (convo: Convo): void => {
    if (!visible || page !== "chat" || convo.id !== state.activeId) return;
    for (const m of convo.thread.slice(-40)) {
      if (m.role !== "user") continue;
      const el = root.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(m.id)}"] > .bot-receipt`);
      const view = isGroup(convo) ? groupReceipt(convo, m, state.bots) : singleReceipt(convo, m);
      const html = receiptHtml(view);
      if (!el) {
        if (html) patchRow(m);
        continue;
      }
      if (el.outerHTML !== html) {
        const tpl = document.createElement("template");
        tpl.innerHTML = html;
        el.replaceWith(tpl.content);
      }
    }
  };

  /** 群成员「看到」了：已读游标推到当前最后一条（只进不退） */
  const markRead = (group: BotGroup, botId: string): void => {
    if (!state.groups.includes(group) || !group.memberIds.includes(botId)) return;
    const last = [...group.thread].reverse().find((m) => m.role !== "event");
    if (!last) return;
    group.read ??= {};
    if (!advanceRead(group.thread, group.read, botId, last.id)) return;
    persist();
    patchReceipts(group);
  };

  /** 群里 Bot 给某条消息点表情（[PASS:👍] / react 工具）：每个 Bot 各自最多一个 */
  const groupReact = (group: BotGroup, botId: string, emoji: string, targetId?: string): BotChatMessage | null => {
    const target = (targetId ? group.thread.find((m) => m.id === targetId) : undefined)
      ?? [...group.thread].reverse().find((m) => m.role === "user");
    if (!target) return null;
    setBotReaction(target, emoji, botId);
    persist();
    if (visible && page === "chat" && group.id === state.activeId) patchRow(target);
    return target;
  };

  /** 群聊：写好的一段按打字速度一条条发出去。第一条扣掉模型生成这段已经花掉的时间 */
  const postBubbles = async (live: LiveTurn, group: BotGroup, authorId: string, parts: string[], replyTo: string | undefined, spentMs: number): Promise<void> => {
    for (let i = 0; i < parts.length; i++) {
      if (!state.groups.includes(group)) return;
      const delay = typingDelayMs(parts[i], rng) - (i === 0 ? spentMs : 0);
      if (delay > 0 && !live.stopped) {
        live.composing = true;
        if (visible && page === "chat") { patchTypingHead(); patchPreview(group.id); }
        await pause(delay, live);
      }
      const msg: BotChatMessage = { id: uuidv4(), role: "bot", text: parts[i], at: Date.now(), authorId, ...(i === 0 && replyTo ? { replyTo } : {}) };
      group.thread.push(msg);
      group.read ??= {};
      advanceRead(group.thread, group.read, authorId, msg.id);
      persist();
      if (visible && page === "chat") {
        if (group.id === state.activeId) { renderThreadDom(); stickToBottom(); }
        renderList();
      }
    }
    live.composing = false;
    if (visible && page === "chat") patchTypingHead();
  };

  /** 把流式攒下的这段话落进线程。群里：[PASS] 当它没说话（[PASS:👍] 点个表情），↩#ab12 变成引用，逐条发 */
  const commitSegment = (live: LiveTurn): void => {
    const text = live.text.trim();
    live.text = "";
    const startedAt = live.textStartedAt;
    live.textStartedAt = undefined;
    if (!text) return;
    const convo = findConvo(live.botId);
    if (!convo) return;
    if (isGroup(convo) && live.authorId) {
      const authorId = live.authorId;
      const reply = parseBotReply(text);
      if (reply.pass) {
        if (reply.reaction) groupReact(convo, authorId, reply.reaction, live.triggerId);
        return;
      }
      const parts = splitBubbles(reply.body);
      if (!parts.length) return;
      live.wroteText = true;
      live.spoken = `${live.spoken ?? ""}${reply.body}\n\n`;
      const replyTo = reply.quoteRef ? resolveRef(convo.thread, reply.quoteRef) : undefined;
      const spent = startedAt ? Date.now() - startedAt : 0;
      live.posting = (live.posting ?? Promise.resolve()).then(() => postBubbles(live, convo, authorId, parts, replyTo, spent));
      return;
    }
    live.wroteText = true;
    const now = Date.now();
    for (const part of splitBubbles(text)) {
      convo.thread.push({ id: uuidv4(), role: "bot", text: part, at: now });
    }
    persist();
    if (visible && page === "chat" && convo.id === state.activeId) renderThreadDom();
  };

  const approvalLabel = (ev: Extract<AgentEvent, { type: "tool-call-pending" }>): string => {
    const a = (ev.args ?? {}) as Record<string, unknown>;
    if (ev.toolName === "web_fetch" && typeof a.url === "string") return `允许打开 ${a.url} 吗？`;
    if (ev.toolName === "web_search" && typeof a.query === "string") return `允许搜索「${a.query}」吗？`;
    return ev.summary ? `需要确认：${ev.summary}` : "需要确认这一步";
  };

  const onEvent = (live: LiveTurn, ev: AgentEvent): void => {
    const convoId = live.botId;
    live.mascot.onAgentEvent(ev);
    switch (ev.type) {
      case "message-start":
        commitSegment(live);
        break;
      case "text-delta":
        if (!live.text) live.textStartedAt = Date.now();
        live.text += ev.delta;
        live.status = "";
        break;
      case "reasoning-delta":
        if (!live.text) live.status = "思考中…";
        break;
      case "tool-args-delta":
        live.status = describeToolActivity(ev.toolName, {});
        break;
      case "tool-call-pending":
        commitSegment(live);
        live.approvals.push({ callId: ev.callId, toolName: ev.toolName, label: approvalLabel(ev) });
        live.status = "等待你确认…";
        break;
      case "tool-call-executing":
        commitSegment(live);
        live.approvals = live.approvals.filter((a) => a.callId !== ev.callId);
        live.status = describeToolActivity(ev.toolName, ev.args);
        break;
      case "tool-result":
        live.approvals = live.approvals.filter((a) => a.callId !== ev.callId);
        live.status = ev.ok ? "思考中…" : "遇到问题，正在调整…";
        break;
      case "stream-retry":
        live.status = "网络不稳定，正在重连…";
        break;
      case "agent-notice":
        if (ev.category === "compaction") live.status = "正在整理记忆…";
        break;
      case "error":
        live.error = ev.message;
        break;
      case "turn-done":
        commitSegment(live);
        break;
    }
    if (visible && page === "chat") {
      if (ev.type === "tool-call-pending" || ev.type === "tool-call-executing" || ev.type === "tool-result") refreshBadge(convoId);
      if (convoId === state.activeId) {
        scheduleLive();
        if (ev.type === "tool-call-pending" || ev.type === "tool-call-executing" || ev.type === "turn-done") renderComposer();
      }
      if (ev.type === "tool-call-executing" || ev.type === "turn-start") patchPreview(convoId);
    }
  };

  /** 单聊：云端的它在用户不在时发过的话（定时任务 / 监控 / 闲聊），本地模型历史里没有，补一句上下文 */
  const cloudPreface = (bot: BotProfile, first: BotChatMessage | undefined): string => {
    const at = first ? bot.thread.indexOf(first) : -1;
    if (at <= 0) return "";
    const said: string[] = [];
    for (let i = at - 1; i >= 0 && said.length < 5; i--) {
      const m = bot.thread[i];
      if (m.role === "user") break;
      if (m.origin && m.role === "bot" && m.text.trim()) said.unshift(`「${plainPreview(m.text, 200)}」`);
    }
    return said.length ? `（我不在的时候，你在云端发过：${said.join("、")}）\n\n` : "";
  };

  const composeTurnText = (bot: BotProfile, msgs: BotChatMessage[]): string =>
    cloudPreface(bot, msgs[0]) + msgs.map((m) => {
      if (!m.replyTo) return m.text;
      const target = bot.thread.find((x) => x.id === m.replyTo);
      if (!target) return m.text;
      const who = target.role === "user" ? "我自己之前说的" : "你之前说的";
      return `（回复${who}：「${plainPreview(target.text, 120)}」）\n${m.text}`;
    }).join("\n\n");

  const ensureTicker = (): void => {
    if (elapsedTimer || !lives.size) return;
    elapsedTimer = setInterval(() => {
      if (!lives.size) {
        if (elapsedTimer) clearInterval(elapsedTimer);
        elapsedTimer = null;
        return;
      }
      if (visible && page === "chat" && lives.has(state.activeId)) {
        const t = q(".bot-typing-text");
        const live = lives.get(state.activeId)!;
        if (t) t.textContent = typingText(live);
        else patchTypingHead();
      }
    }, 1000);
  };

  const runTurn = async (bot: BotProfile, msgs: BotChatMessage[]): Promise<void> => {
    if (!auth.getUserId()) {
      bot.thread.push({ id: uuidv4(), role: "event", text: "请先登录 Cancri 账号再发消息", at: Date.now() });
      persist();
      if (visible && bot.id === state.activeId) renderThreadDom();
      return;
    }
    const firstAt = msgs[0].at;
    const previousUserAt = [...bot.thread].reverse().find((m) => m.role === "user" && m.at < firstAt)?.at ?? null;
    const reactionLines = pendingReactions.get(bot.id) ?? [];
    pendingReactions.delete(bot.id);
    const live: LiveTurn = {
      botId: bot.id, text: "", status: "", startedAt: Date.now(), approvals: [], fileRequest: null,
      wroteText: false, error: null, mascot: new ChatMascot(),
    };
    lives.set(bot.id, live);
    ensureTicker();
    // 交给模型 = 它「读到了」：气泡左边的未读变已读
    bot.readId = msgs.at(-1)!.id;
    persist();
    patchReceipts(bot);
    if (visible && page === "chat") {
      if (bot.id === state.activeId) { renderLive(); renderComposer(); }
      renderList();
    }
    let reason: string = "stop";
    try {
      const images = await collectTurnImages(msgs);
      for await (const ev of runtime.run(bot, { text: composeTurnText(bot, msgs), previousUserAt, reactionLines, ...(images.length ? { images } : {}) })) {
        if (ev.type === "turn-done") reason = ev.reason;
        onEvent(live, ev);
      }
    } catch (e) {
      reason = "error";
      live.error = e instanceof Error ? e.message : String(e);
    } finally {
      commitSegment(live);
      if (reason === "abort") {
        bot.thread.push({ id: uuidv4(), role: "event", text: "已停止", at: Date.now() });
      } else if (reason === "error" || (live.error && !live.wroteText)) {
        bot.thread.push({
          id: uuidv4(), role: "bot", error: true, at: Date.now(),
          text: `回复失败：${live.error ?? "没有收到回复"}`,
        });
      } else if (reason === "max_steps" && !live.wroteText) {
        bot.thread.push({ id: uuidv4(), role: "bot", text: "任务步骤较多，已暂停。需要我继续吗？", at: Date.now() });
      }
      live.mascot.destroy();
      lives.delete(bot.id);
      if (reason === "error" || (live.error && !live.wroteText)) unread.set(bot.id, "error");
      else if (reason !== "abort") unread.set(bot.id, "done");
      persist();
      if (visible && page === "chat") {
        if (bot.id === state.activeId) { renderThreadDom(); renderLive(); renderComposer(); }
        renderList();
      }
      const queued = queues.get(bot.id);
      if (queued?.length && state.bots.includes(bot)) {
        queues.delete(bot.id);
        void runTurn(bot, queued);
      }
    }
  };

  /** 用户发来的一条（或排队攒下的几条）消息 → 这一轮谁会看到、谁会开口（bot-social.ts） */
  const userRound = (group: BotGroup, msgs: BotChatMessage[]): GroupRound => {
    const members = groupMembers(group, state.bots);
    const text = msgs.map((m) => m.text).join("\n");
    const mentions = mentionTargets(text, members);
    const replyToAuthorId = msgs
      .map((m) => (m.replyTo ? group.thread.find((x) => x.id === m.replyTo)?.authorId : undefined))
      .find((id): id is string => !!id);
    const plan = planUserRound({
      text,
      ...(replyToAuthorId ? { replyToAuthorId } : {}),
      members: socialMembers(group),
      mentionedIds: mentions.ids,
      everyone: mentions.everyone,
      thread: group.thread,
      activity: group.activity ?? "normal",
      now: Date.now(),
      rng,
    });
    return { ...plan, triggerId: msgs.at(-1)!.id };
  };

  /**
   * 群聊的一轮（像真人微信群，而不是「每条消息全员轮流答一遍」）：
   *   · 每个成员按各自的延迟「看到」这条 → 用户气泡左边的回执从「未读」变「N人已读」「已读」；
   *   · 只有被挑中的成员开口（被 @ / 被回复的必回；没人点名时最相关的一个领头，其余按群活跃度偶尔插话），
   *     串行：后面的能看到前面说的；没话说的回 [PASS]，或 [PASS:👍] 只点个表情；
   *   · 一个 Bot 说完，按活跃度可能引出别的 Bot 接话（它 @ 谁，谁必接），每条用户消息最多接 maxChain 次。
   * 用户点停止 = 当前这个中断，后面排着的都不说了。
   */
  const runGroupRound = async (group: BotGroup, round: GroupRound): Promise<void> => {
    if (!auth.getUserId()) {
      group.thread.push({ id: uuidv4(), role: "event", text: "请先登录 Cancri 账号再发消息", at: Date.now() });
      persist();
      if (visible && group.id === state.activeId) renderThreadDom();
      return;
    }
    const live: LiveTurn = {
      botId: group.id, text: "", status: "", startedAt: Date.now(), approvals: [], fileRequest: null,
      wroteText: false, error: null, mascot: new ChatMascot(), triggerId: round.triggerId,
    };
    lives.set(group.id, live);
    ensureTicker();
    const roundStart = Date.now();
    // 已读回执：每个成员各看各的。轮次结束了也照样到点已读（没开口的人晚点刷到手机也算）
    for (const r of round.readers) setTimeout(() => markRead(group, r.botId), Math.round(r.delayMs * pace));
    const plan: GroupSpeaker[] = round.speakers.map((sp) => ({ ...sp, dueAt: roundStart + sp.readDelayMs * pace }));
    let chain = 0;
    let anyError = false;
    /** 同一轮里多个成员会看到同一张图：读一次，大家共用 */
    const roundImages = new Map<string, Array<{ url: string; name?: string }>>();
    const imagesFor = async (msgs: BotChatMessage[]): Promise<Array<{ url: string; name?: string }>> => {
      const out: Array<{ url: string; name?: string }> = [];
      for (const m of msgs) {
        if (m.role !== "user" || !m.images?.length) continue;
        if (!roundImages.has(m.id)) roundImages.set(m.id, await collectTurnImages([m]));
        out.push(...roundImages.get(m.id)!);
      }
      return out;
    };
    const rerender = (): void => {
      if (!visible || page !== "chat") return;
      if (group.id === state.activeId) { renderLive(); renderComposer(); }
      renderList();
    };
    if (visible && page === "chat" && group.id === state.activeId) renderComposer();
    try {
      while (plan.length && !live.stopped) {
        // 谁先「看到」谁先说；领头的排最前（它的 dueAt 本来就最早）
        plan.sort((a, b) => Number(b.lead) - Number(a.lead) || a.dueAt - b.dueAt);
        const sp = plan.shift()!;
        const bot = findBot(sp.botId);
        if (!bot || !group.memberIds.includes(bot.id) || !state.groups.includes(group)) continue;
        if (sp.dueAt > Date.now()) await pause((sp.dueAt - Date.now()) / (pace || 1), live);
        if (live.stopped || !state.groups.includes(group)) break;
        const pending = pendingFor(group, bot.id);
        if (!pending.length) continue;
        // 交给它之前就记下「看到这里了」：它说话期间用户新发的消息留给下一轮
        group.seen[bot.id] = group.thread.at(-1)!.id;
        markRead(group, bot.id);
        Object.assign(live, {
          authorId: bot.id, role: sp, spoken: "", text: "", status: "", startedAt: Date.now(),
          approvals: [], wroteText: false, error: null, composing: false, posting: undefined, textStartedAt: undefined,
        });
        rerender();
        const firstAt = pending[0].at;
        const previousUserAt = [...group.thread].reverse().find((m) => m.role === "user" && m.at < firstAt)?.at ?? null;
        let reason = "stop";
        try {
          const images = await imagesFor(pending);
          for await (const ev of runtime.run(bot, {
            text: formatTranscript(group, pending, state.bots),
            previousUserAt,
            reactionLines: [],
            ...(images.length ? { images } : {}),
            group: { group, bots: state.bots, mustReply: sp.mustReply, role: { mustReply: sp.mustReply, lead: sp.lead, followUp: !!sp.followUp } },
          })) {
            if (ev.type === "turn-done") reason = ev.reason;
            onEvent(live, ev);
          }
        } catch (e) {
          reason = "error";
          live.error = e instanceof Error ? e.message : String(e);
        }
        commitSegment(live);
        await live.posting;
        live.posting = undefined;
        if (reason === "abort") {
          live.stopped = true;
          group.thread.push({ id: uuidv4(), role: "event", text: `${bot.name} 已停止`, at: Date.now() });
        } else if (reason === "error" || (live.error && !live.wroteText)) {
          // 顺带插话的失败了就当它没说话；该它回的（被点名 / 领头）才报错，可以重试
          if (sp.mustReply || sp.lead) {
            anyError = true;
            group.thread.push({
              id: uuidv4(), role: "bot", error: true, at: Date.now(), authorId: bot.id,
              text: `回复失败：${live.error ?? "没有收到回复"}`,
            });
          }
        } else if (reason === "max_steps" && !live.wroteText) {
          group.thread.push({ id: uuidv4(), role: "bot", authorId: bot.id, text: "任务步骤较多，已暂停。需要我继续吗？", at: Date.now() });
        }
        persist();
        if (visible && page === "chat" && group.id === state.activeId) renderThreadDom();
        // 接话：它 @ 了谁谁必接（已经排着的升级成必回）；没 @ 人时按活跃度偶尔有人接一句
        const spoken = live.spoken ?? "";
        if (spoken && !live.stopped) {
          const others = groupMembers(group, state.bots).filter((b) => b.id !== bot.id);
          const t = mentionTargets(spoken, others);
          for (const id of t.ids) {
            const at = plan.findIndex((p) => p.botId === id);
            if (at >= 0) plan[at] = { ...plan[at], mustReply: true };
          }
          const next = planFollowUps({
            authorId: bot.id, spoken, members: socialMembers(group), mentionedIds: t.ids, everyone: t.everyone,
            activity: group.activity ?? "normal", chainSoFar: chain, queued: plan.map((p) => p.botId), rng,
          });
          for (const n of next) {
            plan.push({ ...n, followUp: true, dueAt: Date.now() + n.readDelayMs * pace });
            chain++;
          }
        }
      }
    } finally {
      commitSegment(live);
      await live.posting?.catch(() => {});
      live.wake?.();
      live.mascot.destroy();
      lives.delete(group.id);
      if (anyError) unread.set(group.id, "error");
      else if (!live.stopped) unread.set(group.id, "done");
      persist();
      if (visible && page === "chat") {
        if (group.id === state.activeId) { renderThreadDom(); renderLive(); renderComposer(); }
        renderList();
      }
      const queued = queues.get(group.id);
      if (queued?.length && state.groups.includes(group)) {
        queues.delete(group.id);
        void runGroupRound(group, userRound(group, queued));
      }
    }
  };

  /** 停掉一个会话正在跑的这一轮；群里连同后面排队的成员一起停 */
  const stopConvo = (convoId: string): void => {
    const live = lives.get(convoId);
    if (!live) return;
    // 云端那一轮停不了（它在服务器上跑）：只把占位收掉
    if (live.cloud) {
      onCloudTyping({ conv: findGroup(convoId) ? `group:${convoId}` : `bot:${convoId}`, botId: live.authorId ?? convoId, on: false });
      return;
    }
    if (!findGroup(convoId)) {
      runtime.abort(convoId);
      return;
    }
    if (!live.authorId) {
      // 群里还没人开口（都在「看消息」的空档）：直接收掉这一轮
      live.stopped = true;
      live.wake?.();
      return;
    }
    live.stopped = true;
    live.wake?.();
    runtime.abort(groupSessionKey(convoId, live.authorId));
  };

  const send = (): void => {
    const input = q<HTMLTextAreaElement>("[data-bot-input]");
    if (!input) return;
    const text = input.value.trim();
    const convo = current();
    const images = draftImagesOf(convo.id);
    if (!text && !images.length) {
      if (lives.has(convo.id)) stopConvo(convo.id);
      return;
    }
    if (remote && images.length) {
      showToast("网页端暂不支持发图片，请在桌面端发送");
      return;
    }
    const msg: BotChatMessage = {
      id: uuidv4(), role: "user", text, at: Date.now(),
      ...(replyTo ? { replyTo } : {}),
      ...(images.length ? { images: images.map((i) => ({ id: i.id })) } : {}),
    };
    if (images.length) {
      sentImages.set(msg.id, images.map((i) => ({ url: i.dataUrl, name: i.name })));
      for (const img of images) {
        const blob = dataUrlToBlob(img.dataUrl);
        if (blob) void putBotImage(img.id, blob).catch(() => showToast("图片保存失败，重启后将无法查看。"));
      }
      draftImages.delete(convo.id);
    }
    // 用户直接打字回答了起名问题之外的事，也算「认识过了」：起名卡不再挡在下面
    if (!isGroup(convo)) convo.named = true;
    convo.thread.push(msg);
    convo.draft = "";
    replyTo = null;
    mention = null;
    input.value = "";
    autoGrow(input);
    persist();
    pinned = true;
    renderThreadDom();
    renderComposer();
    renderMentionMenu();
    renderList();
    scrollToBottom(true);
    if (remote) {
      sendRemote(convo, msg);
      return;
    }
    if (lives.has(convo.id)) {
      const queue = queues.get(convo.id) ?? [];
      queue.push(msg);
      queues.set(convo.id, queue);
      return;
    }
    if (isGroup(convo)) void runGroupRound(convo, userRound(convo, [msg]));
    else void runTurn(convo, [msg]);
  };

  /** 网页 / 手机：消息交给云端，回复从云端事件回来（单聊先亮「思考中…」） */
  const sendRemote = (convo: Convo, msg: BotChatMessage): void => {
    const conv = isGroup(convo) ? (`group:${convo.id}` as const) : (`bot:${convo.id}` as const);
    if (!cloud?.isOn()) {
      convo.thread.push({ id: uuidv4(), role: "event", text: cloud?.info.phase === "unavailable" ? "云端运行暂未对这个账号开放" : "还没连上云端，稍后自动重试", at: Date.now() });
      persistLocal();
      if (visible && convo.id === state.activeId) renderThreadDom();
      void cloud?.start();
      return;
    }
    if (!isGroup(convo)) onCloudTyping({ conv, botId: convo.id, on: true });
    void cloud.sendRemote(conv, { id: msg.id, text: msg.text, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}) }).catch((e: unknown) => {
      onCloudTyping({ conv, botId: convo.id, on: false });
      convo.thread.push({ id: uuidv4(), role: "event", at: Date.now(), text: `发送失败：${hubErrorText(e)}` });
      persistLocal();
      if (visible && page === "chat" && convo.id === state.activeId) renderThreadDom();
    });
  };

  const pickName = (raw: string): void => {
    const bot = active();
    const typed = raw.trim().slice(0, 24);
    if (!typed) return;
    const now = Date.now();
    bot.thread.push({ id: uuidv4(), role: "user", text: typed, at: now });
    const name = renameBot(bot, typed) ?? bot.name;
    bot.thread.push({ id: uuidv4(), role: "event", text: `已重命名为 ${name}`, at: now });
    bot.thread.push({ id: uuidv4(), role: "bot", text: `好，以后就叫 ${name}。`, at: now + 1 });
    bot.thread.push({ id: uuidv4(), role: "bot", text: "我有自己的云电脑，可以帮你查资料、上网、写代码。你平时主要做些什么？", at: now + 2 });
    persist();
    renderList();
    renderHead();
    renderThreadDom();
    scrollToBottom(true);
  };

  // ── 弹层 ──────────────────────────────────────────────────────────────────

  const closePopover = (): void => {
    popover = null;
    const pop = q("[data-bot-pop]");
    if (pop) {
      pop.hidden = true;
      pop.innerHTML = "";
    }
    root.querySelectorAll(".bot-row.is-hovering").forEach((el) => el.classList.remove("is-hovering"));
  };

  const openPopover = (p: Popover): void => {
    const pop = q("[data-bot-pop]");
    if (!pop) return;
    popover = p;
    const msg = "id" in p && p.kind !== "bot-menu" ? current().thread.find((m) => m.id === p.id) : null;
    if (p.kind === "react") {
      const mine = new Set(msg?.reactions?.filter((r) => r.by === "user").map((r) => r.emoji));
      pop.innerHTML = `<div class="bot-pop-row">${QUICK_REACTIONS.map((e) => `<button type="button" class="bot-emoji${mine.has(e) ? " is-on" : ""}" data-bot-action="react-pick" data-id="${escapeAttr(p.id)}" data-emoji="${escapeAttr(e)}" aria-label="${escapeAttr(e)}">${e}</button>`).join("")}<button type="button" class="bot-emoji bot-emoji--more" data-bot-action="react-more" data-id="${escapeAttr(p.id)}" aria-label="更多表情">${ICON_PLUS}</button></div>`;
    } else if (p.kind === "emoji-grid") {
      pop.innerHTML = `<div class="bot-pop-grid">${MORE_EMOJIS.map((e) => `<button type="button" class="bot-emoji" data-bot-action="react-pick" data-id="${escapeAttr(p.id)}" data-emoji="${escapeAttr(e)}" aria-label="${escapeAttr(e)}">${e}</button>`).join("")}</div>`;
    } else if (p.kind === "more") {
      pop.innerHTML = `<div class="bot-pop-menu">
          <button type="button" data-bot-action="copy" data-id="${escapeAttr(p.id)}">复制</button>
          <button type="button" data-bot-action="reply" data-id="${escapeAttr(p.id)}">回复</button>
          <button type="button" class="is-danger" data-bot-action="delete-msg" data-id="${escapeAttr(p.id)}">删除</button>
        </div>`;
    } else if (p.kind === "bot-menu") {
      const target = findConvo(p.id);
      const pinned = !!target?.pinnedAt;
      const group = target && isGroup(target);
      pop.innerHTML = `<div class="bot-pop-menu">
          <button type="button" data-bot-action="pin-bot" data-id="${escapeAttr(p.id)}">${pinned ? "取消置顶" : "置顶对话"}</button>
          <button type="button" class="is-danger" data-bot-action="${group ? "group-delete" : "delete-bot"}" data-id="${escapeAttr(p.id)}">${group ? "删除群聊" : "删除对话"}</button>
        </div>`;
    } else if (p.kind === "group-add") {
      const group = activeGroup();
      pop.innerHTML = group ? groupAddMenuHtml(group, state.bots) : "";
    } else {
      const convo = current();
      pop.innerHTML = `<div class="bot-pop-menu">
          <button type="button" data-bot-action="upload">${ICON_UPLOAD}<span>${isGroup(convo) ? "上传文件到云电脑" : `上传文件到 ${escapeHtml(convo.name)} 的电脑`}</span></button>
          <button type="button" data-bot-action="pc-panel">${ICON_MONITOR}<span>查看电脑</span></button>
        </div>`;
    }
    pop.hidden = false;
    const row = p.anchor.closest<HTMLElement>(".bot-row");
    row?.classList.add("is-hovering");
    const rr = root.getBoundingClientRect();
    const ar = p.anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = p.kind === "bot-menu" ? p.x - rr.left : ar.left - rr.left + ar.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, rr.width - pw - 8));
    let top = p.kind === "bot-menu" ? p.y - rr.top : ar.bottom - rr.top + 6;
    if (top + ph > rr.height - 8) top = p.kind === "bot-menu" ? rr.height - ph - 8 : ar.top - rr.top - ph - 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.max(8, top)}px`;
  };

  // ── 内联编辑（改名 / 标签） ───────────────────────────────────────────────

  const inlineEdit = (anchor: HTMLElement, opts: { value: string; placeholder: string; max: number; onDone: (v: string) => void }): void => {
    const input = document.createElement("input");
    input.className = "bot-input bot-inline-input";
    input.value = opts.value;
    input.placeholder = opts.placeholder;
    input.maxLength = opts.max;
    anchor.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (input.isConnected) input.replaceWith(anchor);
      if (save && input.value.trim()) opts.onDone(input.value.trim());
      else renderPanelDom();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true));
  };

  // ── 动作 ──────────────────────────────────────────────────────────────────

  const selectBot = (id: string, opts: { limit?: number; flash?: string | null } = {}): void => {
    if (!findConvo(id)) return;
    const input = q<HTMLTextAreaElement>("[data-bot-input]");
    if (input) current().draft = input.value;
    const leavingComposer = composing !== null;
    composing = null;
    mention = null;
    const switching = id !== state.activeId || leavingComposer;
    if (switching) {
      openedBefore.push(state.activeId);
      if (openedBefore.length > 32) openedBefore.shift();
    }
    state.activeId = id;
    setPane("convo");
    deps.onActive?.(findGroup(id) ? `group:${id}` : `bot:${id}`);
    bindComputer();
    if (switching) replyTo = null;
    threadLimit = opts.limit ?? THREAD_PAGE;
    flashId = opts.flash ?? null;
    persist();
    if (switching) renderChat();
    else {
      renderThreadDom();
      renderList();
    }
  };

  /** 删群：停掉正在跑的那一轮，丢掉成员在群里的 controller 与群里的图片。Bot 本身不动 */
  const dropGroup = (group: BotGroup): void => {
    stopConvo(group.id);
    // 群共用的那台电脑跟着群走：关机、去掉映射（按秒计费，不能留孤儿机器）
    void pool?.drop(`group:${group.id}`).catch(() => {});
    runtime.forgetGroup(group.id);
    queues.delete(group.id);
    unread.delete(group.id);
    void deleteBotImages(imageIdsOf(group.thread));
    state.groups = state.groups.filter((g) => g !== group);
  };

  /** 群里加 / 减成员、改名之后：列表、头部、线程、面板都可能变 */
  const refreshGroupChrome = (): void => {
    persist();
    renderList();
    renderHead();
    renderThreadDom();
    renderPanelDom();
  };

  const toggleUserReaction = (id: string, emoji: string): void => {
    const convo = current();
    const msg = convo.thread.find((m) => m.id === id);
    if (!msg) return;
    const added = toggleReaction(msg, emoji, "user");
    // 群里的表情不回传给模型：不知道该告诉哪个 Bot 的哪一轮
    if (added && msg.role === "bot" && !isGroup(convo)) {
      const bot = convo;
      const lines = pendingReactions.get(bot.id) ?? [];
      lines.push(`你说「${plainPreview(msg.text, 50)}」→ 用户点了 ${emoji}`);
      pendingReactions.set(bot.id, lines.slice(-5));
    }
    persist();
    patchRow(msg);
  };

  const pcAction = async (fn: () => Promise<void>, busyText?: string): Promise<void> => {
    if (busyText) showToast(busyText);
    try {
      await fn();
    } catch (e) {
      showToast(computerErrorMessage(e).message);
    }
  };

  const uploadFiles = async (files: FileList): Promise<void> => {
    const convo = current();
    const list = Array.from(files);
    showToast(list.length > 1 ? `正在上传 ${list.length} 个文件…` : `正在上传 ${list[0].name}…`);
    let result: Awaited<ReturnType<typeof uploadLocalFiles>>;
    try {
      result = await uploadLocalFiles(computer, list, AbortSignal.timeout(600_000));
    } catch (e) {
      showToast(`上传失败：${computerErrorMessage(e).message}`);
      return;
    }
    for (const f of result.failed) showToast(`${f.name} 上传失败：${f.reason}`);
    const done = result.done.map((f) => f.path);
    if (!done.length) return;
    convo.thread.push({ id: uuidv4(), role: "event", text: isGroup(convo) ? `已上传 ${done.length} 个文件到云电脑` : `已上传 ${done.length} 个文件到 ${convo.name} 的电脑`, at: Date.now() });
    persist();
    if (convo.id === state.activeId) renderThreadDom();
    const input = q<HTMLTextAreaElement>("[data-bot-input]");
    if (input && convo.id === state.activeId) {
      const note = isGroup(convo) ? `（我把文件放到云电脑上了：${done.join("、")}）` : `（我把文件放到你电脑上了：${done.join("、")}）`;
      input.value = input.value ? `${input.value}\n${note}` : note;
      autoGrow(input);
      input.focus();
      renderComposer();
    }
    scrollToBottom(true);
  };

  const handleAction = (btn: HTMLElement, event: Event): void => {
    const action = btn.dataset.botAction;
    const id = btn.dataset.id ?? "";
    const bot = active();
    /** 线程、输入框、这一轮的确认卡：单聊和群聊都走当前会话 */
    const convo = current();
    switch (action) {
      // 云端运行
      case "cloud-approve":
        void decideCloudApproval(btn, true);
        break;
      case "cloud-deny":
        void decideCloudApproval(btn, false);
        break;
      // 引导
      case "next":
        if (step + 1 >= ONBOARDING_STEPS) {
          state.onboardedAt = Date.now();
          persist();
          page = "chat";
          renderChat();
        } else {
          step++;
          renderOnboarding();
        }
        break;
      case "back":
        if (step > 0) { step--; renderOnboarding(); }
        break;
      case "pick-name":
        pickName(btn.dataset.name ?? "");
        break;
      case "ask-dismiss":
        bot.named = true;
        persist();
        renderThreadDom();
        break;
      // 列表
      case "search":
        searching = !searching;
        if (!searching) query = "";
        q("[data-bot-search]")?.toggleAttribute("hidden", !searching);
        btn.classList.toggle("is-on", searching);
        if (searching) q<HTMLInputElement>("[data-bot-search-input]")?.focus();
        else renderList();
        break;
      case "new-bot": {
        const fresh = createBot(nextBotName(state));
        state.bots.push(fresh);
        selectBot(fresh.id);
        break;
      }
      case "select": {
        const target = findConvo(id);
        if (!target) break;
        const needle = query.trim().toLowerCase();
        const hit = needle ? target.thread.find((m) => m.text.toLowerCase().includes(needle)) : undefined;
        // 搜索命中：把线程展开到那条消息并闪一下
        selectBot(id, hit
          ? { limit: Math.max(THREAD_PAGE, target.thread.length - target.thread.indexOf(hit)), flash: hit.id }
          : {});
        break;
      }
      // 线程
      case "load-more":
        threadLimit += THREAD_PAGE;
        renderThreadDom();
        break;
      case "jump": {
        const target = convo.thread.find((m) => m.id === id);
        if (!target) break;
        const idx = convo.thread.indexOf(target);
        threadLimit = Math.max(threadLimit, convo.thread.length - idx);
        flashId = id;
        renderThreadDom();
        break;
      }
      case "jump-bottom":
        pinned = true;
        scrollToBottom(true);
        break;
      case "react-open":
        openPopover({ kind: "react", id, anchor: btn });
        break;
      case "react-more": {
        const anchor = root.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"] [data-bot-action="react-open"]`) ?? btn;
        openPopover({ kind: "emoji-grid", id, anchor });
        break;
      }
      case "react-pick":
        toggleUserReaction(id, btn.dataset.emoji ?? "");
        closePopover();
        break;
      case "react-toggle":
        // 点自己的 = 取消；点 Bot 点的 = 跟一个同款
        toggleUserReaction(id, btn.dataset.emoji ?? "");
        break;
      case "reply":
        replyTo = id;
        closePopover();
        renderComposer();
        q<HTMLTextAreaElement>("[data-bot-input]")?.focus();
        break;
      case "reply-cancel":
        replyTo = null;
        renderComposer();
        break;
      case "more":
        openPopover({ kind: "more", id, anchor: btn });
        break;
      case "copy": {
        const msg = convo.thread.find((m) => m.id === id);
        closePopover();
        if (msg) void navigator.clipboard.writeText(msg.text).then(() => showToast("已复制"), () => showToast("复制失败"));
        break;
      }
      case "delete-msg":
        closePopover();
        void deleteBotImages(imageIdsOf(convo.thread.filter((m) => m.id === id)));
        convo.thread = convo.thread.filter((m) => m.id !== id);
        if (replyTo === id) replyTo = null;
        cloud?.removeMessages(isGroup(convo) ? `group:${convo.id}` : `bot:${convo.id}`, [id]);
        persist();
        renderThreadDom();
        renderComposer();
        renderList();
        break;
      case "retry": {
        const idx = convo.thread.findIndex((m) => m.id === id);
        if (idx < 0 || lives.has(convo.id)) break;
        const failed = convo.thread[idx];
        const lastUserIdx = convo.thread.slice(0, idx).map((m) => m.role).lastIndexOf("user");
        convo.thread.splice(idx, 1);
        persist();
        renderThreadDom();
        if (lastUserIdx < 0) break;
        if (remote) {
          // 云端对同一条消息只回一次：重发一条同样的话
          const again: BotChatMessage = { id: uuidv4(), role: "user", text: convo.thread[lastUserIdx].text, at: Date.now() };
          convo.thread.push(again);
          persist();
          renderThreadDom();
          sendRemote(convo, again);
          break;
        }
        if (isGroup(convo)) {
          // 让失败的那个 Bot 从那条用户消息起重新看一遍，只叫它一个
          const authorId = failed.authorId;
          if (!authorId || !findBot(authorId)) break;
          if (lastUserIdx > 0) convo.seen[authorId] = convo.thread[lastUserIdx - 1].id;
          else delete convo.seen[authorId];
          void runGroupRound(convo, { speakers: [{ botId: authorId, mustReply: true, lead: false, readDelayMs: 0 }], readers: [] });
        } else {
          void runTurn(convo, [convo.thread[lastUserIdx]]);
        }
        break;
      }
      case "approve":
      case "deny": {
        const live = lives.get(convo.id);
        const speaker = findBot(live?.authorId);
        const ctl = isGroup(convo) && speaker ? runtime.controllerFor(speaker, convo) : runtime.controllerFor(bot);
        if (action === "approve") ctl.approveCall(id);
        else ctl.denyCall(id, "用户说不用了");
        if (live) {
          live.approvals = live.approvals.filter((a) => a.callId !== id);
          live.status = action === "approve" ? "已允许，继续…" : "已拒绝，跳过这一步";
          renderLive();
        }
        break;
      }
      // 输入框
      case "send":
        send();
        break;
      case "plus":
        openPopover({ kind: "plus", anchor: btn });
        break;
      case "image-remove":
        draftImages.set(convo.id, draftImagesOf(convo.id).filter((i) => i.id !== id));
        renderComposer();
        break;
      case "file-pick": {
        const req = lives.get(convo.id)?.fileRequest;
        const input = q<HTMLInputElement>("[data-bot-pick]");
        if (!req || !input) break;
        pickingFor = convo.id;
        input.multiple = req.multiple;
        input.click();
        break;
      }
      case "file-deny":
        lives.get(convo.id)?.fileRequest?.finish(null);
        break;
      case "upload":
        closePopover();
        q<HTMLInputElement>("[data-bot-file]")?.click();
        break;
      // 面板
      case "panel-toggle":
        panelOpen = !panelOpen;
        renderHead();
        renderPanelDom();
        break;
      case "panel-close":
        panelOpen = false;
        renderHead();
        renderPanelDom();
        break;
      case "panel-tab":
        panelTab = (btn.dataset.tab as PanelTab) || "details";
        renderPanelDom();
        break;
      case "pc-panel":
        closePopover();
        panelOpen = true;
        panelTab = "computer";
        renderHead();
        renderPanelDom();
        break;
      case "rename":
        inlineEdit(btn, {
          value: bot.name, placeholder: "名字", max: 24,
          onDone: (v) => {
            const prev = bot.name;
            const next = renameBot(bot, v);
            if (next && next !== prev) bot.thread.push({ id: uuidv4(), role: "event", text: `已重命名为 ${next}`, at: Date.now() });
            bot.named = true;
            persist();
            renderList();
            renderHead();
            renderThreadDom();
            renderPanelDom();
          },
        });
        break;
      case "tag-add":
        inlineEdit(btn, {
          value: "", placeholder: "标签，如：理财", max: 12,
          onDone: (v) => {
            if (!bot.tags.includes(v)) bot.tags.push(v);
            persist();
            renderPanelDom();
          },
        });
        break;
      case "tag-remove":
        bot.tags = bot.tags.filter((t) => t !== btn.dataset.tag);
        persist();
        renderPanelDom();
        break;
      case "note-toggle": {
        const note = bot.notes.find((n) => n.id === id);
        if (note) {
          note.status = note.status === "done" ? "open" : "done";
          note.updatedAt = Date.now();
          persist();
          renderPanelDom();
        }
        break;
      }
      case "note-delete":
        bot.notes = bot.notes.filter((n) => n.id !== id);
        persist();
        renderPanelDom();
        break;
      case "clear-thread":
        void showConfirmDialog({
          title: "清空聊天记录？",
          message: `${bot.name} 的聊天记录会全部删除，记忆和资料库会保留。`,
          confirmText: "清空",
          danger: true,
        }).then((r) => {
          if (!r.ok) return;
          runtime.forget(bot.id);
          queues.delete(bot.id);
          void deleteBotImages(imageIdsOf(bot.thread));
          const before = Date.now();
          bot.thread = [{ id: uuidv4(), role: "event", text: "聊天记录已清空，记忆已保留", at: before + 1 }];
          bot.modelMessages = [];
          cloud?.clearConv(`bot:${bot.id}`, before);
          persist();
          renderChat();
        });
        break;
      case "pin-bot": {
        closePopover();
        const target = findConvo(id);
        if (!target) break;
        if (target.pinnedAt) delete target.pinnedAt;
        else target.pinnedAt = Date.now();
        persist();
        renderList();
        break;
      }
      case "delete-bot": {
        // 信息面板里的按钮不带 id = 当前这个；左侧列表右键带 id
        closePopover();
        const target = (id && state.bots.find((b) => b.id === id)) || bot;
        void showConfirmDialog({
          title: `删除 ${target.name}？`,
          message: "聊天记录、记忆和资料库都会一起删除，无法恢复。",
          confirmText: "删除",
          danger: true,
        }).then((r) => {
          if (!r.ok) return;
          runtime.forgetBot(target.id);
          void pool?.drop(`bot:${target.id}`).catch(() => {});
          queues.delete(target.id);
          void deleteBotImages(imageIdsOf(target.thread));
          state.bots = state.bots.filter((b) => b !== target);
          if (!state.bots.length) state.bots.push(createBot());
          // 它在的群：移出成员（它说过的话留着）；一个成员都不剩的群一起删
          for (const g of state.groups) {
            if (!g.memberIds.includes(target.id)) continue;
            g.memberIds = g.memberIds.filter((m) => m !== target.id);
            delete g.modelMessages[target.id];
            delete g.seen[target.id];
            if (g.memberIds.length) g.thread.push({ id: uuidv4(), role: "event", text: `${target.name} 已被删除`, at: Date.now() });
          }
          for (const g of state.groups.filter((x) => !x.memberIds.length)) dropGroup(g);
          for (let i = openedBefore.length - 1; i >= 0; i--) {
            if (!findConvo(openedBefore[i])) openedBefore.splice(i, 1);
          }
          if (!findConvo(state.activeId)) {
            state.activeId = openedBefore.pop() ?? state.bots[0].id;
            replyTo = null;
            threadLimit = THREAD_PAGE;
            flashId = null;
            panelOpen = false;
          }
          persist();
          renderChat();
        });
        break;
      }
      // 群聊
      case "new-group": {
        closePopover();
        const input = q<HTMLTextAreaElement>("[data-bot-input]");
        if (input) current().draft = input.value;
        // 从某个 Bot 的会话里发起：先把它放进收件人
        composing = { picked: activeGroup() ? [] : [active().id], query: "", cursor: 0 };
        mention = null;
        setPane("convo");
        renderNewGroupDom();
        renderList();
        break;
      }
      case "back-list":
        closePopover();
        if (panelOpen) {
          panelOpen = false;
          renderHead();
          renderPanelDom();
        }
        setPane("list");
        deps.onActive?.(null);
        renderList();
        break;
      case "group-new-cancel":
        setPane("list");
        composing = null;
        renderNewGroupDom();
        renderList();
        break;
      case "group-new-focus":
        q<HTMLInputElement>("[data-bot-recipient-input]")?.focus();
        break;
      case "group-new-pick":
        if (composing && findBot(id) && !composing.picked.includes(id) && composing.picked.length < GROUP_MAX_MEMBERS) {
          composing.picked.push(id);
          composing.query = "";
          composing.cursor = 0;
          renderNewGroupDom();
        }
        break;
      case "group-new-remove":
        if (composing) {
          composing.picked = composing.picked.filter((x) => x !== id);
          renderNewGroupDom();
        }
        break;
      case "group-new-create": {
        const name = (btn.dataset.name ?? "").trim().slice(0, 24);
        if (!composing || !name || composing.picked.length >= GROUP_MAX_MEMBERS) break;
        const fresh = createBot(name);
        fresh.named = true;
        state.bots.push(fresh);
        composing.picked.push(fresh.id);
        composing.query = "";
        composing.cursor = 0;
        persist();
        renderNewGroupDom();
        renderList();
        break;
      }
      case "group-create": {
        if (!composing || composing.picked.length < 2) break;
        const group = createGroup(composing.picked);
        const names = groupMembers(group, state.bots).map((b) => b.name).join("、");
        group.thread.push({ id: uuidv4(), role: "event", text: `你创建了群聊，成员：${names}`, at: Date.now() });
        state.groups.push(group);
        selectBot(group.id);
        break;
      }
      case "group-activity": {
        // 群活跃度：安静 / 正常 / 热闹 —— 决定没被点名时有多少 Bot 插话、Bot 之间接几句（bot-social.ts）
        const group = activeGroup();
        const value = btn.dataset.value as GroupActivity | undefined;
        if (!group || !value || !GROUP_ACTIVITIES.includes(value) || (group.activity ?? "normal") === value) break;
        group.activity = value;
        persist();
        renderPanelDom();
        break;
      }
      case "group-notice-dismiss": {
        const group = activeGroup();
        if (!group) break;
        group.noticeDismissed = true;
        persist();
        renderThreadDom();
        break;
      }
      case "group-rename": {
        const group = activeGroup();
        if (!group) break;
        inlineEdit(btn, {
          value: group.name, placeholder: "群名", max: GROUP_NAME_MAX,
          onDone: (v) => {
            const name = v.replace(/\s+/g, " ").slice(0, GROUP_NAME_MAX);
            if (name === group.name) { renderPanelDom(); return; }
            group.name = name;
            group.thread.push({ id: uuidv4(), role: "event", text: `群名已改为 ${name}`, at: Date.now() });
            refreshGroupChrome();
          },
        });
        break;
      }
      case "group-member-add":
        openPopover({ kind: "group-add", anchor: btn });
        break;
      case "group-member-pick": {
        closePopover();
        const group = activeGroup();
        const member = findBot(id);
        if (!group || !member || group.memberIds.includes(id) || group.memberIds.length >= GROUP_MAX_MEMBERS) break;
        group.memberIds.push(id);
        group.thread.push({ id: uuidv4(), role: "event", text: `${member.name} 加入了群聊`, at: Date.now() });
        refreshGroupChrome();
        break;
      }
      case "group-member-remove": {
        const group = activeGroup();
        const member = findBot(id);
        if (!group || !member || group.memberIds.length <= 2) break;
        if (lives.get(group.id)?.authorId === id) stopConvo(group.id);
        group.memberIds = group.memberIds.filter((m) => m !== id);
        delete group.modelMessages[id];
        delete group.seen[id];
        runtime.forget(groupSessionKey(group.id, id));
        group.thread.push({ id: uuidv4(), role: "event", text: `${member.name} 已移出群聊`, at: Date.now() });
        refreshGroupChrome();
        break;
      }
      case "group-clear": {
        const group = activeGroup();
        if (!group) break;
        void showConfirmDialog({
          title: "清空群聊记录？",
          message: "群里的聊天记录会全部删除，成员和它们各自的记忆会保留。",
          confirmText: "清空",
          danger: true,
        }).then((r) => {
          if (!r.ok) return;
          stopConvo(group.id);
          runtime.forgetGroup(group.id);
          queues.delete(group.id);
          void deleteBotImages(imageIdsOf(group.thread));
          const before = Date.now();
          group.thread = [{ id: uuidv4(), role: "event", text: "聊天记录已清空", at: before + 1 }];
          group.modelMessages = {};
          group.seen = {};
          cloud?.clearConv(`group:${group.id}`, before);
          persist();
          renderChat();
        });
        break;
      }
      case "group-delete": {
        closePopover();
        const group = (id && findGroup(id)) || activeGroup();
        if (!group) break;
        void showConfirmDialog({
          title: `删除群聊「${groupTitle(group, state.bots)}」？`,
          message: "这将永久删除群组及其聊天记录。其中的 Bot 不会被删除，仍可单独使用。此操作无法撤销。",
          confirmText: "删除",
          danger: true,
        }).then((r) => {
          if (!r.ok) return;
          dropGroup(group);
          for (let i = openedBefore.length - 1; i >= 0; i--) {
            if (!findConvo(openedBefore[i])) openedBefore.splice(i, 1);
          }
          if (!findConvo(state.activeId)) {
            state.activeId = openedBefore.pop() ?? state.bots[0].id;
            replyTo = null;
            threadLimit = THREAD_PAGE;
            flashId = null;
            panelOpen = false;
          }
          persist();
          renderChat();
        });
        break;
      }
      case "mention-pick":
        pickMention(Number(btn.dataset.index ?? 0));
        break;
      // 电脑
      case "pc-start":
        void pcAction(async () => { await computer.ensure(AbortSignal.timeout(200_000)); }, "正在开机，大约 10–20 秒…");
        break;
      case "pc-wake":
        void pcAction(() => computer.wake(), "正在唤醒…");
        break;
      case "pc-sleep":
        void pcAction(() => computer.sleep());
        break;
      case "pc-stop":
        void showConfirmDialog({
          title: "关掉这台电脑？",
          message: "关机后电脑上的文件会被清除，记忆不受影响。暂时不用可以选择休眠。",
          confirmText: "关机",
          danger: true,
        }).then((r) => { if (r.ok) void pcAction(() => computer.shutdown()); });
        break;
      case "pc-open":
        screenOpen = true;
        renderScreen();
        break;
      case "pc-close":
        screenOpen = false;
        computer.setUserControl(false);
        renderScreen();
        if (panelOpen) renderPanelDom();
        break;
      case "pc-control":
        computer.setUserControl(true);
        break;
      case "pc-release":
        computer.setUserControl(false);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // ── 事件委托 ──────────────────────────────────────────────────────────────

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest<HTMLAnchorElement>(".bot-msg-body a[href]");
    if (link) {
      event.preventDefault();
      const href = link.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) void openUrl(href).catch(() => showToast("打不开这个链接"));
      return;
    }
    const img = target?.closest<HTMLImageElement>(".bot-msg-img, .bot-msg-body img, .bot-live img");
    if (img && !img.classList.contains("bot-msg-img-missing")) {
      event.preventDefault();
      const src = img.src || (img.dataset.botImg ? imageUrls.get(img.dataset.botImg) : null);
      if (src) {
        openImageViewer(src);
      } else if (img.dataset.botImg) {
        void getBotImage(img.dataset.botImg).then((blob) => {
          if (!blob) return;
          let url = imageUrls.get(img.dataset.botImg!);
          if (!url) {
            url = URL.createObjectURL(blob);
            imageUrls.set(img.dataset.botImg!, url);
          }
          openImageViewer(url);
        });
      }
      return;
    }
    const btn = target?.closest<HTMLElement>("[data-bot-action]");
    if (popover && !target?.closest("[data-bot-pop]")) {
      // 再点一次打开它的那颗按钮 = 收起，而不是收起后又立刻打开
      const opener = popover.kind === "emoji-grid" ? "react-open" : popover.kind === "react" ? "react-open" : popover.kind === "group-add" ? "group-member-add" : popover.kind;
      const toggled = !!btn && btn.dataset.botAction === opener && (!("id" in popover) || btn.dataset.id === popover.id);
      closePopover();
      if (toggled) return;
    }
    // 点到 @ 菜单和输入框以外：收起 @ 菜单
    if (mention && !target?.closest("[data-bot-mention], [data-bot-input]")) {
      mention = null;
      renderMentionMenu();
    }
    if (btn) handleAction(btn, event);
  });

  root.addEventListener("contextmenu", (event) => {
    const target = event.target as HTMLElement | null;
    const item = target?.closest<HTMLElement>(".bot-list-item");
    if (item?.dataset.id) {
      event.preventDefault();
      event.stopPropagation();
      openPopover({ kind: "bot-menu", id: item.dataset.id, anchor: item, x: event.clientX, y: event.clientY });
      return;
    }
    const img = target?.closest<HTMLImageElement>(".bot-msg-img, .bot-msg-body img, .bot-live img");
    if (!img || img.classList.contains("bot-msg-img-missing")) return;
    event.preventDefault();
    event.stopPropagation();
    if (popover) closePopover();
    const src = img.src || (img.dataset.botImg ? imageUrls.get(img.dataset.botImg) : null);
    const openMenu = (imageSrc: string) => {
      showContextMenu(event.clientX, event.clientY, [
        { label: "复制图片", onClick: () => void copyImageToClipboard(imageSrc) },
        { label: "放大查看", onClick: () => openImageViewer(imageSrc) },
      ], { anchor: img });
    };
    if (src) {
      openMenu(src);
    } else if (img.dataset.botImg) {
      void getBotImage(img.dataset.botImg).then((blob) => {
        if (!blob) return;
        let url = imageUrls.get(img.dataset.botImg!);
        if (!url) {
          url = URL.createObjectURL(blob);
          imageUrls.set(img.dataset.botImg!, url);
        }
        openMenu(url);
      });
    }
  });

  root.addEventListener("keydown", (event) => {
    const t = event.target as HTMLElement | null;
    if (t?.matches("[data-bot-ask-input]") && event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      pickName((t as HTMLInputElement).value);
      return;
    }
    // @ 菜单开着：上下选、回车 / Tab 插入、Esc 收起 —— 先于「回车发送」
    if (t?.matches("[data-bot-input]") && mention && !event.isComposing) {
      const group = activeGroup();
      const count = group ? mentionOptions(mention.query, groupMembers(group, state.bots)).length : 0;
      if (event.key === "Escape") {
        event.preventDefault();
        mention = null;
        renderMentionMenu();
        return;
      }
      if (count && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        mention.cursor = (mention.cursor + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
        renderMentionMenu();
        return;
      }
      if (count && (event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        pickMention(mention.cursor);
        return;
      }
    }
    if (t?.matches("[data-bot-input]") && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
      return;
    }
    // 收件人输入框：上下选候选、回车加入、空着按退格删掉最后一个、Esc 关掉新建
    if (t?.matches("[data-bot-recipient-input]") && composing && !event.isComposing) {
      const opts = newGroupOptions(composing, state.bots);
      const value = (t as HTMLInputElement).value;
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && opts.length) {
        event.preventDefault();
        composing.cursor = (Math.min(composing.cursor, opts.length - 1) + (event.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length;
        renderNewGroupDom();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const opt = opts[Math.min(composing.cursor, opts.length - 1)];
        if (opt) {
          const el = opt.kind === "bot"
            ? q(`[data-bot-action="group-new-pick"][data-id="${CSS.escape(opt.bot.id)}"]`)
            : q('[data-bot-action="group-new-create"]');
          el?.click();
        } else if (!value.trim() && composing.picked.length >= 2) {
          q<HTMLButtonElement>('[data-bot-action="group-create"]')?.click();
        }
        return;
      }
      if (event.key === "Backspace" && !value && composing.picked.length) {
        event.preventDefault();
        composing.picked.pop();
        renderNewGroupDom();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        composing = null;
        renderNewGroupDom();
        renderList();
        return;
      }
    }
    if (event.key === "Escape") {
      if (popover) { closePopover(); return; }
      if (screenOpen && !pcView.userControl) { screenOpen = false; renderScreen(); if (panelOpen) renderPanelDom(); return; }
      if (searching && t?.matches("[data-bot-search-input]")) { searching = false; query = ""; renderChat(); return; }
      if (replyTo) { replyTo = null; renderComposer(); }
    }
  });

  root.addEventListener("input", (event) => {
    const t = event.target as HTMLElement | null;
    if (t?.matches("[data-bot-input]")) {
      autoGrow(t as HTMLTextAreaElement);
      current().draft = (t as HTMLTextAreaElement).value;
      renderComposer();
      syncMention(t as HTMLTextAreaElement);
    } else if (t?.matches("[data-bot-recipient-input]") && composing) {
      composing.query = (t as HTMLInputElement).value;
      composing.cursor = 0;
      renderNewGroupDom();
    } else if (t?.matches("[data-bot-search-input]")) {
      query = (t as HTMLInputElement).value;
      renderList();
    }
  });

  root.addEventListener("paste", (event) => {
    const t = event.target as HTMLElement | null;
    if (!t?.matches("[data-bot-input]")) return;
    const dt = (event as ClipboardEvent).clipboardData;
    if (!dt) return;
    const fromItems = Array.from(dt.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null && isImageFile(f));
    const files = fromItems.length ? fromItems : Array.from(dt.files ?? []).filter(isImageFile);
    if (!files.length) return;
    event.preventDefault();
    void addDraftImages(files);
  });

  root.addEventListener("focusout", (event) => {
    const t = event.target as HTMLElement | null;
    if (t?.matches("[data-bot-input]")) persist();
    const block = t?.getAttribute("data-bot-memory");
    if (block === "self" || block === "user") {
      const bot = active();
      const value = (t as HTMLTextAreaElement).value.trim();
      if (value !== bot.memory[block]) {
        bot.memory[block] = value;
        persist();
      }
    }
  });

  root.addEventListener("submit", (event) => {
    const form = (event.target as HTMLElement | null)?.closest<HTMLFormElement>('[data-bot-form="note"]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const text = String(data.get("text") ?? "").trim();
    const kind = String(data.get("kind") ?? "fact") as BotNoteKind;
    if (!text) return;
    const bot = active();
    const now = Date.now();
    bot.notes.push({ id: uuidv4(), text: text.slice(0, 500), kind: NOTE_KINDS.includes(kind) ? kind : "fact", createdAt: now, updatedAt: now, ...(kind === "todo" ? { status: "open" as const } : {}) });
    persist();
    renderPanelDom();
    q<HTMLInputElement>('[data-bot-form="note"] input[name="text"]')?.focus();
  });

  let pickingFor: string | null = null;

  root.addEventListener("change", (event) => {
    const t = event.target as HTMLInputElement | null;
    if (t?.matches("[data-bot-pick]")) {
      const files = Array.from(t.files ?? []);
      t.value = "";
      const req = pickingFor ? lives.get(pickingFor)?.fileRequest : null;
      pickingFor = null;
      if (req && files.length) req.finish(files);
      return;
    }
    if (t?.matches("[data-bot-file]") && t.files?.length) {
      const files = t.files;
      void uploadFiles(files).finally(() => { t.value = ""; });
    }
  });

  root.addEventListener("scroll", (event) => {
    const sc = event.target as HTMLElement | null;
    if (!sc?.matches?.("[data-bot-scroll]")) return;
    pinned = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
    syncScrollFade(sc);
    q("[data-bot-action='jump-bottom']")?.toggleAttribute("hidden", pinned);
    if (popover) closePopover();
  }, true);

  auth.onAuthChange(() => {
    const next = owner();
    if (next === state.owner) return;
    runtime.forgetAll();
    for (const live of lives.values()) live.mascot.destroy();
    lives.clear();
    queues.clear();
    pendingReactions.clear();
    state = loadState(next);
    cloud?.stop();
    void cloud?.start();
    // 换账号：旧账号的电脑驱动全部摘掉（不关机：那是另一个账号的机器），按新账号的映射重建
    pool?.dispose();
    pool = makePool();
    bindComputer();
    page = state.onboardedAt ? "chat" : "onboarding";
    composing = null;
    mention = null;
    panelOpen = false;
    screenOpen = false;
    if (visible) {
      if (page === "chat") renderChat();
      else { step = 0; renderOnboarding(); }
    }
  });

  // 开着云端运行就连上（关掉 Bot 页也保持：云端消息照样进本地，切回来就能看到）
  void cloud?.start();

  return {
    get visible() {
      return visible;
    },
    open(conv: string) {
      const id = conv.replace(/^(bot|group):/, "");
      if (!findConvo(id) || !visible || page !== "chat") {
        pendingOpen = id;
        return;
      }
      selectBot(id);
    },
    show() {
      if (visible) return;
      visible = true;
      root.hidden = false;
      stage.classList.add("app-view-bot");
      document.body.classList.add("app-view-bot");
      document.body.dataset.product = "bot";
      pcView = computer.view();
      void cloud?.start();
      if (page === "chat") renderChat();
      else {
        step = 0;
        renderOnboarding();
      }
    },
    hide() {
      if (!visible) return;
      visible = false;
      // ⛔ 不中断正在跑的那一轮：Bot 在后台继续干活，切回来接着看
      closePopover();
      document.querySelectorAll(".chat-image-lightbox").forEach((node) => node.remove());
      const input = q<HTMLTextAreaElement>("[data-bot-input]");
      if (input) current().draft = input.value;
      mention = null;
      persist();
      computer.setUserControl(false);
      screen.disconnect();
      destroyMascots();
      for (const live of lives.values()) live.mascot.destroy();
      root.hidden = true;
      root.innerHTML = "";
      stage.classList.remove("app-view-bot");
      document.body.classList.remove("app-view-bot");
      if (document.body.dataset.product === "bot") {
        document.body.dataset.product = "agent";
      }
    },
  };
}
