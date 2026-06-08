// api_docs.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_docs.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
//
// 2026-05-17 重构：在原 tabs / copy / toc scroll-spy 基础上追加 6 块能力。
// 2026-05-22 取消多页化（?page=overview/endpoints/cli/clients/rules）：
//   多页方案使部分 toc 链接因 hidden 失活、prev/next 跨页时丢 hash 不滚动、
//   URL state 与 history 出现不一致。统一回归单页长文档，仅保留：
//   1. 顶部搜索按钮 + Cmd/Ctrl+K 全局快捷键，弹出文档搜索 modal
//   2. 搜索 index 构建（扫整个 main，不再过滤 .docs-page）
//   3. 复制本页为 Markdown
//   4. 分享
//   5. 右侧「在此页面」outline
//   6. 底部 prev/next（在同一文档内相邻 section 之间跳转，不再跨页）

const $ = (id) => document.getElementById(id);

// ─── 0. Visible-section helper ──────────────────────────────────────────
// 顶层 section[id] = 分页单元（Cursor 文档式，每页底部自带 prev/next）。
function getDocPages() {
    return Array.from(document.querySelectorAll("main > section[id]"));
}
function getVisibleSections() {
    return getDocPages();
}
const DOC_PAGES = getDocPages();
const DOC_MAIN = document.querySelector("main");

function getPageTitle(section) {
    if (!section) return "";
    const h2 = section.querySelector(":scope > h2");
    return h2 ? h2.textContent.trim() : section.id;
}

function resolvePageId(anyId) {
    if (!anyId) return DOC_PAGES[0] ? DOC_PAGES[0].id : "";
    const el = document.getElementById(anyId);
    if (!el) return DOC_PAGES[0] ? DOC_PAGES[0].id : "";
    if (DOC_PAGES.includes(el)) return el.id;
    let cur = el.parentElement;
    while (cur && cur !== DOC_MAIN) {
        if (cur.id && DOC_PAGES.includes(cur)) return cur.id;
        cur = cur.parentElement;
    }
    return DOC_PAGES[0] ? DOC_PAGES[0].id : "";
}

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

// ─── 3. 左侧 toc：折叠预览 + 高亮（分页模式） ─────────────────────────
const TOC_COLLAPSED_HEIGHT = 220;

function getTocCollapsedHeight(toc) {
    const raw = getComputedStyle(toc).getPropertyValue("--toc-collapsed-h").trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : TOC_COLLAPSED_HEIGHT;
}

function initTocCollapse() {
    const toc = document.querySelector("aside.toc");
    if (!toc || toc.querySelector(".toc-body")) return;

    const body = document.createElement("div");
    body.className = "toc-body";
    while (toc.firstChild) {
        body.appendChild(toc.firstChild);
    }
    toc.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "toc-footer";
    footer.innerHTML =
        '<div class="toc-fade" aria-hidden="true"></div>' +
        '<button type="button" class="toc-toggle" aria-expanded="false" aria-label="展开全部目录">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<polyline points="6 9 12 15 18 9"></polyline>' +
        "</svg>" +
        '<span class="toc-toggle__text">展开全部</span>' +
        "</button>";
    toc.appendChild(footer);

    const toggle = footer.querySelector(".toc-toggle");
    const toggleText = footer.querySelector(".toc-toggle__text");

    function syncCollapsible() {
        const needs =
            body.scrollHeight > getTocCollapsedHeight(toc) + 8;
        toc.classList.toggle("toc-collapsible", needs);
        if (!needs) {
            toc.classList.remove("is-expanded");
            toggle.setAttribute("aria-expanded", "false");
            toggle.setAttribute("aria-label", "展开全部目录");
            toggleText.textContent = "展开全部";
        }
    }

    toggle.addEventListener("click", () => {
        const expanding = !toc.classList.contains("is-expanded");
        toc.classList.toggle("is-expanded", expanding);
        toggle.setAttribute("aria-expanded", String(expanding));
        toggleText.textContent = expanding ? "收起" : "展开全部";
        toggle.setAttribute(
            "aria-label",
            expanding ? "收起目录" : "展开全部目录",
        );
        if (!expanding) {
            body.scrollTop = 0;
        }
    });

    syncCollapsible();
    window.addEventListener("resize", syncCollapsible);
}

