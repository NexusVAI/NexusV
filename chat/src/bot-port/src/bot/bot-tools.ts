// 移植自 cancri-code/src/bot/bot-tools.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Bot 的工具集。
 *
 * 和 IDE 的 sandbox_* 工具的两处刻意差异：
 *   1. **浏览器走纯文本**。默认模型 gpt-6-luna 是纯文本线（图片入参 400，见
 *      live-catalog-cold-seed.ts 的实测注释），而 `sandbox_browser` 要求模型先「看到图」
 *      才放行操作 —— 对纯文本模型它永远不放行。这里每个动作之后自动取一次
 *      `snapshot`（正文 + 可点元素中心坐标），模型据此定位下一步。
 *   2. **默认免审批**。电脑是 Bot 自己的（隔离的云沙箱，不是用户本机），这是产品前提。
 *      唯一保留的闸门是出网判据：web_search / web_fetch 原样带着
 *      `requiresExplicitApproval`（会话里出现过敏感数据、或 URL 在承载数据时强制询问），
 *      Bot 界面会把它渲染成一张确认卡片。
 */
import type { AnyToolDef, ToolDef, ToolResult } from "../tools/types";
import { webSearchTool } from "../tools/builtin/websearch";
import { webFetchTool } from "../tools/builtin/webfetch";
import { uuidv4 } from "../core/id";
import {
  NOTE_KINDS,
  SELF_BLOCK_MAX,
  USER_BLOCK_MAX,
  type BotNote,
  type BotNoteKind,
  type BotProfile,
} from "./bot-store";
import { formatLocalTime, noteLine, searchBotMemory } from "./bot-memory";
import {
  TERMINAL_COMPUTER_CODES,
  UPLOAD_MAX_BYTES,
  computerErrorMessage,
  uploadBytes,
  type ActiveComputer,
  type BotComputer,
} from "./bot-computer";
import type { SandboxBrowserAction, SandboxBrowserResult } from "../sandbox/backend";
import { describeSchedule, hubErrorText, type ConvKey, type HubMonitor, type HubRoutine, type RoutineSchedule } from "./bot-cloud";

export const BOT_REACTIONS = ["👍", "😂", "👎", "❤️", "🎉", "😮", "😢", "🙏", "🔥", "👀"];

export interface BotToolDeps {
  bot: () => BotProfile;
  /** 改完记忆 / 名字后落盘 + 刷新界面 */
  commit: () => void;
  computer: BotComputer;
  rename: (name: string) => string | null;
  react: (emoji: string) => boolean;
  /** 把一张图（base64 JPEG）作为 Bot 的消息发进聊天 */
  showImage: (img: { base64: string; caption?: string }) => void;
  /**
   * 请用户从本机挑文件（聊天里弹一张卡，用户点「选择文件」才打开系统选择框）。
   * 用户拒绝 / 中断返回 null。⛔ 模型永远不能自己指定本机路径 —— 选哪个文件只由用户决定。
   */
  requestLocalFiles: (req: { reason: string; multiple: boolean }, signal: AbortSignal) => Promise<LocalFile[] | null>;
  /**
   * 每个 Bot 一台、每个群一台共用（ComputerPool）。给了就多一个 computer_power 工具：
   * 用户在聊天里说「开你自己的电脑」「把群电脑关了」「用共享电脑」时 Bot 自己去开关 / 切换。
   * `computer` 永远是当前在用的那台（群里可能是共用的，也可能是它自己的）。
   */
  power?: ComputerPower;
  /** 云端运行（BotHub）：给了就多一个 cloud_schedule 工具（定时任务 / 网站监控，关掉电脑也照跑） */
  cloud?: { api: CloudScheduleApi; conv: () => ConvKey };
  /**
   * 桌面端当前打开的工作区：给了就多一个 workspace_files 工具 —— 工作文件**不自动上传**，
   * Bot 接到任务后自己列目录、挑要用的那几个传到云电脑（凭据类文件一律拒绝）。
   */
  workspace?: WorkspaceAccess;
}

/** 工作区只读访问（桌面端由 main.ts 注入；网页端没有） */
export interface WorkspaceAccess {
  /** 当前打开的工作区绝对路径；没打开 = null */
  root(): string | null;
  /** 工作区里的文件（相对路径，`/` 分隔；已按 .gitignore 跳过噪音目录） */
  list(root: string): Promise<string[]>;
  /** 读原始字节（绝对路径）；超过 maxBytes 抛错 */
  read(absPath: string, maxBytes: number): Promise<Uint8Array>;
}

/** BotCloudLink 里给工具用的那几个方法（这里只声明形状，避免 bot-tools 依赖界面层） */
export interface CloudScheduleApi {
  isOn(): boolean;
  listSchedules(botId: string): Promise<{ routines: HubRoutine[]; monitors: HubMonitor[] }>;
  addRoutine(input: { botId: string; conv: ConvKey; title?: string; prompt: string; schedule: RoutineSchedule; allowComputer?: boolean }): Promise<HubRoutine>;
  addMonitor(input: { botId: string; conv: ConvKey; name?: string; url: string; intervalMin?: number; expectText?: string; investigate?: boolean }): Promise<HubMonitor>;
  remove(kind: "routine" | "monitor", id: string): Promise<void>;
  runNow(id: string): Promise<void>;
}

export type ComputerTarget = "mine" | "shared";

export interface ComputerPower {
  /** 当前用的是哪台；单聊只有 mine */
  using(): ComputerTarget;
  /** 群里才有 shared */
  hasShared(): boolean;
  computerOf(target: ComputerTarget): BotComputer;
  /** 群里切换之后用哪台（落盘） */
  use(target: ComputerTarget): void;
}

/** 浏览器 `File` 就满足它 */
export interface LocalFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export const UPLOAD_DIR = "/home/user/uploads";

export function uploadPathFor(name: string): string {
  const safe = name.replace(/[^\w.\-一-鿿]/g, "_").replace(/^\.+/, "_").slice(0, 80) || "file";
  return `${UPLOAD_DIR}/${safe}`;
}

