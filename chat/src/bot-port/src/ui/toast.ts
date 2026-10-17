// 移植自 cancri-code/src/ui/toast.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 顶部胶囊 toast —— 用于 Skill/菜单等轻提示，不写入对话流。
 *
 * POL-3：全项目 90+ 处调用同一个入口，所以「去重」和「上限」必须做在这里，
 * 而不是指望每个调用方自律：
 *   - 去重：同文案在展示期内重复触发只续命，不叠第二张（批量操作循环里最常见）。
 *   - 上限：最多同时 3 张，超出挤掉最旧的——否则一次循环报错能糊满整屏。
 */
const MAX_VISIBLE = 3;
const FADE_MS = 240;

interface LiveToast {
  el: HTMLElement;
  message: string;
  hideTimer: number;
  removeTimer: number;
}

let live: LiveToast[] = [];

function ensureHost(): HTMLElement {
  let host = document.querySelector<HTMLElement>("#cc-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "cc-toast-host";
    document.body.appendChild(host);
  }
  return host;
}

function scheduleDismiss(item: LiveToast, durationMs: number): void {
  window.clearTimeout(item.hideTimer);
  window.clearTimeout(item.removeTimer);
  item.hideTimer = window.setTimeout(() => {
    item.el.classList.remove("show");
    item.removeTimer = window.setTimeout(() => dispose(item), FADE_MS);
  }, durationMs);
}

function dispose(item: LiveToast): void {
  window.clearTimeout(item.hideTimer);
  window.clearTimeout(item.removeTimer);
  item.el.remove();
  live = live.filter((t) => t !== item);
}

export function showToast(message: string, durationMs = 2200): void {
  const host = ensureHost();

  // 同文案还在场 → 续命并挪到最新位置，不再叠一张。
  const existing = live.find((t) => t.message === message);
  if (existing) {
    host.appendChild(existing.el); // 重新入队到底部，视觉上"刷新"了这条
    existing.el.classList.add("show");
    scheduleDismiss(existing, durationMs);
    return;
  }

  const el = document.createElement("div");
  el.className = "cc-toast";
  el.textContent = message;
  host.appendChild(el);
  const item: LiveToast = { el, message, hideTimer: 0, removeTimer: 0 };
  live.push(item);

  // 超上限先挤掉最旧的（立即移除，不等淡出——否则上限形同虚设）。
  while (live.length > MAX_VISIBLE) {
    const oldest = live[0];
    if (!oldest) break;
    dispose(oldest);
  }

  requestAnimationFrame(() => el.classList.add("show"));
  scheduleDismiss(item, durationMs);
}
