// api_docs.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_docs.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
//
// 2026-05-17 重构：在原 tabs / copy / toc scroll-spy 基础上追加 6 块新能力：
//   1. 顶部搜索按钮 + Cmd/Ctrl+K 全局快捷键，弹出文档搜索 modal
//   2. 搜索 index 构建：扫 main 下所有 section h2/h3/p/li/td 文本，建一份纯
//      内存索引；输入实时分词命中、↑↓ 键盘选择、Enter 跳转、Esc 关闭
//   3. 复制本页为 Markdown：递归把 main 内容 (h1-h3 / p / ul / ol / table /
//      pre / code / a / b) 序列化为 GitHub Flavored Markdown 后写剪贴板
//   4. 分享：优先 navigator.share；不支持则把当前 URL（带页内 anchor）写剪贴板
//   5. 右侧「在此页面」outline：扫 h2/h3 自动生成，IntersectionObserver 高亮
//   6. 底部上一节 / 下一节 prev/next 导航，跟随当前滚动到的 section 自动填

const $ = (id) => document.getElementById(id);

// ─── 0. Page-level pagination (2026-05-18) ─────────────────────────────────
const DOCS_PAGES = ["overview", "endpoints", "cli", "clients", "rules"];
const DEFAULT_DOC_PAGE = "overview";

function getActiveDocPage() {
    const p = new URLSearchParams(location.search).get("page") || DEFAULT_DOC_PAGE;
    return DOCS_PAGES.includes(p) ? p : DEFAULT_DOC_PAGE;
}
function getVisibleSections() {
    return document.querySelectorAll(
        "main .docs-page:not([hidden]) section[id]",
    );
}
function applyDocPage(page, opts = {}) {
    document.querySelectorAll(".docs-page").forEach((el) => {
        el.hidden = el.dataset.docPage !== page;
    });
    document.querySelectorAll("aside.toc [data-doc-page]").forEach((el) => {
        if (el.classList.contains("docs-page-link")) {
            el.classList.toggle("is-active", el.dataset.docPage === page);
        } else {
            el.hidden = el.dataset.docPage !== page;
        }
    });
    document
        .querySelectorAll(".docs-page-tabs .docs-page-link")
        .forEach((el) => {
            el.classList.toggle("is-active", el.dataset.docPage === page);
        });
    document.dispatchEvent(
        new CustomEvent("docpagechange", { detail: { page } }),
    );
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: "auto" });
}
function setActiveDocPage(page, opts = {}) {
    if (!DOCS_PAGES.includes(page)) return;
    const params = new URLSearchParams(location.search);
    params.set("page", page);
    const hash = opts.hash || "";
    history.pushState(
        { docPage: page },
        "",
        location.pathname + "?" + params.toString() + hash,
    );
    applyDocPage(page, opts);
}
document.querySelectorAll(".docs-page-link").forEach((link) => {
    link.addEventListener("click", (e) => {
        e.preventDefault();
        setActiveDocPage(link.dataset.docPage);
    });
});
window.addEventListener("popstate", () => {
    applyDocPage(getActiveDocPage(), { scroll: false });
});
// Initial paint — must run BEFORE the modules below capture section lists,
// so they see the correct hidden state on first load.
applyDocPage(getActiveDocPage(), { scroll: false });

// ─── 1. Tabbed code blocks ────────────────────────────────────────────
document.querySelectorAll(".code-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
        const grp = btn.dataset.grp;
        const lang = btn.dataset.lang;
        document
            .querySelectorAll(`.code-tab[data-grp="${grp}"]`)
            .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document
            .querySelectorAll(`pre.lang[data-grp="${grp}"]`)
            .forEach((p) => p.classList.remove("active"));
        const target = document.querySelector(
            `pre.lang[data-grp="${grp}"][data-lang="${lang}"]`,
        );
        if (target) target.classList.add("active");
    });
});

// ─── 2. 代码块复制按钮 ──────────────────────────────────────────────────────
document.querySelectorAll(".copy-icon").forEach((btn) => {
    btn.addEventListener("click", () => {
        let text = "";
        if (btn.dataset.copyText) {
            const el = document.getElementById(btn.dataset.copyText);
            if (el) text = el.textContent.trim();
        } else if (btn.dataset.copyGrp) {
            const active = document.querySelector(
                `pre.lang[data-grp="${btn.dataset.copyGrp}"].active`,
            );
            if (active) text = active.textContent;
        }
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const orig = btn.textContent;
            btn.textContent = "已复制";
            btn.classList.add("copied");
            setTimeout(() => {
                btn.textContent = orig;
                btn.classList.remove("copied");
            }, 1200);
        });
    });
});

