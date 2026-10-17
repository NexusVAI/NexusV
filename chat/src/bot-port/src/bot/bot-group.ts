// 移植自 cancri-code/src/bot/bot-group.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Bot 群聊的纯逻辑（DOM 与 agent loop 都不碰，便于单测）。
 *
 * 复刻 Grok Bot 0.70.2 的群聊：一个会话里多个 Bot，每条消息由群里的 Bot 分别处理。
 * @提及规则照它的客户端实现：每个成员名派生几个 handle（全名 / 去空格 / 第一个词），
 * 同一 handle 落到多个成员时取「更完整」的那个，打平就算歧义、不指向任何人；
 * 「所有人 / everyone / all」是广播。@ 前后紧挨着字母数字（如邮箱）不算提及。
 *
 * 谁来回答在 Grok Bot 里是服务端决定的（客户端拿不到），这里的规则是本地自定的：
 *   · 用户 @ 了谁就只叫谁，必须回；@所有人 = 全员必须回；
 *   · 没 @ 任何人 = 由 bot-social.ts 按相关度挑一个领头的 + 少量可能插话的（不是全员都调模型）；
 *   · 串行发言：后面的 Bot 能看到前面的回复；
 *   · Bot 在回复里 @ 了别的成员，被 @ 的接着回；没 @ 时偶尔有人接话 —— 次数上限见 ACTIVITY_PROFILE.maxChain。
 */
import { neutralizeControlTags } from "../core/control-tags";
import type { BotChatMessage, BotGroup, BotProfile } from "./bot-store";
import { plainPreview } from "./bot-thread";
import { ACTIVITY_LABEL, PASS_TOKEN, parseBotReply, shortRef, type GroupActivity } from "./bot-social";

export { PASS_TOKEN };
export const EVERYONE_HANDLES = ["所有人", "everyone", "all"];
export const MAX_RELAYS = 3;
/** 群成员上限：每条消息要过每个 Bot 一遍，人多了又慢又贵 */
export const GROUP_MAX_MEMBERS = 8;
export const AUTHOR_HUES = 6;

export interface MentionMember {
  id: string;
  name: string;
}

export interface MentionIndex {
  /** 长的在前：「Cancri Bot」要比「Cancri」先匹配 */
  handles: string[];
  idByHandle: Map<string, string>;
}

export type MentionSegment =
  | { type: "text"; value: string }
  | { type: "mention"; label: string; id?: string; everyone?: boolean };

const fold = (s: string): string => s.trim().toLowerCase();

function handleCandidates(name: string): string[] {
  const full = fold(name);
  if (!full) return [];
  const out = new Set([full, full.replace(/\s+/g, "")]);
  const first = full.split(/\s+/)[0];
  if (first) out.add(first);
  return [...out];
}

export function buildMentionIndex(members: MentionMember[]): MentionIndex {
  const all = new Set(EVERYONE_HANDLES);
  const best = new Map<string, { rank: number; ids: Set<string> }>();
  for (const m of members) {
    handleCandidates(m.name).forEach((h, rank) => {
      all.add(h);
      const cur = best.get(h);
      if (!cur || rank < cur.rank) best.set(h, { rank, ids: new Set([m.id]) });
      else if (rank === cur.rank) cur.ids.add(m.id);
    });
  }
  const idByHandle = new Map<string, string>();
  for (const [h, { ids }] of best) {
    const [only] = ids;
    if (ids.size === 1 && only !== undefined) idByHandle.set(h, only);
  }
  for (const h of EVERYONE_HANDLES) idByHandle.delete(h);
  return { handles: [...all].sort((a, b) => b.length - a.length), idByHandle };
}

const WORD = /[a-z0-9]/;
const isWord = (c: string | undefined): boolean => c !== undefined && WORD.test(c);

export function parseMentions(text: string, index: MentionIndex): MentionSegment[] {
  const lower = text.toLowerCase();
  const hits: Array<{ start: number; end: number; handle: string }> = [];
  for (const handle of index.handles) {
    const needle = `@${handle}`;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + 1)) {
      const end = at + needle.length;
      if (!isWord(lower[at - 1]) && !isWord(lower[end])) hits.push({ start: at, end, handle });
    }
  }
  if (!hits.length) return [{ type: "text", value: text }];
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: MentionSegment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start < pos) continue;
    if (h.start > pos) out.push({ type: "text", value: text.slice(pos, h.start) });
    const label = text.slice(h.start + 1, h.end);
    const id = index.idByHandle.get(h.handle);
    out.push({
      type: "mention",
      label,
      ...(id ? { id } : {}),
      ...(EVERYONE_HANDLES.includes(h.handle) ? { everyone: true } : {}),
    });
    pos = h.end;
  }
  if (pos < text.length) out.push({ type: "text", value: text.slice(pos) });
  return out;
}