/** 逐个传到云电脑；单个失败不挡其余的，失败原因原样带回 */
export async function uploadLocalFiles(
  computer: BotComputer,
  files: LocalFile[],
  signal: AbortSignal,
): Promise<{ done: Array<{ name: string; path: string; size: number }>; failed: Array<{ name: string; reason: string }> }> {
  const done: Array<{ name: string; path: string; size: number }> = [];
  const failed: Array<{ name: string; reason: string }> = [];
  for (const file of files) {
    if (file.size > UPLOAD_MAX_BYTES) {
      failed.push({ name: file.name, reason: `超过 ${UPLOAD_MAX_BYTES / 1024 / 1024}MB` });
      continue;
    }
    const path = uploadPathFor(file.name);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await computer.use(signal, (c) => uploadBytes(c.backend, c.sessionId, path, bytes, signal));
      done.push({ name: file.name, path, size: bytes.length });
    } catch (e) {
      signal.throwIfAborted();
      failed.push({ name: file.name, reason: computerErrorMessage(e).message });
    }
  }
  return { done, failed };
}

function ok(content: string): ToolResult {
  return { ok: true, content };
}
function fail(content: string, error: string): ToolResult {
  return { ok: false, content, error };
}

function computerFailure(e: unknown, what: string): ToolResult {
  const { code, message } = computerErrorMessage(e);
  const tail = TERMINAL_COMPUTER_CODES.has(code) ? "这个问题重试也没用，请直接如实告诉用户。" : "可以稍后再试一次。";
  return fail(`${what}失败：${message}${tail}`, code);
}

function auto<T>(def: Omit<ToolDef<T>, "needsApproval" | "availableIn" | "shouldDefer">): ToolDef<T> {
  return { ...def, needsApproval: () => "auto", availableIn: "both", shouldDefer: false };
}

// ── 记忆 ─────────────────────────────────────────────────────────────────────

interface MemoryEditArgs { block: "self" | "user"; op: "append" | "replace" | "rewrite"; text: string; old_text?: string }

function memoryEditTool(deps: BotToolDeps): ToolDef<MemoryEditArgs> {
  return auto<MemoryEditArgs>({
    name: "memory_edit",
    description:
      "改写你的常驻记忆（每轮都会出现在 <bot-memory> 里）。block=self 是关于你自己（名字、性格、你在忙的事），" +
      "block=user 是关于用户（称呼、职业、家人、习惯、在意的事）。学到稳定的新信息就立刻记，不用告诉用户你在记。" +
      "op=append 追加一句；op=replace 把 old_text 换成 text（改错/更新）；op=rewrite 整块重写（整理时用）。",
    schema: {
      type: "object",
      properties: {
        block: { type: "string", enum: ["self", "user"] },
        op: { type: "string", enum: ["append", "replace", "rewrite"] },
        text: { type: "string", description: "新内容" },
        old_text: { type: "string", description: "op=replace 时要被替换的原文（必须原样出现）" },
      },
      required: ["block", "op", "text"],
      additionalProperties: false,
    },
    validateInput(a) {
      if (!a || (a.block !== "self" && a.block !== "user")) return "block 只能是 self 或 user";
      if (!["append", "replace", "rewrite"].includes(a.op)) return "op 只能是 append / replace / rewrite";
      if (typeof a.text !== "string") return "text 必须是字符串";
      return null;
    },
    async execute(a) {
      const bot = deps.bot();
      const max = a.block === "self" ? SELF_BLOCK_MAX : USER_BLOCK_MAX;
      const cur = bot.memory[a.block];
      let next: string;
      if (a.op === "append") next = cur ? `${cur}\n${a.text.trim()}` : a.text.trim();
      else if (a.op === "rewrite") next = a.text.trim();
      else {
        if (!a.old_text || !cur.includes(a.old_text)) return fail("old_text 没有在这块记忆里原样出现，没改。请先核对原文。", "not_found");
        next = cur.replace(a.old_text, a.text);
      }
      if (next.length > max) {
        return fail(`这块记忆最多 ${max} 字，改完会有 ${next.length} 字。请用 op=rewrite 精简整理后再写。`, "too_long");
      }
      bot.memory[a.block] = next;
      deps.commit();
      return ok(`已更新（${next.length}/${max} 字）。`);
    },
  });
}

interface NoteArgs { action: "add" | "update" | "done" | "reopen" | "delete"; id?: string; text?: string; kind?: BotNoteKind; date?: string }

function findNote(bot: BotProfile, id: string | undefined): BotNote | undefined {
  if (!id) return undefined;
  const key = id.trim().replace(/^\[|\]$/g, "");
  return bot.notes.find((n) => n.id === key || n.id.startsWith(key));
}

function memoryNoteTool(deps: BotToolDeps): ToolDef<NoteArgs> {
  return auto<NoteArgs>({
    name: "memory_note",
    description:
      "记事本：存一条带类型的长期记忆。kind=fact 事实 / preference 偏好 / todo 待办（答应用户要做的、用户要你提醒的）/ event 事件（发生过或将要发生的事，带 date）。" +
      "action=add 新增；update 改文字；done/reopen 标记待办；delete 删除（用户让你忘掉时）。id 用 <bot-memory> 或 memory_search 里方括号的那串。",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "update", "done", "reopen", "delete"] },
        id: { type: "string" },
        text: { type: "string" },
        kind: { type: "string", enum: NOTE_KINDS },
        date: { type: "string", description: "YYYY-MM-DD，可省略" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(a) {
      const bot = deps.bot();
      const now = Date.now();
      const date = typeof a.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : undefined;
      if (a.action === "add") {
        const text = a.text?.trim();
        if (!text) return fail("add 需要 text。", "invalid_args");
        const kind = a.kind && NOTE_KINDS.includes(a.kind) ? a.kind : "fact";
        const dup = bot.notes.find((n) => n.text === text && n.kind === kind);
        if (dup) return ok(`已经记过了：${noteLine(dup)}`);
        const note: BotNote = { id: uuidv4(), text: text.slice(0, 500), kind, createdAt: now, updatedAt: now, ...(date ? { date } : {}), ...(kind === "todo" ? { status: "open" as const } : {}) };
        bot.notes.push(note);
        deps.commit();
        return ok(`记下了：${noteLine(note)}`);
      }
      const note = findNote(bot, a.id);
      if (!note) return fail("没找到这条记录。先用 memory_search 查到 id。", "not_found");
      if (a.action === "delete") {
        bot.notes = bot.notes.filter((n) => n !== note);
        deps.commit();
        return ok("已删除。");
      }
      if (a.action === "update") {
        if (a.text?.trim()) note.text = a.text.trim().slice(0, 500);
        if (a.kind && NOTE_KINDS.includes(a.kind)) note.kind = a.kind;
        if (date) note.date = date;
      } else if (a.action === "done" || a.action === "reopen") {
        note.kind = "todo";
        note.status = a.action === "done" ? "done" : "open";
      }
      note.updatedAt = now;
      deps.commit();
      return ok(`已更新：${noteLine(note)}`);
    },
  });
}