// ─── 3. 左侧 toc 滚动高亮 ───────────────────────────────────────────
// IntersectionObserver 阈值 -30% top / -60% bottom：视口中段进入视野的 section
// 才会被认作「当前在读」，避免还没真正滚到就把高亮换走。隐藏页的
// section 被 CSS display:none，getBoundingClientRect 为 0×0，不会被观察出
// isIntersecting=true，所以 scroll-spy 会自动志 fail-closed——不需额外过滤。
let sections = getVisibleSections();
const tocLinks = document.querySelectorAll("aside.toc a");
const tocObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach((e) => {
            if (e.isIntersecting) {
                tocLinks.forEach((a) => a.classList.remove("active"));
                const link = document.querySelector(
                    `aside.toc a[href="#${e.target.id}"]`,
                );
                if (link) link.classList.add("active");
            }
        });
    },
    { rootMargin: "-30% 0px -60% 0px" },
);
function observeSections() {
    sections = getVisibleSections();
    sections.forEach((s) => tocObserver.observe(s));
}
observeSections();

// ─── 4. 右侧 outline（在此页面） ────────────────────────────────────────────
// 扫 main 下所有 h2/h3 自动生成。h2 是节点标题（lvl-2，与 toc 一一对应），
// h3 是节内小节（lvl-3，缩进 + 更淡的字色）。给所有 heading 强制注入 id 让
// 浏览器原生 anchor 跳转可用（部分 h3 原文档没有 id）。
const outlineHost = document.getElementById("docsOnPageOutline");
let outlineHeadings = [];
let outlineObserver = null;
if (outlineHost) {
    outlineObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((e) => {
                const link = e.target._outlineLink;
                if (!link) return;
                if (e.isIntersecting) {
                    outlineHeadings.forEach((x) =>
                        x.link.classList.remove("is-active"),
                    );
                    link.classList.add("is-active");
                }
            });
        },
        { rootMargin: "-15% 0px -75% 0px" },
    );
    rebuildOutline();
    document.addEventListener("docpagechange", rebuildOutline);
}
function rebuildOutline() {
    if (!outlineHost) return;
    // 重置观察器 + 清空之前的 outline DOM。仅给当前可见 .docs-page 内的
    // h2/h3 生成右侧「在此页面」列表。
    outlineHeadings.forEach((x) => {
        if (outlineObserver) outlineObserver.unobserve(x.el);
        delete x.el._outlineLink;
    });
    outlineHeadings = [];
    outlineHost.innerHTML = "";
    const fragment = document.createDocumentFragment();
    document
        .querySelectorAll(
            "main .docs-page:not([hidden]) h2, main .docs-page:not([hidden]) h3",
        )
        .forEach((h) => {
            if (!h.id) h.id = autoSlug(h.textContent, outlineHeadings.length);
            const li = document.createElement("li");
            const a = document.createElement("a");
            a.href = "#" + h.id;
            a.textContent = h.textContent.trim();
            a.className = h.tagName === "H3" ? "lvl-3" : "lvl-2";
            li.appendChild(a);
            fragment.appendChild(li);
            h._outlineLink = a;
            outlineHeadings.push({ id: h.id, el: h, link: a });
            if (outlineObserver) outlineObserver.observe(h);
        });
    outlineHost.appendChild(fragment);
}

function autoSlug(text, idx) {
    const base = (text || "")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
    return base ? `h-${base}` : `h-auto-${idx}`;
}

