/* ============================================================
 * Cancri 满月庆典 · 邀请关系捕获
 * 2026-05-26 · D-2
 *
 * 行为：
 *   主站 chat/index.html 加载时检查 URL ?invite=<inviter_user_id>
 *   流程：
 *     1) 拿到 invite 参数 → 缓存到 localStorage（保留 30 天，应对登录跳转丢参数）
 *     2) 用户登录后 → POST celebrate-signin?action=invite_register
 *     3) 后端检查 invite_active_window / 防自邀 / DB UNIQUE 兜底
 *     4) 成功一次后清除 localStorage 缓存（避免重复请求）
 * ============================================================ */
(function () {
    "use strict";

    var STORAGE_KEY = "cancri_invite_capture_v1";
    var SIGNIN_URL = "https://diusqgphvybnzazgopor.supabase.co/functions/v1/celebrate-signin";
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 天

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
                    fingerprint_hash: getFingerprintHash()
                })
            })
                .then(function (r) {
                    return r.json().catch(function () { return {}; });
                })
                .then(function (data) {
                    if (data && data.ok) {
                        // 注册成功（含 already=true 幂等情况）→ 清缓存
                        clearStored();
                    }
                    // 失败保留缓存，下次 chat 页面打开再试
                })
                .catch(function () {
                    // 网络错误，下次再试
                });
        }).catch(function () {});
    }

    function init() {
        // 1) URL 优先：当前进来就带 invite，先存
        var fromUrl = captureFromUrl();
        if (fromUrl) saveStored(fromUrl);

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
