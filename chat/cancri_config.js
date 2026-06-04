// 2026-06-04 迁移到 Cloudflare 边缘网关（cf-chat-gateway）：chat-gateway 原生处理省 egress，
// 其余 /auth /rest /storage /functions 由 worker 透明反代回 Supabase（已验证一致）。
// ⏪ 回滚：把下面这行改回 'https://diusqgphvybnzazgopor.supabase.co' 重新部署即可（秒级恢复）。
// window.__SUPABASE_URL__ = 'https://diusqgphvybnzazgopor.supabase.co'; // 旧：Supabase 直连
window.__SUPABASE_URL__ = 'https://chat.nexusvai.xyz';
window.__SUPABASE_ANON_KEY__ = 'sb_publishable_zK_fV6gwNta8Ne8aFL_n4g_cm8HP4lY';
// Cloudflare Turnstile site key for the Supabase Auth captcha widget.
// Site keys are PUBLIC by design. The matching SECRET key is configured in
// Supabase Auth (`security_captcha_secret`) and never leaves the server.
window.__LOGIN_TURNSTILE_SITE_KEY__ = '0x4AAAAAADLKimsIGr-ntVPk';
