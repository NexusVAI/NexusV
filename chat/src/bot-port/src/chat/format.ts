// 移植自 cancri-code/src/chat/format.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — Chat 纯字符串/格式化工具（M0 从 chat.ts 抽离）
 *
 * 全是无状态纯函数（不依赖 ChatPane / DOM / this）。供 chat.ts 与 chat/render/* 复用。
 */

import { escapeHtml } from "../core/escape";

/**
 * ⚠ 2026-09-18 审计 U-03：这里原本是**又一份**转义算法的拷贝。它与 `core/escape.ts`
 * 当时恰好同强度，所以不是漏洞 —— 但"同强度"是巧合而非结构事实，而下面 escapeAttr 的
 * 注释（CC-SEC-017）恰好论证过：同一件事两套实现，弱的那半就是实际暴露面。
 * 现在改成转发。转义强度全仓只有 `core/escape.ts` 一处。
 */
export { escapeHtml };

/**
 * 属性值转义。
 *
 * ⛔ 必须与 `escapeHtml` 完全同强度（2026-08-30 审计 CC-SEC-017）。
 *
 * 旧实现只转 `&` `"` `<`，缺 `'` 与 `>`。当前之所以没有可利用的 XSS，**只是因为**
 * 全仓的属性统一用双引号 —— 那是一条隐含约定，没有任何机械手段保证它：
 * 任何一处新代码写成 `attr='${escapeAttr(x)}'`，或者把值放进
 * `<div data-x=${escapeAttr(v)}>`（无引号属性），漏掉的那两个字符立刻可利用。
 * `core/escape.ts` 早就是强版本；同一件事两套强度，弱的那半就是实际暴露面（审计 §5.6）。
 *
 * 这里直接委托给 `escapeHtml`，而不是把三条 replace 补成五条 ——
 * 委托让"两者永远同强度"成为**结构事实**，而不是需要维护的巧合。
 */
export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export function stringOrEmpty(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function truncateString(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

export function pickFirstLine(s: string): string {
  const i = s.indexOf("\n");
  const first = i < 0 ? s : s.slice(0, i);
  return truncateString(first.trim(), 120);
}

export function countNonEmptyLines(s: string): number {
  const normalized = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.trim()) return 0;
  return normalized.split("\n").filter((line) => line.trim().length > 0).length;
}

export function messageContentPreview(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

export function stringifyUnknown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
