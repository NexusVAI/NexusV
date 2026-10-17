// 移植自 cancri-code/src/chat/render/rich-ui-core.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 智能交互界面 · 公共底座（rich-ui.ts 与 rich-ui-widgets.ts 共用）。
 *
 *   · 不可信输入的取值助手（str / num / arr …）与数字格式化；
 *   · 模板与绑定：`{expr}` / `{expr:2}` / `{label:id}` 文本插值，字段值写 `"=expr"` 即公式
 *     （「应用」组件靠它让滑块驱动图形与指标，全程本地重算、不调模型）；
 *   · 半截 JSON 解析（流式时先画出已经写完的条目）与轻量修复（尾逗号 / 注释）；
 *   · 图片来源闸门：远程图只认工具结果里出现过的原样 URL，本地路径交给宿主解析。
 *
 * ⛔ 这里的一切输入都来自模型输出：只产出转义后的文本 / 白名单 class，不拼任何可执行内容。
 */
import { escapeAttr, escapeHtml } from "../format";
import { evaluateFormula } from "./rich-ui-formula";
import { RICH_UI_ICONS } from "./rich-ui-icons";

export type Json = Record<string, unknown>;

export interface RichUiRenderContext {
  /** 行内 Markdown（**粗体** / `code` / 链接 / [[cite:URL]]），入参是未转义文本，返回安全 HTML。 */
  inline: (s: string) => string;
  /** 块级 Markdown（标签页 / 文本面板正文用）。 */
  block: (s: string) => string;
  /** 围栏还没闭合（流式输出中）。 */
  open: boolean;
}

export const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown, max = 400): string =>
  typeof v === "string" ? v.slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
export const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
export const arr = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
export const esc = (s: string): string => escapeHtml(s);
export const attr = (s: string): string => escapeAttr(s);
export const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** FNV-1a：给块 / 条目一个稳定指纹，流式 patch 据此判定「同一份数据，保留节点」。 */
export function hashKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 条目指纹（`data-ui-sig`）：流式期间已画好的条目不重建（图片不重载、不闪）。 */
export const sigOf = (v: unknown): string => {
  try { return hashKey(JSON.stringify(v) ?? ""); } catch { return "0"; }
};

/** 文本宽度估算（SVG 里没法量 DOM）：CJK 按 1em，其余 0.58em。 */
export function textWidth(s: string, fontPx: number): number {
  let w = 0;
  for (const ch of s) w += /[⺀-￿]/.test(ch) ? fontPx : fontPx * 0.58;
  return w;
}

export function clip(s: string, maxPx: number, fontPx: number): string {
  if (textWidth(s, fontPx) <= maxPx) return s;
  let out = "";
  for (const ch of s) {
    if (textWidth(`${out}${ch}…`, fontPx) > maxPx) break;
    out += ch;
  }
  return `${out}…`;
}

const NUM_FMT = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const COMPACT_FMT = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const FIXED_FMT = new Map<number, Intl.NumberFormat>();

export function formatNumber(v: number, unit = "", decimals?: number): string {
  let body: string;
  if (decimals != null) {
    let fmt = FIXED_FMT.get(decimals);
    if (!fmt) {
      fmt = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      FIXED_FMT.set(decimals, fmt);
    }
    body = fmt.format(v);
  } else {
    body = NUM_FMT.format(v);
  }
  return unit ? `${body}${unit}` : body;
}

export function formatTick(v: number, unit: string): string {
  const body = Math.abs(v) >= 10000 ? COMPACT_FMT.format(v) : NUM_FMT.format(v);
  return unit === "%" ? `${body}%` : body;
}

/** 坐标轴「好看的」刻度。 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

// ── 色调：只认调色板序号与几个语义名，产出的永远是固定的 CSS 变量 ─────────────

const TONE_NAMES: Record<string, string> = {
  good: "var(--ui-good)", success: "var(--ui-good)", bad: "var(--ui-bad)", danger: "var(--ui-bad)",
  warn: "var(--ui-warn)", info: "var(--ui-info)", primary: "var(--ui-c0)", accent: "var(--ui-c0)",
  ink: "var(--ui-ink)", muted: "var(--ui-ink-3)",
  blue: "var(--ui-c0)", orange: "var(--ui-c1)", green: "var(--ui-c2)", yellow: "var(--ui-c3)",
  pink: "var(--ui-c4)", teal: "var(--ui-c5)", purple: "var(--ui-c6)", red: "var(--ui-c7)",
};

/** 色调 → CSS 颜色表达式（白名单）；认不出返回 fallback。 */
export function toneColor(v: unknown, fallback = ""): string {
  const n = num(v);
  if (n !== null && Number.isInteger(n) && n >= 0) return `var(--ui-c${n % 8})`;
  const s = str(v, 12).toLowerCase();
  return TONE_NAMES[s] ?? fallback;
}