// ─── 5. 底部 prev/next 导航 ────────────────────────────────────────
// 跟随当前可见 section 实时更新。位于页边界时 prev/next 跳到相邻页，与
// Kimi 页间跨页导航一致。
const pager = document.getElementById("docsPager");
let pagerObserver = null;
if (pager) {
    const prevLink = pager.querySelector(".docs-pager-prev");
    const nextLink = pager.querySelector(".docs-pager-next");
    pagerObserver = new IntersectionObserver(
        (entries) => {
            entries.forEach((e) => {
                if (e.isIntersecting) {
                    const idx = Array.from(sections).indexOf(e.target);
                    if (idx >= 0) updatePager(idx);
                }
            });
        },
        { rootMargin: "-30% 0px -60% 0px" },
    );
    function updatePager(currentIdx) {
        const list = Array.from(sections);
        const prev = list[currentIdx - 1];
        const next = list[currentIdx + 1];
        const activePage = getActiveDocPage();
        const pageIdx = DOCS_PAGES.indexOf(activePage);
        const prevPage = pageIdx > 0 ? DOCS_PAGES[pageIdx - 1] : null;
        const nextPage =
            pageIdx < DOCS_PAGES.length - 1 ? DOCS_PAGES[pageIdx + 1] : null;
        setPagerLink(prevLink, prev, prevPage, "prev");
        setPagerLink(nextLink, next, nextPage, "next");
    }
    function setPagerLink(linkEl, section, fallbackPage, dir) {
        if (!linkEl) return;
        const titleEl = linkEl.querySelector(".docs-pager-title");
        linkEl.onclick = null;
        if (section) {
            const h2 = section.querySelector("h2");
            linkEl.removeAttribute("aria-disabled");
            linkEl.href = "#" + section.id;
            if (titleEl)
                titleEl.textContent = h2 ? h2.textContent.trim() : section.id;
            return;
        }
        if (fallbackPage) {
            // 跨页：点击时切换到相邻页。标题用那页的首/末 section h2。
            const sib = document.querySelector(
                `.docs-page[data-doc-page="${fallbackPage}"]`,
            );
            const sibSections = sib
                ? sib.querySelectorAll("section[id]")
                : [];
            const target =
                dir === "prev"
                    ? sibSections[sibSections.length - 1]
                    : sibSections[0];
            const h2 = target ? target.querySelector("h2") : null;
            linkEl.removeAttribute("aria-disabled");
            linkEl.href =
                "?page=" + fallbackPage + (target ? "#" + target.id : "");
            if (titleEl)
                titleEl.textContent = h2 ? h2.textContent.trim() : fallbackPage;
            linkEl.onclick = (ev) => {
                ev.preventDefault();
                setActiveDocPage(fallbackPage, {
                    hash: target ? "#" + target.id : "",
                });
            };
            return;
        }
        linkEl.setAttribute("aria-disabled", "true");
        linkEl.href = "#";
        if (titleEl) titleEl.textContent = "";
    }
    function rebuildPager() {
        // sections 会在 observeSections() 中重新赋值，这里需要重新观察新
        // 可见集 + 重置 prev/next 初始指针为首个 section。
        sections.forEach((s) => pagerObserver.observe(s));
        if (sections.length > 0) updatePager(0);
    }
    pager.hidden = false;
    rebuildPager();
    document.addEventListener("docpagechange", () => {
        observeSections();
        rebuildPager();
    });
}

// ─── 6. 搜索：index 构建 + Cmd/Ctrl+K modal + 键盘导航 ──────────────────────
// 索引粒度：每个 section[id] 里的每个 h2/h3 是一个 entry；entry 的「body」
// 拼接它到下一个同级 heading 之间的所有 p/li/td 文本。命中规则：所有空白
// 分隔 token 都要在 title 或 body 里出现（AND 匹配，case-insensitive）。
const searchIndex = buildSearchIndex();
const searchModal = document.getElementById("docsSearchModal");
const searchInput = document.getElementById("docsSearchInput");
const searchResultsHost = document.getElementById("docsSearchResults");
const searchBackdrop = document.getElementById("docsSearchBackdrop");
const searchTrigger = document.getElementById("docsSearchTrigger");
let activeResultIdx = -1;

if (searchTrigger) searchTrigger.addEventListener("click", openSearch);
if (searchBackdrop) searchBackdrop.addEventListener("click", closeSearch);
if (searchInput) {
    searchInput.addEventListener("input", () => renderResults(searchInput.value));
    searchInput.addEventListener("keydown", onSearchKeydown);
}
document.addEventListener("keydown", (e) => {
    const isOpen = searchModal && !searchModal.hidden;
    // Cmd+K / Ctrl+K 全局唤起（页内任何位置）
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        isOpen ? closeSearch() : openSearch();
        return;
    }
    if (isOpen && e.key === "Escape") {
        e.preventDefault();
        closeSearch();
    }
});

// Mac 用户把 kbd 提示里的 Ctrl 换成 ⌘（视觉只换，不影响事件监听）
const modKey = document.getElementById("docsSearchModKey");
if (modKey && /Mac|iPhone|iPad/.test(navigator.platform)) {
    modKey.textContent = "⌘";
}

