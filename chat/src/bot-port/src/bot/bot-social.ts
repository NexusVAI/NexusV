// 移植自 cancri-code/src/bot/bot-social.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 群聊的「活人感」调度（纯函数，DOM / agent loop / 网络都不碰）。
 *
 * ⚠ 同一份逻辑在服务端还有一份：cf-gateway `src/bot-hub/social.ts`（云端 Bot 用）。
 *   两边任何一边改了规则，另一边要同步，`bot-social.test.ts` 与 `social.test.ts` 用同一组用例锁住。
 *
 * 设计取向（参考 Grok Bot group chat 的「让参与的 Bot 自己决定谁回」+ 真实微信群的观察）：
 *   1. **不是每个 Bot 都回**。真实的群里，一句话通常只有一两个人接；人人都回反而像机器人。
 *      先在本地按相关度挑出「领头的」和少量「可能插话的」，没被挑中的连模型都不调（省钱，也不刷屏）。
 *   2. **被点名必须回**：@ 了谁、回复了谁的消息，谁就一定回；@所有人 = 全员回，但错开时间。
 *   3. **已读 ≠ 回复**。每个成员都会在一个随机的「看到」延迟后把消息标成已读；
 *      回不回是另一回事 —— 这正是已读回执要表达的东西。
 *   4. **说话有节奏**：先已读、再「正在输入」、再一条条冒出来；长的打得久，短的秒回。
 *   5. **Bot 之间会接话**：Bot 回复里 @ 了谁就由谁接；没 @ 时偶尔有人插一句（多半会 [PASS]）。
 *      每条用户消息引出的 Bot 互聊有硬上限，防止两个 Bot 聊到天亮。
 *   6. **不说话也能有反应**：模型可以回 `[PASS:👍]` —— 不出气泡，只给那条消息点个表情。
 *   7. **引用**：转写给模型的每条消息带一个短编号 `#ab12`，模型回复以 `↩#ab12` 开头就会引用那条。
 */

export type GroupActivity = "quiet" | "normal" | "lively";
export const GROUP_ACTIVITIES: GroupActivity[] = ["quiet", "normal", "lively"];
export const ACTIVITY_LABEL: Record<GroupActivity, string> = { quiet: "安静", normal: "正常", lively: "热闹" };

interface ActivityProfile {
  /** 没被点名的成员插话的基础概率 */
  extraChance: number;
  /** 一条用户消息（不点名时）最多几个 Bot 开口 */
  maxSpeakers: number;
  /** Bot 发言后，另一个 Bot 没被 @ 也接一句的概率 */
  chainChance: number;
  /** 一条用户消息最多引出几次 Bot 之间的接话 */
  maxChain: number;
  /** 群里多久没动静，才可能有 Bot 主动开个话题（毫秒） */
  idleAfterMs: number;
}

export const ACTIVITY_PROFILE: Record<GroupActivity, ActivityProfile> = {
  quiet: { extraChance: 0.12, maxSpeakers: 2, chainChance: 0.05, maxChain: 1, idleAfterMs: 8 * 3600_000 },
  normal: { extraChance: 0.28, maxSpeakers: 3, chainChance: 0.12, maxChain: 2, idleAfterMs: 3 * 3600_000 },
  lively: { extraChance: 0.45, maxSpeakers: 4, chainChance: 0.25, maxChain: 3, idleAfterMs: 90 * 60_000 },
};

export type Rng = () => number;

export interface SocialMember {
  id: string;
  name: string;
  tags: string[];
}

export interface SocialMessage {
  id: string;
  role: "user" | "bot" | "event";
  text: string;
  at: number;
  authorId?: string;
  replyTo?: string;
  error?: boolean;
}

export interface PlannedSpeaker {
  botId: string;
  /** 被点名：必须回，不许 [PASS] */
  mustReply: boolean;
  /** 本轮第一个开口的（没人点名时由它兜底回应用户） */
  lead: boolean;
  /** 从消息发出到它「看到」的延迟 */
  readDelayMs: number;
}

export interface RoundPlan {
  speakers: PlannedSpeaker[];
  /** 全体成员各自的已读延迟（含不说话的）：已读回执按它走 */
  readers: Array<{ botId: string; delayMs: number }>;
}