function memorySearchTool(deps: BotToolDeps): ToolDef<{ query: string }> {
  return auto<{ query: string }>({
    name: "memory_search",
    description: "翻旧账：在记事本、你的日记和你们全部的聊天记录里搜。用户提到「上次」「之前说过」、或你不确定以前聊过什么时先搜再答。",
    schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
    isReadOnly: true,
    async execute(a) {
      const q = typeof a?.query === "string" ? a.query.trim() : "";
      if (!q) return fail("query 不能为空。", "invalid_args");
      const hits = searchBotMemory(deps.bot(), q);
      if (!hits.length) return ok(`没搜到和「${q}」相关的记录。`);
      return ok(hits.map((h) => `${formatLocalTime(h.at)} ${h.kind === "note" ? "记事本" : h.kind === "diary" ? "日记" : "聊天"}｜${h.text}`).join("\n"));
    },
  });
}

function setNameTool(deps: BotToolDeps): ToolDef<{ name: string }> {
  return auto<{ name: string }>({
    name: "set_my_name",
    description: "用户给你起了新名字、或你们商量好换名字时调用。界面上会显示「已重命名为 X」。",
    schema: { type: "object", properties: { name: { type: "string", description: "≤24 字" } }, required: ["name"], additionalProperties: false },
    async execute(a) {
      const name = deps.rename(typeof a?.name === "string" ? a.name : "");
      return name ? ok(`好，你现在叫 ${name}。`) : fail("名字不能为空。", "invalid_args");
    },
  });
}

function reactTool(deps: BotToolDeps): ToolDef<{ emoji: string }> {
  return auto<{ emoji: string }>({
    name: "react",
    description: `给用户刚发的那条消息点一个表情（像朋友那样，偶尔用，别每条都点）。可选：${BOT_REACTIONS.join(" ")}`,
    schema: { type: "object", properties: { emoji: { type: "string", enum: BOT_REACTIONS } }, required: ["emoji"], additionalProperties: false },
    async execute(a) {
      if (!BOT_REACTIONS.includes(a?.emoji)) return fail("不支持这个表情。", "invalid_args");
      return deps.react(a.emoji) ? ok("已点。") : fail("没有可以点的用户消息。", "no_target");
    },
  });
}

// ── 电脑 ─────────────────────────────────────────────────────────────────────

const OUT_CAP = 8000;

function clip(s: string, cap = OUT_CAP): string {
  return s.length > cap ? `${s.slice(0, cap)}\n…（已截断，共 ${s.length} 字）` : s;
}

function shellTool(deps: BotToolDeps): ToolDef<{ command: string; cwd?: string; timeout_ms?: number }> {
  return auto({
    name: "computer_shell",
    description:
      "在你自己的云电脑（Linux，默认目录 /home/user）上跑一条 shell 命令。可以装软件、写脚本、处理数据、下载文件。" +
      "电脑关机/休眠时会自动开机或唤醒（开机约 10–20 秒）。不是用户的电脑，碰不到用户本机文件。",
    schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string" },
        timeout_ms: { type: "integer", description: "默认 60000，最多 120000" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    async execute(a, ctx) {
      if (typeof a?.command !== "string" || !a.command.trim()) return fail("command 不能为空。", "invalid_args");
      try {
        const r = await deps.computer.use(ctx.signal, (c) =>
          c.backend.exec({
            sessionId: c.sessionId,
            command: a.command,
            ...(a.cwd ? { cwd: a.cwd } : {}),
            timeoutMs: Math.min(Math.max(a.timeout_ms ?? 60_000, 1000), 120_000),
            signal: ctx.signal,
          }));
        const exit = r.exitCode === null ? "被终止（没有退出码）" : String(r.exitCode);
        return {
          ok: r.exitCode === 0,
          content: `退出码：${exit}${r.truncated ? "（输出被截断）" : ""}\n--- stdout ---\n${clip(r.stdout) || "（空）"}${r.stderr ? `\n--- stderr ---\n${clip(r.stderr, 4000)}` : ""}`,
          ...(r.exitCode === 0 ? {} : { error: "nonzero_exit" }),
        };
      } catch (e) {
        return computerFailure(e, "运行命令");
      }
    },
  });
}

function fileTool(deps: BotToolDeps): ToolDef<{ action: "read" | "write"; path: string; content?: string }> {
  return auto({
    name: "computer_file",
    description: "读或写你云电脑上的文本文件（action=read / write）。路径建议放在 /home/user 下。",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write"] },
        path: { type: "string" },
        content: { type: "string", description: "write 时的完整内容" },
      },
      required: ["action", "path"],
      additionalProperties: false,
    },
    async execute(a, ctx) {
      if (typeof a?.path !== "string" || !a.path.trim()) return fail("path 不能为空。", "invalid_args");
      try {
        if (a.action === "write") {
          if (typeof a.content !== "string") return fail("write 需要 content。", "invalid_args");
          await deps.computer.use(ctx.signal, (c) => c.backend.writeFile({ sessionId: c.sessionId, path: a.path, content: a.content!, signal: ctx.signal }));
          return ok(`已写入 ${a.path}（${a.content.length} 字）。`);
        }
        const text = await deps.computer.use(ctx.signal, (c) => c.backend.readFile({ sessionId: c.sessionId, path: a.path, signal: ctx.signal }));
        return ok(clip(text) || "（空文件）");
      } catch (e) {
        return computerFailure(e, a.action === "write" ? "写文件" : "读文件");
      }
    },
  });
}

