(function () {
    "use strict";

    var SCROLL_THRESHOLD = 32;
    var PARTNER_DIR = "assets/partners/";

    /* Deploy: upload GitHub/chat/assets/partners/ (24 SVGs) with the site. */
    var PARTNER_LOGOS = [
        "cursor.svg",
        "openai.svg",
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

    function resolvePartnerLogoUrl(file) {
        return new URL(PARTNER_DIR + file, window.location.origin + getStaticBase()).href;
    }

    function resolvePartnerLogoFallbackUrl(file) {
        return new URL(file, window.location.origin + getStaticBase()).href;
    }

    function createPartnerLogoImg(file) {
        var img = document.createElement("img");
        img.alt = "";
        img.width = 120;
        img.height = 48;
        img.loading = "eager";
        img.decoding = "async";
        img.src = resolvePartnerLogoUrl(file);
        img.addEventListener("error", function () {
            if (img.dataset.fallbackApplied === "1") return;
            var fallback = resolvePartnerLogoFallbackUrl(file);
            if (fallback === img.src) return;
            img.dataset.fallbackApplied = "1";
            img.src = fallback;
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

    function initBrandWord() {
        document.querySelectorAll("[data-cancri-brand] .cancri-brand__word-wrap").forEach(function (el) {
            el.classList.add("is-in");
        });
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
                window.setInterval(function () {
                    rotatePartnerSlot(slot);
                }, ROTATE_MS + slotIndex * 180);
            }
        });
    }

    function rotatePartnerSlot(slot) {
        if (!slot._logos || slot._logos.length < 2 || slot._active._animating) return;
        slot._active._animating = true;

        var currentIndex = Number(slot._active.dataset.index || "0");
        var nextIndex = (currentIndex + 1) % slot._logos.length;
        var outgoing = slot._active;

        outgoing.classList.remove("is-in");
        outgoing.classList.add("is-out");

        window.setTimeout(function () {
            if (outgoing.parentNode) outgoing.parentNode.removeChild(outgoing);

            var incoming = document.createElement("span");
            incoming.className = "auth-partner-logo is-in";
            incoming.dataset.index = String(nextIndex);
            incoming.appendChild(createPartnerLogoImg(slot._logos[nextIndex]));
            slot.appendChild(incoming);
            slot._active = incoming;

            window.setTimeout(function () {
                incoming._animating = false;
            }, 560);
        }, 520);
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

        var STORAGE_KEY = "cancri_ui_prefs";

        function getCurrentTheme() {
            return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        }

        function syncIcon() {
            var isDark = getCurrentTheme() === "dark";
            btn.setAttribute("aria-label", isDark ? "切换到浅色模式" : "切换到深色模式");
            btn.setAttribute("title", isDark ? "切换到浅色模式" : "切换到深色模式");
        }

        function persistTheme(theme) {
            try {
                var raw = localStorage.getItem(STORAGE_KEY);
                var prefs = raw ? JSON.parse(raw) : {};
                prefs.theme = theme;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
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
            syncIcon();
        }

        btn.addEventListener("click", function (e) {
            e.preventDefault();
            applyTheme(getCurrentTheme() === "dark" ? "light" : "dark");
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
        initBrandWord();
        initYear();
        createPartnerSlots();
        bindScrollTarget();
        initAuthThemeToggle();
    });
})();
