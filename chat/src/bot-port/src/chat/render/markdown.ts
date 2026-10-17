// 移植自 cancri-code/src/chat/render/markdown.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — 迷你 Markdown 渲染器（M0 从 chat.ts 抽离）
 *
 * 不引入外部库；支持 # ~ ###### 标题、ul/ol 列表、blockquote、代码块（复制/下载）、
 * 内联 `code` / **bold** / *italic* / [text](url)、表格（复制）、$..$/$$..$$（KaTeX）。够用即可。
 * 内联 `code` / **bold** / *italic* / [text](url)、表格、$..$/$$..$$（KaTeX）。够用即可。
 * 纯函数模块——仅依赖 ../format 的转义工具与全局 window.katex。
 */
import { escapeHtml, escapeAttr } from "../format";
import {
  CITE_RUN_RE,
  renderCitationChip,
  resolveCitationRun,
  type CitationLookup,
} from "./web-sources";
import { lastRichUiDiagnostic, renderRichUiBlock } from "./rich-ui";

const COPY_ICON = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.2" y="5.2" width="7.4" height="8.2" rx="1.3" stroke="currentColor" stroke-width="1.2"/><path d="M3.6 10.6H3.2A1.2 1.2 0 0 1 2 9.4V3.2A1.2 1.2 0 0 1 3.2 2h6.2A1.2 1.2 0 0 1 10.6 3.2v.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
const DOWNLOAD_ICON = `<svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.15" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.8v5.1M5.55 8.15 8 10.6l2.45-2.45" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const LANG_LABEL: Record<string, string> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JSX",
  py: "Python",
  python: "Python",
  rs: "Rust",
  rust: "Rust",
  go: "Go",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  md: "Markdown",
  markdown: "Markdown",
  bash: "Bash",
  sh: "Shell",
  shell: "Shell",
  zsh: "Zsh",
  sql: "SQL",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  c: "C",
  cpp: "C++",
  cxx: "C++",
  cs: "C#",
  csharp: "C#",
  java: "Java",
  kt: "Kotlin",
  kotlin: "Kotlin",
  swift: "Swift",
  php: "PHP",
  rb: "Ruby",
  ruby: "Ruby",
  lua: "Lua",
  xml: "XML",
  vue: "Vue",
  svelte: "Svelte",
  text: "Text",
  txt: "Text",
};

const LANG_EXT: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  markdown: "md",
  shell: "sh",
  csharp: "cs",
  kotlin: "kt",
  ruby: "rb",
  text: "txt",
};

function langLabel(lang: string): string {
  const key = (lang || "text").toLowerCase();
  if (LANG_LABEL[key]) return LANG_LABEL[key];
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "Code";
}

function snippetFilename(lang: string): string {
  const key = (lang || "txt").toLowerCase();
  const ext = LANG_EXT[key] ?? (key.replace(/[^a-z0-9]+/g, "") || "txt");
  return `snippet.${ext}`;
}

function fenceButtons(payload: string, opts: { download?: boolean; filename?: string; copyClass?: string }): string {
  const copy = `<button class="md-fence-btn md-code-copy${opts.copyClass ? ` ${opts.copyClass}` : ""}" type="button" data-copy="${escapeAttr(payload)}" title="复制" aria-label="复制">${COPY_ICON}<span class="sr-only">复制</span></button>`;
  if (!opts.download) return copy;
  return (
    `<div class="md-fence-actions">` +
      `<button class="md-fence-btn md-code-download" type="button" data-download="${escapeAttr(payload)}" data-filename="${escapeAttr(opts.filename || "snippet.txt")}" title="下载" aria-label="下载">${DOWNLOAD_ICON}<span class="sr-only">下载</span></button>` +
      copy +
    `</div>`
  );
}

function toMarkdownTable(headers: string[], rows: string[][]): string {
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const line = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [line(headers), sep, ...rows.map((row) => line(headers.map((_, i) => row[i] ?? "")))].join("\n");
}

/**
 * 流式渲染：若有未闭合的 ``` 代码围栏，临时补一个闭合，避免流式中途整段被当作普通文本/出现裸 ```。
 */
export function renderMarkdownStreaming(src: string, renderOptions: MarkdownRenderOptions = {}): string {
  const fences = (src.match(/```/g) || []).length;
  // 补上的闭合前带一个 OPEN_FENCE_MARK：代码块据此知道自己「还没写完」
  // （```ui 组件要显示占位而不是去解析半截 JSON）；普通代码块渲染前把它剥掉，输出不变。
  if (fences % 2 === 1) src = src + `\n${OPEN_FENCE_MARK}\`\`\``;
  // 流式尾巴可能停在 `[[cite:https://…` 这种半截标记上。不裁掉的话用户会眼看着
  // 一段裸协议文本被逐字打出来、下一帧又消失；裁到最后一个未闭合的 `[[` 为止即可，
  // 收尾那次权威全量渲染会把它补全成 chip。
  const openMarker = src.lastIndexOf("[[cite:");
  if (openMarker >= 0 && src.indexOf("]]", openMarker) < 0) src = src.slice(0, openMarker);
  return renderMarkdown(src, renderOptions);
}

