// 移植自 cancri-code/src/bot/bot-store.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Bot 的本地状态：每个 Bot 是「一个人」——一条永不结束的连续对话、
 * 两块常驻记忆（关于我 / 关于你）、一本记事本（事实 / 偏好 / 待办 / 事件）。
 *
 * 记忆分层参考 MemGPT / Letta 与 Dot：
 *   · 常驻块：每轮都进上下文，Bot 自己用工具改写（`memory_edit`）。
 *   · 记事本：带类型、状态、日期的结构化条目，按相关性挑几条进上下文。
 *   · 回忆：完整的聊天线程留在本地，Bot 用 `memory_search` 翻旧账。
 *   · 模型历史：只保留最近一段（`trimModelMessages`），更早的靠上面三层接住。
 *
 * 按账号分 key 存 localStorage；换账号互不可见。写失败不吞：调用方显示提示。
 */
import type { Message } from "../core/types";
import { uuidv4 } from "../core/id";
import { isRealUserTurn } from "../agent/context-pipeline";
import { GROUP_ACTIVITIES, type GroupActivity } from "./bot-social";

export const BOT_DEFAULT_NAME = "Cancri Bot";
/** 默认模型：IDE 专属免费线（纯文本，图片入参会 400 —— 见 bot-tools 的浏览器工具）。 */
export const BOT_MODEL_ID = "gpt-6-luna";

export const SELF_BLOCK_MAX = 1200;
export const USER_BLOCK_MAX = 1500;
const NOTES_MAX = 300;
const THREAD_MAX = 1500;
/** 模型历史按用户回合截：最近这么多轮原样带上，更早的交给记忆层。 */
const MODEL_TURNS_KEEP = 24;
const MODEL_CHARS_KEEP = 120_000;
const TOOL_RESULT_SAVE_MAX = 4000;

export type BotNoteKind = "fact" | "preference" | "todo" | "event";
export const NOTE_KINDS: BotNoteKind[] = ["fact", "preference", "todo", "event"];