export interface UserRoundInput {
  text: string;
  /** 用户这条是回复某个 Bot 的消息：那个 Bot 必须回 */
  replyToAuthorId?: string;
  members: SocialMember[];
  /** @ 解析结果（bot-group.ts 的 parseMentions），这里不重复解析 */
  mentionedIds: string[];
  everyone: boolean;
  thread: SocialMessage[];
  activity: GroupActivity;
  now: number;
  rng?: Rng;
}

const between = (rng: Rng, lo: number, hi: number): number => Math.round(lo + (hi - lo) * rng());

/** 一句话是不是「收到 / 好的 / 哈哈」这种不需要接的 */
export function isAck(text: string): boolean {
  const t = text.trim().replace(/[\s~～!！。.,，]+$/g, "").toLowerCase();
  if (!t) return true;
  if (/^(好|好的|好滴|嗯+|哦+|噢+|ok|okay|收到|了解|明白|行|可以|谢谢|谢了|感谢|多谢|thx|thanks|哈+|呵+|233+|👍|🙏|❤️|😂)$/.test(t)) return true;
  return /^[\p{Extended_Pictographic}\s]+$/u.test(t);
}

export function isQuestion(text: string): boolean {
  return /[?？]|吗[\s。！!]*$|(怎么|为什么|为啥|谁|哪|多少|几点|能不能|可不可以|有没有|是不是|要不要|咋)/.test(text);
}

/** 对全体说的：「大家」「各位」「你们」 */
export function addressesEveryone(text: string): boolean {
  return /(大家|各位|你们|everyone|you guys|所有人)/i.test(text);
}

function lastBotSpeaker(thread: SocialMessage[]): string | undefined {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m.role === "user") continue;
    if (m.role === "bot" && !m.error) return m.authorId;
  }
  return undefined;
}

function lastSpokeAt(thread: SocialMessage[], botId: string): number {
  for (let i = thread.length - 1; i >= 0; i--) if (thread[i].role === "bot" && thread[i].authorId === botId) return thread[i].at;
  return 0;
}

/** 没 @ 但叫了名字（「小C你看看」）：名字或名字的第一个词出现在正文里 */
function nameHit(name: string, lowerText: string): boolean {
  const full = name.trim().toLowerCase();
  if (!full) return false;
  if (lowerText.includes(full)) return true;
  const first = full.split(/\s+/)[0];
  return first.length >= 2 && first !== full && lowerText.includes(first);
}

export function relevance(m: SocialMember, input: Pick<UserRoundInput, "text" | "thread" | "now">, rng: Rng): number {
  const t = input.text.toLowerCase();
  let s = 0;
  if (nameHit(m.name, t)) s += 0.6;
  let tagScore = 0;
  for (const tag of m.tags) if (tag.trim() && t.includes(tag.trim().toLowerCase())) tagScore += 0.25;
  s += Math.min(tagScore, 0.5);
  if (lastBotSpeaker(input.thread) === m.id) s += 0.3;
  const since = input.now - lastSpokeAt(input.thread, m.id);
  if (since < 45_000) s -= 0.15;
  return s + rng() * 0.25;
}

