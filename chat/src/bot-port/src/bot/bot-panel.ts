// 移植自 cancri-code/src/bot/bot-panel.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Bot 右侧信息面板（详情 / 资料库 / 电脑）与全屏电脑画面。
 *
 * 面板只出 HTML；点击统一由 bot-view 的 `[data-bot-action]` 委托处理。
 * 画面（canvas + ScreenStream）是长生命周期的：面板重绘时把 canvas 节点搬回新插槽，
 * 不重连 socket（与 chat-mascot 的 adopt 同一个思路）。
 */
import { escapeAttr, escapeHtml } from "../core/escape";
import { NOTE_KINDS, SELF_BLOCK_MAX, USER_BLOCK_MAX, type BotNote, type BotProfile } from "./bot-store";
import { ScreenStream, type ComputerView, type ScreenState } from "./bot-computer";
import type { SandboxTrialQuota, SandboxTrialWindow } from "../sandbox/backend";
// 试用额度卡片的图标取自 Codex 自绘图标集（见 src/ui/codex-menu-icons.ts 文件头），尺寸由 CSS 定。
import QUOTA_GAUGE_RAW from "../../tasks/_codex-icons/svg/custom/app-initial-219.svg?raw";
import QUOTA_CLOCK_RAW from "../../tasks/_codex-icons/svg/custom/app-initial-12.svg?raw";
import QUOTA_WEEK_RAW from "../../tasks/_codex-icons/svg/custom/app-initial-117.svg?raw";

export type PanelTab = "details" | "library" | "computer";

const KIND_LABEL: Record<BotNote["kind"], string> = { fact: "事实", preference: "偏好", todo: "待办", event: "事件" };