function scrollTocActiveIntoView() {
    const toc = document.querySelector("aside.toc");
    const body = toc?.querySelector(".toc-body");
    const active = toc?.querySelector("a.active");
    if (!toc || !body || !active || toc.classList.contains("is-expanded")) {
        return;
    }
    const bodyRect = body.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.top < bodyRect.top) {
        body.scrollTop -= bodyRect.top - activeRect.top + 4;
    } else if (activeRect.bottom > bodyRect.bottom) {
        body.scrollTop += activeRect.bottom - bodyRect.bottom + 4;
    }
}

initTocCollapse();
initTocPanel();

const tocLinks = document.querySelectorAll("aside.toc a");

function initTocPanel() {
    const panel = document.getElementById("tocPanel");
    const resizeHandle = document.getElementById("tocPanelResize");
    const collapseBtn = document.getElementById("tocPanelCollapse");
    if (!panel || !collapseBtn) return;

    const MIN_W = 168;
    const MAX_W = 380;
    const DEFAULT_W = 220;
    const COLLAPSED_W = 44;
    const storedW = Number(localStorage.getItem("docs-toc-panel-width"));
    let width = Number.isFinite(storedW) ? storedW : DEFAULT_W;
    width = Math.min(MAX_W, Math.max(MIN_W, width));
    let collapsed = localStorage.getItem("docs-toc-panel-collapsed") === "1";
    let resizing = false;
    const label = collapseBtn.querySelector(".toc-panel__collapse-label");

    function syncCollapseUi() {
        panel.classList.toggle("is-collapsed", collapsed);
        collapseBtn.setAttribute("aria-expanded", String(!collapsed));
        collapseBtn.setAttribute(
            "aria-label",
            collapsed ? "展开目录" : "收起目录",
        );
        if (label) label.textContent = collapsed ? "展开" : "收起";
        if (collapsed) {
            panel.style.width = COLLAPSED_W + "px";
        } else {
            panel.style.width = width + "px";
        }
    }

    collapseBtn.addEventListener("click", () => {
        collapsed = !collapsed;
        localStorage.setItem(
            "docs-toc-panel-collapsed",
            collapsed ? "1" : "0",
        );
        syncCollapseUi();
    });

    if (resizeHandle) {
        resizeHandle.addEventListener("pointerdown", (e) => {
            if (collapsed || window.innerWidth <= 800) return;
            resizing = true;
            resizeHandle.setPointerCapture(e.pointerId);
            document.body.classList.add("toc-is-resizing");
        });
        resizeHandle.addEventListener("pointermove", (e) => {
            if (!resizing) return;
            e.preventDefault();
            const left = panel.getBoundingClientRect().left;
            width = Math.min(MAX_W, Math.max(MIN_W, e.clientX - left));
            panel.style.width = width + "px";
            localStorage.setItem("docs-toc-panel-width", String(Math.round(width)));
        });
        const endResize = (e) => {
            if (!resizing) return;
            resizing = false;
            document.body.classList.remove("toc-is-resizing");
            try {
                resizeHandle.releasePointerCapture(e.pointerId);
            } catch {
                /* ignore */
            }
        };
        resizeHandle.addEventListener("pointerup", endResize);
        resizeHandle.addEventListener("pointercancel", endResize);
    }

    window.addEventListener("resize", () => {
        if (window.innerWidth <= 800) {
            panel.classList.remove("is-collapsed");
            panel.style.width = "";
        } else {
            syncCollapseUi();
        }
    });

    syncCollapseUi();
}

function setTocActiveForPage(pageId) {
    tocLinks.forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (!href.startsWith("#")) return;
        const targetId = href.slice(1);
        const linkPageId = resolvePageId(targetId);
        a.classList.toggle("active", linkPageId === pageId && targetId === pageId);
    });
    rebuildTocInPageNav(pageId);
    requestAnimationFrame(scrollTocActiveIntoView);
}

function getTocInpageAfter(link) {
    const next = link?.nextElementSibling;
    return next?.classList?.contains("toc-inpage") ? next : null;
}

