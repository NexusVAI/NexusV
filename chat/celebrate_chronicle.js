/* ============================================================
 * Cancri / NexusVAI 满月庆典 · 编年史互动 v1
 * 2026-05-28 · Phase 4
 *
 * 功能：
 *   • 从 celebrate-stats?action=chronicle_list 拉 18 条编年史 + 计数
 *   • 渲染到 #celebrateChronicleTrack（覆盖原硬编码 ol 内容）
 *   • 卡片底部加 浏览 / 点赞 / 评论 统计条 + "展开"提示
 *   • 卡片进入视口 → 调 chronicle_record_view（fingerprint + viewer_key 双去重）
 *   • 点击卡片 → 打开 #celebrateChronicleModal：顶图大图 + 长正文 + 点赞 / 评论
 *   • 点赞需登录；评论需登录、≤200 字、1min ≤ 5 条
 *
 * 防刷设计：
 *   • 后端 UNIQUE(chronicle_id, viewer_key, view_date)：同一日同一访客不重复
 *   • 前端 state.viewedThisSession：本会话已 fire 过的 id 不重复发请求
 *
 * 与 celebrate_scroll.js 协作：
 *   • 渲染完成后 dispatchEvent('resize') 触发 sticky 重新测量 trackWidth
 * ============================================================ */
