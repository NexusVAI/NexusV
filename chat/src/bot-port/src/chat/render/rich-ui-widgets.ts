// 移植自 cancri-code/src/chat/render/rich-ui-widgets.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 智能交互界面 · 第二批组件（2026-10-17，对标 ChatGPT Intelligent UI 与 Gemini 动态视图）。
 *
 *   meters  横向进度条组（份额 / 达成率 / 力矩对比）
 *   flow    带图标的流程卡（纵向或横向，可高亮关键一步）
 *   cards   图文卡片（商品 / 方案 / 结论卡：角标、眉题、大号指标、来源 chip、操作按钮）
 *   form    问卷 / 表单（单选 / 多选 / 下拉 / 文本 / 滑块 / 开关 → 提交即作为下一条消息发给模型）
 *   figure  参数化示意图（SVG 原语，坐标可写 "=公式"，在 app 里随滑块实时变形）
 *   app     小应用：控件（滑块 / 分段 / 开关 / 下拉）+ 派生公式 + 面板网格，全部本地重算
 *
 * 与 rich-ui.ts 同一条安全底线：模型只给数据。文本全部转义，颜色只取白名单色调，
 * 公式走 rich-ui-formula 白名单解析器，SVG path 只认路径指令字符，图片走 rich-ui-core 闸门。
 */
import { evaluateFormula } from "./rich-ui-formula";
import {
  arr, attr, bindSpec, clampNum, esc, formatNumber, hasIcon, isObj, num, renderIcon, renderImage,
  sigOf, str, toneColor, toneStyle,
  type Json, type RichUiRenderContext, type UiScope,
} from "./rich-ui-core";

const MAX_ITEMS = 24;
const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]{0,30}$/;
const decimalsOf = (step: number): number => Math.min(6, (String(step).split(".")[1] ?? "").length);

// ── meters ──────────────────────────────────────────────────────────────────

export function renderMeters(spec: Json, ctx: RichUiRenderContext): string | null {
  const shared = num(spec.max);
  const rows = arr(spec.items, MAX_ITEMS).filter(isObj).map((it, i) => {
    const value = num(it.value);
    const label = str(it.label, 80);
    if (value === null || !label) return null;
    const min = num(it.min) ?? num(spec.min) ?? 0;
    const max = num(it.max) ?? shared ?? 100;
    const pct = max > min ? clampNum(((value - min) / (max - min)) * 100, 0, 100) : 0;
    const target = num(it.target);
    const tpct = target !== null && max > min ? clampNum(((target - min) / (max - min)) * 100, 0, 100) : null;
    const shown = str(it.display, 40) || formatNumber(value, str(it.unit, 10) || str(spec.unit, 10), num(it.decimals) ?? undefined);
    const tone = toneStyle(it.tone ?? spec.tone ?? i, "var(--ui-c0)");
    return `<div class="ui-meter" role="listitem" data-ui-sig="${sigOf(it)}" style="${tone}">` +
      `<div class="ui-meter-head"><span class="ui-meter-label">${ctx.inline(label)}</span><span class="ui-meter-value">${esc(shown)}</span></div>` +
      `<div class="ui-meter-track" role="meter" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-label="${attr(label)}">` +
        `<span class="ui-meter-fill" style="width:${pct.toFixed(2)}%"></span>` +
        (tpct !== null ? `<span class="ui-meter-target" style="left:${tpct.toFixed(2)}%"></span>` : "") +
      `</div>` +
      (str(it.note) ? `<div class="ui-meter-note">${ctx.inline(str(it.note, 200))}</div>` : "") +
      `</div>`;
  }).filter(Boolean);
  if (!rows.length) return null;
  return `<div class="ui-meters-list" role="list">${rows.join("")}</div>`;
}

// ── flow ────────────────────────────────────────────────────────────────────

