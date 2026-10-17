// 移植自 cancri-code/src/chat/render/web-sources.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — 网页来源（搜索结果解析 + 站点 Logo + 正文引用标记）
 *
 * 纯函数模块，只依赖 ../format 的转义工具。**刻意不 import ./markdown 或 ./tool-cards**：
 * 那两个都要用本模块（markdown 渲染引用 chip、tool-cards 渲染搜索卡），反向依赖会成环。
 *
 * 引用标记协议：模型在正文里写 `[[cite:https://example.com/page]]`，可连写多条表示同一
 * 处有多个来源。渲染时合并成一枚 chip（首个来源的站点 Logo + 域名 + `+N`），点开是来源卡。
 * ⛔ 标记里带的是**完整 URL** 而不是序号：序号方案要求工具端与渲染端各维护一份全局计数，
 * 归档恢复 / 子代理 / 压缩任何一处对不齐，引用就会静默指向错误的网站——那比多花几十 token 糟。
 */
import { escapeAttr, escapeHtml } from "../format";

/**
 * `faviconUrl` 是**出网能力凭据**，不只是一个字符串：空串 = 不许为这个站点发任何请求。
 *
 * ⛔ 只有我方已经通过受控路径（web_search / web_fetch，两者都过 egress-policy 与 Rust 侧
 * SSRF 闸门）真正访问过的主机才配有值。模型正文里的 `[[cite:URL]]` 可以指向**任意**主机，
 * 而渲染层会按 SiteIdentity 自动构造 `<img src>` —— 那是一条不经工具、不经审批、
 * CSP `img-src https:` 直接放行的出网通道，主机名本身就是数据信道
 * （同一条信道 egress-policy.ts:192-198 已为 web_fetch 封堵过）。
 */
export interface SiteIdentity {
  hostname: string;
  /** 空串 = 未登记来源，渲染时只露首字母，**不得**产出 `<img>`。 */
  faviconUrl: string;
}

/** 一条搜索结果的可视化形态；展开面板与正文引用 chip 共用同一份解析。 */
export interface WebSearchResultItem extends SiteIdentity {
  title: string;
  url: string;
  snippet: string;
}

/** 正文引用能展示的最小信息集；来源缺席时可只由 URL 推导（title 退化成域名）。 */
export type CitationSource = WebSearchResultItem;

/** 引用标记：单条。 */
const CITE_ONE_RE = /\[\[cite:([^\]\s]+)\]\]/g;
/** 引用标记：连写的一串（渲染成一枚合并 chip）。允许标记之间有空格/逗号/顿号。 */
export const CITE_RUN_RE = /\[\[cite:[^\]\s]+\]\](?:[\s,，、]*\[\[cite:[^\]\s]+\]\])*/g;

/**
 * 从 http(s) URL 推导站点标识。返回 null = 不参与 Logo / 引用
 * （畸形 URL 或非 http scheme），工具正文仍保留原始结果供用户查看。
 */
export function siteFromUrl(value: unknown): (SiteIdentity & { url: string }) | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname) return null;
    return { hostname, faviconUrl: `${url.origin}/favicon.ico`, url: url.href };
  } catch {
    return null;
  }
}

/**
 * 引用查表用的 URL 规范化。模型抄 URL 时常见的三种漂移都在这里抹平：
 * 丢/补末尾斜杠、带上 `#锚点`、大小写域名。查询串保留——它常常决定页面内容。
 */
export function normalizeSourceUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}${url.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** 展开面板与引用 chip 都要「每一条结果」，所以这里**不按域名去重**（去重只发生在 Logo 叠放上）。 */
export function parseSearchResults(display: unknown): WebSearchResultItem[] {
  const rawResults = display && typeof display === "object"
    ? (display as { results?: unknown }).results
    : null;
  if (!Array.isArray(rawResults)) return [];
  const items: WebSearchResultItem[] = [];
  for (const raw of rawResults) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const site = siteFromUrl(row.url);
    if (!site) continue;
    items.push({
      ...site,
      title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : site.hostname,
      snippet: typeof row.snippet === "string" ? row.snippet.trim() : "",
    });
  }
  return items;
}

/** web_fetch 的 display 只有单个页面；它同样可以被正文引用。 */
export function parseFetchedPage(display: unknown): WebSearchResultItem | null {
  if (!display || typeof display !== "object") return null;
  const row = display as Record<string, unknown>;
  const site = siteFromUrl(row.url);
  if (!site) return null;
  return {
    ...site,
    title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : site.hostname,
    snippet: "",
  };
}