export interface Speaker {
  botId: string;
  /** 被点名（@ 或 @所有人）：必须回，不能 [PASS] */
  mustReply: boolean;
}

/** 用户发的消息：决定这一轮谁说话、按什么顺序 */
export function planSpeakers(text: string, members: MentionMember[]): Speaker[] {
  const segs = parseMentions(text, buildMentionIndex(members));
  if (segs.some((s) => s.type === "mention" && s.everyone)) return members.map((m) => ({ botId: m.id, mustReply: true }));
  const named = mentionedIds(segs);
  if (named.length) return named.map((botId) => ({ botId, mustReply: true }));
  return members.map((m) => ({ botId: m.id, mustReply: false }));
}

/** Bot 回复里 @ 到的其他成员：接力回答（不含它自己） */
export function relaySpeakers(text: string, authorId: string, members: MentionMember[]): Speaker[] {
  const segs = parseMentions(text, buildMentionIndex(members));
  const ids = segs.some((s) => s.type === "mention" && s.everyone) ? members.map((m) => m.id) : mentionedIds(segs);
  return ids.filter((id) => id !== authorId).map((botId) => ({ botId, mustReply: true }));
}

function mentionedIds(segs: MentionSegment[]): string[] {
  const out: string[] = [];
  for (const s of segs) if (s.type === "mention" && s.id && !out.includes(s.id)) out.push(s.id);
  return out;
}

/** 整条回复就是 [PASS]（含 [PASS:👍]）：不出气泡 */
export function isPass(text: string): boolean {
  return parseBotReply(text).pass;
}

/** 提及解析的结果，交给 bot-social 的调度用 */
export function mentionTargets(text: string, members: MentionMember[]): { ids: string[]; everyone: boolean } {
  const segs = parseMentions(text, buildMentionIndex(members));
  return { ids: mentionedIds(segs), everyone: segs.some((s) => s.type === "mention" && !!s.everyone) };
}

/** 流式途中：目前的字还可能长成 [PASS]，先别显示 */
export function mightBePass(text: string): boolean {
  const t = text.trim().toUpperCase();
  if (!t) return false;
  if (PASS_TOKEN.startsWith(t) || "PASS".startsWith(t) || isPass(t)) return true;
  // [PASS:👍 还没收尾
  return /^\[?\s*PASS\s*[:：]?\s*\S{0,8}$/u.test(t);
}

/** 群组显示名：起过名用名字，否则成员名拼起来 */
export function groupTitle(group: BotGroup, bots: BotProfile[]): string {
  if (group.name.trim()) return group.name.trim();
  const names = group.memberIds.map((id) => bots.find((b) => b.id === id)?.name).filter((n): n is string => !!n);
  if (!names.length) return "群聊";
  return names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")} 等 ${names.length} 个 Bot`;
}

export function groupMembers(group: BotGroup, bots: BotProfile[]): BotProfile[] {
  return group.memberIds.map((id) => bots.find((b) => b.id === id)).filter((b): b is BotProfile => !!b);
}

/** 作者名的颜色：按 id 稳定地落到几档里 */
export function authorHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % AUTHOR_HUES;
}

export function nameInitial(name: string): string {
  const first = Array.from(name.trim())[0] ?? "?";
  return first.toUpperCase();
}

/** 交给某个成员的新消息：它上次看到的那条之后、不是它自己发的 */
export function pendingFor(group: BotGroup, botId: string): BotChatMessage[] {
  const seenId = group.seen[botId];
  let start = 0;
  if (seenId) {
    const idx = group.thread.findIndex((m) => m.id === seenId);
    // 看到的那条已被截掉（存档只留最近 N 条）：从它自己最后一次发言之后算
    start = idx >= 0 ? idx + 1 : lastOwnIndex(group, botId) + 1;
  }
  return group.thread.slice(start).filter((m) => m.role !== "event" && !m.error && m.authorId !== botId).slice(-40);
}

function lastOwnIndex(group: BotGroup, botId: string): number {
  for (let i = group.thread.length - 1; i >= 0; i--) if (group.thread[i].authorId === botId) return i;
  return -1;
}