const ARROW_DOWN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`;

export function renderFlow(spec: Json, ctx: RichUiRenderContext): string | null {
  const items = arr(spec.items, 12).filter(isObj).filter((it) => str(it.title));
  if (!items.length) return null;
  const lr = str(spec.direction) === "LR";
  const parts: string[] = [];
  items.forEach((it, i) => {
    if (i) parts.push(`<div class="ui-flow-arrow" aria-hidden="true">${ARROW_DOWN}</div>`);
    const hl = it.highlight === true || it.tone !== undefined;
    const icon = renderIcon(it.icon, 18) || `<span class="ui-flow-num">${i + 1}</span>`;
    parts.push(`<div class="ui-flow-item${hl ? " is-hl" : ""}" role="listitem" data-ui-sig="${sigOf(it)}"${hl ? ` style="${toneStyle(it.tone, "var(--ui-c0)")}"` : ""}>` +
      `<span class="ui-flow-icon">${icon}</span>` +
      `<div class="ui-flow-text"><div class="ui-flow-title">${ctx.inline(str(it.title, 120))}</div>` +
      (str(it.detail) ? `<div class="ui-flow-detail">${ctx.inline(str(it.detail, 400))}</div>` : "") +
      `</div></div>`);
  });
  return `<div class="ui-flow-list ${lr ? "is-lr" : "is-tb"}" role="list">${parts.join("")}</div>`;
}

// ── cards ───────────────────────────────────────────────────────────────────

function sourcesOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
  return list.map((u) => str(u, 600).trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 6);
}

function renderActions(v: unknown, ctx: RichUiRenderContext, cls = "ui-btn"): string {
  const list = (Array.isArray(v) ? v : v === undefined ? [] : [v]).filter(isObj).slice(0, 3);
  return list.map((a) => {
    const label = str(a.label, 40);
    if (!label) return "";
    const primary = a.primary === true ? " is-primary" : "";
    if (str(a.send)) return `<button type="button" class="${cls}${primary}" data-ui-send="${attr(str(a.send, 2000))}">${esc(label)}</button>`;
    if (str(a.copy)) return `<button type="button" class="${cls}${primary}" data-ui-copy="${attr(str(a.copy, 8000))}">${esc(label)}</button>`;
    const url = str(a.url, 1000);
    if (/^https?:\/\//i.test(url)) return `<span class="${cls} ui-btn-link${primary}">${ctx.inline(`[${label.replace(/[[\]]/g, "")}](${url.replace(/[()\s]/g, encodeURIComponent)})`)}</span>`;
    return "";
  }).join("");
}

export function renderCards(spec: Json, ctx: RichUiRenderContext): string | null {
  const items = arr(spec.items, MAX_ITEMS).filter(isObj).filter((it) => str(it.title) || str(it.metric));
  if (!items.length) return null;
  const sideMedia = (it: Json): boolean => ["left", "right"].includes(str(it.imagePosition));
  // 缺省版式只看条目「长什么样」、不看条数：流式时条目一条条到，版式不能中途从 list 跳成 grid
  const cols = num(spec.columns);
  // 显式多列 → 网格；否则有侧图 / 大数字的结论卡默认列表。
  const layout = ["list", "grid"].includes(str(spec.layout))
    ? str(spec.layout)
    : (cols ?? 0) >= 2
      ? "grid"
      : items.some((it) => sideMedia(it) || str(it.metric)) ? "list" : "grid";
  const ratio = ({ "1:1": "1 / 1", "4:3": "4 / 3", "3:2": "3 / 2", "16:9": "16 / 9", "3:4": "3 / 4" } as Record<string, string>)[str(spec.ratio)] ?? "4 / 3";
  const cards = items.map((it) => {
    const img = isObj(it.image) ? it.image : { src: it.image };
    const src = str(img.src, 1000);
    const alt = str(img.alt, 120) || str(it.title, 120);
    const pos = layout === "list" ? (str(it.imagePosition) === "left" ? "left" : "right") : "top";
    const badge = str(it.badge, 24);
    const badgeHtml = badge ? `<span class="ui-card-badge" style="${toneStyle(it.badgeTone, "")}">${esc(badge)}</span>` : "";
    let media = "";
    if (src) media = `<div class="ui-card-media">${renderImage(src, alt, { fit: str(img.fit), icon: str(it.icon) })}${layout === "grid" ? badgeHtml : ""}</div>`;
    else if (hasIcon(it.icon)) media = `<div class="ui-card-media is-icon" style="${toneStyle(it.tone, "")}">${renderIcon(it.icon, layout === "grid" ? 28 : 22)}${layout === "grid" ? badgeHtml : ""}</div>`;
    const title = str(it.title, 140);
    const url = str(it.url, 1000);
    const titleHtml = title
      ? `<div class="ui-card-title">${/^https?:\/\//i.test(url) ? ctx.inline(`[${title.replace(/[[\]]/g, "")}](${url.replace(/[()\s]/g, encodeURIComponent)})`) : ctx.inline(title)}</div>`
      : "";
    const metric = str(it.metric, 40);
    const meta = (Array.isArray(it.meta) ? it.meta : it.meta === undefined ? [] : [it.meta]).map((m) => str(m, 60)).filter(Boolean).slice(0, 5);
    const sources = sourcesOf(it.source ?? it.sources);
    const tags = arr(it.tags, 6).map((t) => str(t, 24)).filter(Boolean);
    const body =
      (str(it.eyebrow) ? `<div class="ui-card-eyebrow">${ctx.inline(str(it.eyebrow, 80))}</div>` : "") +
      (layout !== "grid" || !media ? badgeHtml : "") +
      titleHtml +
      (str(it.subtitle) ? `<div class="ui-card-sub">${ctx.inline(str(it.subtitle, 200))}</div>` : "") +
      (metric ? `<div class="ui-card-metric" style="${toneStyle(it.metricTone, "")}">${esc(metric)}${str(it.metricLabel) ? `<span class="ui-card-metric-label">${esc(str(it.metricLabel, 40))}</span>` : ""}</div>` : "") +
      (str(it.body) ? `<div class="ui-card-text">${str(it.body, 1200).split(/\n+/).map((p) => ctx.inline(p)).join("<br>")}</div>` : "") +
      (tags.length ? `<div class="ui-card-tags">${tags.map((t) => `<span class="ui-tag">${esc(t)}</span>`).join("")}</div>` : "") +
      (meta.length ? `<div class="ui-card-meta">${meta.map((m) => `<span>${ctx.inline(m)}</span>`).join("")}</div>` : "") +
      (sources.length ? `<div class="ui-card-sources">${ctx.inline(sources.map((u) => `[[cite:${u}]]`).join(""))}</div>` : "");
    const actions = renderActions(it.actions ?? it.action, ctx);
    return `<article class="ui-card is-${pos}${it.highlight === true ? " is-highlight" : ""}" data-ui-sig="${sigOf(it)}">` +
      (pos !== "right" ? media : "") +
      `<div class="ui-card-body">${body}${actions ? `<div class="ui-card-actions">${actions}</div>` : ""}</div>` +
      (pos === "right" ? media : "") +
      `</article>`;
  });
  const colsVar = cols ? `;--ui-cols:${clampNum(Math.round(cols), 1, 4)}` : "";
  return `<div class="ui-cards-grid is-${layout}${cols ? " has-cols" : ""}" role="list" style="--ui-ratio:${ratio}${colsVar}">${cards.join("")}</div>`;
}

