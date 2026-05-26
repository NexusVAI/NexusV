/* ============================================================
 * Cancri 满月庆典 · 首次进站欢迎弹窗
 * 2026-05-26
 *
 * 行为：
 *   chat/index.html 加载完成后约 800ms，向所有用户弹出一次"九重福利"
 *   导览卡片（Claude-style 居中模态）。用户关闭后写入 localStorage 标记，
 *   下次进站不再触发。
 *
 * 复制邀请链接：
 *   已登录 → fetch celebrate-signin?action=get_invite 拉取专属链接，
 *   按钮直接复制；未登录 → 按钮跳转到登录卡片高亮。
 *
 * Kill switch：
 *   URL ?nowelcome=1 永久跳过；localStorage cancri_welcome_modal_v1_seen=1 已看过。
 *
 * 静态优先：未登录用户 0 网络请求；已登录仅在按钮首次点击时拉一次 invite。
 * ============================================================ */
(function () {
    "use strict";

    var SEEN_KEY = "cancri_welcome_modal_v1_seen";
    var KILL_KEY = "cancri_welcome_modal_v1_off";
    var SHOW_DELAY_MS = 800;
    var CELEBRATE_URL = "./celebrate.html";

    // 5 张推广图（用户指定）
    var LOGO_BASE = "../Logo/";
    var CARDS = [
        {
            img: LOGO_BASE + "neyyyss.png",
            title: "故事墙精选 · 千万 Token 大奖",
            desc: "留言 / 段子被精选上墙：直接送 1000万 Tokens + Pro 30 天激活码。",
            badge: "🏆"
        },
        {
            img: LOGO_BASE + "neysyss.png",
            title: "编年史评论 · 100% 中奖",
            desc: "走心建言 100% 抽奖，最低 100万，5% 概率爆 1000万 Tokens。",
            badge: "✍️"
        },
        {
            img: LOGO_BASE + "neyyys.png",
            title: "点赞暴击 · 概率爆 100万",
            desc: "每天 5 次点赞机会，18% 概率 10万 Tokens，2% 概率直接爆 100万。",
            badge: "❤️"
        },
        {
            img: LOGO_BASE + "neys.png",
            title: "满月转盘 · 100% 中奖",
            desc: "5/29 - 6/4 每天 1 次免费转，500万 / 1000万 加油包 + Pro 体验卡。",
            badge: "🎡"
        },
        {
            img: LOGO_BASE + "neyyysw.png",
            title: "邀请好友 · 双方各得 Token",
            desc: "把专属邀请链接发给朋友，被邀请人活跃后双方都拿 Token，无上限。",
            badge: "🔗",
            highlight: true
        }
    ];

    function isKilled() {
        try {
            if (window.location.search.indexOf("nowelcome=1") >= 0) {
                localStorage.setItem(KILL_KEY, "1");
                return true;
            }
            if (localStorage.getItem(KILL_KEY) === "1") return true;
            if (localStorage.getItem(SEEN_KEY) === "1") return true;
        } catch (_) {}
        return false;
    }

    function markSeen() {
        try { localStorage.setItem(SEEN_KEY, "1"); } catch (_) {}
    }

    function injectStyles() {
        if (document.getElementById("cancri-welcome-modal-styles")) return;
        var s = document.createElement("style");
        s.id = "cancri-welcome-modal-styles";
        s.textContent = [
            // 遮罩
            ".cwm-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;",
            "padding:16px;background:rgba(20,16,32,.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);",
            "opacity:0;transition:opacity .25s ease}",
            ".cwm-overlay.cwm-open{opacity:1}",
            // 卡片
            ".cwm-card{position:relative;width:100%;max-width:860px;max-height:92vh;overflow:hidden;display:flex;flex-direction:column;",
            "background:#fdfcf9;color:#1a1814;border-radius:18px;",
            "box-shadow:0 24px 80px rgba(40,16,80,.32),0 4px 12px rgba(0,0,0,.08);",
            "border:1px solid rgba(180,160,210,.28);transform:translateY(8px) scale(.98);transition:transform .28s cubic-bezier(.2,.7,.3,1)}",
            ".cwm-overlay.cwm-open .cwm-card{transform:translateY(0) scale(1)}",
            // 顶部装饰条（庆典色，细而克制）
            ".cwm-card::before{content:\"\";position:absolute;left:0;right:0;top:0;height:3px;",
            "background:linear-gradient(90deg,#7c4dff 0%,#b76eff 35%,#fcc964 70%,#ffd478 100%)}",
            // 关闭按钮
            ".cwm-close{position:absolute;top:14px;right:14px;width:32px;height:32px;border:none;background:transparent;",
            "border-radius:8px;color:#6b6353;cursor:pointer;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;",
            "transition:background .15s,color .15s}",
            ".cwm-close:hover{background:rgba(0,0,0,.05);color:#1a1814}",
            // 头部
            ".cwm-header{padding:28px 32px 8px 32px}",
            ".cwm-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;",
            "letter-spacing:.08em;text-transform:uppercase;color:#7c4dff;margin-bottom:8px}",
            ".cwm-eyebrow-dot{width:6px;height:6px;border-radius:50%;background:#7c4dff;box-shadow:0 0 0 4px rgba(124,77,255,.15)}",
            ".cwm-title{margin:0;font-size:24px;line-height:1.25;font-weight:700;color:#1a1814;",
            "font-family:'Source Serif 4','Source Serif Pro',ui-serif,Georgia,serif;letter-spacing:-.005em}",
            ".cwm-subtitle{margin:8px 0 0 0;font-size:14px;line-height:1.55;color:#5a5346}",
            ".cwm-subtitle strong{color:#1a1814;font-weight:600}",
            // 卡片网格（可滚动）
            ".cwm-body{padding:18px 32px 4px 32px;overflow-y:auto;flex:1;min-height:0}",
            ".cwm-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}",
            "@media (max-width:880px){.cwm-grid{grid-template-columns:repeat(2,1fr)}}",
            "@media (max-width:480px){.cwm-grid{grid-template-columns:1fr}}",
            ".cwm-tile{display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:12px;",
            "background:#fff;border:1px solid #ece7dc;transition:transform .15s,box-shadow .15s,border-color .15s}",
            ".cwm-tile:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(40,16,80,.08);border-color:#d9c8f5}",
            ".cwm-tile.cwm-tile--hi{background:linear-gradient(180deg,#fff8e8 0%,#fffdf6 100%);border-color:#f0d99a}",
            ".cwm-tile.cwm-tile--hi:hover{border-color:#e6bf68}",
            ".cwm-tile-imgwrap{position:relative;aspect-ratio:1/1;overflow:hidden;border-radius:8px;background:#f1ece1}",
            ".cwm-tile-img{width:100%;height:100%;object-fit:cover;display:block}",
            ".cwm-tile-badge{position:absolute;top:6px;left:6px;width:24px;height:24px;border-radius:50%;",
            "background:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;font-size:13px;",
            "box-shadow:0 1px 4px rgba(0,0,0,.12)}",
            ".cwm-tile-title{font-size:13px;font-weight:600;color:#1a1814;line-height:1.35;margin-top:2px;letter-spacing:-.005em}",
            ".cwm-tile-desc{font-size:11.5px;line-height:1.5;color:#6b6353}",
            // 底部按钮组
            ".cwm-footer{padding:18px 32px 24px 32px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;",
            "border-top:1px solid #f0ece2;background:linear-gradient(180deg,#fdfcf9 0%,#fbf8f0 100%)}",
            ".cwm-foot-hint{font-size:12px;color:#8a8273;flex:1;min-width:200px}",
            ".cwm-foot-hint strong{color:#7c4dff;font-weight:600}",
            ".cwm-actions{display:flex;gap:8px;flex-wrap:wrap}",
            ".cwm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;",
            "border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;",
            "transition:transform .12s,background .15s,border-color .15s,color .15s;font-family:inherit}",
            ".cwm-btn:active{transform:translateY(1px)}",
            ".cwm-btn--ghost{background:transparent;color:#5a5346;border-color:#e0d9c8}",
            ".cwm-btn--ghost:hover{background:#f5f0e4;color:#1a1814}",
            ".cwm-btn--secondary{background:#fff;color:#1a1814;border-color:#d9c8f5}",
            ".cwm-btn--secondary:hover{background:#f6f0ff;border-color:#b694f0}",
            ".cwm-btn--primary{background:linear-gradient(180deg,#7c4dff 0%,#5d2fdb 100%);color:#fff;",
            "box-shadow:0 1px 3px rgba(60,30,160,.3),inset 0 1px 0 rgba(255,255,255,.18)}",
            ".cwm-btn--primary:hover{filter:brightness(1.06)}",
            ".cwm-btn--primary:disabled{opacity:.6;cursor:wait;filter:none}",
            ".cwm-btn-spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid rgba(255,255,255,.45);",
            "border-top-color:#fff;animation:cwm-spin 0.8s linear infinite}",
            "@keyframes cwm-spin{to{transform:rotate(360deg)}}",
            // dark theme 适配
            "html[data-theme=\"dark\"] .cwm-card{background:#1c1a1f;color:#ece8df;border-color:rgba(255,255,255,.08)}",
            "html[data-theme=\"dark\"] .cwm-title{color:#fce28a}",
            "html[data-theme=\"dark\"] .cwm-subtitle{color:#bfb6a5}",
            "html[data-theme=\"dark\"] .cwm-subtitle strong{color:#ece8df}",
            "html[data-theme=\"dark\"] .cwm-tile{background:#252128;border-color:rgba(255,255,255,.06)}",
            "html[data-theme=\"dark\"] .cwm-tile:hover{border-color:rgba(183,110,255,.4)}",
            "html[data-theme=\"dark\"] .cwm-tile.cwm-tile--hi{background:linear-gradient(180deg,#2a2218 0%,#1f1c1f 100%);border-color:rgba(252,201,100,.25)}",
            "html[data-theme=\"dark\"] .cwm-tile-imgwrap{background:#1a1820}",
            "html[data-theme=\"dark\"] .cwm-tile-title{color:#ece8df}",
            "html[data-theme=\"dark\"] .cwm-tile-desc{color:#9b9384}",
            "html[data-theme=\"dark\"] .cwm-footer{background:linear-gradient(180deg,#1c1a1f 0%,#1a181d 100%);border-top-color:rgba(255,255,255,.06)}",
            "html[data-theme=\"dark\"] .cwm-btn--ghost{color:#bfb6a5;border-color:rgba(255,255,255,.1)}",
            "html[data-theme=\"dark\"] .cwm-btn--ghost:hover{background:rgba(255,255,255,.05);color:#ece8df}",
            "html[data-theme=\"dark\"] .cwm-btn--secondary{background:#252128;color:#ece8df;border-color:rgba(183,110,255,.3)}",
            "html[data-theme=\"dark\"] .cwm-btn--secondary:hover{background:#2a2530;border-color:rgba(183,110,255,.55)}",
            "html[data-theme=\"dark\"] .cwm-close{color:#9b9384}",
            "html[data-theme=\"dark\"] .cwm-close:hover{background:rgba(255,255,255,.06);color:#ece8df}",
            "html[data-theme=\"dark\"] .cwm-foot-hint{color:#8a8273}"
        ].join("");
        document.head.appendChild(s);
    }

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function buildCardHtml() {
        return CARDS.map(function (c) {
            var cls = "cwm-tile" + (c.highlight ? " cwm-tile--hi" : "");
            return [
                '<div class="', cls, '">',
                  '<div class="cwm-tile-imgwrap">',
                    '<img class="cwm-tile-img" src="', escapeHtml(c.img), '" alt="" loading="lazy" />',
                    '<span class="cwm-tile-badge" aria-hidden="true">', c.badge, '</span>',
                  '</div>',
                  '<div class="cwm-tile-title">', escapeHtml(c.title), '</div>',
                  '<div class="cwm-tile-desc">', escapeHtml(c.desc), '</div>',
                '</div>'
            ].join("");
        }).join("");
    }

    function buildModal() {
        var overlay = document.createElement("div");
        overlay.className = "cwm-overlay";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-labelledby", "cwmTitle");
        overlay.innerHTML = [
            '<div class="cwm-card" tabindex="-1">',
              '<button type="button" class="cwm-close" aria-label="关闭" data-cwm-close>',
                '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
              '</button>',
              '<div class="cwm-header">',
                '<div class="cwm-eyebrow"><span class="cwm-eyebrow-dot"></span>Cancri 满月庆典 · 5/29 – 6/4</div>',
                '<h2 id="cwmTitle" class="cwm-title">九重福利已就位 · 来一起白嫖一波</h2>',
                '<p class="cwm-subtitle">从 <strong>留言点赞评论最高千万 Token + Pro 30 天</strong>，到 <strong>邀请好友双方各得 Token</strong>，每一项都是 100% 拿得到的真金福利。挑你顺手的玩起来 →</p>',
              '</div>',
              '<div class="cwm-body">',
                '<div class="cwm-grid">', buildCardHtml(), '</div>',
              '</div>',
              '<div class="cwm-footer">',
                '<div class="cwm-foot-hint">📌 关闭后不再弹出 · 进入 <strong>设置 → 邀请</strong> 可随时复制专属链接。</div>',
                '<div class="cwm-actions">',
                  '<button type="button" class="cwm-btn cwm-btn--ghost" data-cwm-dismiss>下次再说</button>',
                  '<a class="cwm-btn cwm-btn--secondary" href="' + CELEBRATE_URL + '" data-cwm-celebrate>逛逛庆典 →</a>',
                  '<button type="button" class="cwm-btn cwm-btn--primary" data-cwm-copy>',
                    '<span data-cwm-copy-label>复制我的邀请链接</span>',
                  '</button>',
                '</div>',
              '</div>',
            '</div>'
        ].join("");
        return overlay;
    }

    var _supabase = null;
    function getSupabase() {
        if (_supabase) return _supabase;
        try {
            var url = window.__SUPABASE_URL__;
            var key = window.__SUPABASE_ANON_KEY__;
            if (!url || !key || !window.supabase || !window.supabase.createClient) return null;
            _supabase = window.supabase.createClient(url, key, {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: false,
                    storageKey: "cancri_supabase_auth"
                }
            });
        } catch (_) {
            return null;
        }
        return _supabase;
    }

    async function fetchInviteUrl() {
        var sb = getSupabase();
        if (!sb) return { ok: false, reason: "sdk_unavailable" };
        try {
            var sess = await sb.auth.getSession();
            var token = sess && sess.data && sess.data.session && sess.data.session.access_token;
            if (!token) return { ok: false, reason: "not_logged_in" };
            var url = window.__SUPABASE_URL__ + "/functions/v1/celebrate-signin";
            var res = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__
                },
                body: JSON.stringify({ action: "get_invite" })
            });
            var json = await res.json().catch(function () { return {}; });
            if (!res.ok || !json || !json.ok || !json.invite) {
                return { ok: false, reason: "endpoint_error" };
            }
            return { ok: true, url: String(json.invite.invite_url || "") };
        } catch (_) {
            return { ok: false, reason: "network" };
        }
    }

    async function copyToClipboard(text) {
        if (!text) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {}
        try {
            var ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return !!ok;
        } catch (_) {
            return false;
        }
    }

    // 复用主站 toast，回退到自建轻提示
    function notify(msg) {
        try {
            if (typeof window.showToast === "function") {
                window.showToast(msg);
                return;
            }
        } catch (_) {}
        var n = document.createElement("div");
        n.textContent = msg;
        n.style.cssText = "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:#1a1814;color:#fce28a;" +
            "padding:10px 18px;border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.25);" +
            "opacity:0;transition:opacity .2s";
        document.body.appendChild(n);
        requestAnimationFrame(function () { n.style.opacity = "1"; });
        setTimeout(function () {
            n.style.opacity = "0";
            setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 220);
        }, 2200);
    }

    function focusLoginCard() {
        var el = document.getElementById("authEmailInput") ||
                 document.querySelector(".auth-overlay") ||
                 document.querySelector(".auth-stage");
        if (el && typeof el.scrollIntoView === "function") {
            try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
        }
        if (el && typeof el.focus === "function") {
            try { el.focus({ preventScroll: true }); } catch (_) {}
        }
    }

    function close(overlay) {
        if (!overlay || overlay.__cwmClosed) return;
        overlay.__cwmClosed = true;
        markSeen();
        overlay.classList.remove("cwm-open");
        document.removeEventListener("keydown", overlay.__cwmKeyHandler, true);
        setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            // 还原 body 滚动
            document.documentElement.style.overflow = overlay.__cwmPrevHtmlOverflow || "";
            document.body.style.overflow = overlay.__cwmPrevBodyOverflow || "";
        }, 240);
    }

    function bindEvents(overlay) {
        var card = overlay.querySelector(".cwm-card");
        var copyBtn = overlay.querySelector("[data-cwm-copy]");
        var copyLabel = overlay.querySelector("[data-cwm-copy-label]");

        // 关闭：背景点击 / × / 下次再说 / Esc
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) close(overlay);
        });
        overlay.querySelectorAll("[data-cwm-close],[data-cwm-dismiss]").forEach(function (el) {
            el.addEventListener("click", function () { close(overlay); });
        });
        overlay.__cwmKeyHandler = function (e) {
            if (e.key === "Escape" || e.keyCode === 27) {
                e.stopPropagation();
                close(overlay);
            }
        };
        document.addEventListener("keydown", overlay.__cwmKeyHandler, true);

        // 逛逛庆典 → 跟随 href，离开前标记 seen
        var goBtn = overlay.querySelector("[data-cwm-celebrate]");
        if (goBtn) {
            goBtn.addEventListener("click", function () { markSeen(); });
        }

        // 复制邀请链接
        if (copyBtn) {
            var cachedUrl = null;
            copyBtn.addEventListener("click", async function () {
                if (copyBtn.disabled) return;
                copyBtn.disabled = true;
                var oldHtml = copyLabel.innerHTML;

                try {
                    if (!cachedUrl) {
                        copyLabel.innerHTML = '<span class="cwm-btn-spin"></span>&nbsp;读取邀请链接…';
                        var r = await fetchInviteUrl();
                        if (!r.ok) {
                            if (r.reason === "not_logged_in") {
                                copyLabel.textContent = "请先登录";
                                notify("登录后即可复制专属邀请链接");
                                close(overlay);
                                setTimeout(focusLoginCard, 280);
                                return;
                            }
                            copyLabel.textContent = "稍后再试";
                            notify("邀请链接暂时拉取失败，请稍后到「设置 → 邀请」中复制。");
                            return;
                        }
                        cachedUrl = r.url;
                    }
                    var ok = await copyToClipboard(cachedUrl);
                    if (ok) {
                        copyLabel.textContent = "✓ 已复制";
                        notify("邀请链接已复制，分享给朋友双方都拿 Token！");
                        markSeen();
                        setTimeout(function () { close(overlay); }, 700);
                    } else {
                        copyLabel.textContent = "复制失败";
                        notify("复制失败，请手动从「设置 → 邀请」复制。");
                    }
                } finally {
                    setTimeout(function () {
                        if (!overlay.__cwmClosed) {
                            copyBtn.disabled = false;
                            copyLabel.innerHTML = oldHtml;
                        }
                    }, 1600);
                }
            });
        }

        // 焦点：让 Esc 第一时间生效
        if (card) setTimeout(function () { try { card.focus(); } catch (_) {} }, 50);
    }

    function show() {
        injectStyles();
        var overlay = buildModal();
        document.body.appendChild(overlay);

        // 锁住滚动
        overlay.__cwmPrevHtmlOverflow = document.documentElement.style.overflow;
        overlay.__cwmPrevBodyOverflow = document.body.style.overflow;
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";

        bindEvents(overlay);
        // next frame to trigger transition
        requestAnimationFrame(function () {
            overlay.classList.add("cwm-open");
        });
    }

    function init() {
        if (isKilled()) return;
        // 等登录态稳定 + chat UI 出现，避免遮住首屏 LCP
        setTimeout(function () {
            // 二次校验：在等待期内，celebrate.html 等其它入口可能已经写过 seen
            if (isKilled()) return;
            try { show(); }
            catch (e) { console.warn("[welcome-modal] show failed", e); }
        }, SHOW_DELAY_MS);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
