(function () {
    "use strict";

    var key = "cancri-login-theme";
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var preference = null;
    var button;
    try {
        var saved = localStorage.getItem(key);
        if (saved === "light" || saved === "dark") preference = saved;
    } catch (_) {}

    function apply() {
        var mode = preference || (media.matches ? "dark" : "light");
        document.documentElement.setAttribute("data-mode", mode);
        document.documentElement.style.colorScheme = mode;
        document.querySelectorAll(".cds-root[data-mode]").forEach(function (root) {
            root.setAttribute("data-mode", mode);
        });
        if (button) {
            var label = mode === "dark" ? "浅色" : "深色";
            button.querySelector("span").textContent = label;
            button.setAttribute("aria-label", "切换为" + label + "主题");
            button.title = "切换为" + label + "主题";
        }
    }

    apply();
    media.addEventListener("change", function () {
        if (!preference) apply();
    });
    document.addEventListener("DOMContentLoaded", function () {
        var widget = document.querySelector("[data-community-widget]");
        var trigger = widget && widget.querySelector("[data-community-trigger]");
        if (trigger) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "cancri-community__trigger cancri-login-theme";
            button.innerHTML = '<svg data-theme-icon="light" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg><svg data-theme-icon="dark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/></svg><span></span>';
            widget.appendChild(button);
            // 共享社区按钮计算后的贝塞尔圆角，不复制整套圆角算法。
            function syncCorners() {
                button.style.clipPath = trigger.style.clipPath;
                button.classList.toggle("sq-active", trigger.classList.contains("sq-active"));
            }
            syncCorners();
            new MutationObserver(syncCorners).observe(trigger, {
                attributes: true,
                attributeFilter: ["style", "class"]
            });
            button.addEventListener("click", function () {
                preference = document.documentElement.getAttribute("data-mode") === "dark" ? "light" : "dark";
                try { localStorage.setItem(key, preference); } catch (_) {}
                apply();
            });
        }
        apply();
    });
})();
