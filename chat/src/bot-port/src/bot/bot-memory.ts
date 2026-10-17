// 移植自 cancri-code/src/bot/bot-memory.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Bot 记忆 → 模型上下文。
 *
 * 走 `contextAddendum`（普通消息）而不是 system：网关会把 system 静默砍到 1500 字
 * （system-prompt.ts `GATEWAY_SYSTEM_PROMPT_MAX_LEN`），记忆一多就整段丢。
 * 记忆正文来自模型自己写的东西和用户聊天，属于不可信文本 —— 一律过
 * `neutralizeControlTags`，防止有人在聊天里塞一段假的控制标签。
 */
import { neutralizeControlTags } from "../core/control-tags";
import { selectRelevantMemories } from "../memory-relevance";
import type { BotChatMessage, BotNote, BotProfile } from "./bot-store";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const NOTE_KIND_LABEL: Record<BotNote["kind"], string> = {
  fact: "事实",
  preference: "偏好",
  todo: "待办",
  event: "事件",
};

export function formatLocalTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 周${WEEKDAYS[d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatGap(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 2) return "刚刚";
  if (min < 60) return `${min} 分钟`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} 小时`;
  return `${Math.round(h / 24)} 天`;
}

export function noteLine(n: BotNote): string {
  const status = n.kind === "todo" ? (n.status === "done" ? "·已完成" : "·未完成") : "";
  const date = n.date ? ` ${n.date}` : "";
  return `[${n.id.slice(0, 8)}] (${NOTE_KIND_LABEL[n.kind]}${status}${date}) ${n.text}`;
}

function relevantNotes(bot: BotProfile, query: string): BotNote[] {
  const items = bot.notes
    // 已完成的待办只在被问到时才有用，平时不占位
    .filter((n) => !(n.kind === "todo" && n.status === "done"))
    .map((n) => ({ ...n, content: n.text, source: n.kind === "preference" ? "user" : "ai", updatedAt: n.updatedAt }));
  const openTodos = items.filter((n) => n.kind === "todo");
  const picked = selectRelevantMemories(items, query, { maxItems: 12, maxChars: 1800, pinnedUser: 4 });
  const seen = new Set(picked.map((n) => n.id));
  return [...picked, ...openTodos.filter((n) => !seen.has(n.id)).slice(0, 6)];
}

export interface BotContextInput {
  bot: BotProfile;
  userText: string;
  now: number;
  /** 上一条用户消息的时间（不含本条），用来告诉 Bot「隔了多久」 */
  previousUserAt: number | null;
  computerLine: string;
  /** 用户自上次以来给消息点的表情 */
  reactionLines: string[];
}

export function buildBotContext(input: BotContextInput): string {
  const { bot, now } = input;
  const notes = relevantNotes(bot, input.userText);
  const lines = [
    "<bot-memory>",
    `现在：${formatLocalTime(now)}`,
    input.previousUserAt
      ? `距离用户上一条消息：${formatGap(now - input.previousUserAt)}`
      : "这是你们第一次真正聊天。",
    `你的电脑：${input.computerLine}`,
    "",
    "## 关于我（你自己写的，可用 memory_edit 改）",
    neutralizeControlTags(bot.memory.self || "（空）"),
    "",
    "## 关于用户（你自己写的，可用 memory_edit 改）",
    neutralizeControlTags(bot.memory.user || "（还不了解，聊天中留心记下来）"),
  ];
  if (notes.length) {
    lines.push("", `## 记事本（共 ${bot.notes.length} 条，下面是相关的；更多用 memory_search）`);
    for (const n of notes) lines.push(neutralizeControlTags(noteLine(n)));
  }
  if (input.reactionLines.length) {
    lines.push("", "## 用户刚给消息点了表情");
    for (const r of input.reactionLines) lines.push(neutralizeControlTags(r));
  }
  lines.push("</bot-memory>");
  return lines.join("\n");
}

export interface MemoryHit {
  kind: "note" | "chat";
  at: number;
  text: string;
}

/** `memory_search`：记事本 + 完整聊天线程一起按相关性排。 */
export function searchBotMemory(bot: BotProfile, query: string, limit = 8): MemoryHit[] {
  const pool = [
    ...bot.notes.map((n) => ({ content: n.text, source: "ai", updatedAt: n.updatedAt, hit: { kind: "note" as const, at: n.updatedAt, text: noteLine(n) } })),
    ...bot.thread
      .filter((m): m is BotChatMessage => m.role !== "event" && !m.error)
      .map((m) => ({
        content: m.text,
        source: "ai",
        updatedAt: m.at,
        hit: { kind: "chat" as const, at: m.at, text: `${m.role === "user" ? "用户" : "我"}：${m.text.slice(0, 280)}` },
      })),
  ];
  return selectRelevantMemories(pool, query, { maxItems: limit, maxChars: 3600, pinnedUser: 0 }).map((x) => x.hit);
}