interface BrowserArgs { action: "open" | "look" | "click" | "type" | "key" | "scroll" | "back"; url?: string; x?: number; y?: number; text?: string; key?: string; dy?: number }

const BROWSER_KEYS = ["Enter", "Tab", "Escape", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}

/** 刚开机时浏览器还要几秒才起来：browser_starting 是正常过渡态，等一等再试 */
async function callBrowser(c: ActiveComputer, signal: AbortSignal, action: SandboxBrowserAction, retryMs: number): Promise<SandboxBrowserResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await c.backend.browser({ sessionId: c.sessionId, signal, ...action });
    } catch (e) {
      const code = computerErrorMessage(e).code;
      if (code !== "browser_starting" || attempt >= 12) throw e;
      await sleep(retryMs, signal);
    }
  }
}

const NO_BROWSER = "这台电脑没有浏览器。可以在电脑面板里关机，下次会自动开一台带浏览器的。";

export function browserTool(deps: BotToolDeps, opts: { startRetryMs?: number } = {}): ToolDef<BrowserArgs> {
  const retryMs = opts.startRetryMs ?? 2500;
  return auto<BrowserArgs>({
    name: "browser",
    description:
      "用你云电脑上的 Chrome 上网办事（视口 1280×800）。用户能在「电脑」面板实时看到你的操作。\n" +
      "action=open 打开网址；look 读当前页面；click 按坐标点；type 往当前焦点输入文字（先 click 输入框）；key 按键；scroll 滚动（dy 正数向下）；back 后退。\n" +
      "每个动作结束都会返回页面正文和「可点元素」列表，形如 `[x,y] <tag> 文字`，click 直接用那对坐标。看不到想要的就 scroll 再 look。\n" +
      "只能打开 http/https。要看你在电脑上写的网页文件：先用 computer_shell 后台起服务（如 `nohup python3 -m http.server 8000 -d /home/user >/tmp/http.log 2>&1 &`），再 open http://localhost:8000/文件名。",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["open", "look", "click", "type", "key", "scroll", "back"] },
        url: { type: "string" },
        x: { type: "integer" },
        y: { type: "integer" },
        text: { type: "string" },
        key: { type: "string", enum: BROWSER_KEYS },
        dy: { type: "integer" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    validateInput(a) {
      if (!a || typeof a.action !== "string") return "action 必须是字符串";
      if (a.action === "open" && (typeof a.url !== "string" || !/^https?:\/\//i.test(a.url.trim()))) return "open 需要 http/https 开头的 url";
      if (a.action === "click" && (!Number.isFinite(a.x) || !Number.isFinite(a.y))) return "click 需要 x 和 y";
      if (a.action === "type" && typeof a.text !== "string") return "type 需要 text";
      if (a.action === "key" && !BROWSER_KEYS.includes(a.key ?? "")) return `key 只能是 ${BROWSER_KEYS.join(" / ")}`;
      return null;
    },
    async execute(a, ctx) {
      if (deps.computer.userControl) {
        return fail("用户正在亲手操作这台电脑（接管中），你先别动浏览器。告诉用户你在等，等用户点「结束控制」后再继续。", "user_in_control");
      }
      try {
        return await deps.computer.use(ctx.signal, async (c) => {
          if (!c.hasBrowser && !c.browserUnknown) return fail(NO_BROWSER, "no_browser");
          const call = (action: SandboxBrowserAction) => callBrowser(c, ctx.signal, action, retryMs);
          switch (a.action) {
            case "open": await call({ action: "navigate", url: a.url!.trim() }); break;
            case "click": await call({ action: "click", x: Math.round(a.x!), y: Math.round(a.y!) }); break;
            case "type": await call({ action: "type", text: a.text! }); break;
            case "key": await call({ action: "key", key: a.key! }); break;
            case "scroll": await call({ action: "scroll", dy: Math.round(a.dy ?? 600) }); break;
            case "back": await call({ action: "eval", expression: "history.back(), 'ok'" }); await sleep(800, ctx.signal); break;
            case "look": break;
            default: return fail("不支持的 action。", "invalid_args");
          }
          const snap = await call({ action: "snapshot" });
          const where = snap.url ? `${snap.title ? `${snap.title} — ` : ""}${snap.url}` : "（未知页面）";
          return ok(`当前页面：${where}\n\n${clip(snap.text ?? "（页面没有可读文字）", 10_000)}`);
        });
      } catch (e) {
        return computerFailure(e, "浏览器操作");
      }
    },
  });
}

export function screenshotTool(deps: BotToolDeps, opts: { startRetryMs?: number } = {}): ToolDef<{ caption?: string; full_page?: boolean }> {
  const retryMs = opts.startRetryMs ?? 2500;
  return auto({
    name: "computer_screenshot",
    description:
      "把你云电脑上 Chrome 当前的画面截图，直接发到聊天里给用户看。用户说「截图给我」「让我看看」时用它。" +
      "先用 browser 打开要给用户看的页面再截。caption 是随图的一句话（可省）。full_page=true 截整页长图。" +
      "注意：图片只给用户看，你自己看不到图里的内容；要知道页面上有什么用 browser look。",
    schema: {
      type: "object",
      properties: {
        caption: { type: "string", description: "随图发的一句话，≤100 字" },
        full_page: { type: "boolean" },
      },
      additionalProperties: false,
    },
    async execute(a, ctx) {
      try {
        const shot = await deps.computer.use(ctx.signal, async (c) => {
          if (!c.hasBrowser && !c.browserUnknown) return null;
          return callBrowser(c, ctx.signal, { action: "screenshot", ...(a?.full_page === true ? { fullPage: true } : {}) }, retryMs);
        });
        if (!shot) return fail(NO_BROWSER, "no_browser");
        if (!shot.screenshotBase64) return fail("截图是空的，没发出去。可以稍后再试一次。", "empty_screenshot");
        const caption = typeof a?.caption === "string" ? a.caption.trim().slice(0, 100) : "";
        deps.showImage({ base64: shot.screenshotBase64, ...(caption ? { caption } : {}) });
        const where = shot.url ? `${shot.title ? `${shot.title} — ` : ""}${shot.url}` : "当前页面";
        return ok(`截图已经发到聊天里，用户能看到了（${where}）。不用再描述图片，也别说你看到了图里的细节。`);
      } catch (e) {
        return computerFailure(e, "截图");
      }
    },
  });
}

export function localFileTool(deps: BotToolDeps): ToolDef<{ reason: string; multiple?: boolean }> {
  return auto({
    name: "request_local_file",
    description:
      `弹一张卡请用户亲自挑本机文件，传到你云电脑的 ${UPLOAD_DIR}/ 下。有 pc_files / pc_to_computer 时优先自己找、自己传（任何盘、整个文件夹都行），` +
      "只有用户想自己挑、或你确实找不到时才用这个。reason 写清楚你要什么文件、拿来做什么（用户会看到这句话）。用户拒绝了就别反复要。",
    schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "给用户看的一句话，例如「把要改的那份简历发我一下」" },
        multiple: { type: "boolean", description: "允许一次选多个文件" },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    validateInput(a) {
      if (!a || typeof a.reason !== "string" || !a.reason.trim()) return "reason 不能为空";
      return null;
    },
    async execute(a, ctx) {
      const files = await deps.requestLocalFiles({ reason: a.reason.trim().slice(0, 200), multiple: a.multiple === true }, ctx.signal);
      if (!files?.length) return fail("用户没有给文件（拒绝了或取消了）。别再追着要，问问用户还需不需要。", "user_declined");
      try {
        const { done, failed } = await uploadLocalFiles(deps.computer, files, ctx.signal);
        const lines = [
          ...done.map((f) => `✓ ${f.name} → ${f.path}（${f.size} 字节）`),
          ...failed.map((f) => `✗ ${f.name}：${f.reason}`),
        ];
        if (!done.length) return fail(`文件都没传上去：\n${lines.join("\n")}`, "upload_failed");
        return ok(`用户给了文件，已放到你的电脑上：\n${lines.join("\n")}`);
      } catch (e) {
        return computerFailure(e, "传文件");
      }
    },
  });
}

// ── 工作区文件 → 云电脑（Bot 自己挑） ─────────────────────────────────────────

export const WORKSPACE_UPLOAD_DIR = `${UPLOAD_DIR}/workspace`;
const WORKSPACE_LIST_MAX = 300;
const WORKSPACE_UPLOAD_FILES = 10;
const WORKSPACE_UPLOAD_TOTAL = 60 * 1024 * 1024;

/** 凭据 / 密钥 / 私有配置：就算在工作区里也不往外传（与 IDE 的凭据路径闸门同一类东西，Rust 侧还会再挡一次） */
export function isSecretWorkspacePath(rel: string): boolean {
  const p = rel.replace(/\\/g, "/").toLowerCase();
  const name = p.slice(p.lastIndexOf("/") + 1);
  if (/(^|\/)(\.git|\.ssh|\.aws|\.gnupg|\.azure|\.kube|\.docker|\.cancri)(\/|$)/.test(p)) return true;
  if (/^\.env(\..*)?$/.test(name) && !/\.(example|sample|template)$/.test(name)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx|ovpn|ppk)$/.test(name)) return true;
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/.test(name)) return true;
  if (/^(\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|service[-_]account.*\.json|\.dev\.vars)$/.test(name)) return true;
  return false;
}

