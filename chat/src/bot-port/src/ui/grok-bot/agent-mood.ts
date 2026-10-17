// 移植自 cancri-code/src/ui/grok-bot/agent-mood.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * agent 运行信号 → 吉祥物表情。
 *
 * 这里只有纯函数：进来一份 AgentSignals 快照，出去一个表情名。DOM、计时器、引擎
 * 都不在这一层，方便把「什么时候该是什么脸」单独测死。真正的切换节流在
 * mood-director.ts，本文件只回答「此刻的真相是什么」。
 */

export type ChatMood =
  | "alerting"    // 出错了 / 模型不回话
  | "notifying"   // ask_user_question 在等你回答
  | "listening"   // 工具在等你审批
  | "progress"    // 显式等待（sleep / wait_for_completion），环对齐真实时长
  | "confused"    // 流式重连中
  | "loading"     // 一段时间没有任何动静
  | "writing"     // 写/改文件
  | "working"     // 跑命令 / 其它有副作用的工具
  | "searching"   // 读文件 / grep / glob / 语义检索
  | "receiving"   // 联网抓取
  | "dictating"   // 你正在输入
  | "humming"     // 任务已经跑了很久
  | "thinking"    // 在想 / 在写正文
  | "happy"       // 收尾：成功
  | "sad"         // 收尾：失败
  | "drowsy"      // 收尾：被中断
  | "idle";

export type TurnPhase = "idle" | "running" | "done-ok" | "done-error" | "done-abort";

export interface WaitWindow {
  startedAt: number;
  /** agent 自己声明的等待时长；null 表示只知道在等、不知道多久 */
  durationMs: number | null;
}

export interface AgentSignals {
  phase: TurnPhase;
  /** 本轮开始时间；phase === "idle" 时无意义 */
  turnStartedAt: number;
  /** 最近一次收到任何 agent 事件的时间 */
  lastEventAt: number;
  /** 正在执行的工具名；没有则 null */
  activeTool: string | null;
  /** 显式等待窗口（sleep / wait_for_completion） */
  wait: WaitWindow | null;
  awaitingApproval: boolean;
  awaitingAsk: boolean;
  retrying: boolean;
  errored: boolean;
  /** 用户正在 composer 里打字 */
  userTyping: boolean;
}

export interface MoodThresholds {
  /** 多久没有任何事件算「模型没反应」 */
  stallMs: number;
  /** 一轮跑多久算「已经很长」 */
  longRunMs: number;
}

export const DEFAULT_THRESHOLDS: MoodThresholds = {
  stallMs: 12_000,
  longRunMs: 90_000,
};

export function createSignals(now: number): AgentSignals {
  return {
    phase: "idle",
    turnStartedAt: now,
    lastEventAt: now,
    activeTool: null,
    wait: null,
    awaitingApproval: false,
    awaitingAsk: false,
    retrying: false,
    errored: false,
    userTyping: false,
  };
}

const WRITE_TOOLS = new Set([
  "write_file", "edit_file", "notebook_edit", "todo_write",
]);

const SHELL_TOOLS = new Set([
  "bash", "powershell", "bash_output", "kill_shell",
  "sandbox_guest_exec", "sandbox_process_start", "sandbox_dependency_install",
]);

const LOOKUP_TOOLS = new Set([
  "read_file", "grep", "glob", "codebase_search", "list_dir",
  "diagnostics", "problems", "lsp", "tool_search",
  "search_knowledge_base", "list_knowledge_bases", "read_knowledge_base_entry",
  "todo_read", "list_memories",
]);

const NET_TOOLS = new Set(["web_fetch", "web_search", "generate_image", "generate_video"]);

/** 显式声明等待时长的工具 → 参数里装时长的字段名 */
export const WAIT_TOOL_FIELDS: Record<string, string> = {
  sleep: "duration_ms",
  wait_for_completion: "timeout_ms",
};

export function isWaitTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(WAIT_TOOL_FIELDS, name);
}

/**
 * 从工具入参里抠出声明的等待毫秒数。
 * 拿不到（参数没解析出来 / 不是数字）返回 null —— 调用方应退化成不带进度的等待动画，
 * 而不是编一个假的时长，否则环会走得跟真实等待对不上。
 */
export function readWaitDuration(toolName: string, args: unknown): number | null {
  const field = WAIT_TOOL_FIELDS[toolName];
  if (!field || typeof args !== "object" || args === null) return null;
  const raw = (args as Record<string, unknown>)[field];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

/** 工具名 → 表情。未知工具按「有副作用」保守处理，给 working。 */
export function moodForTool(name: string): ChatMood {
  if (WRITE_TOOLS.has(name)) return "writing";
  if (SHELL_TOOLS.has(name)) return "working";
  if (LOOKUP_TOOLS.has(name)) return "searching";
  if (NET_TOOLS.has(name)) return "receiving";
  return "working";
}

/**
 * 优先级从上到下，命中即返回。顺序就是「哪件事更该被看见」：
 * 出错 > 等你 > 显式等待 > 没反应 > 具体在干什么 > 你在打字 > 跑得久 > 在想。
 */
export function decideChatMood(
  s: AgentSignals,
  now: number,
  th: MoodThresholds = DEFAULT_THRESHOLDS,
): ChatMood {
  if (s.errored) return "alerting";
  if (s.awaitingAsk) return "notifying";
  if (s.awaitingApproval) return "listening";

  if (s.phase === "running") {
    if (s.wait) return "progress";
    if (s.retrying) return "confused";
    if (now - s.lastEventAt >= th.stallMs) return "loading";
    if (s.activeTool) return moodForTool(s.activeTool);
    if (s.userTyping) return "dictating";
    if (now - s.turnStartedAt >= th.longRunMs) return "humming";
    return "thinking";
  }

  if (s.phase === "done-ok") return "happy";
  if (s.phase === "done-error") return "sad";
  if (s.phase === "done-abort") return "drowsy";
  return "idle";
}

/**
 * 进度环的填充比例 0..1。没有声明时长时返回 null —— 调用方应让引擎走它自己的
 * 循环动画，而不是画一个假进度。
 */
export function waitProgress(wait: WaitWindow | null, now: number): number | null {
  if (!wait || wait.durationMs === null || wait.durationMs <= 0) return null;
  const ratio = (now - wait.startedAt) / wait.durationMs;
  return Math.min(1, Math.max(0, ratio));
}
