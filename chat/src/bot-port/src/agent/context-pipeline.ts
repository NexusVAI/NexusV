// 移植自 cancri-code/src/agent/context-pipeline.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — 请求前主动压缩流水线（P2，借鉴 Claude Code auto-compact，clean-room）
 *
 * 与 loop.ts 的 `compressContext` 分工：
 *   - `compressContext`：**发送时**的安全网（微压缩 + 前缀丢弃 + 占位摘要），不改 `_messages`，
 *     每轮发送临时计算，防止"这一发"超窗。
 *   - 本模块：回合开始或同轮截图累积后的主动压缩。历史超过上下文预算时，挑配对安全切点，
 *     把中间一段早期历史交给 summarizer 生成**真·LLM 摘要**，然后**持久化**回 `_messages`
 *     （[head, 摘要消息, tail]）。这样后续每轮不再反复重算占位摘要，上下文长期稳定。
 *
 * 不变量：绝不拆开 tool_call ↔ tool_result 配对。
 *   - head 优先保留开头 `keepHeadTurns` 轮；压力已到而历史不足时至少保留首条原始请求。
 *   - tail 从当前真实 user 或最新截图开始；原始请求和最新屏幕不会被摘要替代。
 *   - dropped = head 与 tail 之间被摘要的早期历史。
 *
 * 2026-08-09：删除了并存的 size-driven `computeCompactionPlan`（及其 `CompactionOptions`）。
 * 它零生产消费方、只有自身测试在用，且被 `computeHeadTurnsCompactionPlan` 严格取代——
 * 后者会显式把当前轮 user 消息保在 tail 里，前者没有这个保护。唯一压缩调用点是 loop.ts:883。
 */
import type { ContentPart, Message } from "../core/types";

export interface CompactionPlan {
  shouldCompact: boolean;
  head: Message[];
  dropped: Message[];
  tail: Message[];
}

/** 估算一条消息的真实 wire 字符数（含 tool_result.content / tool_call.args）。 */
export function messageChars(m: Message): number {
  if (typeof m.content === "string") return m.content.length;
  let n = 0;
  for (const p of m.content) {
    if (p.type === "text") n += p.text.length;
    else if (p.type === "tool_call")
      n += p.name.length + (typeof p.args === "string" ? p.args.length : JSON.stringify(p.args ?? {}).length);
    else if (p.type === "tool_result") n += p.content.length;
    else if (p.type === "image") n += p.url.length;
  }
  return n;
}

export function totalChars(messages: Message[]): number {
  let n = 0;
  for (const m of messages) n += messageChars(m);
  return n;
}

/**
 * 图片部件统计：张数 + 它们 data URL 的字符数。
 *
 * 供上下文 token 估算使用，不改 `messageChars` 的 wire 字符统计：
 * - `messageChars` 算实际请求体字符，可用于载荷大小诊断；
 * - 视觉模型对图片**按尺寸计费**（Anthropic ≈ w×h/750，1366×768 约 1.4k token），
 *   与 base64 长度无关。
 *
 * 把 `url.length / 4` 当 token 的后果（2026-09-14 用户实报「读个图片上下文就爆满」）：
 * 一张 600KB 的 PNG 截图 = 80 万字符 = 估成 20 万 token，200K 窗口的用量环当场打满，
 * 而真实占用约 1%。压缩阈值和显示都须使用图片 token 等价量。
 */
export function imagePartStats(messages: Message[]): { count: number; urlChars: number } {
  let count = 0;
  let urlChars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type === "image") {
        count += 1;
        urlChars += p.url.length;
      }
    }
  }
  return { count, urlChars };
}

/** 用于上下文窗口压力判断的字符等价量；wire 字节数仍由 totalChars 单独记录。 */
export const ESTIMATED_IMAGE_CONTEXT_CHARS = 6_400;

export function estimatedContextChars(messages: Message[]): number {
  const { count, urlChars } = imagePartStats(messages);
  return Math.max(0, totalChars(messages) - urlChars) + count * ESTIMATED_IMAGE_CONTEXT_CHARS;
}

/** 写文件/改代码类工具：压缩时只记调用元信息，不塞完整代码正文。 */
const CODE_MUTATION_TOOLS = new Set([
  "write_file",
  "write",
  "edit_file",
  "edit",
  "str_replace",
  "apply_patch",
  "create_file",
  "delete_file",
  "delete_path",
  "rename_path",
  "multi_edit",
]);

function toolCallSummary(name: string, args: unknown): string {
  if (!args || typeof args !== "object") return name;
  const a = args as Record<string, unknown>;
  const path =
    (typeof a.path === "string" && a.path) ||
    (typeof a.file_path === "string" && a.file_path) ||
    (typeof a.filePath === "string" && a.filePath) ||
    (typeof a.target === "string" && a.target) ||
    "";
  if (CODE_MUTATION_TOOLS.has(name)) {
    return path ? `${name} → ${path}` : name;
  }
  // 非改码工具：短参数摘要
  try {
    const raw = JSON.stringify(args);
    return `${name} ${cap(raw, 400)}`;
  } catch {
    return name;
  }
}

/** 子代理汇报在压缩 transcript 里的单条上限（普通工具结果仍是 400~600）。 */
const TRANSCRIPT_REPORT_CAP = 3000;
const TRANSCRIPT_REPORT_TOOLS = new Set(["spawn_subagent", "subagent_result"]);

