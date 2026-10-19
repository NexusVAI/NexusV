// 移植自 cancri-code/src/bot/bot-cloud.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 云端 Bot（BotHub）客户端适配层。登录后默认连上（不再有开关）；账号不在灰度名单时服务端 404，桌面端行为与原来一样。
 *
 * 为什么要有它：现在 Bot 的 agent loop 跑在桌面端渲染进程里，关掉桌面端 Bot 就停了。
 * 服务端 cf-gateway `src/bot-hub/` 是 Bot 的常驻大脑（每用户一个 Durable Object）：
 * 聊天、已读、定时任务、监控、审批都在那里跑，桌面端 / 网页 / 手机都只是它的客户端。
 *
 * 这一层只做三件事（纯数据，不碰 DOM，便于测试）：
 *   1. toSyncPayload：把本地 BotState 压成 `/sync` 的上行包（名字、记忆摘要、未完成待办、群设置、最近消息、电脑分配）；
 *   2. applyHubEvents：把云端产生的事件（新消息、表情、已读）合并回本地 BotState；
 *   3. BotCloudClient：HTTP + WebSocket（子协议带 token），断线按游标补齐。
 *
 * 约定：桌面端本地发的消息经 `/sync` 上去只存档，云端**不会**再回一遍；
 * 想让云端来回复（例如电脑要关了），走 `send()`。
 */
import { BOT_DEFAULT_NAME, createBot, defaultSelfBlock, type BotChatMessage, type BotGroup, type BotProfile, type BotState } from "./bot-store";

export const BOT_CLOUD_PATH = "/functions/v1/bot-hub";
/** 每个会话最多带多少条最近消息上去（云端只需要上下文，不是备份） */
export const SYNC_TAIL = 40;

export type ConvKey = `bot:${string}` | `group:${string}`;

export interface HubMessageWire {
  id: string;
  conv: ConvKey;
  role: "user" | "bot" | "event";
  text: string;
  at: number;
  authorId?: string;
  replyTo?: string;
  reactions?: Array<{ emoji: string; by: "user" | "bot"; authorId?: string }>;
  origin?: string;
  image?: { key: string };
  /** 用户电脑传上来的录屏 / 文件（cf-gateway bot-hub HubFile）：本体在 `/media/<key>` */
  file?: { key: string; name: string; mime: string; size: number; kind: "video" | "file"; durationMs?: number; width?: number; height?: number };
  approvalId?: string;
  error?: boolean;
}

/** 用户自己的电脑（桌面端开了「允许云端 Bot 访问这台电脑」的那几台） */
export interface HubDevice {
  id: string;
  name: string;
  os?: string;
  app?: string;
  online: boolean;
  lastSeenAt?: number;
}

/** `device` 事件 / `/status` 里的设备名单 → 干净的数组（字段不对的丢掉） */
export function parseDevices(raw: unknown): HubDevice[] {
  if (!Array.isArray(raw)) return [];
  const out: HubDevice[] = [];
  for (const d of raw.slice(0, 10)) {
    if (!d || typeof d !== "object") continue;
    const x = d as Record<string, unknown>;
    if (typeof x.id !== "string" || !x.id) continue;
    out.push({
      id: x.id.slice(0, 64),
      name: (typeof x.name === "string" && x.name.trim() ? x.name : "我的电脑").slice(0, 60),
      ...(typeof x.os === "string" && x.os ? { os: x.os.slice(0, 60) } : {}),
      ...(typeof x.app === "string" && x.app ? { app: x.app.slice(0, 30) } : {}),
      online: x.online === true,
      ...(typeof x.lastSeenAt === "number" ? { lastSeenAt: x.lastSeenAt } : {}),
    });
  }
  return out;
}

export interface HubEventWire {
  seq?: number;
  at: number;
  type: string;
  data: Record<string, unknown>;
}

export interface SyncPayload {
  bots: Array<{ id: string; name: string; tags: string[]; memorySelf: string; memoryUser: string; todos: string[] }>;
  groups: Array<{ id: string; name: string; memberIds: string[]; activity: string; ownComputer: string[]; read: Record<string, string> }>;
  messages: HubMessageWire[];
  computers: Record<string, string>;
  tzOffsetMin: number;
  /** 本地删掉的 Bot / 群：云端跟着删（不然它们还会在云端发消息） */
  removedBots?: string[];
  removedGroups?: string[];
  /** 本地删掉的消息 / 清空的会话：云端跟着删，再告诉其它端 */
  removedMessages?: Array<{ conv: string; id: string }>;
  cleared?: Array<{ conv: string; before: number }>;
  /** 这一端的随机 id：云端广播「名册变了」时带上，自己发起的那次不用再拉 */
  clientId?: string;
}

/**
 * 只在这台电脑上的附件（桌面端本地跑的 Bot 截的图 / 录的屏 / 发的文件、用户粘贴的图）：字节不上云，
 * 上行时在文字前面带一句说明 —— 不然网页端只看到一个空气泡，云端的 Bot 也不知道这里发过什么。
 */
export function localMediaNote(m: Pick<BotChatMessage, "image" | "images" | "file">): string {
  if (m.image?.id && !m.image.id.startsWith(HUB_IMAGE_PREFIX)) return "[截图，在电脑上看]";
  if (m.file?.id && !m.file.id.startsWith(HUB_IMAGE_PREFIX)) return m.file.kind === "video" ? "[录屏，在电脑上看]" : `[文件「${m.file.name}」，在电脑上看]`;
  if (m.images?.length) return m.images.length > 1 ? `[${m.images.length} 张图片，在电脑上看]` : "[图片，在电脑上看]";
  return "";
}

