// 2026-07-10 业务数据迁至 Aiven：浏览器只访问 CF Gateway，不直连数据库或 Auth 源站。
window.__SUPABASE_URL__ = 'https://chat.nexusvai.xyz';
// supabase-js 初始化仍需 apikey；Gateway 使用当前 Auth Shim 校验 Authorization JWT。
window.__SUPABASE_ANON_KEY__ = 'neon-auth-via-cf-shim';
// 2026-06-20 满月故事墙活动已结束（只读存档）
window.__CELEBRATE_WALL_CLOSED__ = true;
// Cloudflare Turnstile site key for the login captcha widget.
// Site keys are public by design; the matching secret never leaves the server.
window.__LOGIN_TURNSTILE_SITE_KEY__ = '0x4AAAAAADz30V0GTFqJCwZO';
