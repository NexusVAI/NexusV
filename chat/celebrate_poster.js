/* ============================================================
 * Cancri 满月海报生成器
 * 2026-05-25 D-4 → 2026-05-28 Phase 4
 *
 * Phase 4 升级：
 *   • 标题文案池（≥6 句），用 (user_id|date) 稳定种子选一对
 *     避免每次刷新文案乱跳；当天同一用户看到的固定文案
 *   • 背景层加 巨蟹座 8 颗主星 + 连线（faint，仅深色主题）
 *   • 加 3-5 颗"凝固中"的流星（带渐变尾迹，停在画面里）
 *   • 右下角嵌入 ../Logo/2WM1.png 二维码（80×80 + 白底圆角）
 *   • 增加固定占星脚注：「双子座之东，狮子座之西 · 掌管宫位为第四宫（巨蟹宫）」
 *
 * 行为：
 *   - 立即绘制游客版（满月图 + 文案 + 日期）
 *   - 登录用户：调 celebrate-signin?action=poster_data 拉数据后重绘
 * ============================================================ */

(function () {
    "use strict";

    var SIGNIN_URL = "https://diusqgphvybnzazgopor.supabase.co/functions/v1/celebrate-signin";
    var QR_PATH = "../Logo/2WM1.png";

    // ─── 标题文案池（成对：line1 = 正体标题，line2 = 斜体延续） ─────
    var TITLE_POOL = [
        { l1: "命运的齿轮",   l2: "已经悄悄转动" },
        { l1: "双子座之东",   l2: "狮子座之西" },
        { l1: "巨蟹的潮汐",   l2: "把第三十天写进星盘" },
        { l1: "三十个深夜",   l2: "一次共同的月圆" },
        { l1: "从屏幕的内嵌处", l2: "走到你信赖的入口" },
        { l1: "月光不语",     l2: "我们替它替你说一句话" },
        { l1: "灯是亮的",     l2: "因为有人在写代码" }
    ];

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

    // ─── 稳定种子 RNG（xorshift32），输入字符串 ───
    function seedFromString(s) {
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        // 确保非零
        return (h >>> 0) || 1;
    }
    function makeRng(seed) {
        var s = seed >>> 0;
        return function () {
            s ^= s << 13; s >>>= 0;
            s ^= s >>> 17; s >>>= 0;
            s ^= s << 5;  s >>>= 0;
            return s / 4294967296;
        };
    }
    function todayKey() {
        // YYYY-MM-DD in UTC+8（避免跨时区一天内换）
        var d = new Date(Date.now() + 8 * 3600 * 1000);
        return d.toISOString().slice(0, 10);
    }
    function pickTitlePair(userKey) {
        var key = (userKey || "guest") + ":" + todayKey();
        var idx = seedFromString(key) % TITLE_POOL.length;
        return TITLE_POOL[idx];
    }

    // ─── supabase ───
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
            var userReq = sb ? sb.auth.getUser().then(function (res) {
                var u = res && res.data && res.data.user;
                if (!u) return {};
                var meta = u.user_metadata || {};
                return {
                    avatar_url: meta.avatar_url || meta.picture || null,
                    full_name: meta.full_name || meta.name || null,
                    user_id: u.id || null
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

    function preloadImage(url, timeoutMs) {
        return new Promise(function (resolve) {
            if (!url) return resolve(null);
            var img = new Image();
            var done = false;
            function finish(v) { if (done) return; done = true; resolve(v); }
            img.crossOrigin = "anonymous";
            img.onload = function () { finish(img); };
            img.onerror = function () { finish(null); };
            img.src = url;
            setTimeout(function () { finish(null); }, timeoutMs || 3000);
        });
    }

    // ─── 巨蟹座主星位置（归一化到 0..1，最后映射到 canvas） ───
    // 简化版的现代星图骨架，5 颗主星（ι / γ / δ / α / β）+ 2 颗辅星
    // 坐标基于"上窄下宽的 Y 形"asterism，仅作示意，不追求天文精确
    var CANCER_STARS = [
        { x: 0.36, y: 0.10, m: 5.6, label: "ι" },  // Iota Cancri 上左
        { x: 0.50, y: 0.18, m: 4.7, label: "γ" },  // γ Asellus Borealis
        { x: 0.62, y: 0.22, m: 4.2, label: "δ" },  // δ Asellus Australis
        { x: 0.42, y: 0.26, m: 4.5, label: "η" },  // η（虚位辅星，连接 α）
        { x: 0.30, y: 0.31, m: 4.3, label: "α" },  // α Acubens
        { x: 0.78, y: 0.34, m: 3.5, label: "β" },  // β Tarf（最亮）
        { x: 0.54, y: 0.36, m: 5.0, label: "ζ" },  // ζ Cnc 辅
        { x: 0.68, y: 0.08, m: 5.4, label: "χ" }   // χ Cnc 辅
    ];
    // 连线：用索引对表示
    var CANCER_LINES = [
        [0, 1], // ι → γ
        [1, 2], // γ → δ
        [2, 3], // δ → η
        [3, 4], // η → α
        [2, 5], // δ → β
        [2, 6], // δ → ζ
        [1, 7]  // γ → χ
    ];

    function drawCancerConstellation(ctx, W, H, isDark) {
        if (!isDark) return; // 浅色海报不画，避免噪点
        // 占据画面上 1/3 偏中央的区域
        var regionX = W * 0.10;
        var regionY = H * 0.04;
        var regionW = W * 0.80;
        var regionH = H * 0.30;

        function mapX(nx) { return regionX + nx * regionW; }
        function mapY(ny) { return regionY + ny * regionH; }

        // 连线层（很淡）
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        CANCER_LINES.forEach(function (pair) {
            var a = CANCER_STARS[pair[0]];
            var b = CANCER_STARS[pair[1]];
            ctx.moveTo(mapX(a.x), mapY(a.y));
            ctx.lineTo(mapX(b.x), mapY(b.y));
        });
        ctx.stroke();
        ctx.restore();

        // 星点层（亮度按星等反相）
        ctx.save();
        CANCER_STARS.forEach(function (s) {
            var alpha = Math.max(0.18, 0.55 - (s.m - 3.5) * 0.10);
            var radius = Math.max(1.2, 3.0 - (s.m - 3.5) * 0.45);
            // 星晕
            var g = ctx.createRadialGradient(mapX(s.x), mapY(s.y), 0, mapX(s.x), mapY(s.y), radius * 4);
            g.addColorStop(0, "rgba(255,255,255," + alpha + ")");
            g.addColorStop(0.6, "rgba(255,255,255," + (alpha * 0.18) + ")");
            g.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(mapX(s.x), mapY(s.y), radius * 4, 0, Math.PI * 2);
            ctx.fill();
            // 星点
            ctx.fillStyle = "rgba(255,255,255," + Math.min(1, alpha + 0.32) + ")";
            ctx.beginPath();
            ctx.arc(mapX(s.x), mapY(s.y), radius, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();

        // β Tarf 标个小字（最亮的那颗）
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.32)";
        ctx.font = "italic 400 11px 'Source Serif 4', Georgia, serif";
        ctx.textAlign = "left";
        ctx.fillText("β Tarf", mapX(0.78) + 8, mapY(0.34) + 4);
        ctx.restore();
    }

    function drawMeteors(ctx, W, H, rng, isDark) {
        if (!isDark) return;
        var count = 3 + Math.floor(rng() * 3); // 3-5
        for (var i = 0; i < count; i++) {
            // 起点限制在上半 60%，斜向右下 / 左下随机
            var startX = rng() * W;
            var startY = (rng() * 0.55) * H;
            var len = (60 + rng() * 130);
            // 角度 25°-55°，方向左/右
            var angle = (Math.PI / 180) * (25 + rng() * 30);
            if (rng() < 0.5) angle = Math.PI - angle; // 镜像方向
            var endX = startX + Math.cos(angle) * len;
            var endY = startY + Math.sin(angle) * len;

            var grad = ctx.createLinearGradient(startX, startY, endX, endY);
            grad.addColorStop(0, "rgba(255,255,255,0.0)");
            grad.addColorStop(0.6, "rgba(255,255,255,0.18)");
            grad.addColorStop(1.0, "rgba(255,255,255,0.85)");

            ctx.save();
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();

            // 头部小亮点
            ctx.fillStyle = "rgba(255,255,255,0.95)";
            ctx.beginPath();
            ctx.arc(endX, endY, 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    function drawQrBadge(ctx, W, H, qrImg) {
        if (!qrImg) return;
        // QR 放海报「左下角」，与上面 chips 不冲突
        // 尺寸控制在 < 10% 画布宽，padding 6，设计为不起眼但可扫
        var size = Math.max(56, Math.min(72, Math.round(W * 0.085)));
        var pad = 6;
        var x = 30 + pad;
        var y = H - size - 30 - pad;

        ctx.save();
        // 白底圆角卡
        ctx.fillStyle = "rgba(255,255,255,0.96)";
        if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(x - pad, y - pad, size + pad * 2, size + pad * 2, 10);
            ctx.fill();
        } else {
            ctx.fillRect(x - pad, y - pad, size + pad * 2, size + pad * 2);
        }
        ctx.drawImage(qrImg, x, y, size, size);

        // 角落小字（靠 QR 右侧）
        ctx.fillStyle = "rgba(20,20,20,0.55)";
        ctx.font = "500 9.5px 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText("scan to open", x + size + pad + 6, y + size - 4);
        ctx.restore();
    }

    function drawPoster(canvas, options) {
        options = options || {};
        var ctx = canvas.getContext("2d");
        if (!ctx) return;

        var W = canvas.width;
        var H = canvas.height;
        var cx = W / 2;
        var isDark = document.documentElement.getAttribute("data-theme") === "dark";

        // ── 颜色（单色品牌，黑/白） ──
        var textColor = isDark ? "#f5f4ef" : "#29261b";
        var textSoft  = isDark ? "#a6a39a" : "#656358";
        var textDim   = isDark ? "rgba(245,244,239,0.42)" : "rgba(41,38,27,0.42)";
        var hairline  = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)";
        var chipBg    = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.025)";

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

        // 稳定随机种子：登录用 user_id，匿名用今天日期
        var data = options.data;
        var seedKey = (data && (data.user_id || data.email || data.full_name)) || "guest";
        var rng = makeRng(seedFromString(seedKey + ":" + todayKey()));

        // ── 巨蟹座 + 流星（仅深色） ──
        drawCancerConstellation(ctx, W, H, isDark);
        drawMeteors(ctx, W, H, rng, isDark);

        // ── 极淡星尘（仅深色，30 颗） ──
        if (isDark) {
            ctx.fillStyle = "rgba(255,255,255,0.22)";
            for (var i = 0; i < 32; i++) {
                var sx = rng() * W;
                var sy = rng() * H;
                var sr = rng() * 1.0 + 0.25;
                ctx.beginPath();
                ctx.arc(sx, sy, sr, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ── 顶部 eyebrow（mono 小字） ──
        ctx.textAlign = "center";
        ctx.fillStyle = textDim;
        ctx.font = "500 15px 'JetBrains Mono', 'Inter', sans-serif";
        ctx.fillText("CHRONICLE  ·  DAY 30", cx, H * 0.14);

        // ── 顶部点缀线 ──
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

        // ── 巨字标题（serif，单色，按种子轮换） ──
        var pair = pickTitlePair(seedKey);
        ctx.fillStyle = textColor;
        ctx.font = "600 72px 'Source Serif 4', Georgia, serif";
        ctx.fillText(pair.l1, cx, H * 0.36);

        ctx.fillStyle = textColor;
        ctx.font = "italic 600 72px 'Source Serif 4', Georgia, serif";
        ctx.fillText(pair.l2, cx, H * 0.45);

        // ── 日期带 ──
        ctx.fillStyle = textSoft;
        ctx.font = "500 16px 'JetBrains Mono', 'Inter', sans-serif";
        ctx.fillText("2026.04.29   —   2026.05.29", cx, H * 0.535);

        // ── 占星脚注：固定两行 ──
        ctx.fillStyle = textDim;
        ctx.font = "italic 400 16px 'Source Serif 4', Georgia, serif";
        ctx.fillText("双子座之东，狮子座之西", cx, H * 0.585);
        ctx.font = "400 12.5px 'JetBrains Mono', 'Inter', sans-serif";
        ctx.fillText("CANCER  ·  the fourth house", cx, H * 0.613);

        // ── 品牌副标 ──
        ctx.fillStyle = textSoft;
        ctx.font = "italic 400 21px 'Source Serif 4', Georgia, serif";
        ctx.fillText("Cancri / NexusVAI  满月", cx, H * 0.665);

        // ── 中段分隔细线 ──
        ctx.strokeStyle = hairline;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(W * 0.18, H * 0.695);
        ctx.lineTo(W * 0.82, H * 0.695);
        ctx.stroke();

        // ── 用户数据 / 游客版 ──
        var userName = (data && (data.full_name || data.display_name)) || options.userName || "Welcome to the moon";

        if (data) {
            // 头像圆
            var avSize = 64;
            var avX = cx;
            var avY = H * 0.755;

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

            ctx.strokeStyle = hairline;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(avX, avY, avSize / 2, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = textColor;
            ctx.font = "600 22px 'Inter', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText(userName + (data.has_badge ? "  ●" : ""), cx, avY + avSize / 2 + 28);

            if (data.email) {
                ctx.fillStyle = textSoft;
                ctx.font = "500 13px 'JetBrains Mono', 'Inter', sans-serif";
                ctx.fillText(data.email, cx, avY + avSize / 2 + 48);
            }

            // 4 chip 区块
            var chips = [
                { label: "陪走天数", value: String(data.days_since || 0) + " 天" },
                { label: "对话总数", value: formatBigNumber(data.conversations || 0) },
                { label: "Token",   value: formatBigNumber(data.total_tokens || 0) },
                { label: "签到",     value: String(data.signin_count || 0) + " 天" }
            ];
            var chipH = 62;
            var chipY = H * 0.885;
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

        // ── 右下角 QR ──（最后画，避免被遮挡）
        drawQrBadge(ctx, W, H, options.qrImg);
    }

    function downloadCanvas(canvas, filename) {
        try {
            var dataUrl = canvas.toDataURL("image/png");
            // 防抱：空画布或头部过短表明渲染未完成
            if (!dataUrl || dataUrl.length < 5000) {
                console.warn("[celebrate-poster] canvas 似乎未完整渲染，len=" + (dataUrl ? dataUrl.length : 0));
                alert("海报还没画完，请稍后重试。");
                return;
            }
            var link = document.createElement("a");
            link.download = filename || "cancri-moon-" + Date.now() + ".png";
            link.href = dataUrl;
            link.click();
        } catch (e) {
            console.warn("[celebrate-poster] download failed:", e);
            alert("下载失败：" + (e && e.message ? e.message : e));
        }
    }

    function init() {
        var canvas = $("#posterCanvas");
        if (!canvas) return;

        var refreshBtn = $("#posterRefreshBtn");
        var downloadBtn = $("#posterDownloadBtn");
        var lastData = null;
        var lastAvatarImg = null;
        var qrImg = null;
        var hasDrawn = false;

        function safeDraw(label, opts) {
            try {
                drawPoster(canvas, opts);
                hasDrawn = true;
                console.log("[celebrate-poster] drew: " + label + "  hasUser=" + Boolean(opts && opts.data) + "  hasAvatar=" + Boolean(opts && opts.avatarImg) + "  hasQR=" + Boolean(opts && opts.qrImg));
            } catch (e) {
                console.error("[celebrate-poster] drawPoster threw at " + label + ":", e);
            }
        }

        // 立即绘制游客版（无 QR）——保证 hasDrawn=true
        safeDraw("initial-guest", { qrImg: null });

        // 预加载 QR；不阻塞首屏
        preloadImage(QR_PATH, 4000).then(function (img) {
            qrImg = img;
            if (!img) console.warn("[celebrate-poster] QR 预加载失败（timeout / 404），海报将不含二维码");
            safeDraw("after-qr", { data: lastData, avatarImg: lastAvatarImg, qrImg: qrImg });
        });

        var attempts = 0;
        function tryFetch() {
            if (window.supabase && window.supabase.createClient) {
                fetchPosterData().then(function (data) {
                    if (!data) return;
                    lastData = data;
                    return preloadImage(data.avatar_url, 3000).then(function (img) {
                        lastAvatarImg = img;
                        safeDraw("after-user-data", { data: data, avatarImg: img, qrImg: qrImg });
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
                    return preloadImage(lastData && lastData.avatar_url, 3000).then(function (img) {
                        lastAvatarImg = img;
                        safeDraw("refresh", { data: lastData, avatarImg: img, qrImg: qrImg });
                    });
                }).then(function () {
                    refreshBtn.disabled = false;
                    refreshBtn.textContent = "刷新海报";
                });
            });
        }
        if (downloadBtn) {
            downloadBtn.addEventListener("click", function () {
                if (!hasDrawn) {
                    alert("海报还在绘制中，请稍后重试。");
                    return;
                }
                downloadCanvas(canvas);
            });
        }

        // 主题切换重绘
        var observer = new MutationObserver(function () {
            safeDraw("theme-change", { data: lastData, avatarImg: lastAvatarImg, qrImg: qrImg });
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
