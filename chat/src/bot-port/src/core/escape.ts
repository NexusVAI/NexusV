// 移植自 cancri-code/src/core/escape.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/** HTML 转义工具（从 main.ts 抽出，供 main / settings 等模块共用）。 */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c] as string);
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}
