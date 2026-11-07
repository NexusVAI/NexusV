// Builds the /api site: api/_src/pages/**/*.html → api/**/index.html (+ api/assets/search-index.json).
//
//   node api/_src/build.mjs            build everything
//   node api/_src/build.mjs --check    build, then exit 1 if any warning was printed
//   node api/_src/build.mjs --clean    also delete pages this script generated earlier whose source is gone
//                                      (opt-in: concurrent builds would otherwise delete each other's fresh pages)
//
// Page file = front matter + body:
//   ---
//   title: 快速开始                   required (h1 + <title>)
//   description: 一句话说明            lead paragraph under the h1 + meta description
//   layout: docs | wide | home        docs (default) = sidebar + article + TOC; wide = sidebar + raw <main> body; home = no sidebar/subnav
//   tab: overview                     subnav tab id (nav.mjs TABS); default = the tab whose sidebar lists this URL
//   nav: /api/docs/models/            sidebar entry to highlight when the page itself is not listed
//   css: /api/assets/x.css, …         extra stylesheets (after the vendored OpenAI CSS, before api.css)
//   js: /api/assets/x.js, …           extra deferred scripts (after shell.js)
//   toc: false · lead: false · search: false · transform: true (run the docs transforms on a wide/home body)
//   ---
// Docs bodies may use, besides plain HTML:
//   <h2 id="slug">…</h2> (h2–h4 need ids; h2s feed the right-hand TOC)
//   <pre data-lang="bash" data-title="标题" data-label="cURL">raw code — do NOT HTML-escape; only "</pre>" is forbidden</pre>
//   <code-tabs title="标题"><pre data-lang="python">…</pre><pre data-lang="javascript">…</pre></code-tabs>
//   <callout type="info|warning|danger|success">…</callout>
//   <cards><card href="/api/…" title="标题" icon="bolt|cube">说明</card></cards>
//   <table>…</table> (wrapped automatically)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformContent } from "./lib/content.mjs";
import { LAYOUTS } from "./lib/layouts.mjs";
import { normUrl, stripTags } from "./lib/util.mjs";
import { TABS, EXTRA_SEARCH } from "./nav.mjs";

const SRC = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.join(SRC, "pages");
const API_ROOT = path.resolve(SRC, "..");
const MANIFEST = path.join(SRC, ".generated.json");
const CHECK = process.argv.includes("--check");
const CLEAN = process.argv.includes("--clean");

const warnings = [];
const warn = (msg) => warnings.push(msg);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p);
    return d.name.endsWith(".html") ? [p] : [];
  });
}

function parseFrontMatter(raw, file) {
  const text = raw.replace(/^\uFEFF/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) {
    warn(`${file}: missing front matter`);
    return { meta: {}, body: text };
  }
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);
const bool = (s, dflt) => (s === undefined ? dflt : !/^(false|no|0)$/i.test(s));

function urlFor(rel) {
  const p = rel.replace(/\\/g, "/").replace(/\.html$/, "");
  if (p === "index") return "/api/";
  if (p.endsWith("/index")) return `/api/${p.slice(0, -"/index".length)}/`;
  return `/api/${p}/`;
}

function flatten(items, out = []) {
  for (const it of items) {
    if (it.href) out.push(it);
    if (it.items) flatten(it.items, out);
  }
  return out;
}
const tabLinks = (tab) => tab.sidebar.flatMap((sec) => flatten(sec.items));
const tabOf = (url) => TABS.find((t) => tabLinks(t).some((it) => normUrl(it.href) === normUrl(url)));

// ── load pages ──────────────────────────────────────────────────────────
const pages = walk(PAGES).map((file) => {
  const rel = path.relative(PAGES, file);
  const { meta, body } = parseFrontMatter(fs.readFileSync(file, "utf8"), rel);
  const url = urlFor(rel);
  const layout = meta.layout || "docs";
  if (!LAYOUTS[layout]) warn(`${rel}: unknown layout "${layout}"`);
  if (!meta.title) warn(`${rel}: missing title`);
  if (/\uFFFD/.test(body)) warn(`${rel}: contains U+FFFD (encoding damage)`);
  const navUrl = meta.nav || url;
  const tab = meta.tab || (tabOf(navUrl) || {}).id || (layout === "home" ? "" : "overview");
  if (tab && !TABS.some((t) => t.id === tab)) warn(`${rel}: unknown tab "${tab}"`);
  return {
    src: rel.replace(/\\/g, "/"),
    url,
    navUrl,
    layout,
    tab,
    title: meta.title || "",
    fullTitle: meta.fullTitle || "",
    description: meta.description || "",
    css: list(meta.css),
    js: list(meta.js),
    toc: bool(meta.toc, true),
    lead: bool(meta.lead, true),
    search: bool(meta.search, true),
    transform: bool(meta.transform, layout === "docs" || layout === "reference"),
    bodyAttrs: meta.bodyAttrs || "",
    rawBody: body,
  };
});