/** `style="--ui-tone:…"` 片段（空色调时为空串）。 */
export const toneStyle = (v: unknown, fallback = ""): string => {
  const c = toneColor(v, fallback);
  return c ? `--ui-tone:${c}` : "";
};

// ── 图标 ────────────────────────────────────────────────────────────────────

export function hasIcon(name: unknown): boolean {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(RICH_UI_ICONS, name);
}

export function renderIcon(name: unknown, size = 18, cls = "ui-icon"): string {
  if (!hasIcon(name)) return "";
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RICH_UI_ICONS[name as string]}</svg>`;
}

// ── 模板与绑定 ──────────────────────────────────────────────────────────────

export interface UiScope {
  /** 数值变量（滑块、开关、分段选择的值、derive 结果）。 */
  vars: Record<string, number>;
  /** 文本变量（表单答案、分段选择的标签）。`{id}` 先查这里。 */
  text?: Record<string, string>;
  /** `{label:id}`：选项型控件当前选中项的标签。 */
  labels?: Record<string, string>;
}

const TPL_RE = /\{\{|\}\}|\{([^{}]{1,200})\}/g;

/**
 * 文本插值：`{expr}` 按公式求值并格式化（整数不带小数，否则 ≤2 位）；`{expr:1}` 固定小数位；
 * `{label:id}` 取选项标签；`{id}` 若是文本变量直接替换；`{{` / `}}` 输出字面花括号。
 * 求值失败输出「—」—— 永远不把模型写的表达式原样回显成「看起来像代码」的东西。
 */
export function fillTemplate(s: string, scope: UiScope): string {
  if (!s.includes("{") && !s.includes("}")) return s;
  return s.replace(TPL_RE, (m, body: string | undefined) => {
    if (m === "{{") return "{";
    if (m === "}}") return "}";
    const inner = (body ?? "").trim();
    const lab = /^label\s*:\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(inner);
    if (lab) return scope.labels?.[lab[1]] ?? "—";
    if (scope.text && Object.prototype.hasOwnProperty.call(scope.text, inner)) return scope.text[inner];
    // 先整体求值（三元 `c ? a : 0` 里也有冒号），失败再按 `expr:位数` 解释
    const whole = evaluateFormula(inner, scope.vars);
    if (whole !== null) return formatNumber(Math.abs(whole) >= 100 ? Math.round(whole * 10) / 10 : whole);
    const fixed = /^(.*):\s*(\d)$/.exec(inner);
    const v = fixed ? evaluateFormula(fixed[1], scope.vars) : null;
    return v === null ? "—" : formatNumber(v, "", Number(fixed![2]));
  });
}

/** 字段值绑定：`"=expr"` → 数字（失败为 null）；其余字符串走 fillTemplate；对象/数组递归。 */
export function bindSpec(v: unknown, scope: UiScope, depth = 0): unknown {
  if (depth > 12) return v;
  if (typeof v === "string") {
    if (v.startsWith("=")) return evaluateFormula(v.slice(1), scope.vars);
    return fillTemplate(v, scope);
  }
  if (Array.isArray(v)) return v.slice(0, 400).map((x) => bindSpec(x, scope, depth + 1));
  if (isObj(v)) {
    const out: Json = {};
    for (const [k, x] of Object.entries(v)) {
      // 公式源本身（calculator 的 formula、derive）不能被提前求值掉
      out[k] = k === "formula" || k === "fn" ? x : bindSpec(x, scope, depth + 1);
    }
    return out;
  }
  return v;
}

/** 数字字段：直接数值，或在 scope 下求 `"=expr"`。 */
export function numIn(v: unknown, scope: UiScope | null): number | null {
  if (typeof v === "string" && v.startsWith("=") && scope) return evaluateFormula(v.slice(1), scope.vars);
  return num(v);
}

// ── JSON：修复 + 半截解析 ────────────────────────────────────────────────────

/** 去掉字符串外的 // 与 /* *\/ 注释和尾逗号（模型最常犯的两类 JSON 错误）。 */
export function repairJson(raw: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inStr) {
      out += c;
      if (c === "\\") { out += raw[i + 1] ?? ""; i += 1; } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && raw[i + 1] === "/") { while (i < raw.length && raw[i] !== "\n") i += 1; out += "\n"; continue; }
    if (c === "/" && raw[i + 1] === "*") { const end = raw.indexOf("*/", i + 2); i = end < 0 ? raw.length : end + 1; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseJsonLenient(raw: string): { value: unknown; error: string } {
  try {
    return { value: JSON.parse(raw), error: "" };
  } catch (e) {
    try {
      return { value: JSON.parse(repairJson(raw)), error: "" };
    } catch {
      return { value: undefined, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

/**
 * 流式中的半截 JSON：只在「顶层字段之间」与「顶层数组的条目之间」切开并补齐括号，
 * 所以拿到的永远是**写完了的**字段和条目——半个条目不会先画出来、下一帧又变样。
 * 解析不出任何东西返回 null。
 */
export function parsePartialJson(raw: string): Json | null {
  const cuts: number[] = [];
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (inStr) {
      if (c === "\\") i += 1; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{" || c === "[") {
      stack.push(c === "{" ? "}" : "]");
      if (stack.length <= 2) cuts.push(i + 1);
    } else if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length >= 1 && stack.length <= 2) cuts.push(i + 1);
      if (!stack.length) break;
    } else if (c === "," && stack.length <= 2) {
      cuts.push(i);
    }
  }
  for (let k = cuts.length - 1; k >= 0 && k >= cuts.length - 6; k -= 1) {
    const head = raw.slice(0, cuts[k]).replace(/,\s*$/, "");
    const closers = closersFor(head);
    if (closers === null) continue;
    try {
      const v = JSON.parse(head + closers);
      if (isObj(v)) return v;
    } catch { /* 再往前退一个切点 */ }
  }
  return null;
}

function closersFor(head: string): string | null {
  const stack: string[] = [];
  let inStr = false;
  for (let i = 0; i < head.length; i += 1) {
    const c = head[i];
    if (inStr) {
      if (c === "\\") i += 1; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) return null;
  return stack.reverse().join("");
}

// ── 图片 ────────────────────────────────────────────────────────────────────

/**
 * 远程图片闸门。⛔ 模型写进 ```ui 的 URL 是不可信文本：渲染那一刻就会发起 GET，
 * 主机名 / 路径都能携带外泄载荷（与 web-sources 清空未登记 favicon 同一条理由）。
 * 所以只有「我方工具真的拿到过的」图片 URL（web_fetch 提取的正文图片、搜索结果缩略图）
 * 才放行，且必须逐字相同；其余一律画成占位图块。
 */