export interface BotNote {
  id: string;
  text: string;
  kind: BotNoteKind;
  /** 只有 todo 有状态 */
  status?: "open" | "done";
  /** 事件 / 待办的日期（YYYY-MM-DD），可缺 */
  date?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BotReaction {
  emoji: string;
  by: "user" | "bot";
  /** 群里是哪个 Bot 点的（每个 Bot 各自最多一个）。单聊不填。 */
  authorId?: string;
}

export interface BotChatMessage {
  id: string;
  /** event = 居中的一行系统事件（如「已重命名为 X」） */
  role: "user" | "bot" | "event";
  text: string;
  at: number;
  replyTo?: string;
  reactions?: BotReaction[];
  error?: boolean;
  /** Bot 发来的截图。图片本体在 IndexedDB（bot-images.ts），这里只记 id。 */
  image?: { id: string };
  /** 用户粘贴发送的图片，同样只记 IndexedDB 的 id。 */
  images?: Array<{ id: string }>;
  /**
   * Bot 发来的录屏 / 文件（用户电脑上的 pc_screen_record / pc_send_file）。本体同样在 IndexedDB（bot-images.ts）：
   * 本地发的 id 是随机的；云端发的是 `hub-<key>`，点开时才去 `/media/<key>` 拉（录屏动辄十几 MB，不预取）。
   */
  file?: { id: string; name: string; mime: string; size: number; kind: "video" | "file"; durationMs?: number; width?: number; height?: number };
  /** 群聊里 Bot 发的消息：是哪个 Bot（BotProfile.id）。单聊不填。 */
  authorId?: string;
  /** 云端 Bot（BotHub）发来的审批请求：这条 event 消息带按钮，点了回 `/approvals/<id>` */
  approval?: { id: string; status: "pending" | "approved" | "denied" | "expired" };
  /** 消息来自云端（定时任务 / 监控 / 闲聊）：origin 原样记下，便于 UI 标注 */
  origin?: string;
}

/**
 * 群聊（复刻 Grok Bot 的 group chat）：一个会话里多个 Bot，每条消息群里的 Bot 分别处理。
 * 成员的记忆与单聊共用（还是同一个「人」），模型历史按群分开存 —— 群里的话不串进单聊。
 */
export interface BotGroup {
  id: string;
  /** 空 = 没起过名，显示成员名拼起来 */
  name: string;
  memberIds: string[];
  thread: BotChatMessage[];
  /** 每个成员在这个群里的模型历史 */
  modelMessages: Record<string, Message[]>;
  /** 每个成员已经看过的最后一条群消息 id：下一轮只把这之后的新消息交给它（模型上下文游标） */
  seen: Record<string, string>;
  /**
   * 已读回执游标：成员「看到」到哪一条。和 `seen` 分开 —— 没被挑中开口的成员也会已读，
   * 但它下次开口时仍要拿到这些消息作上下文，所以不能推 `seen`。缺省 = 都未读。
   */
  read?: Record<string, string>;
  /** 群的活跃度（bot-social.ts ACTIVITY_PROFILE）。缺省 normal */
  activity?: GroupActivity;
  /**
   * 群里默认大家共用一台电脑（ComputerPool 的 `group:<id>`，Grok Bot 的做法）。
   * 列在这里的成员在这个群里改用自己的那台（`bot:<id>`），在群里说「用你自己的电脑」就会切过去。
   */
  ownComputer?: string[];
  draft: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  /** 关掉了群聊用量提示 */
  noticeDismissed?: boolean;
}

export interface BotProfile {
  id: string;
  name: string;
  /** 用户还没给它起过名字时为 false，会话页底部显示起名卡片 */
  named: boolean;
  tags: string[];
  createdAt: number;
  memory: { self: string; user: string };
  notes: BotNote[];
  thread: BotChatMessage[];
  modelMessages: Message[];
  draft: string;
  updatedAt: number;
  /** 列表置顶的时间；缺省 = 没置顶 */
  pinnedAt?: number;
  /** 单聊已读回执：Bot 读到的最后一条用户消息 id */
  readId?: string;
}

export interface BotState {
  version: 2;
  owner: string;
  onboardedAt: number | null;
  /** 当前打开的会话：Bot 或群组的 id */
  activeId: string;
  bots: BotProfile[];
  groups: BotGroup[];
  /**
   * 每台云电脑归谁：电脑主人 key（`bot:<id>` / `group:<id>`）→ 服务端会话 id。
   * 重启后按它认领，不会把 A 的机器错认成 B 的。缺省 = 旧存档（所有 Bot 共用一台）。
   */
  computers?: Record<string, string>;
}

const PREFIX = "cancri.bot.v2.";
const LEGACY_KEY = "cancri.bot.v1";

export function ownerKey(owner: string): string {
  return PREFIX + encodeURIComponent(owner);
}

export function defaultSelfBlock(name: string): string {
  return `我叫${name}。我有自己的云电脑（Linux + Chrome），可以上网、跑命令、读写文件。`;
}

export function createBot(name: string = BOT_DEFAULT_NAME, now: number = Date.now()): BotProfile {
  return {
    id: uuidv4(),
    name,
    named: false,
    tags: [],
    createdAt: now,
    memory: { self: defaultSelfBlock(name), user: "" },
    notes: [],
    thread: [{
      id: uuidv4(),
      role: "bot",
      at: now,
      text: `你好，我是 ${name}。我有自己的电脑，可以帮你查资料、上网、写代码，也会记住你说过的事。`,
    }],
    modelMessages: [],
    draft: "",
    updatedAt: now,
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isMessage(v: unknown): v is Message {
  if (!isObj(v) || !["system", "user", "assistant", "tool"].includes(v.role as string)) return false;
  return typeof v.content === "string" || Array.isArray(v.content);
}

function sanitizeThread(raw: unknown): BotChatMessage[] {
  return Array.isArray(raw)
    ? raw.filter((m): m is BotChatMessage =>
        isObj(m) && typeof m.id === "string" && typeof m.text === "string" &&
        ["user", "bot", "event"].includes(m.role as string) && typeof m.at === "number")
    : [];
}

function sanitizeBot(raw: unknown): BotProfile | null {
  if (!isObj(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const memory = isObj(raw.memory) ? raw.memory : {};
  const thread = sanitizeThread(raw.thread);
  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((n): n is BotNote =>
        isObj(n) && typeof n.id === "string" && typeof n.text === "string" &&
        NOTE_KINDS.includes(n.kind as BotNoteKind))
    : [];
  return {
    id: raw.id,
    name: raw.name.slice(0, 24) || BOT_DEFAULT_NAME,
    named: raw.named === true,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string").slice(0, 8) : [],
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    memory: {
      self: typeof memory.self === "string" ? memory.self : defaultSelfBlock(raw.name),
      user: typeof memory.user === "string" ? memory.user : "",
    },
    notes,
    thread,
    modelMessages: Array.isArray(raw.modelMessages) ? raw.modelMessages.filter(isMessage) : [],
    draft: typeof raw.draft === "string" ? raw.draft : "",
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    ...(typeof raw.pinnedAt === "number" ? { pinnedAt: raw.pinnedAt } : {}),
    ...(typeof raw.readId === "string" ? { readId: raw.readId } : {}),
  };
}

export const GROUP_NAME_MAX = 32;

export function createGroup(memberIds: string[], now: number = Date.now()): BotGroup {
  return {
    id: uuidv4(),
    name: "",
    memberIds: [...new Set(memberIds)],
    thread: [],
    modelMessages: {},
    seen: {},
    read: {},
    draft: "",
    createdAt: now,
    updatedAt: now,
  };
}

/** 成员只留还存在的 Bot；一个成员都不剩的群直接丢掉 */
function sanitizeGroup(raw: unknown, botIds: Set<string>): BotGroup | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !Array.isArray(raw.memberIds)) return null;
  const memberIds = [...new Set(raw.memberIds.filter((id): id is string => typeof id === "string" && botIds.has(id)))];
  if (!memberIds.length) return null;
  const histories: Record<string, Message[]> = {};
  if (isObj(raw.modelMessages)) {
    for (const id of memberIds) {
      const list = raw.modelMessages[id];
      if (Array.isArray(list)) histories[id] = list.filter(isMessage);
    }
  }
  const cursors = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (isObj(v)) for (const id of memberIds) if (typeof v[id] === "string") out[id] = v[id] as string;
    return out;
  };
  const seen = cursors(raw.seen);
  // 旧存档没有已读游标：拿模型上下文游标兜底（看过 = 读过）
  const read = { ...seen, ...cursors(raw.read) };
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name.slice(0, GROUP_NAME_MAX) : "",
    memberIds,
    thread: sanitizeThread(raw.thread),
    modelMessages: histories,
    seen,
    read,
    ...(GROUP_ACTIVITIES.includes(raw.activity as GroupActivity) ? { activity: raw.activity as GroupActivity } : {}),
    ...(Array.isArray(raw.ownComputer) ? { ownComputer: raw.ownComputer.filter((id): id is string => typeof id === "string" && botIds.has(id)) } : {}),
    draft: typeof raw.draft === "string" ? raw.draft : "",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    ...(typeof raw.pinnedAt === "number" ? { pinnedAt: raw.pinnedAt } : {}),
    ...(raw.noticeDismissed === true ? { noticeDismissed: true } : {}),
  };
}

/** v1 只存了「走完引导的时间 + 起的名字」，迁过来当第一个 Bot。 */
function fromLegacy(owner: string, storage: Storage): BotState | null {
  try {
    const raw = storage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const v1 = JSON.parse(raw) as { onboardedAt?: unknown; name?: unknown };
    if (typeof v1.onboardedAt !== "number") return null;
    const bot = createBot(BOT_DEFAULT_NAME, v1.onboardedAt);
    if (typeof v1.name === "string" && v1.name.trim()) renameBot(bot, v1.name.trim());
    return { version: 2, owner, onboardedAt: v1.onboardedAt, activeId: bot.id, bots: [bot], groups: [] };
  } catch {
    return null;
  }
}

export function loadBotState(owner: string, storage: Storage = localStorage): BotState {
  try {
    const raw = storage.getItem(ownerKey(owner));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.version === 2 && parsed.owner === owner && Array.isArray(parsed.bots)) {
        const bots = parsed.bots.map(sanitizeBot).filter((b): b is BotProfile => !!b);
        if (bots.length) {
          const botIds = new Set(bots.map((b) => b.id));
          // 群组是后加的字段：旧存档没有就是空
          const groups = Array.isArray(parsed.groups)
            ? parsed.groups.map((g) => sanitizeGroup(g, botIds)).filter((g): g is BotGroup => !!g)
            : [];
          const ids = new Set([...botIds, ...groups.map((g) => g.id)]);
          const activeId = ids.has(parsed.activeId as string) ? (parsed.activeId as string) : bots[0].id;
          const computers: Record<string, string> = {};
          if (isObj(parsed.computers)) {
            for (const [k, v] of Object.entries(parsed.computers)) {
              if (typeof v === "string" && /^(bot|group):/.test(k)) computers[k] = v;
            }
          }
          return {
            version: 2,
            owner,
            onboardedAt: typeof parsed.onboardedAt === "number" ? parsed.onboardedAt : null,
            activeId,
            bots,
            groups,
            // 没有这个字段 = 改版前的存档（所有 Bot 共用一台）：bot-view 会把那台迁给第一个 Bot
            ...(isObj(parsed.computers) ? { computers } : {}),
          };
        }
      }
    }
  } catch {
    /* 坏数据不挡路：退回全新状态，旧 key 原样留着不覆盖，直到下一次成功保存 */
  }
  const legacy = fromLegacy(owner, storage);
  if (legacy) return legacy;
  const bot = createBot();
  return { version: 2, owner, onboardedAt: null, activeId: bot.id, bots: [bot], groups: [], computers: {} };
}

