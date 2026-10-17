// 移植自 cancri-code/src/chat/render/rich-ui.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 智能交互界面（Generative UI）· 渲染器。
 *
 * 模型在回答里写一个 ```ui 围栏，内容是一段 JSON（`{"type": "chart", ...}`），
 * 这里把它渲染成图表 / 示意图 / 指标卡 / 交互控件，而不是一段代码。
 *
 * 设计取舍（参照 Google A2UI 的「受控组件目录」模式）：
 *   · 模型只交**数据**，不交代码。所有组件由本文件用自有模板生成，文本一律转义，
 *     颜色只能取调色板序号，公式走白名单解析器（rich-ui-formula.ts）——
 *     模型输出里不存在任何会被执行或原样插进 DOM 的 HTML/JS/CSS。
 *   · 纯函数、产出 HTML 字符串，与 markdown.ts 同一套流水线（流式 patch / 归档重放都不用改）。
 *     交互（图例开关、标签页、提示浮层、计算器、选项按钮）由 rich-ui-interact.ts 事件委托接管。
 *   · 解析失败 / 类型未知 → 返回 null，调用方退回成普通 JSON 代码块：坏数据至少还看得见。
 *
 * 提示词（告诉模型何时、如何用这些组件）在 src/agent/rich-ui-prompt.ts，改组件要同步改它。
 */
import { evaluateFormula } from "./rich-ui-formula";
import { squirclePath } from "../../ui/squircle-path";
import {
  arr, attr, clip, esc, formatNumber, formatTick, hashKey, isObj, niceTicks, num, parseJsonLenient, parsePartialJson,
  sigOf, str, textWidth, toneStyle,
  type Json, type RichUiRenderContext, type UiScope,
} from "./rich-ui-core";
import { renderApp, renderCards, renderFigure, renderFlow, renderForm, renderMeters } from "./rich-ui-widgets";

export { formatNumber } from "./rich-ui-core";
export type { RichUiRenderContext } from "./rich-ui-core";

/** 组件类型 → 中文名（占位文案与源数据按钮用）。 */
export const RICH_UI_TYPES: Record<string, string> = {
  chart: "图表",
  diagram: "示意图",
  stats: "指标卡",
  steps: "步骤",
  compare: "对比",
  callout: "提示",
  tabs: "标签页",
  choices: "选项",
  calculator: "计算器",
  meters: "进度条",
  flow: "流程",
  cards: "卡片",
  form: "表单",
  figure: "示意图形",
  app: "小应用",
};

// ── 上限：模型输出不可信，超大数据直接截断，挡住渲染卡死 ──────────────────────
const MAX_SERIES = 8;
const MAX_CATEGORIES = 60;
const MAX_POINTS = 1500;
const MAX_NODES = 50;
const MAX_EDGES = 100;
const MAX_ITEMS = 24;

// ── 公共外壳 ────────────────────────────────────────────────────────────────

const EXPAND_BTN = `<button class="md-fence-btn ui-src-expand" type="button" data-ui-expand aria-label="全屏查看"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.6 6V3.4a.8.8 0 0 1 .8-.8H6M10 2.6h2.6a.8.8 0 0 1 .8.8V6M13.4 10v2.6a.8.8 0 0 1-.8.8H10M6 13.4H3.4a.8.8 0 0 1-.8-.8V10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
const COPY_ICON = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.2" y="5.2" width="7.4" height="8.2" rx="1.3" stroke="currentColor" stroke-width="1.2"/><path d="M3.6 10.6H3.2A1.2 1.2 0 0 1 2 9.4V3.2A1.2 1.2 0 0 1 3.2 2h6.2A1.2 1.2 0 0 1 10.6 3.2v.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

interface ShellOpts { extraClass?: string; streaming?: boolean }

function shell(type: string, key: string, raw: string, title: string, caption: string, body: string, ctx: RichUiRenderContext, opts: ShellOpts = {}): string {
  const head = title
    ? `<div class="ui-head"><div class="ui-title">${ctx.inline(title)}</div></div>`
    : "";
  const foot = caption ? `<div class="ui-caption">${ctx.inline(caption)}</div>` : "";
  // 两颗钮都不写 title：全局悬停提示会把 title 变成浮卡，用户点名不要（2026-10-09）。
  // 流式中的半截块不给按钮：源数据还没写完，复制出去是坏 JSON。
  // 空的 .ui-actions 占位要留着：写完后的权威渲染按位置对账（streaming-patch morphRichUi），
  // 少这一格，后面的标题 / 主体会整体错位被重建。
  const actions = opts.streaming
    ? `<div class="ui-actions"></div>`
    : `<div class="ui-actions">${EXPAND_BTN}<button class="md-fence-btn md-code-copy ui-src-copy" type="button" data-copy="${attr(raw)}" aria-label="复制源数据">${COPY_ICON}</button></div>`;
  const cls = `ui-block ui-${type}${opts.extraClass ? ` ${opts.extraClass}` : ""}`;
  return `<div class="${cls}" data-ui-type="${type}" data-ui-key="${key}"${opts.streaming ? ` data-ui-stream="1" aria-busy="true"` : ""}>${actions}${head}${body}${foot}</div>`;
}

function pending(raw: string): string {
  const t = /"type"\s*:\s*"([a-z]+)"/.exec(raw)?.[1] ?? "";
  const label = RICH_UI_TYPES[t] ?? "交互内容";
  // key 恒定：流式期间每帧都是「同一个」占位，patch 不会反复重建它（不闪）。
  // 只画流光骨架、不出可见文字（2026-10-09 用户要求）；类型名留给读屏。
  return `<div class="ui-block ui-pending" data-ui-key="pending-${t}" role="status" aria-label="正在生成${attr(label)}"><span class="ui-skel ui-skel-title"></span><span class="ui-skel ui-skel-body"></span><span class="ui-skel ui-skel-line"></span></div>`;
}

/**
 * 流式渐进渲染：列表型组件不必等整块写完——已经写完的条目先画出来（ChatGPT「组件写完一个出一个」）。
 * 只认这些类型与对应的列表字段；其余类型（图表、应用、表单…）半截数据画出来是错的，仍显示骨架。
 */