function wireText(m: BotChatMessage): string {
  const note = localMediaNote(m);
  if (!note) return m.text;
  return m.text ? `${note}\n${m.text}` : note;
}

function wire(conv: ConvKey, m: BotChatMessage): HubMessageWire {
  return {
    id: m.id,
    conv,
    role: m.role,
    text: wireText(m),
    at: m.at,
    ...(m.authorId ? { authorId: m.authorId } : {}),
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(m.reactions?.length ? { reactions: m.reactions.map((r) => ({ emoji: r.emoji, by: r.by, ...(r.authorId ? { authorId: r.authorId } : {}) })) } : {}),
  };
}

/** 本地状态 → `/sync` 上行包。只带最近 SYNC_TAIL 条，不带模型上下文、不带图片字节 */
export function toSyncPayload(
  state: BotState,
  tzOffsetMin = -new Date().getTimezoneOffset(),
  removed: { bots?: string[]; groups?: string[] } = {},
): SyncPayload {
  const todos = (b: BotProfile): string[] => b.notes.filter((n) => n.kind === "todo" && n.status !== "done").map((n) => n.text).slice(0, 20);
  return {
    bots: state.bots.map((b) => ({ id: b.id, name: b.name, tags: b.tags, memorySelf: b.memory.self, memoryUser: b.memory.user, todos: todos(b) })),
    groups: state.groups.map((g) => ({
      id: g.id,
      name: g.name,
      memberIds: g.memberIds,
      activity: g.activity ?? "normal",
      ownComputer: g.ownComputer ?? [],
      read: g.read ?? g.seen ?? {},
    })),
    messages: [
      ...state.bots.flatMap((b) => b.thread.slice(-SYNC_TAIL).map((m) => wire(`bot:${b.id}`, m))),
      ...state.groups.flatMap((g) => g.thread.slice(-SYNC_TAIL).map((m) => wire(`group:${g.id}`, m))),
    ].slice(-300),
    computers: { ...(state.computers ?? {}) },
    tzOffsetMin,
    ...(removed.bots?.length ? { removedBots: removed.bots.slice(0, 50) } : {}),
    ...(removed.groups?.length ? { removedGroups: removed.groups.slice(0, 50) } : {}),
  };
}

/** 云端截图在本地 IndexedDB 里的 id（`hub-<key>`）；拉过一次就不再拉 */
export const HUB_IMAGE_PREFIX = "hub-";
export function hubImageKey(localId: string): string | null {
  return localId.startsWith(HUB_IMAGE_PREFIX) ? localId.slice(HUB_IMAGE_PREFIX.length) : null;
}

function threadOf(state: BotState, conv: string): { thread: BotChatMessage[]; group?: BotGroup } | null {
  if (conv.startsWith("bot:")) {
    const b = state.bots.find((x) => x.id === conv.slice(4));
    return b ? { thread: b.thread } : null;
  }
  if (conv.startsWith("group:")) {
    const g = state.groups.find((x) => x.id === conv.slice(6));
    return g ? { thread: g.thread, group: g } : null;
  }
  return null;
}

function hubFile(f: NonNullable<HubMessageWire["file"]>): NonNullable<BotChatMessage["file"]> {
  const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);
  const durationMs = n(f.durationMs);
  const width = n(f.width);
  const height = n(f.height);
  return {
    id: HUB_IMAGE_PREFIX + f.key,
    name: String(f.name || (f.kind === "video" ? "录屏.mp4" : "文件")).slice(0, 120),
    mime: String(f.mime || "application/octet-stream").slice(0, 100),
    size: n(f.size) ?? 0,
    kind: f.kind === "video" ? "video" : "file",
    ...(durationMs ? { durationMs } : {}),
    ...(width && height ? { width, height } : {}),
  };
}

function fromWire(m: HubMessageWire): BotChatMessage {
  // 截图在云端（/bot-hub/image/<key>）：本地记成 `hub-<key>`，由 BotCloudLink 拉下来存进 IndexedDB
  const text = m.text;
  return {
    id: m.id,
    role: m.role,
    text,
    at: m.at,
    ...(m.authorId ? { authorId: m.authorId } : {}),
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(m.reactions?.length ? { reactions: m.reactions } : {}),
    ...(m.error ? { error: true } : {}),
    ...(m.image?.key ? { image: { id: HUB_IMAGE_PREFIX + m.image.key } } : {}),
    ...(!m.image?.key && m.file?.key ? { file: hubFile(m.file) } : {}),
    ...(m.approvalId ? { approval: { id: m.approvalId, status: "pending" as const } } : {}),
    ...(m.origin ? { origin: m.origin } : {}),
  };
}

const APPROVAL_STATUS = ["pending", "approved", "denied", "expired"] as const;

export interface ApplyResult {
  changed: boolean;
  /** 新出现的、需要提醒用户的（审批、监控告警） */
  notices: HubEventWire[];
  /** 变动过的会话（`bot:<id>` / `group:<id>`），UI 只重画这些 */
  convs: string[];
  /** 新出现的云端截图 key（要去 `/image/<key>` 拉） */
  images: string[];
  /** 云端 Bot「正在输入 / 在用工具」的开关（Bot 发出消息也算输入结束） */
  typing: TypingSignal[];
  /** 事件里出现了本地还没有的会话（别的端刚建的 Bot / 群）：要先拿名册再补消息 */
  unknownConvs: string[];
  /** 「名册变了」事件是谁发起的（clientId）；自己发起的可以忽略 */
  rosterBy: string[];
  /** 被别的端清空的会话：本地的模型上下文也作废了（和本地清空一样） */
  cleared: string[];
  /** 用户电脑上线 / 下线（`device` 事件，最后一次为准）；没有这类事件时不填 */
  devices?: HubDevice[];
}

