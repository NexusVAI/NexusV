// 移植自 cancri-code/src/bot/bot-group-render.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 群聊界面的 HTML（纯函数，DOM 由 bot-view 挂）。布局照 Grok Bot：
 *   · 新建：「收件人：」一栏，选进来的 Bot 变成 chip，下面是可选的 Bot 列表；选够两个就能「创建群聊」。
 *   · 列表 / 头部：成员头像叠在一起（最多 3 个）。
 *   · 线程：同一作者连发归成一段，第一条带头像和着色的名字。
 *   · 输入框打 @ 弹出可提及的成员，含「所有人」。
 *   · 群聊会多耗用量：建群页和群里顶部各有一条提示，后者可关。
 */
import { escapeAttr, escapeHtml } from "../core/escape";
import type { BotChatMessage, BotGroup, BotProfile } from "./bot-store";
import { attachmentLabel, authorAvatarHtml, plainPreview, type ReceiptView, type ThreadAuthor, type ThreadScope } from "./bot-thread";
import { ACTIVITY_LABEL, GROUP_ACTIVITIES, receiptFor } from "./bot-social";
import {
  EVERYONE_HANDLES,
  GROUP_MAX_MEMBERS,
  authorHue,
  buildMentionIndex,
  groupMembers,
  groupTitle,
  nameInitial,
  parseMentions,
} from "./bot-group";

export const GROUP_NOTICE = "群聊会消耗更多用量：每条消息都会由群里的多个 Bot 分别处理。大多数工作建议直接与单个 Bot 聊天。";