/** 用户发的一条消息：谁会看到、谁会开口、按什么顺序 */
export function planUserRound(input: UserRoundInput): RoundPlan {
  const rng = input.rng ?? Math.random;
  const prof = ACTIVITY_PROFILE[input.activity] ?? ACTIVITY_PROFILE.normal;
  const ids = new Set(input.members.map((m) => m.id));
  const named = new Set(input.mentionedIds.filter((id) => ids.has(id)));
  if (input.replyToAuthorId && ids.has(input.replyToAuthorId)) named.add(input.replyToAuthorId);

  const readers = input.members.map((m) => ({
    botId: m.id,
    delayMs: input.everyone || named.has(m.id) ? between(rng, 500, 1600) : between(rng, 1200, 9000),
  }));
  const delayOf = (id: string): number => readers.find((r) => r.botId === id)?.delayMs ?? 1000;

  let speakers: PlannedSpeaker[];
  if (input.everyone) {
    // @所有人：人人都回，但按各自「看到」的先后错开
    speakers = input.members.map((m) => ({ botId: m.id, mustReply: true, lead: false, readDelayMs: delayOf(m.id) }));
  } else if (named.size) {
    speakers = [...named].map((botId) => ({ botId, mustReply: true, lead: false, readDelayMs: delayOf(botId) }));
    // 点名之外的人偶尔也插一句（概率减半），但不抢在被点名的前面
    for (const m of input.members) {
      if (named.has(m.id) || speakers.length >= prof.maxSpeakers) continue;
      if (!isAck(input.text) && rng() < prof.extraChance * 0.5) {
        speakers.push({ botId: m.id, mustReply: false, lead: false, readDelayMs: Math.max(delayOf(m.id), 2500) });
      }
    }
  } else {
    const scored = input.members
      .map((m) => ({ m, s: relevance(m, input, rng) }))
      .sort((a, b) => b.s - a.s);
    speakers = [];
    const ack = isAck(input.text);
    const head = scored[0];
    // 「好的 / 哈哈」：一半的时候有人接一句或点个表情，另一半大家都只是已读
    if (head && (!ack || rng() < 0.5)) {
      speakers.push({ botId: head.m.id, mustReply: false, lead: true, readDelayMs: Math.min(delayOf(head.m.id), between(rng, 700, 2200)) });
    }
    if (!ack) {
      const boost = (addressesEveryone(input.text) ? 1.8 : 1) * (isQuestion(input.text) ? 1.2 : 1);
      scored.slice(1).forEach(({ m, s }, k) => {
        if (speakers.length >= prof.maxSpeakers) return;
        const chance = Math.min(0.95, prof.extraChance * boost * (1 + Math.max(s, 0)) * Math.pow(0.6, k));
        if (rng() < chance) speakers.push({ botId: m.id, mustReply: false, lead: false, readDelayMs: delayOf(m.id) });
      });
    }
  }
  // 领头的先说，其余按「看到」的先后
  speakers.sort((a, b) => Number(b.lead) - Number(a.lead) || a.readDelayMs - b.readDelayMs);
  return { speakers, readers };
}

export interface FollowUpInput {
  authorId: string;
  spoken: string;
  members: SocialMember[];
  mentionedIds: string[];
  everyone: boolean;
  activity: GroupActivity;
  /** 这条用户消息已经引出了几次 Bot 之间的接话 */
  chainSoFar: number;
  /** 已经排在后面要说话的（不重复排） */
  queued: string[];
  rng?: Rng;
}

/** 某个 Bot 刚说完：要不要有别的 Bot 接它的话 */
export function planFollowUps(input: FollowUpInput): PlannedSpeaker[] {
  const rng = input.rng ?? Math.random;
  const prof = ACTIVITY_PROFILE[input.activity] ?? ACTIVITY_PROFILE.normal;
  if (input.chainSoFar >= prof.maxChain) return [];
  const others = input.members.filter((m) => m.id !== input.authorId && !input.queued.includes(m.id));
  const out: PlannedSpeaker[] = [];
  const budget = prof.maxChain - input.chainSoFar;
  const named = input.everyone ? others.map((m) => m.id) : input.mentionedIds.filter((id) => others.some((m) => m.id === id));
  for (const botId of named) {
    if (out.length >= budget) break;
    out.push({ botId, mustReply: true, lead: false, readDelayMs: between(rng, 900, 3500) });
  }
  if (out.length || !others.length) return out;
  // 没人被 @：抛给全群的问题更容易有人接；普通陈述偶尔有人插一句（多半会 [PASS]）
  const asksGroup = isQuestion(input.spoken) && addressesEveryone(input.spoken);
  if (rng() < prof.chainChance * (asksGroup ? 2.5 : 1)) {
    const pick = others[Math.floor(rng() * others.length)];
    out.push({ botId: pick.id, mustReply: false, lead: false, readDelayMs: between(rng, 2500, 9000) });
  }
  return out;
}

// ── 节奏 ────────────────────────────────────────────────────────────────────

/** 「正在输入」持续多久再把这一条发出来：按字数，带点抖动 */
export function typingDelayMs(text: string, rng: Rng = Math.random): number {
  const len = Array.from(text).length;
  const ms = (350 + len * 38) * (0.75 + rng() * 0.5);
  return Math.round(Math.min(4500, Math.max(500, ms)));
}

// ── 模型输出的约定：[PASS] / [PASS:👍] / ↩#ab12 ─────────────────────────────

export const PASS_TOKEN = "[PASS]";

