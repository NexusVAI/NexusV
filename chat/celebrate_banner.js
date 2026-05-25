/* ============================================================
 * Cancri 满月庆典 · 主站顶部 banner
 * 2026-05-26 · D-1
 *
 * 行为：
 *   主站 chat/index.html 加载时检测当前时间：
 *     • 5/28 起：显示倒计时"还剩 X 时 Y 分进入满月"
 *     • 5/29 0:00 (UTC+8) - 5/31 23:59：显示"满月庆典进行中"
 *     • 6/1 - 6/4：显示"满月余晖 · 转盘开启中"（轻量版）
 *     • 6/5 起：隐藏
 *
 *   用户可点 × 关闭（仅本会话），刷新会重新显示。
 *
 * Kill switch：
 *   URL 加 ?nomoon=1 永久隐藏（localStorage 写 cancri_moon_banner_off=1）。
 *   后端 celebrate_config.free_day_enabled=false 也能在 celebrate.html 端关键链路上拦截。
 *
 * 静态优先：banner 仅基于客户端时间判断，0 个网络请求。
 * ============================================================ */
(function () {
    "use strict";

    // 时间锚（毫秒，UTC）
    var MOON_START_UTC = Date.UTC(2026, 4, 28, 16, 0, 0);  // 5/29 00:00 UTC+8 = 5/28 16:00 UTC
    var MOON_PRE_UTC   = Date.UTC(2026, 4, 27, 16, 0, 0);  // 5/28 00:00 UTC+8（预热）
    var MOON_MAIN_END  = Date.UTC(2026, 4, 31, 16, 0, 0);  // 6/1 00:00 UTC+8（主活动结束）
    var MOON_TAIL_END  = Date.UTC(2026, 5, 4, 16, 0, 0);   // 6/5 00:00 UTC+8（长尾结束）

    var SESSION_KEY = "cancri_moon_banner_session_off";
    var KILL_KEY = "cancri_moon_banner_off";
    var CELEBRATE_URL = "./celebrate.html";

    function isKilled() {
        try {
            // URL 参数永久 kill
            if (window.location.search.indexOf("nomoon=1") >= 0) {
                localStorage.setItem(KILL_KEY, "1");
                return true;
            }
            if (localStorage.getItem(KILL_KEY) === "1") return true;
            if (sessionStorage.getItem(SESSION_KEY) === "1") return true;
        } catch (_) {}
        return false;
    }

    function pickPhase(now) {
        if (now < MOON_PRE_UTC) return null;
        if (now < MOON_START_UTC) return "pre";    // 5/28 倒计时
        if (now < MOON_MAIN_END) return "main";    // 5/29-5/31 主活动
        if (now < MOON_TAIL_END) return "tail";    // 6/1-6/4 长尾
        return null;
    }

    function formatCountdown(diff) {
        var s = Math.max(0, Math.floor(diff / 1000));
        var d = Math.floor(s / 86400);
        var h = Math.floor((s % 86400) / 3600);
        var m = Math.floor((s % 3600) / 60);
        var ss = s % 60;
        if (d > 0) return d + "天 " + h + "时 " + m + "分";
        return h + "时 " + m + "分 " + ss + "秒";
    }

    function buildBanner(phase) {
        var bar = document.createElement("div");
        bar.id = "celebrateMoonBanner";
        bar.className = "celebrate-moon-banner celebrate-moon-banner--" + phase;
        bar.setAttribute("role", "status");
        bar.setAttribute("aria-live", "polite");

        var icon = "🌕";
        var titleHtml = "";
        var subHtml = "";

        if (phase === "pre") {
            titleHtml = "<strong>" + icon + " 满月将至</strong> 距 5/29 0:00 还有 <span data-moon-cd></span>";
            subHtml = "签到、转盘、加油包、套餐折扣已就位 · 点击查看准备好的福利 →";
        } else if (phase === "main") {
            titleHtml = "<strong>" + icon + " Cancri 满月庆典进行中</strong> 5/29 - 5/31 限定";
            subHtml = "8 重福利全员到账 · 套餐 5 折起 · 充返加油包 · 满月签到送 24h Pro · 创世徽章今日可领";
        } else {
            titleHtml = "<strong>🌖 满月余晖</strong> 转盘 / 加油包仍在领取中";
            subHtml = "转盘每天 1 次（至 6/4） · 故事墙开放至 6/4 · 点击查看活动收尾";
        }

        bar.innerHTML =
            '<a class="celebrate-moon-banner__inner" href="' + CELEBRATE_URL + '" title="进入满月庆典页面">' +
            '<span class="celebrate-moon-banner__title">' + titleHtml + "</span>" +
            '<span class="celebrate-moon-banner__sub">' + subHtml + "</span>" +
            '<span class="celebrate-moon-banner__arrow">→</span>' +
            "</a>" +
            '<button class="celebrate-moon-banner__close" type="button" aria-label="关闭满月庆典 banner（本会话）" title="本会话关闭">×</button>';

        return bar;
    }

    function injectStyles() {
        if (document.getElementById("celebrate-moon-banner-styles")) return;
        var s = document.createElement("style");
        s.id = "celebrate-moon-banner-styles";
        s.textContent =
            ".celebrate-moon-banner{position:relative;z-index:80;display:flex;align-items:stretch;justify-content:space-between;gap:8px;" +
            "padding:0;margin:0;width:100%;background:linear-gradient(95deg,#1a0a2e 0%,#2a1545 60%,#3a2068 100%);" +
            "color:#f0e8d0;font-size:13px;line-height:1.4;border-bottom:1px solid rgba(255,255,255,.08);" +
            "box-shadow:0 2px 12px rgba(40,16,80,.18);font-family:'Inter','Source Serif 4',system-ui,sans-serif}" +
            ".celebrate-moon-banner--pre{background:linear-gradient(95deg,#181432 0%,#251a4d 100%)}" +
            ".celebrate-moon-banner--tail{background:linear-gradient(95deg,#1a1a1f 0%,#2a2030 100%);font-size:12.5px}" +
            ".celebrate-moon-banner__inner{flex:1;display:flex;align-items:center;justify-content:center;gap:14px;padding:8px 16px;" +
            "text-decoration:none;color:inherit;flex-wrap:wrap;transition:filter .15s}" +
            ".celebrate-moon-banner__inner:hover{filter:brightness(1.12)}" +
            ".celebrate-moon-banner__title strong{color:#fce28a;font-weight:700;letter-spacing:.02em}" +
            ".celebrate-moon-banner__title{color:rgba(245,235,210,.95)}" +
            ".celebrate-moon-banner__sub{color:rgba(220,210,200,.72);font-size:12px}" +
            ".celebrate-moon-banner__arrow{color:#fce28a;font-weight:700;font-size:14px}" +
            ".celebrate-moon-banner__close{flex:none;width:32px;height:auto;border:none;background:transparent;color:rgba(255,255,255,.55);" +
            "font-size:16px;cursor:pointer;transition:color .15s,background .15s}" +
            ".celebrate-moon-banner__close:hover{color:#fff;background:rgba(255,255,255,.08)}" +
            "@media (max-width:720px){.celebrate-moon-banner__inner{padding:6px 12px;gap:8px}" +
            ".celebrate-moon-banner__sub{display:none}}";
        document.head.appendChild(s);
    }

    function showBanner(phase) {
        if (isKilled()) return;
        injectStyles();
        var bar = buildBanner(phase);
        document.body.insertBefore(bar, document.body.firstChild);

        // 关闭按钮（本会话）
        var closeBtn = bar.querySelector(".celebrate-moon-banner__close");
        if (closeBtn) {
            closeBtn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (_) {}
                if (bar.parentNode) bar.parentNode.removeChild(bar);
            });
        }

        // pre 阶段：倒计时
        if (phase === "pre") {
            var cdEl = bar.querySelector("[data-moon-cd]");
            if (cdEl) {
                var update = function () {
                    var diff = MOON_START_UTC - Date.now();
                    if (diff <= 0) {
                        // 跨过 5/29 0:00，重新评估 phase
                        if (bar.parentNode) bar.parentNode.removeChild(bar);
                        showBanner("main");
                        return;
                    }
                    cdEl.textContent = formatCountdown(diff);
                };
                update();
                setInterval(update, 1000);
            }
        }
    }

    function init() {
        var phase = pickPhase(Date.now());
        if (!phase) return; // 不在窗口
        showBanner(phase);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