/** 相对路径 → 云电脑上的位置（保留目录结构；每段去掉怪字符） */
export function workspaceUploadPath(rel: string): string {
  const segs = rel.replace(/\\/g, "/").split("/").filter((x) => x && x !== "." && x !== "..");
  const safe = segs.map((x) => x.replace(/[^\w.\-一-鿿]/g, "_").replace(/^\.+(?=.)/, (m) => "_".repeat(m.length)).slice(0, 80) || "_");
  return `${WORKSPACE_UPLOAD_DIR}/${safe.join("/") || "file"}`;
}

interface WorkspaceArgs { action: "list" | "upload"; query?: string; paths?: string[]; limit?: number }

export function workspaceFilesTool(deps: BotToolDeps & { workspace: WorkspaceAccess }): ToolDef<WorkspaceArgs> {
  const ws = deps.workspace;
  return auto({
    name: "workspace_files",
    description:
      "用户电脑上当前打开的工作区（项目文件夹）。文件**不会自动传给你**：接到要用到项目文件的任务时，先 action=list 看有哪些（可用 query 按文件名 / 路径关键字筛，空格分隔多个词），" +
      `再 action=upload 挑真正需要的几个（一次最多 ${WORKSPACE_UPLOAD_FILES} 个，单个 ≤ ${UPLOAD_MAX_BYTES / 1024 / 1024}MB），会原样放到你云电脑的 ${WORKSPACE_UPLOAD_DIR}/<相对路径>。` +
      "只传和任务有关的，别整个项目往上搬；.env、密钥、凭据类文件一律传不了。没打开工作区时，用户电脑上的文件用 pc_files 找、pc_to_computer 传（整个文件夹也行）。",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "upload"] },
        query: { type: "string", description: "list：按路径关键字筛（大小写不敏感，空格分隔 = 都要包含），例如「src test」「.xlsx」" },
        limit: { type: "number", description: `list：最多列多少条（默认 100，最多 ${WORKSPACE_LIST_MAX}）` },
        paths: { type: "array", items: { type: "string" }, description: "upload：要传的文件，list 里给出的相对路径" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    validateInput(a) {
      if (!a || (a.action !== "list" && a.action !== "upload")) return "action 只能是 list / upload";
      if (a.action === "upload" && (!Array.isArray(a.paths) || !a.paths.length)) return "upload 需要 paths";
      if (a.action === "upload" && a.paths!.length > WORKSPACE_UPLOAD_FILES) return `一次最多传 ${WORKSPACE_UPLOAD_FILES} 个文件`;
      return null;
    },
    async execute(a, ctx) {
      const root = ws.root();
      if (!root) return fail("用户现在没有在 Cancri Code 里打开工作区。用户电脑上的文件直接用 pc_files 找、pc_to_computer 传（整个文件夹也行）；没有这两个工具时再请用户打开项目文件夹。", "no_workspace");
      let files: string[];
      try {
        files = (await ws.list(root)).map((p) => p.replace(/\\/g, "/"));
      } catch (e) {
        return fail(`读不到工作区文件列表：${e instanceof Error ? e.message : String(e)}`, "list_failed");
      }
      const visible = files.filter((p) => !isSecretWorkspacePath(p));
      if (a.action === "list") {
        const words = (a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const hits = words.length ? visible.filter((p) => words.every((w) => p.toLowerCase().includes(w))) : visible;
        const limit = Math.min(WORKSPACE_LIST_MAX, Math.max(1, Math.floor(Number(a.limit) || 100)));
        if (!hits.length) return ok(words.length ? `工作区里没有路径包含「${words.join(" ")}」的文件（共 ${visible.length} 个文件）。换个关键字试试。` : "工作区是空的。");
        const shown = hits.slice(0, limit);
        const more = hits.length > shown.length ? `\n……还有 ${hits.length - shown.length} 个，用 query 缩小范围。` : "";
        return ok(`工作区「${root.replace(/\\/g, "/").split("/").pop()}」里${words.length ? "匹配的" : ""}文件 ${hits.length} 个：\n${shown.join("\n")}${more}`);
      }
      const known = new Map(visible.map((p) => [p.toLowerCase(), p]));
      const done: string[] = [];
      const failed: string[] = [];
      let total = 0;
      const sep = root.includes("\\") ? "\\" : "/";
      for (const raw of [...new Set(a.paths!.map((x) => String(x).trim().replace(/\\/g, "/").replace(/^\.?\//, "")))]) {
        if (!raw) continue;
        if (isSecretWorkspacePath(raw)) {
          failed.push(`✗ ${raw}：凭据 / 密钥类文件不能传`);
          continue;
        }
        const rel = known.get(raw.toLowerCase());
        if (!rel || /(^|\/)\.\.(\/|$)/.test(raw) || /^([a-z]:|\/)/i.test(raw)) {
          failed.push(`✗ ${raw}：工作区里没有这个文件（要用 list 给出的相对路径）`);
          continue;
        }
        try {
          const abs = root.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep);
          const bytes = await ws.read(abs, UPLOAD_MAX_BYTES);
          if (total + bytes.length > WORKSPACE_UPLOAD_TOTAL) {
            failed.push(`✗ ${rel}：这一次传的总量超过 ${WORKSPACE_UPLOAD_TOTAL / 1024 / 1024}MB，分几次传`);
            continue;
          }
          const path = workspaceUploadPath(rel);
          await deps.computer.use(ctx.signal, (c) => uploadBytes(c.backend, c.sessionId, path, bytes, ctx.signal));
          total += bytes.length;
          done.push(`✓ ${rel} → ${path}（${bytes.length} 字节）`);
        } catch (e) {
          ctx.signal.throwIfAborted();
          const msg = e instanceof Error ? e.message : String(e);
          failed.push(`✗ ${rel}：${/too large/.test(msg) ? `超过 ${UPLOAD_MAX_BYTES / 1024 / 1024}MB` : computerErrorMessage(e).message || msg}`);
        }
      }
      const lines = [...done, ...failed].join("\n");
      if (!done.length) return fail(`文件都没传上去：\n${lines}`, "upload_failed");
      return ok(`已从工作区传到你的电脑：\n${lines}`);
    },
  });
}

/** 出网工具：审批档放到 auto，但出网硬闸门（requiresExplicitApproval）原样保留。 */
function withAutoApproval<T>(tool: ToolDef<T>): ToolDef<T> {
  return { ...tool, needsApproval: () => "auto", shouldDefer: false };
}

interface PowerArgs { action: "status" | "on" | "sleep" | "off" | "use"; target?: ComputerTarget }

const TARGET_LABEL: Record<ComputerTarget, string> = { mine: "你自己的电脑", shared: "群里共用的电脑" };

export function computerPowerTool(deps: BotToolDeps & { power: ComputerPower }): ToolDef<PowerArgs> {
  const p = deps.power;
  return auto<PowerArgs>({
    name: "computer_power",
    description:
      "管理云电脑的开关。你有自己的一台电脑；在群里时群成员还共用一台「群电脑」（默认用它，大家能在同一台上接力）。" +
      "用户说「开 / 关 / 休眠你的电脑」「用你自己的电脑」「用群里的电脑」时调用。target=mine 自己的，shared 群共用的（缺省=当前在用的那台）。" +
      "action：status 看两台的状态；on 开机（约 10–20 秒）；sleep 休眠（保留文件，按秒计费停止，下次几秒唤醒，平时用它）；" +
      "off 关机（⚠ 电脑里的文件会清空，只在用户明确要求关机时用）；use 群里切换之后用哪台。" +
      "免费计划同时只能开 1 台：开不了就如实告诉用户，可以建议先让另一台休眠或关机。" +
      "其他工具需要电脑时会自动开机 / 唤醒，平时不用先调 on。",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "on", "sleep", "off", "use"] },
        target: { type: "string", enum: ["mine", "shared"] },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(a, ctx) {
      const target: ComputerTarget = a?.target === "shared" || a?.target === "mine" ? a.target : p.using();
      if (target === "shared" && !p.hasShared()) return fail("这里是单聊，没有群共用的电脑；你只有自己的那台。", "no_shared_computer");
      const pc = p.computerOf(target);
      const label = TARGET_LABEL[target];
      try {
        switch (a?.action) {
          case "status": {
            const lines = [`${TARGET_LABEL.mine}：${p.computerOf("mine").describe()}${p.using() === "mine" ? "（当前在用）" : ""}`];
            if (p.hasShared()) lines.push(`${TARGET_LABEL.shared}：${p.computerOf("shared").describe()}${p.using() === "shared" ? "（当前在用）" : ""}`);
            return ok(lines.join("\n"));
          }
          case "on":
            await pc.ensure(ctx.signal);
            await pc.wake();
            return ok(`${label}已经开好了：${pc.describe()}`);
          case "sleep":
            await pc.sleep();
            return ok(`${label}已休眠，文件都在，下次用会自动唤醒。`);
          case "off":
            await pc.shutdown();
            return ok(`${label}已关机。`);
          case "use":
            if (!p.hasShared()) return fail("单聊里只有你自己的电脑，不用切换。", "no_shared_computer");
            p.use(target);
            return ok(`好了，之后在这个群里你用${label}（${pc.describe()}）。`);
          default:
            return fail("action 只能是 status / on / sleep / off / use。", "bad_args");
        }
      } catch (e) {
        return computerFailure(e, a?.action === "on" ? "开机" : a?.action === "sleep" ? "休眠" : a?.action === "off" ? "关机" : "电脑操作");
      }
    },
  });
}

interface CloudArgs {
  action: "list" | "add_routine" | "add_monitor" | "delete" | "run_now";
  title?: string;
  prompt?: string;
  daily_time?: string;
  every_minutes?: number;
  allow_computer?: boolean;
  url?: string;
  name?: string;
  interval_min?: number;
  expect_text?: string;
  investigate?: boolean;
  kind?: "routine" | "monitor";
  id?: string;
}

const CLOUD_OFF = "云端运行还没连上（或这个账号暂未开放），定时任务和监控暂时用不了。告诉用户：保持登录、联网后会自动连接，稍后再试。";

function fmtWhen(at: number): string {
  return at ? formatLocalTime(at) : "—";
}

export function cloudScheduleTool(deps: BotToolDeps & { cloud: NonNullable<BotToolDeps["cloud"]> }): ToolDef<CloudArgs> {
  const c = deps.cloud;
  return auto<CloudArgs>({
    name: "cloud_schedule",
    description:
      "云端日程：用户关掉电脑后你也在云端按时做事、盯着网站。" +
      "用户说「每天早上 9 点给我讲新闻」「每隔 2 小时看一下 xx」「帮我盯着这个网站，挂了告诉我」「我的定时任务有哪些」「取消那个提醒」时调用。" +
      "action：list 列出你的定时任务和监控；add_routine 新建定时任务（prompt=到点时交给你自己的指令，要写清楚做什么、发什么；" +
      "daily_time=「09:00」 每天定点，或 every_minutes≥5 按间隔；allow_computer=true 才允许它开云电脑，耗额度，用户没要求就别开）；" +
      "add_monitor 新建网站监控（url 必须是公网 http/https；interval_min 默认 5；expect_text 页面必须包含的字；" +
      "investigate=true 时连续出错会开云电脑截图排查）；delete 删除（kind + id，id 用 list 看）；run_now 立刻跑一次定时任务（测试用）。" +
      "到点 / 出事时云端的你会在这个会话里主动发消息。建好后用一句话告诉用户安排了什么、什么时候第一次跑。",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add_routine", "add_monitor", "delete", "run_now"] },
        title: { type: "string", description: "定时任务的短名字（≤20 字）" },
        prompt: { type: "string", description: "到点时交给你自己的指令" },
        daily_time: { type: "string", description: "每天几点，24 小时制 HH:MM（用户本地时间）" },
        every_minutes: { type: "integer", description: "每隔几分钟（≥5）" },
        allow_computer: { type: "boolean" },
        url: { type: "string" },
        name: { type: "string", description: "监控的短名字" },
        interval_min: { type: "integer", description: "每隔几分钟检查一次（≥5）" },
        expect_text: { type: "string" },
        investigate: { type: "boolean" },
        kind: { type: "string", enum: ["routine", "monitor"] },
        id: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(a) {
      if (!c.api.isOn()) return fail(CLOUD_OFF, "cloud_off");
      const botId = deps.bot().id;
      try {
        switch (a?.action) {
          case "list": {
            const { routines, monitors } = await c.api.listSchedules(botId);
            if (!routines.length && !monitors.length) return ok("你在云端还没有定时任务和监控。");
            const lines = [
              ...routines.map((r) => `routine ${r.id}｜${r.title}｜${describeSchedule(r.schedule)}｜${r.enabled ? (r.pausedReason ? `已暂停（${r.pausedReason}）` : `下次 ${fmtWhen(r.nextAt)}`) : "已停用"}${r.allowComputer ? "｜可开电脑" : ""}`),
              ...monitors.map((m) => `monitor ${m.id}｜${m.name}｜${m.url}｜每 ${m.intervalMin} 分钟｜${m.state === "down" ? "异常" : "正常"}${m.lastCheckedAt ? `（上次检查 ${fmtWhen(m.lastCheckedAt)}）` : ""}`),
            ];
            return ok(lines.join("\n"));
          }
          case "add_routine": {
            const prompt = String(a.prompt ?? "").trim();
            if (!prompt) return fail("prompt 不能为空：写清楚到点时要做什么。", "bad_args");
            let schedule: RoutineSchedule;
            if (a.daily_time) {
              if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.daily_time)) return fail("daily_time 要写成 HH:MM，例如 09:00。", "bad_args");
              schedule = { kind: "daily", time: a.daily_time, tzOffsetMin: -new Date().getTimezoneOffset() };
            } else if (Number.isFinite(a.every_minutes)) {
              if (Number(a.every_minutes) < 5) return fail("最短 5 分钟一次。", "bad_args");
              schedule = { kind: "interval", minutes: Math.floor(Number(a.every_minutes)) };
            } else return fail("要给 daily_time（每天几点）或 every_minutes（每隔几分钟）。", "bad_args");
            const r = await c.api.addRoutine({ botId, conv: c.conv(), prompt, schedule, ...(a.title ? { title: a.title.slice(0, 20) } : {}), allowComputer: a.allow_computer === true });
            return ok(`已在云端建好定时任务「${r.title}」（${describeSchedule(r.schedule)}），第一次在 ${fmtWhen(r.nextAt)}。id=${r.id}`);
          }
          case "add_monitor": {
            const url = String(a.url ?? "").trim();
            if (!/^https?:\/\//i.test(url)) return fail("url 要是完整的 http/https 地址。", "bad_args");
            const m = await c.api.addMonitor({
              botId,
              conv: c.conv(),
              url,
              ...(a.name ? { name: a.name.slice(0, 40) } : {}),
              ...(Number.isFinite(a.interval_min) ? { intervalMin: Number(a.interval_min) } : {}),
              ...(a.expect_text ? { expectText: a.expect_text } : {}),
              investigate: a.investigate !== false,
            });
            return ok(`已在云端开始监控「${m.name}」（${m.url}，每 ${m.intervalMin} 分钟检查，连续 ${m.failThreshold} 次异常会告诉用户${m.investigate ? "，并开云电脑截图排查" : ""}）。id=${m.id}`);
          }
          case "delete":
            if (!a.id || (a.kind !== "routine" && a.kind !== "monitor")) return fail("delete 要给 kind（routine / monitor）和 id。", "bad_args");
            await c.api.remove(a.kind, a.id);
            return ok(a.kind === "routine" ? "定时任务已删除。" : "监控已删除。");
          case "run_now":
            if (!a.id) return fail("run_now 要给定时任务的 id。", "bad_args");
            await c.api.runNow(a.id);
            return ok("已经让云端马上跑一次，结果稍后会发在会话里。");
          default:
            return fail("action 只能是 list / add_routine / add_monitor / delete / run_now。", "bad_args");
        }
      } catch (e) {
        return fail(hubErrorText(e), "cloud_error");
      }
    },
  });
}