(function () {
    "use strict";

    var SUPABASE_FUNCTIONS_BASE = ((window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz").replace(/\/+$/, "") + "/functions/v1");
    var STATS_URL = SUPABASE_FUNCTIONS_BASE + "/celebrate-stats";
    var SIGNIN_URL = SUPABASE_FUNCTIONS_BASE + "/celebrate-signin";

    var state = {
        items: [],
        viewedThisSession: new Set(),
        openId: null,
    };

    // ---------- utils ----------
    function $(sel, root) { return (root || document).querySelector(sel); }
    function escapeHtml(s) {
        if (s == null) return "";
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function formatNum(n) {
        n = Number(n || 0);
        if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "万";
        if (n >= 1000)  return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
        return String(n);
    }
    // body 里的 **强调** → <strong>，做最小程度 markdown
    function richify(text) {
        var esc = escapeHtml(text);
        esc = esc.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // 段落：双换行分段，单换行变 <br>
        return esc.split(/\n{2,}/).map(function (p) {
            return '<p>' + p.replace(/\n/g, '<br/>') + '</p>';
        }).join('');
    }
    function getFingerprint() {
        try {
            return window.__CANCRI_FINGERPRINT__ ||
                (window.localStorage && localStorage.getItem("cancri_fp_visitor_id")) ||
                null;
        } catch (_) { return null; }
    }

    // 与主站共享同一个 supabase session
    var _supabase = null;
    function getSupabase() {
        if (_supabase) return _supabase;
        if (!window.supabase || !window.supabase.createClient) return null;
        var url = window.__SUPABASE_URL__, key = window.__SUPABASE_ANON_KEY__;
        if (!url || !key) return null;
        _supabase = window.supabase.createClient(url, key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
                storageKey: "cancri_supabase_auth",
            },
        });
        return _supabase;
    }
    function getAccessToken() {
        var sb = getSupabase();
        if (!sb) return Promise.resolve(null);
        return sb.auth.getSession().then(function (r) {
            return r && r.data && r.data.session ? r.data.session.access_token : null;
        }).catch(function () { return null; });
    }

    function toast(msg) {
        var existing = document.getElementById("celebrateToast");
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        var t = document.createElement("div");
        t.id = "celebrateToast";
        t.textContent = msg;
        t.style.cssText =
            "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);" +
            "background:rgba(20,20,20,0.92);color:#fff;padding:12px 20px;" +
            "border-radius:999px;font-size:14px;z-index:10000;" +
            "max-width:88vw;text-align:center;line-height:1.5;" +
            "box-shadow:0 8px 24px rgba(0,0,0,0.25);";
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
    }

    // ---------- 网络 ----------
    function fetchList() {
        return getAccessToken().then(function (token) {
            var headers = {
                "Content-Type": "application/json",
                Accept: "application/json",
                apikey: window.__SUPABASE_ANON_KEY__ || "",
            };
            if (token) headers.Authorization = "Bearer " + token;
            return fetch(STATS_URL, {
                method: "POST",
                headers: headers,
                body: JSON.stringify({ action: "chronicle_list" }),
            }).then(function (res) {
                if (!res.ok) throw new Error("chronicle_list:" + res.status);
                return res.json();
            });
        });
    }

    function recordView(id) {
        if (state.viewedThisSession.has(id)) return;
        state.viewedThisSession.add(id);
        var fp = getFingerprint();
        getAccessToken().then(function (token) {
            var headers = {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__ || "",
            };
            if (token) headers.Authorization = "Bearer " + token;
            // fire-and-forget
            fetch(STATS_URL, {
                method: "POST",
                headers: headers,
                body: JSON.stringify({
                    action: "chronicle_record_view",
                    chronicle_id: id,
                    fingerprint: fp,
                }),
            }).catch(function () {});
        });
    }

    function toggleLike(id) {
        return getAccessToken().then(function (token) {
            if (!token) { toast("请先登录后再点赞"); return null; }
            return fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__ || "",
                },
                body: JSON.stringify({ action: "chronicle_toggle_like", chronicle_id: id }),
            }).then(function (res) {
                return res.json().then(function (d) {
                    if (!res.ok) throw new Error((d && d.message) || "HTTP " + res.status);
                    return d;
                });
            });
        });
    }

    function submitComment(id, content) {
        return getAccessToken().then(function (token) {
            if (!token) { toast("请先登录后再评论"); return null; }
            return fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__ || "",
                },
                body: JSON.stringify({
                    action: "chronicle_submit_comment",
                    chronicle_id: id,
                    content: content,
                }),
            }).then(function (res) {
                return res.json().then(function (d) {
                    if (!res.ok) throw new Error((d && d.message) || "HTTP " + res.status);
                    return d;
                });
            });
        });
    }

    function fetchComments(id) {
        return fetch(STATS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                apikey: window.__SUPABASE_ANON_KEY__ || "",
            },
            body: JSON.stringify({
                action: "chronicle_list_comments",
                chronicle_id: id,
                limit: 30,
            }),
        }).then(function (res) {
            if (!res.ok) throw new Error("list_comments:" + res.status);
            return res.json();
        });
    }

    // ---------- 渲染 ----------
    var track;
    var viewObserver;

    function buildCard(c) {
        var dateLabel = c.event_date + "  ·  D" + c.day_index;
        var classes = ["celebrate-timeline-card"];
        if (c.is_milestone) classes.push("celebrate-timeline-card--milestone");
        if (c.is_moon) classes.push("celebrate-timeline-card--moon");
        return (
            '<li class="' + classes.join(" ") + '" data-chronicle-id="' + c.id + '" tabindex="0" role="button" aria-label="展开 ' + escapeHtml(c.title) + ' 详情">' +
              '<span class="celebrate-timeline-card-date">' + escapeHtml(dateLabel) + '</span>' +
              '<h3 class="celebrate-timeline-card-title">' + escapeHtml(c.title) + '</h3>' +
              '<p class="celebrate-timeline-card-body">' + escapeHtml(c.summary) + '</p>' +
              '<div class="celebrate-chronicle-stats" aria-label="互动统计">' +
                '<span class="celebrate-chronicle-stat' + (c.my_liked ? " is-liked" : "") + '" data-stat="like" title="点赞">' +
                  '<span class="celebrate-chronicle-stat-icon">' + (c.my_liked ? "♥" : "♡") + '</span>' +
                  '<span class="celebrate-chronicle-stat-num" data-num="like">' + formatNum(c.like_count) + '</span>' +
                '</span>' +
                '<span class="celebrate-chronicle-stat" data-stat="comment" title="评论">' +
                  '<span class="celebrate-chronicle-stat-icon">💬</span>' +
                  '<span class="celebrate-chronicle-stat-num" data-num="comment">' + formatNum(c.comment_count) + '</span>' +
                '</span>' +
                '<span class="celebrate-chronicle-stat" data-stat="view" title="浏览">' +
                  '<span class="celebrate-chronicle-stat-icon">👁</span>' +
                  '<span class="celebrate-chronicle-stat-num" data-num="view">' + formatNum(c.view_count) + '</span>' +
                '</span>' +
                '<span class="celebrate-chronicle-expand-hint" aria-hidden="true">展开 →</span>' +
              '</div>' +
            '</li>'
        );
    }

    function render(items) {
        if (!track) return;
        if (!items || !items.length) {
            track.innerHTML = '<li class="celebrate-timeline-card celebrate-timeline-card--skeleton" aria-hidden="true">' +
                '<span class="celebrate-timeline-card-date">空</span>' +
                '<h3 class="celebrate-timeline-card-title">暂无编年史</h3>' +
                '<p class="celebrate-timeline-card-body">服务端没有返回数据，请稍后再试。</p>' +
              '</li>';
            track.setAttribute("data-source", "empty");
            return;
        }
        track.innerHTML = items.map(buildCard).join("");
        track.setAttribute("data-source", "loaded");
        attachCardHandlers();

        // 通知 celebrate_scroll.js 重新测量 trackWidth；它对 resize 监听
        try { window.dispatchEvent(new Event("resize")); } catch (_) {}
    }

    function attachCardHandlers() {
        if (!track) return;
        var cards = track.querySelectorAll(".celebrate-timeline-card[data-chronicle-id]");
        Array.prototype.forEach.call(cards, function (card) {
            if (card.dataset.wired === "true") return;
            card.dataset.wired = "true";
            var id = Number(card.getAttribute("data-chronicle-id"));
            card.addEventListener("click", function (e) {
                // 阻止点 stats 区域时也触发展开 → 改为统一展开
                openModal(id);
            });
            card.addEventListener("keydown", function (e) {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openModal(id);
                }
            });
            if (viewObserver) viewObserver.observe(card);
        });
    }

    function setupViewObserver() {
        if (!("IntersectionObserver" in window)) return;
        viewObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var card = entry.target;
                var id = Number(card.getAttribute("data-chronicle-id"));
                if (!id || state.viewedThisSession.has(id)) return;
                recordView(id);
                viewObserver.unobserve(card);
            });
        }, { threshold: 0.5 });
    }

    function updateStatNum(id, kind, value) {
        var card = track && track.querySelector('[data-chronicle-id="' + id + '"]');
        if (card) {
            var num = card.querySelector('[data-num="' + kind + '"]');
            if (num) num.textContent = formatNum(value);
        }
        // 同步 modal 内
        var modalNum = document.querySelector('#chronicleModalActions [data-num="' + kind + '"]');
        if (modalNum) modalNum.textContent = formatNum(value);
    }

    function syncLikeUI(id, liked, count) {
        var card = track && track.querySelector('[data-chronicle-id="' + id + '"]');
        if (card) {
            var stat = card.querySelector('[data-stat="like"]');
            if (stat) {
                stat.classList.toggle("is-liked", liked);
                var icon = stat.querySelector('.celebrate-chronicle-stat-icon');
                if (icon) icon.textContent = liked ? "♥" : "♡";
                var num = stat.querySelector('[data-num="like"]');
                if (num) num.textContent = formatNum(count);
            }
        }
        var modalBtn = document.querySelector('#chronicleModalActions [data-act="like"]');
        if (modalBtn) {
            modalBtn.classList.toggle("is-liked", liked);
            modalBtn.setAttribute("aria-pressed", liked ? "true" : "false");
            var micon = modalBtn.querySelector('.celebrate-wall-act-icon');
            if (micon) micon.textContent = liked ? "♥" : "♡";
            var mnum = modalBtn.querySelector('[data-num="like"]');
            if (mnum) mnum.textContent = formatNum(count);
        }
        // 同步缓存
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].id === id) {
                state.items[i].my_liked = liked;
                state.items[i].like_count = count;
                break;
            }
        }
    }

    // ---------- 详情 modal ----------
    function getItem(id) {
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].id === id) return state.items[i];
        }
        return null;
    }

    function openModal(id) {
        var c = getItem(id);
        if (!c) return;
        var modal = document.getElementById("celebrateChronicleModal");
        if (!modal) return;
        state.openId = id;

        // 顶图：复用编年史卡用的 7 张照片之一，按 display_order 稳定循环
        // CSS nth-child 选的是位置；这里手动算 mod 7
        var imgs = [
            "../Logo/neys.png", "../Logo/neyyys.png", "../Logo/neyssa.png",
            "../Logo/neyyyss.png", "../Logo/neysyss.png", "../Logo/NESYUDX.png",
            "../Logo/NJeys.png"
        ];
        var imgIdx = ((Math.floor((c.display_order || 10) / 10) - 1) % imgs.length + imgs.length) % imgs.length;
        var cover = $("#chronicleModalCover");
        if (cover) cover.style.backgroundImage = 'url("' + imgs[imgIdx] + '")';

        $("#chronicleModalEyebrow").textContent = c.event_date + "  ·  D" + c.day_index +
            (c.is_milestone ? "  ·  milestone" : "") + (c.is_moon ? "  ·  moonday" : "");
        $("#chronicleModalTitle").textContent = c.title;
        $("#chronicleModalSummary").textContent = c.summary;
        $("#chronicleModalBody").innerHTML = richify(c.body);

        var link = $("#chronicleModalLink");
        if (c.link_url) {
            link.href = c.link_url;
            link.textContent = c.link_label || (c.link_url + " →");
            link.hidden = false;
            // # 锚跳转可以同页；外链新开
            link.target = /^https?:/i.test(c.link_url) ? "_blank" : "_self";
            link.rel = link.target === "_blank" ? "noopener noreferrer" : "";
        } else {
            link.hidden = true;
        }

        // 动作条
        var actions = $("#chronicleModalActions");
        actions.innerHTML =
            '<button class="celebrate-wall-act' + (c.my_liked ? " is-liked" : "") + '" type="button" data-act="like" aria-pressed="' + (c.my_liked ? "true" : "false") + '">' +
              '<span class="celebrate-wall-act-icon" aria-hidden="true">' + (c.my_liked ? "♥" : "♡") + '</span>' +
              '<span class="celebrate-wall-act-num" data-num="like">' + formatNum(c.like_count) + '</span>' +
            '</button>' +
            '<span class="celebrate-wall-act celebrate-wall-act--readonly" title="评论数">' +
              '<span class="celebrate-wall-act-icon" aria-hidden="true">💬</span>' +
              '<span class="celebrate-wall-act-num" data-num="comment">' + formatNum(c.comment_count) + '</span>' +
            '</span>' +
            '<span class="celebrate-wall-act celebrate-wall-act--readonly" title="浏览数">' +
              '<span class="celebrate-wall-act-icon" aria-hidden="true">👁</span>' +
              '<span class="celebrate-wall-act-num" data-num="view">' + formatNum(c.view_count) + '</span>' +
            '</span>';

        // 评论区骨架（加载后填充）
        var box = $("#chronicleModalComments");
        box.innerHTML =
            '<div class="celebrate-wall-comments-list" id="chronicleCommentsList">加载评论中…</div>' +
            '<div class="celebrate-wall-comment-composer">' +
              '<input class="celebrate-wall-comment-input" id="chronicleCommentInput" type="text" maxlength="200" placeholder="留个想法（最多 200 字）…" />' +
              '<button class="celebrate-wall-comment-submit" id="chronicleCommentSubmit" type="button">发送</button>' +
            '</div>';

        wireModalActions(id);
        loadComments(id);

        modal.hidden = false;
        document.documentElement.classList.add("celebrate-chronicle-modal-open");
        // 立即让浏览器布局，防止过渡跳变
        modal.offsetHeight; // eslint-disable-line no-unused-expressions
        modal.classList.add("is-open");

        // 焦点放到关闭按钮便于键盘 ESC / Enter
        var closeBtn = modal.querySelector(".celebrate-chronicle-modal-close");
        if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
        var modal = document.getElementById("celebrateChronicleModal");
        if (!modal) return;
        modal.classList.remove("is-open");
        document.documentElement.classList.remove("celebrate-chronicle-modal-open");
        // 等过渡收尾
        setTimeout(function () { modal.hidden = true; }, 220);
        state.openId = null;
    }

    function wireModalActions(id) {
        var actions = $("#chronicleModalActions");
        if (!actions) return;
        actions.addEventListener("click", function (e) {
            var btn = e.target.closest && e.target.closest('[data-act="like"]');
            if (!btn) return;
            if (btn.dataset.locking === "true") return;
            btn.dataset.locking = "true";
            toggleLike(id).then(function (resp) {
                btn.dataset.locking = "false";
                if (!resp || !resp.ok) return;
                var like = resp.like || {};
                if (!like.ok) { toast(like.reason || "操作失败"); return; }
                syncLikeUI(id, Boolean(like.liked), Number(like.count || 0));
                // Phase 5b：点赞抽奖结果
                if (like.liked && resp.lottery && typeof window.celebrateShowLottery === "function") {
                    window.celebrateShowLottery(resp.lottery, "like");
                }
            }).catch(function (err) {
                btn.dataset.locking = "false";
                toast((err && err.message) || "点赞失败");
            });
        });

        var submit = $("#chronicleCommentSubmit");
        var input = $("#chronicleCommentInput");
        if (submit && input) {
            function send() {
                var v = (input.value || "").trim();
                if (!v) { toast("评论不能为空"); return; }
                submit.disabled = true; submit.textContent = "发送中…";
                submitComment(id, v).then(function (resp) {
                    submit.disabled = false; submit.textContent = "发送";
                    if (!resp || !resp.ok) return;
                    var c = resp.comment || {};
                    if (!c.ok) {
                        toast(c.hint || c.reason || "评论失败");
                        return;
                    }
                    input.value = "";
                    // 计数 +1（精确值刷新会修正）
                    var item = getItem(id);
                    if (item) {
                        item.comment_count = Number(item.comment_count || 0) + 1;
                        updateStatNum(id, "comment", item.comment_count);
                    }
                    loadComments(id);
                    // Phase 5b：评论抽奖结果（中奖弹大卡片）
                    if (resp.lottery && typeof window.celebrateShowLottery === "function") {
                        window.celebrateShowLottery(resp.lottery, "chronicle_comment");
                    } else {
                        toast("评论成功");
                    }
                }).catch(function (err) {
                    submit.disabled = false; submit.textContent = "发送";
                    toast((err && err.message) || "评论失败");
                });
            }
            submit.addEventListener("click", send);
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            });
        }
    }

    function loadComments(id) {
        var list = $("#chronicleCommentsList");
        if (!list) return;
        fetchComments(id).then(function (data) {
            var comments = (data && data.comments) || [];
            if (!comments.length) {
                list.innerHTML = '<div class="celebrate-wall-comment-empty">还没有评论，做第一个吧。</div>';
                return;
            }
            list.innerHTML = comments.map(function (c) {
                return (
                    '<div class="celebrate-wall-comment-item">' +
                      '<span class="celebrate-wall-comment-name">' + escapeHtml(c.display_name || "匿名同行者") + '</span>' +
                      '<span class="celebrate-wall-comment-text">' + escapeHtml(c.content) + '</span>' +
                    '</div>'
                );
            }).join("");
        }).catch(function () {
            list.innerHTML = '<div class="celebrate-wall-comment-empty">评论加载失败，请稍后再试。</div>';
        });
    }

    // ---------- modal close 绑定（global） ----------
    function bindModalGlobals() {
        var modal = document.getElementById("celebrateChronicleModal");
        if (!modal) return;
        modal.addEventListener("click", function (e) {
            if (e.target.closest && e.target.closest("[data-chronicle-close]")) {
                closeModal();
            }
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && state.openId != null) {
                closeModal();
            }
        });
    }

    // ---------- 启动 ----------
    function boot() {
        track = document.getElementById("celebrateChronicleTrack");
        if (!track) return;
        setupViewObserver();
        bindModalGlobals();

        // 等 supabase-js 加载完再拉，最多重试 20 次（约 4s）
        var attempts = 0;
        function tryFetch() {
            if (window.supabase && window.supabase.createClient) {
                fetchList().then(function (data) {
                    if (!data || !data.ok) {
                        render([]);
                        return;
                    }
                    state.items = (data.items || []).slice().sort(function (a, b) {
                        return (a.display_order || 0) - (b.display_order || 0);
                    });
                    render(state.items);
                }).catch(function (err) {
                    console.warn("[celebrate-chronicle] fetchList failed", err);
                    render([]);
                });
                return;
            }
            attempts++;
            if (attempts < 20) setTimeout(tryFetch, 200);
        }
        tryFetch();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
