// 2026-07-10 业务数据迁至 Aiven：浏览器只访问 CF Gateway，不直连数据库或 Auth 源站。
window.__SUPABASE_URL__ = 'https://chat.nexusvai.xyz';
// supabase-js 初始化仍需 apikey；Gateway 使用当前 Auth Shim 校验 Authorization JWT。
window.__SUPABASE_ANON_KEY__ = 'neon-auth-via-cf-shim';

// ── 首尔边缘中继（2026-08-29）─────────────────────────────────────────
// 国内直连时 Cloudflare 把请求交给阿姆斯特丹 colo（实测 24/24 次），握手要
// 三个 RTT × 235ms。首尔那台机器终结 TLS 后用长连接回 CF，实测网关 TTFB
// 中位数 829ms → 477ms（每个 RTT 省 127ms，长连接下每个请求都省）。
//
// ⛔ 这个值只喂给「网关调用」（chat / gen-title / user-memory）。
//    **登录必须继续走 __SUPABASE_URL__** —— Turnstile 的机房判定、auth 的
//    机房档 IP 配额、同网段上限都读 request.cf.asn / cf-ipcountry，那是
//    Cloudflare 对 TCP 连接来源生成的，无法用 header 转发。让 /auth/v1/*
//    走中继 = 国内真人全被判成机房出口并强制人机验证，而他们恰恰加载不了
//    challenges.cloudflare.com → 登录锁死。
//
// 出问题的止血：把下面这行改成 undefined（或删掉），前端自动回落直连，
// 不需要改任何 JS，也不需要重新 vite build。
window.__GATEWAY_URL__ = 'https://cn.nexusvai.xyz';
// 2026-06-20 满月故事墙活动已结束（只读存档）
window.__CELEBRATE_WALL_CLOSED__ = true;
// Cloudflare Turnstile site key for the login captcha widget.
// Site keys are public by design; the matching secret never leaves the server.
window.__LOGIN_TURNSTILE_SITE_KEY__ = '0x4AAAAAADz30V0GTFqJCwZO';