function setTocSubnavExpanded(link, expanded) {
    const inpage = getTocInpageAfter(link);
    if (!link || !inpage) return false;
    inpage.classList.toggle("is-open", expanded);
    link.classList.toggle("toc-sub-expanded", expanded);
    link.setAttribute("aria-expanded", String(expanded));
    return true;
}

tocLinks.forEach((a) => {
    a.addEventListener("click", (e) => {
        const href = a.getAttribute("href");
        if (!href || !href.startsWith("#")) return;
        const targetId = href.slice(1);
        const pageId = resolvePageId(targetId);
        if (!pageId) return;
        e.preventDefault();

        const isPageLink = targetId === pageId;
        const inpage = getTocInpageAfter(a);
        if (isPageLink && a.classList.contains("active") && inpage) {
            setTocSubnavExpanded(a, !inpage.classList.contains("is-open"));
            return;
        }

        showDocPage(pageId, { anchorId: targetId !== pageId ? targetId : null });
    });
});

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
                    const tocBody = document.querySelector("aside.toc .toc-body");
                    if (tocBody) {
                        tocBody
                            .querySelectorAll(".toc-inpage a")
                            .forEach((a) => a.classList.remove("is-active"));
                        const tocLink = e.target._tocInpageLink;
                        if (tocLink) tocLink.classList.add("is-active");
                    }
                }
            });
        },
        { rootMargin: "-15% 0px -75% 0px" },
    );
    rebuildOutline();
}
function rebuildOutline() {
    if (!outlineHost) return;
    // 2026-05-22 单页化后仅扫一次 main 下的 h2/h3。不再跨页重建。
    outlineHeadings.forEach((x) => {
        if (outlineObserver) outlineObserver.unobserve(x.el);
        delete x.el._outlineLink;
    });
    outlineHeadings = [];
    outlineHost.innerHTML = "";
    const fragment = document.createDocumentFragment();
    const scope =
        document.querySelector("main > section[id].is-docs-page-active") ||
        document.querySelector("main");
    const sectionId = scope.id || "";
    scope.querySelectorAll("h2, h3").forEach((h, hi) => {
            ensureHeadingId(h, hi, sectionId);
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

function headingSlug(text, idx, sectionId) {
    const base = (text || "")
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
    if (sectionId) {
        return base ? `${sectionId}--${base}` : `${sectionId}--h-${idx}`;
    }
    return base ? `h-${base}` : `h-auto-${idx}`;
}

function ensureHeadingId(h, idx, sectionId) {
    // 保留 HTML 里显式写的 id（如 quota-renewal-edge-cases），避免 TOC/文内
    // #锚点与 ensureHeadingId 生成的 sectionId--slug 不一致导致点击无反应。
    if (h.id) return;
    h.id = headingSlug(h.textContent, idx, sectionId);
}

function scrollToDocAnchor(section, anchorId, smooth) {
    if (!section || !anchorId) return;
    const esc =
        typeof CSS !== "undefined" && CSS.escape
            ? CSS.escape(anchorId)
            : anchorId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    let anchor = section.querySelector('[id="' + esc + '"]');
    if (!anchor) anchor = document.getElementById(anchorId);
    if (!anchor || !section.contains(anchor)) return;
    anchor.scrollIntoView({
        behavior: smooth !== false ? "smooth" : "auto",
        block: "start",
    });
}

function rebuildTocInPageNav(pageId) {
    const body = document.querySelector("aside.toc .toc-body");
    if (!body) return;
    body.querySelectorAll(".toc-inpage").forEach((el) => el.remove());

    const pageLink = body.querySelector('a[href="#' + pageId + '"]');
    const section = document.getElementById(pageId);
    if (!pageLink || !section) return;

    pageLink.classList.remove("toc-has-subnav", "toc-sub-expanded");
    pageLink.removeAttribute("aria-expanded");
    pageLink.querySelectorAll(".toc-link-text, .toc-sub-chevron").forEach((el) => {
        if (el.parentNode === pageLink) el.remove();
    });
    if (pageLink.dataset.tocLabel) {
        pageLink.textContent = pageLink.dataset.tocLabel;
        delete pageLink.dataset.tocLabel;
    }

    const headings = Array.from(section.querySelectorAll("h3"));
    if (!headings.length) return;

    if (!pageLink.dataset.tocLabel) {
        pageLink.dataset.tocLabel = pageLink.textContent.trim();
    }
    const label = pageLink.dataset.tocLabel;
    pageLink.textContent = "";
    const textSpan = document.createElement("span");
    textSpan.className = "toc-link-text";
    textSpan.textContent = label;
    const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chevron.setAttribute("class", "toc-sub-chevron");
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("fill", "none");
    chevron.setAttribute("stroke", "currentColor");
    chevron.setAttribute("stroke-width", "2");
    chevron.setAttribute("stroke-linecap", "round");
    chevron.setAttribute("stroke-linejoin", "round");
    chevron.setAttribute("aria-hidden", "true");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", "6 9 12 15 18 9");
    chevron.appendChild(poly);
    pageLink.appendChild(textSpan);
    pageLink.appendChild(chevron);
    pageLink.classList.add("toc-has-subnav");

    const wrap = document.createElement("div");
    wrap.className = "toc-inpage";
    wrap.setAttribute("aria-label", "在此页面");
    wrap.innerHTML =
        '<div class="toc-inpage__inner">' +
        '<span class="toc-inpage__label">在此页面</span>' +
        '<ul class="toc-inpage__list"></ul>' +
        "</div>";
    const list = wrap.querySelector(".toc-inpage__list");

    headings.forEach((h, hi) => {
        ensureHeadingId(h, hi, pageId);
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#" + h.id;
        a.textContent = h.textContent.trim();
        a.addEventListener("click", (e) => {
            e.preventDefault();
            showDocPage(pageId, { anchorId: h.id });
        });
        li.appendChild(a);
        list.appendChild(li);
        h._tocInpageLink = a;
    });

    pageLink.insertAdjacentElement("afterend", wrap);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setTocSubnavExpanded(pageLink, true);
        });
    });
}

