/* ============================================================
 * Cancri Hero Logo · 满月小彩蛋
 * 2026-05-26
 *
 * 行为：
 *   首页 hero 区域那枚 32px 品牌装饰图标（.hero-icon-img / .hero-icon），
 *   点击后弹出一张小卡片：上半部 1Mth.png 海报图，下半部一段真挚的
 *   满月感谢语。再次点击外部 / × / Esc 关闭。无 localStorage 记忆，
 *   随时可触发。
 *
 * 不影响 hero 文案的可访问性：父级 .hero-icon 原本是 aria-hidden=true，
 *   这里用 click 委托而不是改 ARIA。
 * ============================================================ */
(function () {
    "use strict";

    var POSTER_SRC = "../Logo/1Mth.png";

    // 真挚的满月寄语 —— 作者自留心意，不做营销味
    var THANK_HTML = [
        '<p>满月这天，先把这张图递给你。</p>',
        '<p>过去这一个月里，Cancri Code 从一个还在打磨的小工具，长到今天 <strong>2454 位</strong> 朋友愿意每天打开它。每一次报错、每一句吐槽、每一条建议，我们都收到了。</p>',
        '<p>很多功能是因为你随手发来的一句"这里要是能…就好了"才有的。所以这次满月庆典里所有的福利，从加油包到转盘到精选墙，都不是营销动作，是想用我们能给的方式，对你说一句：</p>',
        '<p class="hee-signoff">感谢一路同行，下个月见。<br/><span class="hee-sign-name">— Cancri Code 团队</span></p>'
    ].join("");

    function injectStyles() {
        if (document.getElementById("hero-easter-egg-styles")) return;
        var s = document.createElement("style");
        s.id = "hero-easter-egg-styles";
        s.textContent = [
            // hero icon 提示交互
            ".hero-icon{cursor:pointer;transition:transform .18s ease,filter .18s ease;border-radius:8px}",
            ".hero-icon:hover{transform:scale(1.08) rotate(-3deg);filter:drop-shadow(0 2px 8px rgba(252,201,100,.45))}",
            ".hero-icon:active{transform:scale(.96)}",
            // overlay
            ".hee-overlay{position:fixed;inset:0;z-index:9100;display:flex;align-items:center;justify-content:center;",
            "padding:16px;background:rgba(20,16,32,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);",
            "opacity:0;transition:opacity .22s ease}",
            ".hee-overlay.hee-open{opacity:1}",
            // card
            ".hee-card{position:relative;width:100%;max-width:420px;background:#fdfcf9;border-radius:18px;overflow:hidden;",
            "box-shadow:0 24px 60px rgba(40,16,80,.32),0 4px 12px rgba(0,0,0,.08);",
            "border:1px solid rgba(180,160,210,.22);",
            "transform:translateY(10px) scale(.96);transition:transform .26s cubic-bezier(.2,.7,.3,1)}",
            ".hee-overlay.hee-open .hee-card{transform:translateY(0) scale(1)}",
            // close
            ".hee-close{position:absolute;top:10px;right:10px;width:30px;height:30px;border:none;border-radius:8px;",
            "background:rgba(255,255,255,.85);color:#1a1814;cursor:pointer;display:flex;align-items:center;justify-content:center;",
            "box-shadow:0 1px 4px rgba(0,0,0,.18);z-index:2;transition:background .15s,transform .15s}",
            ".hee-close:hover{background:#fff;transform:scale(1.06)}",
            // poster
            ".hee-poster{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;background:#1a1814}",
            // body
            ".hee-body{padding:20px 22px 22px 22px}",
            ".hee-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;",
            "color:#7c4dff;font-weight:600;margin-bottom:10px}",
            ".hee-eyebrow-dot{width:6px;height:6px;border-radius:50%;background:#fcc964;box-shadow:0 0 0 4px rgba(252,201,100,.18)}",
            ".hee-title{margin:0 0 10px 0;font-size:18px;font-weight:700;line-height:1.3;color:#1a1814;",
            "font-family:'Source Serif 4','Source Serif Pro',ui-serif,Georgia,serif;letter-spacing:-.005em}",
            ".hee-body p{margin:0 0 10px 0;font-size:13.5px;line-height:1.65;color:#4a4338}",
            ".hee-body p:last-child{margin-bottom:0}",
            ".hee-body strong{color:#1a1814;font-weight:600}",
            ".hee-signoff{margin-top:16px !important;padding-top:14px;border-top:1px solid #ece7dc;",
            "font-size:13px !important;color:#5a5346 !important;font-style:italic}",
            ".hee-sign-name{display:inline-block;margin-top:4px;font-style:normal;color:#7c4dff;font-weight:600;letter-spacing:.01em}",
            // dark theme
            "html[data-theme=\"dark\"] .hee-card{background:#1c1a1f;border-color:rgba(255,255,255,.08)}",
            "html[data-theme=\"dark\"] .hee-title{color:#fce28a}",
            "html[data-theme=\"dark\"] .hee-body p{color:#bfb6a5}",
            "html[data-theme=\"dark\"] .hee-body strong{color:#ece8df}",
            "html[data-theme=\"dark\"] .hee-signoff{border-top-color:rgba(255,255,255,.08);color:#9b9384 !important}",
            "html[data-theme=\"dark\"] .hee-sign-name{color:#b76eff}",
            "html[data-theme=\"dark\"] .hee-close{background:rgba(40,36,46,.92);color:#ece8df}",
            "html[data-theme=\"dark\"] .hee-close:hover{background:#2a2530}"
        ].join("");
        document.head.appendChild(s);
    }

    function buildOverlay() {
        var overlay = document.createElement("div");
        overlay.className = "hee-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "heeTitle");
        overlay.innerHTML = [
            '<div class="hee-card" tabindex="-1">',
              '<button type="button" class="hee-close" aria-label="关闭" data-hee-close>',
                '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
              '</button>',
              '<img class="hee-poster" src="' + POSTER_SRC + '" alt="Cancri Code 满月" loading="lazy" />',
              '<div class="hee-body">',
                '<div class="hee-eyebrow"><span class="hee-eyebrow-dot"></span>给你的小满月</div>',
                '<h3 id="heeTitle" class="hee-title">嗨，被你点开了 🌕</h3>',
                THANK_HTML,
              '</div>',
            '</div>'
        ].join("");
        return overlay;
    }

    function close(overlay) {
        if (!overlay || overlay.__heeClosed) return;
        overlay.__heeClosed = true;
        overlay.classList.remove("hee-open");
        document.removeEventListener("keydown", overlay.__heeKey, true);
        setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            document.documentElement.style.overflow = overlay.__heePrevHtmlOverflow || "";
            document.body.style.overflow = overlay.__heePrevBodyOverflow || "";
        }, 220);
    }

    function open() {
        injectStyles();

        // 若已经有打开的实例（连点 spam），直接重新触发动画
        var existing = document.querySelector(".hee-overlay");
        if (existing) return;

        var overlay = buildOverlay();
        document.body.appendChild(overlay);

        overlay.__heePrevHtmlOverflow = document.documentElement.style.overflow;
        overlay.__heePrevBodyOverflow = document.body.style.overflow;
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";

        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) close(overlay);
        });
        overlay.querySelectorAll("[data-hee-close]").forEach(function (el) {
            el.addEventListener("click", function () { close(overlay); });
        });
        overlay.__heeKey = function (e) {
            if (e.key === "Escape" || e.keyCode === 27) {
                e.stopPropagation();
                close(overlay);
            }
        };
        document.addEventListener("keydown", overlay.__heeKey, true);

        requestAnimationFrame(function () { overlay.classList.add("hee-open"); });

        var card = overlay.querySelector(".hee-card");
        if (card) setTimeout(function () { try { card.focus(); } catch (_) {} }, 40);
    }

    // 用事件委托绑定，覆盖 hero-icon 任何可能的重渲染场景
    function bind() {
        if (document.__heeBound) return;
        document.__heeBound = true;

        // 父 span.hero-icon 原本 aria-hidden=true。把它升级为可点击：
        // 不改 aria（保留 hero-text 给屏幕阅读器读出问候语），
        // 但加上 cursor + role="button"，并让 keyboard 可触发。
        function upgrade(el) {
            if (!el || el.__heeUpgraded) return;
            el.__heeUpgraded = true;
            el.setAttribute("role", "button");
            el.setAttribute("tabindex", "0");
            el.setAttribute("aria-label", "Cancri 满月小彩蛋");
            el.removeAttribute("aria-hidden");
            el.title = "点我，有惊喜 🌕";
        }

        document.querySelectorAll(".hero-icon").forEach(upgrade);

        // 委托：捕获任何后续插入的 .hero-icon
        document.addEventListener("click", function (e) {
            var t = e.target;
            if (!t) return;
            var hit = t.closest && t.closest(".hero-icon");
            if (!hit) return;
            e.preventDefault();
            e.stopPropagation();
            upgrade(hit);
            open();
        }, false);

        document.addEventListener("keydown", function (e) {
            if (e.key !== "Enter" && e.key !== " " && e.keyCode !== 13 && e.keyCode !== 32) return;
            var t = document.activeElement;
            if (!t || !t.classList || !t.classList.contains("hero-icon")) return;
            e.preventDefault();
            open();
        }, false);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bind, { once: true });
    } else {
        bind();
    }
})();
