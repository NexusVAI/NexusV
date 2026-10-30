// 移植自 cancri-code/src/ui/grok-bot/crab-personalize.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 「个性化」胶囊 + 个性化弹窗（版式对标 Notion AI 的「个性化你的 Notion AI」）。
 *
 * 胶囊：挂在首页 / 对话流小蟹的宿主上，悬停宿主时渐显，点击开弹窗。
 * 弹窗：中间大小蟹，左右箭头轮换预设套装（左右滑入滑出）；下面网格逐件开关装饰，
 *   同部位互斥由 crab-outfit 判。改动先进草稿，「完成」才写盘并广播给所有在场的小蟹；
 *   × / Esc / 点遮罩 = 放弃草稿。
 */
import "./crab-personalize.css";
import { ownsDialogKeyEvent, trapDialogTab } from "../dialog-keyboard";
import { dismissOverlayIfBackdropClick } from "../overlay-dismiss";
import { createCrabElement, loadCrab } from "./crab-body";
import {
  ACCESSORIES,
  OUTFIT_PRESETS,
  getOutfit,
  setOutfit,
  stepPreset,
  toggleAccessory,
  type AccessoryId,
} from "./crab-outfit";

/** 与 crab-personalize.css 的 cc-crab-slide-* 动画时长一致 */
const SLIDE_MS = 320;
/** 与 .cc-crab-backdrop.is-leaving 的淡出时长一致 */
const LEAVE_MS = 170;

const SVG_NS = "http://www.w3.org/2000/svg";