// ─── 5. 分页式文档 + 每页底部 prev/next（Cursor 文档风格） ─────────────
function buildSectionPagerNav(prevSection, nextSection) {
    const nav = document.createElement("nav");
    nav.className = "docs-section-pager";
    nav.setAttribute("aria-label", "章节导航");

    const prev = document.createElement("a");
    prev.className = "docs-section-pager__prev";
    const next = document.createElement("a");
    next.className = "docs-section-pager__next";

    if (prevSection) {
        prev.href = "#" + prevSection.id;
        prev.innerHTML =
            '<span class="docs-section-pager__label">上一节</span>' +
            '<span class="docs-section-pager__title"></span>';
        prev.querySelector(".docs-section-pager__title").textContent =
            getPageTitle(prevSection);
        prev.addEventListener("click", (e) => {
            e.preventDefault();
            showDocPage(prevSection.id);
        });
    } else {
        prev.href = "#";
        prev.setAttribute("aria-disabled", "true");
        prev.innerHTML =
            '<span class="docs-section-pager__label">上一节</span>' +
            '<span class="docs-section-pager__title"></span>';
    }

    if (nextSection) {
        next.href = "#" + nextSection.id;
        next.innerHTML =
            '<span class="docs-section-pager__label">下一节</span>' +
            '<span class="docs-section-pager__title"></span>';
        next.querySelector(".docs-section-pager__title").textContent =
            getPageTitle(nextSection);
        next.addEventListener("click", (e) => {
            e.preventDefault();
            showDocPage(nextSection.id);
        });
    } else {
        next.href = "#";
        next.setAttribute("aria-disabled", "true");
        next.innerHTML =
            '<span class="docs-section-pager__label">下一节</span>' +
            '<span class="docs-section-pager__title"></span>';
    }

    nav.appendChild(prev);
    nav.appendChild(next);
    return nav;
}

DOC_PAGES.forEach((section, idx) => {
    if (section.querySelector(".docs-section-pager")) return;
    section.appendChild(
        buildSectionPagerNav(DOC_PAGES[idx - 1], DOC_PAGES[idx + 1]),
    );
});

let activeDocPageId = "";