/** web_fetch 结果里登记的页面图片（见 webfetch.extractPageImages），只取 https。 */
export function parseFetchedImages(display: unknown): string[] {
  if (!display || typeof display !== "object") return [];
  const images = (display as { images?: unknown }).images;
  if (!Array.isArray(images)) return [];
  return images.filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u) && u.length <= 1000).slice(0, 16);
}

export function dedupeSites(items: readonly SiteIdentity[]): SiteIdentity[] {
  const out: SiteIdentity[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.hostname)) continue;
    seen.add(item.hostname);
    out.push({ hostname: item.hostname, faviconUrl: item.faviconUrl });
  }
  return out;
}

/**
 * favicon 的候选链。
 *
 * `/favicon.ico` 一条路远远不够：用户 2026-09-08 实报「有的网页徽标 logo 加载不出来」，
 * 而实测缺的那几个都是**子域**（developers.openai.com 这种）——它们把图标声明在 HTML 的
 * `<link rel=icon>` 里、根路径上什么都没有，而主域几乎总有。
 *
 * ⛔ 候选一律限定在**站点自己的 origin**（外加它的父域），不走任何第三方 favicon 服务：
 * 那类服务要把用户看过的域名逐个报给一个我们不控制的主机，对一个「数据只留在本机」的
 * 本地 IDE 来说是净损失。拿不到就露首字母，那个兜底本来就够用。
 *
 * ⛔ `faviconUrl` 为空 = 未登记来源 → **一条候选都不给**。见 SiteIdentity 的说明：
 * 这里多返回一条，渲染层就会替模型向一个它自己指定的主机发请求。
 */
export function faviconCandidates(site: SiteIdentity): string[] {
  if (!site.faviconUrl) return [];
  const out = [site.faviconUrl];
  let origin: string;
  try {
    origin = new URL(site.faviconUrl).origin;
  } catch {
    return out;
  }
  out.push(`${origin}/apple-touch-icon.png`);
  const labels = site.hostname.split(".");
  if (labels.length > 2) {
    const scheme = origin.startsWith("http://") ? "http:" : "https:";
    out.push(`${scheme}//${labels.slice(1).join(".")}/favicon.ico`);
  }
  return out;
}

/**
 * 从 `data-favicon-next` 取下一个候选。返回 null = 候选用尽（调用方该露首字母了）。
 * 纯函数，DOM 那一半在 chat.ts 的捕获式 error 监听里。
 */
export function nextFaviconCandidate(raw: string | null): { next: string; rest: string } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const queue = parsed.filter((x): x is string => typeof x === "string" && !!x);
  if (queue.length === 0) return null;
  return { next: queue[0], rest: JSON.stringify(queue.slice(1)) };
}

/**
 * 候选全试完仍失败时 img 由 chat.ts 的捕获式 error 监听置 hidden，露出其下的域名首字母。
 * 首字母与图片是**同一个圆里的两层**，所以圆片必须自带 line-height（见 devin-ui.css）。
 */
export function renderSiteLogo(site: SiteIdentity, className = ""): string {
  const fallback = site.hostname.slice(0, 1).toUpperCase();
  const cls = className ? ` ${className}` : "";
  const shell = `<span class="worklog-site-logo${cls}" title="${escapeAttr(site.hostname)}">` +
    `<span class="worklog-site-logo-fallback" aria-hidden="true">${escapeHtml(fallback)}</span>`;
  const [first, ...rest] = faviconCandidates(site);
  // 未登记来源没有候选：只留首字母圆片。⛔ 不要在这里"兜底"补一个 `${origin}/favicon.ico`，
  // 那正好把被切断的通道接回去。
  if (!first) return `${shell}</span>`;
  const nextAttr = rest.length ? ` data-favicon-next="${escapeAttr(JSON.stringify(rest))}"` : "";
  return shell +
    `<img class="worklog-site-logo-img" src="${escapeAttr(first)}" alt="" loading="lazy" referrerpolicy="no-referrer"${nextAttr} />` +
    `</span>`;
}

export function renderSiteLogos(
  sites: readonly SiteIdentity[],
  opts: { max?: number; className?: string } = {},
): string {
  if (sites.length === 0) return "";
  const max = opts.max ?? 4;
  const visible = sites.slice(0, max);
  const overflow = sites.length - visible.length;
  const logos = visible.map((site) => renderSiteLogo(site)).join("");
  const more = overflow > 0
    ? `<span class="worklog-site-logo-more" aria-label="另有 ${overflow} 个网站">+${overflow}</span>`
    : "";
  const cls = opts.className ? ` ${opts.className}` : "";
  return `<span class="worklog-site-logos${cls}" aria-label="搜索结果网站">${logos}${more}</span>`;
}

