// Turns the simplified authoring markup of docs pages into OpenAI Developers markup.
// Authoring syntax is documented at the top of api/_src/build.mjs.
import { esc, parseAttrs, stripTags } from "./util.mjs";
import { highlight, canonicalLang, LANG_LABEL } from "./highlight.mjs";
import { ICON } from "./icons.mjs";

const HEADING_ANCHOR_CLS =
  "shrink-0 self-center inline-flex items-center justify-center rounded-md p-0.5 opacity-0 transition-colors transition-opacity duration-200 ease-out text-info hover:text-info focus-visible:opacity-100 group-focus-within:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-300 group-hover:opacity-100 dark:focus-visible:outline-gray-600 motion-reduce:transition-none relative -top-0.5";

const CALLOUT_COLOR = { info: "primary", note: "primary", tip: "success", success: "success", warning: "warning", danger: "danger", error: "danger" };

function langLabel(lang, label) {
  if (label) return label;
  const l = String(lang || "").toLowerCase();
  return LANG_LABEL[l] || (l ? l.toUpperCase() : "代码");
}

function renderPane(p, hidden) {
  const { html } = highlight(p.raw, p.lang);
  return (
    `<div class="code-block${hidden ? " hidden" : ""}" data-code-pane="${esc(p.key)}" data-label="${esc(p.label)}">` +
    `<pre class="shiki shiki-themes syntax-highlighter _pre_1czwd_62" data-copy-ignore="true" tabindex="0">` +
    `<code data-language="${esc(canonicalLang(p.lang))}" data-wrap-long-lines="false">${html}</code></pre></div>`
  );
}

