// api_docs.html 的页面逻辑。2026-05-15 审查后从 inline <script> 抽出，以便
// api_docs.html 的 CSP 删除 'unsafe-inline'。沿用 chat/api/admin-*-app.js
// 同款做法：inline <script> -> 外联 .js + CSP <meta> 删 script-src 'unsafe-inline'。
// 本页原 inline 代码已使用 addEventListener / data-grp data-lang 委托，无 inline onclick。

const $ = (id) => document.getElementById(id);

// Tabbed code blocks
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

// Copy buttons
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

// Active TOC highlight on scroll
const sections = document.querySelectorAll("main section[id]");
const tocLinks = document.querySelectorAll("aside.toc a");
const observer = new IntersectionObserver(
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
sections.forEach((s) => observer.observe(s));