const byUrl = new Map(pages.map((p) => [normUrl(p.url), p]));

// ── render ──────────────────────────────────────────────────────────────
const searchIndex = [];
const written = [];
for (const page of pages) {
  let toc = [];
  let text = "";
  if (page.transform) {
    const r = transformContent(page.rawBody, page.src);
    r.warnings.forEach(warn);
    page.body = r.html;
    toc = r.toc;
    text = r.text;
  } else {
    page.body = page.rawBody;
    text = stripTags(page.rawBody.replace(/<(script|style)[\s\S]*?<\/\1>/g, " "));
  }
  page.tocItems = toc;

  const tab = TABS.find((t) => t.id === page.tab);
  if (tab && page.layout !== "home") {
    const links = tabLinks(tab);
    const i = links.findIndex((it) => normUrl(it.href) === normUrl(page.navUrl));
    if (i >= 0) {
      page.prev = links[i - 1] || null;
      page.next = links[i + 1] || null;
    }
  }

  const html = LAYOUTS[page.layout](page);
  const out = path.join(API_ROOT, page.url.replace(/^\/api\/?/, ""), "index.html");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html, "utf8");
  written.push(path.relative(API_ROOT, out).replace(/\\/g, "/"));

  if (page.search) {
    searchIndex.push({
      t: page.title,
      u: page.url,
      s: tab ? tab.label : "",
      d: page.description,
      h: toc.map((h) => [h.id, h.text]),
      x: text.slice(0, 600),
    });
  }
}
for (const e of EXTRA_SEARCH) searchIndex.push({ t: e.title, u: e.url, s: "", d: "", h: [], x: e.text });

fs.mkdirSync(path.join(API_ROOT, "assets"), { recursive: true });
fs.writeFileSync(path.join(API_ROOT, "assets", "search-index.json"), JSON.stringify(searchIndex), "utf8");

// ── remove pages this script generated earlier but no longer produces (--clean only) ──
if (CLEAN) {
  const stale = [];
  (function scan(dir) {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (!d.name.startsWith("_") && d.name !== "assets") scan(abs);
      } else if (d.name === "index.html") {
        const rel = path.relative(API_ROOT, abs).replace(/\\/g, "/");
        if (!written.includes(rel) && fs.readFileSync(abs, "utf8").includes("由 api/_src/build.mjs")) stale.push(abs);
      }
    }
  })(API_ROOT);
  for (const abs of stale) {
    fs.unlinkSync(abs);
    console.log(`removed stale ${path.relative(API_ROOT, abs)}`);
  }
}
fs.writeFileSync(MANIFEST, JSON.stringify(written.sort(), null, 1), "utf8");

// ── link checks ─────────────────────────────────────────────────────────
const BUILT_ELSEWHERE = [/^\/api\/console(\/|$)/, /^\/api\/contact(\/|$)/, /^\/api\/models(\/|$)/, /^\/api\/assets\//];
const exists = (href) => {
  const u = normUrl(href);
  if (byUrl.has(u)) return true;
  if (BUILT_ELSEWHERE.some((re) => re.test(u))) return true;
  return fs.existsSync(path.join(API_ROOT, u.replace(/^\/api\/?/, ""), "index.html")) || fs.existsSync(path.join(API_ROOT, u.replace(/^\/api\/?/, "")));
};
for (const tab of TABS) {
  if (!exists(tab.href)) warn(`nav: tab "${tab.label}" → ${tab.href} has no page`);
  for (const it of tabLinks(tab)) if (it.href.startsWith("/api/") && !exists(it.href)) warn(`nav: ${tab.id} sidebar → ${it.href} has no page`);
}
for (const page of pages) {
  for (const m of page.rawBody.matchAll(/href="(\/api\/[^"#?]*)/g)) if (!exists(m[1])) warn(`${page.src}: link to missing page ${m[1]}`);
}

console.log(`built ${written.length} pages, search index ${searchIndex.length} entries`);
if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
}
if (CHECK && warnings.length) process.exit(1);
