// 移植自 cancri-code/src/core/id.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — id 生成工具（vNext agent）
 *
 * 完全基于 `crypto.getRandomValues`（Tauri webview & 浏览器都支持），
 * 不引入任何外部依赖。
 */

/**
 * 标准 UUID v4（"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"，y ∈ {8,9,a,b}）。
 *
 * 用途：turn_id / session_id / tool_call_id 等需要全局唯一的标识。
 */
export function uuidv4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 版本位（v4）+ 变体位（10xx）
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/**
 * 短随机 id（12 个 hex 字符 = 48 bits）。
 * 用途：UI 元素 dataset、临时审批卡 id 等不需要 RFC 唯一性的场景。
 */
export function shortId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
