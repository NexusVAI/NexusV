// 移植自 cancri-code/src/bot/bot-thread.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Bot 会话线程的渲染（纯函数，DOM 由 bot-view 挂）。
 *
 * 气泡切分：Bot 的一段回复按空行切成几条短消息，像人发微信那样一条一条冒出来。
 * 但「简单介绍一下我自己：」后面紧跟的列表、代码块不能被切开 —— 见 `splitBubbles`。
 */
import { escapeAttr, escapeHtml } from "../core/escape";
import { renderMarkdown } from "../chat/render/markdown";
import type { BotChatMessage, BotProfile } from "./bot-store";

const LIST_START = /^\s*(?:[-*+]|\d+[.)])\s/;

export function splitBubbles(text: string): string[] {
  const parts = text.replace(/\r\n/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let fenceOpen = false;
  for (const part of parts) {
    const prev = out[out.length - 1];
    const joins = prev !== undefined && (
      fenceOpen ||
      LIST_START.test(part) ||
      /[：:]$/.test(prev) ||
      part.startsWith("|") ||
      part.startsWith(">") && prev.startsWith(">")
    );
    if (joins) out[out.length - 1] = `${prev}\n\n${part}`;
    else out.push(part);
    const fences = (part.match(/```/g) ?? []).length;
    if (fences % 2 === 1) fenceOpen = !fenceOpen;
  }
  return out;
}

/** 单行预览（引用 / 回复条 / 列表）：去掉 markdown 记号，只留读得懂的字 */
export function plainPreview(text: string, max = 80): string {
  return text
    .replace(/```[\s\S]*?```/g, " [代码] ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]+/g, "")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatStamp(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === today.toDateString()) return `今天 ${formatClock(ms)}`;
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${formatClock(ms)}`;
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${formatClock(ms)}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function renderBotText(text: string): string {
  return renderMarkdown(text, {
    fenceActions: false,
    tableActions: false,
    linkFilePaths: false,
    allowRelativeLinks: false,
    richUi: false,
  });
}

function renderUserText(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

const ICON_SMILE = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.3"/><circle cx="5.9" cy="6.6" r=".85" fill="currentColor"/><circle cx="10.1" cy="6.6" r=".85" fill="currentColor"/><path d="M5.3 9.4c.7 1.1 1.6 1.6 2.7 1.6s2-.5 2.7-1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const ICON_REPLY = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 4 3 7.5 6.5 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.4 7.5h5.4c2.4 0 4.2 1.7 4.2 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICON_MORE = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="12.5" cy="8" r="1.2" fill="currentColor"/></svg>`;
const ICON_PLAY = `<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.2" fill="currentColor" opacity=".16"/><path d="M6.4 5.1v5.8L11 8z" fill="currentColor"/></svg>`;
const ICON_FILE = `<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 1.8h5l3.2 3.2v8.2c0 .6-.5 1-1 1H4c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1.9V5h3.1" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

/** 附件大小：1.2 MB / 830 KB */
export function sizeLabel(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 没有文字的消息在列表预览 / 回复条 / 群聊转述里显示什么 */
export function attachmentLabel(m: Pick<BotChatMessage, "image" | "images" | "file">): string {
  if (m.image) return "[截图]";
  if (m.file) return m.file.kind === "video" ? "[录屏]" : `[文件] ${m.file.name}`;
  return m.images?.length ? "[图片]" : "";
}

/** Bot 发来的录屏 / 文件：录屏先出一个「播放」占位（点了才去取视频），文件是一张可点的条 */
export function fileHtml(f: NonNullable<BotChatMessage["file"]>): string {
  const size = sizeLabel(f.size);
  if (f.kind === "video") {
    const secs = f.durationMs ? Math.max(1, Math.round(f.durationMs / 1000)) : 0;
    const meta = [secs ? `${secs} 秒` : "", size].filter(Boolean).join(" · ");
    return `<button type="button" class="bot-msg-video" data-bot-video="${escapeAttr(f.id)}" data-mime="${escapeAttr(f.mime)}" title="播放录屏">${ICON_PLAY}<span class="bot-msg-file-text"><span class="bot-msg-file-name">播放录屏</span>${meta ? `<span class="bot-msg-file-meta">${escapeHtml(meta)}</span>` : ""}</span></button>`;
  }
  return `<button type="button" class="bot-msg-file" data-bot-file="${escapeAttr(f.id)}" title="保存「${escapeAttr(f.name)}」">${ICON_FILE}<span class="bot-msg-file-text"><span class="bot-msg-file-name">${escapeHtml(f.name)}</span>${size ? `<span class="bot-msg-file-meta">${escapeHtml(size)}</span>` : ""}</span></button>`;
}

/** 群聊里 Bot 消息的作者（单聊不需要：只有一个 Bot） */
export interface ThreadAuthor {
  id: string;
  name: string;
  hue: number;
  initial: string;
}

/**
 * 一条线程怎么渲染：单聊和群聊共用同一套气泡，区别只在名字从哪来、要不要作者头像。
 * 单聊用 `botScope`，群聊见 bot-group-render.ts。
 */
export interface ThreadScope {
  thread: BotChatMessage[];
  /** 引用 / 回复条里显示的名字 */
  nameOf(m: BotChatMessage): string;
  /** 用户消息正文；缺省 = 转义 + 换行 */
  userHtml?(text: string): string;
  /** 群聊：Bot 消息的作者 */
  author?(m: BotChatMessage): ThreadAuthor | null;
  /** 用户消息的已读回执；null = 不显示 */
  receipt?(m: BotChatMessage): ReceiptView | null;
  /** 表情是谁点的（群里每个 Bot 各点各的） */
  reactorName?(authorId: string | undefined): string;
}

export interface ReceiptView {
  state: "read" | "unread" | "partial";
  label: string;
  /** 悬停看谁读了 / 谁没读 */
  title: string;
}

/** 气泡左边那行小字：已读 / 未读 / N人已读 */
export function receiptHtml(r: ReceiptView | null): string {
  if (!r) return "";
  return `<span class="bot-receipt" data-state="${r.state}" title="${escapeAttr(r.title)}">${escapeHtml(r.label)}</span>`;
}

export function botScope(bot: BotProfile): ThreadScope {
  return {
    thread: bot.thread,
    nameOf: (m) => (m.role === "user" ? "你" : bot.name),
    receipt: (m) => singleReceipt(bot, m),
  };
}

/** 单聊：Bot 开始处理某条用户消息时把 readId 推到那条；它之前（含）的用户消息都算已读 */
export function singleReceipt(bot: BotProfile, m: BotChatMessage): ReceiptView | null {
  if (m.role !== "user") return null;
  const at = bot.thread.indexOf(m);
  const cur = bot.readId ? bot.thread.findIndex((x) => x.id === bot.readId) : -1;
  // 游标那条被截掉了（只留最近 N 条）：游标之前的都读过
  const read = !!bot.readId && (cur < 0 || cur >= at);
  return read
    ? { state: "read", label: "已读", title: `${bot.name} 已读` }
    : { state: "unread", label: "未读", title: `${bot.name} 还没看到` };
}

export function authorAvatarHtml(a: Pick<ThreadAuthor, "hue" | "initial" | "name">, size: "sm" | "md" = "md"): string {
  return `<span class="bot-author-avatar bot-author-avatar--${size}" data-hue="${a.hue}" title="${escapeAttr(a.name)}" aria-hidden="true">${escapeHtml(a.initial)}</span>`;
}

function quoteHtml(scope: ThreadScope, msg: BotChatMessage): string {
  if (!msg.replyTo) return "";
  const target = scope.thread.find((m) => m.id === msg.replyTo);
  const who = target ? scope.nameOf(target) : "";
  const text = target ? plainPreview(target.text) : "原消息已删除";
  return `<button type="button" class="bot-quote" data-bot-action="jump" data-id="${escapeAttr(msg.replyTo)}">${who ? `<b>${escapeHtml(who)}</b>` : ""}<span>${escapeHtml(text)}</span></button>`;
}

function reactionsHtml(scope: ThreadScope, msg: BotChatMessage): string {
  if (!msg.reactions?.length) return "";
  // 同一个表情合成一颗，带人数：群里三个 Bot 都点了 👍 显示「👍 3」
  const groups = new Map<string, { mine: boolean; who: string[] }>();
  for (const r of msg.reactions) {
    const g = groups.get(r.emoji) ?? { mine: false, who: [] };
    if (r.by === "user") { g.mine = true; g.who.push("你"); }
    else g.who.push(scope.reactorName?.(r.authorId) ?? "Bot");
    groups.set(r.emoji, g);
  }
  return `<span class="bot-reactions">${[...groups]
    .map(([emoji, g]) => `<button type="button" class="bot-reaction${g.mine ? " is-mine" : ""}" data-bot-action="react-toggle" data-id="${escapeAttr(msg.id)}" data-emoji="${escapeAttr(emoji)}" title="${escapeAttr(`${g.who.join("、")}${g.mine ? "（点击取消你的）" : ""}`)}">${escapeHtml(emoji)}${g.who.length > 1 ? `<span class="bot-reaction-count">${g.who.length}</span>` : ""}</button>`)
    .join("")}</span>`;
}

function toolsHtml(msg: BotChatMessage): string {
  return `<span class="bot-msg-tools" role="toolbar" aria-label="消息操作">
      <button type="button" class="bot-tool-btn" data-bot-action="react-open" data-id="${escapeAttr(msg.id)}" aria-label="添加表情" title="添加表情">${ICON_SMILE}</button>
      <button type="button" class="bot-tool-btn" data-bot-action="reply" data-id="${escapeAttr(msg.id)}" aria-label="回复" title="回复">${ICON_REPLY}</button>
      <button type="button" class="bot-tool-btn" data-bot-action="more" data-id="${escapeAttr(msg.id)}" aria-label="更多" title="更多">${ICON_MORE}</button>
    </span>`;
}

/**
 * `showAuthor`：群聊里同一作者连发只在第一条出头像和名字（Grok Bot 的 author run），
 * 后面几条留出同宽的空位，气泡左边对齐。
 */
export function renderMessage(scope: ThreadScope, msg: BotChatMessage, opts: { showAuthor?: boolean } = {}): string {
  if (msg.role === "event") {
    const ap = msg.approval;
    if (ap) {
      const id = escapeAttr(ap.id);
      const done: Record<string, string> = { approved: "已批准", denied: "已拒绝", expired: "已过期" };
      const tail =
        ap.status === "pending"
          ? `<span class="bot-approval-actions">
              <button type="button" class="bot-approval-btn is-primary" data-bot-action="cloud-approve" data-approval="${id}" data-scope="once">批准一次</button>
              <button type="button" class="bot-approval-btn" data-bot-action="cloud-approve" data-approval="${id}" data-scope="hour">一小时内都允许</button>
              <button type="button" class="bot-approval-btn" data-bot-action="cloud-deny" data-approval="${id}">拒绝</button>
            </span>`
          : `<span class="bot-approval-state">${done[ap.status] ?? ""}</span>`;
      return `<div class="bot-event bot-event-approval" data-msg-id="${escapeAttr(msg.id)}"><span>${escapeHtml(msg.text)}</span>${tail}</div>`;
    }
    return `<div class="bot-event" data-msg-id="${escapeAttr(msg.id)}">${escapeHtml(msg.text)}</div>`;
  }
  const side = msg.role === "user" ? "user" : "bot";
  const author = side === "bot" ? scope.author?.(msg) ?? null : null;
  const text = msg.role === "user" ? (scope.userHtml ?? renderUserText)(msg.text) : msg.text ? renderBotText(msg.text) : "";
  const pasted = (msg.images ?? [])
    .map((img) => `<img class="bot-msg-img" data-bot-img="${escapeAttr(img.id)}" alt="图片" title="点击放大查看">`)
    .join("");
  const body = msg.image?.id
    ? `<img class="bot-msg-img" data-bot-img="${escapeAttr(msg.image.id)}" alt="截图" title="点击放大查看">${text}`
    : msg.file?.id
      ? fileHtml(msg.file) + text
      : pasted + text;
  const retry = msg.error
    ? `<button type="button" class="bot-retry" data-bot-action="retry" data-id="${escapeAttr(msg.id)}">重试</button>`
    : "";
  const showAuthor = !!author && opts.showAuthor !== false;
  const wrap = `<div class="bot-bubble-wrap">
        <div class="bot-msg bot-msg--${side}${msg.error ? " is-error" : ""}" title="${escapeAttr(formatStamp(msg.at))}">${quoteHtml(scope, msg)}<div class="bot-msg-body">${body}</div>${retry}</div>
        ${reactionsHtml(scope, msg)}
      </div>`;
  // 单聊的 DOM 结构保持原样：气泡宽度上限是按父元素算的百分比，多包一层会变窄
  const main = author
    ? `<span class="bot-gutter">${showAuthor ? authorAvatarHtml(author) : ""}</span><div class="bot-bubble-col">${showAuthor ? `<div class="bot-author-name" data-hue="${author.hue}">${escapeHtml(author.name)}</div>` : ""}${wrap}</div>`
    : wrap;
  // 已读回执跟在气泡后面：用户行是 row-reverse，所以它落在气泡左边（微信 / 钉钉的位置）
  const receipt = side === "user" && !msg.error ? receiptHtml(scope.receipt?.(msg) ?? null) : "";
  return `<div class="bot-row bot-row--${side}${author ? " bot-row--authored" : ""}${showAuthor ? " is-run-start" : ""}${msg.reactions?.length ? " has-reactions" : ""}" data-msg-id="${escapeAttr(msg.id)}"${author ? ` data-author="${escapeAttr(author.id)}"` : ""}>
      ${main}
      ${receipt}
      ${toolsHtml(msg)}
    </div>`;
}

/** 这一条要不要另起一段作者：换了作者、隔了时间戳、或前一条不是 Bot 消息 */
export function startsAuthorRun(prev: BotChatMessage | undefined, msg: BotChatMessage, stamped: boolean): boolean {
  if (msg.role !== "bot") return false;
  return stamped || !prev || prev.role !== "bot" || prev.authorId !== msg.authorId;
}

/** 相邻两条隔超过这么久就插一个时间戳 */
const STAMP_GAP_MS = 30 * 60_000;
export const THREAD_PAGE = 160;

export function renderThread(scope: ThreadScope, limit: number, now: number = Date.now()): string {
  const all = scope.thread;
  const start = Math.max(0, all.length - limit);
  const parts: string[] = [];
  if (start > 0) {
    parts.push(`<button type="button" class="bot-load-more" data-bot-action="load-more">查看更早的 ${start} 条消息</button>`);
  }
  let prevAt = start > 0 ? all[start - 1].at : 0;
  for (let i = start; i < all.length; i++) {
    const m = all[i];
    const stamped = i === start || m.at - prevAt > STAMP_GAP_MS;
    if (stamped) {
      parts.push(`<div class="bot-stamp">${escapeHtml(formatStamp(m.at, now))}</div>`);
    }
    parts.push(renderMessage(scope, m, { showAuthor: startsAuthorRun(all[i - 1], m, stamped) }));
    prevAt = m.at;
  }
  return parts.join("");
}
