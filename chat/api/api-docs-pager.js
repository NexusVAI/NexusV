// NexusVAI API 文档 — 侧边栏分页（Cursor / OpenAI 文档式）
// 每个 .prose > section[id] 是一页；hash 切换页，只显示当前页内容。
(function () {
    const pages = Array.from(
        document.querySelectorAll(".prose > section[id]"),
    );
    if (!pages.length) return;

    const pageById = new Map(pages.map((p) => [p.id, p]));
    const PAGE_IDS = [];
    document
        .querySelectorAll('nav.cnc-sidebar a[href*="#"]')
        .forEach((a) => {
            const href = a.getAttribute("href") || "";
            const id = href.includes("#") ? href.split("#")[1] : "";
            if (id && pageById.has(id) && !PAGE_IDS.includes(id)) {
                PAGE_IDS.push(id);
            }
        });
    pages.forEach((p) => {
        if (!PAGE_IDS.includes(p.id)) PAGE_IDS.push(p.id);
    });
    const pagesOrdered = PAGE_IDS.map((id) => pageById.get(id)).filter(Boolean);

    function resolvePageId(anyId) {
        if (!anyId) return PAGE_IDS[0] || "intro";
        const el = document.getElementById(anyId);
        if (!el) return PAGE_IDS[0] || "intro";
        if (pages.includes(el)) return el.id;
        for (const p of pages) {
            if (p.contains(el)) return p.id;
        }
        return PAGE_IDS[0] || "intro";
    }

    function sidebarLabel(sectionId) {
        const a = document.querySelector(
            'nav.cnc-sidebar a[href$="#' + sectionId + '"]',
        );
        if (!a) return "";
        const label = a.querySelector(".line-clamp-2");
        return (label ? label.textContent : a.textContent).trim();
    }

    function pageTitle(section) {
        if (!section) return "";
        const fromSidebar = sidebarLabel(section.id);
        if (fromSidebar) return fromSidebar;
        const h =
            section.querySelector(":scope > h2") ||
            section.querySelector("h2") ||
            section.querySelector("h1");
        return h ? h.textContent.trim() : section.id;
    }

    function setSidebarActive(pageId) {
        document
            .querySelectorAll("nav.cnc-sidebar a[href]")
            .forEach((a) => {
                const href = a.getAttribute("href") || "";
                const ha = href.includes("#") ? href.split("#")[1] : "";
                a.classList.toggle(
                    "bg-primary-ghost-active",
                    ha === pageId,
                );
            });
    }

    function buildPager(prevSec, nextSec) {
        const nav = document.createElement("nav");
        nav.className = "cnc-doc-pager";
        nav.setAttribute("aria-label", "章节导航");

        const prev = document.createElement("a");
        prev.className = "cnc-doc-pager__link cnc-doc-pager__prev";
        const next = document.createElement("a");
        next.className = "cnc-doc-pager__link cnc-doc-pager__next";

        if (prevSec) {
            prev.href = "#" + prevSec.id;
            prev.innerHTML =
                '<span class="cnc-doc-pager__label">上一页</span>' +
                '<span class="cnc-doc-pager__title"></span>';
            prev.querySelector(".cnc-doc-pager__title").textContent =
                pageTitle(prevSec);
            prev.addEventListener("click", (e) => {
                e.preventDefault();
                showPage(prevSec.id);
            });
            nav.appendChild(prev);
        }

        if (nextSec) {
            next.href = "#" + nextSec.id;
            next.innerHTML =
                '<span class="cnc-doc-pager__label">下一页</span>' +
                '<span class="cnc-doc-pager__title"></span>';
            next.querySelector(".cnc-doc-pager__title").textContent =
                pageTitle(nextSec);
            next.addEventListener("click", (e) => {
                e.preventDefault();
                showPage(nextSec.id);
            });
            nav.appendChild(next);
        }

        if (!prevSec && nextSec) nav.classList.add("cnc-doc-pager--first");
        if (prevSec && !nextSec) nav.classList.add("cnc-doc-pager--last");
        return nav;
    }

    pagesOrdered.forEach((section, idx) => {
        if (section.querySelector(".cnc-doc-pager")) return;
        section.appendChild(
            buildPager(pagesOrdered[idx - 1], pagesOrdered[idx + 1]),
        );
    });

    function scrollToAnchor(section, anchorId) {
        if (!section || !anchorId || anchorId === section.id) return;
        const el = document.getElementById(anchorId);
        if (el && section.contains(el)) {
            el.scrollIntoView({ behavior: "auto", block: "start" });
        }
    }

    function showPage(pageId, opts) {
        opts = opts || {};
        const id = resolvePageId(pageId);
        const section = document.getElementById(id);
        if (!section) return;

        document.body.classList.add("cnc-docs-paginated");
        pages.forEach((p) => {
            p.classList.toggle("cnc-doc-active", p === section);
            p.removeAttribute("hidden");
        });

        setSidebarActive(id);

        const anchorId =
            opts.anchorId ||
            (pageId && pageId !== id ? pageId : null);

        if (!opts.skipHash) {
            const hash = anchorId ? "#" + anchorId : "#" + id;
            if (location.hash !== hash) {
                history.replaceState(null, "", hash);
            }
        }

        if (anchorId && anchorId !== id) {
            requestAnimationFrame(() =>
                scrollToAnchor(section, anchorId),
            );
        } else {
            window.scrollTo({ top: 0, behavior: "auto" });
        }
    }

    document
        .querySelectorAll(
            'nav.cnc-sidebar a[href*="#"], .prose a[href*="#"]',
        )
        .forEach((a) => {
            a.addEventListener("click", (e) => {
                const href = a.getAttribute("href");
                if (!href || !href.includes("#")) return;
                const hash = href.split("#").pop();
                if (!hash || !document.getElementById(hash)) return;
                e.preventDefault();
                const pageId = resolvePageId(hash);
                showPage(pageId, {
                    anchorId: hash !== pageId ? hash : null,
                });
            });
        });

    window.addEventListener("hashchange", () => {
        const raw = location.hash.slice(1);
        if (!raw) {
            showPage(PAGE_IDS[0], { skipHash: true });
            return;
        }
        const pageId = resolvePageId(raw);
        showPage(pageId, {
            skipHash: true,
            anchorId: raw !== pageId ? raw : null,
        });
    });

    const initial = location.hash.slice(1);
    if (initial) {
        const pageId = resolvePageId(initial);
        showPage(pageId, {
            skipHash: true,
            anchorId: initial !== pageId ? initial : null,
        });
    } else {
        showPage(PAGE_IDS[0]);
    }

    (function initMobileDrawer() {
        const drawer = document.getElementById("drawer");
        const sidebar = document.querySelector("nav.cnc-sidebar");
        const panel = drawer?.querySelector("[data-mobile-nav-panels]");
        if (!drawer || !sidebar || !panel) return;

        const tabBar = drawer.querySelector('[role="tablist"]')?.closest(".px-6");
        if (tabBar) tabBar.style.display = "none";

        panel.innerHTML = "";
        panel.className =
            "flex-1 w-full overflow-y-auto px-4 py-4 flex flex-col gap-2";

        const clone = sidebar.cloneNode(true);
        clone.classList.add("cnc-sidebar--mobile");
        clone.querySelectorAll("a[href]").forEach((a) => {
            a.addEventListener("click", () => {
                drawer.classList.remove("translate-x-0");
                drawer.classList.add("translate-x-full");
            });
        });
        panel.appendChild(clone);
    })();
})();