const STREAM_LISTS: Record<string, string> = {
  cards: "items", steps: "items", flow: "items", stats: "items", meters: "items", compare: "columns",
};

/** 渲染诊断：最近一次 renderRichUiBlock 失败的原因（markdown.ts 退回代码块时显示给用户 / 测试断言）。 */
let lastDiagnostic = "";
export function lastRichUiDiagnostic(): string {
  return lastDiagnostic;
}

/**
 * 组件主体（不含外壳）。app 面板里的嵌套组件也走这里，所以面板能放图表、进度条、示意图形……
 * scope 只有在 app 里才有（figure 的 plot 要拿控件变量取样）。
 */
export function renderComponentBody(spec: Json, ctx: RichUiRenderContext, key: string, scope: UiScope | null = null): string | null {
  switch (str(spec.type, 20)) {
    case "chart": return renderChart(spec);
    case "diagram": return renderDiagram(spec, key);
    case "stats": return renderStats(spec, ctx);
    case "steps": return renderSteps(spec, ctx);
    case "compare": return renderCompare(spec, ctx);
    case "tabs": return renderTabs(spec, ctx);
    case "choices": return renderChoices(spec, ctx);
    case "calculator": return renderCalculator(spec, ctx);
    case "meters": return renderMeters(spec, ctx);
    case "flow": return renderFlow(spec, ctx);
    case "cards": return renderCards(spec, ctx);
    case "form": return renderForm(spec, ctx, key);
    case "figure": return renderFigure(spec, ctx, scope);
    default: return null;
  }
}

/**
 * 渲染一个 ```ui 围栏。返回 null = 无法渲染，调用方应退回成普通代码块（原因见 lastRichUiDiagnostic）。
 */
export function renderRichUiBlock(raw: string, ctx: RichUiRenderContext): string | null {
  lastDiagnostic = "";
  if (ctx.open) return renderStreaming(raw, ctx) ?? pending(raw);
  const parsed = parseJsonLenient(raw);
  let spec = parsed.value;
  // 围栏已闭合但 JSON 被截断（模型输出到上限）：尽量救回写完的部分
  if (parsed.error) spec = parsePartialJson(raw) ?? undefined;
  if (!isObj(spec)) {
    lastDiagnostic = parsed.error ? `JSON 解析失败：${parsed.error}` : "顶层必须是一个 JSON 对象";
    return null;
  }
  const type = str(spec.type, 20);
  if (!Object.prototype.hasOwnProperty.call(RICH_UI_TYPES, type)) {
    lastDiagnostic = type ? `未知组件类型「${type}」` : "缺少 type 字段";
    return null;
  }
  const html = renderSpec(spec, raw, ctx, false);
  if (!html) lastDiagnostic = `「${type}」缺少必填数据（${REQUIRED_HINT[type] ?? "见字段说明"}），或数据为空`;
  return html;
}

const REQUIRED_HINT: Record<string, string> = {
  chart: "labels + series[].data", diagram: "nodes", stats: "items", steps: "items", compare: "columns ≥ 2",
  callout: "title 或 body", tabs: "tabs ≥ 2", choices: "options", calculator: "inputs + outputs",
  meters: "items[].label/value", flow: "items[].title", cards: "items[].title", form: "fields[].label",
  figure: "shapes", app: "panels",
};

function renderSpec(spec: Json, raw: string, ctx: RichUiRenderContext, streaming: boolean): string | null {
  const type = str(spec.type, 20);
  // 流式中的 key 随内容变（patch 据此逐条目对账），写完后才是源文本指纹
  const key = streaming ? `s-${sigOf(spec)}` : hashKey(raw);
  const title = str(spec.title, 120);
  const caption = str(spec.caption, 300);
  if (type === "callout") {
    const tone = ["info", "tip", "warn", "danger", "success"].includes(str(spec.tone)) ? str(spec.tone) : "info";
    const body = renderCallout(spec, ctx, tone);
    // callout 自己画标题（和图标同行），外壳不再重复
    return body ? shell(type, key, raw, "", caption, body, ctx, { extraClass: `ui-tone-${tone}` }) : null;
  }
  const body = type === "app"
    ? renderApp(spec, raw, ctx, key, (s, scope) => renderComponentBody(s, ctx, key, scope))
    : renderComponentBody(spec, ctx, key);
  if (!body) return null;
  return shell(type, key, raw, title, caption, body, ctx, { streaming });
}

function renderStreaming(raw: string, ctx: RichUiRenderContext): string | null {
  const type = /"type"\s*:\s*"([a-z]+)"/.exec(raw)?.[1] ?? "";
  const field = STREAM_LISTS[type];
  if (!field) return null;
  const spec = parsePartialJson(raw);
  if (!spec || str(spec.type) !== type || !Array.isArray(spec[field]) || !(spec[field] as unknown[]).length) return null;
  // compare 少于 2 列时渲染器会拒绝：保持骨架
  return renderSpec(spec, raw, ctx, true);
}

// ── 图表 ────────────────────────────────────────────────────────────────────

interface Series { name: string; data: number[] }

function legend(series: string[]): string {
  if (series.length < 2) return "";
  return `<div class="ui-legend" role="group" aria-label="图例">${series
    .map((name, i) => `<button type="button" class="ui-legend-item" data-ui-legend="${i}" aria-pressed="true"><span class="ui-swatch ui-c${i % MAX_SERIES}"></span>${esc(name)}</button>`)
    .join("")}</div>`;
}