const ICON_EXPAND = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CLOSE = `<svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_SHRINK = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5 14 2M6.5 9.5 2 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_HAND = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 8V3.2a1 1 0 0 1 2 0V7m0-.5V2.4a1 1 0 0 1 2 0V7m0-.5V3.4a1 1 0 0 1 2 0v5.4c0 2.6-1.8 4.7-4.4 4.7-1.6 0-2.7-.7-3.6-2L2.4 8.8a1 1 0 0 1 1.6-1.2l1.5 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const PHASE_LABEL: Record<ComputerView["phase"], string> = {
  off: "已关机",
  starting: "开机中…",
  running: "运行中",
  paused: "休眠中",
  unavailable: "不可用",
};

function daysSince(ms: number, now: number): number {
  return Math.max(1, Math.ceil((now - ms) / 86_400_000));
}

function detailsHtml(bot: BotProfile, now: number): string {
  const msgs = bot.thread.filter((m) => m.role !== "event").length;
  return `
    <div class="bot-stats">
      <span><b>${daysSince(bot.createdAt, now)}</b>天</span>
      <span><b>${msgs}</b>条消息</span>
      <span><b>${bot.notes.length}</b>条记忆</span>
    </div>
    <label class="bot-field">
      <span class="bot-field-head">关于我<em>${bot.memory.self.length}/${SELF_BLOCK_MAX}</em></span>
      <textarea class="bot-textarea" data-bot-memory="self" maxlength="${SELF_BLOCK_MAX}" rows="5" placeholder="${escapeAttr(bot.name)} 会自己补充这里的内容，也可以直接填写">${escapeHtml(bot.memory.self)}</textarea>
    </label>
    <label class="bot-field">
      <span class="bot-field-head">关于你<em>${bot.memory.user.length}/${USER_BLOCK_MAX}</em></span>
      <textarea class="bot-textarea" data-bot-memory="user" maxlength="${USER_BLOCK_MAX}" rows="6" placeholder="聊天中提到的信息会自动记录在这里，也可以直接填写">${escapeHtml(bot.memory.user)}</textarea>
    </label>
    <div class="bot-danger">
      <button type="button" class="bot-btn bot-btn--ghost" data-bot-action="clear-thread">清空聊天记录</button>
      <button type="button" class="bot-btn bot-btn--danger" data-bot-action="delete-bot">删除 ${escapeHtml(bot.name)}</button>
    </div>`;
}

function libraryHtml(bot: BotProfile): string {
  const groups = NOTE_KINDS.map((kind) => {
    const notes = bot.notes
      .filter((n) => n.kind === kind)
      .sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || b.updatedAt - a.updatedAt);
    if (!notes.length) return "";
    return `<section class="bot-lib-group">
        <h4>${KIND_LABEL[kind]}<em>${notes.length}</em></h4>
        ${notes.map((n) => `
          <div class="bot-note${n.status === "done" ? " is-done" : ""}">
            ${kind === "todo"
              ? `<button type="button" class="bot-note-check" data-bot-action="note-toggle" data-id="${escapeAttr(n.id)}" aria-label="${n.status === "done" ? "标为未完成" : "标为完成"}" aria-pressed="${n.status === "done"}"></button>`
              : ""}
            <span class="bot-note-text">${escapeHtml(n.text)}${n.date ? `<time>${escapeHtml(n.date)}</time>` : ""}</span>
            <button type="button" class="bot-icon-btn bot-note-del" data-bot-action="note-delete" data-id="${escapeAttr(n.id)}" aria-label="删除这条">${ICON_CLOSE}</button>
          </div>`).join("")}
      </section>`;
  }).join("");
  return `
    <form class="bot-note-add" data-bot-form="note">
      <select class="bot-select" name="kind" aria-label="类型">${NOTE_KINDS.map((k) => `<option value="${k}">${KIND_LABEL[k]}</option>`).join("")}</select>
      <input class="bot-input" name="text" maxlength="500" placeholder="添加一条记忆" autocomplete="off" />
      <button type="submit" class="bot-btn bot-btn--primary bot-btn--sm">添加</button>
    </form>
    ${groups || `<div class="bot-empty">还没有记忆。聊天中提到的事实、偏好和待办会自动记录在这里。</div>`}`;
}

const codexIcon = (raw: string, name: string): string =>
  raw.replace("<svg ", `<svg aria-hidden="true" data-codex-icon-name="${name}" `);
const ICON_QUOTA = codexIcon(QUOTA_GAUGE_RAW, "app-initial-219");
const ICON_QUOTA_WINDOW = codexIcon(QUOTA_CLOCK_RAW, "app-initial-12");
const ICON_QUOTA_WEEK = codexIcon(QUOTA_WEEK_RAW, "app-initial-117");

/** 秒 → 积分。换算率来自服务端（`points_per_hour`），客户端不留第二份。 */
export function toPoints(seconds: number, pointsPerHour: number): number {
  return Math.round((seconds * pointsPerHour) / 3600);
}

function resetLabel(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (ms: number): number => new Date(ms).setHours(0, 0, 0, 0);
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  if (diff === 0) return `今天 ${hm}`;
  if (diff === 1) return `明天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function quotaRow(label: string, icon: string, w: SandboxTrialWindow, pph: number, idleNote: string, now: number): string {
  const total = toPoints(w.quotaSeconds, pph);
  const used = Math.min(toPoints(w.usedSeconds, pph), total);
  const left = total - used;
  const pct = total > 0 ? Math.round((used / total) * 100) : 100;
  const out = left <= 0;
  // 窗口到点但服务端还没归一化（下一次 status 才清零）时，别显示一个已经过去的重置时刻
  const resets = w.resetsAt !== null && w.resetsAt > now ? w.resetsAt : null;
  const sub = resets !== null ? `${resetLabel(resets, now)} 重置` : idleNote;
  return `
      <div class="bot-quota-row${out ? " is-out" : ""}">
        <span class="bot-quota-icon">${icon}</span>
        <div class="bot-quota-main">
          <div class="bot-quota-line">
            <span class="bot-quota-label">${label}</span>
            <span class="bot-quota-num">${out ? "已用完" : `剩余 <b>${left.toLocaleString("en-US")}</b>`}<em> / ${total.toLocaleString("en-US")} 积分</em></span>
          </div>
          <div class="bot-quota-bar" role="progressbar" aria-label="${label}已用" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
          ${sub ? `<div class="bot-quota-sub">${escapeHtml(sub)}</div>` : ""}
        </div>
      </div>`;
}

