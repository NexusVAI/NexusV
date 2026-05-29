/* ============================================================
 * Cancri / NexusVAI 满月庆典 · 故事墙 v2（互动升级）
 * 2026-05-28 · D-3
 *
 * 功能：
 *   • 列表用 celebrate-stats?action=wall_list_v2 拉，带 like/comment/view 计数
 *   • 浏览数：卡片进入视口时调 wall_record_view（防刷：fingerprint 去重 + 每日 1 次/卡）
 *   • 点赞：?action=wall_toggle_like（需登录）
 *   • 评论：展开 inline 区域 + ?action=wall_list_comments + ?action=wall_submit_comment
 *   • 分页：列表底部「展开更多」按钮 + 自动加载（IntersectionObserver）
 *
 * 与 celebrate.js 解耦：
 *   设置 window.__CANCRI_WALL_V2__ = true，celebrate.js 的 loadWallStories 看到就跳过。
 *   故事提交逻辑仍在 celebrate.js（不变），提交完用 window.__cancriWallV2Reload() 刷新。
 * ============================================================ */
(function () {
    "use strict";
    window.__CANCRI_WALL_V2__ = true;

    var STATS_URL = "https://diusqgphvybnzazgopor.supabase.co/functions/v1/celebrate-stats";
    var SIGNIN_URL = "https://diusqgphvybnzazgopor.supabase.co/functions/v1/celebrate-signin";
    var PAGE_SIZE = 12;

    var state = {
        stories: [],
        beforeId: null,
        hasMore: true,
        loading: false,
        viewedIds: new Set(),       // 已埋点的 story_id（本会话内去重）
        openCommentIds: new Set(),  // 当前展开评论区的 story_id
    };

    // ---------- 工具 ----------
    function $(sel, root) { return (root || document).querySelector(sel); }
    function escapeHtml(s) {
        if (s == null) return "";
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    // 只放行 http(s) 图片 URL。后端 wall_submit 已校验 image_urls 必须是 storage
    // 公开桶前缀，这里是前端纵深防御：即便后端校验回退，也不会渲染出
    // 可点击的 javascript:/data: 链接。
    function safeImageUrl(u) {
        var s = String(u == null ? "" : u).trim();
        return /^https?:\/\//i.test(s) ? s : "";
    }
    function formatNum(n) {
        n = Number(n || 0);
        if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + "万";
        if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
        return String(n);
    }
    function getFingerprint() {
        try {
            return window.__CANCRI_FINGERPRINT__ ||
                (window.localStorage && localStorage.getItem("cancri_fp_visitor_id")) ||
                null;
        } catch (_) { return null; }
    }

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
        // 复用 celebrate.js 的 showToast 行为（无需依赖）
        var existing = document.getElementById("celebrateToast");
        if (existing) existing.parentNode.removeChild(existing);
        var t = document.createElement("div");
        t.id = "celebrateToast";
        t.textContent = msg;
        t.style.cssText =
            "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);" +
            "background:rgba(20,20,20,0.92);color:#fff;padding:12px 20px;" +
            "border-radius:999px;font-size:14px;z-index:9999;" +
            "max-width:88vw;text-align:center;line-height:1.5;" +
            "box-shadow:0 8px 24px rgba(0,0,0,0.25);";
        document.body.appendChild(t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
    }

    // ---------- 网络 ----------
    function fetchList(beforeId) {
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
                body: JSON.stringify({
                    action: "wall_list_v2",
                    limit: PAGE_SIZE,
                    before_id: beforeId || null,
                }),
            }).then(function (res) {
                if (!res.ok) throw new Error("wall_list_v2:" + res.status);
                return res.json();
            });
        });
    }

    function fetchComments(storyId, beforeId) {
        return fetch(STATS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                apikey: window.__SUPABASE_ANON_KEY__ || "",
            },
            body: JSON.stringify({
                action: "wall_list_comments",
                story_id: storyId,
                limit: 20,
                before_id: beforeId || null,
            }),
        }).then(function (res) {
            if (!res.ok) throw new Error("wall_list_comments:" + res.status);
            return res.json();
        });
    }

    function recordView(storyId) {
        if (state.viewedIds.has(storyId)) return;
        state.viewedIds.add(storyId);
        var fp = getFingerprint();
        return getAccessToken().then(function (token) {
            var headers = {
                "Content-Type": "application/json",
                apikey: window.__SUPABASE_ANON_KEY__ || "",
            };
            if (token) headers.Authorization = "Bearer " + token;
            // fire-and-forget；失败就失败，下次刷新可能再补
            fetch(STATS_URL, {
                method: "POST",
                headers: headers,
                body: JSON.stringify({
                    action: "wall_record_view",
                    story_id: storyId,
                    fingerprint: fp,
                }),
            }).catch(function () {});
        });
    }

    function toggleLike(storyId) {
        return getAccessToken().then(function (token) {
            if (!token) { toast("请先登录后再点赞"); return null; }
            return fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__ || "",
                },
                body: JSON.stringify({ action: "wall_toggle_like", story_id: storyId }),
            }).then(function (res) {
                return res.json().then(function (d) {
                    if (!res.ok) throw new Error((d && d.message) || "HTTP " + res.status);
                    return d;
                });
            });
        });
    }

    function submitComment(storyId, content, displayName) {
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
                    action: "wall_submit_comment",
                    story_id: storyId,
                    content: content,
                    display_name: displayName || null,
                }),
            }).then(function (res) {
                return res.json().then(function (d) {
                    if (!res.ok) throw new Error((d && d.message) || "HTTP " + res.status);
                    return d;
                });
            });
        });
    }

    // ---------- 渲染 ----------
    var grid;
    var loadMoreBtn;
    var viewObserver;
    var sentryObserver;
    var sentryEl;

    function ensureContainer() {
        grid = document.getElementById("wallGrid");
        if (!grid) return null;
        return grid;
    }

    function buildCard(s) {
        // s: { id, content, user_name, featured, image_urls, like_count, comment_count, view_count, my_liked }
        var featuredClass = s.featured ? " celebrate-wall-card--featured" : "";
        var badge = s.featured ? '<span class="celebrate-wall-card-badge">精选</span>' : "";
        var likedClass = s.my_liked ? " is-liked" : "";
        // 2026-05-28 Phase 5：polaroid 图片堆（左上图钉）
        var imgs = Array.isArray(s.image_urls) ? s.image_urls.slice(0, 3) : [];
        var photosHtml = "";
        if (imgs.length) {
            var photoItems = imgs.map(function (u, i) {
                var safe = safeImageUrl(u);
                if (!safe) return "";
                return '<a class="celebrate-wall-card-photo celebrate-wall-card-photo--' + i +
                    '" href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' +
                    '<span class="celebrate-wall-card-pin" aria-hidden="true"></span>' +
                    '<img src="' + escapeHtml(safe) + '" alt="故事图片 ' + (i + 1) + '" loading="lazy" />' +
                    '</a>';
            }).join("");
            if (photoItems) {
                photosHtml = '<div class="celebrate-wall-card-photos" data-count="' + imgs.length + '">' +
                    photoItems +
                  '</div>';
            }
        }
        return (
            '<article class="celebrate-wall-card' + featuredClass + '" data-story-id="' + s.id + '">' +
              photosHtml +
              '<p class="celebrate-wall-card-quote">' + escapeHtml(s.content) + '</p>' +
              '<div class="celebrate-wall-card-meta">' +
                '<span class="celebrate-wall-card-name">' + escapeHtml(s.user_name || "匿名") + '</span>' +
                badge +
              '</div>' +
              '<div class="celebrate-wall-card-actions">' +
                '<button class="celebrate-wall-act' + likedClass + '" data-act="like" type="button" aria-pressed="' + (s.my_liked ? "true" : "false") + '" title="' + (s.my_liked ? "取消点赞" : "点赞") + '">' +
                  '<span class="celebrate-wall-act-icon" aria-hidden="true">' + (s.my_liked ? "♥" : "♡") + '</span>' +
                  '<span class="celebrate-wall-act-num" data-num="like">' + formatNum(s.like_count) + '</span>' +
                '</button>' +
                '<button class="celebrate-wall-act" data-act="comment" type="button" title="评论">' +
                  '<span class="celebrate-wall-act-icon" aria-hidden="true">💬</span>' +
                  '<span class="celebrate-wall-act-num" data-num="comment">' + formatNum(s.comment_count) + '</span>' +
                '</button>' +
                '<span class="celebrate-wall-act celebrate-wall-act--readonly" title="浏览">' +
                  '<span class="celebrate-wall-act-icon" aria-hidden="true">👁</span>' +
                  '<span class="celebrate-wall-act-num" data-num="view">' + formatNum(s.view_count) + '</span>' +
                '</span>' +
              '</div>' +
              '<div class="celebrate-wall-comments" data-comments-for="' + s.id + '" hidden></div>' +
            '</article>'
        );
    }

    function buildEmpty() {
        return '<div class="celebrate-wall-empty">还没有故事，做第一个写下来的人吧。</div>';
    }

    function render(replace) {
        if (!grid) return;
        if (replace) {
            grid.innerHTML = "";
        }
        if (!state.stories.length) {
            grid.innerHTML = buildEmpty();
            grid.setAttribute("data-source", "empty");
            ensureLoadMore();
            return;
        }
        var existingIds = new Set();
        Array.prototype.forEach.call(grid.querySelectorAll("[data-story-id]"), function (el) {
            existingIds.add(Number(el.getAttribute("data-story-id")));
        });
        var html = state.stories
            .filter(function (s) { return !existingIds.has(Number(s.id)); })
            .map(buildCard)
            .join("");
        if (html) {
            // 移除 empty 占位
            var empty = grid.querySelector(".celebrate-wall-empty");
            if (empty) empty.parentNode.removeChild(empty);
            grid.insertAdjacentHTML("beforeend", html);
        }
        grid.setAttribute("data-source", "loaded");
        // 给新增卡片绑事件 + 观察可见性
        attachCardHandlers();
        ensureLoadMore();
    }

    function attachCardHandlers() {
        Array.prototype.forEach.call(grid.querySelectorAll(".celebrate-wall-card"), function (card) {
            if (card.dataset.wired === "true") return;
            card.dataset.wired = "true";
            var storyId = Number(card.getAttribute("data-story-id"));
            card.addEventListener("click", function (e) {
                var btn = e.target.closest && e.target.closest("[data-act]");
                if (!btn) return;
                var act = btn.getAttribute("data-act");
                if (act === "like") onLikeClick(storyId, card, btn);
                else if (act === "comment") onCommentToggle(storyId, card);
            });
            if (viewObserver) viewObserver.observe(card);
        });
    }

    function onLikeClick(storyId, card, btn) {
        if (btn.dataset.locking === "true") return;
        btn.dataset.locking = "true";
        toggleLike(storyId).then(function (resp) {
            btn.dataset.locking = "false";
            if (!resp || !resp.ok) return;
            var like = resp.like || {};
            if (!like.ok) { toast(like.reason || "操作失败"); return; }
            var liked = Boolean(like.liked);
            var count = Number(like.count || 0);
            btn.classList.toggle("is-liked", liked);
            btn.setAttribute("aria-pressed", liked ? "true" : "false");
            btn.title = liked ? "取消点赞" : "点赞";
            var icon = btn.querySelector(".celebrate-wall-act-icon");
            if (icon) icon.textContent = liked ? "♥" : "♡";
            var num = btn.querySelector('[data-num="like"]');
            if (num) num.textContent = formatNum(count);
            // Phase 5b：点赞抽奖结果
            if (liked && resp.lottery && typeof window.celebrateShowLottery === "function") {
                window.celebrateShowLottery(resp.lottery, "like");
            }
        }).catch(function (err) {
            btn.dataset.locking = "false";
            toast((err && err.message) || "点赞失败");
        });
    }

    function onCommentToggle(storyId, card) {
        var box = card.querySelector('.celebrate-wall-comments');
        if (!box) return;
        if (state.openCommentIds.has(storyId)) {
            state.openCommentIds.delete(storyId);
            box.hidden = true;
            return;
        }
        state.openCommentIds.add(storyId);
        box.hidden = false;
        if (box.dataset.loaded === "true") return;
        renderCommentSkeleton(box);
        loadComments(storyId, box);
    }

    function renderCommentSkeleton(box) {
        box.innerHTML =
            '<div class="celebrate-wall-comments-list">加载中…</div>' +
            '<div class="celebrate-wall-comment-composer">' +
              '<input class="celebrate-wall-comment-input" type="text" maxlength="200" placeholder="说点什么…（最多 200 字）" />' +
              '<button class="celebrate-wall-comment-submit" type="button">发送</button>' +
            '</div>';
    }

    function loadComments(storyId, box) {
        fetchComments(storyId, null).then(function (data) {
            box.dataset.loaded = "true";
            var list = box.querySelector('.celebrate-wall-comments-list');
            if (!list) return;
            var comments = (data && data.comments) || [];
            if (!comments.length) {
                list.innerHTML = '<div class="celebrate-wall-comment-empty">还没有评论，做第一个吧。</div>';
            } else {
                list.innerHTML = comments.map(function (c) {
                    return (
                      '<div class="celebrate-wall-comment-item">' +
                        '<span class="celebrate-wall-comment-name">' + escapeHtml(c.display_name || "匿名同行者") + '</span>' +
                        '<span class="celebrate-wall-comment-text">' + escapeHtml(c.content) + '</span>' +
                      '</div>'
                    );
                }).join("");
            }
            // 绑发送
            var input = box.querySelector('.celebrate-wall-comment-input');
            var btn = box.querySelector('.celebrate-wall-comment-submit');
            if (!input || !btn) return;
            function send() {
                var v = (input.value || "").trim();
                if (!v) { toast("评论不能为空"); return; }
                btn.disabled = true; btn.textContent = "发送中…";
                submitComment(storyId, v).then(function (resp) {
                    btn.disabled = false; btn.textContent = "发送";
                    if (!resp || !resp.ok) return;
                    var c = resp.comment || {};
                    if (!c.ok) {
                        toast(c.hint || c.reason || "评论失败");
                        return;
                    }
                    input.value = "";
                    // 重新拉评论 + 更新计数
                    box.dataset.loaded = "false";
                    loadComments(storyId, box);
                    bumpCommentCount(storyId, +1);
                    toast("评论成功");
                }).catch(function (err) {
                    btn.disabled = false; btn.textContent = "发送";
                    toast((err && err.message) || "评论失败");
                });
            }
            btn.addEventListener("click", send);
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            });
        }).catch(function () {
            box.dataset.loaded = "true";
            var list = box.querySelector('.celebrate-wall-comments-list');
            if (list) list.innerHTML = '<div class="celebrate-wall-comment-empty">评论加载失败，请稍后再试。</div>';
        });
    }

    function bumpCommentCount(storyId, delta) {
        var card = grid && grid.querySelector('[data-story-id="' + storyId + '"]');
        if (!card) return;
        var num = card.querySelector('[data-num="comment"]');
        if (!num) return;
        var current = Number(num.textContent.replace(/[万k]/g, "")) || 0;
        // 简单递增（精度损失可接受，刷新页面会修正）
        num.textContent = formatNum(current + delta);
    }

    // ---------- 分页 ----------
    function ensureLoadMore() {
        if (!grid) return;
        if (!loadMoreBtn) {
            loadMoreBtn = document.createElement("button");
            loadMoreBtn.className = "celebrate-wall-load-more";
            loadMoreBtn.type = "button";
            loadMoreBtn.textContent = "展开更多故事";
            loadMoreBtn.addEventListener("click", function () { loadNextPage(); });
            grid.parentNode.appendChild(loadMoreBtn);
        }
        if (!sentryEl) {
            sentryEl = document.createElement("div");
            sentryEl.className = "celebrate-wall-sentry";
            sentryEl.setAttribute("aria-hidden", "true");
            grid.parentNode.appendChild(sentryEl);
            if ("IntersectionObserver" in window) {
                sentryObserver = new IntersectionObserver(function (entries) {
                    entries.forEach(function (entry) {
                        if (entry.isIntersecting && state.hasMore && !state.loading) {
                            loadNextPage();
                        }
                    });
                }, { rootMargin: "200px 0px" });
                sentryObserver.observe(sentryEl);
            }
        }
        if (!state.hasMore) {
            loadMoreBtn.style.display = "none";
            sentryEl.style.display = "none";
            if (state.stories.length) {
                if (!grid.parentNode.querySelector(".celebrate-wall-end-hint")) {
                    var end = document.createElement("div");
                    end.className = "celebrate-wall-end-hint";
                    end.textContent = "—— 已显示全部 " + state.stories.length + " 条故事 ——";
                    grid.parentNode.appendChild(end);
                }
            }
        } else {
            loadMoreBtn.style.display = "";
            sentryEl.style.display = "";
        }
    }

    function loadNextPage() {
        if (state.loading || !state.hasMore) return;
        state.loading = true;
        if (loadMoreBtn) { loadMoreBtn.disabled = true; loadMoreBtn.textContent = "加载中…"; }
        fetchList(state.beforeId).then(function (data) {
            state.loading = false;
            if (loadMoreBtn) { loadMoreBtn.disabled = false; loadMoreBtn.textContent = "展开更多故事"; }
            if (!data || !data.ok) return;
            var stories = data.stories || [];
            state.stories = state.stories.concat(stories);
            state.hasMore = Boolean(data.has_more);
            state.beforeId = data.next_before_id ||
                (stories.length ? stories[stories.length - 1].id : state.beforeId);
            render(false);
        }).catch(function (err) {
            state.loading = false;
            if (loadMoreBtn) { loadMoreBtn.disabled = false; loadMoreBtn.textContent = "重试加载"; }
            console.warn("[wall v2] loadNextPage failed", err);
        });
    }

    // ---------- 浏览观察 ----------
    function setupViewObserver() {
        if (!("IntersectionObserver" in window)) return;
        viewObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var card = entry.target;
                var id = Number(card.getAttribute("data-story-id"));
                if (!id || state.viewedIds.has(id)) return;
                recordView(id);
                viewObserver.unobserve(card);
            });
        }, { threshold: 0.5 });
    }

    // ---------- Public reload ----------
    window.__cancriWallV2Reload = function () {
        state.stories = [];
        state.beforeId = null;
        state.hasMore = true;
        state.openCommentIds.clear();
        if (grid) grid.innerHTML = '<div class="celebrate-wall-empty">正在加载故事…</div>';
        loadNextPage();
    };

    function boot() {
        if (!ensureContainer()) return;
        setupViewObserver();
        loadNextPage();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
