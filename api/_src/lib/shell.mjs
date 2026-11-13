// Page chrome copied from OpenAI Developers (header, subnav, sidebar, drawer, search overlay),
// with our logo, Chinese labels and links. Class strings are verbatim so the vendored CSS applies.
import { esc, normUrl } from "./util.mjs";
import { ICON } from "./icons.mjs";
import { SITE, TOP_NAV, TABS } from "../nav.mjs";

export const ASSET_VERSION = "20261113a";
const v = (url) => `${url}?v=${ASSET_VERSION}`;

const NAV_CHEVRON =
  '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5 shrink-0" aria-hidden="true"><path fill-rule="evenodd" d="M4.293 8.293a1 1 0 0 1 1.414 0L12 14.586l6.293-6.293a1 1 0 1 1 1.414 1.414l-7 7a1 1 0 0 1-1.414 0l-7-7a1 1 0 0 1 0-1.414Z" clip-rule="evenodd"></path></svg>';

const extAttrs = (href) => (/^https?:\/\//.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "");

// ── <head> ─────────────────────────────────────────────────────────────
export function renderHead(page) {
  const title = page.fullTitle || (page.url === "/api/" ? `${SITE.name}` : `${page.title} | ${SITE.name}`);
  const desc = page.description || "NexusVAI API：一个端点、一把密钥，接入前沿模型，兼容 OpenAI 与 Anthropic 协议。";
  const canonical = SITE.origin + page.url;
  const css = [
    "/api/assets/oai/header.css",
    "/api/assets/oai/inline.css",
    ...(page.css || []),
    "/fonts/gf/newsreader-notosanssc.css",
    "/api/assets/fonts.css",
    "/chat/api/oai-community.css",
    "/api/assets/api.css",
  ];
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' https:; connect-src 'self' https://chat.nexusvai.xyz https://cn.nexusvai.xyz; frame-src https://player.vimeo.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self';" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(SITE.name)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${SITE.origin}/Logo/nexusvai-og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="/favicon.ico" sizes="48x48" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<script src="${v("/api/assets/theme.js")}"></script>
${page.layout === "reference" ? "<style>@layer theme, base, api-reference, components, utilities;</style>\n" : "<style>@layer theme, base, components, utilities;</style>\n"}${css.map((href) => `<link rel="stylesheet" href="${v(href)}" />`).join("\n")}
</head>`;
}

// ── Header ─────────────────────────────────────────────────────────────
function topLink(item, active) {
  const cls = active
    ? "flex items-center gap-1 text-sm py-1 px-2.5 rounded-md text-default bg-primary-soft"
    : "flex items-center gap-1 text-sm py-1 px-2.5 rounded-md text-primary-soft hover:text-default hover:bg-primary-soft-alpha";
  if (!item.menu) {
    return `<div class="group relative shrink-0"><a href="${esc(item.href)}" class="${cls}"${active ? ' aria-current="page"' : ""}>${esc(item.label)}</a></div>`;
  }
  const items = item.menu
    .map(
      (m) =>
        `<a role="menuitem" href="${esc(m.href)}"${extAttrs(m.href)}${m.community ? " data-community-open" : ""} class="block px-4 py-3 text-sm text-default transition-colors hover:bg-primary-soft-alpha dark:hover:bg-alpha-10 hover:text-default">` +
        `<div class="flex flex-col gap-1"><div class="flex items-center gap-1.5 font-medium">${esc(m.title)}</div><div class="text-sm text-secondary">${esc(m.desc)}</div></div></a>`,
    )
    .join("");
  return (
    `<div class="group relative shrink-0"><a href="${esc(item.href)}" class="${cls}" aria-haspopup="menu">${esc(item.label)}${NAV_CHEVRON}</a>` +
    `<div class="invisible opacity-0 absolute left-0 top-full z-50 mt-2 min-w-full w-max transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-has-focus-visible:visible group-has-focus-visible:opacity-100 before:content-[''] before:absolute before:-top-2 before:left-0 before:right-0 before:h-2" role="menu">` +
    `<div class="overflow-hidden rounded-md border border-primary-surface bg-surface shadow-md ring-1 ring-black/5 dark:ring-white/10"><div>${items}</div></div></div></div>`
  );
}

function themePicker(prefix, extraCls) {
  const opt = (value, label) =>
    `<label class="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-lg px-3 text-sm text-default hover:bg-primary-soft-alpha has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:outline-primary-surface">${label}` +
    `<input type="radio" name="${prefix}-preference" value="${value}" data-theme-preference class="h-4 w-4 appearance-auto accent-current" /></label>`;
  return (
    `<details data-theme-picker name="theme-picker" class="relative shrink-0${extraCls ? ` ${extraCls}` : ""}">` +
    `<summary id="${prefix}" role="button" aria-label="选择主题" title="选择主题" aria-controls="${prefix}-choices" class="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-secondary transition-colors hover:bg-primary-soft-alpha hover:text-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-surface [&amp;::-webkit-details-marker]:hidden">` +
    `${ICON.sun()}${ICON.moon()}</summary>` +
    `<fieldset id="${prefix}-choices" class="absolute right-0 top-full z-50 mt-2 min-w-44 rounded-xl border border-primary-surface bg-surface p-1 shadow-lg"><legend class="sr-only">主题</legend>` +
    `${opt("light", "浅色")}${opt("dark", "深色")}${opt("system", "跟随系统")}</fieldset></details>`
  );
}

function consoleButton(cls, labelCls = "sr-only min-[1000px]:not-sr-only") {
  return (
    `<a href="${SITE.consoleUrl}" class="_Button_6dmow_1 not-prose ${cls}" data-color="primary" data-variant="solid" data-pill="" data-size="md">` +
    `<span class="_ButtonInner_6dmow_4"><span class="${labelCls}">控制台</span>${ICON.external()}</span></a>`
  );
}

export function renderHeader(page) {
  const activeTop = page.layout === "home" || page.url === "/api/" ? "home" : page.topNav || "api";
  return (
    `<header id="header" class="fixed top-0 w-full h-16 z-50 bg-white dark:bg-black border-b border-primary-surface">` +
    `<div class="flex h-full items-center px-4 md:px-8 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-6">` +
    `<a href="/api/" class="api-logo order-1 ml-0 flex min-h-11 min-w-11 items-center justify-center font-semibold lg:col-start-1 lg:row-start-1 lg:-ml-2 lg:justify-self-start">` +
    `<img src="${SITE.logo}" alt="NexusVAI Developers" class="h-6 w-auto" height="24" /></a>` +
    `<div class="order-2 ml-auto flex shrink-0 items-center gap-4 md:gap-3 lg:col-start-3 lg:row-start-1 lg:ml-0 lg:justify-end lg:justify-self-end lg:gap-5">` +
    `<button type="button" data-header-search-button aria-controls="header-search-overlay" aria-expanded="false" class="order-1 hidden min-w-52 items-center justify-between gap-3 rounded-full border border-primary-surface bg-surface px-4 py-2 text-sm text-secondary transition-colors hover:bg-primary-soft-alpha hover:text-default 2xl:flex"><span class="truncate">开始搜索</span>${ICON.search()}</button>` +
    `<div class="order-2 hidden lg:flex"><div class="flex items-center gap-2">${consoleButton("!h-9 !w-9 justify-center !px-0 min-[1000px]:!w-auto min-[1000px]:!px-4")}</div></div>` +
    themePicker("header-theme-button", "order-4 hidden lg:block") +
    `<button type="button" data-header-search-button aria-label="搜索文档" aria-controls="header-search-overlay" aria-expanded="false" class="order-5 inline-flex h-11 w-11 items-center justify-center rounded-full text-secondary transition-colors hover:bg-primary-soft-alpha hover:text-default md:inline-flex 2xl:hidden">${ICON.search("w-4 h-4 text-secondary hover:text-default transition-colors")}</button>` +
    `<button id="header-drawer-button" type="button" aria-label="打开菜单" aria-controls="drawer" aria-expanded="false" class="order-6 relative right-1 inline-flex h-11 w-11 items-center justify-center rounded-full text-secondary transition-colors hover:bg-primary-soft-alpha hover:text-default md:right-0 lg:hidden">${ICON.menu()}</button>` +
    `</div>` +
    `<nav class="order-3 hidden min-w-0 items-center justify-center gap-1 lg:col-start-2 lg:row-start-1 lg:flex" aria-label="主导航">${TOP_NAV.map((item) =>
      topLink(item, item.id === activeTop),
    ).join("")}</nav>` +
    `</div></header>`
  );
}

// ── Subnav (API tabs) ──────────────────────────────────────────────────
export function renderSubnav(page) {
  const tabs = TABS.map((t) => {
    const on = t.id === page.tab;
    const cls =
      "group relative flex shrink-0 items-center text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary-surface " +
      (on ? "text-default" : "text-secondary hover:text-default");
    return (
      `<a href="${esc(t.href)}"${on ? ' aria-current="true"' : ""} class="${cls}"><span class="flex items-center gap-1.5 px-2.5 py-1">${esc(t.label)}</span>` +
      `<span data-context-indicator${on ? "" : ' hidden=""'} class="absolute inset-x-2.5 bottom-0 h-0.5 rounded-t bg-primary-solid" aria-hidden="true"></span></a>`
    );
  }).join("");
  return (
    `<div class="fixed inset-x-0 top-16 z-40 hidden h-12 border-b border-primary-surface bg-gray-75 dark:bg-black lg:block" data-context-subnav="">` +
    `<nav aria-label="API 分区" class="flex h-full items-stretch gap-1 overflow-x-auto px-6 whitespace-nowrap lg:justify-center lg:px-8">${tabs}</nav></div>`
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────
const LINK_BASE = "px-3 py-1.5 w-full rounded-[8px] transition-colors text-default";
const METHOD_COLOR = { GET: "success", POST: "info", PUT: "warning", PATCH: "warning", DELETE: "danger", WS: "discovery" };

function methodBadge(method) {
  if (!method) return "";
  return `<span class="api-method-badge" data-method="${esc(method)}" data-color="${METHOD_COLOR[method] || "secondary"}">${esc(method === "DELETE" ? "DEL" : method)}</span>`;
}

function isActive(item, page) {
  return item.href && normUrl(item.href) === normUrl(page.navUrl || page.url);
}

function containsActive(item, page) {
  return isActive(item, page) || (item.items || []).some((c) => containsActive(c, page));
}

function sidebarItem(item, page, nested) {
  const on = isActive(item, page);
  if (item.items && item.items.length) {
    const open = containsActive(item, page);
    const sumCls = `list-none [&amp;::-webkit-details-marker]:hidden cursor-pointer select-none ${LINK_BASE}${nested ? " pl-5" : ""} flex items-center justify-between ${on ? "bg-primary-ghost-hover" : "hover:text-default hover:bg-primary-ghost-hover"}`;
    return (
      `<li><details class="nav-disclosure [&amp;[open]&gt;summary&gt;.nav-disclosure-chevron]:[transform:rotate(90deg)]"${open ? " open" : ""}>` +
      `<summary class="${sumCls}"><a href="${esc(item.href)}" class="no-underline hover:no-underline flex-1 min-w-0"${on ? ' aria-current="page"' : ""}><span class="line-clamp-2">${esc(item.title)}</span></a>${ICON.chevronRight()}</summary>` +
      `<ul class="m-0 list-none p-0 mt-1 ml-3 max-w-[calc(100%-theme(spacing.3))] flex flex-col gap-0.5 text-sm text-default w-full mb-2">${item.items
        .map((c) => sidebarItem(c, page, false))
        .join("")}</ul></details></li>`
    );
  }
  const cls = `${LINK_BASE}${nested ? " pl-5" : ""} no-underline hover:no-underline block ${on ? "bg-primary-ghost-hover" : "hover:text-default hover:bg-primary-ghost-hover"}${item.method ? " api-has-method" : ""}`;
  return `<li><a href="${esc(item.href)}"${extAttrs(item.href)} class="${cls}"${on ? ' aria-current="page"' : ""}>${methodBadge(item.method)}<span class="line-clamp-2">${esc(item.title)}</span></a></li>`;
}

export function renderSidebar(page, tab) {
  const sections = (tab && tab.sidebar) || [];
  const body = sections
    .map((sec, i) => {
      const heading = sec.group ? `<h3 class="mb-2 ml-3 mt-6 text-sm font-semibold select-none">${esc(sec.group)}</h3>` : "";
      return (
        `<div${!sec.group && i === 0 ? ' class="mt-6"' : ""}>${heading}` +
        `<ul class="m-0 list-none p-0 flex flex-col gap-0.25 text-sm text-default w-full">${sec.items
          .map((it) => sidebarItem(it, page, Boolean(sec.group)))
          .join("")}</ul></div>`
      );
    })
    .join("");
  return (
    `<div class="hidden lg:flex lg:flex-col w-[218px] px-3 pb-6 pt-2 lg:fixed lg:bottom-0 lg:z-40 bg-surface dark:bg-black" style="top: var(--docs-header-offset)" data-left-nav-container="">` +
    `<nav class="flex-1 overflow-y-auto overflow-x-visible" data-left-nav="" data-left-nav-id="${esc(tab ? tab.id : "")}" aria-label="${esc(tab ? tab.label : "")}文档">${body}</nav></div>`
  );
}

// ── Mobile drawer ──────────────────────────────────────────────────────
function drawerLinks(sections, page) {
  return sections
    .map((sec) => {
      const flat = [];
      const walk = (items) =>
        items.forEach((it) => {
          flat.push(it);
          if (it.items) walk(it.items);
        });
      walk(sec.items);
      return (
        `<div class="flex flex-col gap-3">${sec.group ? `<h3 class="text-xs tracking-wide text-secondary">${esc(sec.group)}</h3>` : ""}` +
        `<ul class="flex flex-col gap-1 text-sm text-default w-full">${flat
          .map((it) => {
            const on = isActive(it, page);
            return `<li><a href="${esc(it.href)}" data-mobile-nav-link class="px-3 py-1.5 rounded-lg transition-colors block ${on ? "text-default bg-primary-ghost-active" : "hover:text-default hover:bg-primary-ghost-hover"}"${on ? ' aria-current="page"' : ""}>${esc(it.title)}</a></li>`;
          })
          .join("")}</ul></div>`
      );
    })
    .join("");
}

export function renderDrawer(page) {
  const pill =
    "min-h-11 shrink-0 scroll-mx-2 rounded-full border border-primary-surface px-3 py-1.5 text-xs text-secondary transition-colors duration-150 data-[selected=true]:bg-primary-soft data-[selected=true]:text-default hover:bg-primary-soft-alpha hover:text-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-surface sm:px-3.5 sm:text-sm";
  const currentTab = TABS.find((t) => t.id === page.tab) || TABS[0];
  const ctxBtn =
    "w-full rounded-lg px-3 py-2 text-left text-sm font-normal text-secondary transition-colors hover:bg-primary-ghost-hover hover:text-default data-[selected=true]:bg-primary-ghost-active data-[selected=true]:text-default";
  const variants = TABS.map(
    (t) =>
      `<div data-mobile-nav-variant-content data-variant-id="${t.id}"${t.id === currentTab.id ? "" : " hidden"} class="flex flex-col gap-6">${drawerLinks(t.sidebar, page)}</div>`,
  ).join("");
  const sectionLinks = TOP_NAV.map((item) => {
    const on = (page.layout === "home" ? "home" : "api") === item.id;
    return `<a href="${esc(item.href)}" role="tab" data-selected="${on}" aria-selected="${on}" class="${pill} inline-flex items-center">${esc(item.label)}</a>`;
  }).join("");
  return (
    `<div id="drawer" class="fixed inset-0 z-40 flex flex-col bg-surface transform translate-x-full transition-transform duration-300 lg:hidden" aria-label="移动端导航">` +
    `<div class="flex flex-col h-full w-full"><div class="px-6 pt-6 w-full mt-16"><div class="flex items-center gap-2">` +
    `<nav class="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto pb-2 -mx-1 px-1 sm:gap-2" role="tablist" aria-label="站点分区">${sectionLinks}</nav>` +
    `<div class="mb-2 flex shrink-0 items-center gap-1">${themePicker("drawer-theme-button", "")}</div></div></div>` +
    `<div class="flex-1 w-full overflow-y-auto px-6 py-4 flex flex-col gap-6" data-mobile-nav-panels="">` +
    `<button type="button" data-header-search-button aria-controls="header-search-overlay" aria-expanded="false" class="flex w-full items-center justify-between gap-3 rounded-full border border-primary-surface bg-surface px-4 py-2 text-sm text-secondary">开始搜索${ICON.search()}</button>` +
    `<div data-mobile-context-options class="flex flex-col gap-1">${TABS.map(
      (t) => `<button type="button" class="${ctxBtn}" data-mobile-context-option="${t.id}" data-selected="${t.id === currentTab.id}">${esc(t.label)}</button>`,
    ).join("")}</div>` +
    variants +
    `</div><div class="w-full px-6 py-6 border-t border-primary-surface" data-mobile-nav-footer=""><div class="flex flex-col gap-5"><div class="flex items-center gap-2 w-full gap-3">` +
    consoleButton("w-full justify-center", "") +
    `</div></div></div></div></div>`
  );
}

// ── Search overlay ─────────────────────────────────────────────────────
export function renderSearch() {
  const chips = ["快速开始", "API 密钥", "Claude Code", "速率限制", "错误码"]
    .map((q) => `<button type="button" class="_emptyChip_1wztd_81" data-search-query-button="true" data-search-query="${esc(q)}">${esc(q)}</button>`)
    .join("");
  return (
    `<div id="header-search-overlay" role="dialog" aria-modal="true" aria-labelledby="header-search-title" aria-hidden="true" data-open="false" class="fixed inset-0 z-[60] hidden items-start justify-center px-4 pt-20 pb-10 md:px-6 md:pt-24">` +
    `<div class="absolute inset-0 bg-black/35 backdrop-blur-xs transition-opacity dark:bg-black/70" data-header-search-dismiss=""></div>` +
    `<div class="relative z-10 w-full max-w-4xl overflow-hidden rounded-[28px] bg-surface shadow-[0_36px_120px_-48px_rgba(15,23,42,0.55)] ring-1 ring-black/10 dark:ring-white/10" data-header-search-panel="">` +
    `<div data-header-search-body="" class="p-0"><h2 id="header-search-title" class="sr-only">搜索文档</h2><div class="relative flex min-h-0 flex-1 flex-col">` +
    `<button type="button" data-header-search-close="" aria-label="关闭搜索" class="absolute right-5 top-7 z-20 inline-flex h-8 w-8 shrink-0 appearance-none items-center justify-center rounded-md border-0 bg-transparent p-0 leading-none text-tertiary shadow-none transition-colors hover:text-default focus-visible:outline-none focus-visible:ring-0 md:right-7">${ICON.close()}</button>` +
    `<div id="header-site-search" class="pagefind-header-ui pagefind-desktop-ui oai-site-search-overlay _root_1wztd_1"><div class="flex h-full min-h-0 flex-col gap-0">` +
    `<div class="shrink-0 border-b border-primary-surface px-4 py-4 md:px-6 md:py-5"><label class="sr-only" for="header-site-search-input">搜索文档</label>` +
    `<input id="header-site-search-input" type="text" placeholder="开始搜索" autocomplete="off" spellcheck="false" data-site-search-input="true" class="w-full outline-none transition-colors rounded-none border-0 bg-transparent py-0 pl-0 pr-14 text-[18px] leading-tight text-default placeholder:text-tertiary focus:ring-0 md:text-[18px]" value="" /></div>` +
    `<div class="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 md:px-6 md:py-5 api-search-scroll">` +
    `<div data-site-search-empty-state="true" class="flex flex-col gap-4"><section class="_emptySection_1wztd_68" data-site-search-suggestions="true"><h3 class="_emptyHeading_1wztd_74">推荐搜索</h3><div class="flex flex-wrap gap-2">${chips}</div></section></div>` +
    `<div data-site-search-results hidden class="flex flex-col gap-1"></div>` +
    `</div></div></div></div></div></div></div>`
  );
}

// ── Community button (replaces OpenAI's "Ask AI") ──────────────────────
export function renderCommunity() {
  return `<div data-community-mount data-asset-base="/chat/assets/community/"></div>`;
}

export function renderScripts(page) {
  const js = [...(page.jsBefore || []), "/chat/api/oai-community.js", "/api/assets/shell.js", ...(page.js || [])];
  return js.map((src) => `<script src="${/\?/.test(src) ? src : v(src)}" defer></script>`).join("\n");
}
