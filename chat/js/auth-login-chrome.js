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

    document.addEventListener("DOMContentLoaded", function () {
        if (!document.getElementById("authOverlay")) return;
        initAuthThemeFromPrefs();
        initYear();
        createPartnerSlots();
        bindScrollTarget();
        initAuthThemeToggle();
    });
})();