function renderChart(spec: Json): string | null {
  const kind = str(spec.kind, 12) || "bar";
  if (kind === "pie" || kind === "donut") return renderPie(spec, kind === "donut");
  if (kind === "scatter") return renderScatter(spec);
  if (!["bar", "line", "area"].includes(kind)) return null;

  const labels = arr(spec.labels, MAX_CATEGORIES).map((l) => str(l, 60));
  const series: Series[] = arr(spec.series, MAX_SERIES)
    .filter(isObj)
    .map((s, i) => ({
      name: str(s.name, 40) || `系列 ${i + 1}`,
      data: arr(s.data, MAX_CATEGORIES).map((v) => num(v) ?? NaN),
    }))
    .filter((s) => s.data.some(Number.isFinite));
  if (!series.length) return null;
  const n = Math.max(labels.length, ...series.map((s) => s.data.length));
  if (!n) return null;
  while (labels.length < n) labels.push(String(labels.length + 1));

  const yAxis = isObj(spec.y) ? spec.y : {};
  const xAxis = isObj(spec.x) ? spec.x : {};
  const unit = str(yAxis.unit, 8);
  const stacked = kind === "bar" && spec.stacked === true && series.length > 1;

  let lo = 0;
  let hi = 0;
  for (let c = 0; c < n; c += 1) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.data[c];
        if (!Number.isFinite(v)) continue;
        if (v >= 0) pos += v; else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    } else {
      for (const s of series) {
        const v = s.data[c];
        if (!Number.isFinite(v)) continue;
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
    }
  }
  // 折线/面积图不强行从 0 起：数据挤在顶部一条线上看不出趋势
  if (kind !== "bar") {
    const vals = series.flatMap((s) => s.data.filter(Number.isFinite));
    const dmin = Math.min(...vals);
    const dmax = Math.max(...vals);
    if (spec.zero !== true && dmin > 0 && dmin > (dmax - dmin)) lo = dmin - (dmax - dmin) * 0.15;
    hi = dmax;
  }
  const ticks = niceTicks(lo, hi);
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];

  const { W, H, mt } = PLOT;
  const ph = H - mt;
  const sy = (v: number): number => mt + ph - ((v - y0) / (y1 - y0)) * ph;
  const band = W / n;
  const cx = (i: number): number => band * i + band / 2;

  const parts: string[] = [];
  for (const t of ticks) {
    const y = sy(t);
    parts.push(`<line class="ui-grid${t === 0 ? " ui-grid-zero" : ""}" x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
  }
  // x 标签：按最窄的对话面板估算，放不下就隔几个显示一个
  const bandPx = PLOT.minPx / n;
  const maxLabelW = Math.max(...labels.map((l) => textWidth(l, 11)));
  const every = Math.max(1, Math.ceil((Math.min(maxLabelW, 90) + 8) / bandPx));
  const xTicks: AxisTick[] = [];
  for (let i = 0; i < n; i += every) {
    xTicks.push({ pos: cx(i) / W, label: clip(labels[i], Math.max(bandPx * every - 6, 28), 11), full: labels[i] });
  }
  const yTicks: AxisTick[] = ticks.map((t) => ({ pos: sy(t) / H, label: formatTick(t, unit) }));

  const tipLine = (s: Series, c: number): string =>
    `${s.name}：${Number.isFinite(s.data[c]) ? formatNumber(s.data[c], unit) : "—"}`;

  if (kind === "bar") {
    const inner = band * 0.72;
    const zeroY = sy(Math.max(y0, Math.min(0, y1)));
    for (let c = 0; c < n; c += 1) {
      let posAcc = 0;
      let negAcc = 0;
      series.forEach((s, si) => {
        const v = s.data[c];
        if (!Number.isFinite(v)) return;
        let x: number;
        let w: number;
        let top: number;
        let bottom: number;
        if (stacked) {
          w = inner;
          x = cx(c) - inner / 2;
          const from = v >= 0 ? posAcc : negAcc;
          const to = from + v;
          if (v >= 0) posAcc = to; else negAcc = to;
          top = sy(Math.max(from, to));
          bottom = sy(Math.min(from, to));
        } else {
          w = inner / series.length;
          x = cx(c) - inner / 2 + w * si;
          top = v >= 0 ? sy(v) : zeroY;
          bottom = v >= 0 ? zeroY : sy(v);
        }
        const h = Math.max(1, bottom - top);
        const gap = !stacked && series.length > 1 ? Math.min(2, w * 0.12) : 0;
        parts.push(`<rect class="ui-mark ui-bar ui-f${si % MAX_SERIES}" data-series="${si}" x="${(x + gap / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, w - gap).toFixed(1)}" height="${h.toFixed(1)}" rx="3" data-tip="${attr(`${labels[c]}\n${tipLine(s, c)}`)}"/>`);
      });
    }
  } else {
    series.forEach((s, si) => {
      const pts: Array<[number, number]> = [];
      s.data.forEach((v, c) => { if (Number.isFinite(v) && c < n) pts.push([cx(c), sy(v)]); });
      if (!pts.length) return;
      const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
      if (kind === "area") {
        const base = sy(Math.max(y0, Math.min(0, y1)));
        parts.push(`<path class="ui-area ui-f${si % MAX_SERIES}" data-series="${si}" d="${d}L${pts[pts.length - 1][0].toFixed(1)} ${base.toFixed(1)}L${pts[0][0].toFixed(1)} ${base.toFixed(1)}Z"/>`);
      }
      parts.push(`<path class="ui-line ui-s${si % MAX_SERIES}" data-series="${si}" d="${d}"/>`);
      if (n <= 40) {
        for (const [x, y] of pts) parts.push(`<circle class="ui-dot ui-f${si % MAX_SERIES}" data-series="${si}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`);
      }
    });
    // 整列命中区：鼠标停在某一列，提示该列所有系列的值（同 ChatGPT 图表的悬停体验）
    for (let c = 0; c < n; c += 1) {
      const tip = [labels[c], ...series.map((s) => tipLine(s, c))].join("\n");
      parts.push(`<rect class="ui-hit" x="${(cx(c) - band / 2).toFixed(1)}" y="0" width="${band.toFixed(1)}" height="${H}" data-tip="${attr(tip)}"/>`);
    }
  }

  return legend(series.map((s) => s.name)) + plotFrame({
    parts,
    xTicks,
    yTicks,
    xLabel: str(xAxis.label, 40),
    yLabel: str(yAxis.label, 30) + (str(yAxis.label, 30) && unit && unit !== "%" ? `（${unit}）` : ""),
    aria: str(spec.title, 120) || "图表",
  });
}

const PLOT = { W: 600, H: 240, mt: 8, minPx: 400 } as const;

interface AxisTick { pos: number; label: string; full?: string }