function showDocPage(pageId, opts = {}) {
    const id = resolvePageId(pageId);
    const section = document.getElementById(id);
    if (!section || !DOC_MAIN) return;
    activeDocPageId = id;
    DOC_MAIN.classList.add("docs-paginated");
    DOC_PAGES.forEach((s) => {
        const on = s === section;
        s.classList.toggle("is-docs-page-active", on);
        s.toggleAttribute("hidden", !on);
    });
    const globalPager = document.getElementById("docsPager");
    if (globalPager) globalPager.hidden = true;
    setTocActiveForPage(id);
    rebuildOutline();
    const anchorTarget =
        opts.anchorId && opts.anchorId !== id ? opts.anchorId : null;
    const hashTarget = anchorTarget ? "#" + anchorTarget : "#" + id;
    if (!opts.skipHash && location.hash !== hashTarget) {
        history.replaceState(null, "", hashTarget);
    }
    if (anchorTarget) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                scrollToDocAnchor(section, anchorTarget, opts.smooth);
            });
        });
    } else {
        window.scrollTo({
            top: 0,
            behavior: opts.smooth ? "smooth" : "auto",
        });
    }
}

window.addEventListener("hashchange", () => {
    const raw = location.hash.slice(1);
    if (!raw) {
        showDocPage(DOC_PAGES[0] ? DOC_PAGES[0].id : "", { skipHash: true });
        return;
    }
    const pageId = resolvePageId(raw);
    showDocPage(pageId, {
        anchorId: raw !== pageId ? raw : null,
        skipHash: true,
    });
});

const initialHash = location.hash.slice(1);
if (initialHash) {
    const pageId = resolvePageId(initialHash);
    showDocPage(pageId, {
        anchorId: initialHash !== pageId ? initialHash : null,
        skipHash: true,
    });
} else if (DOC_PAGES[0]) {
    showDocPage(DOC_PAGES[0].id);
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
const SEARCH_ANIM_MS = 300;
let activeResultIdx = -1;
let searchCloseTimer = 0;

function isSearchOpen() {
    return (
        searchModal &&
        !searchModal.hidden &&
        searchModal.classList.contains("is-visible")
    );
}

if (searchTrigger) searchTrigger.addEventListener("click", openSearch);
if (searchBackdrop) searchBackdrop.addEventListener("click", closeSearch);
if (searchInput) {
    searchInput.addEventListener("input", () => renderResults(searchInput.value));
    searchInput.addEventListener("keydown", onSearchKeydown);
}
document.addEventListener("keydown", (e) => {
    const open = isSearchOpen();
    const busy =
        searchModal &&
        !searchModal.hidden &&
        searchModal.classList.contains("is-closing");
    // Cmd+K / Ctrl+K 全局唤起（页内任何位置）
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open || busy) closeSearch();
        else openSearch();
        return;
    }
    if ((open || busy) && e.key === "Escape") {
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
    if (searchCloseTimer) {
        clearTimeout(searchCloseTimer);
        searchCloseTimer = 0;
    }
    searchModal.hidden = false;
    searchModal.classList.remove("is-closing");
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            searchModal.classList.add("is-visible");
        });
    });
    queueMicrotask(() => {
        searchInput.value = "";
        searchInput.focus();
        renderResults("");
    });
    document.body.style.overflow = "hidden";
}
function closeSearch() {
    if (!searchModal || searchModal.hidden) return;
    if (searchModal.classList.contains("is-closing")) return;
    if (!searchModal.classList.contains("is-visible")) {
        searchModal.hidden = true;
        return;
    }
    searchModal.classList.add("is-closing");
    activeResultIdx = -1;
    document.body.style.overflow = "";
    if (searchCloseTimer) clearTimeout(searchCloseTimer);
    searchCloseTimer = window.setTimeout(() => {
        searchModal.classList.remove("is-visible", "is-closing");
        searchModal.hidden = true;
        searchCloseTimer = 0;
    }, SEARCH_ANIM_MS);
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
        const pageId = resolvePageId(entry.id);
        showDocPage(pageId, {
            anchorId: entry.id !== pageId ? entry.id : null,
            smooth: true,
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

// ─── 7. 复制 Markdown（此页 / 全部） ───────────────────────────────────────
const copyMdPicker = document.getElementById("docsCopyMdPicker");
const copyMdBtn = document.getElementById("docsCopyMdBtn");
const copyMdMenu = document.getElementById("docsCopyMdMenu");
const COPY_MENU_ANIM_MS = 200;
let copyMdCloseTimer = 0;

function setCopyMdMenuOpen(open) {
    if (!copyMdPicker || !copyMdBtn || !copyMdMenu) return;
    if (copyMdCloseTimer) {
        clearTimeout(copyMdCloseTimer);
        copyMdCloseTimer = 0;
    }
    if (open) {
        copyMdPicker.classList.remove("is-closing");
        copyMdMenu.hidden = false;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                copyMdPicker.classList.add("is-open");
            });
        });
        copyMdBtn.setAttribute("aria-expanded", "true");
        return;
    }
    if (!copyMdPicker.classList.contains("is-open")) {
        copyMdMenu.hidden = true;
        copyMdBtn.setAttribute("aria-expanded", "false");
        return;
    }
    copyMdPicker.classList.remove("is-open");
    copyMdPicker.classList.add("is-closing");
    copyMdBtn.setAttribute("aria-expanded", "false");
    copyMdCloseTimer = window.setTimeout(() => {
        copyMdPicker.classList.remove("is-closing");
        copyMdMenu.hidden = true;
        copyMdCloseTimer = 0;
    }, COPY_MENU_ANIM_MS);
}