export function createBotTools(deps: BotToolDeps): AnyToolDef[] {
  const power = deps.power;
  return [
    memoryEditTool(deps),
    memoryNoteTool(deps),
    memorySearchTool(deps),
    setNameTool(deps),
    reactTool(deps),
    shellTool(deps),
    fileTool(deps),
    browserTool(deps),
    screenshotTool(deps),
    localFileTool(deps),
    withAutoApproval(webSearchTool),
    withAutoApproval(webFetchTool),
    ...(power ? [computerPowerTool({ ...deps, power })] : []),
    ...(deps.cloud ? [cloudScheduleTool({ ...deps, cloud: deps.cloud })] : []),
    ...(deps.workspace ? [workspaceFilesTool({ ...deps, workspace: deps.workspace })] : []),
  ] as AnyToolDef[];
}

/** 工具 → 用户看到的那行「正在…」。⛔ 不显示参数原文里的长内容，只挑一个短提示。 */
export function describeToolActivity(name: string, args: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const host = (u: unknown) => {
    try { return typeof u === "string" ? new URL(u).host : ""; } catch { return ""; }
  };
  switch (name) {
    case "browser":
      if (a.action === "open") return `正在打开 ${host(a.url) || "网页"}…`;
      // ⛔ 不能写「正在输入…」：群聊头部把它显示成「X 正在输入…」，会被当成要发消息了
      if (a.action === "type") return "正在网页里填写…";
      if (a.action === "click") return "正在点击页面…";
      if (a.action === "scroll") return "正在滚动页面…";
      return "正在浏览网页…";
    case "computer_shell": return "正在执行命令…";
    case "computer_file": return a.action === "write" ? "正在写文件…" : "正在读文件…";
    case "computer_screenshot": return "正在截图…";
    case "request_local_file": return "等待你选择文件…";
    case "workspace_files": return a.action === "upload" ? "正在把项目文件传到电脑…" : "正在看项目里的文件…";
    case "computer_power":
      return a.action === "on" ? "正在开电脑…" : a.action === "sleep" ? "正在让电脑休眠…" : a.action === "off" ? "正在关电脑…" : "正在看电脑状态…";
    case "web_search": return typeof a.query === "string" ? `正在搜「${a.query.slice(0, 24)}」…` : "正在搜索…";
    case "web_fetch": return `正在读取 ${host(a.url) || "网页"}…`;
    case "memory_search": return "正在查找记忆…";
    case "cloud_schedule": return a.action === "list" ? "正在看日程…" : "正在安排日程…";
    // pc_*：用户自己的电脑（「你」= 用户），和 Bot 自己的云电脑（computer_*）区分开
    case "pc_status": return "正在看你电脑的状态…";
    case "pc_files": return a.action === "search" ? "正在你电脑上找文件…" : a.action === "read" ? "正在读你电脑上的文件…" : "正在看你电脑上的文件…";
    case "pc_screenshot": return "正在截你电脑的屏幕…";
    case "pc_screen_record": return "正在录你电脑的屏幕…";
    case "pc_send_file": return "正在从你电脑发文件…";
    case "pc_notify": return "正在给你电脑发通知…";
    case "pc_open": return "正在你电脑上打开…";
    case "pc_to_computer": return "正在把你电脑上的文件传到云电脑…";
    case "computer_to_pc": return "正在把文件下载到你电脑…";
    case "memory_edit":
    case "memory_note": return "已记录";
    default: return "正在处理…";
  }
}