/**
 * 压缩专用 transcript：保留用户目标、AI 正文、工具调用摘要；
 * **不含** 写文件/改代码工具的完整代码与大段 patch（用户明确要求）。
 */
export function renderCompactTranscript(messages: Message[], perMsgCap = 3000): string {
  const lines: string[] = [];
  // tool_result 不带工具名，靠同一批消息里的 tool_call 反查：子代理汇报是「读到了什么」
  // 的唯一载体，按普通结果 400 字截断，压缩后模型就只剩「派过子代理」而没有结论。
  const nameByCallId = new Map<string, string>();
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const p of m.content as ContentPart[]) if (p.type === "tool_call") nameByCallId.set(p.id, p.name);
  }
  for (const m of messages) {
    // 上下文快照是 role:"user"，但它不是用户目标。喂给摘要模型会让规则/项目记忆/@file
    // 全文被当成"用户说过的话"总结进去，摘要因此长出根本没人提过的任务。
    // 它们也不需要被摘要——最新一份始终在场（appendContextSnapshot 会补发）。
    if (m.meta?.contextSnapshot !== undefined) continue;
    if (m.meta?.intentHint) continue;
    const role = m.role.toUpperCase();
    if (typeof m.content === "string") {
      if (m.role === "assistant" || m.role === "user") {
        lines.push(`[${role}] ${cap(m.content, perMsgCap)}`);
      }
      continue;
    }
    for (const p of m.content as ContentPart[]) {
      if (p.type === "text") {
        if (m.role === "assistant" || m.role === "user") {
          lines.push(`[${role}] ${cap(p.text, perMsgCap)}`);
        }
      } else if (p.type === "tool_call") {
        lines.push(`[TOOL_CALL] ${toolCallSummary(p.name, p.args)}`);
      } else if (p.type === "tool_result") {
        // 改码工具结果只记 ok/err；其它工具结果保留短摘录
        const callHint = p.toolCallId ? ` #${p.toolCallId.slice(0, 8)}` : "";
        if (p.toolCallId && TRANSCRIPT_REPORT_TOOLS.has(nameByCallId.get(p.toolCallId) ?? "")) {
          lines.push(`[TOOL_RESULT${callHint} ${p.ok ? "ok" : "err"}] ${cap(p.content, TRANSCRIPT_REPORT_CAP)}`);
        } else if (p.ok && p.content.length > 800) {
          lines.push(`[TOOL_RESULT${callHint} ok] ${cap(p.content, 400)}`);
        } else {
          lines.push(`[TOOL_RESULT${callHint} ${p.ok ? "ok" : "err"}] ${cap(p.content, 600)}`);
        }
      }
    }
  }
  return lines.join("\n");
}

/**
 * 是否是「真实用户回合」的起点。
 *
 * agent loop 会把运行时上下文/只读快照也作为 role:"user" 追加进历史
 * （见 loop.ts appendContextSnapshot），它们不是用户开的新一轮。
 *
 * 两个地方都必须用它，否则会出严重事故（2026-08-15 复盘）：
 * - `computeHeadTurnsCompactionPlan`：不排除的话 `keepHeadTurns: 2` 被快照吃掉名额；
 * - `compressContext` 的前缀丢弃：快照追加在真实用户消息**之后**，若把快照当作切点，
 *   `slice(cut)` 会把用户这一轮的真实请求丢掉、只留下一条"继续处理用户的请求"的快照。
 */
export function isRealUserTurn(m: Message): boolean {
  if (m.role !== "user") return false;
  const meta = m.meta;
  if (!meta) return true;
  if (meta.contextSnapshot !== undefined) return false;
  // ⛔ 下面每一条都是 loop.ts **自己注入**的 role:"user" 消息（它们在 core/types.ts 里
  // 的注释都写着「UI 不渲染为用户气泡」——那正是「不是用户打的字」的判据）。
  // 2026-08-15 那版只排除了 snapshot/transient/intentHint，之后新增的闸门类消息全漏了。
  // 漏掉的后果不是多留几条，而是 `keepHeadTurns: 2` 的额度被「未完成 TODO 提醒」
  // 「验证门闩」「上一次的压缩摘要」吃光，用户这一轮的**真实原话**被丢进 dropped ——
  // 模型压缩后"忘了"用户要什么，只记得系统闸门。摘要尤其必须排除：它按定义是历史的
  // 派生物，把它当成新一轮的起点等于用摘要取代原文。
  // 2026-09-12（B7/B8）：补 screenshot 与 hookNote——前者是工具结果注入的屏幕截图
  // （大图消息被当成「新一轮用户请求」时，keepHeadTurns 会被截图消息吃掉）；后者是
  // Stop/TaskCompleted hook 注入的提示，同样不是用户原话。
  return !(
    meta.transient ||
    meta.intentHint ||
    meta.compactedSummary ||
    meta.postCompactSnapshot ||
    meta.tokenBudgetContinuation ||
    meta.autoContinuation ||
    meta.verificationGate ||
    meta.todoIncompleteGate ||
    meta.subagentWait ||
    meta.screenshot ||
    meta.hookNote ||
    meta.subagentCompletion !== undefined
  );
}