/**
 * 坐标图外框：SVG 只画网格与数据（随宽度等比缩放），刻度与轴名用 HTML 按百分比定位，
 * 字号固定 11px —— 否则窄面板里 SVG 文字会跟着 viewBox 缩到看不清。
 */
function plotFrame(o: { parts: string[]; xTicks: AxisTick[]; yTicks: AxisTick[]; xLabel: string; yLabel: string; aria: string }): string {
  const yw = Math.ceil(Math.max(0, ...o.yTicks.map((t) => textWidth(t.label, 11)))) + 8;
  const pct = (p: number): string => `${(p * 100).toFixed(3)}%`;
  return `<div class="ui-chart-frame" style="--ui-yw:${yw}px">` +
    (o.yLabel ? `<div class="ui-axis-y">${esc(o.yLabel)}</div>` : "") +
    `<div class="ui-plot">` +
      `<div class="ui-yticks" aria-hidden="true">${o.yTicks.map((t) => `<span class="ui-tick" style="top:${pct(t.pos)}">${esc(t.label)}</span>`).join("")}</div>` +
      `<div class="ui-plot-area"><svg class="ui-svg" viewBox="0 0 ${PLOT.W} ${PLOT.H}" role="img" aria-label="${attr(o.aria)}">${o.parts.join("")}</svg></div>` +
      `<div class="ui-xticks" aria-hidden="true">${o.xTicks.map((t) => `<span class="ui-tick" style="left:${pct(t.pos)}"${t.full && t.full !== t.label ? ` title="${attr(t.full)}"` : ""}>${esc(t.label)}</span>`).join("")}</div>` +
    `</div>` +
    (o.xLabel ? `<div class="ui-axis-x">${esc(o.xLabel)}</div>` : "") +
  `</div>`;
}

function renderPie(spec: Json, donut: boolean): string | null {
  const labels = arr(spec.labels, MAX_CATEGORIES).map((l) => str(l, 60));
  const first = arr(spec.series, 1).find(isObj);
  const raw = first ? arr(first.data, MAX_CATEGORIES) : arr(spec.data, MAX_CATEGORIES);
  const items = raw
    .map((v, i) => ({ label: labels[i] || `项 ${i + 1}`, value: num(v) ?? 0 }))
    .filter((it) => it.value > 0)
    .sort((a, b) => b.value - a.value);
  if (!items.length) return null;
  // 调色板只有 8 色且不循环：第 8 项起并成「其他」
  if (items.length > MAX_SERIES) {
    const rest = items.splice(MAX_SERIES - 1);
    items.push({ label: "其他", value: rest.reduce((a, b) => a + b.value, 0) });
  }
  const unit = isObj(spec.y) ? str(spec.y.unit, 8) : str(spec.unit, 8);
  const total = items.reduce((a, b) => a + b.value, 0);
  const R = 92;
  const r = donut ? 56 : 0;
  const C = 110;
  let angle = -Math.PI / 2;
  const slices: string[] = [];
  items.forEach((it, i) => {
    const frac = it.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const tip = `${it.label}\n${formatNumber(it.value, unit)}（${formatNumber(frac * 100, "%", 1)}）`;
    if (frac >= 0.9999) {
      slices.push(`<circle class="ui-mark ui-slice ui-f${i % MAX_SERIES}" data-series="${i}" cx="${C}" cy="${C}" r="${R}" data-tip="${attr(tip)}"/>`);
      return;
    }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number): string => `${(C + rad * Math.cos(a)).toFixed(2)} ${(C + rad * Math.sin(a)).toFixed(2)}`;
    const d = r
      ? `M${p(R, a0)}A${R} ${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r} ${r} 0 ${large} 0 ${p(r, a0)}Z`
      : `M${C} ${C}L${p(R, a0)}A${R} ${R} 0 ${large} 1 ${p(R, a1)}Z`;
    slices.push(`<path class="ui-mark ui-slice ui-f${i % MAX_SERIES}" data-series="${i}" d="${d}" data-tip="${attr(tip)}"/>`);
  });
  if (donut) {
    slices.push(`<text class="ui-donut-total" x="${C}" y="${C + 2}" text-anchor="middle">${esc(formatTick(total, ""))}${esc(unit && unit !== "%" ? unit : "")}</text>`);
    slices.push(`<text class="ui-tick" x="${C}" y="${C + 20}" text-anchor="middle">合计</text>`);
  }
  const svg = `<svg class="ui-svg ui-pie-svg" viewBox="0 0 220 220" role="img" aria-label="${attr(str(spec.title, 120) || "饼图")}">${slices.join("")}</svg>`;
  const list = `<div class="ui-pie-legend" role="list">${items
    .map((it, i) => `<div class="ui-pie-row" role="listitem"><span class="ui-swatch ui-c${i % MAX_SERIES}"></span><span class="ui-pie-name">${esc(it.label)}</span><span class="ui-pie-val">${esc(formatNumber((it.value / total) * 100, "%", 1))}</span></div>`)
    .join("")}</div>`;
  return `<div class="ui-pie-wrap">${svg}${list}</div>`;
}