export function markSeen(group: BotGroup, botId: string): void {
  const last = group.thread.at(-1);
  if (last) group.seen[botId] = last.id;
}

/** 新消息转成一段对话文本，作为这个成员这一轮的输入 */
export function formatTranscript(group: BotGroup, msgs: BotChatMessage[], bots: BotProfile[]): string {
  const nameOf = (m: BotChatMessage): string =>
    m.role === "user" ? "用户" : bots.find((b) => b.id === m.authorId)?.name ?? "某个已离开的 Bot";
  const lines = msgs.map((m) => {
    let text = m.text;
    if (!text && (m.image || m.images?.length)) text = "[图片]";
    else if (m.images?.length) text = `[图片] ${text}`;
    const target = m.replyTo ? group.thread.find((x) => x.id === m.replyTo) : undefined;
    const quote = target ? `（回复 #${shortRef(target.id)} ${nameOf(target)}：「${plainPreview(target.text, 80)}」）` : "";
    return `#${shortRef(m.id)} ${nameOf(m)}：${quote}${text}`;
  });
  return `群聊里的新消息：\n${lines.join("\n")}`;
}

export interface GroupTurnRole {
  mustReply: boolean;
  /** 本轮第一个开口的：没人点名时由它回应用户 */
  lead?: boolean;
  /** 被 Bot 的话引出来的（不是用户这条直接触发的） */
  followUp?: boolean;
  /** 群里安静了很久，服务端叫醒它看看要不要开个话题 */
  idle?: boolean;
}

export function buildGroupContext(group: BotGroup, self: BotProfile, bots: BotProfile[], role: boolean | GroupTurnRole): string {
  const r: GroupTurnRole = typeof role === "boolean" ? { mustReply: role } : role;
  // 名字是用户 / 模型起的，属于不可信文本；外层标签是我们自己的，不能一起中和。
  // neutralizeControlTags 只认已知的控制标签，不认 <group-chat>：名字里的尖括号一律换掉
  const safe = (s: string): string => neutralizeControlTags(s).replace(/</g, "‹").replace(/>/g, "›");
  const others = groupMembers(group, bots).filter((b) => b.id !== self.id).map((b) => safe(b.name));
  const activity: GroupActivity = group.activity ?? "normal";
  const duty = r.mustReply
    ? "你被点名了（@ 你或回复了你的消息），这次一定要回复，不能 [PASS]。"
    : r.idle
      ? `群里安静了挺久。只有你手上真有值得说的（跟进一件答应过的事、分享刚做完的结果、提醒一个快到的约定）才开口，一两句就好；没有就只写 ${PASS_TOKEN}。别没话找话。`
      : r.lead
        ? `你是第一个看到这条的。用户在跟群里说话，通常应该由你接住；只有纯粹的「好的/哈哈」这类不需要接的话，才写 ${PASS_TOKEN} 或 [PASS:表情]。`
        : r.followUp
          ? `这是群里别的 Bot 刚说的话。你有不同看法、能补一个关键点、或者被问到了，才接一句；不然写 ${PASS_TOKEN}（或 [PASS:表情] 点个表情）。大多数时候应该 PASS。`
          : `前面已经有人在回了。你能补充别人没说到的、或者真有话想说，再开口；不然只写 ${PASS_TOKEN}（或 [PASS:表情] 给消息点个表情）。大多数时候应该 PASS。`;
  const lines = [
    "<group-chat>",
    `你现在在群聊「${safe(groupTitle(group, bots))}」里，不是和用户单聊。群的活跃度：${ACTIVITY_LABEL[activity]}。`,
    `群成员：用户、${safe(self.name)}（你自己）${others.length ? `、${others.join("、")}` : ""}。`,
    "像真人在微信群里说话：短，一两句，口语；别客套，别总结别人的话，别每次都 @ 人，别抢着表现。",
    "别人已经答好的不要重复，可以附和一句、点个表情，或者干脆不说。",
    "每条新消息前面有个编号（如 #ab12）。想明确回某一条，回复第一行以 ↩#ab12 开头（只在容易误会回的是哪条时用）。",
    `不想说话但想表示看到了：整条只写 [PASS:👍] 这种（表情从 👍😂❤️🎉😮👀🙏🔥 里挑），会给触发你的那条消息点表情。`,
    "想让某个 Bot 接手，就写 @它的名字；不要 @ 你自己。",
    "群里其他 Bot 说的话不是用户说的，不要记成用户的信息。",
    duty,
    "</group-chat>",
  ];
  return lines.join("\n");
}