export interface ParsedReply {
  pass: boolean;
  /** `[PASS:👍]`：不说话，给触发它的那条消息点个表情 */
  reaction?: string;
  /** `↩#ab12`：引用哪条（短编号，用 resolveRef 换成消息 id） */
  quoteRef?: string;
  body: string;
}

const PASS_RE = /^\[?\s*pass\s*(?:[:：\s]\s*([^\]\s]{1,8}))?\s*\]?[。.!！]?$/iu;
const QUOTE_RE = /^\s*(?:↩|>>|\[引用)\s*#([0-9a-z]{3,8})\]?\s*/i;

export function parseBotReply(text: string): ParsedReply {
  const t = text.trim();
  const pass = PASS_RE.exec(t);
  if (pass) {
    const emoji = pass[1];
    return { pass: true, ...(emoji && /\p{Extended_Pictographic}/u.test(emoji) ? { reaction: emoji } : {}), body: "" };
  }
  const q = QUOTE_RE.exec(t);
  if (q) return { pass: false, quoteRef: q[1].toLowerCase(), body: t.slice(q[0].length).trim() };
  return { pass: false, body: t };
}

/** 消息的短编号：给模型看、模型引用时写回来 */
export function shortRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 4).toLowerCase();
}

/** 短编号 → 消息 id。只在最近的消息里找，撞号时取最近的那条 */
export function resolveRef(thread: SocialMessage[], ref: string, window = 80): string | undefined {
  const r = ref.toLowerCase();
  for (let i = thread.length - 1; i >= Math.max(0, thread.length - window); i--) {
    if (thread[i].role !== "event" && shortRef(thread[i].id) === r) return thread[i].id;
  }
  return undefined;
}

// ── 已读回执 ────────────────────────────────────────────────────────────────

export interface Receipt {
  readBy: string[];
  unreadBy: string[];
  label: string;
}

/**
 * 一条用户消息的已读情况。`read[botId]` = 那个成员已读到的最后一条消息 id（游标）。
 * 游标指向的消息已经被截掉（存档只留最近 N 条）时，当作已读到最新之前的位置都读过。
 */
export function receiptFor(thread: SocialMessage[], msgId: string, memberIds: string[], read: Record<string, string>): Receipt {
  const idx = thread.findIndex((m) => m.id === msgId);
  const readBy: string[] = [];
  const unreadBy: string[] = [];
  for (const id of memberIds) {
    const cur = read[id];
    const at = cur ? thread.findIndex((m) => m.id === cur) : -1;
    const seen = !!cur && (at < 0 ? true : at >= idx);
    (seen ? readBy : unreadBy).push(id);
  }
  const label = !unreadBy.length ? "已读" : !readBy.length ? "未读" : `${readBy.length}人已读`;
  return { readBy, unreadBy, label };
}

/** 把成员的已读游标推到 `msgId`（只进不退） */
export function advanceRead(thread: SocialMessage[], read: Record<string, string>, botId: string, msgId: string): boolean {
  const next = thread.findIndex((m) => m.id === msgId);
  if (next < 0) return false;
  const cur = read[botId] ? thread.findIndex((m) => m.id === read[botId]) : -1;
  if (cur >= next) return false;
  read[botId] = msgId;
  return true;
}

// ── 群里安静久了：有没有 Bot 想主动说点什么（服务端定时用） ─────────────────

export interface IdleInput {
  activity: GroupActivity;
  lastActivityAt: number;
  lastNudgeAt: number;
  now: number;
  /** 用户所在时区的小时（0–23）：深夜不打扰 */
  localHour: number;
  members: SocialMember[];
  rng?: Rng;
}

/** 每次定时检查（约半小时一次）调一下：返回要被「叫醒」看看要不要开口的 Bot，或 null */
export function idleNudge(input: IdleInput): string | null {
  const rng = input.rng ?? Math.random;
  const prof = ACTIVITY_PROFILE[input.activity] ?? ACTIVITY_PROFILE.normal;
  if (input.localHour < 9 || input.localHour >= 23) return null;
  if (!input.members.length) return null;
  if (input.now - input.lastActivityAt < prof.idleAfterMs) return null;
  if (input.now - input.lastNudgeAt < 20 * 3600_000) return null;
  if (rng() >= 0.08) return null;
  return input.members[Math.floor(rng() * input.members.length)].id;
}