const ICON_CLOSE = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7m0-7l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_WARN = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.2 14.2 13H1.8L8 2.2Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.4v3.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11.3" r=".75" fill="currentColor"/></svg>`;
const ICON_PLUS = `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

export function authorOf(bot: Pick<BotProfile, "id" | "name">): ThreadAuthor {
  return { id: bot.id, name: bot.name, hue: authorHue(bot.id), initial: nameInitial(bot.name) };
}

/** 群里 @ 高亮：只认群成员和「所有人」 */
export function mentionTextHtml(text: string, members: BotProfile[]): string {
  const segs = parseMentions(text, buildMentionIndex(members));
  return segs
    .map((s) => s.type === "text"
      ? escapeHtml(s.value)
      : `<span class="bot-mention${s.id || s.everyone ? "" : " is-unknown"}">@${escapeHtml(s.label)}</span>`)
    .join("")
    .replace(/\n/g, "<br>");
}

export function groupScope(group: BotGroup, bots: BotProfile[]): ThreadScope {
  const members = groupMembers(group, bots);
  const find = (id: string | undefined) => (id ? bots.find((b) => b.id === id) : undefined);
  return {
    thread: group.thread,
    nameOf: (m) => (m.role === "user" ? "你" : find(m.authorId)?.name ?? "Bot"),
    userHtml: (text) => mentionTextHtml(text, members),
    author: (m) => {
      const b = find(m.authorId);
      // 已删除的 Bot：消息留着，作者显示成「已删除的 Bot」
      return b ? authorOf(b) : { id: m.authorId ?? "gone", name: "已删除的 Bot", hue: 0, initial: "?" };
    },
    receipt: (m) => groupReceipt(group, m, bots),
    reactorName: (id) => find(id)?.name ?? "Bot",
  };
}

/** 群里一条用户消息的回执：全员已读 / 未读 / N人已读（悬停看名单） */
export function groupReceipt(group: BotGroup, m: BotChatMessage, bots: BotProfile[]): ReceiptView | null {
  if (m.role !== "user") return null;
  const members = groupMembers(group, bots);
  if (!members.length) return null;
  const r = receiptFor(group.thread, m.id, members.map((b) => b.id), group.read ?? {});
  const names = (ids: string[]) => ids.map((id) => members.find((b) => b.id === id)?.name ?? "Bot").join("、");
  const title = [r.readBy.length ? `已读：${names(r.readBy)}` : "", r.unreadBy.length ? `未读：${names(r.unreadBy)}` : ""].filter(Boolean).join("\n");
  return { state: !r.unreadBy.length ? "read" : !r.readBy.length ? "unread" : "partial", label: r.label, title };
}

/** 群资料面板里的活跃度切换：安静 / 正常 / 热闹 */
export function activityPickerHtml(group: BotGroup): string {
  const cur = group.activity ?? "normal";
  return `<div class="bot-activity" role="radiogroup" aria-label="群活跃度">
      <span class="bot-activity-label">活跃度</span>
      ${GROUP_ACTIVITIES.map((a) => `<button type="button" role="radio" aria-checked="${a === cur}" class="bot-activity-opt${a === cur ? " is-on" : ""}" data-bot-action="group-activity" data-value="${a}">${ACTIVITY_LABEL[a]}</button>`).join("")}
    </div>`;
}

/** 成员头像叠在一起，最多 3 个；size 对应列表 / 头部胶囊 / 面板 */
export function avatarStackHtml(members: BotProfile[], size: "sm" | "md" | "xl"): string {
  const shown = members.slice(0, 3);
  return `<span class="bot-avatar-stack bot-avatar-stack--${size}" data-count="${shown.length}" aria-hidden="true">${shown
    .map((b) => `<span class="bot-author-avatar" data-hue="${authorHue(b.id)}">${escapeHtml(nameInitial(b.name))}</span>`)
    .join("")}</span>`;
}

export function groupNoticeHtml(dismissable: boolean): string {
  return `<div class="bot-group-notice" role="note">
      ${ICON_WARN}<span>${escapeHtml(GROUP_NOTICE)}</span>
      ${dismissable ? `<button type="button" class="bot-icon-btn" data-bot-action="group-notice-dismiss" aria-label="关闭群聊用量提示" title="关闭">${ICON_CLOSE}</button>` : ""}
    </div>`;
}

function lastLine(bot: BotProfile): string {
  const last = [...bot.thread].reverse().find((m) => m.role !== "event");
  return last ? plainPreview(last.text, 60) : "";
}

// ── 新建群聊 ────────────────────────────────────────────────────────────────

export interface NewGroupDraft {
  picked: string[];
  query: string;
  /** 键盘高亮的候选项下标 */
  cursor: number;
}

export type NewGroupOption = { kind: "bot"; bot: BotProfile } | { kind: "create"; name: string };

export function newGroupOptions(draft: NewGroupDraft, bots: BotProfile[]): NewGroupOption[] {
  const needle = draft.query.trim().toLowerCase();
  const opts: NewGroupOption[] = bots
    .filter((b) => !draft.picked.includes(b.id) && (!needle || b.name.toLowerCase().includes(needle)))
    .map((bot) => ({ kind: "bot", bot }));
  const typed = draft.query.trim().slice(0, 24);
  if (typed && !bots.some((b) => b.name.toLowerCase() === typed.toLowerCase())) opts.push({ kind: "create", name: typed });
  return opts;
}

/**
 * 新建页拆成几块分别更新：收件人输入框本身永远不重建 —— 换掉它会打断输入法组字，焦点和光标也会跳。
 */
export interface NewGroupParts {
  chips: string;
  list: string;
  footer: string;
  placeholder: string;
  full: boolean;
}

export function newGroupParts(draft: NewGroupDraft, bots: BotProfile[]): NewGroupParts {
  const picked = draft.picked.map((id) => bots.find((b) => b.id === id)).filter((b): b is BotProfile => !!b);
  const full = picked.length >= GROUP_MAX_MEMBERS;
  const chips = picked.map((b) => `
      <span class="bot-chip">${authorAvatarHtml(authorOf(b), "sm")}<span class="bot-chip-label">${escapeHtml(b.name)}</span><button type="button" class="bot-chip-remove" data-bot-action="group-new-remove" data-id="${escapeAttr(b.id)}" aria-label="移除 ${escapeAttr(b.name)}">${ICON_CLOSE}</button></span>`).join("");
  const opts = full ? [] : newGroupOptions(draft, bots);
  const cursor = Math.min(draft.cursor, Math.max(0, opts.length - 1));
  const list = opts.length
    ? opts.map((o, i) => o.kind === "bot"
        ? `<button type="button" role="option" class="bot-recipient-option${i === cursor ? " is-active" : ""}" aria-selected="${i === cursor}" data-bot-action="group-new-pick" data-id="${escapeAttr(o.bot.id)}">
            ${authorAvatarHtml(authorOf(o.bot))}
            <span class="bot-list-text"><span class="bot-list-name">${escapeHtml(o.bot.name)}</span><span class="bot-list-preview">${escapeHtml(lastLine(o.bot))}</span></span>
          </button>`
        : `<button type="button" role="option" class="bot-recipient-option${i === cursor ? " is-active" : ""}" aria-selected="${i === cursor}" data-bot-action="group-new-create" data-name="${escapeAttr(o.name)}">
            <span class="bot-author-avatar bot-author-avatar--new">${ICON_PLUS}</span>
            <span class="bot-list-text"><span class="bot-list-name">创建名为“${escapeHtml(o.name)}”的 Bot</span></span>
          </button>`).join("")
    : `<div class="bot-empty">${full ? `一个群最多 ${GROUP_MAX_MEMBERS} 个 Bot` : draft.query.trim() ? "没有匹配的 Bot" : "所有 Bot 都已添加"}</div>`;
  const footer = `
        <span class="bot-newgroup-hint">${picked.length < 2 ? "至少选两个 Bot" : `${picked.length} 个 Bot`}</span>
        <button type="button" class="bot-btn bot-btn--primary" data-bot-action="group-create" ${picked.length < 2 ? "disabled" : ""}>创建群聊</button>`;
  return { chips, list, footer, placeholder: picked.length ? "" : "输入 Bot 名字", full };
}

export function renderNewGroup(draft: NewGroupDraft, bots: BotProfile[]): string {
  const parts = newGroupParts(draft, bots);
  return `
    <header class="bot-convo-head bot-newgroup-head">
      <span class="bot-newgroup-title">新建群聊</span>
      <button type="button" class="bot-icon-btn bot-icon-btn--round bot-newgroup-close" data-bot-action="group-new-cancel" aria-label="关闭新聊天" title="关闭">${ICON_CLOSE}</button>
    </header>
    <div class="bot-newgroup">
      <div class="bot-recipients" data-bot-action="group-new-focus">
        <span class="bot-recipients-label">收件人：</span>
        <span class="bot-recipient-chips" data-bot-chips>${parts.chips}</span>
        <input class="bot-recipients-input" type="text" data-bot-recipient-input value="${escapeAttr(draft.query)}" placeholder="${parts.placeholder}" aria-label="收件人" role="combobox" aria-expanded="true" autocomplete="off" ${parts.full ? "disabled" : ""} />
      </div>
      <div class="bot-recipient-list" role="listbox" aria-label="Bot" data-bot-recipient-list>${parts.list}</div>
      ${groupNoticeHtml(false)}
      <div class="bot-newgroup-actions" data-bot-newgroup-footer>${parts.footer}</div>
    </div>`;
}

// ── 群资料面板 ──────────────────────────────────────────────────────────────

export function renderGroupPanel(group: BotGroup, bots: BotProfile[], tab: "members" | "computer", computerBody: string): string {
  const members = groupMembers(group, bots);
  const canRemove = members.length > 2;
  const rows = members.map((b) => `
      <div class="bot-member-row">
        ${authorAvatarHtml(authorOf(b))}
        <span class="bot-list-text"><span class="bot-list-name">${escapeHtml(b.name)}</span><span class="bot-list-preview">${escapeHtml(b.tags.join("、") || lastLine(b))}</span></span>
        <button type="button" class="bot-btn bot-btn--ghost bot-btn--sm" data-bot-action="select" data-id="${escapeAttr(b.id)}" title="和 ${escapeAttr(b.name)} 单聊">单聊</button>
        ${canRemove ? `<button type="button" class="bot-icon-btn" data-bot-action="group-member-remove" data-id="${escapeAttr(b.id)}" aria-label="移除 ${escapeAttr(b.name)}" title="移出群聊">${ICON_CLOSE}</button>` : ""}
      </div>`).join("");
  const body = tab === "computer"
    ? computerBody
    : `
      <section class="bot-section">
        <div class="bot-section-head"><span>成员</span><span class="bot-dim">${members.length} 个 Bot</span></div>
        <div class="bot-member-list">${rows}</div>
        ${members.length < GROUP_MAX_MEMBERS ? `<button type="button" class="bot-btn bot-btn--ghost bot-btn--sm bot-member-add" data-bot-action="group-member-add">${ICON_PLUS}<span>添加成员</span></button>` : ""}
      </section>
      <section class="bot-section">
        ${activityPickerHtml(group)}
      </section>
      <section class="bot-section bot-group-danger">
        <button type="button" class="bot-btn bot-btn--ghost bot-btn--sm" data-bot-action="group-clear">清空聊天记录</button>
        <button type="button" class="bot-btn bot-btn--ghost bot-btn--sm is-danger" data-bot-action="group-delete">删除群聊</button>
      </section>`;
  return `
    <div class="bot-panel-top">
      <button type="button" class="bot-icon-btn bot-icon-btn--round" data-bot-action="panel-close" aria-label="关闭面板">${ICON_CLOSE}</button>
    </div>
    <div class="bot-panel-hero">
      ${avatarStackHtml(members, "xl")}
      <button type="button" class="bot-panel-name" data-bot-action="group-rename" title="改群名">${escapeHtml(groupTitle(group, bots))}</button>
      <span class="bot-dim">群聊</span>
    </div>
    <div class="bot-tabs" role="tablist">
      ${([["members", "成员"], ["computer", "电脑"]] as const).map(([key, label]) => `<button type="button" role="tab" class="bot-tab${key === tab ? " is-active" : ""}" aria-selected="${key === tab}" data-bot-action="panel-tab" data-tab="${key === "members" ? "details" : "computer"}">${label}</button>`).join("")}
    </div>
    <div class="bot-panel-body" data-tab-body="${tab}">${body}</div>`;
}

/** 「添加成员」弹层：还不在群里的 Bot */
export function groupAddMenuHtml(group: BotGroup, bots: BotProfile[]): string {
  const rest = bots.filter((b) => !group.memberIds.includes(b.id));
  if (!rest.length) return `<div class="bot-pop-menu"><span class="bot-pop-empty">所有 Bot 都已在群里</span></div>`;
  return `<div class="bot-pop-menu">${rest
    .map((b) => `<button type="button" data-bot-action="group-member-pick" data-id="${escapeAttr(b.id)}">${authorAvatarHtml(authorOf(b), "sm")}<span>${escapeHtml(b.name)}</span></button>`)
    .join("")}</div>`;
}

// ── @ 提及菜单 ──────────────────────────────────────────────────────────────

export type MentionOption = { kind: "everyone" } | { kind: "bot"; bot: BotProfile };

export function mentionOptions(query: string, members: BotProfile[]): MentionOption[] {
  const q = query.trim().toLowerCase();
  const bots: MentionOption[] = members
    .filter((b) => !q || b.name.toLowerCase().includes(q) || b.name.toLowerCase().replace(/\s+/g, "").includes(q))
    .map((bot) => ({ kind: "bot", bot }));
  const everyone = !q || EVERYONE_HANDLES.some((h) => h.startsWith(q));
  return everyone ? [{ kind: "everyone" }, ...bots] : bots;
}

export function mentionInsertText(opt: MentionOption): string {
  return opt.kind === "everyone" ? "所有人" : opt.bot.name;
}

export function mentionMenuHtml(opts: MentionOption[], cursor: number): string {
  if (!opts.length) return `<div class="bot-mention-head">提及</div><div class="bot-empty">暂无可提及的对象</div>`;
  return `<div class="bot-mention-head">提及</div>${opts
    .map((o, i) => `<button type="button" role="option" class="bot-mention-option${i === cursor ? " is-active" : ""}" aria-selected="${i === cursor}" data-bot-action="mention-pick" data-index="${i}">${o.kind === "everyone"
      ? `<span class="bot-author-avatar bot-author-avatar--sm bot-author-avatar--all">@</span><span class="bot-mention-name">所有人</span><span class="bot-dim">通知群里所有 Bot</span>`
      : `${authorAvatarHtml(authorOf(o.bot), "sm")}<span class="bot-mention-name">${escapeHtml(o.bot.name)}</span>`}</button>`)
    .join("")}`;
}

/** 输入框里光标前面那段「@xxx」：还在输入提及就返回它的起点和关键字 */
export function mentionQueryAt(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const m = /(^|[^a-zA-Z0-9])@([^\s@]{0,24})$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}

/** 列表预览：群里最后一条，带上是谁说的 */
export function groupPreview(group: BotGroup, bots: BotProfile[]): string {
  const last = [...group.thread].reverse().find((m: BotChatMessage) => m.role !== "event");
  if (!last) return `${groupMembers(group, bots).length} 个 Bot`;
  const who = last.role === "user" ? "你" : bots.find((b) => b.id === last.authorId)?.name ?? "Bot";
  const text = plainPreview(last.text, 120) || attachmentLabel(last);
  return `${who}：${text}`;
}