/**
 * 稳定块边界：最后一个「已闭合顶层块」之后的偏移（通常是块末空行之后）。
 * 开着的围栏 / `$$` 数学 / 表格 / 列表内不切，避免前缀与尾巴分渲后 HTML 对不上。
 * 返回 0 = 没有可缓存的稳定前缀（整段当尾巴渲）。
 */
export function findStableMarkdownBoundary(src: string): number {
  if (!src) return 0;
  // 统一按 LF 切行，同时记下每行在**原串**中的结束偏移（含其换行符）。
  const lines: string[] = [];
  const ends: number[] = [];
  let start = 0;
  while (start <= src.length) {
    const nl = src.indexOf("\n", start);
    if (nl < 0) {
      lines.push(src.slice(start).replace(/\r$/, ""));
      ends.push(src.length);
      break;
    }
    lines.push(src.slice(start, nl).replace(/\r$/, ""));
    ends.push(nl + 1);
    start = nl + 1;
  }

  let lastStableEnd = 0;
  let inFence = false;
  let inMath = false;
  let inTable = false;
  let inList = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      inList = false;
      inTable = false;
      continue;
    }
    if (inFence) continue;

    const mathTicks = trimmed.match(/\$\$/g)?.length ?? 0;
    if (mathTicks) {
      if (mathTicks % 2 === 1) inMath = !inMath;
      inList = false;
      inTable = false;
      continue;
    }
    if (inMath) continue;

    if (!trimmed) {
      if (!inTable && !inList) lastStableEnd = ends[i];
      inTable = false;
      inList = false;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
      inTable = true;
      inList = false;
      continue;
    }
    if (inTable) {
      if (!line.includes("|")) inTable = false;
      else continue;
    }

    if (parseListLine(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      if (/^\s+/.test(line) || parseListLine(line)) continue;
      inList = false;
    }
  }

  // 尾部还有未闭合的围栏 / 公式块时保守不切：整段走全量，避免未闭合块影响前文分渲。
  if (inFence || inMath) return 0;
  if (lastStableEnd <= 0 || lastStableEnd >= src.length) return 0;
  return lastStableEnd;
}

/** 含这些构造时增量分渲无法保证与全量字节一致 → 退回全量。 */
const INCREMENTAL_UNSAFE_RE = /\u0000(?:EB)\d+\u0000/;

export interface StreamingMarkdownCache {
  prefix: string;
  html: string;
}

/**
 * 块级增量流式渲染：稳定前缀走缓存，只重渲未闭合尾巴。
 * 输出必须与 `renderMarkdownStreaming(src)` 字节一致；否则调用方应丢弃 cache。
 */
