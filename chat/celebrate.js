/* ============================================================
 * Cancri / NexusVAI 满月庆典 · 主交互脚本
 * 2026-05-25 · D-4
 *
 * 包含：
 *   1. 主题切换（与主站 localStorage 'cancri-theme' 对齐）
 *   2. 倒计时（5/29 00:00 UTC+8）
 *   3. 数字看板（fetch celebrate-stats + countup 动画 + 静态 fallback）
 *   4. 福利卡片激活控制（5/29 后 enable）
 *   5. 故事墙（提交 + 列表 + 字数统计）
 *   6. 邀请链接生成
 *
 * 设计原则：所有 fetch 均有 try/catch + 快照兜底，
 * 后端 100% 挂掉时页面静态部分仍可见。
 * ============================================================ */

(function () {
    "use strict";

    // ---------- 常量 ----------
    var SUPABASE_BASE = "https://diusqgphvybnzazgopor.supabase.co/functions/v1";
    var MOON_TS_UTC = Date.UTC(2026, 4, 28, 16, 0, 0); // 2026-05-29 00:00 UTC+8 = 5-28 16:00 UTC
    var THEME_KEY = "cancri-theme";
    var SNAPSHOT_URL = "./celebrate_snapshot.json?v=2026-05-25";

    // 静态兜底数据（snapshot.json 失败时使用）
    // 当前值为 2026-05-25 12:48 (UTC+8) 修复重复计算后的生产快照
    var FALLBACK_SNAPSHOT = {
        users: 2424,
        conversations: 5361,
        tokens: 283856360,
        models: 91,
        snapshot_at: "2026-05-25T12:48:57+08:00",
        source: "fallback"
    };

    // ---------- 工具函数 ----------
    function $(sel, root) {
        return (root || document).querySelector(sel);
    }
    function $$(sel, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(sel));
    }

    function formatBigNumber(n) {
        if (n == null || isNaN(n)) return "—";
        n = Number(n);
        if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
        if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1) + "万";
        return n.toLocaleString("zh-CN");
    }

    function clamp(n, min, max) {
        return Math.max(min, Math.min(max, n));
    }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    // ---------- 1. 主题：本页锁定 dark，忽略 localStorage / prefers-color-scheme ----------
    function initTheme() {
        applyTheme("dark");
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (_) {}
    }

    // ---------- 2. 倒计时 ----------
    function initCountdown() {
        var root = $("#celebrateCountdown");
        var hint = $("#celebrateCountdownHint");
        if (!root) return;

        var nums = {
            days: $('[data-countdown-num="days"]', root),
            hours: $('[data-countdown-num="hours"]', root),
            minutes: $('[data-countdown-num="minutes"]', root),
            seconds: $('[data-countdown-num="seconds"]', root)
        };
        var timerId = null;

        function tick() {
            var diff = MOON_TS_UTC - Date.now();
            if (diff <= 0) {
                // —— 倒计时归零 ——
                // 2026-05-27 修复：原来从不 clearInterval，倒计时结束后 tick
                // 仍每秒调一次 enableMoonDayBenefits，为轮盘按钮叠加
                // click 监听器，一次点击会触发多次 toast。
                if (timerId) {
                    clearInterval(timerId);
                    timerId = null;
                }
                root.setAttribute("data-state", "ended");
                if (hint) {
                    hint.textContent = "满月好，克劳姆。今天与你同行已是第 30 天。";
                }
                Object.keys(nums).forEach(function (k) {
                    if (nums[k]) nums[k].textContent = "—";
                });
                var accent = $(".celebrate-hero-title-line--accent");
                if (accent) {
                    accent.textContent = "终于走到满月这一天";
                }
                enableMoonDayBenefits();
                return;
            }

            var totalSec = Math.floor(diff / 1000);
            var days = Math.floor(totalSec / 86400);
            var hours = Math.floor((totalSec % 86400) / 3600);
            var minutes = Math.floor((totalSec % 3600) / 60);
            var seconds = totalSec % 60;

            if (nums.days) nums.days.textContent = String(days).padStart(2, "0");
            if (nums.hours) nums.hours.textContent = String(hours).padStart(2, "0");
            if (nums.minutes) nums.minutes.textContent = String(minutes).padStart(2, "0");
            if (nums.seconds) nums.seconds.textContent = String(seconds).padStart(2, "0");
        }

        tick();
        timerId = setInterval(tick, 1000);
    }

    // ---------- 3. 数字看板 ----------
    function initCountup() {
        var grid = $("#countupGrid");
        if (!grid) return;

        fetchStats()
            .then(function (data) {
                renderCountup(grid, data);
            })
            .catch(function () {
                renderCountup(grid, FALLBACK_SNAPSHOT);
            });
    }

    function fetchStats() {
        // 优先调用线上 edge function；失败则尝试加载 snapshot json；最后 fallback hardcoded
        return new Promise(function (resolve, reject) {
            var controller = new AbortController();
            var timeoutId = setTimeout(function () {
                controller.abort();
            }, 4500);

            fetch(SUPABASE_BASE + "/celebrate-stats", {
                method: "GET",
                signal: controller.signal,
                headers: { Accept: "application/json" }
            })
                .then(function (res) {
                    clearTimeout(timeoutId);
                    if (!res.ok) throw new Error("celebrate-stats:" + res.status);
                    return res.json();
                })
                .then(function (data) {
                    if (data && (data.users != null || data.tokens != null)) {
                        data.source = data.source || "live";
                        resolve(data);
                    } else {
                        throw new Error("invalid-payload");
                    }
                })
                .catch(function () {
                    // 二级 fallback：静态快照 json
                    fetch(SNAPSHOT_URL, { cache: "no-cache" })
                        .then(function (r) {
                            if (!r.ok) throw new Error("snapshot:" + r.status);
                            return r.json();
                        })
                        .then(function (snap) {
                            snap.source = "snapshot";
                            resolve(snap);
                        })
                        .catch(reject);
                });
        });
    }

    function renderCountup(grid, data) {
        grid.setAttribute("data-snapshot-source", data.source || "unknown");
        var keys = ["users", "conversations", "tokens", "models"];
        keys.forEach(function (k) {
            var el = grid.querySelector('[data-countup-key="' + k + '"]');
            if (!el) return;
            var target = Number(data[k] || 0);
            animateCountup(el, target, 1600);
        });
    }

    function animateCountup(el, target, duration) {
        var start = 0;
        var t0 = performance.now();
        function step(now) {
            var t = clamp((now - t0) / duration, 0, 1);
            var v = start + (target - start) * easeOutCubic(t);
            el.textContent = formatBigNumber(Math.round(v));
            if (t < 1) requestAnimationFrame(step);
            else el.textContent = formatBigNumber(target);
        }
        requestAnimationFrame(step);
    }

    // ---------- 4. 福利按钮控制 ----------
    // 2026-05-27 修复：加 data-wired 幂等标记。倒计时归零的 tick 与 boot()
    // 都会调本函数，原实现里轮盘按钮没 { once: true }，会被叠加多个监听器。
    // 改 once:true 也只缓解徽章，且新一轮调用又会重新加一个 once 监听器。
    // 用 data-wired 一次性收口最干净。
    function enableMoonDayBenefits() {
        $$("[data-action='claim-badge']").forEach(function (btn) {
            btn.removeAttribute("disabled");
            btn.textContent = "立即领取徽章";
            if (btn.dataset.wired === "true") return;
            btn.dataset.wired = "true";
            btn.addEventListener("click", onClaimBadge);
        });
        $$("[data-action='open-wheel']").forEach(function (btn) {
            btn.removeAttribute("disabled");
            btn.textContent = "立即抽奖";
            if (btn.dataset.wired === "true") return;
            btn.dataset.wired = "true";
            btn.addEventListener("click", onOpenWheel);
        });
    }

    function onClaimBadge() {
        callSigninAction("claim_badge")
            .then(function (resp) {
                var badge = resp && resp.badge;
                if (!badge) { showToast("领取失败　请稍后再试"); return; }
                if (badge.ok && !badge.already) {
                    showToast("创世满月徽章已收下 · 永久挂在你的账户上");
                } else if (badge.ok && badge.already) {
                    showToast("你已经领取过创世满月徽章");
                } else if (badge.reason === "not_moon_day") {
                    showToast("徽章仅限 5/29 当天可领");
                } else {
                    showToast("领取失败：" + (badge.reason || "unknown"));
                }
            })
            .catch(function (err) {
                showToast(err && err.message ? err.message : "领取失败");
            });
    }

    function onOpenWheel() {
        openWheelModal();
    }

    function initInviteCta() {
        $$("[data-action='open-invite']").forEach(function (btn) {
            btn.addEventListener("click", onGenerateInvite);
        });
    }

    function onGenerateInvite() {
        callSigninAction("get_invite")
            .then(function (resp) {
                var invite = resp && resp.invite;
                if (!invite || !invite.invite_url) {
                    showToast("生成邀请链接失败，请先登录");
                    return;
                }
                copyToClipboard(invite.invite_url);
                var s = invite.summary || { total: 0, qualified: 0, paid: 0 };
                showToast(
                    "邀请链接已复制 · 已邀 " + s.total + " 人 / 合格 " + s.qualified + " / 付费 " + s.paid
                );
            })
            .catch(function (err) {
                // 未登录兑底：给个通用链接
                if (err && err.notLoggedIn) {
                    copyToClipboard("https://www.nexusvai.xyz/chat/?invite=moon2026");
                    showToast("未登录临时链接已复制；登录后点击可换为专属邀请码");
                    return;
                }
                showToast(err && err.message ? err.message : "生成邀请链接失败");
            });
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
        }
    }

    // ---------- 5. 故事墙 ----------
    function initWall() {
        var input = $("#wallInput");
        var counter = $("#wallCharCount");
        var submitBtn = $("#wallSubmitBtn");
        var grid = $("#wallGrid");

        if (input && counter) {
            input.addEventListener("input", function () {
                counter.textContent = String(input.value.length);
            });
        }

        if (submitBtn && input) {
            submitBtn.addEventListener("click", function () {
                var content = (input.value || "").trim();
                if (!content) {
                    showToast("写一句你想说的话吧");
                    return;
                }
                if (content.length < 4) {
                    showToast("至少 4 个字哦");
                    return;
                }
                // 2026-05-28 Phase 5：先拿已上传图片 URL，再提交
                var uploadsApi = window.__CELEBRATE_UPLOADS__;
                var collectImages = uploadsApi
                    ? uploadsApi.collect()
                    : Promise.resolve([]);
                submitBtn.disabled = true;
                var origText = submitBtn.textContent;
                submitBtn.textContent = "提交中…";
                collectImages
                    .then(function (urls) {
                        return submitStory(content, urls || []);
                    })
                    .then(function () {
                        input.value = "";
                        if (counter) counter.textContent = "0";
                        if (uploadsApi) uploadsApi.reset();
                        showToast("提交成功，等待审核通过后将出现在故事墙");
                        if (typeof window.__cancriWallV2Reload === "function") {
                            setTimeout(window.__cancriWallV2Reload, 800);
                        }
                    })
                    .catch(function (err) {
                        var msg = err && err.message ? err.message : "提交失败，请稍后再试";
                        showToast(msg);
                    })
                    .then(function () {
                        submitBtn.disabled = false;
                        submitBtn.textContent = origText || "提交故事";
                    });
            });
        }

        if (grid) {
            loadWallStories(grid);
        }

        // 2026-05-28 Phase 4：故事墙「分享我的海报」快捷按钮
        // 行为：滚到 #poster 区域 → 触发同款下载按钮 click（如果 canvas 已就绪）
        var shareBtn = $("#wallSharePosterBtn");
        if (shareBtn) {
            shareBtn.addEventListener("click", function () {
                var posterSection = document.getElementById("poster");
                if (posterSection) {
                    posterSection.scrollIntoView({ behavior: "smooth", block: "start" });
                }
                // 给海报一个聚焦动画 + 触发下载
                var downloadBtn = document.getElementById("posterDownloadBtn");
                if (!downloadBtn) {
                    showToast("海报区域还在初始化，请稍后再试");
                    return;
                }
                // 等滚动稳定后再触发下载，避免 mobile 体验割裂
                setTimeout(function () {
                    downloadBtn.click();
                    showToast("正在导出你的满月海报…");
                }, 600);
            });
        }
    }

    function submitStory(content, imageUrls) {
        // 走 celebrate-signin?action=wall_submit（需登录 JWT）
        var extras = { content: content };
        if (Array.isArray(imageUrls) && imageUrls.length) {
            extras.image_urls = imageUrls.slice(0, 3);
        }
        var fp = window.__CANCRI_FINGERPRINT__ ||
            (window.localStorage && localStorage.getItem("cancri_fp_visitor_id"));
        if (fp) extras.fingerprint = fp;
        return callSigninAction("wall_submit", extras).then(function (resp) {
            var wall = resp && resp.wall;
            if (!wall) throw new Error("提交失败，请稍后再试");
            if (wall.ok) return wall;
            if (wall.reason === "banned") throw new Error("你已被禁言");
            if (wall.reason === "too_many_images") throw new Error("最多 3 张图片");
            if (wall.reason === "already_today") throw new Error("今天已经提交过一条啦");
            if (wall.reason === "too_short") throw new Error("至少 4 个字哦");
            if (wall.reason === "too_long") throw new Error("最多 300 字");
            throw new Error("提交未生效：" + (wall.reason || "unknown"));
        });
    }

    function loadWallStories(grid) {
        // 2026-05-28 v2 接管：若 celebrate_wall_v2.js 已就绪，则跳过这里的渲染。
        if (window.__CANCRI_WALL_V2__) return;
        fetch(SUPABASE_BASE + "/celebrate-stats", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                apikey: window.__SUPABASE_ANON_KEY__ || ""
            },
            body: JSON.stringify({ action: "wall_list", limit: 18 })
        })
            .then(function (res) {
                if (!res.ok) throw new Error("wall-list:" + res.status);
                return res.json();
            })
            .then(function (data) {
                var stories = (data && data.stories) || [];
                if (!stories.length) {
                    renderWall(grid, getFallbackStories());
                } else {
                    renderWall(grid, stories);
                }
            })
            .catch(function () {
                renderWall(grid, getFallbackStories());
            });
    }

    function getFallbackStories() {
        // 4 条种子故事，活动当天可以由真实数据替换
        return [
            {
                content: "凌晨三点写论文，是 Cancri 帮我顶住的。",
                user_name: "匿名 · 第 7 天用户",
                featured: true
            },
            {
                content: "本来只是想试试 DeepSeek，结果发现还能调 Opus，惊喜。",
                user_name: "匿名 · 第 14 天用户",
                featured: false
            },
            {
                content: "在 Cancri 上第一次跟自己的笔记对话，像翻开自己被遗忘的日记。",
                user_name: "匿名 · 第 21 天用户",
                featured: false
            },
            {
                content: "9 块 9 一个月的订阅，真的让我相信好工具不一定贵。",
                user_name: "匿名 · 第 28 天用户",
                featured: false
            }
        ];
    }

    function renderWall(grid, stories) {
        grid.setAttribute("data-source", stories && stories.length ? "loaded" : "empty");
        if (!stories || !stories.length) {
            grid.innerHTML =
                '<div class="celebrate-wall-empty">还没有故事，做第一个写下来的人吧。</div>';
            return;
        }
        var html = stories
            .map(function (s) {
                var featuredClass = s.featured ? " celebrate-wall-card--featured" : "";
                var badge = s.featured
                    ? '<span class="celebrate-wall-card-badge">精选</span>'
                    : "";
                return (
                    '<article class="celebrate-wall-card' +
                    featuredClass +
                    '">' +
                    '<p class="celebrate-wall-card-quote">' +
                    escapeHtml(s.content) +
                    "</p>" +
                    '<div class="celebrate-wall-card-meta">' +
                    '<span class="celebrate-wall-card-name">' +
                    escapeHtml(s.user_name || "匿名") +
                    "</span>" +
                    badge +
                    "</div>" +
                    "</article>"
                );
            })
            .join("");
        grid.innerHTML = html;
    }

    function escapeHtml(str) {
        if (str == null) return "";
        return String(str).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    // ---------- 5b. 满月签到 ----------
    var SIGNIN_URL = SUPABASE_BASE + "/celebrate-signin";
    var _supabaseClient = null;

    function getSupabaseClient() {
        if (_supabaseClient) return _supabaseClient;
        var url = window.__SUPABASE_URL__;
        var key = window.__SUPABASE_ANON_KEY__;
        if (!url || !key || !window.supabase || !window.supabase.createClient) return null;
        _supabaseClient = window.supabase.createClient(url, key, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: false,
                storageKey: "cancri_supabase_auth"
            }
        });
        return _supabaseClient;
    }

    function getAccessToken() {
        var sb = getSupabaseClient();
        if (!sb) return Promise.resolve(null);
        return sb.auth.getSession()
            .then(function (res) {
                var session = res && res.data && res.data.session;
                return session && session.access_token ? session.access_token : null;
            })
            .catch(function () { return null; });
    }

    function initSignin() {
        var btn = $("#signinBtn");
        if (!btn) return;
        btn.addEventListener("click", function () {
            if (btn.hasAttribute("disabled")) return;
            doSignin();
        });
        // supabase-js 是 defer，可能比 DOMContentLoaded 晚点成为可用，轻重试
        var attempts = 0;
        (function tryFetch() {
            if (window.supabase && window.supabase.createClient) {
                fetchSigninStatus();
                return;
            }
            attempts++;
            if (attempts < 16) setTimeout(tryFetch, 200);
            else renderSigninState(null, "sdk_unavailable");
        })();
    }

    function fetchSigninStatus() {
        return getAccessToken().then(function (token) {
            if (!token) { renderSigninState(null, "not_logged_in"); return null; }
            return fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__
                },
                body: JSON.stringify({ action: "status" })
            }).then(function (res) {
                if (res.status === 401) { renderSigninState(null, "not_logged_in"); return null; }
                if (!res.ok) throw new Error("status:" + res.status);
                return res.json();
            }).then(function (data) {
                var status = data && data.status ? data.status : null;
                if (status) renderSigninState(status, null);
                return status;
            });
        }).catch(function (err) {
            console.warn("[celebrate-signin] status fetch failed", err);
            renderSigninState(null, "error");
        });
    }

    function doSignin() {
        var btn = $("#signinBtn");
        if (!btn) return;
        btn.setAttribute("disabled", "");
        btn.setAttribute("data-state", "loading");
        var labelEl = btn.querySelector(".celebrate-signin-btn-text");
        if (labelEl) labelEl.textContent = "签到中…";

        getAccessToken().then(function (token) {
            if (!token) {
                showToast("请先登录后再签到");
                renderSigninState(null, "not_logged_in");
                return null;
            }
            return fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__
                },
                body: JSON.stringify({ action: "signin" })
            }).then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
            }).then(function (resp) {
                var signin = resp.data && resp.data.signin;
                var status = resp.data && resp.data.status;
                if (resp.ok && signin) {
                    if (signin.ok) {
                        var msgParts = ["签到成功 · +" + formatBigNumber(signin.daily_reward || 0) + " token"];
                        if (signin.streak3_granted) msgParts.push("连签 3 天加送 " + formatBigNumber(signin.streak3_bonus || 0));
                        if (signin.pro_24h_granted) msgParts.push("24h Pro 体验已到账");
                        showToast(msgParts.join("，"));
                    } else if (signin.reason === "already_signed_today") {
                        showToast("今天已经签到啦");
                    } else if (signin.reason === "not_in_window") {
                        showToast("签到尚未开启，5/29 见");
                    } else {
                        showToast("签到未生效：" + (signin.reason || "unknown"));
                    }
                } else {
                    var errMsg = (resp.data && resp.data.message) || resp.status;
                    showToast("签到失败：" + errMsg);
                }
                if (status) renderSigninState(status, null);
            });
        }).catch(function (err) {
            console.warn("[celebrate-signin] signin failed", err);
            showToast("签到失败：网络异常，请稍后再试");
            renderSigninState(null, "error");
        });
    }

    function renderSigninState(status, fallbackKind) {
        var stage = $("#signinStage");
        var banner = $("#signinBannerText");
        var btn = $("#signinBtn");
        var hint = $("#signinBtnHint");
        var streakEl = $("#signinStreak");
        var totalEl = $("#signinTotalToday");
        var targetEl = $("#signinTarget");
        var fillEl = $("#signinProgressFill");
        var progressText = $("#signinProgressText");
        if (!stage) return;

        // 兑底态：未登录 / SDK 未就绪 / 错误
        if (!status) {
            var msg = "请先登录后查看签到状态";
            var hintMsg = "以使用 Cancri 账户签到领奖";
            var stateAttr = "not_logged_in";
            if (fallbackKind === "sdk_unavailable") {
                msg = "Supabase SDK 加载失败";
                hintMsg = "请刷新页面或检查网络";
                stateAttr = "error";
            } else if (fallbackKind === "error") {
                msg = "签到状态加载失败";
                hintMsg = "可稍后刷新页面重试";
                stateAttr = "error";
            }
            stage.setAttribute("data-state", stateAttr);
            if (banner) banner.textContent = msg;
            if (hint) hint.textContent = hintMsg;
            if (btn) {
                btn.setAttribute("disabled", "");
                btn.setAttribute("data-state", "idle");
                var t = btn.querySelector(".celebrate-signin-btn-text");
                if (t) t.textContent = "今日签到";
            }
            return;
        }

        var inWindow = !!status.in_window;
        var signedToday = !!status.signed_today;
        var milestoneUnlocked = !!status.milestone_unlocked;
        var target = status.signin_target || 500;
        var total = status.total_today || 0;

        if (streakEl) streakEl.textContent = String(status.streak || 0);
        if (totalEl) totalEl.textContent = String(total);
        if (targetEl) targetEl.textContent = String(target);

        var pct = clamp(Number(status.progress_pct || 0), 0, 100);
        if (fillEl) fillEl.style.width = pct + "%";
        if (progressText) {
            if (milestoneUnlocked) {
                progressText.textContent = "全员加赠已解锁 · 100 万 token 于 23:30 自动结算";
            } else {
                progressText.textContent = "全员加赠进度 " + pct + "% · 还差 " + Math.max(0, target - total) + " 人";
            }
        }

        var btnText = btn && btn.querySelector(".celebrate-signin-btn-text");

        if (!inWindow) {
            stage.setAttribute("data-state", "not_in_window");
            if (banner) banner.textContent = "签到将于 5/29 0:00 (UTC+8) 开启";
            if (btn) { btn.setAttribute("disabled", ""); btn.setAttribute("data-state", "idle"); }
            if (btnText) btnText.textContent = "5/29 开启";
            if (hint) hint.textContent = "倒计时归零自动激活";
        } else if (signedToday) {
            stage.setAttribute("data-state", milestoneUnlocked ? "unlocked" : "signed");
            if (banner) banner.textContent = milestoneUnlocked
                ? "今日全员加赠已解锁，所有签到用户加赠 100 万 token"
                : "已签到 · 明日继续，连签 3 天送 200 万 token";
            if (btn) { btn.setAttribute("disabled", ""); btn.setAttribute("data-state", "signed"); }
            if (btnText) btnText.textContent = "今日已签";
            if (hint) hint.textContent = "明日 0:00 后可再签";
        } else {
            stage.setAttribute("data-state", "active");
            if (banner) banner.textContent = "今日满月，请签到 · 首签自动送 24h Pro";
            if (btn) { btn.removeAttribute("disabled"); btn.setAttribute("data-state", "idle"); }
            if (btnText) btnText.textContent = "今日签到";
            if (hint) hint.textContent = "每日 50 万 token，连签 3 天加 200 万";
        }

        // 日历
        var dates = status.my_signin_dates || [];
        var todayStr = status.today || "";
        $$(".celebrate-signin-calendar-cell[data-date]").forEach(function (cell) {
            var d = cell.getAttribute("data-date");
            if (dates.indexOf(d) >= 0) cell.setAttribute("data-signed", "true");
            else cell.removeAttribute("data-signed");
            if (d === todayStr) cell.setAttribute("data-today", "true");
            else cell.removeAttribute("data-today");
        });
    }

    // ---------- 5c. 通用 RPC 调用 + 转盘弹框 ----------
    function callSigninAction(action, extras) {
        return getAccessToken().then(function (token) {
            if (!token) {
                var err = new Error("请先登录后再操作");
                err.notLoggedIn = true;
                throw err;
            }
            var body = Object.assign({ action: action }, extras || {});
            return fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__
                },
                body: JSON.stringify(body)
            }).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (data) {
                    if (!res.ok) {
                        var e = new Error((data && data.message) || ("HTTP " + res.status));
                        e.notLoggedIn = res.status === 401;
                        throw e;
                    }
                    return data;
                });
            });
        });
    }

    var PRIZE_MAP = {
        topup_1m:     { icon: "", title: "+1M token", sub: "已自动到账" },
        topup_5m:     { icon: "", title: "+5M token", sub: "已自动到账" },
        topup_10m:    { icon: "", title: "+10M token", sub: "已自动到账" },
        pro_week:     { icon: "", title: "Pro 周卡", sub: "7 天 Pro 已激活" },
        opus_voucher: { icon: "", title: "Opus 调用券", sub: "1 张已发到账户" },
        thanks:       { icon: "", title: "感谢光临", sub: "明天再试试好运气" }
    };

    function openWheelModal() {
        if ($("#celebrateWheelModal")) return;
        var modal = document.createElement("div");
        modal.id = "celebrateWheelModal";
        modal.className = "celebrate-wheel-modal";
        modal.innerHTML =
            '<div class="celebrate-wheel-modal-card">' +
            '<button class="celebrate-wheel-close" type="button" aria-label="关闭">×</button>' +
            '<h3 class="celebrate-wheel-title">满月转盘</h3>' +
            '<p class="celebrate-wheel-subtitle">每天 1 次 · 5/29 - 6/4 限定 · 概率公示</p>' +
            '<div class="celebrate-wheel-stage" data-state="ready">' +
            '<div class="celebrate-wheel-spinner" aria-hidden="true"></div>' +
            '<div class="celebrate-wheel-result"></div>' +
            "</div>" +
            '<div class="celebrate-wheel-odds">' +
            '<span>1M·40%</span><span>5M·25%</span><span>10M·10%</span><span>Pro 周·3%</span><span>Opus·7%</span><span>谢·15%</span>' +
            "</div>" +
            '<div class="celebrate-wheel-foot">' +
            '<button class="celebrate-btn celebrate-btn--primary celebrate-wheel-spin-btn" data-wheel-act="spin" type="button">立即抽奖</button>' +
            "</div>" +
            "</div>";
        document.body.appendChild(modal);

        var closeBtn = modal.querySelector(".celebrate-wheel-close");
        var spinBtn = modal.querySelector("[data-wheel-act='spin']");
        var stage = modal.querySelector(".celebrate-wheel-stage");
        var resultEl = modal.querySelector(".celebrate-wheel-result");

        function closeModal() {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        }
        closeBtn.addEventListener("click", closeModal);
        modal.addEventListener("click", function (e) {
            if (e.target === modal) closeModal();
        });

        spinBtn.addEventListener("click", function () {
            spinBtn.disabled = true;
            spinBtn.textContent = "抽奖中...";
            stage.setAttribute("data-state", "spinning");
            resultEl.innerHTML = "";

            var renderResult = function (icon, title, sub, closeText) {
                stage.setAttribute("data-state", "result");
                var iconHtml = icon ? '<div class="celebrate-wheel-result-icon">' + icon + "</div>" : "";
                resultEl.innerHTML =
                    iconHtml +
                    '<div class="celebrate-wheel-result-title">' + escapeHtml(title) + "</div>" +
                    '<div class="celebrate-wheel-result-sub">' + escapeHtml(sub) + "</div>";
                spinBtn.textContent = closeText;
                spinBtn.onclick = closeModal;
                spinBtn.disabled = false;
            };

            callSigninAction("spin")
                .then(function (resp) {
                    var spin = resp && resp.spin;
                    setTimeout(function () {
                        if (!spin) {
                            renderResult("", "抽奖失败", "请稍后再试", "知道了");
                            return;
                        }
                        if (!spin.ok) {
                            if (spin.reason === "already_spun_today") {
                                renderResult("", "今天已抽过", "明日 0:00 后再来", "知道了");
                            } else if (spin.reason === "not_in_window" || spin.reason === "wheel_disabled") {
                                renderResult("", "转盘尚未开启", "5/29 0:00 开放", "知道了");
                            } else {
                                renderResult("", "抽奖失败", spin.reason || "unknown", "知道了");
                            }
                            return;
                        }
                        var p = PRIZE_MAP[spin.prize_kind] || { icon: "", title: spin.prize_kind, sub: "" };
                        renderResult(p.icon, p.title, p.sub, "美滋滋，关闭");
                    }, 1500);
                })
                .catch(function (err) {
                    setTimeout(function () {
                        var msg = err && err.notLoggedIn ? "请先登录" : (err && err.message ? err.message : "网络异常");
                        renderResult("", "抽奖失败", msg, "知道了");
                    }, 600);
                });
        });
    }

    // ---------- 6. Toast ----------
    var toastTimer = null;
    function showToast(msg) {
        var existing = $("#celebrateToast");
        if (existing) existing.parentNode.removeChild(existing);

        var t = document.createElement("div");
        t.id = "celebrateToast";
        t.textContent = msg;
        t.style.cssText =
            "position:fixed;left:50%;bottom:32px;transform:translateX(-50%);" +
            "background:rgba(20,20,20,0.92);color:#fff;padding:12px 20px;" +
            "border-radius:999px;font-size:14px;z-index:9999;" +
            "max-width:88vw;text-align:center;line-height:1.5;" +
            "box-shadow:0 8px 24px rgba(0,0,0,0.25);" +
            "opacity:0;transition:opacity 0.22s ease, transform 0.22s ease;";
        document.body.appendChild(t);
        requestAnimationFrame(function () {
            t.style.opacity = "1";
        });
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            t.style.opacity = "0";
            setTimeout(function () {
                if (t.parentNode) t.parentNode.removeChild(t);
            }, 260);
        }, 3200);
    }

    // ---------- 移动端汉堡抽屉 ----------
    function initMobileDrawer() {
        var btn = $(".celebrate-nav-hamburger");
        var drawer = $("#celebrateMobileDrawer");
        if (!btn || !drawer) return;
        if (btn.dataset.wired === "true") return;
        btn.dataset.wired = "true";

        var open = false;
        function setOpen(v) {
            open = v;
            btn.setAttribute("aria-expanded", v ? "true" : "false");
            drawer.setAttribute("aria-hidden", v ? "false" : "true");
            // 锁主体滚动：打开时禁止页面在背后滚
            document.body.style.overflow = v ? "hidden" : "";
        }
        btn.addEventListener("click", function () { setOpen(!open); });

        // 分组折叠按钮：切换 aria-expanded，CSS 用 grid-template-rows 做高度过渡
        $$(".celebrate-mobile-group-summary", drawer).forEach(function (summary) {
            summary.addEventListener("click", function () {
                var expanded = summary.getAttribute("aria-expanded") === "true";
                summary.setAttribute("aria-expanded", expanded ? "false" : "true");
            });
        });

        // 点击抽屉里的链接自动关闭（锚点跳转后不挡视野）
        drawer.addEventListener("click", function (e) {
            var a = e.target.closest && e.target.closest("a");
            if (a) setOpen(false);
        });
        // 窗口拉宽到桌面区时强制收起，避免 resize 后状态错乱
        window.addEventListener("resize", function () {
            if (window.innerWidth >= 900 && open) setOpen(false);
        });
        // Esc 关闭
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && open) setOpen(false);
        });
    }

    // ---------- Boot ----------
    function boot() {
        initTheme();
        initCountdown();
        initCountup();
        initInviteCta();
        initWall();
        initSignin();
        initMobileDrawer();

        // 5/29 之前福利按钮 disabled 状态保持；倒计时归零会触发 enableMoonDayBenefits
        var nowReady = Date.now() >= MOON_TS_UTC;
        if (nowReady) enableMoonDayBenefits();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
        boot();
    }
})();