/** 免费计划用户的云电脑试用额度卡片：两行，每 5 小时 / 每周。 */
function quotaCardHtml(q: Extract<SandboxTrialQuota, { eligible: true }>, now: number): string {
  return `
    <section class="bot-quota" aria-label="云电脑免费额度">
      <div class="bot-quota-head">
        <span class="bot-quota-icon">${ICON_QUOTA}</span>
        <span class="bot-quota-title">免费额度</span>
        <span class="bot-quota-badge">限时试用</span>
      </div>
      ${quotaRow("每 5 小时", ICON_QUOTA_WINDOW, q.window, q.pointsPerHour, "首次使用后开始计时", now)}
      ${quotaRow("每周", ICON_QUOTA_WEEK, q.week, q.pointsPerHour, "", now)}
    </section>`;
}

function computerHtml(bot: BotProfile, view: ComputerView, quota: SandboxTrialQuota | null, now: number): string {
  const live = view.phase === "running";
  const power = view.phase === "off"
    ? `<button type="button" class="bot-btn bot-btn--primary bot-btn--sm" data-bot-action="pc-start">开机</button>`
    : view.phase === "paused"
      ? `<button type="button" class="bot-btn bot-btn--primary bot-btn--sm" data-bot-action="pc-wake">唤醒</button>
         <button type="button" class="bot-btn bot-btn--ghost bot-btn--sm" data-bot-action="pc-stop">关机</button>`
      : view.phase === "running"
        ? `<button type="button" class="bot-btn bot-btn--ghost bot-btn--sm" data-bot-action="pc-sleep">休眠</button>
           <button type="button" class="bot-btn bot-btn--ghost bot-btn--sm" data-bot-action="pc-stop">关机</button>`
        : "";
  const minutes = Math.round(view.billedSeconds / 60);
  return `
    <div class="bot-pc-preview${live ? " is-live" : ""}" data-pc-slot="preview">
      <span class="bot-pc-hint" data-pc-hint>${live ? "正在连接画面…" : PHASE_LABEL[view.phase]}</span>
      ${live ? `<button type="button" class="bot-pc-open" data-bot-action="pc-open">${ICON_EXPAND}<span>打开</span></button>` : ""}
    </div>
    <div class="bot-pc-caption">${escapeHtml(bot.name)} 的屏幕</div>
    <div class="bot-pc-status">
      <span class="bot-dot bot-dot--${view.phase}"></span>
      <span>${PHASE_LABEL[view.phase]}${view.billedSeconds > 0 ? `，本次已用 ${minutes} 分钟` : ""}</span>
    </div>
    ${view.error ? `<div class="bot-pc-error">${escapeHtml(view.error)}</div>` : ""}
    <div class="bot-pc-actions">${power}</div>
    ${quota?.eligible === false ? `<p class="bot-hint">按使用时长计费，计入你的套餐。</p>` : ""}
    ${quota?.eligible === true ? quotaCardHtml(quota, now) : ""}`;
}

/**
 * `quota`：null = 还不知道（没查到 / 老网关），此时既不说「计入套餐」也不画卡片 ——
 * ⛔ 不知道就别猜，猜错一边就是对免费用户说「扣你套餐」或对付费用户画试用卡。
 */
export function renderPanelTags(tags: string[]): string {
  return `${tags.map((t) => `<span class="bot-tag">${escapeHtml(t)}<button type="button" data-bot-action="tag-remove" data-tag="${escapeAttr(t)}" aria-label="移除标签">${ICON_CLOSE}</button></span>`).join("")}${tags.length < 8 ? `<button type="button" class="bot-tag-add" data-bot-action="tag-add">添加标签</button>` : ""}`;
}

export function renderPanelBody(bot: BotProfile, tab: PanelTab, view: ComputerView, now: number = Date.now(), quota: SandboxTrialQuota | null = null): string {
  return tab === "details" ? detailsHtml(bot, now) : tab === "library" ? libraryHtml(bot) : computerHtml(bot, view, quota, now);
}