function openSearch() {
    if (!searchModal || !searchInput) return;
    searchModal.hidden = false;
    // 微任务后再 focus + 选中，确保动画/display 切换完毕
    queueMicrotask(() => {
        searchInput.value = "";
        searchInput.focus();
        renderResults("");
    });
    document.body.style.overflow = "hidden";
}
function closeSearch() {
    if (!searchModal) return;
    searchModal.hidden = true;
    document.body.style.overflow = "";
    activeResultIdx = -1;
}

function onSearchKeydown(e) {
    const results = searchResultsHost.querySelectorAll(".docs-search-result");
    if (!results.length) return;
    if (e.key === "ArrowDown") {
        e.preventDefault();
        activeResultIdx = (activeResultIdx + 1) % results.length;
        highlightActive(results);
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeResultIdx =
            (activeResultIdx - 1 + results.length) % results.length;
        highlightActive(results);
    } else if (e.key === "Enter") {
        e.preventDefault();
        const target = activeResultIdx >= 0 ? results[activeResultIdx] : results[0];
        if (target) target.click();
    }
}
function highlightActive(results) {
    results.forEach((r, i) => {
        r.classList.toggle("is-active", i === activeResultIdx);
    });
    if (activeResultIdx >= 0)
        results[activeResultIdx].scrollIntoView({ block: "nearest" });
}

function buildSearchIndex() {
    const entries = [];
    document.querySelectorAll("main section[id]").forEach((section) => {
        const sectionH2 = section.querySelector("h2");
        const sectionTitle = sectionH2 ? sectionH2.textContent.trim() : section.id;
        // 拆 section 内所有 h2/h3 形成 entry，每个 entry 的 body 是它和下一个
        // heading（含 h2/h3）之间的所有文本节点合并。
        const headings = section.querySelectorAll(":scope > h2, :scope > h3");
        headings.forEach((h, hi) => {
            const nextH = headings[hi + 1] || null;
            let body = "";
            let cursor = h.nextElementSibling;
            while (cursor && cursor !== nextH) {
                body += " " + extractTextForIndex(cursor);
                cursor = cursor.nextElementSibling;
            }
            entries.push({
                id: h.id || section.id,
                title: h.textContent.trim(),
                crumbs: h.tagName === "H3" ? sectionTitle : "",
                body: body.replace(/\s+/g, " ").trim(),
            });
        });
    });
    return entries;
}
function extractTextForIndex(el) {
    if (!el) return "";
    // 跳过 code-block 内部的 SVG / 复制按钮等纯 UI 元素
    if (el.classList && el.classList.contains("code-tabs")) return "";
    return el.textContent || "";
}

