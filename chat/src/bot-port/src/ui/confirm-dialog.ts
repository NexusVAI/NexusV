// 移植自 cancri-code/src/ui/confirm-dialog.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — 通用确认弹窗（中文）
 *
 * showConfirmDialog(opts)：模态确认框，支持说明文字、可信 HTML 正文（调用方自行转义）、
 * 可选勾选项（如「同时回滚文件改动」）。Esc / 取消 = 关闭；点空白处是否关闭由设置「弹层关闭方式」决定。Enter 激活当前按钮。
 *
 * 布局对齐 liquid-glass-webgl 的 DialogContent（48px 胶囊、确认键一律 accent 蓝），
 * **材质则走本仓库自己的玻璃配方**（与模型菜单同款：blur 2.5 + glare + 角部受光环
 * + 投影）。角走 corner-shape: squircle，半径 56 与胶囊 24 构成同心。
 * 数值全在 model-menu-duck.css「液态玻璃确认弹窗」一节，改数值去那里，
 * 别在这儿写内联样式。
 *
 * 玻璃走 backdrop-filter + SVG 位移滤镜（#cc-lg-dialog），折射的是真实 IDE 画面；
 * 不支持位移滤镜时自动退回纯模糊。上游那套 WebGL 管线读不到 DOM 像素，不能照搬。
 */

import { mountGlassDialog } from "./glass-dialog";
import { dismissOverlayIfBackdropClick } from "./overlay-dismiss";
import { ownsDialogKeyEvent, trapDialogTab } from "./dialog-keyboard";

export interface ConfirmDialogOptions {
  title: string;
  /** 纯文本说明（textContent 注入，无需转义） */
  message?: string;
  /** 可信 HTML 正文（调用方负责转义），显示在 message 之后 */
  bodyHtml?: string;
  confirmText?: string;
  cancelText?: string;
  /** 可选的第三种明确选择（例如“不保存”）；Esc/空白仍是取消。 */
  secondaryText?: string;
  /** 确认按钮红色危险样式 */
  danger?: boolean;
  /** 可选勾选项 */
  checkbox?: { label: string; checked?: boolean };
}

export interface ConfirmDialogResult {
  ok: boolean;
  /** 勾选项最终状态（无勾选项时为 false） */
  checked: boolean;
  /** 仅 secondaryText 在场时返回，区别第三种选择与取消。 */
  secondary?: boolean;
}

export function showConfirmDialog(opts: ConfirmDialogOptions): Promise<ConfirmDialogResult> {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop cc-confirm-backdrop cc-glass-backdrop";
    const card = document.createElement("div");
    card.className = "modal-card cc-confirm-dialog cc-glass-dialog";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    card.innerHTML =
      `<div class="modal-head"><h3 class="modal-title"></h3></div>` +
      `<div class="modal-body cc-confirm-body">` +
      `<p class="cc-confirm-message"></p>` +
      `<div class="cc-confirm-extra"></div>` +
      `<label class="cc-confirm-checkbox" hidden><input type="checkbox" /><span></span></label>` +
      `</div>` +
      `<div class="cc-confirm-footer">` +
      // 文字包一层 span：按压高光是按钮的 ::after（z-index 1），裸文字节点没法叠
      // z-index，会被高光盖住；上游的 label 也是画在 glow 之上的独立一层。
      `<button type="button" class="cc-input-dialog-btn cc-confirm-cancel"><span class="cc-btn-label"></span></button>` +
      `<button type="button" class="cc-input-dialog-btn cc-confirm-ok"><span class="cc-btn-label"></span></button>` +
      `</div>`;
    card.querySelector<HTMLElement>(".modal-title")!.textContent = opts.title;
    const msgEl = card.querySelector<HTMLElement>(".cc-confirm-message")!;
    if (opts.message) msgEl.textContent = opts.message;
    else msgEl.hidden = true;
    const extraEl = card.querySelector<HTMLElement>(".cc-confirm-extra")!;
    if (opts.bodyHtml) extraEl.innerHTML = opts.bodyHtml;
    else extraEl.hidden = true;
    const checkboxWrap = card.querySelector<HTMLElement>(".cc-confirm-checkbox")!;
    const checkboxInput = checkboxWrap.querySelector<HTMLInputElement>("input")!;
    if (opts.checkbox) {
      checkboxWrap.hidden = false;
      checkboxWrap.querySelector<HTMLElement>("span")!.textContent = opts.checkbox.label;
      checkboxInput.checked = opts.checkbox.checked ?? true;
    }
    const okBtn = card.querySelector<HTMLButtonElement>(".cc-confirm-ok")!;
    const cancelBtn = card.querySelector<HTMLButtonElement>(".cc-confirm-cancel")!;
    okBtn.querySelector<HTMLElement>(".cc-btn-label")!.textContent = opts.confirmText ?? "确定";
    cancelBtn.querySelector<HTMLElement>(".cc-btn-label")!.textContent = opts.cancelText ?? "取消";
    if (opts.danger) okBtn.classList.add("danger");
    let secondaryBtn: HTMLButtonElement | null = null;
    if (opts.secondaryText) {
      secondaryBtn = document.createElement("button");
      secondaryBtn.type = "button";
      secondaryBtn.className = "cc-input-dialog-btn cc-input-dialog-cancel cc-confirm-secondary";
      const label = document.createElement("span");
      label.className = "cc-btn-label";
      label.textContent = opts.secondaryText;
      secondaryBtn.appendChild(label);
      okBtn.before(secondaryBtn);
    }

    let done = false;
    let unmountGlass = () => {};
    const finish = (ok: boolean, secondary = false) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      unmountGlass();
      const restoreFocus = card.contains(document.activeElement);
      backdrop.remove();
      if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
      resolve({ ok, checked: Boolean(opts.checkbox) && checkboxInput.checked,
        ...(opts.secondaryText ? { secondary } : {}),
      });
    };
    const onKey = (e: KeyboardEvent) => {
      // 多层弹窗共用 document capture；只处理发自本卡片的按键，不能消费顶层的 Esc。
      if (e.isComposing || e.defaultPrevented || !ownsDialogKeyEvent(card, e)) return;
      if (trapDialogTab(card, e)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Enter") {
        e.stopPropagation();
        // 取消按钮、正文链接等保留浏览器原生激活语义。
        if (e.target === okBtn) {
          e.preventDefault();
          finish(true);
        }
      }
    };
    okBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    secondaryBtn?.addEventListener("click", () => finish(false, true));
    card.addEventListener("mousedown", (e) => e.stopPropagation());
    backdrop.addEventListener("mousedown", (e) => {
      dismissOverlayIfBackdropClick(e, backdrop, () => finish(false));
    });
    document.addEventListener("keydown", onKey, true);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    unmountGlass = mountGlassDialog(card, secondaryBtn ? [okBtn, cancelBtn, secondaryBtn] : [okBtn, cancelBtn]);

    okBtn.focus({ preventScroll: true });
  });
}