export function renderCodeSample(panes, title) {
  const head = title || (panes.length === 1 ? panes[0].label : "");
  const select =
    panes.length > 1
      ? `<div class="exclude-from-copy api-code-lang"><span class="_SelectControl_x887o_1" data-variant="ghost" data-size="sm" data-selected="true" aria-hidden="true">` +
        `<span class="_TriggerText_x887o_510"><span data-code-lang-label>${esc(panes[0].label)}</span></span>` +
        `<div class="_IndicatorWrapper_x887o_520">${ICON.selectChevrons()}</div></span>` +
        `<select data-code-lang-select aria-label="选择代码语言">${panes
          .map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`)
          .join("")}</select></div>`
      : "";
  return (
    `<div class="code-sample not-prose _root_1czwd_2" data-code-sample>` +
    `<div class="_header_1czwd_34"><div class="_title_1czwd_42 body-small">${esc(head)}</div>${select}` +
    `<button type="button" class="_Button_6dmow_1 _copyButton_1czwd_168" data-color="primary" data-variant="ghost" data-size="sm" data-gutter-size="xs" data-icon-size="sm" aria-label="复制代码" data-copy-code>` +
    `<span class="_ButtonInner_6dmow_4"><span class="api-copy-icon" data-copy-icon="copy">${ICON.copy()}</span><span class="api-copy-icon" data-copy-icon="check" hidden>${ICON.check()}</span></span></button>` +
    `<span aria-live="polite" class="sr-only" data-copy-status></span></div>` +
    `<div class="_body_1czwd_59 _bodySmall_1czwd_151 _bodyWithHeader_1czwd_139">${panes
      .map((p, i) => renderPane(p, i > 0))
      .join("")}</div></div>`
  );
}

export function renderCallout(type, inner) {
  const color = CALLOUT_COLOR[type] || "primary";
  const icon = color === "warning" || color === "danger" ? ICON.warning() : ICON.info();
  return (
    `<div class="_Notice_d6ijw_1"><div class="_Alert_1bpiz_1" data-variant="outline" data-color="${color}" data-actions-placement="end">` +
    `<div class="_Indicator_1bpiz_159">${icon}</div><div class="_Content_1bpiz_147"><div class="_Message_1bpiz_166"><div class="_Description_1bpiz_176">` +
    `${inner.trim()}</div></div></div></div></div>`
  );
}

export function renderCard(attrs, desc) {
  const href = attrs.href || "#";
  const external = /^https?:\/\//.test(href);
  const icon = attrs.icon === "cube" ? ICON.cube() : ICON.bolt();
  return (
    `<a href="${esc(href)}" class="_TextLink_ssta1_1" data-underline="always"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>` +
    `<div class="icon-item mt-2"><div class="icon-item-icon"><span>${icon}</span></div><div class="icon-item-right">` +
    `<div class="icon-item-title not-prose"><div class="icon-item-title body-large not-prose">${esc(attrs.title || "")}</div><div class="pointer">${ICON.pointer()}</div></div>` +
    `<div class="icon-item-desc body-small not-prose"><p>${desc.trim()}</p></div></div></div></a>`
  );
}

export function renderHeading(level, id, innerHtml) {
  const text = stripTags(innerHtml);
  const gap = level === 2 ? "gap-2" : "gap-1";
  const iconCls = level === 2 ? "h-4 w-4" : level === 3 ? "h-3.5 w-3.5" : "h-2.5 w-2.5";
  return (
    `<h${level} id="${esc(id)}" class="group flex items-center ${gap} mt-7 mb-2 scroll-mt-[110px]"><span class="min-w-0">${innerHtml.trim()}</span>` +
    `<button type="button" class="${HEADING_ANCHOR_CLS}" data-anchor-id="${esc(id)}" aria-label="复制「${esc(text)}」的链接" title="复制链接">${ICON.link(iconCls)}</button></h${level}>`
  );
}

/**
 * @returns {{ html: string, toc: {id:string,text:string,level:number}[], text: string, warnings: string[] }}
 */
export function transformContent(src, file) {
  const warnings = [];
  const code = [];
  let html = String(src);

  // 1) raw code blocks first, so nothing below ever touches their contents
  html = html.replace(/<pre\b([^>]*\bdata-lang\b[^>]*)>([\s\S]*?)<\/pre>/g, (_, attrSrc, raw) => {
    const a = parseAttrs(attrSrc);
    const lang = a["data-lang"] || "text";
    const label = langLabel(lang, a["data-label"]);
    code.push({ lang, label, title: a["data-title"] || "", raw, key: (a["data-label"] || lang).toLowerCase() });
    return `\u0000CODE${code.length - 1}\u0000`;
  });

  // 2) <code-tabs title="…"> groups
  html = html.replace(/<code-tabs\b([^>]*)>([\s\S]*?)<\/code-tabs>/g, (_, attrSrc, inner) => {
    const a = parseAttrs(attrSrc);
    const ids = [...inner.matchAll(/\u0000CODE(\d+)\u0000/g)].map((m) => Number(m[1]));
    if (!ids.length) warnings.push(`${file}: <code-tabs> without <pre data-lang> children`);
    return renderCodeSample(ids.map((i) => code[i]), a.title || "");
  });

  // 3) single code blocks
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => renderCodeSample([code[Number(i)]], code[Number(i)].title));

  // 4) callouts / cards / tables
  html = html.replace(/<callout\b([^>]*)>([\s\S]*?)<\/callout>/g, (_, attrSrc, inner) => {
    const a = parseAttrs(attrSrc);
    const body = /^\s*</.test(inner) ? inner : `<p>${inner.trim()}</p>`;
    return renderCallout(a.type || "info", body);
  });
  html = html.replace(/<cards\b[^>]*>([\s\S]*?)<\/cards>/g, (_, inner) =>
    `<div class="api-cards not-prose">${inner.replace(/<card\b([^>]*)>([\s\S]*?)<\/card>/g, (__, attrSrc, desc) =>
      renderCard(parseAttrs(attrSrc), desc),
    )}</div>`,
  );
  html = html.replace(/(<div class="table-wrapper[^"]*">\s*)?<table\b([^>]*)>([\s\S]*?)<\/table>/g, (whole, wrapped, attrSrc, inner) =>
    wrapped ? whole : `<div class="table-wrapper md:max-w-5xl mx-auto overflow-x-auto"><table class="w-full"${attrSrc}>${inner}</table></div>`,
  );

  // 5) headings + toc
  const toc = [];
  const seen = new Set();
  let auto = 0;
  html = html.replace(/<h([234])\b([^>]*)>([\s\S]*?)<\/h\1>/g, (_, lvl, attrSrc, inner) => {
    const a = parseAttrs(attrSrc);
    let id = a.id;
    if (!id) {
      id = `section-${++auto}`;
      warnings.push(`${file}: <h${lvl}> "${stripTags(inner).slice(0, 30)}" has no id (generated ${id})`);
    }
    if (seen.has(id)) warnings.push(`${file}: duplicate heading id "${id}"`);
    seen.add(id);
    const level = Number(lvl);
    if (level === 2) toc.push({ id, text: stripTags(inner), level });
    return renderHeading(level, id, inner);
  });

  if (/\u0000/.test(html)) warnings.push(`${file}: unresolved code placeholder`);
  const text = stripTags(html.replace(/<pre[\s\S]*?<\/pre>/g, " ").replace(/<button[\s\S]*?<\/button>/g, " "));
  return { html, toc, text, warnings };
}