function renderScatter(spec: Json): string | null {
  const groups = arr(spec.series, MAX_SERIES).filter(isObj).map((s, i) => ({
    name: str(s.name, 40) || `系列 ${i + 1}`,
    pts: arr(s.data, MAX_POINTS)
      .map((p) => {
        if (Array.isArray(p)) return { x: num(p[0]), y: num(p[1]), label: str(p[2], 60) };
        if (isObj(p)) return { x: num(p.x), y: num(p.y), label: str(p.label, 60) };
        return { x: null, y: null, label: "" };
      })
      .filter((p): p is { x: number; y: number; label: string } => p.x !== null && p.y !== null),
  })).filter((g) => g.pts.length);
  if (!groups.length) return null;
  const all = groups.flatMap((g) => g.pts);
  const xs = niceTicks(Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x)));
  const ys = niceTicks(Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y)));
  const xAxis = isObj(spec.x) ? spec.x : {};
  const yAxis = isObj(spec.y) ? spec.y : {};
  const xu = str(xAxis.unit, 8);
  const yu = str(yAxis.unit, 8);
  const { W, H, mt } = PLOT;
  const PADX = 10;
  const ph = H - mt;
  const sx = (v: number): number => PADX + ((v - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - PADX * 2);
  const sy = (v: number): number => mt + ph - ((v - ys[0]) / (ys[ys.length - 1] - ys[0])) * ph;
  const parts: string[] = [];
  for (const t of ys) {
    parts.push(`<line class="ui-grid" x1="0" x2="${W}" y1="${sy(t).toFixed(1)}" y2="${sy(t).toFixed(1)}"/>`);
  }
  for (const t of xs) {
    parts.push(`<line class="ui-grid ui-grid-v" x1="${sx(t).toFixed(1)}" x2="${sx(t).toFixed(1)}" y1="0" y2="${H}"/>`);
  }
  groups.forEach((g, gi) => {
    for (const p of g.pts) {
      const tip = `${p.label ? `${p.label}\n` : ""}${groups.length > 1 ? `${g.name}\n` : ""}${str(xAxis.label, 40) || "x"}：${formatNumber(p.x, xu)}\n${str(yAxis.label, 40) || "y"}：${formatNumber(p.y, yu)}`;
      parts.push(`<circle class="ui-mark ui-dot ui-f${gi % MAX_SERIES}" data-series="${gi}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" data-tip="${attr(tip)}"/>`);
    }
  });
  return legend(groups.map((g) => g.name)) + plotFrame({
    parts,
    xTicks: xs.map((t) => ({ pos: sx(t) / W, label: formatTick(t, xu) })),
    yTicks: ys.map((t) => ({ pos: sy(t) / H, label: formatTick(t, yu) })),
    xLabel: str(xAxis.label, 40),
    yLabel: str(yAxis.label, 30),
    aria: str(spec.title, 120) || "散点图",
  });
}

// ── 示意图（流程 / 架构 / 关系）─────────────────────────────────────────────

interface DNode { id: string; label: string[]; shape: string; tone: string; w: number; h: number; layer: number; order: number; x: number; y: number }