function closeCopyMdMenu() {
    setCopyMdMenuOpen(false);
}

async function copyMarkdownScope(scope) {
    if (!copyMdBtn) return;
    const md =
        scope === "all"
            ? serializeAllAsMarkdown()
            : serializePageAsMarkdown();
    try {
        await navigator.clipboard.writeText(md);
        const okText = scope === "all" ? "已复制全部" : "已复制此页";
        flashButton(copyMdBtn, "docsCopyMdLabel", okText, "复制 Markdown");
    } catch {
        flashButton(copyMdBtn, "docsCopyMdLabel", "复制失败", "复制 Markdown");
    }
    closeCopyMdMenu();
}

if (copyMdBtn && copyMdMenu) {
    copyMdBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open =
            copyMdPicker.classList.contains("is-open") &&
            !copyMdPicker.classList.contains("is-closing");
        setCopyMdMenuOpen(!open);
    });
    copyMdMenu.querySelectorAll("[data-copy-scope]").forEach((item) => {
        item.addEventListener("click", async (e) => {
            e.stopPropagation();
            await copyMarkdownScope(item.dataset.copyScope);
        });
    });
    document.addEventListener("click", () => closeCopyMdMenu());
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeCopyMdMenu();
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

function serializePageAsMarkdown() {
    const active = document.querySelector("main > section[id].is-docs-page-active");
    if (!active) return "";
    const md = nodeToMarkdown(active, 0);
    return md ? md.trim() + "\n" : "";
}

function serializeAllAsMarkdown() {
    const out = [];
    document.querySelectorAll("main > section[id]").forEach((section) => {
        const md = nodeToMarkdown(section, 0);
        if (md) out.push(md);
    });
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function nodeToMarkdown(node, depth) {
    if (!node || node.nodeType !== 1) return null;
    if (
        node.classList.contains("docs-toolbar") ||
        node.classList.contains("docs-pager") ||
        node.classList.contains("docs-section-pager")
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

// ─── 10. 文档头图：海报图 → 视频渐变切换 ───────────────────────────────────
(function initDocsIntroMedia() {
    const figure = document.getElementById("docsIntroFigure");
    const video = document.getElementById("docsIntroVideo");
    const poster = document.getElementById("docsIntroPoster");
    if (!figure || !video || !poster) return;

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    let revealed = false;
    const revealVideo = () => {
        if (revealed) return;
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        revealed = true;
        figure.classList.add("is-video-ready");
    };

    const tryPlay = () => {
        revealVideo();
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
            // 自动播放被拦截时仍保留首帧，进入视口后再试
            playPromise.catch(() => {});
        }
    };

    ["loadeddata", "canplay", "canplaythrough", "playing"].forEach((evt) => {
        video.addEventListener(evt, tryPlay);
    });

    if (typeof IntersectionObserver !== "undefined") {
        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) tryPlay();
                });
            },
            { threshold: 0.2 },
        );
        io.observe(figure);
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        tryPlay();
    } else {
        video.load();
    }

    video.addEventListener("error", () => {
        revealed = false;
        figure.classList.remove("is-video-ready");
        video.style.display = "none";
    });
})();