/** 本地删掉 / 清空一段消息（云端发来的 message_remove / conv_clear，或快照里的墓碑） */
function dropMessages(thread: BotChatMessage[], pred: (m: BotChatMessage) => boolean): BotChatMessage[] | null {
  const next = thread.filter((m) => !pred(m));
  return next.length === thread.length ? null : next;
}

export interface TypingSignal {
  conv: string;
  botId: string;
  on: boolean;
  tool?: string;
}

/** 云端事件 → 合并进本地状态（幂等：同一条消息来两次只算一次） */
export function applyHubEvents(state: BotState, events: HubEventWire[]): ApplyResult {
  let changed = false;
  const notices: HubEventWire[] = [];
  const convs = new Set<string>();
  const images = new Set<string>();
  const typing: TypingSignal[] = [];
  const unknownConvs = new Set<string>();
  const rosterBy: string[] = [];
  const cleared = new Set<string>();
  let devices: HubDevice[] | undefined;
  const setThread = (conv: string, next: BotChatMessage[]): void => {
    if (conv.startsWith("bot:")) {
      const b = state.bots.find((x) => x.id === conv.slice(4));
      if (b) b.thread = next;
    } else {
      const g = state.groups.find((x) => x.id === conv.slice(6));
      if (g) g.thread = next;
    }
  };
  for (const ev of events) {
    if (ev.data?.notify) notices.push(ev);
    if (ev.type === "typing") {
      const conv = String(ev.data.conv ?? "");
      const botId = String(ev.data.botId ?? "");
      if (threadOf(state, conv) && botId) typing.push({ conv, botId, on: ev.data.on === true, ...(typeof ev.data.tool === "string" ? { tool: ev.data.tool } : {}) });
      continue;
    }
    if (ev.type === "roster") {
      rosterBy.push(String(ev.data?.by ?? ""));
      continue;
    }
    if (ev.type === "device") {
      devices = parseDevices(ev.data?.devices);
      continue;
    }
    if (ev.type === "message_remove" || ev.type === "conv_clear") {
      const conv = String(ev.data.conv ?? "");
      const t = threadOf(state, conv);
      if (!t) continue;
      const ids = new Set(Array.isArray(ev.data.ids) ? ev.data.ids.map(String) : []);
      const before = Number(ev.data.before) || 0;
      const next = dropMessages(t.thread, ev.type === "message_remove" ? (m) => ids.has(m.id) : (m) => m.at <= before);
      if (next) {
        setThread(conv, next);
        changed = true;
        convs.add(conv);
      }
      if (ev.type === "conv_clear" && next) {
        if (t.group) {
          t.group.modelMessages = {};
          t.group.seen = {};
        } else {
          const b = state.bots.find((x) => `bot:${x.id}` === conv);
          if (b) b.modelMessages = [];
        }
        cleared.add(conv);
      }
      continue;
    }
    if (ev.type === "message" || ev.type === "message_update") {
      const m = ev.data.message as HubMessageWire | undefined;
      if (!m?.id || typeof m.conv !== "string") continue;
      const t = threadOf(state, m.conv);
      if (!t) {
        if (/^(bot|group):[\w-]+$/.test(m.conv)) unknownConvs.add(m.conv);
        continue;
      }
      const i = t.thread.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        const prev = t.thread[i];
        const next = { ...prev, ...fromWire(m) };
        // 自己推上去的本机附件消息：云端那份文字带着「在电脑上看」的说明，本地保持原文
        if (localMediaNote(prev)) next.text = prev.text;
        // 本地已有的消息：来源以本地为准（自己推上去的消息云端会标成 user 再广播回来，不能把它变成「云端消息」）
        if (prev.origin) next.origin = prev.origin;
        else delete next.origin;
        // 审批已经有结论了：同一条消息再来一遍（补齐 / 改字）不能把按钮又变回「待批准」
        if (prev.approval && prev.approval.status !== "pending") next.approval = prev.approval;
        if (JSON.stringify(next) !== JSON.stringify(prev)) {
          t.thread[i] = next;
          changed = true;
          convs.add(m.conv);
        }
      } else if (ev.type === "message") {
        // 按时间插入（云端消息可能比本地最后一条早一点点）
        const at = t.thread.findIndex((x) => x.at > m.at);
        if (at < 0) t.thread.push(fromWire(m));
        else t.thread.splice(at, 0, fromWire(m));
        changed = true;
        convs.add(m.conv);
        if (m.image?.key) images.add(m.image.key);
        if (m.role === "bot") {
          const botId = m.authorId ?? (m.conv.startsWith("bot:") ? m.conv.slice(4) : "");
          if (botId) typing.push({ conv: m.conv, botId, on: false });
        }
      }
    } else if (ev.type === "receipt") {
      const conv = String(ev.data.conv ?? "");
      const t = threadOf(state, conv);
      const botId = String(ev.data.botId ?? "");
      const msgId = String(ev.data.msgId ?? "");
      if (!t || !botId || !msgId) continue;
      if (!t.group) {
        // 单聊：Bot 读到了这条（气泡左边的未读 → 已读）
        const bot = state.bots.find((b) => `bot:${b.id}` === conv);
        if (bot && bot.readId !== msgId && t.thread.some((x) => x.id === msgId)) {
          bot.readId = msgId;
          changed = true;
          convs.add(conv);
        }
        continue;
      }
      const read = (t.group.read ??= {});
      const cur = read[botId] ? t.thread.findIndex((x) => x.id === read[botId]) : -1;
      const next = t.thread.findIndex((x) => x.id === msgId);
      if (next > cur) {
        read[botId] = msgId;
        changed = true;
        convs.add(conv);
      }
    } else if (ev.type === "computer") {
      const key = String(ev.data.key ?? "");
      const sid = ev.data.sessionId;
      if (/^(bot|group):/.test(key) && typeof sid === "string" && state.computers?.[key] !== sid) {
        state.computers = { ...(state.computers ?? {}), [key]: sid };
        changed = true;
      }
    } else if (ev.type === "approval") {
      const a = ev.data.approval as { id?: string; status?: string } | undefined;
      const status = APPROVAL_STATUS.find((x) => x === a?.status);
      if (!a?.id || !status) continue;
      for (const [conv, thread] of [
        ...state.bots.map((b) => [`bot:${b.id}`, b.thread] as const),
        ...state.groups.map((g) => [`group:${g.id}`, g.thread] as const),
      ]) {
        const msg = thread.find((x) => x.approval?.id === a.id);
        if (msg?.approval && msg.approval.status !== status) {
          msg.approval = { id: a.id, status };
          changed = true;
          convs.add(conv);
        }
      }
    }
  }
  return { changed, notices, convs: [...convs], images: [...images], typing, unknownConvs: [...unknownConvs], rosterBy, cleared: [...cleared], ...(devices ? { devices } : {}) };
}

