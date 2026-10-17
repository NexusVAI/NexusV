// 移植自 cancri-code/src/bot/bot-cloud-link.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 云端 Bot 的「接线员」：把 BotCloudClient 接到 Bot 界面上。
 *
 *   · 默认云端运行：登录了就连（不再有开关）。账号不在灰度名单（服务端 404）时什么都不做，桌面端行为不变。
 *   · 进页面先 enable + sync，然后 WebSocket 实时收事件；每 60 秒、以及本地改动后 3 秒再 sync 一次
 *     （WebSocket 断了也能按游标补齐）。sync 回来的名册（roster）把别的端新建的 Bot / 群补到本地。
 *   · remote（网页 / 手机）：本地没有 agent loop，消息走 `/send` 让云端回复；首屏 `GET /state` 拉全量（hydrate），名册以云端为准。
 *   · 云端事件 → applyHubEvents 合进本地状态 → onChanged(会话) 让界面落盘 + 重画；
 *     新截图去 `/image/<key>` 拉下来存进 IndexedDB；审批 / 监控告警弹一条提示。
 *   · 本地删掉的 Bot / 群记在 known 里，下一次 sync 带 removedBots / removedGroups 让云端也删掉。
 *
 * 纯编排，不碰 DOM；所有外部依赖可注入，便于测试。
 */