export function renderMarkdownStreamingIncremental(
  src: string,
  renderOptions: MarkdownRenderOptions = {},
  cache: StreamingMarkdownCache | null = null,
): { html: string; cache: StreamingMarkdownCache | null } {
  if (!src) return { html: "", cache: null };
  if (INCREMENTAL_UNSAFE_RE.test(src)) {
    return { html: renderMarkdownStreaming(src, renderOptions), cache: null };
  }
  const boundary = findStableMarkdownBoundary(src);
  if (boundary <= 0) {
    return { html: renderMarkdownStreaming(src, renderOptions), cache: null };
  }
  const prefix = src.slice(0, boundary);
  const tail = src.slice(boundary);
  let prefixHtml: string;
  if (cache && cache.prefix === prefix) {
    prefixHtml = cache.html;
  } else {
    // 前缀只含已闭合块，走非 streaming 即可（与 streaming 在无开围栏时等价）
    prefixHtml = renderMarkdown(prefix, renderOptions);
  }
  const tailHtml = renderMarkdownStreaming(tail, renderOptions);
  const html =
    prefixHtml && tailHtml ? `${prefixHtml}\n${tailHtml}` : prefixHtml + tailHtml;
  return { html, cache: { prefix, html: prefixHtml } };
}

function splitMarkdownTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export interface MarkdownRenderOptions {
  fenceActions?: boolean;
  tableActions?: boolean;
  linkFilePaths?: boolean;
  allowRelativeLinks?: boolean;
  allowMailAndTelLinks?: boolean;
  friendlyLanguageLabels?: boolean;
  /**
   * 本条消息用过的联网来源（URL → 标题/域名/favicon）。
   * 缺省是空表：`[[cite:...]]` 仍会渲染成 chip，只是标题退化成域名——
   * 归档里旧消息的工具结果可能已被压缩掉，那时"能点开"比"有标题"重要。
   */
  citations?: CitationLookup;
  /** ```ui 围栏渲染成智能交互组件（rich-ui.ts）；关掉则按普通代码块显示。 */
  richUi?: boolean;
}

/** 流式补闭合围栏的标记（见 renderMarkdownStreaming）。控制字符，正常文本里不会出现。 */
const OPEN_FENCE_MARK = "\u0001";

type ResolvedMarkdownRenderOptions = Required<MarkdownRenderOptions>;

const EMPTY_CITATIONS: CitationLookup = new Map();

const DEFAULT_RENDER_OPTIONS: ResolvedMarkdownRenderOptions = {
  fenceActions: true,
  tableActions: true,
  linkFilePaths: true,
  allowRelativeLinks: true,
  allowMailAndTelLinks: true,
  friendlyLanguageLabels: true,
  citations: EMPTY_CITATIONS,
  richUi: true,
};

interface ParsedListLine {
  indent: number;
  type: "ul" | "ol";
  content: string;
  /** 有序列表的书写序号（`3.` → 3）；无序为 undefined。 */
  ordinal?: number;
}

function parseListLine(line: string): ParsedListLine | null {
  const match = /^(\s*)([-*+]|\d+\.)\s+(.+)$/.exec(line);
  if (!match) return null;
  const indent = [...match[1]].reduce((sum, char) => sum + (char === "\t" ? 4 : 1), 0);
  const ordered = /\d/.test(match[2][0]);
  return {
    indent,
    type: ordered ? "ol" : "ul",
    content: match[3],
    ordinal: ordered ? Number.parseInt(match[2], 10) : undefined,
  };
}

function indentWidth(line: string): number {
  const lead = /^\s*/.exec(line)?.[0] ?? "";
  return [...lead].reduce((sum, char) => sum + (char === "\t" ? 4 : 1), 0);
}

function skipBlankLines(lines: string[], from: number): number {
  let i = from;
  while (i < lines.length && !lines[i].trim()) i += 1;
  return i;
}