/** 快照里的删除墓碑 → 本地照删（网页端本地存档里可能还留着别的端删掉的消息） */
export function applyRemovals(
  state: BotState,
  r: { removedMessages?: Array<{ id: string; conv: string }>; cleared?: Record<string, number> },
): string[] {
  const events: HubEventWire[] = [];
  const byConv = new Map<string, string[]>();
  for (const x of r.removedMessages ?? []) if (x && typeof x.id === "string" && typeof x.conv === "string") byConv.set(x.conv, [...(byConv.get(x.conv) ?? []), x.id]);
  for (const [conv, ids] of byConv) events.push({ at: 0, type: "message_remove", data: { conv, ids } });
  for (const [conv, before] of Object.entries(r.cleared ?? {})) events.push({ at: 0, type: "conv_clear", data: { conv, before } });
  return events.length ? applyHubEvents(state, events).convs : [];
}

/**
 * 审批列表 → `approval` 事件（交给 applyHubEvents：只改卡片状态，对不上的忽略）。
 * 快照里的审批卡片消息只记了「发起时」的样子（待批准）：不校正的话，网页首屏 / 重拉后
 * 早就批过、拒过、过期的卡片又冒出三个按钮，点了只会得到 409。
 */
export function approvalEvents(list: Array<{ id?: unknown; status?: unknown }> | undefined): HubEventWire[] {
  const events: HubEventWire[] = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (a && typeof a.id === "string" && typeof a.status === "string") events.push({ at: 0, type: "approval", data: { approval: { id: a.id, status: a.status } } });
  }
  return events;
}

/**
 * 快照不带已读游标（单聊的游标存在云端 meta 里，只随 receipt 事件下发）：网页首屏 / 重拉后
 * 每条用户消息都显示「未读」。单聊按「Bot 回过话 = 读过它之前的用户消息」推一个；
 * 群聊用快照里群自带的 `read`。只往前推、不往回退；游标那条已被截掉（= 全读过）的不动。
 * 返回游标变了的会话。
 */
export function inferReadCursors(state: BotState, snap: { groups?: Array<{ id?: unknown; read?: unknown }> }): string[] {
  const convs: string[] = [];
  for (const b of state.bots) {
    const t = b.thread;
    const cur = b.readId ? t.findIndex((m) => m.id === b.readId) : -1;
    if (b.readId && cur < 0) continue;
    let lastBot = t.length - 1;
    while (lastBot >= 0 && t[lastBot].role !== "bot") lastBot--;
    let target = lastBot - 1;
    while (target >= 0 && t[target].role !== "user") target--;
    if (target > cur) {
      b.readId = t[target].id;
      convs.push(`bot:${b.id}`);
    }
  }
  for (const hg of Array.isArray(snap.groups) ? snap.groups : []) {
    const g = hg && typeof hg.id === "string" ? state.groups.find((x) => x.id === hg.id) : undefined;
    if (!g || !hg.read || typeof hg.read !== "object") continue;
    const read = (g.read ??= {});
    let moved = false;
    for (const [botId, msgId] of Object.entries(hg.read as Record<string, unknown>)) {
      if (typeof msgId !== "string") continue;
      const next = g.thread.findIndex((m) => m.id === msgId);
      const cur = read[botId] ? g.thread.findIndex((m) => m.id === read[botId]) : -1;
      if (next > cur && (cur >= 0 || !read[botId])) {
        read[botId] = msgId;
        moved = true;
      }
    }
    if (moved) convs.push(`group:${g.id}`);
  }
  return convs;
}

// ── 名册（别的端新建 / 删掉的 Bot、群） ───────────────────────────────────────

export interface HubRosterBot {
  id: string;
  name: string;
  tags?: string[];
  memorySelf?: string;
  memoryUser?: string;
  todos?: string[];
  /** 云端的操作规则（新云端才带）：「需要批准 / 完全访问」以云端为准，各端照着显示 */
  rules?: Record<string, string>;
}

/** 云端规则 → 资料卡上的两档：改动类和出网都直接做 = 完全访问 */
export function accessFromRules(rules: Record<string, string> | undefined): "ask" | "full" | null {
  if (!rules || typeof rules !== "object") return null;
  return rules.write === "auto" && rules.outbound === "auto" ? "full" : "ask";
}