function renderResults(rawQuery) {
    if (!searchResultsHost) return;
    const q = (rawQuery || "").trim();
    searchResultsHost.innerHTML = "";
    activeResultIdx = q ? 0 : -1;
    if (!q) return;
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = searchIndex
        .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 24);
    if (!hits.length) {
        const empty = document.createElement("div");
        empty.className = "is-empty";
        empty.textContent = "没有匹配项";
        searchResultsHost.appendChild(empty);
        return;
    }
    hits.forEach((h, i) => {
        searchResultsHost.appendChild(buildResultNode(h.entry, tokens, i === 0));
    });
}
function scoreEntry(entry, tokens) {
    const title = entry.title.toLowerCase();
    const body = entry.body.toLowerCase();
    let score = 0;
    for (const t of tokens) {
        // 所有 token 都要至少在 title 或 body 里出现一次（AND 匹配）
        const inTitle = title.includes(t);
        const inBody = body.includes(t);
        if (!inTitle && !inBody) return 0;
        if (inTitle) score += 10;
        if (inBody) score += 1;
    }
    return score;
}
function buildResultNode(entry, tokens, isFirst) {
    const a = document.createElement("a");
    a.className = "docs-search-result" + (isFirst ? " is-active" : "");
    a.href = "#" + entry.id;
    a.setAttribute("role", "option");
    a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(entry.id);
        if (!target) return;
        closeSearch();
        // 2026-05-18：如果搜索命中的 entry 在另一页，先 setActiveDocPage 再滚。
        const ancestor = target.closest(".docs-page");
        const targetPage = ancestor && ancestor.dataset.docPage;
        const needPageSwitch =
            targetPage && targetPage !== getActiveDocPage();
        if (needPageSwitch) {
            setActiveDocPage(targetPage, {
                hash: "#" + entry.id,
                scroll: false,
            });
        }
        // requestAnimationFrame：等 modal/page 切换后再滚动。
        requestAnimationFrame(() => {
            target.scrollIntoView({
                behavior: needPageSwitch ? "auto" : "smooth",
                block: "start",
            });
            if (!needPageSwitch) {
                history.replaceState(null, "", "#" + entry.id);
            }
        });
    });
    if (entry.crumbs) {
        const crumbs = document.createElement("div");
        crumbs.className = "docs-search-result-crumbs";
        crumbs.textContent = entry.crumbs;
        a.appendChild(crumbs);
    }
    const title = document.createElement("div");
    title.className = "docs-search-result-title";
    appendHighlighted(title, entry.title, tokens);
    a.appendChild(title);
    const excerpt = document.createElement("div");
    excerpt.className = "docs-search-result-excerpt";
    appendHighlighted(excerpt, truncateAround(entry.body, tokens), tokens);
    a.appendChild(excerpt);
    return a;
}
function appendHighlighted(host, text, tokens) {
    if (!text) return;
    const lower = text.toLowerCase();
    // 找所有 token 的位置，合并区间，输出 text + <mark>
    const ranges = [];
    tokens.forEach((t) => {
        if (!t) return;
        let start = 0;
        while (true) {
            const idx = lower.indexOf(t, start);
            if (idx < 0) break;
            ranges.push([idx, idx + t.length]);
            start = idx + t.length;
        }
    });
    if (!ranges.length) {
        host.textContent = text;
        return;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
    }
    let cursor = 0;
    for (const [s, e] of merged) {
        if (s > cursor) host.appendChild(document.createTextNode(text.slice(cursor, s)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(s, e);
        host.appendChild(mark);
        cursor = e;
    }
    if (cursor < text.length)
        host.appendChild(document.createTextNode(text.slice(cursor)));
}
function truncateAround(text, tokens) {
    if (!text) return "";
    const lower = text.toLowerCase();
    let idx = -1;
    for (const t of tokens) {
        const i = lower.indexOf(t);
        if (i >= 0) {
            idx = i;
            break;
        }
    }
    const MAX = 140;
    if (text.length <= MAX) return text;
    if (idx < 0) return text.slice(0, MAX) + "…";
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, start + MAX);
    return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

// ─── 7. 复制本页为 Markdown ─────────────────────────────────────────────────
const copyMdBtn = document.getElementById("docsCopyMdBtn");
if (copyMdBtn) {
    copyMdBtn.addEventListener("click", async () => {
        const md = serializeMainAsMarkdown();
        try {
            await navigator.clipboard.writeText(md);
            flashButton(copyMdBtn, "docsCopyMdLabel", "已复制为 Markdown", "复制 Markdown");
        } catch {
            flashButton(copyMdBtn, "docsCopyMdLabel", "复制失败", "复制 Markdown");
        }
    });
}

// ─── 8. 分享 ────────────────────────────────────────────────────────────────
const shareBtn = document.getElementById("docsShareBtn");
if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
        const url = location.href;
        const title = document.title;
        if (navigator.share) {
            try {
                await navigator.share({ title, url });
                return;
            } catch {
                /* 用户取消 share dialog 走 fallback */
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            flashButton(shareBtn, "docsShareLabel", "已复制链接", "分享");
        } catch {
            flashButton(shareBtn, "docsShareLabel", "复制失败", "分享");
        }
    });
}

function flashButton(btn, labelId, flashText, originalText) {
    const label = document.getElementById(labelId);
    if (label) label.textContent = flashText;
    btn.classList.add("is-flashed");
    setTimeout(() => {
        if (label) label.textContent = originalText;
        btn.classList.remove("is-flashed");
    }, 1400);
}

// ─── 9. HTML → Markdown 序列化 ──────────────────────────────────────────────
// 规则：
//   - main 起始的 docs-toolbar / docs-pager 等 UI 元素跳过
//   - h1 → "# x"   h2 → "## x"   h3 → "### x"
//   - p / li 取 inline 文本 + 行内 marker 转换（b/strong → **x**、a → [x](href)、
//     code → `x`、br → 换行）
//   - ul/ol → 每个 li 一行，前缀 "- " 或 "1. "
//   - table → GitHub Flavored 管道格式
//   - pre.lang.active → ```lang\n...\n```（代码块取当前激活的 tab）
//   - .endpoint → 一行 inline 代码
//   - .alert → > blockquote
// 不嵌入任何文档外的内容，不发明字段。所有文本来自 DOM。