function renderList(
  lines: string[],
  start: number,
  baseIndent: number,
  options: ResolvedMarkdownRenderOptions,
): { html: string; next: number } {
  const first = parseListLine(lines[start]);
  if (!first) return { html: "", next: start };
  const type = first.type;
  const items: Array<{ content: string; nested: string; task: boolean; checked: boolean }> = [];
  let i = start;
  let loose = false;

  while (i < lines.length) {
    // 条目之间的空行不终止列表（CommonMark 的「松散列表」）。
    // ⛔ 别把这段删回「遇空行就 break」：那会让 `1.` `2.` `3.` 各自成为一个只有一项的
    // <ol>，于是四个条目全渲染成「1.」——正文里序号明明是 1234（2026-09-08 用户实报）。
    if (!lines[i].trim()) {
      const j = skipBlankLines(lines, i);
      const ahead = j < lines.length ? parseListLine(lines[j]) : null;
      const sameList = ahead
        && ahead.indent >= baseIndent
        && (ahead.indent > baseIndent || ahead.type === type);
      if (!sameList) break;
      loose = true;
      i = j;
      continue;
    }
    const parsed = parseListLine(lines[i]);
    if (!parsed || parsed.indent < baseIndent) break;
    if (parsed.indent > baseIndent) {
      if (!items.length) break;
      const nested = renderList(lines, i, parsed.indent, options);
      items[items.length - 1].nested += nested.html;
      i = nested.next;
      continue;
    }
    if (parsed.type !== type) break;

    const task = type === "ul" ? /^\[([ xX])\]\s+(.+)$/.exec(parsed.content) : null;
    const item = {
      content: inlineMd(task ? task[2] : parsed.content, options),
      nested: "",
      task: Boolean(task),
      checked: Boolean(task && task[1].toLowerCase() === "x"),
    };
    items.push(item);
    i += 1;

    // 条目正文的续行：缩进的接续段落，被空行隔开的也算（此时多留一个 <br> 当段距）。
    let blankBefore = false;
    while (i < lines.length) {
      if (!lines[i].trim()) {
        const j = skipBlankLines(lines, i);
        // 空行后是列表项或回到基准缩进 → 交回外层循环判定
        if (j >= lines.length || parseListLine(lines[j]) || indentWidth(lines[j]) <= baseIndent) break;
        blankBefore = true;
        loose = true;
        i = j;
        continue;
      }
      if (parseListLine(lines[i])) break;
      if (indentWidth(lines[i]) <= baseIndent) break;
      item.content += `${blankBefore ? "<br><br>" : "<br>"}${inlineMd(lines[i].trim(), options)}`;
      blankBefore = false;
      i += 1;
    }
  }

  const classes = [
    type === "ul" && items.some((item) => item.task) ? "contains-task-list" : "",
    loose ? "md-list-loose" : "",
  ].filter(Boolean);
  const listClass = classes.length ? ` class="${classes.join(" ")}"` : "";
  // 起始序号跟随原文：`3.` 开头的列表要从 3 数起，否则「接着上文继续编号」的写法会被抹平。
  const startAttr = type === "ol" && first.ordinal != null && first.ordinal !== 1
    ? ` start="${first.ordinal}"`
    : "";
  const html = items.map((item) => {
    const liClass = item.task ? ' class="task-list-item"' : "";
    const checkbox = item.task ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}> ` : "";
    return `<li${liClass}>${checkbox}${item.content}${item.nested}</li>`;
  }).join("");
  return { html: `<${type}${startAttr}${listClass}>${html}</${type}>`, next: i };
}

export function renderMarkdown(src: string, renderOptions: MarkdownRenderOptions = {}): string {
  if (!src) return "";
  const options = { ...DEFAULT_RENDER_OPTIONS, ...renderOptions };

  // 1. 先抽取代码块占位（防止 ``` 内的 markdown / $ 被误解析）
  const codeBlocks: string[] = [];
  src = src.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_m, lang, code: string) => {
    const idx = codeBlocks.length;
    const langTag = (lang || "text").toLowerCase();
    const open = code.endsWith(OPEN_FENCE_MARK);
    const cleaned = (open ? code.slice(0, -OPEN_FENCE_MARK.length) : code).replace(/\n$/, "");
    if (langTag === "ui" && options.richUi) {
      const rich = renderRichUiBlock(cleaned, {
        open,
        inline: (s) => inlineMd(s, options),
        block: (s) => renderMarkdown(s, renderOptions),
      });
      if (rich) {
        codeBlocks.push(rich);
        return `\u0000CB${idx}\u0000`;
      }
    }
    // 智能 UI 渲染失败：退回源码，并把原因写在下面（OpenUI 的「诊断不回传」痛点：至少让人看得见为什么）
    const uiDiag = langTag === "ui" && options.richUi && !open ? lastRichUiDiagnostic() : "";
    const label = options.friendlyLanguageLabels ? langLabel(langTag) : langTag;
    const actions = options.fenceActions
      ? fenceButtons(cleaned, { download: true, filename: snippetFilename(langTag) })
      : "";
    codeBlocks.push(
      `<pre class="md-code"><div class="md-code-head">` +
        `<span class="md-code-lang">${escapeHtml(label)}</span>${actions}` +
        `</div><code>${escapeHtml(cleaned)}</code></pre>` +
        (uiDiag ? `<div class="ui-diag" role="note">智能界面未能渲染：${escapeHtml(uiDiag)}</div>` : ""),
    );
    return `\u0000CB${idx}\u0000`;
  });

  // 1a. 内联 `code` 先挪走，`$x$` 这类反引号里的 $ 不参与数学公式匹配（抽完数学再原样放回）
  const inlineCodeSpans: string[] = [];
  src = src.replace(/`[^`\n]+`/g, (m) => {
    const idx = inlineCodeSpans.length;
    inlineCodeSpans.push(m);
    return `\u0000IC${idx}\u0000`;
  });

  // 1b. 抽取数学公式占位（v0.10：KaTeX 支持）
  //   - 块级 $$...$$  (display mode)
  //   - 内联 $...$    (要求两侧不被 \w 紧贴，避免误吃价格 $5)
  const mathBlocks: { latex: string; display: boolean }[] = [];
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex) => {
    const idx = mathBlocks.length;
    mathBlocks.push({ latex: latex.trim(), display: true });
    return `\u0000MB${idx}\u0000`;
  });
  src = src.replace(/(^|[^\w$])\$(?=\S)([^\n$]+?\S)\$(?!\w)/g, (_m, pre, latex) => {
    const idx = mathBlocks.length;
    mathBlocks.push({ latex, display: false });
    return `${pre}\u0000MB${idx}\u0000`;
  });

  // 1c. 数学抽取完毕，内联 `code` 原样放回，交给后面的 inlineMd 正常渲染
  src = src.replace(/\u0000IC(\d+)\u0000/g, (_m, idx) => inlineCodeSpans[+idx] ?? "");

  // 2. 行级语法
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length) {
      out.push(`<p>${inlineMd(paraBuf.join(" ").trim(), options)}</p>`);
      paraBuf = [];
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // 已被替换的代码块 / 块级数学公式 / v0.14 edit 块占位整行直接放进去
    if (/^\u0000(?:CB|MB|EB)\d+\u0000$/.test(line.trim())) {
      flushPara();
      out.push(line.trim());
      continue;
    }
    // 空行 = 段落分隔
    if (/^\s*$/.test(line)) {
      flushPara();
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
      flushPara();
      const headers = splitMarkdownTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitMarkdownTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      const actions = options.tableActions
        ? fenceButtons(toMarkdownTable(headers, rows), { copyClass: "md-table-copy" })
        : "";
      out.push(
        `<div class="md-table-wrap">${actions}<div class="md-table-scroll"><table class="md-table"><thead><tr>${headers
          .map((h) => `<th>${inlineMd(h, options)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map((row) => `<tr>${headers.map((_, idx) => `<td>${inlineMd(row[idx] ?? "", options)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div></div>`,
      );
      continue;
    }
    if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flushPara();
      out.push("<hr>");
      continue;
    }
    // 标题
    const h = /^(#{1,6})\s+(.+)/.exec(line);
    if (h) {
      flushPara();
      const lvl = h[1].length;
      out.push(`<h${lvl} class="md-h md-h-${lvl}">${inlineMd(h[2], options)}</h${lvl}>`);
      continue;
    }
    const listLine = parseListLine(line);
    if (listLine) {
      flushPara();
      const list = renderList(lines, i, listLine.indent, options);
      out.push(list.html);
      i = list.next - 1;
      continue;
    }
    // 引用
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      i -= 1;
      out.push(`<blockquote><p>${quoteLines.map((quote) => inlineMd(quote, options)).join("<br>")}</p></blockquote>`);
      continue;
    }
    // 普通段落行
    paraBuf.push(line);
  }
  flushPara();

  // 3. 还原代码块 + 数学公式
  let html = out.join("\n");
  html = html.replace(/\u0000CB(\d+)\u0000/g, (_m, idx) => codeBlocks[+idx] ?? "");
  html = html.replace(/\u0000MB(\d+)\u0000/g, (_m, idx) => {
    const m = mathBlocks[+idx];
    if (!m) return "";
    return renderKatex(m.latex, m.display);
  });
  return html;
}