/** 资料卡两档 → 云端规则。完全访问 = 所有操作都不再询问（含登录 / 密钥）；需要批准 = 只读以外都先问 */
export function rulesForAccess(access: "ask" | "full"): Record<string, string> {
  const level = access === "full" ? "auto" : "ask";
  return { read: "auto", compute: "auto", write: level, outbound: level, device: level, secret: level };
}
export interface HubRosterGroup {
  id: string;
  name: string;
  memberIds: string[];
  activity?: string;
  ownComputer?: string[];
  read?: Record<string, string>;
}
export interface HubRoster {
  bots: HubRosterBot[];
  groups: HubRosterGroup[];
  /** 删除墓碑：别的端删掉的 Bot / 群（老版云端不带） */
  removedBots?: string[];
  removedGroups?: string[];
}
/** `GET /state`：网页 / 手机端没有本地存档，首屏一次拿全 */
export interface HubSnapshot extends HubRoster {
  messages: Record<string, HubMessageWire[]>;
  cursor: number;
  removedMessages?: Array<{ id: string; conv: string }>;
  cleared?: Record<string, number>;
}

/** 名册里「看得见」的字段签名：三方合并（本地 / 云端 / 上次对齐时）靠它判断谁改过 */
export const botSig = (b: { name: string; tags?: string[]; memorySelf?: string; memoryUser?: string }): string =>
  JSON.stringify([b.name, b.tags ?? [], b.memorySelf ?? "", b.memoryUser ?? ""]);
export const groupSig = (g: { name: string; memberIds: string[]; activity?: string }): string => JSON.stringify([g.name ?? "", g.memberIds, g.activity ?? "normal"]);
export const localBotSig = (b: BotProfile): string => botSig({ name: b.name, tags: b.tags, memorySelf: b.memory.self, memoryUser: b.memory.user });
export const localGroupSig = (g: BotGroup): string => groupSig({ name: g.name, memberIds: g.memberIds, activity: g.activity ?? "normal" });

const GROUP_ACTIVITY = ["quiet", "normal", "lively"] as const;

/** raw = 网页端：记忆原样保留（不补默认人设，免得和云端签名对不上、每次都上推） */
function profileFromHub(b: HubRosterBot, now: number, raw = false): BotProfile {
  return {
    id: b.id,
    name: b.name || "Cancri Bot",
    named: true,
    tags: [...(b.tags ?? [])],
    createdAt: now,
    memory: { self: raw ? (b.memorySelf ?? "") : b.memorySelf || defaultSelfBlock(b.name || "Cancri Bot"), user: b.memoryUser ?? "" },
    notes: (b.todos ?? []).map((text, i) => ({ id: `hub-todo-${b.id}-${i}`, text, kind: "todo" as const, status: "open" as const, createdAt: now, updatedAt: now })),
    thread: [],
    modelMessages: [],
    draft: "",
    updatedAt: now,
  };
}

function groupFromHub(g: HubRosterGroup, now: number): BotGroup {
  const activity = GROUP_ACTIVITY.find((a) => a === g.activity);
  return {
    id: g.id,
    name: g.name ?? "",
    memberIds: [...g.memberIds],
    thread: [],
    modelMessages: {},
    seen: {},
    read: { ...(g.read ?? {}) },
    draft: "",
    createdAt: now,
    updatedAt: now,
    ...(activity ? { activity } : {}),
    ...(g.ownComputer?.length ? { ownComputer: [...g.ownComputer] } : {}),
  } as BotGroup;
}

export interface RosterMerge {
  changed: boolean;
  /** 本地新增 / 删掉的会话（`bot:<id>` / `group:<id>`） */
  convs: string[];
}

/**
 * 云端名册 → 本地。
 *   · 名字 / 标签 / 记忆、群名 / 成员 / 活跃度按三方合并：本地自上次对齐（base）以来没改过、云端改过 → 跟云端；
 *     本地改过 → 留本地（这次 sync 已经推上去了）。网页端没有 base 时直接跟云端（它就是正本），桌面端没有 base 时留本地。
 *   · 删除墓碑（removedBots / removedGroups）：别的端删掉的，两端都照删。
 *   · 本地没有的：补上（网页 / 手机 / 另一台电脑新建的）。
 *   · 网页端（authoritative=true）另外：云端没有、而本地以前同步过（known）的 → 别的端删了，本地也删（兼容不带墓碑的老云端）；
 *     本地新建还没上传的保留（下次 sync 带上去）。从没用过的默认 Bot（没发过消息）在云端已有 Bot 时直接丢掉，免得多出一个空 Bot。
 */