function serializeMainAsMarkdown() {
    const main = document.querySelector("main");
    if (!main) return "";
    const out = [];
    Array.from(main.children).forEach((node) => {
        const md = nodeToMarkdown(node, 0);
        if (md != null) out.push(md);
    });
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function nodeToMarkdown(node, depth) {
    if (!node || node.nodeType !== 1) return null;
    if (
        node.classList.contains("docs-toolbar") ||
        node.classList.contains("docs-pager")
    )
        return null;
    const tag = node.tagName.toLowerCase();
    switch (tag) {
        case "h1":
            return "# " + inlineToMarkdown(node);
        case "h2":
            return "## " + inlineToMarkdown(node);
        case "h3":
            return "### " + inlineToMarkdown(node);
        case "h4":
            return "#### " + inlineToMarkdown(node);
        case "p":
            return inlineToMarkdown(node);
        case "ul":
            return listToMarkdown(node, "-");
        case "ol":
            return listToMarkdown(node, "1.");
        case "table":
            return tableToMarkdown(node);
        case "pre":
            return preToMarkdown(node);
        case "section":
        case "main": {
            const lines = [];
            Array.from(node.children).forEach((c) => {
                const md = nodeToMarkdown(c, depth);
                if (md != null) lines.push(md);
            });
            return lines.join("\n\n");
        }
        case "div": {
            if (node.classList.contains("endpoint"))
                return "`" + node.textContent.trim().replace(/\s+/g, " ") + "`";
            if (node.classList.contains("alert")) {
                const inner = Array.from(node.children)
                    .map((c) => nodeToMarkdown(c, depth) || "")
                    .filter(Boolean)
                    .join("\n\n");
                const fallback = inner || inlineToMarkdown(node);
                return fallback
                    .split("\n")
                    .map((l) => "> " + l)
                    .join("\n");
            }
            if (node.classList.contains("code-block")) {
                const activePre = node.querySelector("pre.lang.active") || node.querySelector("pre");
                return activePre ? preToMarkdown(activePre) : null;
            }
            // 普通 div：递归
            const lines = [];
            Array.from(node.children).forEach((c) => {
                const md = nodeToMarkdown(c, depth);
                if (md != null) lines.push(md);
            });
            return lines.join("\n\n");
        }
        case "nav":
            return null; // pager 之外的导航也跳过
        default:
            return inlineToMarkdown(node);
    }
}

function listToMarkdown(listEl, marker) {
    const items = Array.from(listEl.children).filter((c) => c.tagName === "LI");
    return items.map((li) => marker + " " + inlineToMarkdown(li)).join("\n");
}
function tableToMarkdown(table) {
    const rows = [];
    const headRow = table.querySelector("thead tr");
    if (headRow) {
        rows.push(rowToMarkdown(headRow));
        const cols = headRow.querySelectorAll("th, td").length;
        rows.push("| " + Array(cols).fill("---").join(" | ") + " |");
    }
    table.querySelectorAll("tbody tr").forEach((tr) => {
        rows.push(rowToMarkdown(tr));
    });
    return rows.join("\n");
}
function rowToMarkdown(tr) {
    const cells = Array.from(tr.children)
        .filter((c) => c.tagName === "TH" || c.tagName === "TD")
        .map((c) => inlineToMarkdown(c).replace(/\|/g, "\\|").replace(/\n+/g, " "));
    return "| " + cells.join(" | ") + " |";
}
function preToMarkdown(pre) {
    const lang = (pre.dataset && pre.dataset.lang) || "";
    // 把当前 active 的代码块取原文（textContent 自动还原 span 高亮）
    const text = pre.textContent.replace(/\s+$/, "");
    const fenceLang = lang === "curl" ? "bash" : lang === "req" || lang === "resp" ? "" : lang;
    return "```" + (fenceLang || "") + "\n" + text + "\n```";
}
function inlineToMarkdown(el) {
    if (!el) return "";
    let out = "";
    el.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
            out += n.nodeValue;
        } else if (n.nodeType === 1) {
            const t = n.tagName.toLowerCase();
            const inner = inlineToMarkdown(n).trim();
            if (t === "br") out += "\n";
            else if (t === "code") out += "`" + inner + "`";
            else if (t === "b" || t === "strong") out += "**" + inner + "**";
            else if (t === "i" || t === "em") out += "*" + inner + "*";
            else if (t === "a") {
                const href = n.getAttribute("href") || "";
                out += href ? "[" + inner + "](" + href + ")" : inner;
            } else if (t === "span") {
                // span 通常用于 syntax / pill / brand 占位，按原文输出
                out += inner;
            } else if (t === "button" || t === "svg") {
                // UI 元素跳过
            } else {
                out += inner;
            }
        }
    });
    return out.replace(/\s+/g, " ").trim();
}
