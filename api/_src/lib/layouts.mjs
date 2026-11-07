import { esc } from "./util.mjs";
import { ICON } from "./icons.mjs";
import { TABS } from "../nav.mjs";
import { renderHead, renderHeader, renderSubnav, renderSidebar, renderDrawer, renderSearch, renderCommunity, renderScripts } from "./shell.mjs";

const GENERATED = (src) =>
  `<!-- 由 api/_src/build.mjs 从 api/_src/pages/${src} 生成，勿直接修改：改源文件后运行 node api/_src/build.mjs -->`;

function copyPageButton() {
  const cid = ' data-astro-cid-zl22b5wc=""';
  return (
    `<button type="button" class="page-copy-action" data-page-copy-action=""${cid}>` +
    `<span class="page-copy-action__icon page-copy-action__icon--copy" aria-hidden="true"${cid}>${ICON.copy()}</span>` +
    `<span class="page-copy-action__icon page-copy-action__icon--check" aria-hidden="true"${cid}>${ICON.check()}</span>` +
    `<span data-page-copy-label=""${cid}>复制页面</span></button>`
  );
}

function tocRail(toc) {
  const items = toc
    .map(
      (h, i) =>
        `<li data-id="${esc(h.id)}" class="leading-5 ml-0"><a href="#${esc(h.id)}" class="block text-sm ${i === 0 ? "text-default" : "text-tertiary hover:text-secondary"} pl-2 transition-colors">${esc(h.text)}</a></li>`,
    )
    .join("");
  return (
    `<div data-content-page-toc-rail="" class="sticky z-30 hidden min-h-0 w-full self-start pb-6 xl:col-start-2 xl:row-start-1 xl:flex xl:flex-col" style="top: var(--docs-toc-offset); height: fit-content; max-height: calc(100vh - var(--docs-toc-offset))">` +
    (toc.length
      ? `<nav class="hidden xl:block w-full overflow-y-auto min-h-0 shrink overflow-y-auto pr-1" aria-label="本页目录" data-api-toc><div class="relative">` +
        `<div class="absolute left-0 top-0 bottom-0 w-[2.15px] bg-primary-soft"></div>` +
        `<div class="absolute left-0 w-[2.15px] bg-primary-solid transition-transform duration-200 ease-out" data-api-toc-indicator style="transform: translateY(0px); height: 20px"></div>` +
        `<ul class="relative list-none p-0 m-0 ml-3 [&amp;&gt;*+*]:mt-3">${items}</ul></div></nav>`
      : "") +
    `<div class="mt-4 shrink-0">${copyPageButton()}</div></div>`
  );
}

function prevNext(prev, next) {
  if (!prev && !next) return "";
  const link = (item, dir) =>
    item
      ? `<a href="${esc(item.href)}" class="group flex items-end gap-2 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-outline">` +
        (dir === "prev" ? ICON.arrowLeft() : "") +
        `<div class="flex flex-col${dir === "next" ? "" : " items-start"}"><div class="text-xs font-bold text-secondary">${dir === "next" ? "下一篇" : "上一篇"}</div>` +
        `<div class="text-sm text-default group-hover:underline underline-offset-4">${esc(item.title)}</div></div>` +
        (dir === "next" ? ICON.arrowRight() : "") +
        `</a>`
      : "<span></span>";
  return (
    `<div data-page-next-prev=""><div class="mx-4 sm:mx-8 md:mx-auto md:w-full md:max-w-6xl px-4 md:px-12 xl:px-4">` +
    `<div class="grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_200px]"><nav class="w-full mb-20 xl:mb-8 px-0" aria-label="上一篇与下一篇">` +
    `<div class="flex justify-between items-center">${link(prev, "prev")}${link(next, "next")}</div></nav><div class="hidden xl:block"></div></div></div></div>`
  );
}

function chrome(page, inner, { subnav }) {
  const tab = TABS.find((t) => t.id === page.tab);
  return (
    `${renderHead(page)}\n` +
    `<body class="overflow-x-hidden"${subnav ? ' data-has-context-subnav="true"' : ""} data-api-layout="${esc(page.layout)}"${tab ? ` data-api-tab="${tab.id}"` : ""}${page.bodyAttrs ? ` ${page.bodyAttrs}` : ""}>\n` +
    `${GENERATED(page.src)}\n` +
    `${renderHeader(page)}\n${subnav ? renderSubnav(page) + "\n" : ""}${renderSearch()}\n${renderDrawer(page)}\n` +
    `${inner}\n${renderCommunity()}\n${renderScripts(page)}\n</body>\n</html>\n`
  );
}

export function layoutHome(page) {
  return chrome(page, `<div data-docs-agent-page="" class="min-h-dvh"><div class="flex" style="padding-top: var(--docs-header-offset)"><main class="min-w-0 flex-1" id="main">${page.body}</main></div></div>`, { subnav: false });
}

export function layoutWide(page) {
  const tab = TABS.find((t) => t.id === page.tab);
  return chrome(
    page,
    `<div data-docs-agent-page="" class="min-h-dvh"><div class="flex" style="padding-top: var(--docs-header-offset)">${renderSidebar(page, tab)}` +
      `<main class="min-w-0 flex-1 lg:pl-[240px]" id="main">${page.body}</main></div></div>`,
    { subnav: true },
  );
}

export function layoutDocs(page) {
  const tab = TABS.find((t) => t.id === page.tab);
  const lead = page.description && page.lead !== false ? `<p class="text-lg text-secondary">${esc(page.description)}</p>` : "";
  const main =
    `<main class="min-w-0 flex-1 lg:pl-[240px]" id="main"><div class="page-container md:max-w-6xl pb-12 pt-0" data-content-page-container="">` +
    `<div class="mx-auto md:w-full grid grid-cols-1 gap-12 max-w-7xl xl:grid-cols-[minmax(0,1fr)_200px]">` +
    (page.toc === false ? "" : tocRail(page.tocItems)) +
    `<div class="relative flex flex-col xl:col-start-1 xl:row-start-1"><div class="flex flex-col gap-8 mb-2">` +
    `<header class="flex flex-col not-prose gap-1 pt-10 lg:pt-8 items-start text-left"><div class="flex w-full items-start justify-between gap-4">` +
    `<div class="flex min-w-0 flex-wrap items-center gap-3 flex-1"><h1 class="heading-xl md:heading-2xl min-w-0 max-w-full">${esc(page.title)}</h1></div>` +
    `<div class="shrink-0 pt-1 xl:hidden">${copyPageButton()}</div></div>${lead}</header></div>` +
    `<article id="mainContent" class="prose prose-content dark:prose-invert max-w-none pt-4 pb-0">${page.body}</article></div></div></div>` +
    prevNext(page.prev, page.next) +
    `</main>`;
  return chrome(
    page,
    `<div data-docs-agent-page="" class="min-h-dvh"><div class="flex" style="padding-top: var(--docs-header-offset)">${renderSidebar(page, tab)}${main}</div></div>`,
    { subnav: true },
  );
}

export const LAYOUTS = { home: layoutHome, docs: layoutDocs, wide: layoutWide, reference: layoutDocs };