export function mergeRoster(
  state: BotState,
  roster: HubRoster,
  opts: { authoritative?: boolean; known?: { bots: string[]; groups: string[] }; base?: Map<string, string> | null; now?: number } = {},
): RosterMerge {
  const now = opts.now ?? Date.now();
  const convs = new Set<string>();
  const known = { bots: new Set(opts.known?.bots ?? []), groups: new Set(opts.known?.groups ?? []) };
  const base = opts.base ?? null;
  /** 本地没改过（相对上次对齐）→ 可以跟云端 */
  const follow = (key: string, localSig: string): boolean => (base ? base.get(key) === localSig : !!opts.authoritative);
  const hubBots = new Map(roster.bots.filter((b) => b && typeof b.id === "string").map((b) => [b.id, b]));
  const hubGroups = new Map(roster.groups.filter((g) => g && typeof g.id === "string").map((g) => [g.id, g]));
  const goneBots = new Set((roster.removedBots ?? []).filter((id) => typeof id === "string" && !hubBots.has(id)));
  const goneGroups = new Set((roster.removedGroups ?? []).filter((id) => typeof id === "string" && !hubGroups.has(id)));
  for (const hb of hubBots.values()) {
    const local = state.bots.find((b) => b.id === hb.id);
    const key = `bot:${hb.id}`;
    // 操作权限只能经云端改（setAccess 直接 PUT /rules），所以总是跟云端：手机上切了，电脑上也跟着变
    const access = accessFromRules(hb.rules);
    if (!local) {
      const p = profileFromHub(hb, now, !!opts.authoritative);
      if (access === "full") p.access = "full";
      state.bots.push(p);
      convs.add(key);
      continue;
    }
    if (access && (local.access ?? "ask") !== access) {
      if (access === "full") local.access = "full";
      else delete local.access;
      convs.add(key);
    }
    if (botSig(hb) !== localBotSig(local) && follow(key, localBotSig(local))) {
      local.name = hb.name || local.name;
      local.tags = [...(hb.tags ?? local.tags)];
      const self = hb.memorySelf ?? local.memory.self;
      local.memory = { self: opts.authoritative ? self : self || defaultSelfBlock(local.name), user: hb.memoryUser ?? local.memory.user };
      local.updatedAt = now;
      convs.add(key);
    }
  }
  if (goneBots.size && state.bots.some((b) => goneBots.has(b.id))) {
    for (const b of state.bots) if (goneBots.has(b.id)) convs.add(`bot:${b.id}`);
    state.bots = state.bots.filter((b) => !goneBots.has(b.id));
    // 一个 Bot 都不剩时界面没法画：和本地删光时一样，补一个新的
    if (!state.bots.length) state.bots.push(createBot(BOT_DEFAULT_NAME, now));
  }
  if (opts.authoritative) {
    const keep = state.bots.filter((b) => {
      if (hubBots.has(b.id)) return true;
      if (known.bots.has(b.id)) return false;
      const untouched = !b.thread.some((m) => m.role === "user");
      return !(untouched && hubBots.size > 0);
    });
    // 一个 Bot 都不剩时界面没法画：留着本地的（它会被同步上去）
    if (keep.length && keep.length !== state.bots.length) {
      for (const b of state.bots) if (!keep.includes(b)) convs.add(`bot:${b.id}`);
      state.bots = keep;
    }
  }
  const botIds = new Set(state.bots.map((b) => b.id));
  for (const hg of hubGroups.values()) {
    const members = hg.memberIds.filter((id) => botIds.has(id));
    if (members.length < 2) continue;
    const local = state.groups.find((g) => g.id === hg.id);
    const key = `group:${hg.id}`;
    if (!local) {
      state.groups.push(groupFromHub({ ...hg, memberIds: members }, now));
      convs.add(key);
    } else if (groupSig({ ...hg, memberIds: members }) !== localGroupSig(local) && follow(key, localGroupSig(local))) {
      local.name = hg.name ?? "";
      local.memberIds = members;
      const activity = GROUP_ACTIVITY.find((a) => a === hg.activity);
      if (activity) local.activity = activity;
      convs.add(key);
    }
  }
  state.groups = state.groups.filter((g) => {
    const key = `group:${g.id}`;
    if (goneGroups.has(g.id) || (opts.authoritative && !hubGroups.has(g.id) && known.groups.has(g.id))) {
      convs.add(key);
      return false;
    }
    // 网页端：成员不全的群不画（云端名册里成员都在）
    if (opts.authoritative) return g.memberIds.every((id) => botIds.has(id));
    // 桌面端：成员被别的端删掉了 → 和本地删 Bot 一样，移出成员；一个都不剩的群一起删
    const members = g.memberIds.filter((id) => botIds.has(id));
    if (members.length === g.memberIds.length) return true;
    convs.add(key);
    g.memberIds = members;
    return members.length > 0;
  });
  if (!state.bots.some((b) => b.id === state.activeId) && !state.groups.some((g) => g.id === state.activeId)) {
    state.activeId = state.bots[0]?.id ?? state.activeId;
  }
  return { changed: convs.size > 0, convs: [...convs] };
}

/** 快照里的消息按事件合进本地（复用 applyHubEvents：同 id 去重、按时间插入） */
export function snapshotEvents(snap: Pick<HubSnapshot, "messages">): HubEventWire[] {
  return Object.values(snap.messages ?? {})
    .flat()
    .filter((m) => m && typeof m.id === "string")
    .map((m) => ({ at: m.at, type: "message", data: { message: m } }));
}

// ── 定时任务 / 监控（云端 Bot 的「日程」） ───────────────────────────────────

export type RoutineSchedule = { kind: "interval"; minutes: number } | { kind: "daily"; time: string; tzOffsetMin: number };

export interface HubRoutine {
  id: string;
  botId: string;
  conv: ConvKey;
  title: string;
  prompt: string;
  schedule: RoutineSchedule;
  enabled: boolean;
  allowComputer: boolean;
  nextAt: number;
  pausedReason?: string;
}

export interface HubMonitor {
  id: string;
  botId: string;
  conv: ConvKey;
  name: string;
  url: string;
  intervalMin: number;
  failThreshold: number;
  investigate: boolean;
  enabled: boolean;
  state: string;
  failCount: number;
  lastCheckedAt: number;
}

/** 给人看的一句日程 */
export function describeSchedule(s: RoutineSchedule): string {
  if (s.kind === "daily") return `每天 ${s.time}`;
  if (s.minutes % (24 * 60) === 0) return `每 ${s.minutes / (24 * 60)} 天`;
  if (s.minutes % 60 === 0) return `每 ${s.minutes / 60} 小时`;
  return `每 ${s.minutes} 分钟`;
}

