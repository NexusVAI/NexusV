/* ============================================================
 * Cancri 满月庆典 · 邀请关系捕获
 * 2026-05-26 · D-2
 * 2026-05-25 §12 patch: 加登录卡邀请码输入框联动 + 视觉提示条
 *
 * 行为：
 *   主站 chat/index.html 加载时检查 URL ?invite=<inviter_user_id>
 *   流程：
 *     1) 拿到 invite 参数 → 缓存到 localStorage（保留 30 天，应对登录跳转丢参数）
 *     2) 同时填充 #authInviteInput + 显示 #authInviteHintBox（让用户看到"邀请关系已捕获"）
 *     3) 用户也可在登录卡片手动粘贴 UUID / 完整邀请链接 → input 事件→saveStored
 *     4) 用户登录后 → POST celebrate-signin?action=invite_register
 *     5) 后端检查 invite_active_window / 防自邀 / DB UNIQUE 兜底
 *     6) 成功一次后清除 localStorage 缓存（避免重复请求）
 * ============================================================ */
(function () {
    "use strict";

    var STORAGE_KEY = "cancri_invite_capture_v1";
    var SUPABASE_FUNCTIONS_BASE = ((window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz").replace(/\/+$/, "") + "/functions/v1");
    var SIGNIN_URL = SUPABASE_FUNCTIONS_BASE + "/celebrate-signin";
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var UUID_ANYWHERE_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    var MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 天

    // 从任意字符串中抽取 UUID：支持纯 UUID / 完整 URL / "?invite=xxx" 片段
    function parseInviteFromAny(raw) {
        if (!raw || typeof raw !== "string") return null;
        var s = raw.trim();
        if (!s) return null;
        if (UUID_RE.test(s)) return s.toLowerCase();
        // 尝试从 URL 抽 invite query
        try {
            // 兼容用户只粘贴 "?invite=xxx" 这种片段
            if (s.indexOf("?") === 0) {
                var p = new URLSearchParams(s);
                var q = p.get("invite");
                if (q && UUID_RE.test(q)) return q.toLowerCase();
            }
            var url = new URL(s, "https://www.nexusvai.xyz");
            var q2 = url.searchParams.get("invite");
            if (q2 && UUID_RE.test(q2)) return q2.toLowerCase();
        } catch (_) {}
        // 兜底：字符串中任意位置出现 UUID 也接受
        var m = s.match(UUID_ANYWHERE_RE);
        if (m && m[0]) return m[0].toLowerCase();
        return null;
    }

    function captureFromUrl() {
        try {
            var params = new URLSearchParams(window.location.search);
            var raw = params.get("invite");
            if (!raw) return null;
            // 接受两种形式：纯 UUID（专属邀请） / "moon2026" 等通用 utm（不写库）
            if (!UUID_RE.test(raw)) return null;
            return raw.toLowerCase();
        } catch (_) {
            return null;
        }
    }

    function reportInviteVisit(inviterId) {
        if (!inviterId || !UUID_RE.test(inviterId)) return;
        try {
            var base = (window.__SUPABASE_URL__ || "https://chat.nexusvai.xyz").replace(/\/+$/, "");
            fetch(base + "/functions/v1/celebrate-signin", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    apikey: window.__SUPABASE_ANON_KEY__ || "neon-auth-via-cf-shim"
                },
                body: JSON.stringify({
                    action: "invite_visit",
                    inviter_id: inviterId,
                    fingerprint: getFingerprintHash(),
                    user_agent: (navigator && navigator.userAgent) || ""
                }),
                keepalive: true
            }).catch(function () {});
        } catch (_) {}
    }

    function loadStored() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var obj = JSON.parse(raw);
            if (!obj || !obj.inviter_id || !obj.captured_at) return null;
            if (Date.now() - obj.captured_at > MAX_AGE_MS) {
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return obj;
        } catch (_) {
            return null;
        }
    }

    function saveStored(inviterId) {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    inviter_id: inviterId,
                    captured_at: Date.now()
                })
            );
        } catch (_) {}
    }

    function clearStored() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
    }

    function getFingerprintHash() {
        // 复用主站 fingerprint.js 已采集的指纹（如果有）
        try {
            return (
                window.__CANCRI_FINGERPRINT__ ||
                (window.localStorage && localStorage.getItem("cancri_fp_visitor_id")) ||
                null
            );
        } catch (_) {
            return null;
        }
    }

    var _supabase = null;
    function getSupabase() {
        if (_supabase) return _supabase;
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
        return _supabase;
    }

    function tryRegister() {
        var stored = loadStored();
        if (!stored || !stored.inviter_id) return;

        var sb = getSupabase();
        if (!sb) return; // SDK 还没就绪，下次 retry 会再试

        sb.auth.getSession().then(function (res) {
            var session = res && res.data && res.data.session;
            var token = session && session.access_token;
            if (!token) return; // 未登录，等下次

            var userId = session.user && session.user.id;
            if (!userId || userId === stored.inviter_id) {
                // 自邀，直接清掉
                clearStored();
                return;
            }

            fetch(SIGNIN_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer " + token,
                    apikey: window.__SUPABASE_ANON_KEY__
                },
                body: JSON.stringify({
                    action: "invite_register",
                    inviter_id: stored.inviter_id,
                    fingerprint_hash: getFingerprintHash(),
                    captured_at: new Date(stored.captured_at).toISOString()
                })
            })
                .then(function (r) {
                    return r.json().catch(function () { return {}; });
                })
                .then(function (data) {
                    if (data && data.ok) {
                        // 注册成功（含 already=true 幂等情况）→ 清缓存
                        clearStored();
                        return;
                    }
                    if (data && (data.reason === "existing_user" || data.reason === "self_invite_not_allowed" || data.reason === "inviter_not_found" || data.reason === "invalid_capture_time")) {
                        // 明确不满足新用户等条件，无需重试
                        clearStored();
                    }
                    // 其他失败（程序未启用/窗口/数据库错误）保留缓存，下次再试
                })
                .catch(function () {
                    // 网络错误，下次再试
                });
        }).catch(function () {});
    }

    // 在登录卡片显示「邀请关系已捕获」提示条，并展开 details 让用户看到 UUID
    function showAuthInviteHint(inviterId) {
        var box = document.getElementById("authInviteHintBox");
        var details = document.getElementById("authInviteDetails");
        var input = document.getElementById("authInviteInput");
        if (input && !input.value) input.value = inviterId;
        if (box) {
            // 仅显示前 8 位避免冗长，强调"将获得 500K token"
            var masked = String(inviterId || "").slice(0, 8) + "···";
            box.textContent = "✓ 已捕获邀请关系（" + masked + "），新用户登录后自动绑定。被邀请人需通过 API 申请审核且活跃 3 天后，双方各得 ¥1；好友首充可返利 20%。";
            box.hidden = false;
        }
        if (details && !details.open) details.open = true;
    }

    // 监听登录卡片 #authInviteInput 用户输入：实时解析并存 localStorage
    function bindAuthInviteInput() {
        var input = document.getElementById("authInviteInput");
        if (!input) return;
        // 已有 stored 时回填到 input，方便用户确认
        if (!input.value) {
            var stored = loadStored();
            if (stored && stored.inviter_id) {
                input.value = stored.inviter_id;
                showAuthInviteHint(stored.inviter_id);
            }
        }
        var debounceTimer = null;
        input.addEventListener("input", function () {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                var raw = input.value || "";
                var inviterId = parseInviteFromAny(raw);
                if (inviterId) {
                    saveStored(inviterId);
                    showAuthInviteHint(inviterId);
                } else {
                    // 无法解析：清掉之前的提示条（但保留 localStorage，避免用户误删）
                    var box = document.getElementById("authInviteHintBox");
                    if (box && raw.trim()) {
                        box.textContent = "⚠ 邀请码格式无效，请粘贴 36 位 UUID 或完整邀请链接。";
                        box.hidden = false;
                    } else if (box) {
                        box.hidden = true;
                    }
                }
            }, 250);
        });
    }

    function init() {
        // 1) URL 优先：当前进来就带 invite，先存 + 同时显示提示条
        var fromUrl = captureFromUrl();
        if (fromUrl) {
            saveStored(fromUrl);
            showAuthInviteHint(fromUrl);
            reportInviteVisit(fromUrl);
        }

        // 1b) 登录卡片输入框联动（用户手动粘贴 / 提示条显示）
        bindAuthInviteInput();

        // 2) 等 supabase-js 就绪后尝试 register
        var attempts = 0;
        function retry() {
            if (window.supabase && window.supabase.createClient) {
                tryRegister();
                return;
            }
            attempts++;
            if (attempts < 30) setTimeout(retry, 300);
        }
        retry();

        // 3) 监听 auth 状态变化（登录后立即触发）
        var sb = getSupabase();
        if (sb && sb.auth && sb.auth.onAuthStateChange) {
            sb.auth.onAuthStateChange(function (event) {
                if (event === "SIGNED_IN") {
                    setTimeout(tryRegister, 500); // 给 session 写完一点缓冲
                }
            });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