/**
 * 行内 Markdown（智能 UI 交互层重算「应用」面板时用：此时已拿不到原消息的引用表，
 * `[[cite:]]` 退化成域名 chip，与归档重放同一行为）。
 */
export function renderInlineMarkdown(src: string): string {
  return inlineMd(src, DEFAULT_RENDER_OPTIONS);
}

export function renderMarkdownPreview(src: string): string {
  return renderMarkdown(src, {
    fenceActions: false,
    tableActions: false,
    linkFilePaths: false,
    allowRelativeLinks: false,
    allowMailAndTelLinks: false,
    friendlyLanguageLabels: false,
    richUi: false,
  });
}

/** 用全局 window.katex（来自 /katex/katex.min.js）渲染 LaTeX；失败回退到等宽 fallback */
function renderKatex(latex: string, displayMode: boolean): string {
  const katex = typeof window === "undefined"
    ? undefined
    : (window as unknown as { katex?: KatexLike }).katex;
  if (!katex || typeof katex.renderToString !== "function") {
    // KaTeX 还没加载完时的占位
    return displayMode
      ? `<pre class="md-math-fallback">${escapeHtml(latex)}</pre>`
      : `<code class="md-inline-code">${escapeHtml(latex)}</code>`;
  }
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "html",
      // ⛔ latex 来自模型输出/文件内容，是不可信文本，而 KaTeX 会把它编译成 HTML。
      // trust:false 明确禁掉 \href \htmlClass \htmlData 等能产出属性/链接的命令
      // （默认值本就是 false，但这里是**唯一**把不可信内容编成 HTML 的入口，
      // 不能靠"默认值别改"吃饭——升级 KaTeX 或有人加个全局配置就破了）。
      // maxExpand 限制宏展开，挡 \def 递归炸 CPU 的拒绝服务。
      trust: false,
      maxExpand: 1000,
    });
  } catch (err) {
    console.warn("[chat] katex render error:", err, latex);
    return `<code class="md-math-err" title="${escapeAttr(String(err))}">${escapeHtml(latex)}</code>`;
  }
}