// ── form ────────────────────────────────────────────────────────────────────

interface FieldOption { label: string; value: string; description: string }

function optionsOf(v: unknown, max = 12): FieldOption[] {
  return arr(v, max).map((o) => {
    if (typeof o === "string" || typeof o === "number") return { label: String(o).slice(0, 120), value: String(o).slice(0, 400), description: "" };
    if (!isObj(o)) return null;
    const label = str(o.label, 120);
    return label ? { label, value: str(o.value, 400) || label, description: str(o.description, 200) } : null;
  }).filter((o): o is FieldOption => o !== null);
}

const FIELD_KINDS = ["radio", "checkbox", "select", "text", "textarea", "slider", "toggle", "number"];

export function renderForm(spec: Json, ctx: RichUiRenderContext, key: string): string | null {
  const fields = arr(spec.fields, 16).filter(isObj).map((f, i) => {
    const id = VAR_RE.test(str(f.id, 31)) ? str(f.id, 31) : `f${i + 1}`;
    const kind = FIELD_KINDS.includes(str(f.kind)) ? str(f.kind) : Array.isArray(f.options) ? "radio" : "text";
    return { f, id, kind, label: str(f.label, 300), options: optionsOf(f.options) };
  }).filter((x) => x.label && (!["radio", "checkbox", "select"].includes(x.kind) || x.options.length));
  if (!fields.length) return null;
  const numbered = spec.numbered !== false && fields.length > 1;
  const html = fields.map(({ f, id, kind, label, options }, i) => {
    const name = `ui-${key}-${id}`;
    const req = f.required === true;
    const help = str(f.help, 300);
    const labelHtml = `${numbered ? `<span class="ui-field-no">${i + 1}.</span>` : ""}${ctx.inline(label)}${req ? `<span class="ui-field-req" aria-hidden="true">*</span>` : ""}`;
    const head = `<div class="ui-field-label">${labelHtml}</div>${help ? `<div class="ui-field-help">${ctx.inline(help)}</div>` : ""}`;
    const open = `<div class="ui-field is-${kind}" role="group" data-ui-field="${attr(id)}" data-ui-kind="${kind}" data-ui-label="${attr(label)}"${req ? " data-ui-required" : ""}>`;
    if (kind === "radio" || kind === "checkbox") {
      const def = Array.isArray(f.value) ? f.value.map((v) => str(v, 400)) : [str(f.value, 400)];
      return open + head + `<div class="ui-options${options.length > 4 || options.some((o) => o.description) ? " is-stack" : ""}">${options.map((o) =>
        `<label class="ui-option"><input type="${kind}" name="${attr(name)}" value="${attr(o.value)}" data-ui-opt-label="${attr(o.label)}"${def.includes(o.value) || def.includes(o.label) ? " checked" : ""}>` +
        `<span class="ui-option-mark" aria-hidden="true"></span><span class="ui-option-text"><span class="ui-option-label">${ctx.inline(o.label)}</span>` +
        (o.description ? `<span class="ui-option-desc">${ctx.inline(o.description)}</span>` : "") + `</span></label>`).join("")}</div></div>`;
    }
    if (kind === "select") {
      const def = str(f.value, 400);
      return open + head + `<select class="ui-input ui-select" name="${attr(name)}" aria-label="${attr(label)}">` +
        `<option value="">${esc(str(f.placeholder, 60) || "请选择")}</option>` +
        options.map((o) => `<option value="${attr(o.value)}"${def === o.value || def === o.label ? " selected" : ""}>${esc(o.label)}</option>`).join("") + `</select></div>`;
    }
    if (kind === "slider" || kind === "number") {
      const min = num(f.min) ?? 0;
      const max = num(f.max) ?? 100;
      const step = num(f.step) ?? (max - min > 20 ? 1 : 0.1);
      const value = clampNum(num(f.value) ?? min, min, max);
      const unit = str(f.unit, 10);
      if (kind === "number") {
        return open + head + `<input class="ui-input" type="number" name="${attr(name)}" min="${min}" max="${max}" step="${step}" value="${value}" aria-label="${attr(label)}"></div>`;
      }
      return open + `<div class="ui-field-label ui-field-label-row"><span>${labelHtml}</span><output class="ui-calc-current" data-ui-out-for="${attr(name)}">${esc(formatNumber(value, unit, decimalsOf(step)))}</output></div>` +
        (help ? `<div class="ui-field-help">${ctx.inline(help)}</div>` : "") +
        `<input class="ui-range" type="range" name="${attr(name)}" min="${min}" max="${max}" step="${step}" value="${value}" data-ui-unit="${attr(unit)}" data-ui-dec="${decimalsOf(step)}" aria-label="${attr(label)}"></div>`;
    }
    if (kind === "toggle") {
      return open + `<label class="ui-switch-row"><span class="ui-field-label">${labelHtml}</span><input class="ui-switch" type="checkbox" role="switch" name="${attr(name)}"${f.value === true ? " checked" : ""}></label>` +
        (help ? `<div class="ui-field-help">${ctx.inline(help)}</div>` : "") + `</div>`;
    }
    const ph = attr(str(f.placeholder, 120));
    const def = attr(str(f.value, 2000));
    return open + head + (kind === "textarea"
      ? `<textarea class="ui-input ui-textarea" name="${attr(name)}" rows="3" placeholder="${ph}" maxlength="2000" aria-label="${attr(label)}">${esc(str(f.value, 2000))}</textarea>`
      : `<input class="ui-input" type="text" name="${attr(name)}" placeholder="${ph}" value="${def}" maxlength="400" aria-label="${attr(label)}">`) + `</div>`;
  }).join("");
  const submit = str(spec.submit, 30) || "提交";
  return `<div class="ui-form-body" role="form" data-ui-form data-ui-title="${attr(str(spec.title, 120))}"${str(spec.message) ? ` data-ui-message="${attr(str(spec.message, 2000))}"` : ""}>` +
    (str(spec.description) ? `<div class="ui-form-desc">${ctx.inline(str(spec.description, 600))}</div>` : "") +
    `<div class="ui-form-fields">${html}</div>` +
    `<div class="ui-form-actions"><span class="ui-form-status" aria-live="polite"></span><button type="button" class="ui-btn is-primary" data-ui-form-submit>${esc(submit)}</button></div>` +
    `</div>`;
}

