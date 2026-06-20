// 2026-06-20 全量切 Neon：前端仍走 chat.nexusvai.xyz，CF Worker 反代 Auth/Data API → Neon。
// ⏪ 紧急回滚 Supabase：cf-gateway wrangler USE_NEON=0 + 改回 supabase.co origin。
window.__SUPABASE_URL__ = 'https://chat.nexusvai.xyz';
// supabase-js 初始化仍需 apikey；Neon 侧只校验 Authorization JWT，此值作占位。
window.__SUPABASE_ANON_KEY__ = 'neon-auth-via-cf-shim';
window.__NEON_AUTH_URL__ = 'https://ep-autumn-hat-aonzk396.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth';
window.__NEON_DATA_API_URL__ = 'https://ep-autumn-hat-aonzk396.apirest.c-2.ap-southeast-1.aws.neon.tech/neondb/rest/v1';
// Cloudflare Turnstile site key for the Supabase Auth captcha widget.
// Site keys are PUBLIC by design. The matching SECRET key is configured in
// Supabase Auth (`security_captcha_secret`) and never leaves the server.
window.__LOGIN_TURNSTILE_SITE_KEY__ = '0x4AAAAAADLKimsIGr-ntVPk';