/** 压缩切分：尽量保留开头轮次；压力下至少保留首条真实请求与当前请求。 */
export function computeHeadTurnsCompactionPlan(
  messages: Message[],
  opts: { triggerChars: number; keepHeadTurns?: number },
): CompactionPlan {
  const keepHeadTurns = Math.max(1, opts.keepHeadTurns ?? 2);
  const noop: CompactionPlan = { shouldCompact: false, head: messages, dropped: [], tail: [] };
  if (estimatedContextChars(messages) <= opts.triggerChars) return noop;

  // 当前 turn 的 user 消息已经写入 messages 尾部；它必须原样留在 tail，不能被摘要替代。
  let latestUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserTurn(messages[i])) {
      latestUserIndex = i;
      break;
    }
  }
  if (latestUserIndex < 0) return noop;

  let userCount = 0;
  let headEnd = 0;
  for (let i = 0; i < latestUserIndex; i++) {
    if (isRealUserTurn(messages[i])) {
      userCount += 1;
      if (userCount > keepHeadTurns) {
        headEnd = i;
        break;
      }
    }
    headEnd = i + 1;
  }
  if (userCount <= keepHeadTurns) {
    // 历史仅有一两轮但已超窗时，完整保留它们会使每轮都触发又跳过。
    // 收紧到首条真实用户请求；当前请求仍原样留在 tail，旧执行过程进入摘要。
    const firstUser = messages.findIndex(isRealUserTurn);
    if (firstUser < 0) return noop;
    headEnd = firstUser + 1;
  }

  const head = messages.slice(0, headEnd);
  const dropped = messages.slice(headEnd, latestUserIndex);
  const tail = messages.slice(latestUserIndex);
  if (dropped.length === 0) return noop;
  // 结构 = 前 N 轮 + 摘要 + 当前 user turn；当前用户请求永不进入 dropped。
  return { shouldCompact: true, head, dropped, tail };
}

/**
 * 单个用户回合内的压缩切分（2026-10-16）。
 *
 * 回合起点的 `computeHeadTurnsCompactionPlan` 只处理「多个用户回合」；一个回合里跑了
 * 上百步时它永远 noop（head 之后到当前请求之间没有东西），只剩发送时不落盘的
 * `compressContext`——每步前缀都在滑，上游缓存只剩 system+tools，模型也只记得最近 16 条。
 * 这里把中段**落盘**成一条摘要：压缩之后到下一次触发之前，历史是纯追加的，缓存重新有效。
 *
 * head = 当前（最后一个）真实用户请求 + 紧随其后的上下文快照；
 * tail = 最近 keepRecent 条，起点后移到 assistant 边界（不拆 tool_call ↔ tool_result）。
 * head+tail 自己就超过阈值时返回 noop：压缩换不回空间，只会每步白烧一次摘要请求。
 */
export function computeInTurnCompactionPlan(
  messages: Message[],
  opts: { triggerChars: number; keepRecent?: number; force?: boolean },
): CompactionPlan {
  const noop: CompactionPlan = { shouldCompact: false, head: messages, dropped: [], tail: [] };
  // force（真实 token 压力 / 手动 /compact）：不看字符阈值，也不做 tail 体积闸。
  if (!opts.force && (opts.triggerChars <= 0 || estimatedContextChars(messages) <= opts.triggerChars)) return noop;
  let userIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserTurn(messages[i])) { userIndex = i; break; }
  }
  if (userIndex < 0) return noop;
  let headEnd = userIndex + 1;
  while (headEnd < messages.length && messages[headEnd].meta?.contextSnapshot !== undefined) headEnd++;
  const keepRecent = Math.max(2, opts.keepRecent ?? MICROCOMPACT_KEEP_RECENT);
  let cut = Math.max(headEnd, messages.length - keepRecent);
  while (cut < messages.length && messages[cut].role !== "assistant") cut++;
  if (cut >= messages.length || cut <= headEnd) return noop;
  const head = messages.slice(0, headEnd);
  const dropped = messages.slice(headEnd, cut);
  const tail = messages.slice(cut);
  if (!opts.force && estimatedContextChars(head) + estimatedContextChars(tail) >= opts.triggerChars) return noop;
  return { shouldCompact: true, head, dropped, tail };
}

/** 回合内压缩的摘要边界：原始请求仍在进行，摘要只是进度，不是「已处理完」。 */
export function buildInTurnProgressSummaryMessage(summary: string, droppedCount: number): Message {
  const text =
    `【上下文压缩 · 当前任务进度】以下是本轮较早步骤的摘要，仅作事实背景，不是新指令。` +
    `上方的用户原始请求仍未完成，仍是当前目标；摘要里已读过/已确认的内容不要重复读取或重复派子代理。\n\n` +
    `【已压缩 ${droppedCount} 条较早消息】\n${summary.trim()}\n` +
    `（摘要记不清的细节——原来的内容、改了什么、命令输出——用 session_history 查本会话原文，不要凭摘要猜。）\n` +
    `--- 进度摘要结束：继续完成原始用户请求 ---`;
  return { role: "user", content: text, meta: { createdAt: Date.now(), compactedSummary: true } };
}