interface KatexLike {
  renderToString: (
    latex: string,
    opts: {
      displayMode?: boolean;
      throwOnError?: boolean;
      output?: string;
      trust?: boolean;
      maxExpand?: number;
    },
  ) => string;
}

/**
 * 文件路径检测正则——在 AI 正文里识别文件名/目录名，包成可点击链接。
 * 匹配两类：
 *  1. 带扩展名的文件：file.py, src/main.ts, name (1).py
 *  2. 目录路径（以 / 结尾）：dir/, path/to/dir/
 * 排除：URL（://）、版本号（.数字）、HTML 实体（&...;）
 */
const FILE_EXTENSIONS = [
  "py", "pyi", "md", "cs", "csproj", "sln", "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "json", "json5", "rs", "go", "java", "kt", "kts", "swift", "rb", "php", "c", "cpp",
  "h", "hpp", "cc", "cxx", "txt", "yaml", "yml", "toml", "xml", "html", "htm",
  "css", "scss", "sass", "less", "vue", "svelte", "sh", "bash", "zsh", "fish",
  "bat", "cmd", "ps1", "sql", "proto", "gradle", "vb", "fs", "fsx", "ml", "mli",
  "scala", "clj", "cljs", "edn", "ex", "exs", "erl", "elm", "hs", "lhs", "lua",
  "tcl", "r", "dart", "groovy", "dockerfile", "makefile", "cmake", "gitignore",
  "env", "lock", "ini", "cfg", "conf", "log", "diff", "patch", "csv", "tsv",
  "ipynb", "png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "pdf", "zip",
  "tar", "gz", "7z", "wasm", "d\\.ts",
].join("|");

