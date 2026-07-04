// 模块化拆分自 cancri_chat.js：URL 安全白名单（纯函数）。
// safeUrl 用于 href/src 渲染；safeMediaUrl 额外放行 blob:，用于不可信会话附件。
export function safeUrl(url) {
  const trimmed = String(url || "").trim();
  // 2026-06-20 安全修复：原 /^(https?:|\/)/ 会放行协议相对 URL `//evil.com`
  // （以 / 开头），浏览器按当前协议跳到第三方域 → 伪装成"站内相对链接"的钓鱼。
  // 仅放行 http(s) 绝对 URL，以及以单个 / 开头的同站路径（拒绝 // 开头）。
  if (/^https?:/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  // Allow inline image/video data URIs — required so generated images that
  // come back as `b64_json` (e.g. the current xem8k5 image line) survive a chat
  // history reload. 2026-05-13 审查：原正则 `data:(image|video)/[a-z0-9.+-]+;`
  // 会放行 `data:image/svg+xml;...`，SVG 可以内嵌 <script> 和 javascript: URI
  // 直接 XSS。这里改用具体 MIME 白名单，只允许真正的位图 / 视频 / 音频容器。
  if (/^data:image\/(png|jpe?g|webp|gif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/i.test(trimmed)) return trimmed;
  if (/^data:video\/(mp4|webm|ogg|quicktime)[;,]/i.test(trimmed)) return trimmed;
  if (/^data:audio\/(mpeg|mp4|wav|ogg|webm)[;,]/i.test(trimmed)) return trimmed;
  return "#";
}

export function safeMediaUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  // 2026-06-20 安全修复：拒绝协议相对 URL `//evil.com`（见 safeUrl）。
  if (/^(https?:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (/^data:image\/(png|jpe?g|webp|gif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/i.test(trimmed)) return trimmed;
  if (/^data:video\/(mp4|webm|ogg|quicktime)[;,]/i.test(trimmed)) return trimmed;
  if (/^data:audio\/(mpeg|mp4|wav|ogg|webm)[;,]/i.test(trimmed)) return trimmed;
  return "";
}
