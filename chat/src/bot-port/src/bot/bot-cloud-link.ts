// 移植自 cancri-code/src/bot/bot-cloud-link.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 云端 Bot 的「接线员」：把 BotCloudClient 接到 Bot 界面上。
 *
 *   · 默认云端运行：登录了就连（不再有开关）。账号不在灰度名单（服务端 404）时什么都不做，桌面端行为不变。
 *   · 进页面先 enable + sync，然后 WebSocket 实时收事件；本地改动后 1 秒、以及每 60 秒再 sync 一次
 *     （WebSocket 断了也能按游标补齐）。云端把各端推上来的变化实时广播给其它端，所以一端发的消息另一端马上能看到。
 *   · 名册（Bot / 群的名字、标签、记忆、成员）三方合并：base = 上次和云端对齐时的样子（按账号存本地）。
 *     本地改过的才上推；云端改过、本地没改的跟云端。别的端删掉的（墓碑）本地照删，不会再被推回去。
 *   · remote（网页 / 手机）：本地没有 agent loop，消息走 `/send` 让云端回复；首屏 `GET /state` 拉全量（hydrate）。
 *   · 云端事件 → applyHubEvents 合进本地状态 → onChanged(会话) 让界面落盘 + 重画；
 *     新截图去 `/image/<key>` 拉下来存进 IndexedDB；审批 / 监控告警弹一条提示。
 *     事件里出现本地还不认识的会话（别的端刚建的）→ 先 sync 拿名册，再把那几个会话的消息补齐。
 *   · 本地删掉的 Bot / 群记在 known 里，下一次 sync 带 removedBots / removedGroups；删掉的消息、清空的会话记在 pending 里。
 *   · 桌面端的事件游标按账号存本地：关机期间别的端发生的事，下次打开按游标补上（离线太久超出云端保留窗口就整段重拉）。
 *
 * 纯编排，不碰 DOM（只在浏览器里挂「回到前台 / 网络恢复」两个监听）；所有外部依赖可注入，便于测试。
 */
import {
  BotCloudClient,
  BotCloudError,
  SYNC_EVENTS_PAGE,
  applyHubEvents,
  applyRemovals,
  approvalEvents,
  botSig,
  groupSig,
  hubErrorText,
  inferReadCursors,
  mergeRoster,
  parseDevices,
  snapshotEvents,
  toSyncPayload,
  type ConvKey,
  type HubDevice,
  type HubEventWire,
  type HubMessageWire,
  type HubMonitor,
  type HubRoster,
  type HubRoutine,
  type RoutineSchedule,
  type SyncPayload,
  type TypingSignal,
} from "./bot-cloud";
import type { BotState } from "./bot-store";

export const CLOUD_SYNC_MS = 60_000;
/** 本地改动后多久推一次：够快（另一端约 1 秒内看到），又不至于在 Bot 一轮里反复改动时把 120 次/分钟的限速打满 */
export const CLOUD_DIRTY_MS = 1_000;
export const CLOUD_RETRY_MS = 30_000;
export const CLOUD_RETRY_MAX_MS = 5 * 60_000;
const KNOWN_PREFIX = "cancri.botCloud.known.";
const BASE_PREFIX = "cancri.botCloud.base.";
const PENDING_PREFIX = "cancri.botCloud.pending.";
const CURSOR_PREFIX = "cancri.botCloud.cursor.";

interface PendingRemovals {
  messages: Array<{ conv: string; id: string }>;
  cleared: Array<{ conv: string; before: number }>;
}

/** unknown = 还没问过服务端这个账号能不能用（卡片先不画） */
export type CloudPhase = "unknown" | "off" | "starting" | "on" | "unavailable" | "error";

export interface CloudInfo {
  phase: CloudPhase;
  routines: number;
  monitors: number;
  pendingApprovals: number;
  error?: string;
  /** 用户自己的电脑（开了「允许云端 Bot 访问这台电脑」的）；还没问过云端时不填 */
  devices?: HubDevice[];
}

