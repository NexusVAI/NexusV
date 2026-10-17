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
import { defaultSelfBlock, type BotChatMessage, type BotGroup, type BotProfile, type BotState } from "./bot-store";

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
  approvalId?: string;
  error?: boolean;
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
}

function wire(conv: ConvKey, m: BotChatMessage): HubMessageWire {
  return {
    id: m.id,
    conv,
    role: m.role,
    text: m.text,
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
  for (const ev of events) {
    if (ev.data?.notify) notices.push(ev);
    if (ev.type === "typing") {
      const conv = String(ev.data.conv ?? "");
      const botId = String(ev.data.botId ?? "");
      if (threadOf(state, conv) && botId) typing.push({ conv, botId, on: ev.data.on === true, ...(typeof ev.data.tool === "string" ? { tool: ev.data.tool } : {}) });
      continue;
    }
    if (ev.type === "message" || ev.type === "message_update") {
      const m = ev.data.message as HubMessageWire | undefined;
      if (!m?.id || typeof m.conv !== "string") continue;
      const t = threadOf(state, m.conv);
      if (!t) continue;
      const i = t.thread.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        const prev = t.thread[i];
        const next = { ...prev, ...fromWire(m) };
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
  return { changed, notices, convs: [...convs], images: [...images], typing };
}

// ── 名册（别的端新建 / 删掉的 Bot、群） ───────────────────────────────────────

export interface HubRosterBot {
  id: string;
  name: string;
  tags?: string[];
  memorySelf?: string;
  memoryUser?: string;
  todos?: string[];
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
}
/** `GET /state`：网页 / 手机端没有本地存档，首屏一次拿全 */
export interface HubSnapshot extends HubRoster {
  messages: Record<string, HubMessageWire[]>;
  cursor: number;
}

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
 *   · 桌面端（authoritative=false）：只补上本地没有的（网页 / 手机新建的）；本地删掉的已经随这次 sync 让云端删了，不会再回来。
 *   · 网页端（authoritative=true）：云端就是正本 —— 名字 / 标签 / 记忆跟云端走；云端没有、而本地以前同步过（known）的 → 别的端删了，本地也删；
 *     本地新建还没上传的保留（下次 sync 带上去）。从没用过的默认 Bot（没发过消息）在云端已有 Bot 时直接丢掉，免得多出一个空 Bot。
 */
export function mergeRoster(
  state: BotState,
  roster: HubRoster,
  opts: { authoritative?: boolean; known?: { bots: string[]; groups: string[] }; now?: number } = {},
): RosterMerge {
  const now = opts.now ?? Date.now();
  const convs = new Set<string>();
  const known = { bots: new Set(opts.known?.bots ?? []), groups: new Set(opts.known?.groups ?? []) };
  const hubBots = new Map(roster.bots.filter((b) => b && typeof b.id === "string").map((b) => [b.id, b]));
  const hubGroups = new Map(roster.groups.filter((g) => g && typeof g.id === "string").map((g) => [g.id, g]));
  for (const hb of hubBots.values()) {
    const local = state.bots.find((b) => b.id === hb.id);
    if (!local) {
      state.bots.push(profileFromHub(hb, now, !!opts.authoritative));
      convs.add(`bot:${hb.id}`);
    } else if (opts.authoritative) {
      const next = { name: hb.name || local.name, tags: hb.tags ?? local.tags, self: hb.memorySelf ?? local.memory.self, user: hb.memoryUser ?? local.memory.user };
      if (next.name !== local.name || JSON.stringify(next.tags) !== JSON.stringify(local.tags) || next.self !== local.memory.self || next.user !== local.memory.user) {
        local.name = next.name;
        local.tags = [...next.tags];
        local.memory = { self: next.self, user: next.user };
        convs.add(`bot:${hb.id}`);
      }
    }
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
    if (!local) {
      state.groups.push(groupFromHub({ ...hg, memberIds: members }, now));
      convs.add(`group:${hg.id}`);
    } else if (opts.authoritative && (local.name !== (hg.name ?? "") || local.memberIds.join() !== members.join())) {
      local.name = hg.name ?? "";
      local.memberIds = members;
      convs.add(`group:${hg.id}`);
    }
  }
  if (opts.authoritative) {
    state.groups = state.groups.filter((g) => {
      const gone = !hubGroups.has(g.id) && known.groups.has(g.id);
      if (gone) convs.add(`group:${g.id}`);
      return !gone && g.memberIds.every((id) => botIds.has(id));
    });
  }
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
  setTimeout?: (fn: () => void, ms: number) => unknown;
}

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
  private readonly d: BotCloudDeps;

  constructor(d: BotCloudDeps) {
    this.d = d;
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

  /** 推本地状态、拉云端事件；返回的事件已经推给 onEvents */
  async sync(state: BotState): Promise<HubEventWire[]> {
    const r = await this.call<{ cursor: number; events: HubEventWire[]; reset?: boolean }>(`/sync?since=${this.cursor}`, "POST", toSyncPayload(state));
    this.cursor = r.cursor;
    if (r.events?.length) this.d.onEvents?.(r.events);
    return r.events ?? [];
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

  decideApproval(id: string, approve: boolean, scope: "once" | "task" | "hour" | "always" = "once"): Promise<unknown> {
    return this.call(`/approvals/${encodeURIComponent(id)}`, "POST", { approve, scope });
  }

  /** 实时通道：WebSocket 子协议带 token；断线指数退避重连，连上先按游标补齐 */
  async connect(): Promise<void> {
    this.closed = false;
    const token = await this.d.token();
    const WS = this.d.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : undefined);
    if (!token || !WS) return;
    const url = `${this.d.baseUrl.replace(/^http/, "ws")}${BOT_CLOUD_PATH}/ws`;
    const ws = new WS(url, ["cancri-bothub", token]);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ type: "hello", since: this.cursor }));
    };
    ws.onmessage = (e: MessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (msg.type === "backlog") {
        const events = (msg.events as HubEventWire[]) ?? [];
        if (typeof msg.cursor === "number") this.cursor = Math.max(this.cursor, msg.cursor);
        if (events.length) this.d.onEvents?.(events);
        return;
      }
      if (typeof msg.type === "string" && msg.data) {
        const ev = msg as unknown as HubEventWire;
        if (typeof ev.seq === "number") this.cursor = Math.max(this.cursor, ev.seq);
        this.d.onEvents?.([ev]);
      }
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      const delay = Math.min(60_000, 1000 * 2 ** this.retry++);
      (this.d.setTimeout ?? setTimeout)(() => void this.connect(), delay);
    };
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}
