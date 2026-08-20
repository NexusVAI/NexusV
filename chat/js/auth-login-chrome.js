(function () {
    "use strict";

    var SCROLL_THRESHOLD = 32;
    var PARTNER_DIR = "assets/partners/";
    var UI_PREFS_STORAGE_KEY = "cancri_ui_prefs";

    var PARTNER_MONO_ICONS = {
        "cursor.svg": 1,
        "openai.svg": 1,
        "openai-text.svg": 1,
        "githubcopilot.svg": 1,
        "windsurf.svg": 1,
        "ollama.svg": 1,
        "openrouter.svg": 1,
        "kwaikat.svg": 1,
        "moonshot.svg": 1,
        "github.svg": 1,
    };

    function resolveAuthThemeFromPrefs() {
        try {
            var raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
            if (!raw) return null;
            var prefs = JSON.parse(raw);
            var mode = String(prefs.themeMode || prefs.theme || "system");
            if (mode === "light" || mode === "dark" || mode === "black") return mode;
            if (mode === "system") {
                return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
            }
            return "light";
        } catch (_e) {
            return null;
        }
    }

    function bootstrapAuthThemeEarly() {
        var theme = resolveAuthThemeFromPrefs();
        if (theme) {
            document.documentElement.setAttribute("data-theme", theme);
        }
    }

    bootstrapAuthThemeEarly();

    /* Deploy: assets/partners/*.svg + assets/nexusvai_logo_transparent.svg */
    var PARTNER_LOGOS = [
        { file: "nexusvai_logo_transparent.svg", dir: "assets/" },
        "cursor.svg",
        "openai-text.svg",
        "claude-color.svg",
        "deepseek-color.svg",
        "gemini-color.svg",
        "githubcopilot.svg",
        "windsurf.svg",
        "codex.svg",
        "qwen-color.svg",
        "zhipu-color.svg",
        "moonshot.svg",
        "meta-color.svg",
        "nvidia-color.svg",
        "microsoft-color.svg",
        "mistral-color.svg",
        "ollama.svg",
        "openrouter.svg",
        "trae-color.svg",
        "kwaikat.svg",
        "cherrystudio.svg",
        "doubao-color.svg",
        "stepfun-color.svg",
        "huggingface-color.svg",
        "github.svg",
    ];

    var SLOT_COUNT = 8;
    var ROTATE_MS = 4200;

    function getStaticBase() {
        if (typeof window.__CANCRI_CHAT_STATIC_BASE__ === "string" && window.__CANCRI_CHAT_STATIC_BASE__) {
            var configured = window.__CANCRI_CHAT_STATIC_BASE__;
            return configured.endsWith("/") ? configured : configured + "/";
        }
        var pathname = window.location.pathname || "/";
        if (pathname.endsWith("/")) return pathname;
        var slash = pathname.lastIndexOf("/");
        return slash >= 0 ? pathname.slice(0, slash + 1) : "/";
    }

    function normalizePartnerEntry(entry) {
        if (typeof entry === "string") {
            return { file: entry, dir: PARTNER_DIR };
        }
        return { file: entry.file, dir: entry.dir || PARTNER_DIR };
    }

    function resolvePartnerLogoUrl(entry) {
        var norm = normalizePartnerEntry(entry);
        return new URL(norm.dir + norm.file, window.location.origin + getStaticBase()).href;
    }

    function resolvePartnerLogoFallbackUrl(entry) {
        var norm = normalizePartnerEntry(entry);
        return new URL(norm.file, window.location.origin + getStaticBase()).href;
    }

    function shouldPartnerIconAdapt(entry) {
        var norm = normalizePartnerEntry(entry);
        var iconPath = norm.dir + norm.file;
        if (window.CancriThemeIcons && window.CancriThemeIcons.shouldUseThemeAdaptiveIcon) {
            return window.CancriThemeIcons.shouldUseThemeAdaptiveIcon(iconPath, "");
        }
        return !!PARTNER_MONO_ICONS[norm.file.toLowerCase()];
    }

    function applyPartnerThemeClass(img, entry) {
        if (!img || !img.classList) return;
        img.classList.toggle("model-icon-theme-adaptive", shouldPartnerIconAdapt(entry));
    }

    function rescanPartnerThemeIcons(root) {
        if (window.CancriThemeIcons && window.CancriThemeIcons.scanAll) {
            window.CancriThemeIcons.scanAll(root || document);
            return;
        }
        var scope = root || document;
        scope.querySelectorAll("#authPartnersGrid img[src]").forEach(function (img) {
            var src = img.getAttribute("src") || "";
            var file = src.slice(src.lastIndexOf("/") + 1).split("?")[0].toLowerCase();
            img.classList.toggle("model-icon-theme-adaptive", !!PARTNER_MONO_ICONS[file]);
        });
    }

    function createPartnerLogoImg(entry) {
        var img = document.createElement("img");
        img.alt = "";
        img.width = 120;
        img.height = 48;
        img.loading = "eager";
        img.decoding = "async";
        img.src = resolvePartnerLogoUrl(entry);
        applyPartnerThemeClass(img, entry);
        img.addEventListener("error", function () {
            if (img.dataset.fallbackApplied === "1") return;
            var fallback = resolvePartnerLogoFallbackUrl(entry);
            if (fallback === img.src) return;
            img.dataset.fallbackApplied = "1";
            img.src = fallback;
            applyPartnerThemeClass(img, entry);
        });
        return img;
    }

    function setNavScrolled(scrolled) {
        document.documentElement.classList.toggle("is-auth-nav-scrolled", scrolled);
    }

    function getScrollY() {
        var overlay = document.getElementById("authOverlay");
        if (overlay && overlay.classList.contains("visible")) {
            var style = window.getComputedStyle(overlay);
            if (
                style.position === "fixed" &&
                (style.overflowY === "auto" || style.overflowY === "scroll")
            ) {
                return overlay.scrollTop;
            }
        }
        return window.scrollY || document.documentElement.scrollTop || 0;
    }

    function onAuthScroll() {
        setNavScrolled(getScrollY() > SCROLL_THRESHOLD);
    }

    function initYear() {
        document.querySelectorAll(".auth-site-footer [data-year]").forEach(function (el) {
            el.textContent = String(new Date().getFullYear());
        });
    }

    function createPartnerSlots() {
        var grid = document.getElementById("authPartnersGrid");
        if (!grid || grid.dataset.initialized === "1") return;
        grid.dataset.initialized = "1";

        var groups = [];
        for (var i = 0; i < SLOT_COUNT; i++) {
            groups[i] = [];
        }
        PARTNER_LOGOS.forEach(function (file, index) {
            groups[index % SLOT_COUNT].push(file);
        });

        var rotatingSlots = [];

        groups.forEach(function (logos, slotIndex) {
            if (!logos.length) return;
            var slot = document.createElement("span");
            slot.className = "auth-partner-slot";
            slot.style.setProperty("--slot", String(slotIndex));

            var active = document.createElement("span");
            active.className = "auth-partner-logo is-in";
            active.dataset.index = "0";
            active.appendChild(createPartnerLogoImg(logos[0]));
            slot.appendChild(active);
            slot._logos = logos;
            slot._active = active;
            grid.appendChild(slot);

            if (logos.length > 1) {
                rotatingSlots.push(slot);
            }
        });

        if (rotatingSlots.length > 0) {
            window.setInterval(function () {
                rotatingSlots.forEach(function (slot) {
                    rotatePartnerSlot(slot);
                });
            }, ROTATE_MS);
        }

        rescanPartnerThemeIcons(grid);
    }

    function initAuthThemeFromPrefs() {
        var app = window.CancriApp;
        if (app && typeof app.applyTheme === "function") return;
        var theme = resolveAuthThemeFromPrefs();
        if (theme) {
            document.documentElement.setAttribute("data-theme", theme);
        }
    }

    function rotatePartnerSlot(slot) {
        if (!slot._logos || slot._logos.length < 2 || slot._animating) return;
        slot._animating = true;

        var currentIndex = Number(slot._active.dataset.index || "0");
        var nextIndex = (currentIndex + 1) % slot._logos.length;
        var outgoing = slot._active;

        outgoing.classList.remove("is-in");
        outgoing.classList.add("is-out");

        var incoming = document.createElement("span");
        incoming.className = "auth-partner-logo is-in";
        incoming.dataset.index = String(nextIndex);
        incoming.appendChild(createPartnerLogoImg(slot._logos[nextIndex]));
        slot.appendChild(incoming);
        slot._active = incoming;

        window.setTimeout(function () {
            if (outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);
            slot._animating = false;
        }, 560);
    }

    function bindScrollTarget() {
        var overlay = document.getElementById("authOverlay");
        if (!overlay) return;

        onAuthScroll();
        window.addEventListener("scroll", onAuthScroll, { passive: true });
        overlay.addEventListener("scroll", onAuthScroll, { passive: true });
    }

    function initAuthThemeToggle() {
        var btn = document.getElementById("authThemeToggle");
        if (!btn || btn.dataset.authChromeBound === "1") return;
        if (document.querySelector('script[src*="claude_ui.js"]')) return;
        btn.dataset.authChromeBound = "1";

        function getEffectiveTheme() {
            var theme = document.documentElement.getAttribute("data-theme");
            if (theme === "light") return "light";
            if (theme === "dark" || theme === "black") return "dark";
            return "light";
        }

        function syncIcon() {
            var isDark = getEffectiveTheme() === "dark";
            btn.setAttribute("aria-label", isDark ? "切换到浅色模式" : "切换到深色模式");
            btn.setAttribute("title", isDark ? "切换到浅色模式" : "切换到深色模式");
        }

        function persistTheme(theme) {
            try {
                var raw = localStorage.getItem(UI_PREFS_STORAGE_KEY);
                var prefs = raw ? JSON.parse(raw) : {};
                prefs.theme = theme;
                prefs.themeMode = theme;
                localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
            } catch (_e) {}
        }

        function applyTheme(next) {
            var app = window.CancriApp;
            if (app && app.state) app.state.theme = next;
            if (app && typeof app.applyTheme === "function") {
                app.applyTheme();
            } else {
                document.documentElement.setAttribute("data-theme", next);
                persistTheme(next);
            }
            rescanPartnerThemeIcons(document.getElementById("authPartnersGrid"));
            syncIcon();
        }

        btn.addEventListener("click", function (e) {
            e.preventDefault();
            applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
        });

        if (typeof MutationObserver !== "undefined") {
            new MutationObserver(syncIcon).observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-theme"],
            });
        }
        syncIcon();
    }

    var PLAN_CONTENT = [
        ["Go", "轻装上阵 Cancri", "¥9.9/月", "每月 ¥15 套餐额度", "包含内容", [
            "每月 ¥15 套餐额度（套餐内按模型定价 ×1.6 计扣）",
            "Chat 网页对话 + Cancri Code IDE 双端通用",
            "全模型开放，按统一模型定价计费",
            "深度思考与长上下文任务支持",
            "套餐额度仅用于 Chat / IDE，与 API 额度互相独立",
        ]],
        ["Plus", "主力之选：研究、编码、创作", "¥19/月", "每月 ¥45 套餐额度", "包含 Go 全部内容，另有：", [
            "每月 ¥45 套餐额度（套餐内按模型定价 ×2.4 计扣）",
            "约 100 次/月重度长上下文请求",
            "IDE 与 Chat 共享同一额度池",
            "更高用量与并发限额",
            "优先接入更多前沿模型",
            "套餐额度独立计费，与 API 额度完全隔离",
        ]],
        ["Pro", "更高额度，专属权益", "¥99/月", "每月 ¥300 套餐额度", "包含 Plus 全部内容，另有：", [
            "每月 ¥300 套餐额度（套餐内按模型定价 ×3.2 计扣）*",
            "大额月度额度，畅享全部旗舰模型",
            "限速档保底 Tier 3：更高并发与 RPM",
            "高峰时段优先路由",
            "新功能与新模型抢先体验",
        ]],
    ];

    var FAQ_CONTENT = {
        "Cancri 是什么，它是如何工作的？": [
            "Cancri 是 NexusVAI 构建的 AI 对话平台，让你在同一个界面中使用多种领先模型。选择适合任务的模型并输入问题后，Cancri 会将请求安全地发送到对应模型线路，再把结果呈现在当前对话中。",
            "不同模型在推理、写作、编程、图像理解和上下文长度方面各有侧重，你可以随任务切换模型，而不必反复更换工具。",
        ],
        "Cancri 可以帮我做哪些事？": [
            "你可以用 Cancri 整理资料、总结长文、翻译与润色、构思内容、分析问题、编写和调试代码，也可以借助支持多模态的模型理解图片或完成创意任务。",
            "模型能力和可用上下文各不相同。重要结论、专业建议和可能影响现实决策的内容，请结合可靠来源再次核验。",
        ],
        "使用 Cancri 需要多少费用？": [
            "个人月度套餐为 Go ¥9.9/月、Plus ¥19/月、Pro ¥99/月，分别包含 ¥15、¥45、¥300 的 Chat / IDE 套餐额度。额度会按照所选模型的统一定价和对应套餐扣费倍率消耗。",
            "Chat / IDE 套餐额度与 API 额度相互独立，API 使用需单独按量充值。套餐按月计费、可随时取消，具体权益与使用限制以订阅页面为准。",
        ],
    };

    var FOOTER_COLUMNS = [
        ["产品", [
            ["SentienceV5.2 Mens", "https://www.nexusvai.xyz/article.html?id=sentienceV52mens"],
            ["SentienceV4.1 Omni", "https://www.nexusvai.xyz/article.html?id=sentienceV4ob"],
            ["Sentience V4C", "https://www.nexusvai.xyz/article.html?id=sentienceV4C"],
            ["NexusV V5", "https://www.nexusvai.xyz/article.html?id=nexusv5"],
            ["NexusV V4", "https://www.nexusvai.xyz/article.html?id=n3"],
            ["CancriV1-0.1B", "https://www.nexusvai.xyz/article.html?id=cancriV1_0_1b"],
            ["CancriV2-0.5B", "https://www.modelscope.cn/models/guxingyu88730882/CancriV2-0.5B-Chat"],
            ["TACTFR 6.0.0 Beta.2.9", "https://www.wanjiadongli.com/mods/292895"],
            ["TACTFR 6.0.0 Beta.2.8", "https://www.nexusvai.xyz/article.html?id=tactfr628"],
            ["TACTFR 6.0.0 Beta.2.7", "https://www.nexusvai.xyz/article.html?id=tactfr627"],
            ["TACTFR 6.0.0 Beta.2", "https://www.nexusvai.xyz/article.html?id=tactfr600"],
            ["TACTFR V4", "https://www.nexusvai.xyz/article.html?id=n4"],
            ["Cancri Code", "https://nexusvai.xyz/cancricode"],
        ], "cancri-footer-products"],
        ["友情链接", [["玩家动力", "https://www.wanjiadongli.com/"], ["Agnes", "https://agnes-ai.com/"]], ""],
        ["资源", [["NexusV", "https://www.nexusvai.xyz/"], ["NexusVAI", "https://www.nexusvai.xyz/chat/api/"]], ""],
    ];

    function findLeafByText(root, pattern) {
        return Array.from(root.querySelectorAll("div")).find(function (element) {
            return element.children.length === 0 && pattern.test(element.textContent.trim());
        });
    }

    function applyPlanContent(doc) {
        PLAN_CONTENT.forEach(function (plan) {
            var heading = Array.from(doc.querySelectorAll("h3")).find(function (element) {
                return element.textContent.trim() === plan[0];
            });
            var card = heading && heading.closest('[class*="rounded-3xl"]');
            if (!card) return;
            var tagline = heading.parentElement && heading.parentElement.querySelector("p");
            var price = findLeafByText(card, /^¥[\d.]+\/月$/);
            var quota = findLeafByText(card, /^每月 ¥[\d.]+ 套餐额度$/);
            var includes = findLeafByText(card, /^包含(?:内容| Go| Plus)/);
            if (tagline) tagline.textContent = plan[1];
            if (price) price.textContent = plan[2];
            if (quota) quota.textContent = plan[3];
            if (includes) includes.textContent = plan[4];
            var list = card.querySelector('ul[role="list"]');
            var sample = list && list.querySelector("li");
            if (!list || !sample) return;
            list.replaceChildren.apply(list, plan[5].map(function (benefit) {
                var item = sample.cloneNode(true);
                var text = item.querySelector("div");
                if (text) text.textContent = benefit;
                return item;
            }));
        });
    }

    function setFaqState(entry, open) {
        [entry.item, entry.header, entry.button, entry.panel].forEach(function (element) {
            if (element) element.dataset.state = open ? "open" : "closed";
        });
        entry.button.setAttribute("aria-expanded", String(open));
    }

    function cancelFaqAnimation(entry) {
        if (!entry.animation) return;
        entry.animation.cancel();
        entry.animation = null;
    }

    function closeFaq(entry, reducedMotion) {
        if (entry.panel.hidden) {
            setFaqState(entry, false);
            return;
        }
        cancelFaqAnimation(entry);
        var height = entry.panel.getBoundingClientRect().height || entry.panel.scrollHeight;
        setFaqState(entry, false);
        entry.panel.style.height = "0px";
        entry.panel.style.opacity = "0";
        if (reducedMotion || typeof entry.panel.animate !== "function") {
            entry.panel.hidden = true;
            return;
        }
        var animation = entry.panel.animate([
            { height: height + "px", opacity: 1 },
            { height: "0px", opacity: 0 },
        ], { duration: 180, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
        entry.animation = animation;
        animation.finished.then(function () {
            if (entry.animation !== animation || entry.button.getAttribute("aria-expanded") !== "false") return;
            entry.panel.hidden = true;
            entry.animation = null;
        }).catch(function () {});
    }

    function openFaq(entry, entries, reducedMotion) {
        entries.forEach(function (candidate) {
            if (candidate !== entry) closeFaq(candidate, reducedMotion);
        });
        cancelFaqAnimation(entry);
        entry.panel.hidden = false;
        entry.panel.style.height = "auto";
        entry.panel.style.opacity = "1";
        var height = entry.panel.scrollHeight;
        entry.panel.style.setProperty("--radix-accordion-content-height", height + "px");
        setFaqState(entry, true);
        if (reducedMotion || typeof entry.panel.animate !== "function") return;
        entry.panel.style.height = height + "px";
        var animation = entry.panel.animate([
            { height: "0px", opacity: 0 },
            { height: height + "px", opacity: 1 },
        ], { duration: 200, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
        entry.animation = animation;
        animation.finished.then(function () {
            if (entry.animation !== animation || entry.button.getAttribute("aria-expanded") !== "true") return;
            entry.panel.style.height = "auto";
            entry.animation = null;
        }).catch(function () {});
    }

    function applyFaqContent(doc) {
        var entries = Array.from(doc.querySelectorAll("#faq button[aria-controls]")).map(function (button) {
            var panel = doc.getElementById(button.getAttribute("aria-controls"));
            var paragraphs = FAQ_CONTENT[button.textContent.trim()];
            if (!panel || !paragraphs) return null;
            var answer = doc.createElement("div");
            answer.className = "cancri-faq-answer text-secondary text-sm sm:text-base";
            paragraphs.forEach(function (paragraph) {
                var text = doc.createElement("p");
                text.textContent = paragraph;
                answer.append(text);
            });
            if (button.textContent.trim() === "使用 Cancri 需要多少费用？") {
                var link = doc.createElement("a");
                link.href = "./pricing.html";
                link.target = "_top";
                link.textContent = "查看套餐与额度说明";
                answer.append(link);
            }
            panel.replaceChildren(answer);
            panel.classList.remove("sf-hidden");
            panel.hidden = true;
            panel.style.height = "0px";
            panel.style.opacity = "0";
            var entry = {
                button: button,
                panel: panel,
                item: button.closest(".AccordionItem"),
                header: button.closest(".AccordionHeader"),
                animation: null,
            };
            setFaqState(entry, false);
            return entry;
        }).filter(Boolean);
        entries.forEach(function (entry) {
            entry.button.addEventListener("click", function () {
                var reducedMotion = !!(doc.defaultView && doc.defaultView.matchMedia("(prefers-reduced-motion: reduce)").matches);
                if (entry.button.getAttribute("aria-expanded") === "true") closeFaq(entry, reducedMotion);
                else openFaq(entry, entries, reducedMotion);
            });
        });
    }

    function createFooterColumn(doc, column) {
        var wrapper = doc.createElement("div");
        wrapper.className = column[2];
        var heading = doc.createElement("h4");
        heading.className = "text-primary font-semibold mb-4 text-sm uppercase tracking-wide";
        heading.textContent = column[0];
        var list = doc.createElement("ul");
        list.className = "cancri-footer-list text-sm text-secondary";
        column[1].forEach(function (entry) {
            var item = doc.createElement("li");
            var link = doc.createElement("a");
            link.href = entry[1];
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.className = "inline-block py-1 hover:text-primary transition-colors";
            link.textContent = entry[0];
            item.append(link);
            list.append(item);
        });
        wrapper.append(heading, list);
        return wrapper;
    }

    function applyFooterContent(doc) {
        var footer = doc.querySelector("footer");
        if (!footer) return;
        var brand = footer.querySelector('a[aria-label*="Cancri"]');
        if (brand) {
            brand.classList.add("cancri-footer-brand");
            brand.style.columnGap = "0.875rem";
        }
        var firstHeading = footer.querySelector("h4");
        var columns = firstHeading && firstHeading.parentElement && firstHeading.parentElement.parentElement;
        if (columns) {
            columns.className = "md:col-span-8 cancri-footer-links";
            columns.replaceChildren.apply(columns, FOOTER_COLUMNS.map(function (column) {
                return createFooterColumn(doc, column);
            }));
        }
        var socials = footer.querySelector('nav[aria-label="社交链接"]');
        if (!socials) return;
        var existing = {};
        Array.from(socials.querySelectorAll("a[aria-label]")).forEach(function (link) {
            existing[link.getAttribute("aria-label")] = link;
        });
        var discord = doc.createElement("a");
        discord.href = "https://discord.gg/fAfvyhjHJP";
        discord.target = "_blank";
        discord.rel = "noopener noreferrer";
        discord.setAttribute("aria-label", "Discord");
        discord.title = "Discord";
        discord.className = "text-primary hover:text-accent transition-colors";
        discord.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.2252 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"></path></svg>';
        socials.replaceChildren(existing.X, discord, existing.GitHub, existing.HuggingFace, existing.Bilibili);
    }

    function applyExperienceStyles(doc) {
        if (doc.getElementById("cancri-auth-experience-styles")) return;
        var style = doc.createElement("style");
        style.id = "cancri-auth-experience-styles";
        style.textContent = '#faq [role="region"]{overflow:hidden}#faq .cancri-faq-answer{padding:1rem 0 1.5rem;line-height:1.75;color:var(--cds-text-muted)}#faq .cancri-faq-answer p{margin:0}#faq .cancri-faq-answer p+p{margin-top:.75rem}#faq .cancri-faq-answer a{display:inline-block;margin-top:.75rem;color:var(--cds-text-primary)}.cancri-footer-brand{column-gap:.875rem!important}.cancri-footer-links{display:grid;grid-template-columns:minmax(0,2fr) repeat(2,minmax(9rem,1fr));gap:2rem}.cancri-footer-list{display:flex;flex-direction:column;gap:.5rem;list-style:none;margin:0;padding:0}.cancri-footer-products .cancri-footer-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:1.5rem}.cancri-footer-links a{overflow-wrap:anywhere}@media(max-width:56rem){.cancri-footer-links{grid-template-columns:repeat(2,minmax(0,1fr))}.cancri-footer-products{grid-column:1/-1}}@media(max-width:36rem){.cancri-footer-links,.cancri-footer-products .cancri-footer-list{grid-template-columns:1fr}.cancri-footer-products{grid-column:auto}}';
        doc.head.append(style);
    }

    function customizeLoginDocument(doc) {
        if (!doc || !doc.documentElement || !doc.getElementById("faq")) return false;
        if (doc.documentElement.dataset.cancriLoginExperience === "20260820") return true;
        applyExperienceStyles(doc);
        applyPlanContent(doc);
        applyFaqContent(doc);
        applyFooterContent(doc);
        doc.documentElement.dataset.cancriLoginExperience = "20260820";
        return true;
    }

    function localizeAuthError(err, fallback) {
        if (!err) return fallback || "操作失败，请稍后重试。";
        var raw = String(err.message || err.error_description || "").trim();
        if (raw && /[\u4e00-\u9fa5]/.test(raw)) return raw;
        var code = String(err.code || err.error_code || "").trim();
        var status = Number(err.status) || 0;
        var messages = {
            over_email_send_rate_limit: "邮件发送过于频繁，请几分钟后再试。",
            over_request_rate_limit: "请求过于频繁，请稍后再试。",
            email_address_invalid: "邮箱地址无效，请检查后重试。",
            email_address_not_authorized: "该邮箱不在允许列表内。",
            email_provider_disabled: "邮箱登录暂时关闭。",
            captcha_failed: "人机验证未通过，请刷新页面后重试。",
            otp_expired: "验证码已过期，请重新获取。",
            otp_disabled: "验证码登录暂未开放。",
            invalid_credentials: "验证码错误，请检查后重试。",
            signup_disabled: "注册已暂停。",
            user_banned: "该账号已被封禁。",
            user_not_found: "账号不存在，请检查邮箱后重试。",
            request_timeout: "请求超时，请稍后再试。",
        };
        if (code && messages[code]) return messages[code];
        if (status === 429) return "请求过于频繁，请稍后再试。";
        if (status === 422 || status === 400) return "请求参数有误，请检查后重试。";
        if (status === 401 || status === 403) return "登录验证未通过，请稍后再试。";
        if (status >= 500) return "邮件服务暂时不可用，请稍后再试。";
        return fallback || "操作失败，请稍后重试。";
    }

    function validateCancriEmail(email) {
        var normalized = String(email || "").trim().toLowerCase();
        if (!normalized || !normalized.includes("@")) {
            return { ok: false, message: "请输入有效的邮箱地址" };
        }
        if (!/@qq\.com$/.test(normalized) && !/@foxmail\.com$/.test(normalized)) {
            return { ok: false, message: "仅支持 @qq.com 和 @foxmail.com 邮箱" };
        }
        return {
            ok: true,
            email: normalized,
            shouldCreateUser: /^[0-9]+@qq\.com$/.test(normalized),
        };
    }

    function createAuthFlow(options) {
        options = options || {};
        var refs = null;
        var bound = false;
        var sending = false;
        var verifying = false;

        function setBusy(button, busy) {
            if (!button) return;
            button.disabled = !!busy;
            if (busy) button.setAttribute("aria-busy", "true");
            else button.removeAttribute("aria-busy");
        }

        function setError(message) {
            if (!refs) return;
            refs.emailError.textContent = "";
            refs.otpError.textContent = "";
            var target = refs.otpStep.hidden ? refs.emailError : refs.otpError;
            target.textContent = message || "";
        }

        function showEmailStep() {
            if (!refs) return;
            refs.emailStep.hidden = false;
            refs.otpStep.hidden = true;
            refs.codeInput.value = "";
            setError("");
        }

        function showOtpStep(email) {
            refs.emailStep.hidden = true;
            refs.otpStep.hidden = false;
            refs.emailLabel.textContent = email;
            refs.codeInput.value = "";
            refs.codeInput.focus();
        }

        function getClient() {
            return typeof options.getClient === "function" ? options.getClient() : options.client;
        }

        async function sendOtp() {
            if (!refs || sending) return false;
            var validation = (options.validateEmail || validateCancriEmail)(refs.emailInput.value);
            if (!validation || !validation.ok) {
                setError((validation && validation.message) || "请输入有效的邮箱地址");
                return false;
            }
            sending = true;
            setBusy(refs.sendButton, true);
            setBusy(refs.resendButton, true);
            setError("");
            try {
                var captchaToken = typeof options.getCaptchaToken === "function"
                    ? await options.getCaptchaToken()
                    : "";
                var authOptions = { shouldCreateUser: !!validation.shouldCreateUser };
                if (captchaToken) authOptions.captchaToken = captchaToken;
                var timeout = new Promise(function (_, reject) {
                    setTimeout(function () {
                        var error = new Error("发送超时，请检查网络后重试");
                        error.code = "request_timeout";
                        reject(error);
                    }, Number(options.timeoutMs) || 12000);
                });
                var result = await Promise.race([
                    getClient().auth.signInWithOtp({ email: validation.email, options: authOptions }),
                    timeout,
                ]);
                if (result && result.error) throw result.error;
                showOtpStep(validation.email);
                if (typeof options.onOtpSent === "function") {
                    await options.onOtpSent(validation.email);
                }
                return true;
            } catch (err) {
                var code = String((err && (err.code || err.error_code)) || "");
                if (!validation.shouldCreateUser && code === "otp_disabled") {
                    setError("新账号仅支持 QQ 号邮箱注册（纯数字，如 3573799137@qq.com）。若你已注册过，请检查邮箱是否输错。");
                } else {
                    setError(localizeAuthError(err, "发送失败，请重试。"));
                }
                return false;
            } finally {
                sending = false;
                setBusy(refs.sendButton, false);
                setBusy(refs.resendButton, false);
            }
        }

        async function verifyOtp() {
            if (!refs || verifying) return false;
            var code = refs.codeInput.value.trim();
            if (!code || code.length < 6) {
                setError("请输入完整的验证码");
                return false;
            }
            verifying = true;
            setBusy(refs.verifyButton, true);
            setError("");
            try {
                var result = await getClient().auth.verifyOtp({
                    email: refs.emailInput.value.trim().toLowerCase(),
                    token: code,
                    type: "email",
                });
                if (result && result.error) throw result.error;
                var session = result && result.data && result.data.session;
                if (!session || !session.access_token) throw new Error("验证失败，请重试。");
                if (typeof options.onSession === "function") await options.onSession(session);
                return true;
            } catch (err) {
                setError(localizeAuthError(err, "验证失败，请重试。"));
                return false;
            } finally {
                verifying = false;
                setBusy(refs.verifyButton, false);
            }
        }

        function bind() {
            if (bound) return true;
            var doc = typeof options.getDocument === "function" ? options.getDocument() : document;
            var emailForm = doc && doc.getElementById("authEmailForm");
            var otpForm = doc && doc.getElementById("authOtpForm");
            refs = doc && {
                emailForm: emailForm,
                otpForm: otpForm,
                emailStep: doc.getElementById("authStepEmail"),
                otpStep: doc.getElementById("authStepOtp"),
                emailInput: doc.getElementById("authEmailInput"),
                codeInput: doc.getElementById("authPasswordInput"),
                emailLabel: doc.getElementById("authOtpEmailLabel"),
                sendButton: doc.getElementById("authSendOtpBtn"),
                verifyButton: doc.getElementById("authVerifyOtpBtn"),
                resendButton: doc.getElementById("authResendOtpBtn"),
                changeEmailButton: doc.getElementById("authChangeEmailBtn"),
                emailError: doc.getElementById("authEmailError"),
                otpError: doc.getElementById("authOtpError"),
            };
            if (!refs || !emailForm || !otpForm || !refs.emailStep || !refs.otpStep ||
                !refs.emailInput || !refs.codeInput || !refs.emailLabel || !refs.sendButton ||
                !refs.verifyButton || !refs.resendButton || !refs.changeEmailButton ||
                !refs.emailError || !refs.otpError) {
                refs = null;
                return false;
            }
            if (emailForm.dataset.cancriAuthFlowBound === "1") return false;
            emailForm.dataset.cancriAuthFlowBound = "1";
            refs.sendButton.addEventListener("click", function () { void sendOtp(); });
            refs.verifyButton.addEventListener("click", function () { void verifyOtp(); });
            refs.resendButton.addEventListener("click", function () { void sendOtp(); });
            refs.changeEmailButton.addEventListener("click", function () {
                showEmailStep();
                refs.emailInput.focus();
            });
            emailForm.addEventListener("submit", function (event) {
                event.preventDefault();
                void sendOtp();
            });
            otpForm.addEventListener("submit", function (event) {
                event.preventDefault();
                void verifyOtp();
            });
            refs.emailInput.addEventListener("keydown", function (event) {
                if (event.isComposing || event.key !== "Enter") return;
                event.preventDefault();
                void sendOtp();
            });
            refs.codeInput.addEventListener("keydown", function (event) {
                if (event.isComposing || event.key !== "Enter") return;
                event.preventDefault();
                void verifyOtp();
            });
            bound = true;
            showEmailStep();
            return true;
        }

        return {
            bind: bind,
            reset: showEmailStep,
            showEmailStep: showEmailStep,
            showOtpStep: showOtpStep,
            setError: setError,
            sendOtp: sendOtp,
            verifyOtp: verifyOtp,
            isBound: function () { return bound; },
        };
    }

    function bindAuthFrameExperience() {
        var frame = document.getElementById("authLoginFrame");
        if (!frame) return;
        var sync = function () {
            try {
                customizeLoginDocument(frame.contentDocument);
            } catch (_e) {}
        };
        frame.addEventListener("load", sync);
        sync();
    }

    window.CancriAuthChrome = { customizeLoginDocument: customizeLoginDocument };
    window.CancriAuthFlow = {
        create: createAuthFlow,
        localizeError: localizeAuthError,
        validateEmail: validateCancriEmail,
    };
    window.dispatchEvent(new CustomEvent("cancri:auth-flow-ready"));

    document.addEventListener("DOMContentLoaded", function () {
        if (!document.getElementById("authOverlay")) return;
        initAuthThemeFromPrefs();
        initYear();
        createPartnerSlots();
        bindScrollTarget();
        initAuthThemeToggle();
        bindAuthFrameExperience();
    });
})();