const PEN_SVG =
  `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">` +
  `<path d="M10.6 2.6l2.8 2.8-7.6 7.6H3v-2.8z M9.2 4l2.8 2.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const CLOSE_SVG =
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">` +
  `<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const chevron = (d: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">` +
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 给小蟹宿主挂上悬停渐显的「个性化」胶囊 */
export function attachPersonalizePill(host: HTMLElement): HTMLButtonElement {
  host.classList.add("crab-personalize-host");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "crab-personalize-pill";
  btn.innerHTML = `${PEN_SVG}<span>个性化</span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCrabPersonalizeDialog().catch((err) => console.warn("[crab-personalize] 打不开个性化弹窗：", err));
  });
  host.appendChild(btn);
  return btn;
}

let opening: Promise<void> | null = null;

/** 打开个性化弹窗；已经开着时返回同一个 Promise，关闭（开始淡出）时 resolve */
export function openCrabPersonalizeDialog(): Promise<void> {
  opening ??= showDialog().catch((err) => {
    opening = null;
    throw err;
  });
  return opening;
}

/** 单件装饰图标：从组件 shadow DOM 里复制该装饰的图形，按 icon 视框裁出来 */
function accessoryIcon(proto: HTMLElement, id: AccessoryId, viewBox: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("aria-hidden", "true");
  proto.shadowRoot?.querySelectorAll(`.acc-${id}`).forEach((g) => {
    const copy = g.cloneNode(true) as Element;
    copy.removeAttribute("class");
    svg.appendChild(copy);
  });
  return svg;
}

async function showDialog(): Promise<void> {
  await loadCrab();
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    let draft: AccessoryId[] = getOutfit();
    let done = false;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop cc-confirm-backdrop cc-crab-backdrop";
    backdrop.innerHTML =
      `<div class="cc-crab-shell">` +
      `<div class="cc-crab-card" role="dialog" aria-modal="true" aria-labelledby="cc-crab-title" tabindex="-1">` +
      `<button type="button" class="cc-crab-close" aria-label="关闭">${CLOSE_SVG}</button>` +
      `<h2 class="cc-crab-title" id="cc-crab-title">个性化你的 Cancri</h2>` +
      `<div class="cc-crab-stage">` +
      `<button type="button" class="cc-crab-nav" data-dir="-1" aria-label="上一套装扮">${chevron("M10 3.5 5.5 8l4.5 4.5")}</button>` +
      `<div class="cc-crab-viewport"></div>` +
      `<button type="button" class="cc-crab-nav" data-dir="1" aria-label="下一套装扮">${chevron("M6 3.5 10.5 8 6 12.5")}</button>` +
      `</div>` +
      `<div class="cc-crab-name">Cancri</div>` +
      `<div class="cc-crab-grid" role="group" aria-label="装饰"></div>` +
      `<div class="cc-crab-actions">` +
      `<button type="button" class="cc-crab-reset">重置</button>` +
      `<button type="button" class="cc-crab-done">完成</button>` +
      `</div>` +
      `</div></div>`;

    const card = backdrop.querySelector<HTMLElement>(".cc-crab-card")!;
    const viewport = card.querySelector<HTMLElement>(".cc-crab-viewport")!;
    const grid = card.querySelector<HTMLElement>(".cc-crab-grid")!;

    const makeFrame = (outfit: readonly AccessoryId[]): HTMLElement => {
      const frame = document.createElement("div");
      frame.className = "cc-crab-frame";
      const crab = createCrabElement("cc-crab-preview");
      crab.state = "idle";
      crab.setAttribute("accessory", outfit.join(" "));
      frame.appendChild(crab);
      return frame;
    };
    let frame = makeFrame(draft);
    viewport.appendChild(frame);

    const proto = createCrabElement("");
    const tiles = ACCESSORIES.map((def) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "cc-crab-tile";
      tile.dataset.acc = def.id;
      tile.title = def.label;
      tile.setAttribute("aria-label", def.label);
      tile.appendChild(accessoryIcon(proto, def.id, def.icon));
      grid.appendChild(tile);
      return tile;
    });

    const repaint = () => {
      frame.querySelector("cancri-crab")?.setAttribute("accessory", draft.join(" "));
      for (const tile of tiles) {
        tile.setAttribute("aria-pressed", String(draft.includes(tile.dataset.acc as AccessoryId)));
      }
    };

    /** dir=1：旧的向左滑走、新的从右边进来；dir=-1 反过来 */
    const slideTo = (outfit: readonly AccessoryId[], dir: 1 | -1) => {
      draft = [...outfit];
      const old = frame;
      old.classList.add(dir === 1 ? "is-leave-left" : "is-leave-right");
      window.setTimeout(() => old.remove(), SLIDE_MS);
      frame = makeFrame(draft);
      frame.classList.add(dir === 1 ? "is-enter-right" : "is-enter-left");
      viewport.appendChild(frame);
      repaint();
    };
    repaint();

    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit) setOutfit(draft);
      document.removeEventListener("keydown", onKey, true);
      const restoreFocus = card.contains(document.activeElement);
      backdrop.classList.add("is-leaving");
      window.setTimeout(() => backdrop.remove(), LEAVE_MS);
      // 关闭当下就同步放开单例并 resolve：淡出期间再点胶囊要能立刻开新的一个，
      // 而不是拿到这个正在退场的（放在 .finally 里会晚一个微任务，同步连点就落空）
      opening = null;
      resolve();
      if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || !ownsDialogKeyEvent(card, e)) return;
      if (trapDialogTab(card, e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    };

    card.querySelectorAll<HTMLButtonElement>(".cc-crab-nav").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.dataset.dir === "-1" ? -1 : 1;
        slideTo(OUTFIT_PRESETS[stepPreset(draft, dir)]!.items, dir);
      });
    });
    for (const tile of tiles) {
      tile.addEventListener("click", () => {
        draft = toggleAccessory(draft, tile.dataset.acc as AccessoryId);
        repaint();
      });
    }
    card.querySelector(".cc-crab-reset")!.addEventListener("click", () => {
      draft = [];
      repaint();
    });
    card.querySelector(".cc-crab-done")!.addEventListener("click", () => finish(true));
    card.querySelector(".cc-crab-close")!.addEventListener("click", () => finish(false));
    card.addEventListener("mousedown", (e) => e.stopPropagation());
    backdrop.addEventListener("mousedown", (e) => {
      dismissOverlayIfBackdropClick(e, backdrop, () => finish(false));
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(backdrop);
    card.focus({ preventScroll: true });
  });
}