function wrapLabel(label: string, maxPx: number, fontPx: number): string[] {
  const lines: string[] = [];
  for (const para of label.split(/\n/)) {
    let line = "";
    // 中文逐字断行，英文按词断行
    const tokens = para.match(/[⺀-￿]|[^\s⺀-￿]+|\s+/g) ?? [];
    for (const tok of tokens) {
      if (textWidth(line + tok, fontPx) > maxPx && line.trim()) {
        lines.push(line.trim());
        line = tok.trimStart();
      } else {
        line += tok;
      }
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines.slice(0, 4).map((l) => clip(l, maxPx, fontPx));
}

function renderDiagram(spec: Json, key: string): string | null {
  const FONT = 12.5;
  const nodes = new Map<string, DNode>();
  for (const n of arr(spec.nodes, MAX_NODES)) {
    if (!isObj(n)) continue;
    const id = str(n.id, 60);
    if (!id || nodes.has(id)) continue;
    const label = wrapLabel(str(n.label, 120) || id, 150, FONT);
    const shape = ["box", "round", "diamond", "circle"].includes(str(n.shape)) ? str(n.shape) : "box";
    const tone = ["primary", "success", "warn", "danger", "muted"].includes(str(n.tone)) ? str(n.tone) : "";
    const tw = Math.max(...label.map((l) => textWidth(l, FONT)));
    let w = Math.max(64, Math.ceil(tw) + 28);
    let h = label.length * 17 + 18;
    if (shape === "diamond") { w = Math.ceil(w * 1.45); h = Math.ceil(h * 1.6); }
    if (shape === "circle") { w = h = Math.max(w, h, 56); }
    nodes.set(id, { id, label, shape, tone, w, h, layer: 0, order: 0, x: 0, y: 0 });
  }
  if (!nodes.size) return null;
  const edges = arr(spec.edges, MAX_EDGES)
    .filter(isObj)
    .map((e) => ({ from: str(e.from, 60), to: str(e.to, 60), label: str(e.label, 40), dashed: e.dashed === true }))
    .filter((e) => nodes.has(e.from) && nodes.has(e.to) && e.from !== e.to);

  // 分层：DFS 去掉回边后按最长路径分层（环里的回边单独绕行）
  const out = new Map<string, string[]>();
  for (const id of nodes.keys()) out.set(id, []);
  const back = new Set<number>();
  const state = new Map<string, 0 | 1 | 2>();
  const idxOf = new Map<string, number[]>();
  edges.forEach((e, i) => { out.get(e.from)!.push(e.to); idxOf.set(`${e.from}\u0000${e.to}`, [...(idxOf.get(`${e.from}\u0000${e.to}`) ?? []), i]); });
  const dfs = (u: string): void => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      const s = state.get(v) ?? 0;
      if (s === 1) for (const i of idxOf.get(`${u}\u0000${v}`) ?? []) back.add(i);
      else if (s === 0) dfs(v);
    }
    state.set(u, 2);
  };
  for (const id of nodes.keys()) if (!state.get(id)) dfs(id);
  const fwd = edges.filter((_, i) => !back.has(i));
  // 最长路径分层：反复松弛直到稳定（节点 ≤ 50，开销可忽略）
  for (let pass = 0; pass < nodes.size; pass += 1) {
    let changed = false;
    for (const e of fwd) {
      const a = nodes.get(e.from)!;
      const b = nodes.get(e.to)!;
      if (b.layer < a.layer + 1) { b.layer = a.layer + 1; changed = true; }
    }
    if (!changed) break;
  }
  const layers: DNode[][] = [];
  for (const n of nodes.values()) (layers[n.layer] ??= []).push(n);
  for (let i = 0; i < layers.length; i += 1) layers[i] ??= [];
  layers.forEach((l) => l.forEach((n, i) => { n.order = i; }));
  // 重心法排序两轮，减少交叉
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of fwd) {
    (preds.get(e.to) ?? preds.set(e.to, []).get(e.to)!).push(e.from);
    (succs.get(e.from) ?? succs.set(e.from, []).get(e.from)!).push(e.to);
  }
  const bary = (n: DNode, nb: Map<string, string[]>): number => {
    const ns = nb.get(n.id) ?? [];
    return ns.length ? ns.reduce((a, id) => a + nodes.get(id)!.order, 0) / ns.length : n.order;
  };
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let i = 1; i < layers.length; i += 1) {
      layers[i].sort((a, b) => bary(a, preds) - bary(b, preds));
      layers[i].forEach((n, k) => { n.order = k; });
    }
    for (let i = layers.length - 2; i >= 0; i -= 1) {
      layers[i].sort((a, b) => bary(a, succs) - bary(b, succs));
      layers[i].forEach((n, k) => { n.order = k; });
    }
  }

  const lr = str(spec.direction).toUpperCase() === "LR";
  const GAP_MAIN = lr ? 56 : 44;
  const GAP_CROSS = 22;
  const PAD = 14;
  // 主轴 = 层的方向（TB 为纵向）；交叉轴 = 同层排开的方向
  const mainSize = (n: DNode): number => (lr ? n.w : n.h);
  const crossSize = (n: DNode): number => (lr ? n.h : n.w);
  const layerMain = layers.map((l) => Math.max(0, ...l.map(mainSize)));
  const layerCross = layers.map((l) => l.reduce((a, n) => a + crossSize(n), 0) + GAP_CROSS * Math.max(0, l.length - 1));
  const crossTotal = Math.max(...layerCross);
  let mainPos = PAD;
  layers.forEach((l, li) => {
    let c = PAD + (crossTotal - layerCross[li]) / 2;
    for (const n of l) {
      const m = mainPos + (layerMain[li] - mainSize(n)) / 2;
      if (lr) { n.x = m; n.y = c; } else { n.x = c; n.y = m; }
      c += crossSize(n) + GAP_CROSS;
    }
    mainPos += layerMain[li] + GAP_MAIN;
  });
  const W = Math.ceil(lr ? mainPos - GAP_MAIN + PAD : crossTotal + PAD * 2);
  const H = Math.ceil(lr ? crossTotal + PAD * 2 : mainPos - GAP_MAIN + PAD);

  const marker = `ui-arr-${key}`;
  const parts: string[] = [
    `<defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="ui-arrow"/></marker></defs>`,
  ];
  const labelsSvg: string[] = [];
  edges.forEach((e, i) => {
    const a = nodes.get(e.from)!;
    const b = nodes.get(e.to)!;
    let d: string;
    let mx: number;
    let my: number;
    if (back.has(i) || b.layer <= a.layer) {
      // 回边 / 同层：从侧面绕出去
      if (lr) {
        const y1 = a.y + a.h;
        const y2 = b.y + b.h;
        const dip = Math.max(y1, y2) + 26;
        d = `M${a.x + a.w / 2} ${y1}C${a.x + a.w / 2} ${dip} ${b.x + b.w / 2} ${dip} ${b.x + b.w / 2} ${y2 + 2}`;
        mx = (a.x + b.x + a.w / 2 + b.w / 2) / 2; my = 0.125 * y1 + 0.75 * dip + 0.125 * y2;
      } else {
        const x1 = a.x + a.w;
        const x2 = b.x + b.w;
        const bulge = Math.max(x1, x2) + 30;
        d = `M${x1} ${a.y + a.h / 2}C${bulge} ${a.y + a.h / 2} ${bulge} ${b.y + b.h / 2} ${x2 + 2} ${b.y + b.h / 2}`;
        // 三次贝塞尔 t=0.5 处的 x（两个控制点都在 bulge 上）：标签贴在曲线最外侧，不压节点
        mx = 0.125 * x1 + 0.75 * bulge + 0.125 * x2; my = (a.y + b.y + a.h / 2 + b.h / 2) / 2;
      }
    } else if (lr) {
      const x1 = a.x + a.w; const y1 = a.y + a.h / 2;
      const x2 = b.x - 2; const y2 = b.y + b.h / 2;
      const k = (x2 - x1) / 2;
      d = `M${x1} ${y1}C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`;
      mx = (x1 + x2) / 2; my = (y1 + y2) / 2;
    } else {
      const x1 = a.x + a.w / 2; const y1 = a.y + a.h;
      const x2 = b.x + b.w / 2; const y2 = b.y - 2;
      const k = (y2 - y1) / 2;
      d = `M${x1} ${y1}C${x1} ${y1 + k} ${x2} ${y2 - k} ${x2} ${y2}`;
      mx = (x1 + x2) / 2; my = (y1 + y2) / 2;
    }
    parts.push(`<path class="ui-edge${e.dashed ? " ui-edge-dashed" : ""}" d="${d}" marker-end="url(#${marker})"/>`);
    if (e.label) {
      const lw = textWidth(e.label, 11) + 10;
      labelsSvg.push(`<rect class="ui-edge-label-bg" x="${(mx - lw / 2).toFixed(1)}" y="${(my - 9).toFixed(1)}" width="${lw.toFixed(1)}" height="17" rx="4"/><text class="ui-edge-label" x="${mx.toFixed(1)}" y="${(my + 3.5).toFixed(1)}" text-anchor="middle">${esc(e.label)}</text>`);
    }
  });
  for (const n of nodes.values()) {
    const cls = `ui-node${n.tone ? ` ui-node-${n.tone}` : ""}`;
    let shapeSvg: string;
    if (n.shape === "diamond") {
      shapeSvg = `<polygon class="${cls}" points="${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}"/>`;
    } else if (n.shape === "circle") {
      shapeSvg = `<circle class="${cls}" cx="${n.x + n.w / 2}" cy="${n.y + n.h / 2}" r="${n.w / 2}"/>`;
    } else {
      // 胶囊保持原生半圆；方节点走与卡片同一套贝塞尔角（apple-corners 同源 squirclePath，smoothing 同 MD 卡 0.85）
      shapeSvg = n.shape === "round"
        ? `<rect class="${cls}" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.h / 2}"/>`
        : `<path class="${cls}" transform="translate(${n.x} ${n.y})" d="${squirclePath({ width: n.w, height: n.h, radius: 8, smoothing: 0.85 })}"/>`;
    }
    const top = n.y + n.h / 2 - ((n.label.length - 1) * 17) / 2 + 4.5;
    const text = n.label.map((l, i) => `<text class="ui-node-text" x="${n.x + n.w / 2}" y="${(top + i * 17).toFixed(1)}" text-anchor="middle">${esc(l)}</text>`).join("");
    parts.push(`<g class="ui-node-g">${shapeSvg}${text}</g>`);
  }
  parts.push(...labelsSvg);
  // 视宽：图本身窄就按实际像素显示，别被拉伸到整行宽
  return `<div class="ui-diagram-scroll"><svg class="ui-svg ui-diagram-svg" viewBox="0 0 ${W + (lr ? 0 : 30)} ${H + (lr ? 30 : 0)}" style="max-width:${W + (lr ? 0 : 30)}px" role="img" aria-label="${attr(str(spec.title, 120) || "示意图")}">${parts.join("")}</svg></div>`;
}

