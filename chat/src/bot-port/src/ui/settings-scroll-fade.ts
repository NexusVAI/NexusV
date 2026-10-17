// 移植自 cancri-code/src/ui/settings-scroll-fade.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 设置页滚动容器（`.settings-panes-body`）上下边缘渐隐，与输入框容器、扩展页同款。
 * 曲线与停靠点全在 styles.css 的 `.has-scroll-fade` 规则；这里只把「两端还剩多少可滚」
 * 写成 `--chat-scroll-fade-top/bottom` —— 滚到头退回 0，顶/底不会无故雾化。
 * ⛔ 不要在这里再写一份 mask。
 */
const FADE_PX = 32;

/** Bot 会话区（`#bot-view .bot-convo-scroll`）也走这一份。 */
export function syncScrollFade(scroll: HTMLElement): void {
  const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  if (max <= 1) {
    scroll.classList.remove("has-scroll-fade");
    scroll.style.removeProperty("--chat-scroll-fade-top");
    scroll.style.removeProperty("--chat-scroll-fade-bottom");
    return;
  }
  const top = Math.min(FADE_PX, Math.max(0, scroll.scrollTop));
  const bottom = Math.min(FADE_PX, Math.max(0, max - scroll.scrollTop));
  scroll.style.setProperty("--chat-scroll-fade-top", `${top}px`);
  scroll.style.setProperty("--chat-scroll-fade-bottom", `${bottom}px`);
  scroll.classList.add("has-scroll-fade");
}

let bound = false;

export function initSettingsScrollFade(): void {
  if (bound) return;
  const scroll = document.querySelector<HTMLElement>("#settings-modal .settings-panes-body");
  if (!scroll) return;
  bound = true;
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      syncScrollFade(scroll);
    });
  };
  scroll.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  new ResizeObserver(schedule).observe(scroll);
  new MutationObserver(schedule).observe(scroll, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "style"],
  });
  schedule();
}