export interface BotCloudLinkDeps {
  owner: () => string;
  state: () => BotState;
  /** 云端改了本地状态：落盘 + 重画这些会话（`bot:<id>` / `group:<id>`） */
  onChanged: (convs: string[]) => void;
  /** 云端状态（开关 / 计数）变了：重画面板里的那张卡 */
  onInfo?: (info: CloudInfo) => void;
  onNotice?: (text: string) => void;
  /** 云端 Bot 正在输入 / 在用工具（on=false：说完了） */
  onTyping?: (t: TypingSignal) => void;
  /** 这些会话被别的端清空了：本地 agent 手里的上下文也要扔掉（和本地清空一样） */
  onContextReset?: (convs: string[]) => void;
  /** 网页 / 手机：本地不跑 agent loop，名册以云端为准，首屏从 `/state` 拉 */
  remote?: boolean;
  /** 截图存进 IndexedDB；拉完回调 onChanged 让 <img> 重新取 */
  putImage: (id: string, blob: Blob) => Promise<void>;
  client?: BotCloudClient;
  baseUrl?: string;
  token?: () => Promise<string | null>;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  /** 「回到前台 / 网络恢复」时回调；返回取消函数。缺省挂 document.visibilitychange + window.online */
  onWake?: (fn: () => void) => () => void;
}

function browserWake(fn: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => undefined;
  const vis = () => {
    if (document.visibilityState === "visible") fn();
  };
  document.addEventListener("visibilitychange", vis);
  window.addEventListener("online", fn);
  return () => {
    document.removeEventListener("visibilitychange", vis);
    window.removeEventListener("online", fn);
  };
}

export class BotCloudLink {
  info: CloudInfo = { phase: "unknown", routines: 0, monitors: 0, pendingApprovals: 0 };
  private probedOwner = "";
  readonly client: BotCloudClient;
  private readonly d: BotCloudLinkDeps;
  private ownerAtStart = "";
  private interval: unknown = null;
  private dirtyTimer: unknown = null;
  private retryTimer: unknown = null;
  private failures = 0;
  private syncing: Promise<void> | null = null;
  private again = false;
  private stopped = true;
  private unwake: (() => void) | null = null;
  /** 这一端的随机 id：云端「名册变了」的广播里带着它，自己引起的那次不用再拉 */
  readonly clientId = Math.random().toString(36).slice(2, 12);

  constructor(d: BotCloudLinkDeps) {
    this.d = d;
    this.client =
      d.client ??
      new BotCloudClient({
        baseUrl: d.baseUrl ?? "https://chat.nexusvai.xyz",
        token: d.token ?? (async () => null),
        onEvents: (evs) => this.handle(evs),
        onReset: () => void this.recover(),
      });
  }