import {
  BotCloudClient,
  BotCloudError,
  applyHubEvents,
  hubErrorText,
  mergeRoster,
  snapshotEvents,
  toSyncPayload,
  type ConvKey,
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
export const CLOUD_DIRTY_MS = 3_000;
export const CLOUD_RETRY_MS = 30_000;
export const CLOUD_RETRY_MAX_MS = 5 * 60_000;
const KNOWN_PREFIX = "cancri.botCloud.known.";

/** unknown = 还没问过服务端这个账号能不能用（卡片先不画） */
export type CloudPhase = "unknown" | "off" | "starting" | "on" | "unavailable" | "error";

export interface CloudInfo {
  phase: CloudPhase;
  routines: number;
  monitors: number;
  pendingApprovals: number;
  error?: string;
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
  /** remote：上一次云端名册里每个 Bot / 群的签名（没改过的不再上推） */
  private lastRoster: Map<string, string> | null = null;

  constructor(d: BotCloudLinkDeps) {
    this.d = d;
    this.client =
      d.client ??
      new BotCloudClient({
        baseUrl: d.baseUrl ?? "https://chat.nexusvai.xyz",
        token: d.token ?? (async () => null),
        onEvents: (evs) => this.handle(evs),
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
    this.setInfo({ phase: "starting" });
    try {
      await this.client.enable();
      if (this.d.remote) await this.hydrate();
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

  stop(): void {
    this.stopped = true;
    this.lastRoster = null;
    if (this.retryTimer) (this.d.clearTimeout ?? clearTimeout)(this.retryTimer as ReturnType<typeof setTimeout>);
    this.retryTimer = null;
    if (this.interval) (this.d.clearInterval ?? clearInterval)(this.interval as ReturnType<typeof setInterval>);
    if (this.dirtyTimer) (this.d.clearTimeout ?? clearTimeout)(this.dirtyTimer as ReturnType<typeof setTimeout>);
    this.interval = null;
    this.dirtyTimer = null;
    this.client.close();
  }

  /** 本地有改动（发消息、改名、删 Bot…）：3 秒后合并成一次 sync */
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

  private writeKnown(st: BotState): void {
    this.storage.setItem(this.knownKey(), JSON.stringify({ bots: st.bots.map((b) => b.id), groups: st.groups.map((g) => g.id) }));
  }

  /** 名册合进本地；有增删就当这些会话变了（界面重画列表） */
  private applyRoster(roster: HubRoster | undefined, known: { bots: string[]; groups: string[] }): string[] {
    if (!roster || !Array.isArray(roster.bots) || !Array.isArray(roster.groups)) return [];
    const r = mergeRoster(this.d.state(), roster, { authoritative: !!this.d.remote, known });
    if (this.d.remote) {
      this.lastRoster = new Map([
        ...roster.bots.map((b) => [`bot:${b.id}`, botSig(b)] as const),
        ...roster.groups.map((g) => [`group:${g.id}`, groupSig(g)] as const),
      ]);
    }
    return r.convs;
  }

  /**
   * remote 上行只带「本地新建 / 本地改过」的 Bot 和群：没改过的不推，
   * 否则别的端刚删掉的 Bot 会被这边一次 sync 又写回云端（云端是正本，删除以它为准）。
   */
  private remotePayload(payload: SyncPayload): SyncPayload {
    const last = this.lastRoster;
    if (!this.d.remote || !last) return payload;
    const bots = payload.bots.filter((b) => last.get(`bot:${b.id}`) !== botSig(b));
    const groups = payload.groups.filter((g) => last.get(`group:${g.id}`) !== groupSig(g));
    const live = new Set([...last.keys(), ...bots.map((b) => `bot:${b.id}`), ...groups.map((g) => `group:${g.id}`)]);
    return { ...payload, bots, groups, messages: payload.messages.filter((m) => live.has(m.conv)) };
  }

  /**
   * 网页 / 手机首屏：`GET /state` 拿全部 Bot、群和最近消息，合进本地（以云端为准）。
   * 游标接到快照的位置，之后 WebSocket / sync 只补增量。
   */
  async hydrate(): Promise<void> {
    const snap = await this.client.snapshot();
    const st = this.d.state();
    const convs = new Set(this.applyRoster(snap, this.readKnown()));
    const r = applyHubEvents(st, snapshotEvents(snap));
    for (const c of r.convs) convs.add(c);
    if (typeof snap.cursor === "number") this.client.cursor = Math.max(this.client.cursor, snap.cursor);
    if (st.bots.length && !st.onboardedAt) st.onboardedAt = Date.now();
    this.writeKnown(st);
    this.d.onChanged([...convs]);
    for (const key of r.images) void this.fetchImage(key, r.convs);
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
        const bots = new Set(st.bots.map((b) => b.id));
        const groups = new Set(st.groups.map((g) => g.id));
        const removed = { bots: known.bots.filter((id) => !bots.has(id)), groups: known.groups.filter((id) => !groups.has(id)) };
        const payload = this.remotePayload(toSyncPayload(st, undefined, removed));
        try {
          const res = await this.client.call<{ cursor: number; events?: HubEventWire[]; roster?: HubRoster }>(`/sync?since=${this.client.cursor}`, "POST", payload);
          this.client.cursor = res.cursor;
          const added = this.applyRoster(res.roster, known);
          this.writeKnown(st);
          if (added.length) this.d.onChanged(added);
          if (res.events?.length) this.handle(res.events);
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
    const r = applyHubEvents(st, events);
    if (r.changed) this.d.onChanged(r.convs);
    for (const t of r.typing) this.d.onTyping?.(t);
    for (const key of r.images) void this.fetchImage(key, r.convs);
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

  async refreshCounts(): Promise<void> {
    try {
      const s = await this.client.status();
      this.setInfo({
        routines: Number(s.routines) || 0,
        monitors: Number(s.monitors) || 0,
        pendingApprovals: Number(s.pendingApprovals) || 0,
      });
    } catch {
      /* 计数只是展示 */
    }
  }

  async decideApproval(id: string, approve: boolean, scope: "once" | "hour" = "once"): Promise<void> {
    const r = (await this.client.decideApproval(id, approve, scope)) as { approval?: { id: string; status: string } };
    if (r?.approval) this.handle([{ at: Date.now(), type: "approval", data: { approval: r.approval } }]);
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

const botSig = (b: { name: string; tags?: string[]; memorySelf?: string; memoryUser?: string }): string =>
  JSON.stringify([b.name, b.tags ?? [], b.memorySelf ?? "", b.memoryUser ?? ""]);
const groupSig = (g: { name: string; memberIds: string[]; activity?: string }): string => JSON.stringify([g.name ?? "", g.memberIds, g.activity ?? "normal"]);

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

/** 面板里那张「云端运行」卡片：默认开着，只显示状态（没有开关） */
export function cloudCardHtml(info: CloudInfo, esc: (s: string) => string): string {
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
      <div class="bot-dim bot-cloud-line">${line}</div>
    </section>`;
}