/**
 * 把 escapeHtml 过的片段还原成原始 URL。
 * inlineMd 的第一行就整体转义了，所以标记里的 `&` 此刻是 `&amp;`；带查询串的搜索结果
 * 几乎必然命中这一条，不还原就永远查不到来源（退化成只有域名的兜底 chip）。
 * ⛔ `&amp;` 必须最后解：先解它会把 `&amp;lt;` 这类二次转义再吃一层。
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export type CitationLookup = ReadonlyMap<string, CitationSource>;

export function buildCitationLookup(sources: readonly CitationSource[]): Map<string, CitationSource> {
  const map = new Map<string, CitationSource>();
  for (const source of sources) {
    const key = normalizeSourceUrl(source.url);
    if (!map.has(key)) map.set(key, source);
  }
  return map;
}

/**
 * 解析一串连写标记里的来源；查不到登记信息的 URL 退化成「只有域名」的来源，仍可点开。
 *
 * ⛔ 未登记来源必须**清空 `faviconUrl`**。`[[cite:...]]` 里的 URL 完全由模型正文决定，
 * 而 lookup 里只有我方真正抓过的页面 —— 保留 favicon 等于让模型指定的任意主机在渲染那一刻
 * 收到一次 DNS + HTTPS GET（子域名即可携带载荷）。退化成域名 chip 是刻意的可用性决策
 * （归档里旧消息的工具结果可能已被压缩掉），但它**不应该**顺带附赠一次出网。
 */
export function resolveCitationRun(run: string, lookup: CitationLookup): CitationSource[] {
  const out: CitationSource[] = [];
  const seen = new Set<string>();
  for (const match of run.matchAll(CITE_ONE_RE)) {
    const raw = decodeEntities(match[1]);
    const site = siteFromUrl(raw);
    if (!site) continue;
    const key = normalizeSourceUrl(site.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const known = lookup.get(key);
    out.push(known ?? { ...site, faviconUrl: "", title: site.hostname, snippet: "" });
  }
  return out;
}

/**
 * 渲染合并后的引用 chip。返回 "" = 这串标记里没有一个合法 http(s) URL，
 * 此时调用方应把标记整段抹掉：把 `[[cite:...]]` 原样漏给用户比没有引用更糟。
 */
export function renderCitationChip(sources: readonly CitationSource[]): string {
  if (sources.length === 0) return "";
  const head = sources[0];
  // 只带 url + title + fav：hostname 能从 url 推回来（parseCitationPayload 就这么做），
  // 而这段 JSON 会原样进 innerHTML，每多一个字段就多一份重渲成本。
  // `fav` 不能省：favicon 虽然也能从 url 推出来，但**允不允许发这个请求**推不出来
  // （见 SiteIdentity）。少了它，来源卡一打开就把未登记主机的 favicon 拉一遍。
  const payload = escapeAttr(JSON.stringify(sources.map((s) => (
    s.faviconUrl ? { url: s.url, title: s.title, fav: 1 } : { url: s.url, title: s.title }
  ))));
  const more = sources.length > 1
    ? `<span class="md-cite-more">+${sources.length - 1}</span>`
    : "";
  const label = sources.length > 1
    ? `来源：${head.hostname} 等 ${sources.length} 个网站`
    : `来源：${head.hostname}`;
  return `<span class="md-cite" role="button" tabindex="0" data-cite="${payload}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">` +
    renderSiteLogo(head, "md-cite-logo") +
    `<span class="md-cite-label">${escapeHtml(head.hostname)}</span>` +
    more +
    `</span>`;
}

/** 从 chip 的 data-cite 读回来源。属性内容来自我们自己生成的 JSON，仍做形状校验后再用。 */
export function parseCitationPayload(raw: string | null): CitationSource[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: CitationSource[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const site = siteFromUrl(row.url);
    if (!site) continue;
    out.push({
      ...site,
      // 没有 fav 标记 = 渲染 chip 时它就是未登记来源，来源卡同样不许发 favicon 请求。
      faviconUrl: row.fav ? site.faviconUrl : "",
      title: typeof row.title === "string" && row.title ? row.title : site.hostname,
      snippet: typeof row.snippet === "string" ? row.snippet : "",
    });
  }
  return out;
}