const HUB_ERROR_TEXT: Record<string, string> = {
  hub_not_enabled: "云端运行还没开",
  not_found: "云端运行暂未对这个账号开放",
  routine_limit: "这个 Bot 的定时任务已经到上限（50 个）了",
  monitor_limit: "这个 Bot 的监控已经到上限了",
  interval_too_short: "定时任务最短 5 分钟一次",
  bad_time: "时间格式要像 09:30 这样",
  bad_schedule: "日程格式不对",
  empty_prompt: "要做的事不能为空",
  bot_not_found: "云端还没有这个 Bot，稍等几秒同步完再试",
  rate_limited: "操作太频繁，过一分钟再试",
  not_signed_in: "需要先登录",
  invalid_session: "登录已过期，请重新登录",
  banned: "账号已被限制",
};
/** 云端错误码 → 中文；不认识的原样带上 */
export function hubErrorText(e: unknown): string {
  const code = e instanceof BotCloudError ? e.code : e instanceof Error ? e.message : String(e);
  if (HUB_ERROR_TEXT[code]) return HUB_ERROR_TEXT[code];
  if (/^(private_host|localhost|bad_url|bad_scheme|bad_port|credentials_in_url)$/.test(code)) return "这个地址不能监控（只支持公网 http/https 地址）";
  return `云端出错了（${code}）`;
}

// ── 传输 ────────────────────────────────────────────────────────────────────

export interface BotCloudDeps {
  baseUrl: string;
  token: () => Promise<string | null>;
  fetch?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
  onEvents?: (events: HubEventWire[]) => void;
  /** 游标比云端保留的事件还旧（离线太久）：增量补不齐了，要整段重拉 */
  onReset?: () => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  now?: () => number;
}

/** 心跳：每 15 秒 ping 一次；20 秒没收到任何东西就当连接已死（手机切网 / 电脑睡醒后常见的半开连接）重连 */
export const WS_PING_MS = 15_000;
export const WS_DEAD_MS = 20_000;
/** 云端 DO 用 setWebSocketAutoResponse 原样回 pong，不唤醒 DO —— 两边的字符串必须逐字一致 */
export const WS_PING = '{"type":"ping"}';
/** 一次 /sync 最多带回这么多事件（与云端 events() 默认 limit 一致）：满了说明还有，接着拉 */
export const SYNC_EVENTS_PAGE = 500;

export class BotCloudError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export class BotCloudClient {
  cursor = 0;
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private retryTimer: unknown = null;
  private heartbeat: unknown = null;
  private lastHeard = 0;
  private readonly d: BotCloudDeps;

  constructor(d: BotCloudDeps) {
    this.d = d;
  }

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  /**
   * 收到一批持久事件后推进游标。只接着上一个往后走：中间缺了（实时推过来的比补齐的快）就先不动，
   * 下一次 sync 从缺口处补齐 —— 否则游标一跳，缺口里的事件就再也拿不到了。重复的事件各端都按 id 去重。
   */
  advance(events: HubEventWire[]): void {
    for (const ev of events) {
      if (typeof ev.seq !== "number") continue;
      if (ev.seq === this.cursor + 1 || this.cursor === 0) this.cursor = ev.seq;
      else if (ev.seq > this.cursor + 1) return;
    }
  }

  /** WebSocket 还连着吗（心跳判过的） */
  get live(): boolean {
    return !!this.ws && this.ws.readyState === 1 && this.now() - this.lastHeard < WS_DEAD_MS;
  }

