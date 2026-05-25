/* ============================================================
 * Cancri 满月海报生成器
 * 2026-05-25 · D-4 stub → 2026-05-26 D-2 接入真实数据
 *
 * 行为：
 *   - 立即绘制游客版（满月图 + 文案 + 日期）
 *   - 登录用户：调 celebrate-signin?action=poster_data 拉数据后重绘
 *     画名字 / 注册天数 / 对话数 / 总 token / 徽章 / 签到数
 * ============================================================ */

(function () {
    "use strict";

    var SIGNIN_URL = "https://diusqgphvybnzazgopor.supabase.co/functions/v1/celebrate-signin";

    function $(sel) {
        return document.querySelector(sel);
    }

    function formatBigNumber(n) {
        if (n == null || isNaN(n)) return "—";
        n = Number(n);
        if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
        return String(n);
    }

    // 复用主站 supabase session（cancri_supabase_auth storageKey）
    var _supabaseClient = null;
    function getSupabase() {
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
        var sb = getSupabase();
        if (!sb) return Promise.resolve(null);
        return sb.auth.getSession().then(function (res) {
            return res && res.data && res.data.session ? res.data.session.access_token : null;
        }).catch(function () { return null; });
    }

    function fetchPosterData() {
        return getAccessToken().then(function (token) {
            if (!token) return null;
            var sb = getSupabase();
            var posterReq = fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__
                },
                body: JSON.stringify({ action: "poster_data" })
            }).then(function (res) {
                if (!res.ok) return null;
                return res.json();
            }).then(function (data) {
                return data && data.poster && data.poster.ok ? data.poster : null;
            });
            // 同时拉 supabase user metadata（头像 URL、中文名），后端 RPC 不收 avatar，这里合并
            var userReq = sb ? sb.auth.getUser().then(function (res) {
                var u = res && res.data && res.data.user;
                if (!u) return {};
                var meta = u.user_metadata || {};
                return {
                    avatar_url: meta.avatar_url || meta.picture || null,
                    full_name: meta.full_name || meta.name || null
                };
            }).catch(function () { return {}; }) : Promise.resolve({});
            return Promise.all([posterReq, userReq]).then(function (results) {
                var poster = results[0];
                var meta = results[1];
                if (!poster) return null;
                return Object.assign({}, poster, meta);
            });
        }).catch(function () { return null; });
    }

    // 预加载头像图（3s 超时、失败返 null，不阻塞海报绘制）
    function preloadAvatar(url) {
        return new Promise(function (resolve) {
            if (!url) return resolve(null);
            var img = new Image();
            var done = false;
            function finish(v) { if (done) return; done = true; resolve(v); }
            img.crossOrigin = "anonymous";
            img.onload = function () { finish(img); };
            img.onerror = function () { finish(null); };
            img.src = url;
            setTimeout(function () { finish(null); }, 3000);
        });
    }

    function drawPoster(canvas, options) {
        options = options || {};
        var ctx = canvas.getContext("2d");
        if (!ctx) return;

        var W = canvas.width;
        var H = canvas.height;
        var cx = W / 2;
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";

        // ── 颜色（与 celebrate 主题 token 对齐：抛弃橙色 accent，全黑/全白单色） ──
        var textColor = isDark ? "#f5f4ef" : "#29261b";
        var textSoft = isDark ? "#a6a39a" : "#656358";
        var textDim = isDark ? "rgba(245,244,239,0.42)" : "rgba(41,38,27,0.42)";
        var hairline = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)";
        var chipBg = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)";

        // ── 背景渐变 ──
        var bg = ctx.createLinearGradient(0, 0, 0, H);
        if (isDark) {
            bg.addColorStop(0, "#16161a");
            bg.addColorStop(1, "#0b0b0f");
        } else {
            bg.addColorStop(0, "#faf9f5");
            bg.addColorStop(1, "#efece2");
        }
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // ── 极淡星尘（仅深色，30 颗，分布全卡而不只是顶部，作为氛围底） ──
        if (isDark) {
            ctx.fillStyle = "rgba(255,255,255,0.28)";
            for (var i = 0; i < 32; i++) {
                var sx = Math.random() * W;
                var sy = Math.random() * H;
                var sr = Math.random() * 1.0 + 0.25;
                ctx.beginPath();
                ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ── 顶部 eyebrow（小字 mono） ──
        ctx.textAlign = "center";
        ctx.fillStyle = textDim;
        ctx.font = "500 15px 'JetBrains Mono', 'Inter', sans-serif";
        ctx.fillText("CHRONICLE  ·  DAY 30", cx, H * 0.14);

        // ── 顶部点缀线：两段细线夹一个圆点 ──
        var decoY = H * 0.18;
        ctx.strokeStyle = hairline;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W * 0.34, decoY);
        ctx.lineTo(W * 0.46, decoY);
        ctx.moveTo(W * 0.54, decoY);
        ctx.lineTo(W * 0.66, decoY);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = textSoft;
        ctx.arc(cx, decoY, 2, 0, Math.PI * 2);
        ctx.fill();

        // ── 巨字标题（serif，单色，纯排版） ──
        ctx.fillStyle = textColor;
        ctx.font = "600 76px 'Source Serif 4', Georgia, serif";
        ctx.fillText("命运的齿轮", cx, H * 0.38);

        // 强调线：斜体 + 同色（替代原橙色 accent，匹配新单色品牌）
        ctx.fillStyle = textColor;
        ctx.font = "italic 600 76px 'Source Serif 4', Georgia, serif";
        ctx.fillText("已经悄悄转动", cx, H * 0.47);

        // ── 日期带（mono，软色） ──
        ctx.fillStyle = textSoft;
        ctx.font = "500 16px 'JetBrains Mono', 'Inter', sans-serif";
        ctx.fillText("2026.04.29   —   2026.05.29", cx, H * 0.56);

        // ── 品牌副标（斜体衬线） ──
        ctx.fillStyle = textSoft;
        ctx.font = "italic 400 22px 'Source Serif 4', Georgia, serif";
        ctx.fillText("Cancri / NexusVAI  满月", cx, H * 0.63);

        // ── 中段分隔细线（上移为头像让位） ──
        ctx.strokeStyle = hairline;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W * 0.18, H * 0.665);
        ctx.lineTo(W * 0.82, H * 0.665);
        ctx.stroke();

        // ── 用户数据 / 游客版 ──
        var data = options.data;
        var userName = (data && (data.full_name || data.display_name)) || options.userName || "Welcome to the moon";

        if (data) {
            // 头像圆（64px）：有图进图；无图画渐变底 + 首字母
            var avSize = 64;
            var avX = cx;
            var avY = H * 0.725;

            ctx.save();
            ctx.beginPath();
            ctx.arc(avX, avY, avSize / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();

            if (options.avatarImg) {
                ctx.drawImage(options.avatarImg, avX - avSize / 2, avY - avSize / 2, avSize, avSize);
            } else {
                var grad = ctx.createLinearGradient(avX - avSize / 2, avY - avSize / 2, avX + avSize / 2, avY + avSize / 2);
                grad.addColorStop(0, isDark ? "#3a3a44" : "#dad8cd");
                grad.addColorStop(1, isDark ? "#22222a" : "#c0bda9");
                ctx.fillStyle = grad;
                ctx.fillRect(avX - avSize / 2, avY - avSize / 2, avSize, avSize);

                var initialSrc = data.email || userName || "U";
                var initial = String(initialSrc).trim().charAt(0).toUpperCase() || "U";
                ctx.fillStyle = textColor;
                ctx.font = "600 28px 'Source Serif 4', Georgia, serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(initial, avX, avY + 1);
                ctx.textBaseline = "alphabetic";
            }
            ctx.restore();

            // 头像 hairline 描边
            ctx.strokeStyle = hairline;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(avX, avY, avSize / 2, 0, Math.PI * 2);
            ctx.stroke();

            // 徐仮名 / display_name + 徽章
            ctx.fillStyle = textColor;
            ctx.font = "600 22px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(userName + (data.has_badge ? "  ●" : ""), cx, avY + avSize / 2 + 28);

            // 邮箱（mono、软色）
            if (data.email) {
                ctx.fillStyle = textSoft;
                ctx.font = "500 13px 'JetBrains Mono', 'Inter', sans-serif";
                ctx.fillText(data.email, cx, avY + avSize / 2 + 48);
            }

            // 4 个统计 chip
            var chips = [
                { label: "陪走天数", value: String(data.days_since || 0) + " 天" },
                { label: "对话总数", value: formatBigNumber(data.conversations || 0) },
                { label: "Token", value: formatBigNumber(data.total_tokens || 0) },
                { label: "签到", value: String(data.signin_count || 0) + " 天" }
            ];

            var chipH = 62;
            var chipY = H * 0.88;
            var chipW = W * 0.2;
            var gap = W * 0.02;
            var totalW = chipW * 4 + gap * 3;
            var startX = (W - totalW) / 2;

            chips.forEach(function (c, idx) {
                var x = startX + idx * (chipW + gap);
                ctx.fillStyle = chipBg;
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(x, chipY - chipH / 2, chipW, chipH, 12);
                } else {
                    ctx.rect(x, chipY - chipH / 2, chipW, chipH);
                }
                ctx.fill();
                ctx.strokeStyle = hairline;
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = textDim;
                ctx.font = "500 11px 'JetBrains Mono', 'Inter', sans-serif";
                ctx.textAlign = "center";
                ctx.fillText(c.label, x + chipW / 2, chipY - 10);

                ctx.fillStyle = textColor;
                ctx.font = "700 18px 'Source Serif 4', Georgia, serif";
                ctx.fillText(c.value, x + chipW / 2, chipY + 14);
            });

            // Top 3 模型（如后端 RPC 已升级到 phase2c，则有此字段）
            if (Array.isArray(data.top_models) && data.top_models.length) {
                var names = data.top_models.map(function (m) {
                    var id = String(m && m.model_id || "—");
                    return id.length > 18 ? id.slice(0, 16) + "…" : id;
                }).join("   ·   ");
                ctx.textAlign = "center";
                ctx.fillStyle = textDim;
                ctx.font = "500 12px 'JetBrains Mono', 'Inter', sans-serif";
                ctx.fillText("TOP · " + names, cx, H * 0.945);
            }

            ctx.textAlign = "center";
            ctx.fillStyle = textDim;
            ctx.font = "500 13px 'JetBrains Mono', 'Inter', sans-serif";
            ctx.fillText("nexusvai.xyz/chat   ·   " + (data.plan_code || "free").toUpperCase(), cx, H * 0.975);
        } else {
            ctx.fillStyle = textColor;
            ctx.font = "500 20px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("— " + userName, cx, H * 0.78);

            ctx.fillStyle = textDim;
            ctx.font = "500 13px 'JetBrains Mono', 'Inter', sans-serif";
            ctx.fillText("nexusvai.xyz/chat   ·   登录后生成你的专属海报", cx, H * 0.975);
        }
    }

    function downloadCanvas(canvas, filename) {
        try {
            var link = document.createElement("a");
            link.download = filename || "cancri-moon-" + Date.now() + ".png";
            link.href = canvas.toDataURL("image/png");
            link.click();
        } catch (e) {
            console.warn("[celebrate-poster] download failed:", e);
        }
    }

    function init() {
        var canvas = $("#posterCanvas");
        if (!canvas) return;

        var refreshBtn = $("#posterRefreshBtn");
        var downloadBtn = $("#posterDownloadBtn");
        var lastData = null;
        var lastAvatarImg = null;

        // 立即绘制游客版
        drawPoster(canvas, {});

        // 异步：等 supabase-js 就绪 → 拉登录用户数据 + 头像 → 重绘
        var attempts = 0;
        function tryFetch() {
            if (window.supabase && window.supabase.createClient) {
                fetchPosterData().then(function (data) {
                    if (!data) return;
                    lastData = data;
                    return preloadAvatar(data.avatar_url).then(function (img) {
                        lastAvatarImg = img;
                        drawPoster(canvas, { data: data, avatarImg: img });
                    });
                });
                return;
            }
            attempts++;
            if (attempts < 16) setTimeout(tryFetch, 200);
        }
        tryFetch();

        if (refreshBtn) {
            refreshBtn.addEventListener("click", function () {
                refreshBtn.disabled = true;
                refreshBtn.textContent = "刷新中…";
                fetchPosterData().then(function (data) {
                    if (data) lastData = data;
                    return preloadAvatar(lastData && lastData.avatar_url).then(function (img) {
                        lastAvatarImg = img;
                        drawPoster(canvas, { data: lastData, avatarImg: img });
                    });
                }).then(function () {
                    refreshBtn.disabled = false;
                    refreshBtn.textContent = "刷新海报";
                });
            });
        }
        if (downloadBtn) {
            downloadBtn.addEventListener("click", function () {
                downloadCanvas(canvas);
            });
        }

        // 主题切换时重绘（保留 lastData + 头像）
        var observer = new MutationObserver(function () {
            drawPoster(canvas, { data: lastData, avatarImg: lastAvatarImg });
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