export function renderPanel(bot: BotProfile, tab: PanelTab, view: ComputerView, now: number = Date.now(), quota: SandboxTrialQuota | null = null): string {
  const tabs: Array<[PanelTab, string]> = [["details", "详情"], ["library", "记忆"], ["computer", "电脑"]];
  const body = renderPanelBody(bot, tab, view, now, quota);
  return `
    <div class="bot-panel-top">
      <button type="button" class="bot-icon-btn bot-icon-btn--round" data-bot-action="panel-close" aria-label="关闭面板">${ICON_CLOSE}</button>
    </div>
    <div class="bot-panel-hero">
      <span class="bot-avatar bot-avatar--xl"><span class="bot-cloud bot-cloud--xl" data-bot-cloud="panel"></span></span>
      <button type="button" class="bot-panel-name" data-bot-action="rename" title="改名">${escapeHtml(bot.name)}</button>
      <div class="bot-tags">
        ${renderPanelTags(bot.tags)}
      </div>
    </div>
    <div class="bot-tabs" role="tablist">
      ${tabs.map(([key, label]) => `<button type="button" role="tab" class="bot-tab${key === tab ? " is-active" : ""}" aria-selected="${key === tab}" data-bot-action="panel-tab" data-tab="${key}">${label}</button>`).join("")}
    </div>
    <div class="bot-panel-body" data-tab-body="${tab}">${body}</div>`;
}

export function renderScreenOverlay(botName: string, view: ComputerView): string {
  const control = view.userControl
    ? `<div class="bot-screen-bar is-control">${ICON_HAND}<span>你正在控制</span><button type="button" class="bot-screen-bar-btn" data-bot-action="pc-release">结束控制</button></div>`
    : `<div class="bot-screen-bar"><span class="bot-dot bot-dot--${view.phase}"></span><span>${escapeHtml(botName)} 的电脑</span><span class="bot-screen-bar-note">${PHASE_LABEL[view.phase]}</span>${view.phase === "running" ? `<button type="button" class="bot-screen-bar-btn" data-bot-action="pc-control">开始控制</button>` : ""}</div>`;
  return `
    <div class="bot-screen-top">
      <button type="button" class="bot-screen-icon" data-bot-action="pc-close" aria-label="退出全屏" title="退出全屏">${ICON_SHRINK}</button>
    </div>
    <div class="bot-screen-stage" data-pc-slot="full">
      <span class="bot-pc-hint bot-pc-hint--full" data-pc-hint></span>
    </div>
    ${control}`;
}

/**
 * 管理两个画面插槽（面板预览 / 全屏）。同一时刻只连一路：全屏打开时预览暂停，
 * 省一半带宽，也免得两个 socket 抢着 ack 帧。
 */
export class ScreenHost {
  private canvas: HTMLCanvasElement | null = null;
  private stream: ScreenStream | null = null;
  private slot: "preview" | "full" | null = null;
  private state: ScreenState = "waiting";
  private detail = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly onUserInput: () => void = () => {},
    /** 画面连哪台：每个 Bot / 群一台电脑之后，由会话决定（缺省 = IDE 那台共用的） */
    private readonly sessionId?: () => string | null,
  ) {}

  /** 每次面板 / 全屏重绘后调：把 canvas 搬进当前该显示的插槽，没有插槽就断开 */
  sync(running: boolean, interactive: boolean): void {
    const full = this.root.querySelector<HTMLElement>('[data-pc-slot="full"]');
    const preview = this.root.querySelector<HTMLElement>('[data-pc-slot="preview"]');
    const target = full ?? preview;
    const which = full ? "full" : preview ? "preview" : null;
    if (!running || !target || !which) {
      this.disconnect();
      return;
    }
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "bot-pc-canvas";
      this.canvas.setAttribute("aria-label", "云电脑画面");
    }
    if (this.canvas.parentElement !== target) target.prepend(this.canvas);
    this.slot = which;
    if (!this.stream) {
      this.stream = new ScreenStream(this.canvas, (s, detail) => {
        this.state = s;
        this.detail = detail ?? "";
        this.paintHint();
      }, undefined, this.sessionId, this.onUserInput);
    }
    this.stream.setInteractive(interactive && which === "full");
    this.paintHint();
  }

  private paintHint(): void {
    const slot = this.slot ? this.root.querySelector<HTMLElement>(`[data-pc-slot="${this.slot}"]`) : null;
    const hint = slot?.querySelector<HTMLElement>("[data-pc-hint]");
    slot?.classList.toggle("has-frame", this.state === "live");
    if (!hint) return;
    hint.hidden = this.state === "live";
    hint.textContent = this.state === "connecting" ? "正在连接画面…" : this.detail || "等待画面…";
  }

  disconnect(): void {
    this.stream?.dispose();
    this.stream = null;
    this.canvas?.remove();
    this.canvas = null;
    this.slot = null;
    this.state = "waiting";
  }
}