// ── figure ──────────────────────────────────────────────────────────────────

const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\-+\s]{1,4000}$/;
const MAX_SHAPES = 300;

function fig(v: unknown, scope: UiScope | null, fallback = 0): number {
  if (typeof v === "string" && v.startsWith("=") && scope) return evaluateFormula(v.slice(1), scope.vars) ?? fallback;
  return num(v) ?? fallback;
}

const f1 = (n: number): string => (Math.round(n * 100) / 100).toString();

interface FigCtx { scope: UiScope | null; count: number }

function paintOf(s: Json): { stroke: string; fill: string; extra: string } {
  const stroke = toneColor(s.tone, "var(--ui-ink-2)");
  let fill = "none";
  if (s.fill === true) fill = stroke;
  else if (s.fill === "soft") fill = `color-mix(in oklab, ${stroke} 16%, transparent)`;
  else if (s.fill !== undefined && s.fill !== false) fill = toneColor(s.fill, "none");
  const w = clampNum(num(s.width) ?? 2, 0, 16);
  const dash = s.dash === true ? "6 4" : num(s.dash) ? `${clampNum(num(s.dash)!, 1, 40)} ${clampNum(num(s.dash)!, 1, 40)}` : "";
  const op = num(s.opacity);
  return {
    stroke,
    fill,
    extra: `stroke-width:${w}${dash ? `;stroke-dasharray:${dash}` : ""}${op !== null ? `;opacity:${clampNum(op, 0, 1)}` : ""}`,
  };
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number, color: string): string {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (ang: number): string => `${f1(x2 - size * Math.cos(a + ang))},${f1(y2 - size * Math.sin(a + ang))}`;
  return `<polygon points="${f1(x2)},${f1(y2)} ${p(0.45)} ${p(-0.45)}" style="fill:${color};stroke:none"/>`;
}

