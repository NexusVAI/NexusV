// 移植自 cancri-code/src/core/data-url.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * `data:` 地址 → Blob，不走 fetch。
 *
 * ⛔ 不要写 `await (await fetch(dataUrl)).blob()`：桌面端 tauri.conf.json 与网页端 chat/bot.html 的
 *   CSP `connect-src` 是白名单（CC-SEC-010，只列远端目的地），不放 `data:` / `blob:`，
 *   打包后的 WebView / 浏览器里 fetch(data:) / fetch(blob:) 直接被拒（vitest / jsdom 没有 CSP，测不出来）。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (!/^data:/i.test(dataUrl) || comma < 0) throw new Error("不是 data: 地址");
  const params = dataUrl.slice(5, comma).split(";");
  const type = (params[0] || "text/plain").trim().toLowerCase();
  const body = dataUrl.slice(comma + 1);
  if (!params.slice(1).some((p) => p.trim().toLowerCase() === "base64")) {
    return new Blob([decodeURIComponent(body)], { type });
  }
  const bin = atob(body.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