function clipToolResults(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (m.role !== "tool" || !Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((p) =>
        p.type === "tool_result" && p.content.length > TOOL_RESULT_SAVE_MAX
          ? { ...p, content: p.content.slice(0, TOOL_RESULT_SAVE_MAX) + "\n…（已截断）" }
          : p),
    };
  });
}

/**
 * 存档里不留图片本体：一张 data URL 动辄几百 KB，几张就会挤爆 localStorage 配额。
 * 图片原件在 IndexedDB（bot-images.ts），重载后模型只看到占位文字。
 */
function elideImages(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content) || !m.content.some((p) => p.type === "image")) return m;
    return { ...m, content: m.content.map((p) => (p.type === "image" ? { type: "text" as const, text: "[图片]" } : p)) };
  });
}

/**
 * 只留最近 `MODEL_TURNS_KEEP` 个用户回合，且总量不超过 `MODEL_CHARS_KEEP`。
 * 切点永远落在真实用户消息上 —— 从中间切会留下没有 tool_call 的 tool_result，provider 直接 400；
 * 落在 loop 注入的快照上又会把用户原话丢掉（见 isRealUserTurn 的注释）。
 */
export function trimModelMessages(rawMessages: Message[]): Message[] {
  const messages = elideImages(rawMessages);
  const userIdx: number[] = [];
  messages.forEach((m, i) => { if (isRealUserTurn(m)) userIdx.push(i); });
  let start = userIdx.length > MODEL_TURNS_KEEP ? userIdx[userIdx.length - MODEL_TURNS_KEEP] : 0;
  const size = (from: number) => messages.slice(from).reduce((n, m) => n + JSON.stringify(m.content).length, 0);
  for (const idx of userIdx) {
    if (idx < start) continue;
    if (size(idx) <= MODEL_CHARS_KEEP) { start = Math.max(start, idx); break; }
  }
  return clipToolResults(messages.slice(start));
}