const FILE_PATH_RE = new RegExp(
  // 1) 文件路径（可含相对/绝对目录前缀 + Windows "name (N).ext" 命名）
  // 注意：扩展名候选必须整体包一层 (?:...)，否则前面的 "\\." 按 "|" 优先级只绑定给第一个候选
  // （如 "\\.py|pyi|md|...|c|..." 中只有 \.py 真正要求前导点，其余 pyi/md/.../c/... 不要求）——
  // 之前这个漂移会让 "src"（结尾恰好是候选扩展名 "c"）之类的裸单词被误判成文件（2026-07 修复）。
  "(?<![\\w:/.])(?:[\\/])?(?:[\\w@\\-.\\u4e00-\\u9fff]+/)*[\\w@\\-.\\u4e00-\\u9fff]+(?:\\s*\\(\\d+\\))?(?:\\.(?:" + FILE_EXTENSIONS + "))\\b" +
  // 2) 目录路径（以 / 结尾）：要求至少两级目录以减少误识（如 "是/否" 不算目录路径）
  "|(?<![\\w:/.])(?:[\\/])?(?:[\\w@\\-.\\u4e00-\\u9fff]{2,}/)(?:[\\w@\\-.\\u4e00-\\u9fff]+/)+",
  "g",
);

function inlineMd(s: string, options: ResolvedMarkdownRenderOptions): string {
  s = escapeHtml(s);
  // 1. 内联代码 `xxx` → 占位（最先处理，路径在 code 里不做成链接）
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code class="md-inline-code">${code}</code>`);
    return `\u0000CS${idx}\u0000`;
  });
  // 1a. 引用标记 [[cite:url]] → 占位。
  //     必须排在链接与文件路径之前：URL 里的 `.php` / `.html` 会被 FILE_PATH_RE 当成
  //     工作区文件做成 tool-path-link（点一下去开一个并不存在的本地文件）。
  //     连写的一串合并成一枚 chip；一个合法 URL 都没有时整段抹掉，不把裸标记漏给用户。
  const citeSpans: string[] = [];
  s = s.replace(CITE_RUN_RE, (run) => {
    const sources = resolveCitationRun(run, options.citations);
    const html = renderCitationChip(sources);
    if (!html) return "";
    const idx = citeSpans.length;
    citeSpans.push(html);
    return `\u0000CT${idx}\u0000`;
  });
  // 2. 链接 [text](url) → 占位（2026-06-27：移到文件路径检测之前，
  //    否则 [doc](https://example.com/readme) 的 text 部分 "doc" 会被 FILE_PATH_RE 先吃掉）
  const linkSpans: string[] = [];
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const safe = sanitizeUrl(url, options);
    if (!safe) return text; // 不安全 URL → 退化为纯文本（保持原行为）
    const idx = linkSpans.length;
    // 只有 http(s)/mailto/tel 才带 target=_blank。页内锚点带上会让 webview 开新窗口。
    const isExternal = /^(?:https?:|mailto:|tel:)/i.test(url.trim());
    const extra = isExternal ? ` target="_blank" rel="noreferrer"` : "";
    linkSpans.push(`<a href="${safe}"${extra}>${text}</a>`);
    return `\u0000LK${idx}\u0000`;
  });
  // 3. 文件路径 → 占位（在 bold/italic 之前提取，避免 * 被误解析）
  const pathSpans: string[] = [];
  if (options.linkFilePaths) {
    s = s.replace(FILE_PATH_RE, (match) => {
      const isDir = match.endsWith("/");
      const cleanPath = isDir ? match.replace(/\/+$/, "") : match;
      const idx = pathSpans.length;
      pathSpans.push(
        `<span class="tool-path-link" data-path="${escapeAttr(cleanPath)}"${isDir ? ' data-is-dir="1"' : ""}>${match}</span>`,
      );
      return `\u0000PS${idx}\u0000`;
    });
  }
  // 4. 粗体 **xxx**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // 5. 斜体 *xxx*（避开 ** 和 * 紧贴空格的场景）
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  // 6. 还原 code spans
  s = s.replace(/\u0000CS(\d+)\u0000/g, (_m, idx) => codeSpans[+idx] ?? "");
  // 7. 还原 path spans
  s = s.replace(/\u0000PS(\d+)\u0000/g, (_m, idx) => pathSpans[+idx] ?? "");
  // 8. 还原 link spans
  s = s.replace(/\u0000LK(\d+)\u0000/g, (_m, idx) => linkSpans[+idx] ?? "");
  // 9. 还原引用 chip
  s = s.replace(/\u0000CT(\d+)\u0000/g, (_m, idx) => citeSpans[+idx] ?? "");
  return s;
}

/**
 * v0.15.3: 校验 markdown 链接的 URL scheme，禁止 javascript: / data: / file: 等
 * 可被 WebView 解释为代码执行的 scheme。返回安全 URL（已做 attr 转义）或 null。
 *
 * 入参是已经 escapeHtml 过的字符串——但 escapeHtml 不动 `:` 和 `/`，所以原始
 * scheme 仍然完整可识别（"javascript:" 不会被吃成 "javascriptcolon"）。
 */
function sanitizeUrl(raw: string, options: ResolvedMarkdownRenderOptions): string | null {
  const t = raw.trim();
  if (!t) return null;
  // 黑名单：常见可执行 / 可注入 scheme（不区分大小写）
  if (/^(?:javascript|data|vbscript|file|blob|ipc|tauri|asset):/i.test(t)) {
    return null;
  }
  // `//host` 是协议相对 URL（继承当前 scheme，可指向任意外站），不算站内相对路径，拒
  if (t.startsWith("//")) {
    return null;
  }
  // 白名单 scheme（含相对路径 / 锚点）
  //
  // ⛔ 这里**不能**再转义一次（2026-08-17 审计 S8-08）：`raw` 来自 `inlineMd`，
  // 而 `inlineMd` 第一行已经整体 `escapeHtml` 过了（含 `"` → `&quot;`），attribute 上下文本就安全。
  // 旧代码又调了一次 `escapeAttr`（它与 `escapeHtml` 是同一个函数），于是 `&` 变成 `&amp;amp;`：
  // `https://x.com/?a=1&b=2` 渲染成的 href 会被浏览器解析成 `?a=1&amp;b=2`，**链接指向错误地址**。
  // web_search 结果的链接几乎必然带查询串，命中率极高。
  if (/^https?:/i.test(t)) return t;
  if (options.allowMailAndTelLinks && /^(?:mailto:|tel:)/i.test(t)) return t;
  // `#锚点` 不出网、不换 origin，允许（点击由 chat.ts 委托 preventDefault，避免页内跳转）。
  // ⛔ 根相对 `/path` 一律拒（2026-09-18 审计 U-07）：在 Tauri webview 里它解析成应用
  // origin（dev 是 localhost:1420 / 生产是 tauri.localhost），再叠 target=_blank
  // 会开空窗口或把 IDE 自己导航走。本应用没有「站内文档」。webview 对 `/`+target=_blank
  // 的实际处置本轮未实机验证，取保守做法。
  if (options.allowRelativeLinks && t.startsWith("#")) return t;
  // 既无 scheme 又非相对/锚点的杂项——IDE chat 里没意义，拒
  return null;
}