  async call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const token = await this.d.token();
    if (!token) throw new BotCloudError(401, "not_signed_in");
    const f = this.d.fetch ?? fetch;
    const res = await f(`${this.d.baseUrl}${BOT_CLOUD_PATH}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-cancri-desktop": "1" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new BotCloudError(res.status, String(j.code ?? j.error ?? `http_${res.status}`));
    return j as T;
  }

  enable(tzOffsetMin = -new Date().getTimezoneOffset()): Promise<Record<string, unknown>> {
    return this.call("/enable", "POST", { tzOffsetMin });
  }
  disable(): Promise<unknown> {
    return this.call("/disable", "POST", {});
  }
  status(): Promise<Record<string, unknown>> {
    return this.call("/status");
  }
  /** 网页 / 手机首屏：全部 Bot、群和每个会话最近的消息 */
  snapshot(): Promise<HubSnapshot> {
    return this.call("/state");
  }
  /** 最近的审批（全部状态，云端最多回 100 条）：快照只带消息、不带审批结论，首屏靠它把卡片校正过来 */
  approvals(): Promise<{ approvals?: Array<{ id?: unknown; status?: unknown }> }> {
    return this.call("/approvals");
  }

  /** 推本地状态、拉云端事件；返回的事件已经推给 onEvents */
  async sync(state: BotState): Promise<HubEventWire[]> {
    const r = await this.call<{ cursor: number; events: HubEventWire[]; reset?: boolean }>(`/sync?since=${this.cursor}`, "POST", toSyncPayload(state));
    this.take(r);
    return r.events ?? [];
  }

  /** 一次 /sync 或 /events 的结果：推进游标、交出事件、离线太久就让上层整段重拉 */
  take(r: { cursor?: number; events?: HubEventWire[]; reset?: boolean }): void {
    const events = r.events ?? [];
    if (r.reset) {
      if (typeof r.cursor === "number") this.cursor = r.cursor;
      if (events.length) this.d.onEvents?.(events);
      this.d.onReset?.();
      return;
    }
    if (events.length) this.advance(events);
    else if (typeof r.cursor === "number") this.cursor = Math.max(this.cursor, r.cursor);
    if (events.length) this.d.onEvents?.(events);
  }

  send(conv: ConvKey, text: string, opts: { id?: string; replyTo?: string } = {}): Promise<{ message: HubMessageWire }> {
    return this.call("/send", "POST", { conv, text, ...opts });
  }

  routines(): Promise<{ routines: HubRoutine[] }> {
    return this.call("/routines");
  }
  createRoutine(body: { botId: string; conv?: ConvKey; title?: string; prompt: string; schedule: RoutineSchedule; allowComputer?: boolean }): Promise<{ routine: HubRoutine }> {
    return this.call("/routines", "POST", body);
  }
  deleteRoutine(id: string): Promise<unknown> {
    return this.call(`/routines/${encodeURIComponent(id)}`, "DELETE");
  }
  runRoutine(id: string): Promise<unknown> {
    return this.call(`/routines/${encodeURIComponent(id)}/run`, "POST", {});
  }
  monitors(): Promise<{ monitors: HubMonitor[] }> {
    return this.call("/monitors");
  }
  createMonitor(body: { botId: string; conv?: ConvKey; name?: string; url: string; intervalMin?: number; expectText?: string; investigate?: boolean }): Promise<{ monitor: HubMonitor }> {
    return this.call("/monitors", "POST", body);
  }
  deleteMonitor(id: string): Promise<unknown> {
    return this.call(`/monitors/${encodeURIComponent(id)}`, "DELETE");
  }

  /** 云端截图（DO 里只留最近 40 张） */
  async image(key: string): Promise<Blob> {
    const token = await this.d.token();
    if (!token) throw new BotCloudError(401, "not_signed_in");
    const f = this.d.fetch ?? fetch;
    const res = await f(`${this.d.baseUrl}${BOT_CLOUD_PATH}/image/${encodeURIComponent(key)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new BotCloudError(res.status, `http_${res.status}`);
    return await res.blob();
  }

  /** 用户电脑传上来的录屏 / 文件（DO 里只留最近一批，总量有上限） */
  async media(key: string): Promise<Blob> {
    const token = await this.d.token();
    if (!token) throw new BotCloudError(401, "not_signed_in");
    const f = this.d.fetch ?? fetch;
    const res = await f(`${this.d.baseUrl}${BOT_CLOUD_PATH}/media/${encodeURIComponent(key)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new BotCloudError(res.status, `http_${res.status}`);
    return await res.blob();
  }

  setRules(botId: string, rules: Record<string, string>): Promise<unknown> {
    return this.call(`/rules/${encodeURIComponent(botId)}`, "PUT", rules);
  }
  /** 所有 Bot 一起改；approvePending = 顺手批掉正在等的审批（老云端不认这个路径时回 404） */
  setRulesAll(rules: Record<string, string>, approvePending = false): Promise<{ approved?: string[] }> {
    return this.call("/rules", "PUT", { rules, approvePending });
  }

  decideApproval(id: string, approve: boolean, scope: "once" | "task" | "hour" | "always" = "once"): Promise<unknown> {
    return this.call(`/approvals/${encodeURIComponent(id)}`, "POST", { approve, scope });
  }

  /**
   * 实时通道：WebSocket 子协议带 token；断线指数退避重连，连上先按游标补齐。
   * 每条连接的回调只认自己：旧连接晚到的 onclose 不能把新连接清掉、也不能再排一次重连（否则会叠出两条连接）。
   */
  async connect(): Promise<void> {
    this.closed = false;
    this.clearRetry();
    const token = await this.d.token();
    const WS = this.d.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    if (!WS || this.closed) return;
    if (!token) {
      // 登录态一时取不到（刷新 token 失败、刚醒来没网）：别就此断了实时通道，过会儿再试
      this.scheduleReconnect();
      return;
    }
    this.drop();
    const url = `${this.d.baseUrl.replace(/^http/, "ws")}${BOT_CLOUD_PATH}/ws`;
    const ws = new WS(url, ["cancri-bothub", token]);
    this.ws = ws;
    this.lastHeard = this.now();
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.lastHeard = this.now();
      ws.send(JSON.stringify({ type: "hello", since: this.cursor }));
      this.startHeartbeat(ws);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws) return;
      this.lastHeard = this.now();
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === "pong") return;
      if (msg.type === "backlog") {
        this.take(msg as { cursor?: number; events?: HubEventWire[]; reset?: boolean });
        return;
      }
      if (typeof msg.type === "string" && msg.data) {
        const ev = msg as unknown as HubEventWire;
        if (typeof ev.seq === "number") this.advance([ev]);
        this.d.onEvents?.([ev]);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      if (!this.closed) this.scheduleReconnect();
    };
  }

  /** 怀疑连接不行了（心跳超时、页面回到前台、网络恢复）：立刻换一条新的 */
  reconnect(): void {
    if (this.closed) return;
    this.retry = 0;
    void this.connect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer) return;
    const delay = Math.min(60_000, 1000 * 2 ** this.retry++);
    this.retryTimer = (this.d.setTimeout ?? setTimeout)(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) (this.d.clearTimeout ?? clearTimeout)(this.retryTimer as ReturnType<typeof setTimeout>);
    this.retryTimer = null;
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeat = (this.d.setInterval ?? setInterval)(() => {
      if (this.ws !== ws) return;
      if (this.now() - this.lastHeard > WS_DEAD_MS) {
        // 半开连接：不会有 onclose，只能自己判死
        this.reconnect();
        return;
      }
      try {
        ws.send(WS_PING);
      } catch {
        this.reconnect();
      }
    }, WS_PING_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) (this.d.clearInterval ?? clearInterval)(this.heartbeat as ReturnType<typeof setInterval>);
    this.heartbeat = null;
  }

  /** 丢掉当前连接（不触发重连） */
  private drop(): void {
    const old = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    if (old) {
      old.onclose = null;
      old.onmessage = null;
      old.onopen = null;
      try {
        old.close();
      } catch {
        /* 已经断了 */
      }
    }
  }

  close(): void {
    this.closed = true;
    this.clearRetry();
    this.drop();
  }
}