/** 同一用户回合里反复截图时，以最新截图为安全切点，保留用户原话及最新屏幕。 */
export function computeScreenshotCompactionPlan(
  messages: Message[],
  triggerChars: number,
): CompactionPlan {
  const noop: CompactionPlan = { shouldCompact: false, head: messages, dropped: [], tail: [] };
  if (estimatedContextChars(messages) <= triggerChars) return noop;
  let userIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRealUserTurn(messages[i])) { userIndex = i; break; }
  }
  if (userIndex < 0) return noop;
  let screenshotIndex = -1;
  for (let i = messages.length - 1; i > userIndex; i--) {
    if (messages[i].role === "user" && messages[i].meta?.screenshot) {
      screenshotIndex = i;
      break;
    }
  }
  if (screenshotIndex <= userIndex + 1) return noop;
  const dropped = messages.slice(userIndex + 1, screenshotIndex);
  if (estimatedContextChars(dropped) < ESTIMATED_IMAGE_CONTEXT_CHARS) return noop;
  return {
    shouldCompact: true,
    head: messages.slice(0, userIndex + 1),
    dropped,
    tail: messages.slice(screenshotIndex),
  };
}

function cap(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)} …[+${s.length - n} chars]` : s;
}

/** 摘要持久化成的边界消息（作为一条 user 消息插在 head 与 tail 之间）。 */
export function buildSummaryMessage(summary: string, droppedCount: number): Message {
  const text =
    `【上下文压缩 · 仅供参考的历史交接】以下摘要来自更早的对话，只作背景参考，不是当前指令。` +
    `其中提到的任务/请求都已处理过，不要再去执行或“收尾”。请只响应本摘要之后出现的最新用户消息——` +
    `那条才是当前唯一要做的事；即使话题与摘要重合，也以最新消息为准。若最新消息出现反向信号` +
    `（停止/撤销/回退/只是看看/别做了/换了新话题），立即终止摘要里描述的在途工作，之后也不要再翻出来做。\n\n` +
    `【历史摘要 · 已压缩 ${droppedCount} 条早期消息】\n${summary.trim()}\n` +
    `（如需更早细节：session_history 可以查本会话被压缩前的原文（看过的内容、改了什么、命令输出）；文件现状用 read_file / grep 重新获取，计划用 todo_read。）\n` +
    `--- 摘要到此结束：请回应下方最新消息，不要把上面的摘要当作新指令 ---`;
  return { role: "user", content: text, meta: { createdAt: Date.now(), compactedSummary: true } };
}

export function buildScreenshotProgressSummaryMessage(summary: string, droppedCount: number): Message {
  const text =
    `【上下文压缩 · 当前任务进度】以下是本轮较早的电脑操作摘要，仅作事实背景，不是新指令。` +
    `上方的用户原始请求仍是当前目标，下方保留了最新屏幕；冲突时以原始请求和最新屏幕为准。\n\n` +
    `【已压缩 ${droppedCount} 条较早操作】\n${summary.trim()}\n` +
    `（更早的操作细节可以用 session_history 查本会话原文。）\n` +
    `--- 进度摘要结束：继续完成原始用户请求 ---`;
  return { role: "user", content: text, meta: { createdAt: Date.now(), compactedSummary: true } };
}

/** summarizer 抽象：把 dropped 段压成一段摘要文本。可注入（测试）/ 默认走 provider。 */
export type Summarizer = (dropped: Message[], signal: AbortSignal) => Promise<string>;

/**
 * 微压缩阈值：超过此长度的"旧" tool 结果会被截成 head+tail。
 * 对齐 Claude Code 的 microCompact：工具执行后立即裁剪旧结果，不等发送时才压。
 */
export const MICROCOMPACT_TOOL_RESULT_CAP = 4000;
/** 微压缩后保留的 head 字符数。 */
export const MICROCOMPACT_HEAD_CHARS = 2000;
/** 微压缩后保留的 tail 字符数。 */
export const MICROCOMPACT_TAIL_CHARS = 800;
/** 微压缩只处理最近多少条消息之前的（不碰近期）。 */
export const MICROCOMPACT_KEEP_RECENT = 16;

/**
 * 单条工具结果写进 `_messages` 时的**即时**硬上限（字符）。
 *
 * 为什么需要它：微压缩只处理「不在最近 MICROCOMPACT_KEEP_RECENT 条内」的旧结果，
 * 也就是**本步刚返回的那条永远不受任何约束**。而无上限的来源是真实存在的：
 * grep 最坏可回约 1MB（2MB 单文件 × 2000 行匹配）、skill 回整份 SKILL.md、
 * MCP 动态工具完全不受我们控制。一条这样的结果就能把窗口顶掉，且此时压缩还没轮到它。
 *
 * 与 read_file 的关系（改这两个数字前必须一起看）：本上限必须 **大于**
 * read_file 的 `READ_MAX_CHARS_CEILING`（60k）加上它的续读提示语，否则会出现
 * 「read_file 记账为已完整读取，但模型实际只看到被这里截掉的前半段」——
 * write_file 的全量覆盖闸门正是靠那份记账放行的，不一致等于静默丢内容。
 */
export const IMMEDIATE_TOOL_RESULT_CAP = 64_000;
/** 即时截断保留的头部字符数。 */
export const IMMEDIATE_HEAD_CHARS = 48_000;
/** 即时截断保留的尾部字符数（失败原因、汇总行通常在尾部）。 */
export const IMMEDIATE_TAIL_CHARS = 8_000;

/**
 * 对单条工具结果正文做即时头尾截断。未超限则原样返回（同一引用）。
 *
 * 不做工具豁免：豁免名单（MICROCOMPACT_EXEMPT_TOOLS）的语义是「旧结果不要为了省
 * token 而压缩」，而这里是窗口的硬边界——留一个豁免口就等于留一条能顶掉窗口的路。
 */
export function capImmediateToolResultText(text: string): string {
  if (text.length <= IMMEDIATE_TOOL_RESULT_CAP) return text;
  const omitted = text.length - IMMEDIATE_HEAD_CHARS - IMMEDIATE_TAIL_CHARS;
  return (
    text.slice(0, IMMEDIATE_HEAD_CHARS) +
    `\n[... 单条工具结果超过 ${IMMEDIATE_TOOL_RESULT_CAP} 字符上限，已省略中间 ${omitted} 字符（保留头 ${IMMEDIATE_HEAD_CHARS} + 尾 ${IMMEDIATE_TAIL_CHARS}）。` +
    `需要被省略的部分请缩小范围重新取：grep 加 include_glob 或收窄 pattern，read_file 用 offset/limit 分段，命令输出重定向到文件后分段读。 ...]\n` +
    text.slice(-IMMEDIATE_TAIL_CHARS)
  );
}

/**
 * 微压缩**豁免**工具：这些工具的结果被腰斩会直接改变后续决策的正确性。
 *
 * 为什么是黑名单而不是 Claude Code 那种白名单（`COMPACTABLE_TOOLS`）：
 * CC 的工具集封闭，白名单漏了谁只是少省一点 token；我们有 MCP 动态工具
 * （`mcp__<server>__<tool>`，名字在编译期根本不存在）和还在增长的沙箱/知识库工具，
 * 而这些恰恰是最容易吐 60k 字符的。白名单会让它们**永远不被压缩**，
 * 于是"加了个 MCP server 之后长任务爆上下文"变成一个没人能一眼看出的回归。
 * 黑名单的失效方向反过来：新工具默认可压缩，只有确实不能截的才登记在此。
 *
 * 登记标准是"截断会丢掉判断依据"，不是"内容重要"：
 * 结果可以再取一次的（read_file / grep）不登记——截了大不了重读。
 */
export const MICROCOMPACT_EXEMPT_TOOLS: ReadonlySet<string> = new Set([
  // 用户的原话。腰斩掉中段等于篡改用户的回答，且它本来就短。
  "ask_user_question",
  // 计划正文 = 后续实施的依据，用户是按这份全文批准的；截断后模型照着半份计划做。
  "enter_plan_mode",
  "exit_plan_mode",
  // 任务清单：中段被吃掉 = 若干条 TODO 静默消失，而模型会以为自己看到了全部。
  "todo_write",
  "todo_read",
  // 子代理的最终汇报是那条并行分支的**全部**产出，原始过程已经不在主历史里，无从重取。
  "spawn_subagent",
  "resume_subagent",
  // 技能正文是分步指令，截断后会跳步执行。
  "skill",
]);

/**
 * 建立 toolCallId → 工具名的索引。
 * `ToolResultPart` 只带 `toolCallId`，工具名在**上一条 assistant 消息**的 tool_call 里，
 * 所以豁免判定必须先回溯配对，不能就地读。
 */
function buildToolNameByCallId(messages: Message[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type === "tool_call") index.set(p.id, p.name);
    }
  }
  return index;
}

/**
 * 微压缩单条 tool 消息：把过长的 tool_result 截成 head+tail，保留 toolCallId 维持配对。
 * 纯函数，可单测。从 loop.ts 提取到此处让 context-pipeline 统一管理所有压缩策略。
 */
export function microcompactToolMessage(m: Message, text: string): Message {
  const omitted = Math.max(0, text.length - MICROCOMPACT_HEAD_CHARS - MICROCOMPACT_TAIL_CHARS - 100);
  const compacted =
    text.slice(0, MICROCOMPACT_HEAD_CHARS) +
    `\n[... 旧工具结果过长，已压缩省略中间约 ${omitted} 字符；如仍需要请重新调用对应工具。 ...]\n` +
    text.slice(-MICROCOMPACT_TAIL_CHARS);
  if (Array.isArray(m.content)) {
    return {
      ...m,
      content: m.content.map((p) =>
        p.type === "tool_result" ? { ...p, content: compacted } : p,
      ),
    };
  }
  return { ...m, content: compacted };
}

/**
 * 对齐 Claude Code microCompact：工具执行后主动裁剪旧的过长 tool 结果。
 * 只处理"不在最近 keepRecent 条内"的 tool 消息，近期消息不动。
 * 原地修改 messages 数组（性能：避免复制整个数组）。
 *
 * @param messages _messages 数组（原地修改）
 * @param keepRecent 保留最近多少条不压缩（默认 16）
 * @returns 被压缩了多少条消息（用于日志/事件）
 */
export function microCompactAfterTools(
  messages: Message[],
  keepRecent: number = MICROCOMPACT_KEEP_RECENT,
): number {
  const recentStart = Math.max(0, messages.length - keepRecent);
  let compacted = 0;
  let nameByCallId: Map<string, string> | null = null;
  for (let i = 0; i < recentStart; i++) {
    const m = messages[i];
    if (m.role !== "tool") continue;
    const text = toolMessageText(m);
    if (text.length <= MICROCOMPACT_TOOL_RESULT_CAP) continue;
    // 索引懒建：绝大多数轮次没有任何超长旧结果，不该为此扫一遍全历史
    nameByCallId ??= buildToolNameByCallId(messages);
    const toolName = toolMessageCallId(m).map((id) => nameByCallId!.get(id) ?? "");
    if (toolName.some((n) => MICROCOMPACT_EXEMPT_TOOLS.has(n))) continue;
    messages[i] = microcompactToolMessage(m, text);
    compacted += 1;
  }
  return compacted;
}

/**
 * 微压缩的**纯函数**版本：返回新数组，原数组不动。给发送路径（`loop.ts compressContext`）用。
 *
 * 与 `microCompactAfterTools`（原地改写、用于持久化路径）是同一判据的两种形态，
 * 刻意共用本文件内的 `buildToolNameByCallId` / `MICROCOMPACT_EXEMPT_TOOLS`
 * —— 而不是把那些 private 函数逐个导出去给 loop.ts 自己拼一遍。
 *
 * ⛔ 为什么必须有这个函数（2026-08-23 审计）：`compressContext` 原先自己 `map` 了一段
 * 「只按长度腰斩」的逻辑，**不查豁免名单**。于是子代理汇报 / 用户批准过的计划全文 /
 * TODO 清单会在**上下文最紧、最需要完整依据**的时候被切成 head+tail，而模型按残缺
 * 依据继续干。预算宽松时只走持久化路径（豁免有效），所以这个 bug 表现得像偶发。
 *
 * ⚠ 对照 `capImmediateToolResultText`：那条是窗口硬边界，刻意**不**豁免（见其注释），
 * 不要把这里的豁免逻辑抄过去。
 */
export function microCompactForSend(
  messages: Message[],
  keepRecent: number = MICROCOMPACT_KEEP_RECENT,
): Message[] {
  const recentStart = Math.max(0, messages.length - keepRecent);
  let nameByCallId: Map<string, string> | null = null;
  return messages.map((m, idx) => {
    if (idx >= recentStart || m.role !== "tool") return m;
    const text = toolMessageText(m);
    if (text.length <= MICROCOMPACT_TOOL_RESULT_CAP) return m;
    nameByCallId ??= buildToolNameByCallId(messages);
    const names = toolMessageCallId(m).map((id) => nameByCallId!.get(id) ?? "");
    // 反证（2026-08-23）：摘掉本行，loop.test.ts「发送路径的微压缩也要遵守豁免名单」
    // 立刻变红 —— 30 万字的子代理汇报被压成 2853 字符（丢 99%）。
    if (names.some((n) => MICROCOMPACT_EXEMPT_TOOLS.has(n))) return m;
    return microcompactToolMessage(m, text);
  });
}

/** 取一条 tool 消息里 tool_result 的真实文本。 */
function toolMessageText(m: Message): string {
  if (typeof m.content === "string") return m.content;
  const tr = m.content.find((p) => p.type === "tool_result");
  return tr && tr.type === "tool_result" ? tr.content : "";
}

/** 一条 tool 消息里全部 tool_result 的 callId（通常只有一个）。 */
function toolMessageCallId(m: Message): string[] {
  if (typeof m.content === "string") return [];
  return m.content.filter((p) => p.type === "tool_result").map((p) => p.toolCallId);
}

/**
 * 闲置清理（idle microcompact）——2026-09-21 移植 ZCode 的 TimeBased 触发。
 *
 * ZCode 的 microcompact 有两个触发源：token 压力，以及**闲置**（距上一次助手完成
 * 超过 60 分钟）。CancriCode 此前只有前者，于是「用户离开一小时再回来」这条路径
 * 完全依赖 auto-compact（一次 LLM 摘要）或发送时的前缀丢弃——前者贵且会重写整段
 * 历史，后者发生在**已经超窗**之后。
 *
 * 为什么闲置触发是安全的（⛔ 别把它当成"又一个无谓的改写历史"）：
 *   `microCompactAfterTools` 之所以必须按压力触发，是因为原地改写会让上游**前缀缓存**
 *   从被改写那条起全部作废（见 loop.ts 那段注释）。而各家 prompt cache 的 TTL 是
 *   5–10 分钟量级，闲置 60 分钟之后那份缓存**早已过期**——此时改写历史是零缓存代价。
 *   这也是 ZCode 把阈值定在 60 分钟的原因，不是随手取的数。
 *
 * 与既有两条路径的分工：
 *   - `microCompactAfterTools`（压力，原地）：头尾截断，保留 2k+0.8k；
 *   - `microCompactForSend`（发送时，纯函数）：同上，仅用于这一发；
 *   - 本函数（闲置，原地）：**整条清空**只留一句标记。理由：闲置后旧结果的内容价值
 *     本就在于"当时的磁盘/命令状态"，而那已经过期；留着 2.8k 半截内容的收益远小于
 *     它占的窗口，还会让模型以为自己看到了完整输出。
 */
export const MICROCOMPACT_IDLE_THRESHOLD_MS = 60 * 60 * 1000;
/** 闲置清理保留最近多少组工具结果（组 = 一次 assistant 工具批及其结果，与 ZCode 同构）。 */
export const MICROCOMPACT_IDLE_KEEP_RECENT_GROUPS = 5;
/**
 * 低于这个节省量就不动手。
 *
 * 与 ZCode 的 `minTokenSavings: 256` 同一个用途：为省几百字符而重写历史不值得
 * （改写会让"发出去的历史"与 UI/会话日志的差异变大，回放诊断时更难对齐）。
 */
export const MICROCOMPACT_IDLE_MIN_SAVED_CHARS = 2_000;
/** 被清理的工具结果正文（模型看到的就是这一句）。 */
export const MICROCOMPACT_CLEARED_TOOL_RESULT =
  "[旧工具结果已在长时间闲置后清理；如仍需要请重新调用对应工具获取]";

/** 一条消息里是否带图片部件（工具消息正常不带，但清理是破坏性的，判据要保守）。 */
function messageHasMedia(m: Message): boolean {
  if (typeof m.content === "string") return false;
  return m.content.some((p) => p.type === "image");
}

/** 工具消息里 tool_result 的 ok 标记（拿不到按失败处理 = 不清理）。 */
function toolMessageOk(m: Message): boolean {
  if (typeof m.content === "string") return false;
  const tr = m.content.find((p) => p.type === "tool_result");
  return tr !== undefined && tr.type === "tool_result" && tr.ok;
}

function clearedToolMessage(m: Message): Message {
  if (Array.isArray(m.content)) {
    return {
      ...m,
      content: m.content.map((p) =>
        p.type === "tool_result" ? { ...p, content: MICROCOMPACT_CLEARED_TOOL_RESULT } : p,
      ),
    };
  }
  return { ...m, content: MICROCOMPACT_CLEARED_TOOL_RESULT };
}

/**
 * 闲置清理：把"最近 N 组之外"的工具结果正文换成一句标记，**原地**改 `messages`。
 * 返回被清理的消息条数（0 = 什么都没做）。
 *
 * 分组与 ZCode 一致：一条带 tool_call 的 assistant 消息开启新的一组，其后的
 * tool 结果都属于这一组；没有归属的孤儿 tool 结果各自成组。
 *
 * 不清理的对象（每条都有理由，⛔ 不要为了"多省点"放宽）：
 *   - 失败结果（`ok: false`）：那是排错依据，且本来就短（对齐 ZCode 的
 *     `clearErrorResults` 默认 false）；
 *   - 豁免工具（`MICROCOMPACT_EXEMPT_TOOLS`）：子代理汇报 / 计划正文 / TODO /
 *     用户回答 / 技能正文——清掉等于把那批依据整段抽走，与 microcompact 同一条理由；
 *   - 带图片的消息、已经清理过的消息。
 *
 * 配对结构不变：只换文本，不删消息，`toolCallId` 原样保留。
 */
export function clearStaleToolResultsForIdle(
  messages: Message[],
  opts: { keepRecentGroups?: number; minSavedChars?: number } = {},
): number {
  const keepRecentGroups = Math.max(
    1,
    Math.floor(opts.keepRecentGroups ?? MICROCOMPACT_IDLE_KEEP_RECENT_GROUPS),
  );
  const minSavedChars = Math.max(0, opts.minSavedChars ?? MICROCOMPACT_IDLE_MIN_SAVED_CHARS);
  const groups: number[][] = [];
  let current: number[] | null = null;
  let nameByCallId: Map<string, string> | null = null;

  const flush = (): void => {
    if (current && current.length > 0) groups.push(current);
    current = null;
  };

  messages.forEach((m, index) => {
    if (m.role === "assistant" && Array.isArray(m.content) && m.content.some((p) => p.type === "tool_call")) {
      flush();
      current = [];
      return;
    }
    if (m.role !== "tool") return;
    if (messageHasMedia(m)) return;
    const text = toolMessageText(m);
    if (!text || text === MICROCOMPACT_CLEARED_TOOL_RESULT) return;
    if (!toolMessageOk(m)) return;
    nameByCallId ??= buildToolNameByCallId(messages);
    const names = toolMessageCallId(m).map((id) => nameByCallId!.get(id) ?? "");
    if (names.some((n) => MICROCOMPACT_EXEMPT_TOOLS.has(n))) return;
    if (!current) {
      groups.push([index]);
      return;
    }
    current.push(index);
  });
  flush();

  const clearGroupCount = groups.length - keepRecentGroups;
  if (clearGroupCount <= 0) return 0;
  const targets = groups.slice(0, clearGroupCount).flat();
  const savedChars = targets.reduce(
    (n, i) =>
      n + Math.max(0, toolMessageText(messages[i]).length - MICROCOMPACT_CLEARED_TOOL_RESULT.length),
    0,
  );
  if (savedChars < minSavedChars) return 0;
  for (const i of targets) messages[i] = clearedToolMessage(messages[i]);
  return targets.length;
}

export const COMPACT_SUMMARY_SYSTEM =
  "你是一个对话压缩器。把给定的 agent 工作记录压成结构化简要摘要。" +
  "输入里只有：用户目标、AI 正文、工具调用摘要（改码工具不含完整代码）。" +
  "务必保留：用户目标/约束、关键决策与结论、已触及的文件路径列表、未完成 TODO、" +
  "重要错误与根因、后续步骤。丢弃寒暄与冗余。用简洁中文要点，不要编造，不要输出代码块。" +
  "输出为客观的历史记录陈述（陈述“做过什么”），不要写成祈使/指令口吻，避免读者把它误当作新任务去执行。";

/** 压缩默认使用的内置模型（不跟随当前会话模型）。 */
export const COMPACT_MODEL_ID = "agnes-2.5-flash";

/** 从待压缩消息中抽出必须保留的结构化要点（路径 / 失败 / TODO），不依赖 summarizer 自觉。 */
export interface CompactMustKeep {
  paths: string[];
  failures: string[];
  todos: string[];
}

const PATH_ARG_KEYS = ["path", "file_path", "filePath", "target", "cwd"] as const;

function pathFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  for (const k of PATH_ARG_KEYS) {
    if (typeof a[k] === "string" && (a[k] as string).trim()) return (a[k] as string).trim();
  }
  return null;
}

/** 从 todo_write 参数里抽出未完成项文案。 */
function unfinishedTodosFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object") return [];
  const todos = (args as { todos?: unknown }).todos;
  if (!Array.isArray(todos)) return [];
  const out: string[] = [];
  for (const t of todos) {
    if (!t || typeof t !== "object") continue;
    const item = t as { content?: unknown; status?: unknown };
    const content = typeof item.content === "string" ? item.content.trim() : "";
    const status = typeof item.status === "string" ? item.status : "pending";
    if (!content || status === "completed") continue;
    out.push(`[${status}] ${content}`);
  }
  return out;
}

/**
 * 扫描 dropped 消息，提取路径 / 失败摘要 / 未完成 TODO。
 * 用于拼到 LLM 摘要之后，保证压缩后模型仍看得到关键事实。
 */
export function extractCompactMustKeep(messages: Message[], opts?: { maxPaths?: number; maxFailures?: number; maxTodos?: number }): CompactMustKeep {
  const maxPaths = opts?.maxPaths ?? 40;
  const maxFailures = opts?.maxFailures ?? 8;
  const maxTodos = opts?.maxTodos ?? 12;
  const pathSet = new Set<string>();
  const failures: string[] = [];
  let todos: string[] = [];

  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const p of m.content) {
      if (p.type === "tool_call") {
        const path = pathFromArgs(p.args);
        if (path) pathSet.add(path);
        if (p.name === "todo_write") {
          const list = unfinishedTodosFromArgs(p.args);
          if (list.length > 0) todos = list;
        }
      } else if (p.type === "tool_result" && !p.ok) {
        const snippet = p.content.replace(/\s+/g, " ").trim().slice(0, 220);
        if (snippet) failures.push(snippet);
      }
    }
  }

  return {
    paths: [...pathSet].slice(0, maxPaths),
    failures: failures.slice(-maxFailures),
    todos: todos.slice(0, maxTodos),
  };
}

/** 把 must-keep 块拼到摘要正文后（摘要可为空）。 */
export function appendMustKeepToSummary(summary: string, keep: CompactMustKeep): string {
  const blocks: string[] = [];
  if (keep.paths.length > 0) {
    blocks.push(`【必留·路径】\n${keep.paths.map((p) => `- ${p}`).join("\n")}`);
  }
  if (keep.failures.length > 0) {
    blocks.push(`【必留·失败】\n${keep.failures.map((f) => `- ${f}`).join("\n")}`);
  }
  if (keep.todos.length > 0) {
    blocks.push(`【必留·未完成 TODO】\n${keep.todos.map((t) => `- ${t}`).join("\n")}`);
  }
  if (blocks.length === 0) return summary.trim();
  const tail = blocks.join("\n\n");
  const base = summary.trim();
  return base ? `${base}\n\n${tail}` : tail;
}

/** 摘要 + 结构化必留 → 若仍为空则回退到纯 must-keep。 */
export function finalizeCompactSummary(summary: string, dropped: Message[]): string {
  const keep = extractCompactMustKeep(dropped);
  return appendMustKeepToSummary(summary, keep);
}

/** 会在 must-keep / post-compact 快照里被当作"碰过文件"的工具。 */
const FILE_TOUCHING_TOOLS = new Set(["read_file", "edit_file", "write_file", "notebook_edit"]);

/**
 * 从被压缩掉的历史里，按**倒序**取最近碰过的若干文件路径。
 *
 * 与 `extractCompactMustKeep().paths` 的区别很关键：那个是正序去重后取前 40 条
 * （= 最早碰的），用途是"别忘了这次任务涉及哪些文件"；这里要的是"模型下一步最可能
 * 立刻要看的那一两个文件"，只能从尾部取。两个语义不同，不要合并。
 */
export function recentTouchedFilePaths(messages: Message[], max = 2): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && out.length < max; i--) {
    const m = messages[i];
    if (typeof m.content === "string") continue;
    for (let j = m.content.length - 1; j >= 0 && out.length < max; j--) {
      const p = m.content[j];
      if (p.type !== "tool_call" || !FILE_TOUCHING_TOOLS.has(p.name)) continue;
      const path = pathFromArgs(p.args);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}