export function saveBotState(state: BotState, storage: Storage = localStorage): void {
  const slim: BotState = {
    ...state,
    bots: state.bots.map((b) => ({
      ...b,
      thread: b.thread.slice(-THREAD_MAX),
      notes: b.notes.slice(-NOTES_MAX),
      modelMessages: trimModelMessages(b.modelMessages),
    })),
    groups: state.groups.map((g) => ({
      ...g,
      thread: g.thread.slice(-THREAD_MAX),
      modelMessages: Object.fromEntries(Object.entries(g.modelMessages).map(([id, list]) => [id, trimModelMessages(list)])),
    })),
  };
  storage.setItem(ownerKey(state.owner), JSON.stringify(slim));
}

export function renameBot(bot: BotProfile, raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) return null;
  const prev = bot.name;
  bot.name = name;
  bot.named = true;
  if (bot.memory.self.includes(`我叫${prev}`)) bot.memory.self = bot.memory.self.replace(`我叫${prev}`, `我叫${name}`);
  else if (!bot.memory.self.includes(name)) bot.memory.self = `我叫${name}。${bot.memory.self}`.slice(0, SELF_BLOCK_MAX);
  return name;
}

export function nextBotName(state: BotState): string {
  const names = new Set(state.bots.map((b) => b.name));
  if (!names.has(BOT_DEFAULT_NAME)) return BOT_DEFAULT_NAME;
  for (let i = 2; ; i++) if (!names.has(`${BOT_DEFAULT_NAME} ${i}`)) return `${BOT_DEFAULT_NAME} ${i}`;
}

export function toggleReaction(msg: BotChatMessage, emoji: string, by: BotReaction["by"]): boolean {
  const list = msg.reactions ?? [];
  const i = list.findIndex((r) => r.emoji === emoji && r.by === by);
  if (i >= 0) {
    list.splice(i, 1);
    msg.reactions = list.length ? list : undefined;
    return false;
  }
  // 同一方只留一个表情：再点别的就是换，和微信 / iMessage 的手感一致
  const kept = list.filter((r) => r.by !== by);
  kept.push({ emoji, by });
  msg.reactions = kept;
  return true;
}

/** 群里某个 Bot 给一条消息点表情：每个 Bot 各自只留一个，再点就是换 */
export function setBotReaction(msg: BotChatMessage, emoji: string, authorId?: string): void {
  const kept = (msg.reactions ?? []).filter((r) => !(r.by === "bot" && r.authorId === authorId));
  kept.push({ emoji, by: "bot", ...(authorId ? { authorId } : {}) });
  msg.reactions = kept;
}