function pointsOf(v: unknown, fc: FigCtx): Array<[number, number]> {
  return arr(v, 400).map((p) => (Array.isArray(p) ? [fig(p[0], fc.scope), fig(p[1], fc.scope)] as [number, number] : isObj(p) ? [fig(p.x, fc.scope), fig(p.y, fc.scope)] as [number, number] : null))
    .filter((p): p is [number, number] => p !== null && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

function shapeSvg(s: Json, fc: FigCtx, depth: number): string {
  if (fc.count >= MAX_SHAPES || depth > 4) return "";
  fc.count += 1;
  if (s.show !== undefined && !fig(s.show, fc.scope, 1)) return "";
  const kind = str(s.kind, 12);
  const g = (k: string, d = 0): number => fig(s[k], fc.scope, d);
  const { stroke, fill, extra } = paintOf(s);
  const style = `style="stroke:${stroke};fill:${fill};${extra}"`;
  switch (kind) {
    case "line":
    case "arrow": {
      const [x1, y1, x2, y2] = [g("x1"), g("y1"), g("x2"), g("y2")];
      const head = kind === "arrow" ? "end" : str(s.arrow, 6);
      const size = 5 + clampNum(num(s.width) ?? 2, 0, 16) * 1.6;
      return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" style="stroke:${stroke};${extra}" stroke-linecap="round"/>` +
        (head === "end" || head === "both" ? arrowHead(x1, y1, x2, y2, size, stroke) : "") +
        (head === "start" || head === "both" ? arrowHead(x2, y2, x1, y1, size, stroke) : "");
    }
    case "rect":
      return `<rect x="${f1(g("x"))}" y="${f1(g("y"))}" width="${f1(Math.max(0, g("w")))}" height="${f1(Math.max(0, g("h")))}" rx="${f1(Math.max(0, g("r")))}" ${style}/>`;
    case "circle":
      return `<circle cx="${f1(g("cx"))}" cy="${f1(g("cy"))}" r="${f1(Math.max(0, g("r", 4)))}" ${style}/>`;
    case "ellipse":
      return `<ellipse cx="${f1(g("cx"))}" cy="${f1(g("cy"))}" rx="${f1(Math.max(0, g("rx", 4)))}" ry="${f1(Math.max(0, g("ry", 4)))}" ${style}/>`;
    case "polygon":
    case "polyline": {
      const pts = pointsOf(s.points, fc);
      if (pts.length < 2) return "";
      return `<${kind} points="${pts.map(([x, y]) => `${f1(x)},${f1(y)}`).join(" ")}" ${style} stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    case "plot": {
      // y = fn(x)，x 从 from 到 to 均匀取样；坐标就是图内坐标（模型自己做比例换算）
      const fn = str(s.fn, 400);
      const from = g("from");
      const to = g("to", 100);
      const n = clampNum(Math.round(num(s.samples) ?? 80), 2, 400);
      const vars = { ...(fc.scope?.vars ?? {}) };
      const pts: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const x = from + ((to - from) * i) / (n - 1);
        vars.x = x;
        const y = evaluateFormula(fn, vars);
        if (y !== null) pts.push(`${f1(x)},${f1(y)}`);
      }
      return pts.length > 1 ? `<polyline points="${pts.join(" ")}" style="stroke:${stroke};fill:none;${extra}" stroke-linejoin="round" stroke-linecap="round"/>` : "";
    }
    case "arc": {
      const cx = g("cx"); const cy = g("cy"); const r = Math.max(0, g("r", 20));
      const a0 = (g("start") * Math.PI) / 180;
      const a1 = (g("end", 90) * Math.PI) / 180;
      const sweep = a1 >= a0 ? 1 : 0;
      const large = Math.abs(a1 - a0) % (2 * Math.PI) > Math.PI ? 1 : 0;
      const pt = (a: number): string => `${f1(cx + r * Math.cos(a))} ${f1(cy + r * Math.sin(a))}`;
      return `<path d="M${pt(a0)}A${f1(r)} ${f1(r)} 0 ${large} ${sweep} ${pt(a1)}" style="stroke:${stroke};fill:none;${extra}" stroke-linecap="round"/>`;
    }
    case "path": {
      const d = str(s.d, 4000);
      return PATH_RE.test(d) ? `<path d="${d}" ${style} stroke-linejoin="round" stroke-linecap="round"/>` : "";
    }
    case "text": {
      const text = str(s.text, 120);
      if (!text) return "";
      const size = clampNum(num(s.size) ?? 12, 6, 48);
      const anchor = ["start", "middle", "end"].includes(str(s.anchor)) ? str(s.anchor) : "middle";
      const color = toneColor(s.tone, "var(--ui-ink-2)");
      return `<text x="${f1(g("x"))}" y="${f1(g("y"))}" text-anchor="${anchor}" dominant-baseline="middle" style="fill:${color};font-size:${size}px${s.bold === true ? ";font-weight:600" : ""}">${esc(text)}</text>`;
    }
    case "group": {
      const kids = arr(s.shapes, MAX_SHAPES).filter(isObj).map((c) => shapeSvg(c, fc, depth + 1)).join("");
      const rot = g("rotate");
      const tf = `translate(${f1(g("dx"))} ${f1(g("dy"))})${rot ? ` rotate(${f1(rot)} ${f1(g("cx"))} ${f1(g("cy"))})` : ""}`;
      return `<g transform="${tf}">${kids}</g>`;
    }
    default:
      return "";
  }
}

export function renderFigure(spec: Json, ctx: RichUiRenderContext, scope: UiScope | null): string | null {
  const W = clampNum(num(spec.width) ?? 400, 40, 2000);
  const H = clampNum(num(spec.height) ?? 240, 30, 2000);
  // 单独使用时也能写 "=公式"：vars 是常量表
  let sc = scope;
  if (!sc && isObj(spec.vars)) {
    const vars: Record<string, number> = {};
    for (const [k, v] of Object.entries(spec.vars).slice(0, 40)) { const n = num(v); if (VAR_RE.test(k) && n !== null) vars[k] = n; }
    sc = { vars };
  }
  const fc: FigCtx = { scope: sc, count: 0 };
  const shapes = arr(spec.shapes, MAX_SHAPES).filter(isObj).map((s) => shapeSvg(s, fc, 0)).join("");
  if (!shapes) return null;
  let grid = "";
  const step = num(spec.grid) ?? (spec.grid === true ? 20 : 0);
  if (step >= 5) {
    const lines: string[] = [];
    for (let x = step; x < W && lines.length < 200; x += step) lines.push(`M${f1(x)} 0V${H}`);
    for (let y = step; y < H && lines.length < 400; y += step) lines.push(`M0 ${f1(y)}H${W}`);
    grid = `<path class="ui-fig-grid" d="${lines.join("")}"/>`;
  }
  const legend = arr(spec.legend, 8).filter(isObj).map((l) =>
    `<span class="ui-fig-key"><span class="ui-swatch" style="background:${toneColor(l.tone, "var(--ui-ink-3)")}"></span>${ctx.inline(str(l.label, 40))}</span>`).join("");
  const maxH = clampNum(num(spec.maxHeight) ?? 340, 80, 1200);
  return `<div class="ui-figure-wrap"><svg class="ui-svg ui-figure-svg" viewBox="0 0 ${W} ${H}" style="max-height:${maxH}px" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${attr(str(spec.title, 120) || str(spec.alt, 120) || "示意图")}">${grid}${shapes}</svg>` +
    (legend ? `<div class="ui-fig-legend">${legend}</div>` : "") + `</div>`;
}

// ── app ─────────────────────────────────────────────────────────────────────

export interface AppControl {
  id: string;
  kind: "slider" | "segmented" | "toggle" | "select";
  label: string;
  min: number; max: number; step: number; unit: string;
  options: Array<{ label: string; value: number }>;
  value: number;
  placement: "header" | "panel";
}

export function appControls(spec: Json): AppControl[] {
  const out: AppControl[] = [];
  for (const c of arr(spec.controls ?? spec.inputs, 10)) {
    if (!isObj(c)) continue;
    const id = str(c.id, 31);
    if (!VAR_RE.test(id) || out.some((o) => o.id === id)) continue;
    const kind = (["slider", "segmented", "toggle", "select"].includes(str(c.kind)) ? str(c.kind) : Array.isArray(c.options) ? "segmented" : "slider") as AppControl["kind"];
    const options = arr(c.options, 8).map((o, i) => {
      if (typeof o === "string") return { label: o.slice(0, 40), value: i };
      if (!isObj(o)) return null;
      return { label: str(o.label, 40) || String(i + 1), value: num(o.value) ?? i };
    }).filter((o): o is { label: string; value: number } => o !== null);
    if ((kind === "segmented" || kind === "select") && options.length < 2) continue;
    const min = num(c.min) ?? 0;
    const max = num(c.max) ?? 100;
    if (kind === "slider" && !(max > min)) continue;
    const step = num(c.step) ?? (max - min > 20 ? 1 : 0.1);
    let value = num(c.value) ?? (kind === "slider" ? min : kind === "toggle" ? (c.value === true ? 1 : 0) : options[0].value);
    if (c.value === true) value = 1;
    if (kind === "slider") value = clampNum(value, min, max);
    if ((kind === "segmented" || kind === "select") && !options.some((o) => o.value === value)) value = options[0].value;
    out.push({
      id, kind, label: str(c.label, 60) || id, min, max, step: step > 0 ? step : 1, unit: str(c.unit, 10), options, value: kind === "toggle" ? (value ? 1 : 0) : value,
      placement: str(c.placement) === "header" || (kind === "segmented" && str(c.placement) !== "panel") ? "header" : "panel",
    });
  }
  return out;
}

/** 控件值 + derive 公式 → 作用域。derive 按书写顺序求值，后面的可以引用前面的。 */
export function appScope(spec: Json, controls: AppControl[], values: Record<string, number> = {}): UiScope {
  const vars: Record<string, number> = {};
  const labels: Record<string, string> = {};
  if (isObj(spec.state)) {
    for (const [k, v] of Object.entries(spec.state).slice(0, 30)) { const n = num(v); if (VAR_RE.test(k) && n !== null) vars[k] = n; }
  }
  for (const c of controls) {
    const v = Number.isFinite(values[c.id]) ? values[c.id] : c.value;
    vars[c.id] = v;
    const opt = c.options.find((o) => o.value === v);
    if (opt) labels[c.id] = opt.label;
    if (c.kind === "toggle") labels[c.id] = v ? "开" : "关";
  }
  const derive = isObj(spec.derive)
    ? Object.entries(spec.derive)
    : arr(spec.derive, 40).filter(isObj).map((d) => [str(d.id, 31), d.formula] as [string, unknown]);
  for (const [k, f] of derive.slice(0, 40)) {
    if (!VAR_RE.test(k) || typeof f !== "string") continue;
    vars[k] = evaluateFormula(f, vars) ?? Number.NaN;
  }
  return { vars, labels };
}

const PANEL_BODY_TYPES = new Set(["figure", "meters", "stats", "chart", "text", "steps", "flow", "compare", "cards", "diagram"]);

export type BodyRenderer = (spec: Json, scope: UiScope | null) => string | null;

export interface AppPanelView { body: string; aside: string; title: string }

/** 每个面板在当前作用域下的 HTML（初次渲染与滑块拖动后的重算共用这一份）。 */
export function renderAppPanels(spec: Json, scope: UiScope, ctx: RichUiRenderContext, renderBody: BodyRenderer): AppPanelView[] {
  return arr(spec.panels, 12).filter(isObj).map((p) => {
    const bodySpec = isObj(p.body) ? p.body : str(p.text) ? { type: "text", text: p.text } : null;
    let body = "";
    if (bodySpec && PANEL_BODY_TYPES.has(str(bodySpec.type, 20))) {
      const bound = bindSpec(bodySpec, scope) as Json;
      body = (str(bound.type) === "text" ? `<div class="md-content ui-panel-text">${ctx.block(str(bound.text, 6000))}</div>` : renderBody(bound, scope)) ?? "";
    }
    return {
      title: str(bindSpec(str(p.title, 80), scope), 80),
      aside: str(bindSpec(str(p.aside, 80), scope), 80),
      body: body || `<div class="ui-panel-empty">—</div>`,
    };
  });
}

function controlHtml(c: AppControl, key: string): string {
  const name = `ui-${key}-${c.id}`;
  if (c.kind === "segmented") {
    return `<div class="ui-seg" role="radiogroup" aria-label="${attr(c.label)}" data-ui-ctl="${attr(c.id)}" data-ui-ctl-kind="segmented">${c.options.map((o) =>
      `<button type="button" class="ui-seg-btn" role="radio" aria-checked="${o.value === c.value}" data-ui-seg="${o.value}">${esc(o.label)}</button>`).join("")}</div>`;
  }
  if (c.kind === "select") {
    return `<label class="ui-ctl"><span class="ui-ctl-label">${esc(c.label)}</span><select class="ui-input ui-select" data-ui-ctl="${attr(c.id)}" data-ui-ctl-kind="select" name="${attr(name)}">${c.options.map((o) =>
      `<option value="${o.value}"${o.value === c.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
  }
  if (c.kind === "toggle") {
    return `<label class="ui-ctl ui-switch-row"><span class="ui-ctl-label">${esc(c.label)}</span><input class="ui-switch" type="checkbox" role="switch" data-ui-ctl="${attr(c.id)}" data-ui-ctl-kind="toggle"${c.value ? " checked" : ""}></label>`;
  }
  const dec = decimalsOf(c.step);
  return `<label class="ui-ctl"><span class="ui-ctl-label">${esc(c.label)}<output class="ui-calc-current" data-ui-ctl-out="${attr(c.id)}">${esc(formatNumber(c.value, c.unit, dec))}</output></span>` +
    `<input class="ui-range" type="range" data-ui-ctl="${attr(c.id)}" data-ui-ctl-kind="slider" data-ui-unit="${attr(c.unit)}" data-ui-dec="${dec}" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}" aria-label="${attr(c.label)}"></label>`;
}

export function renderApp(spec: Json, raw: string, ctx: RichUiRenderContext, key: string, renderBody: BodyRenderer): string | null {
  const controls = appControls(spec);
  const panelsSpec = arr(spec.panels, 12).filter(isObj);
  if (!panelsSpec.length) return null;
  const scope = appScope(spec, controls);
  const views = renderAppPanels(spec, scope, ctx, renderBody);
  const cols = clampNum(Math.round(num(spec.columns) ?? (views.length > 1 ? 2 : 1)), 1, 4);
  const header = controls.filter((c) => c.placement === "header");
  const panelCtls = controls.filter((c) => c.placement === "panel");
  const subtitle = str(spec.subtitle, 200);
  const bar = subtitle || header.length
    ? `<div class="ui-app-bar"><div class="ui-app-sub">${subtitle ? ctx.inline(subtitle) : ""}</div>${header.length ? `<div class="ui-app-header-ctls">${header.map((c) => controlHtml(c, key)).join("")}</div>` : ""}</div>`
    : "";
  const panels = views.map((v, i) => {
    const span = clampNum(Math.round(num(panelsSpec[i].span) ?? 1), 1, cols);
    return `<section class="ui-panel" data-ui-panel-idx="${i}"${span > 1 ? ` style="grid-column:span ${span}"` : ""}>` +
      (v.title || v.aside ? `<div class="ui-panel-head"><span class="ui-panel-title" data-ui-panel-title>${esc(v.title)}</span><span class="ui-panel-aside" data-ui-panel-aside>${esc(v.aside)}</span></div>` : "") +
      `<div class="ui-panel-body" data-ui-panel-body>${v.body}</div></section>`;
  }).join("");
  const ctlPanel = panelCtls.length
    ? `<section class="ui-panel ui-app-controls"${str(spec.controlsTitle) ? "" : ` aria-label="参数"`}>${str(spec.controlsTitle) ? `<div class="ui-panel-head"><span class="ui-panel-title">${esc(str(spec.controlsTitle, 40))}</span></div>` : ""}<div class="ui-app-ctl-grid">${panelCtls.map((c) => controlHtml(c, key)).join("")}</div></section>`
    : "";
  const actions = renderActions(spec.actions, ctx);
  return `<div class="ui-app-root" data-ui-app data-ui-spec="${attr(raw)}">${bar}` +
    `<div class="ui-app-grid" style="--ui-cols:${cols}">${panels}</div>${ctlPanel}` +
    (actions ? `<div class="ui-app-actions">${actions}</div>` : "") + `</div>`;
}
