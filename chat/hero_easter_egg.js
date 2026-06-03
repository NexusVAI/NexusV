/* ============================================================
 * Cancri Hero Logo · 打招呼小气泡
 * 2026-05-26 初版 / 2026-05-31 改版（去满月弹窗，改 Claude 风气泡）
 *
 * 行为：
 *   首页 hero 区域那枚品牌装饰图标（.hero-icon-img / .hero-icon），
 *   点击后在图标上方冒出一个小气泡，随机说一句短话；连点会逐级
 *   「微恼 → 生气」。气泡几秒后自动消散，无 localStorage 记忆。
 *
 * 不影响 hero 文案的可访问性：父级 .hero-icon 原本是 aria-hidden=true，
 *   这里用 click 委托而不是改 ARIA。
 * ============================================================ */
(function () {
    "use strict";

    // 随手点：普通短语
    var CALM_LINES = [
        "在的，找我有事？",
        "嗯？戳我干嘛～",
        "今天也辛苦啦",
        "想聊点什么都行",
        "我在听呢",
        "晚上好呀 🌙",
        "需要帮忙尽管说",
        "随时待命中",
        "嘿，你来啦",
        "这就为你打起精神",
        "摸摸鱼也没关系的",
        "记得喝口水哦",
        "刚把脑子热好了",
        "你一点我就醒",
        "今天也要开心呀",
        "有灵感了叫我",
        "我在，别客气",
        "慢慢来，不着急",
        "先喘口气再说",
        "想吐槽也行我听着",
        "给你留了个好态度",
        "键盘烫了我帮你吹吹",
        "月亮模式下更聪明（大概）",
        "刚偷学了一句新词",
        "你来了，气氛对了",
        "今天适合认真聊两句",
        "需要我正经一点吗？",
        "也可以随便唠唠",
        "我在这儿，没跑路",
        "戳一下算打招呼"
    ];
    // 被连点：微恼
    var ANNOYED_LINES = [
        "哎你轻点戳…",
        "好啦好啦我知道你在",
        "再戳我可要躲起来了",
        "你是不是有点上瘾了",
        "戳一下就够啦喂",
        "我又不会跑～",
        "手酸了吧歇歇",
        "再戳要起茧子了",
        "我知道你很闲但…",
        "行行行看见你了",
        "别把我当解压玩具",
        "再点我要装死了",
        "你鼠标还好吗"
    ];
    // 连点过头：生气
    var ANGRY_LINES = [
        "别戳了别戳了 😤",
        "再点我要生气了！",
        "你够了啊喂！(╯‵□′)╯",
        "戳坏了你赔得起吗",
        "哼，不理你了 💢",
        "信不信我把你拉黑",
        "再戳我就下班了",
        "手！下！留！情！",
        "我要向管理员告状了",
        "你再戳我就装404",
        "够了，我要去摸鱼了",
        "再点我就只会回省略号……"
    ];

    var clickBurst = 0;        // 连点计数
    var lastClickAt = 0;       // 上次点击时间戳
    var lastLine = "";         // 避免连续重复同一句
    var BURST_RESET_MS = 2600; // 超过该间隔视为冷静，计数清零

    function pick(pool) {
        if (!pool.length) return "";
        var line = pool[Math.floor(Math.random() * pool.length)];
        if (pool.length > 1 && line === lastLine) {
            line = pool[(pool.indexOf(line) + 1) % pool.length];
        }
        lastLine = line;
        return line;
    }

    function nextLine() {
        var now = Date.now();
        if (now - lastClickAt > BURST_RESET_MS) clickBurst = 0;
        lastClickAt = now;
        clickBurst++;
        if (clickBurst >= 8) return { text: pick(ANGRY_LINES), mood: "angry" };
        if (clickBurst >= 4) return { text: pick(ANNOYED_LINES), mood: "annoyed" };
        return { text: pick(CALM_LINES), mood: "calm" };
    }

    function injectStyles() {
        if (document.getElementById("hero-easter-egg-styles")) return;
        var s = document.createElement("style");
        s.id = "hero-easter-egg-styles";
        s.textContent = [
            // hero icon 可点击 + 轻微 hover 反馈
            ".hero-icon{cursor:pointer;transition:transform .18s ease,filter .18s ease;border-radius:8px}",
            ".hero-icon:hover{transform:scale(1.06) rotate(-2deg);filter:drop-shadow(0 1px 4px rgba(0,0,0,.18))}",
            ".hero-icon:active{transform:scale(.92)}",
            // 气泡：Claude 风沙底 + hairline，斜体衬线，浮在 icon 上方
            ".hee-bubble{position:fixed;z-index:9100;max-width:min(78vw,300px);padding:9px 13px;",
            "background:#faf9f5;color:#29261b;border:1px solid rgba(112,107,87,.20);border-radius:14px;",
            "box-shadow:0 1px 2px rgba(0,0,0,.05),0 8px 24px rgba(0,0,0,.10);",
            "font-size:14px;line-height:1.45;font-style:italic;",
            "font-family:'Source Serif 4','Source Serif Pro',ui-serif,Georgia,serif;",
            "white-space:nowrap;pointer-events:none;opacity:0;transform:translateY(6px) scale(.96);",
            "transition:opacity .2s ease,transform .24s cubic-bezier(.2,.7,.3,1)}",
            ".hee-bubble.hee-show{opacity:1;transform:translateY(0) scale(1)}",
            // 尾巴：默认指向 icon 中心，由 --hee-tail 定位
            ".hee-bubble::after{content:'';position:absolute;left:var(--hee-tail,24px);bottom:-6px;width:11px;height:11px;",
            "background:inherit;border-right:1px solid rgba(112,107,87,.20);border-bottom:1px solid rgba(112,107,87,.20);",
            "transform:rotate(45deg);border-bottom-right-radius:3px}",
            // 微恼 / 生气配色
            ".hee-bubble.hee-annoyed{font-style:normal}",
            ".hee-bubble.hee-angry{font-style:normal;color:#b4432b;border-color:rgba(180,67,43,.42);animation:hee-shake .42s ease}",
            "@keyframes hee-shake{0%,100%{transform:translateY(0) scale(1)}25%{transform:translateY(0) translateX(-3px) rotate(-1.2deg)}75%{transform:translateY(0) translateX(3px) rotate(1.2deg)}}",
            // dark / black theme
            "html[data-theme=\"dark\"] .hee-bubble{background:#262624;color:#f5f4ef;border-color:rgba(234,221,216,.12);",
            "box-shadow:0 1px 2px rgba(0,0,0,.32),0 12px 32px rgba(0,0,0,.45)}",
            "html[data-theme=\"dark\"] .hee-bubble::after{border-right-color:rgba(234,221,216,.12);border-bottom-color:rgba(234,221,216,.12)}",
            "html[data-theme=\"dark\"] .hee-bubble.hee-angry{color:#ff9b86;border-color:rgba(255,155,134,.42)}",
            "html[data-theme=\"black\"] .hee-bubble{background:#111;color:#f5f4ef;border-color:rgba(255,255,255,.14)}",
            "html[data-theme=\"black\"] .hee-bubble::after{border-right-color:rgba(255,255,255,.14);border-bottom-color:rgba(255,255,255,.14)}",
            "html[data-theme=\"black\"] .hee-bubble.hee-angry{color:#ff9b86;border-color:rgba(255,155,134,.42)}"
        ].join("");
        document.head.appendChild(s);
    }

    var _bubbleEl = null;
    var _hideTimer = null;
    var _removeTimer = null;

    function showBubble(anchor) {
        injectStyles();
        if (!anchor) anchor = document.querySelector(".hero-icon");
        if (!anchor) return;

        var info = nextLine();

        // 复用单一气泡元素（连点不叠出多个）
        if (!_bubbleEl) {
            _bubbleEl = document.createElement("div");
            _bubbleEl.className = "hee-bubble";
            _bubbleEl.setAttribute("role", "status");
            _bubbleEl.setAttribute("aria-live", "polite");
            document.body.appendChild(_bubbleEl);
        }
        clearTimeout(_hideTimer);
        clearTimeout(_removeTimer);

        _bubbleEl.className = "hee-bubble" +
            (info.mood === "angry" ? " hee-angry" : info.mood === "annoyed" ? " hee-annoyed" : "");
        _bubbleEl.textContent = info.text;

        // 量尺寸后按 anchor 定位（气泡在 icon 正上方居中）
        _bubbleEl.style.left = "0px";
        _bubbleEl.style.top = "0px";
        var bw = _bubbleEl.offsetWidth;
        var bh = _bubbleEl.offsetHeight;
        var r = anchor.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var margin = 8;
        var left = cx - bw / 2;
        if (left < margin) left = margin;
        if (left + bw > window.innerWidth - margin) left = window.innerWidth - margin - bw;
        var top = r.top - bh - 10;
        if (top < margin) top = r.bottom + 10; // 上方放不下就翻到下方
        _bubbleEl.style.left = Math.round(left) + "px";
        _bubbleEl.style.top = Math.round(top) + "px";
        // 尾巴对准 icon 中心
        var tail = cx - left - 5.5;
        tail = Math.max(12, Math.min(bw - 20, tail));
        _bubbleEl.style.setProperty("--hee-tail", Math.round(tail) + "px");

        requestAnimationFrame(function () { if (_bubbleEl) _bubbleEl.classList.add("hee-show"); });

        var dwell = info.mood === "angry" ? 2600 : info.mood === "annoyed" ? 2200 : 1900;
        _hideTimer = setTimeout(function () {
            if (!_bubbleEl) return;
            _bubbleEl.classList.remove("hee-show");
            _removeTimer = setTimeout(function () {
                if (_bubbleEl && _bubbleEl.parentNode) _bubbleEl.parentNode.removeChild(_bubbleEl);
                _bubbleEl = null;
            }, 260);
        }, dwell);
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
            el.setAttribute("aria-label", "戳戳 Cancri，打个招呼");
            el.removeAttribute("aria-hidden");
            el.title = "戳我一下～";
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
            showBubble(hit);
        }, false);

        document.addEventListener("keydown", function (e) {
            if (e.key !== "Enter" && e.key !== " " && e.keyCode !== 13 && e.keyCode !== 32) return;
            var t = document.activeElement;
            if (!t || !t.classList || !t.classList.contains("hero-icon")) return;
            e.preventDefault();
            showBubble(t);
        }, false);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bind, { once: true });
    } else {
        bind();
    }
})();