// ── 指标卡 / 步骤 / 对比 / 提示 ──────────────────────────────────────────────

function renderStats(spec: Json, ctx: RichUiRenderContext): string | null {
  const items = arr(spec.items, MAX_ITEMS).filter(isObj);
  if (!items.length) return null;
  return `<div class="ui-stats-grid">${items.map((it) => {
    const trend = ["up", "down", "flat"].includes(str(it.trend)) ? str(it.trend) : "";
    // 涨跌好坏不一定同向（错误率上升是坏事）：good 字段显式声明，缺省「涨=好」
    const good = it.good === false ? false : it.good === true ? true : trend === "up" ? true : trend === "down" ? false : null;
    const delta = str(it.delta, 30);
    const progress = num(it.progress);
    const tone = toneStyle(it.tone);
    return `<div class="ui-stat${tone ? " has-tone" : ""}" data-ui-sig="${sigOf(it)}"${tone ? ` style="${tone}"` : ""}>` +
      `<div class="ui-stat-label">${ctx.inline(str(it.label, 60))}</div>` +
      `<div class="ui-stat-value">${esc(str(it.value, 40))}${str(it.unit) ? `<span class="ui-stat-unit">${esc(str(it.unit, 12))}</span>` : ""}</div>` +
      (delta ? `<div class="ui-stat-delta${good === true ? " is-good" : good === false ? " is-bad" : ""}">${trend === "up" ? "▲ " : trend === "down" ? "▼ " : ""}${esc(delta)}</div>` : "") +
      (progress !== null ? `<div class="ui-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.max(0, Math.min(100, progress)))}"><span style="width:${Math.max(0, Math.min(100, progress)).toFixed(1)}%"></span></div>` : "") +
      (str(it.note) ? `<div class="ui-stat-note">${ctx.inline(str(it.note, 160))}</div>` : "") +
      `</div>`;
  }).join("")}</div>`;
}

function renderSteps(spec: Json, ctx: RichUiRenderContext): string | null {
  const items = arr(spec.items, MAX_ITEMS).filter(isObj);
  if (!items.length) return null;
  return `<div class="ui-steps-list" role="list">${items.map((it, i) => {
    const status = ["done", "active", "todo", "error"].includes(str(it.status)) ? str(it.status) : "";
    const marker = status === "done" ? "✓" : status === "error" ? "!" : String(i + 1);
    const meta = str(it.meta, 60);
    return `<div class="ui-step${status ? ` is-${status}` : ""}" role="listitem" data-ui-sig="${sigOf(it)}"><span class="ui-step-dot">${marker}</span><div class="ui-step-body">` +
      `<div class="ui-step-title">${ctx.inline(str(it.title, 160))}${meta ? `<span class="ui-step-meta">${esc(meta)}</span>` : ""}</div>` +
      (str(it.detail) ? `<div class="ui-step-detail">${ctx.inline(str(it.detail, 600))}</div>` : "") +
      `</div></div>`;
  }).join("")}</div>`;
}

function renderCompare(spec: Json, ctx: RichUiRenderContext): string | null {
  const cols = arr(spec.columns, 4).filter(isObj);
  if (cols.length < 2) return null;
  return `<div class="ui-compare-grid" style="--ui-cols:${cols.length}">${cols.map((c) => {
    const badge = str(c.badge, 20);
    const pros = arr(c.pros, 10).map((p) => str(p, 200)).filter(Boolean);
    const cons = arr(c.cons, 10).map((p) => str(p, 200)).filter(Boolean);
    const points = arr(c.points, 12).map((p) => str(p, 200)).filter(Boolean);
    const list = (xs: string[], cls: string, mark: string): string =>
      xs.length ? `<div class="ui-compare-list ${cls}" role="list">${xs.map((x) => `<div class="ui-compare-item" role="listitem"><span class="ui-compare-mark">${mark}</span><span>${ctx.inline(x)}</span></div>`).join("")}</div>` : "";
    return `<div class="ui-compare-col${c.highlight === true ? " is-highlight" : ""}" data-ui-sig="${sigOf(c)}">` +
      (badge ? `<span class="ui-badge">${esc(badge)}</span>` : "") +
      `<div class="ui-compare-title">${ctx.inline(str(c.title, 80))}</div>` +
      (str(c.subtitle) ? `<div class="ui-compare-sub">${ctx.inline(str(c.subtitle, 160))}</div>` : "") +
      list(points, "", "•") + list(pros, "is-pro", "+") + list(cons, "is-con", "−") +
      (str(c.verdict) ? `<div class="ui-compare-verdict">${ctx.inline(str(c.verdict, 200))}</div>` : "") +
      `</div>`;
  }).join("")}</div>`;
}

const CALLOUT_ICON: Record<string, string> = {
  info: `<circle cx="8" cy="8" r="6.2"/><path d="M8 7.2v4"/><circle cx="8" cy="4.9" r=".55" fill="currentColor" stroke="none"/>`,
  tip: `<path d="M5.6 10.4a4.2 4.2 0 1 1 4.8 0V12H5.6z"/><path d="M6.2 14h3.6"/>`,
  warn: `<path d="M8 2.2 14.2 13H1.8z"/><path d="M8 6.4v3.2"/><circle cx="8" cy="11.4" r=".55" fill="currentColor" stroke="none"/>`,
  danger: `<circle cx="8" cy="8" r="6.2"/><path d="m5.6 5.6 4.8 4.8M10.4 5.6l-4.8 4.8"/>`,
  success: `<circle cx="8" cy="8" r="6.2"/><path d="m5.2 8.2 2 2 3.6-4"/>`,
};

