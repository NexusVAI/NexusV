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
import { uuidv4 } from "../core/id";
import { DIARY_MAX, USER_BLOCK_MAX, type BotChatMessage, type BotNote, type BotProfile } from "./bot-store";

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
  const diary = bot.diary?.slice(-2) ?? [];
  if (diary.length) {
    lines.push("", "## 你最近的日记（更早的用 memory_search）");
    for (const d of diary) lines.push(neutralizeControlTags(`${d.date}：${d.text.slice(0, 300)}`));
  }
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
  kind: "note" | "chat" | "diary";
  at: number;
  text: string;
}

/** `memory_search`：记事本 + 完整聊天线程一起按相关性排。 */
export function searchBotMemory(bot: BotProfile, query: string, limit = 8): MemoryHit[] {
  const pool = [
    ...bot.notes.map((n) => ({ content: n.text, source: "ai", updatedAt: n.updatedAt, hit: { kind: "note" as const, at: n.updatedAt, text: noteLine(n) } })),
    ...(bot.diary ?? []).map((d) => {
      const at = new Date(`${d.date}T23:59:00`).getTime() || 0;
      return { content: d.text, source: "ai", updatedAt: at, hit: { kind: "diary" as const, at, text: `[日记 ${d.date}] ${d.text}` } };
    }),
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

// ── 每日日记：本地 0 点（错过了就下次打开时补）总结前一天，写日记、补记忆条、更新「关于你」 ──

/** 一天少于这么多条消息不写 */
export const DIARY_MIN_MESSAGES = 10;
const NOTES_PER_DAY = 5;
const TRANSCRIPT_MAX = 12_000;

export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 下一个本地 0 点 */
export function nextMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function messagesOn(thread: BotChatMessage[], day: string): BotChatMessage[] {
  return thread.filter((m) => m.role !== "event" && !m.error && m.text.trim() && dayKey(m.at) === day);
}

/** 该写哪天的日记：昨天聊得够多、还没写过 → 昨天；否则 null */
export function diaryDayDue(bot: BotProfile, threads: BotChatMessage[][], now: number): string | null {
  const yesterday = dayKey(new Date(now).setHours(0, 0, 0, 0) - 1);
  if (bot.diary?.some((d) => d.date === yesterday)) return null;
  const n = threads.reduce((sum, t) => sum + messagesOn(t, yesterday).length, 0);
  return n >= DIARY_MIN_MESSAGES ? yesterday : null;
}

export const DIARY_SYSTEM = `你是一个私人助理 Bot，现在在一天结束时回顾当天的聊天。只输出一个 JSON 对象，不要别的文字：
{"diary":"第一人称日记，150字以内：今天做了什么、和用户聊了什么、你的感受","notes":["用户必须记住的关键信息，每条一句，最多5条，没有就空数组"],"user":"重写后的「关于用户」：保留原有内容，补充今天了解到的，并概括用户的性格和沟通习惯（比如是否容易不耐烦、喜欢简短还是详细），${USER_BLOCK_MAX}字以内"}
不要记录密码、密钥、验证码等敏感信息。`;

export function buildDiaryPrompt(bot: BotProfile, threads: Array<{ label: string; thread: BotChatMessage[] }>, day: string): string {
  const lines: string[] = [];
  for (const t of threads) {
    const msgs = messagesOn(t.thread, day);
    if (!msgs.length) continue;
    lines.push(`## ${t.label}`);
    for (const m of msgs) lines.push(`${m.role === "user" ? "用户" : "我"}：${m.text.slice(0, 400)}`);
  }
  const transcript = lines.join("\n").slice(-TRANSCRIPT_MAX);
  const known = bot.notes.slice(-30).map((n) => `- ${n.text}`).join("\n");
  return [
    `你叫${bot.name}，日期 ${day}。`,
    `现在的「关于用户」：\n${bot.memory.user || "（空）"}`,
    `已有的记忆条（别重复）：\n${known || "（无）"}`,
    `当天的聊天：\n${transcript}`,
  ].map(neutralizeControlTags).join("\n\n");
}

export interface DiaryResult {
  diary: string;
  notes: string[];
  user: string;
}

export function parseDiary(raw: string): DiaryResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const diary = typeof o.diary === "string" ? o.diary.trim() : "";
    if (!diary) return null;
    return {
      diary: diary.slice(0, 600),
      notes: Array.isArray(o.notes) ? o.notes.filter((x): x is string => typeof x === "string" && !!x.trim()).slice(0, NOTES_PER_DAY).map((x) => x.trim().slice(0, 500)) : [],
      user: typeof o.user === "string" ? o.user.trim().slice(0, USER_BLOCK_MAX) : "",
    };
  } catch {
    return null;
  }
}

export function applyDiary(bot: BotProfile, day: string, r: DiaryResult, now: number): void {
  bot.diary = [...(bot.diary ?? []).filter((d) => d.date !== day), { date: day, text: r.diary }]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DIARY_MAX);
  const have = new Set(bot.notes.map((n) => n.text));
  for (const text of r.notes) {
    if (have.has(text)) continue;
    const note: BotNote = { id: uuidv4(), text, kind: "fact", createdAt: now, updatedAt: now };
    bot.notes.push(note);
  }
  if (r.user) bot.memory.user = r.user;
  bot.updatedAt = now;
}