  private get storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
    return this.d.storage ?? localStorage;
  }

  /** 已连上云端（Bot 的 cloud_schedule 工具只在这时可用） */
  isOn(): boolean {
    return !this.stopped && this.info.phase === "on";
  }

  /** 默认云端运行：登录了就开（没有开关；不在灰度名单的账号由服务端 404 挡掉） */
  enabled(): boolean {
    const o = this.d.owner();
    return !!o && o !== "anon";
  }

  private setInfo(patch: Partial<CloudInfo>): void {
    this.info = { ...this.info, ...patch };
    if (patch.phase && patch.phase !== "error") delete this.info.error;
    this.d.onInfo?.(this.info);
  }

  /** 进入 Bot 页 / 换账号后调用：开关开着就连上 */
  async start(): Promise<void> {
    if (!this.enabled()) {
      this.stop();
      await this.probe();
      return;
    }
    if (!this.stopped && this.ownerAtStart === this.d.owner()) return;
    // 服务端说过这个账号用不了：同一个账号不反复敲门（换账号会重新问）
    if (this.info.phase === "unavailable" && this.probedOwner === this.d.owner()) return;
    this.stop();
    this.stopped = false;
    this.ownerAtStart = this.d.owner();
    this.unwake ??= (this.d.onWake ?? browserWake)(() => this.wake());
    this.setInfo({ phase: "starting" });
    try {
      const st = await this.client.enable();
      if (this.d.remote) await this.hydrate();
      else this.client.cursor = this.readCursor() ?? (Number(st?.cursor) || 0);
      await this.syncNow();
      if (this.stopped) return;
      void this.client.connect();
      this.interval = (this.d.setInterval ?? setInterval)(() => void this.syncNow(), CLOUD_SYNC_MS);
      await this.refreshCounts();
      this.failures = 0;
      this.setInfo({ phase: "on" });
    } catch (e) {
      this.fail(e);
    }
  }

  /** 页面回到前台 / 网络恢复：连接多半已经死了（手机锁屏、电脑睡眠），立刻重连并补一次 */
  private wake(): void {
    if (!this.enabled() || this.d.owner() !== this.ownerAtStart) return;
    if (this.info.phase === "error") {
      if (this.retryTimer) (this.d.clearTimeout ?? clearTimeout)(this.retryTimer as ReturnType<typeof setTimeout>);
      this.retryTimer = null;
      void this.start();
      return;
    }
    if (this.stopped) return;
    if (!this.client.live) this.client.reconnect();
    void this.syncNow();
  }

  /**
   * 开关没开时问一次服务端：这个账号在不在灰度名单里（不在 → 404 → 卡片不画）。
   * 每个账号只问一次；没登录不问（登录后换账号回调会再来）。
   */
  private async probe(): Promise<void> {
    const o = this.d.owner();
    if (this.probedOwner === o && this.info.phase !== "unknown") {
      if (this.info.phase !== "unavailable") this.setInfo({ phase: "off" });
      return;
    }
    try {
      await this.client.status();
      this.probedOwner = o;
      this.setInfo({ phase: "off" });
    } catch (e) {
      if (e instanceof BotCloudError && e.status === 404) {
        this.probedOwner = o;
        this.setInfo({ phase: "unavailable" });
      } else this.setInfo({ phase: "unknown" });
    }
  }

  private fail(e: unknown): void {
    const unavailable = e instanceof BotCloudError && e.status === 404;
    if (unavailable) this.probedOwner = this.d.owner();
    this.stop();
    this.setInfo(unavailable ? { phase: "unavailable" } : { phase: "error", error: hubErrorText(e) });
    if (unavailable) return;
    // 网络断了 / 服务端出错：退避重连（30 秒起，最长 5 分钟）
    const delay = Math.min(CLOUD_RETRY_MAX_MS, CLOUD_RETRY_MS * 2 ** this.failures++);
    this.retryTimer = (this.d.setTimeout ?? setTimeout)(() => {
      this.retryTimer = null;
      void this.start();
    }, delay);
  }

  /** 停掉同步与实时通道。「回到前台」监听留着（一个界面只装一次）：出错退避期间回到前台要能立刻重试 */
  stop(): void {
    this.stopped = true;
    if (this.retryTimer) (this.d.clearTimeout ?? clearTimeout)(this.retryTimer as ReturnType<typeof setTimeout>);
    this.retryTimer = null;
    if (this.interval) (this.d.clearInterval ?? clearInterval)(this.interval as ReturnType<typeof setInterval>);
    if (this.dirtyTimer) (this.d.clearTimeout ?? clearTimeout)(this.dirtyTimer as ReturnType<typeof setTimeout>);
    this.interval = null;
    this.dirtyTimer = null;
    this.client.close();
  }

  /** 本地有改动（发消息、改名、删 Bot…）：1 秒后合并成一次 sync */
  dirty(): void {
    if (this.stopped || this.dirtyTimer) return;
    this.dirtyTimer = (this.d.setTimeout ?? setTimeout)(() => {
      this.dirtyTimer = null;
      void this.syncNow();
    }, CLOUD_DIRTY_MS);
  }

  private knownKey(): string {
    return KNOWN_PREFIX + this.d.owner();
  }

  private readKnown(): { bots: string[]; groups: string[] } {
    try {
      return { bots: [], groups: [], ...JSON.parse(this.storage.getItem(this.knownKey()) || "{}") };
    } catch {
      return { bots: [], groups: [] }; // 坏数据当没有
    }
  }

  private writeKnown(ids: { bots: string[]; groups: string[] }): void {
    this.storage.setItem(this.knownKey(), JSON.stringify(ids));
  }

  private readJson<T>(prefix: string): T | null {
    try {
      const raw = this.storage.getItem(prefix + this.d.owner());
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null; // 坏数据当没有
    }
  }

  /** 上次和云端对齐时，每个 Bot / 群的签名（三方合并的「共同祖先」）。null = 这台设备还没对齐过 */
  private readBase(): Map<string, string> | null {
    const o = this.readJson<Record<string, string>>(BASE_PREFIX);
    return o && typeof o === "object" ? new Map(Object.entries(o)) : null;
  }
  private writeBase(roster: HubRoster): void {
    const base: Record<string, string> = {};
    for (const b of roster.bots) base[`bot:${b.id}`] = botSig(b);
    for (const g of roster.groups) base[`group:${g.id}`] = groupSig(g);
    this.storage.setItem(BASE_PREFIX + this.d.owner(), JSON.stringify(base));
  }

  private readPending(): PendingRemovals {
    const p = this.readJson<Partial<PendingRemovals>>(PENDING_PREFIX);
    return { messages: Array.isArray(p?.messages) ? p.messages : [], cleared: Array.isArray(p?.cleared) ? p.cleared : [] };
  }
  private writePending(p: PendingRemovals): void {
    if (!p.messages.length && !p.cleared.length) this.storage.removeItem(PENDING_PREFIX + this.d.owner());
    else this.storage.setItem(PENDING_PREFIX + this.d.owner(), JSON.stringify(p));
  }

  /** 桌面端：上次处理到的云端事件位置（下次打开从这里补） */
  private readCursor(): number | null {
    const n = Number(this.storage.getItem(CURSOR_PREFIX + this.d.owner()));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  private writeCursor(): void {
    if (!this.d.remote && this.client.cursor > 0) this.storage.setItem(CURSOR_PREFIX + this.d.owner(), String(this.client.cursor));
  }

  /** 本地删了几条消息：下一次 sync 让云端和其它端也删 */
  removeMessages(conv: string, ids: string[]): void {
    if (!ids.length) return;
    const p = this.readPending();
    p.messages.push(...ids.map((id) => ({ conv, id })));
    p.messages = p.messages.slice(-400);
    this.writePending(p);
    this.dirty();
  }

  /** 本地清空了会话（before 及之前的都不要了）：下一次 sync 让云端和其它端也清 */
  clearConv(conv: string, before: number): void {
    const p = this.readPending();
    p.cleared = [...p.cleared.filter((c) => c.conv !== conv), { conv, before }];
    this.writePending(p);
    this.dirty();
  }

  /** 名册合进本地；有增删改就当这些会话变了（界面重画列表）。合完以云端这份为新的「共同祖先」 */
  private applyRoster(roster: HubRoster | undefined, known: { bots: string[]; groups: string[] }): string[] {
    if (!roster || !Array.isArray(roster.bots) || !Array.isArray(roster.groups)) return [];
    const r = mergeRoster(this.d.state(), roster, { authoritative: !!this.d.remote, known, base: this.readBase() });
    this.writeBase(roster);
    return r.convs;
  }

  /**
   * 上行只带「本地新建 / 本地改过」的 Bot 和群（相对 base）：没改过的不推，
   * 否则别的端刚改的名字 / 刚删的 Bot 会被这边一次 sync 又写回云端。还没对齐过（没有 base）就全推。
   * 网页端的消息只推云端认识的会话（本地那个从没用过的默认 Bot 不上云）。
   */
  private deltaPayload(payload: SyncPayload): SyncPayload {
    const base = this.readBase();
    if (!base) return payload;
    const bots = payload.bots.filter((b) => base.get(`bot:${b.id}`) !== botSig(b));
    const groups = payload.groups.filter((g) => base.get(`group:${g.id}`) !== groupSig(g));
    if (!this.d.remote) return { ...payload, bots, groups };
    const live = new Set([...base.keys(), ...bots.map((b) => `bot:${b.id}`), ...groups.map((g) => `group:${g.id}`)]);
    return { ...payload, bots, groups, messages: payload.messages.filter((m) => live.has(m.conv)) };
  }

  /**
   * 网页 / 手机首屏：`GET /state` 拿全部 Bot、群和最近消息，合进本地（以云端为准）。
   * 游标接到快照的位置，之后 WebSocket / sync 只补增量。
   */
  async hydrate(): Promise<void> {
    // 快照不带审批结论：顺手并行拉一份审批列表，把批过 / 拒过 / 过期的卡片校正过来（拉不到就算了）
    const [snap, approvals] = await Promise.all([this.client.snapshot(), this.recentApprovals()]);
    const st = this.d.state();
    const convs = new Set(this.applyRoster(snap, this.readKnown()));
    for (const c of applyRemovals(st, snap)) convs.add(c);
    const r = applyHubEvents(st, [...this.withoutPending(snapshotEvents(snap)), ...approvalEvents(approvals)]);
    for (const c of r.convs) convs.add(c);
    // 快照也不带已读游标：不推一下的话，首屏每条用户消息都挂着「未读」
    for (const c of inferReadCursors(st, snap)) convs.add(c);
    if (typeof snap.cursor === "number") this.client.cursor = Math.max(this.client.cursor, snap.cursor);
    if (st.bots.length && !st.onboardedAt) st.onboardedAt = Date.now();
    this.writeKnown({ bots: st.bots.map((b) => b.id), groups: st.groups.map((g) => g.id) });
    this.d.onChanged([...convs]);
    for (const key of r.images) void this.fetchImage(key, r.convs);
  }

  /** 审批列表只用来校正卡片状态：失败（老版云端 / 网络抖动）不能拖垮首屏 */
  private async recentApprovals(): Promise<Array<{ id?: unknown; status?: unknown }> | undefined> {
    try {
      return (await this.client.approvals())?.approvals;
    } catch {
      return undefined;
    }
  }

  /** 本地刚删、还没推上去的消息：云端发回来的（补齐 / 快照）先别加回来 */
  private withoutPending(events: HubEventWire[]): HubEventWire[] {
    const p = this.readPending();
    if (!p.messages.length && !p.cleared.length) return events;
    const gone = new Set(p.messages.map((m) => m.id));
    const cut = new Map(p.cleared.map((c) => [c.conv, c.before]));
    return events.filter((ev) => {
      if (ev.type !== "message" && ev.type !== "message_update") return true;
      const m = ev.data.message as HubMessageWire | undefined;
      return !m || (!gone.has(m.id) && !(m.at <= (cut.get(m.conv) ?? -Infinity)));
    });
  }

  /** 别的端刚建的会话：本地拿到名册之前，它的消息事件被跳过了 —— 按会话把最近的消息补回来 */
  private async backfill(convs: string[]): Promise<void> {
    const st = this.d.state();
    const want = convs.filter((c) => /^(bot|group):[\w-]+$/.test(c) && (c.startsWith("bot:") ? st.bots.some((b) => `bot:${b.id}` === c) : st.groups.some((g) => `group:${g.id}` === c)));
    for (const conv of want.slice(0, 20)) {
      try {
        const r = await this.client.call<{ messages?: HubMessageWire[] }>(`/messages?conv=${encodeURIComponent(conv)}`);
        const events = (r.messages ?? []).map((m) => ({ at: m.at, type: "message", data: { message: m } }));
        if (events.length) this.handle(events);
      } catch {
        /* 补不到就算了：之后的消息照常实时来 */
      }
    }
  }

  /**
   * 游标比云端保留的事件还旧（离线太久）：增量补不齐了。
   * 网页端整段重拉；桌面端只按快照把各会话最近的消息补上（本地存档是正本，删过的不会被加回来：快照带墓碑）。
   */
  private async recover(): Promise<void> {
    if (this.stopped) return;
    try {
      if (this.d.remote) {
        await this.hydrate();
        return;
      }
      const [snap, approvals] = await Promise.all([this.client.snapshot(), this.recentApprovals()]);
      const st = this.d.state();
      const convs = new Set(applyRemovals(st, snap));
      const r = applyHubEvents(st, [...this.withoutPending(snapshotEvents(snap)), ...approvalEvents(approvals)]);
      for (const c of r.convs) convs.add(c);
      if (typeof snap.cursor === "number") this.client.cursor = Math.max(this.client.cursor, snap.cursor);
      this.writeCursor();
      if (convs.size) this.d.onChanged([...convs]);
    } catch {
      /* 下次 sync 再说 */
    }
  }

  /**
   * remote：用户发的消息交给云端回复。云端还不认识刚建的 Bot / 群（3 秒后才同步）→ 先同步一次再发。
   * 消息本身已经在本地线程里（id 相同，云端去重）。
   */
  async sendRemote(conv: ConvKey, msg: { id: string; text: string; replyTo?: string }): Promise<HubMessageWire> {
    const go = () => this.client.send(conv, msg.text, { id: msg.id, ...(msg.replyTo ? { replyTo: msg.replyTo } : {}) });
    try {
      return (await go()).message;
    } catch (e) {
      if (!(e instanceof BotCloudError) || !/^(bot|group)_not_found$/.test(e.code)) throw e;
      await this.syncNow();
      return (await go()).message;
    }
  }

  /** 推本地状态、拉云端事件。并发调用合并成一次（跑着的时候又来 → 跑完再补一次） */
  syncNow(): Promise<void> {
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    const run = async (): Promise<void> => {
      do {
        this.again = false;
        if (this.stopped || this.d.owner() !== this.ownerAtStart) return;
        const st = this.d.state();
        const known = this.readKnown();
        // 「这次推了哪些」按发请求这一刻记：请求在路上时新建的 Bot 还没上云，不能算 known（否则网页端会把它当成别处删掉的）
        const sent = { bots: st.bots.map((b) => b.id), groups: st.groups.map((g) => g.id) };
        const removed = { bots: known.bots.filter((id) => !sent.bots.includes(id)), groups: known.groups.filter((id) => !sent.groups.includes(id)) };
        const pending = this.readPending();
        const payload: SyncPayload = {
          ...this.deltaPayload(toSyncPayload(st, undefined, removed)),
          clientId: this.clientId,
          ...(pending.messages.length ? { removedMessages: pending.messages } : {}),
          ...(pending.cleared.length ? { cleared: pending.cleared } : {}),
        };
        try {
          const res = await this.client.call<{ cursor: number; events?: HubEventWire[]; roster?: HubRoster; reset?: boolean }>(`/sync?since=${this.client.cursor}`, "POST", payload);
          // 已经推上去的删除从待办里划掉（请求在路上时又删的留着下次）
          if (pending.messages.length || pending.cleared.length) {
            const now = this.readPending();
            const sentMsg = new Set(pending.messages.map((m) => m.id));
            const sentClear = new Set(pending.cleared.map((c) => `${c.conv}@${c.before}`));
            this.writePending({ messages: now.messages.filter((m) => !sentMsg.has(m.id)), cleared: now.cleared.filter((c) => !sentClear.has(`${c.conv}@${c.before}`)) });
          }
          const changed = this.applyRoster(res.roster, known);
          this.writeKnown(sent);
          if (changed.length) this.d.onChanged(changed);
          // /sync 回的是从 since 起连续的一段，它给的游标可以直接用（实时通道可能已经走到更后面了，取大的）
          if (typeof res.cursor === "number") this.client.cursor = res.reset ? res.cursor : Math.max(this.client.cursor, res.cursor);
          if (res.events?.length) this.handle(res.events);
          if (res.reset) void this.recover();
          this.writeCursor();
          // 名册里新冒出来的会话：之前它的消息事件被跳过了，补一下
          const fresh = changed.filter((c) => !known.bots.includes(c.slice(4)) && !known.groups.includes(c.slice(6)));
          if (fresh.length) void this.backfill(fresh);
          // 一页没拉完（离线久了）：接着拉
          if ((res.events?.length ?? 0) >= SYNC_EVENTS_PAGE) this.again = true;
        } catch (e) {
          if (e instanceof BotCloudError && (e.status === 404 || e.status === 409)) {
            this.fail(e);
            return;
          }
          // 网络抖动：下一轮再来
          return;
        }
      } while (this.again);
    };
    this.syncing = run().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  /** 云端事件 → 本地 */
  handle(events: HubEventWire[]): void {
    if (this.stopped) return;
    const st = this.d.state();
    const r = applyHubEvents(st, this.withoutPending(events));
    if (r.cleared.length) this.d.onContextReset?.(r.cleared);
    if (r.changed) this.d.onChanged(r.convs);
    // 别的端改了名册 / 事件里有本地还不认识的会话：拉一次名册（sync 会顺带把新会话的消息补齐）
    if (r.rosterBy.some((by) => by !== this.clientId) || r.unknownConvs.length) {
      void this.syncNow().then(() => (r.unknownConvs.length ? this.backfill(r.unknownConvs) : undefined));
    }
    this.writeCursor();
    for (const t of r.typing) this.d.onTyping?.(t);
    for (const key of r.images) void this.fetchImage(key, r.convs);
    if (r.devices) this.setInfo({ devices: r.devices });
    for (const ev of r.notices) {
      const text = noticeText(ev, st);
      if (text) this.d.onNotice?.(text);
    }
    if (events.some((e) => e.type === "approval" || e.type === "monitor")) void this.refreshCounts();
  }

  private async fetchImage(key: string, convs: string[]): Promise<void> {
    try {
      const blob = await this.client.image(key);
      await this.d.putImage(`hub-${key}`, blob);
      this.d.onChanged(convs);
    } catch {
      /* 拉不到（已被云端淘汰）就算了：消息文字还在 */
    }
  }

  /** 云端发来的录屏 / 文件：点开时才拉（`/media/<key>`），存进 IndexedDB（id = `hub-<key>`），下次不再拉 */
  private mediaInflight = new Map<string, Promise<Blob>>();
  fetchMedia(key: string): Promise<Blob> {
    let p = this.mediaInflight.get(key);
    if (!p) {
      p = this.client.media(key).then(async (blob) => {
        await this.d.putImage(`hub-${key}`, blob).catch(() => undefined);
        return blob;
      });
      this.mediaInflight.set(key, p);
      void p.catch(() => undefined).finally(() => this.mediaInflight.delete(key));
    }
    return p;
  }

  async refreshCounts(): Promise<void> {
    try {
      const s = await this.client.status();
      this.setInfo({
        routines: Number(s.routines) || 0,
        monitors: Number(s.monitors) || 0,
        pendingApprovals: Number(s.pendingApprovals) || 0,
        ...(Array.isArray(s.devices) ? { devices: parseDevices(s.devices) } : {}),
      });
    } catch {
      /* 计数只是展示 */
    }
  }

  async decideApproval(id: string, approve: boolean, scope: "once" | "hour" = "once"): Promise<void> {
    let r: { approval?: { id: string; status: string } };
    try {
      r = (await this.client.decideApproval(id, approve, scope)) as typeof r;
    } catch (e) {
      // 别的端已经批过 / 拒过 / 过期了（409 approval_<状态>）、或早被清掉（404）：照云端的结论改卡片，不报错
      const done = e instanceof BotCloudError ? /^approval_(approved|denied|expired)$/.exec(e.code)?.[1] ?? (e.code === "approval_not_found" ? "expired" : "") : "";
      if (!done) throw e;
      r = { approval: { id, status: done } };
    }
    if (r?.approval) this.handle([{ at: Date.now(), type: "approval", data: { approval: r.approval } }]);
  }

  /** 操作权限：full = 云电脑上的读写、开机、联网都直接做；你电脑上的截屏和文件、登录付款仍然要你来 */
  async setAccess(botId: string, access: "ask" | "full"): Promise<void> {
    this.ready();
    const level = access === "full" ? "auto" : "ask";
    await this.client.setRules(botId, { read: "auto", compute: "auto", write: level, outbound: level, device: "ask" });
  }

  // ── 给 Bot 工具用的日程接口 ─────────────────────────────────────────────

  private ready(): void {
    if (this.stopped || this.info.phase !== "on") throw new BotCloudError(409, "hub_not_enabled");
  }

  async listSchedules(botId: string): Promise<{ routines: HubRoutine[]; monitors: HubMonitor[] }> {
    this.ready();
    const [r, m] = await Promise.all([this.client.routines(), this.client.monitors()]);
    return { routines: r.routines.filter((x) => x.botId === botId), monitors: m.monitors.filter((x) => x.botId === botId) };
  }

  async addRoutine(input: { botId: string; conv: ConvKey; title?: string; prompt: string; schedule: RoutineSchedule; allowComputer?: boolean }): Promise<HubRoutine> {
    this.ready();
    await this.syncNow(); // 刚建的 Bot / 群云端还不认识
    const r = await this.client.createRoutine(input);
    void this.refreshCounts();
    return r.routine;
  }

  async addMonitor(input: { botId: string; conv: ConvKey; name?: string; url: string; intervalMin?: number; expectText?: string; investigate?: boolean }): Promise<HubMonitor> {
    this.ready();
    await this.syncNow();
    const r = await this.client.createMonitor(input);
    void this.refreshCounts();
    return r.monitor;
  }

  async remove(kind: "routine" | "monitor", id: string): Promise<void> {
    this.ready();
    if (kind === "routine") await this.client.deleteRoutine(id);
    else await this.client.deleteMonitor(id);
    void this.refreshCounts();
  }

  async runNow(id: string): Promise<void> {
    this.ready();
    await this.client.runRoutine(id);
  }
}

function noticeText(ev: HubEventWire, st: BotState): string {
  if (ev.type === "approval") return "云端 Bot 有一个操作等你批准";
  if (ev.type === "monitor") {
    const m = ev.data.monitor as { name?: string; botId?: string } | undefined;
    const bot = st.bots.find((b) => b.id === m?.botId)?.name ?? "Bot";
    if (ev.data.event === "opened") return `${bot}：监控「${m?.name ?? ""}」出问题了`;
    if (ev.data.event === "recovered") return `${bot}：监控「${m?.name ?? ""}」恢复了`;
  }
  return "";
}

/** 桌面端「允许云端 Bot 访问这台电脑」开关的状态（网页端没有） */
export interface DeviceCardState {
  enabled: boolean;
  phase: "off" | "connecting" | "online" | "error";
  error?: string;
}

const deviceName = (d: HubDevice, esc: (s: string) => string): string => `「${esc(d.name)}」`;

/** 卡片里关于用户电脑的那一块：桌面端是开关 + 状态，网页端只说哪台在线 / 怎么开 */
function deviceBlockHtml(info: CloudInfo, esc: (s: string) => string, device?: DeviceCardState): string {
  const list = info.devices ?? [];
  const online = list.filter((d) => d.online);
  if (device) {
    const line = !device.enabled
      ? "关着：云端 Bot 碰不到这台电脑"
      : device.phase === "online"
        ? "已连接：Bot 能看这台电脑的状态、找文件；截屏、录屏、读文件、发文件前都会先问你"
        : device.phase === "error"
          ? esc(device.error || "连接失败，稍后自动重试")
          : "正在连接…";
    return `
      <div class="bot-cloud-device">
        <button type="button" class="bot-device-switch" data-bot-action="device-toggle" role="switch" aria-checked="${device.enabled ? "true" : "false"}">
          <span class="bot-device-switch-label">允许云端 Bot 访问这台电脑</span>
          <span class="bot-switch${device.enabled ? " is-on" : ""}" aria-hidden="true"><span class="bot-switch-knob"></span></span>
        </button>
        <div class="bot-dim bot-cloud-line" data-device-line>${line}</div>
      </div>`;
  }
  const line = online.length
    ? `你的电脑 ${online.map((d) => deviceName(d, esc)).join("、")} 在线：可以让 Bot 看电脑上的文件、截屏或录屏（会先问你）`
    : list.length
      ? `你的电脑 ${deviceName(list[0], esc)} 现在不在线（打开电脑上的 Cancri Code 就能连上）`
      : "想让 Bot 看你电脑上的文件、截屏或录屏：在电脑上的 Cancri Code 里打开 Bot，在资料卡里开启「允许云端 Bot 访问这台电脑」";
  return `<div class="bot-dim bot-cloud-line bot-cloud-device-line" data-device-line>${line}</div>`;
}

/** 面板里那张「云端运行」卡片：默认开着，只显示状态（没有开关）；下面一块是用户自己的电脑 */
export function cloudCardHtml(info: CloudInfo, esc: (s: string) => string, device?: DeviceCardState): string {
  if (info.phase === "unavailable" || info.phase === "unknown") return "";
  const line =
    info.phase === "starting"
      ? "正在连接云端…"
      : info.phase === "on"
        ? `在线 · ${info.routines} 个定时任务 · ${info.monitors} 个监控${info.pendingApprovals ? ` · ${info.pendingApprovals} 个待批准` : ""}`
        : info.phase === "error"
          ? esc(info.error || "连接失败，稍后自动重试")
          : "登录后自动连接";
  return `
    <section class="bot-section bot-cloud-card" data-cloud-card>
      <div class="bot-section-head">
        <span>云端运行</span>
        <span class="bot-cloud-dot${info.phase === "on" ? " is-on" : info.phase === "error" ? " is-error" : ""}" aria-hidden="true"></span>
      </div>
      <div class="bot-dim bot-cloud-line">${line}</div>${info.phase === "on" || device ? deviceBlockHtml(info, esc, device) : ""}
    </section>`;
}