function renderCallout(spec: Json, ctx: RichUiRenderContext, tone: string): string | null {
  const title = str(spec.title, 120);
  const body = str(spec.body, 1200);
  if (!title && !body) return null;
  return `<div class="ui-callout-row"><svg class="ui-callout-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CALLOUT_ICON[tone]}</svg><div class="ui-callout-text">` +
    (title ? `<div class="ui-callout-title">${ctx.inline(title)}</div>` : "") +
    (body ? `<div class="ui-callout-body">${body.split(/\n+/).map((p) => ctx.inline(p)).join("<br>")}</div>` : "") +
    `</div></div>`;
}

// ── 交互控件：标签页 / 选项 / 计算器 ─────────────────────────────────────────

function renderTabs(spec: Json, ctx: RichUiRenderContext): string | null {
  const tabs = arr(spec.tabs, 8).filter(isObj).map((t) => ({ label: str(t.label, 40), body: str(t.body, 8000) })).filter((t) => t.label);
  if (tabs.length < 2) return null;
  return `<div class="ui-tablist" role="tablist">${tabs.map((t, i) =>
    `<button type="button" class="ui-tab${i === 0 ? " is-active" : ""}" role="tab" aria-selected="${i === 0}" data-ui-tab="${i}">${esc(t.label)}</button>`).join("")}</div>` +
    // 正文里的代码围栏写成 ~~~：写 ``` 会提前闭合外层 ```ui 围栏，整块就渲染不出来了
    tabs.map((t, i) => `<div class="ui-tabpanel md-content" role="tabpanel" data-ui-panel="${i}"${i === 0 ? "" : " hidden"}>${ctx.block(t.body.replace(/^(\s*)~~~/gm, "$1```"))}</div>`).join("");
}

function renderChoices(spec: Json, ctx: RichUiRenderContext): string | null {
  const options = arr(spec.options, 10).map((o) => {
    if (typeof o === "string") return { label: o.slice(0, 80), value: o.slice(0, 400), description: "" };
    if (!isObj(o)) return null;
    const label = str(o.label, 80);
    return label ? { label, value: str(o.value, 400) || label, description: str(o.description, 160) } : null;
  }).filter((o): o is { label: string; value: string; description: string } => o !== null);
  if (!options.length) return null;
  const multi = spec.multi === true;
  const prompt = str(spec.prompt, 200);
  return (prompt ? `<div class="ui-choices-prompt">${ctx.inline(prompt)}</div>` : "") +
    `<div class="ui-choices-list${multi ? " is-multi" : ""}" data-ui-multi="${multi ? 1 : 0}">${options.map((o) =>
      `<button type="button" class="ui-choice" data-ui-choice="${attr(o.value)}"${multi ? ` aria-pressed="false"` : ""}>` +
        `<span class="ui-choice-label">${esc(o.label)}</span>` +
        (o.description ? `<span class="ui-choice-desc">${esc(o.description)}</span>` : "") +
      `</button>`).join("")}</div>` +
    (multi ? `<div class="ui-choices-actions"><button type="button" class="ui-choice-submit" data-ui-choice-submit disabled>发送所选</button></div>` : "");
}

const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/;

/** 计算器输出的初始值与 JS 重算共用同一份逻辑，保证首帧与拖动后格式一致。 */
export function computeCalcOutput(formula: string, vars: Record<string, number>, unit: string, decimals: number | null): string {
  const v = evaluateFormula(formula, vars);
  return v === null ? "—" : formatNumber(v, unit, decimals ?? undefined);
}

function renderCalculator(spec: Json, ctx: RichUiRenderContext): string | null {
  const inputs = arr(spec.inputs, 8).filter(isObj).map((i) => {
    const id = str(i.id, 31);
    const min = num(i.min) ?? 0;
    const max = num(i.max) ?? 100;
    const step = num(i.step) ?? (max - min > 20 ? 1 : 0.1);
    const value = Math.max(min, Math.min(max, num(i.value) ?? min));
    return VAR_RE.test(id) && max > min && step > 0
      ? { id, label: str(i.label, 60) || id, min, max, step, value, unit: str(i.unit, 10) }
      : null;
  }).filter((i): i is NonNullable<typeof i> => i !== null);
  const outputs = arr(spec.outputs, 6).filter(isObj).map((o) => ({
    label: str(o.label, 60),
    formula: str(o.formula, 400),
    unit: str(o.unit, 10),
    decimals: num(o.decimals) !== null ? Math.max(0, Math.min(6, Math.round(num(o.decimals)!))) : null,
  })).filter((o) => o.label && o.formula);
  if (!inputs.length || !outputs.length) return null;
  const vars = Object.fromEntries(inputs.map((i) => [i.id, i.value]));
  const decimalsOf = (step: number): number => (String(step).split(".")[1] ?? "").length;
  return `<div class="ui-calc">` +
    `<div class="ui-calc-inputs">${inputs.map((i) =>
      `<label class="ui-calc-field"><span class="ui-calc-label">${ctx.inline(i.label)}<output class="ui-calc-current" data-ui-var-out="${attr(i.id)}">${esc(formatNumber(i.value, i.unit, decimalsOf(i.step)))}</output></span>` +
      `<input type="range" data-ui-var="${attr(i.id)}" data-ui-unit="${attr(i.unit)}" data-ui-dec="${decimalsOf(i.step)}" min="${i.min}" max="${i.max}" step="${i.step}" value="${i.value}" aria-label="${attr(i.label)}"></label>`).join("")}</div>` +
    `<div class="ui-calc-outputs">${outputs.map((o) =>
      `<div class="ui-calc-out"><div class="ui-calc-out-label">${ctx.inline(o.label)}</div><div class="ui-calc-out-value" data-ui-formula="${attr(o.formula)}" data-ui-unit="${attr(o.unit)}"${o.decimals !== null ? ` data-ui-dec="${o.decimals}"` : ""}>${esc(computeCalcOutput(o.formula, vars, o.unit, o.decimals))}</div></div>`).join("")}</div>` +
    `</div>`;
}