const REMOTE_IMAGES = new Set<string>();
const MAX_REMOTE_IMAGES = 4000;

export function registerRemoteImages(urls: Iterable<string>): void {
  for (const u of urls) {
    if (typeof u !== "string" || !/^https:\/\//i.test(u) || u.length > 1000) continue;
    if (REMOTE_IMAGES.size >= MAX_REMOTE_IMAGES) {
      const first = REMOTE_IMAGES.values().next().value;
      if (first !== undefined) REMOTE_IMAGES.delete(first);
    }
    REMOTE_IMAGES.add(u);
  }
}

export function isRegisteredRemoteImage(url: string): boolean {
  return REMOTE_IMAGES.has(url);
}

/** 测试用：清空闸门。 */
export function resetRemoteImagesForTest(): void {
  REMOTE_IMAGES.clear();
}

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export type UiImageSource =
  | { kind: "remote"; url: string }
  | { kind: "local"; path: string }
  | { kind: "none" };

export function classifyImageSource(src: string): UiImageSource {
  const s = src.trim();
  if (!s) return { kind: "none" };
  if (/^https:\/\//i.test(s)) return isRegisteredRemoteImage(s) ? { kind: "remote", url: s } : { kind: "none" };
  let path = s;
  if (/^file:/i.test(s)) path = s.replace(/^file:\/\/\/?/i, "");
  // 其它协议（http:、data:、javascript:、asset: …）一律不认；单字母 + 冒号是 Windows 盘符
  else if (/^[a-z][a-z0-9+.-]+:/i.test(s)) return { kind: "none" };
  // 本地文件（绝对或相对工作区）：只认图片扩展名，由宿主换成 asset: URL
  // ⛔ UNC / 协议相对路径（\\host\share、//host）在 Windows 上会触发 SMB 出网，不当本地图
  if (/^[\\/]{2}/.test(path)) return { kind: "none" };
  if (IMAGE_EXT_RE.test(path.split(/[?#]/)[0])) return { kind: "local", path };
  return { kind: "none" };
}

/**
 * 图片 HTML。占位图块显示图标 + alt，尺寸与真图一致（布局不跳）。
 * 本地图不写 src：`data-ui-local-src` 由 rich-ui-interact 交给宿主异步解析。
 */
export function renderImage(src: string, alt: string, opts: { cls?: string; fit?: string; icon?: string } = {}): string {
  const cls = opts.cls ?? "ui-img";
  const fit = opts.fit === "contain" ? " is-contain" : "";
  const source = classifyImageSource(src);
  if (source.kind === "remote") {
    return `<img class="${cls}${fit}" src="${attr(source.url)}" alt="${attr(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">`;
  }
  if (source.kind === "local") {
    return `<img class="${cls}${fit}" data-ui-local-src="${attr(source.path)}" alt="${attr(alt)}" decoding="async" draggable="false">`;
  }
  return `<span class="${cls} ui-img-placeholder" role="img" aria-label="${attr(alt || "图片")}">${renderIcon(hasIcon(opts.icon) ? opts.icon : "image", 22)}</span>`;
}
