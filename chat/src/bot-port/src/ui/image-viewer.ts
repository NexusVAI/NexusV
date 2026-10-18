// 移植自 cancri-code/src/ui/image-viewer.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — 图片查看器（灯箱）
 *
 * 聊天气泡图片 / 编辑器图片预览共用：
 *   - 滚轮缩放（对准指针；下限是适配尺寸的 0.2 倍，上限至少能放大到看清源像素）
 *   - 按住拖动平移
 *   - 点击空白 / Esc 关闭，双击图片回到适配
 *
 * ⛔ 不要用 CSS `transform: scale()` 放大 `<img>`。图片先被 max-width/max-height
 * 缩进视口，浏览器按那个布局尺寸栅格化；scale 只拉伸这张小位图，原图像素不会回来，
 * 所以一放大就糊，而且不会随着缩放重采样。位图改为 canvas：每帧按当前缩放从原图
 * 切出视口对应的源矩形画进设备像素缓冲。放大超过 1 设备像素/源像素时关掉插值
 * （最近邻），否则双线性会把像素涂糊。SVG 走元素的真实宽高，矢量按新尺寸重画。
 * GIF 也走元素宽高，ImageBitmap 会把动画定格在第一帧。
 */
import { showContextMenu } from "../contextMenu";
import { dataUrlToBlob } from "../core/data-url";
import { showToast } from "./toast";

let activeViewer: HTMLElement | null = null;
/** 2026-08-08 修复：重开灯箱时旧实例只被 remove()，document 上的 keydown 捕获监听残留 → 每次重开泄漏一个 */
let activeViewerDispose: (() => void) | null = null;

/** 打开时相对视口留一圈边，和原先 92vw/92vh 的适配一致。 */
const VIEWPORT_FIT = 0.92;
const WHEEL_STEP = 1.2;
export const IMAGE_VIEWER_MIN_FACTOR = 0.2;
export const IMAGE_VIEWER_MAX_FACTOR = 8;
/**
 * 大图缩进视口之后，再乘 8 仍可能到不了 1 源像素 = 1 CSS 像素。
 * 上限至少抬到这个值，放大才能看见真实像素而不是一直在缩小图上插值。
 */
export const IMAGE_VIEWER_INSPECT_CSS_PER_SRC = 8;

export type ImageViewerKind = "bitmap" | "vector" | "animated";

export function imageViewerKind(src: string): ImageViewerKind {
  const head = src.slice(0, 64).trim().toLowerCase();
  if (head.startsWith("data:image/svg")) return "vector";
  if (head.startsWith("data:image/gif")) return "animated";
  const path = src.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith(".svg")) return "vector";
  if (path.endsWith(".gif")) return "animated";
  return "bitmap";
}

/** CSS 像素 / 源像素。小图不放大（≤1），大图缩到视口的 VIEWPORT_FIT 以内。 */
export function imageViewerFitZoom(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(viewportWidth > 0) || !(viewportHeight > 0)) {
    return 1;
  }
  return Math.min(
    1,
    (viewportWidth * VIEWPORT_FIT) / naturalWidth,
    (viewportHeight * VIEWPORT_FIT) / naturalHeight,
  );
}

export function clampImageViewerZoom(zoom: number, fitZoom: number): number {
  const fit = fitZoom > 0 ? fitZoom : 1;
  const min = fit * IMAGE_VIEWER_MIN_FACTOR;
  const max = Math.max(fit * IMAGE_VIEWER_MAX_FACTOR, IMAGE_VIEWER_INSPECT_CSS_PER_SRC);
  if (!Number.isFinite(zoom)) return fit;
  return Math.min(max, Math.max(min, zoom));
}

export function imageViewerZoomAtPointer(input: {
  zoom: number;
  centerX: number;
  centerY: number;
  fitZoom: number;
  factor: number;
  px: number;
  py: number;
  viewportWidth: number;
  viewportHeight: number;
}): { zoom: number; centerX: number; centerY: number } {
  const { px, py, viewportWidth: vw, viewportHeight: vh } = input;
  const old = input.zoom > 0 ? input.zoom : 1;
  const sx = input.centerX + (px - vw / 2) / old;
  const sy = input.centerY + (py - vh / 2) / old;
  const zoom = clampImageViewerZoom(old * input.factor, input.fitZoom);
  return {
    zoom,
    centerX: sx - (px - vw / 2) / zoom,
    centerY: sy - (py - vh / 2) / zoom,
  };
}

export function imageViewerPanBy(
  centerX: number,
  centerY: number,
  zoom: number,
  dx: number,
  dy: number,
): { centerX: number; centerY: number } {
  const z = zoom > 0 ? zoom : 1;
  return { centerX: centerX - dx / z, centerY: centerY - dy / z };
}

export function imageViewerContainsPoint(
  px: number,
  py: number,
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  centerX: number,
  centerY: number,
): boolean {
  if (!(zoom > 0)) return false;
  const left = viewportWidth / 2 - centerX * zoom;
  const top = viewportHeight / 2 - centerY * zoom;
  const right = left + naturalWidth * zoom;
  const bottom = top + naturalHeight * zoom;
  return px >= left && py >= top && px < right && py < bottom;
}

export interface ImageViewerBlit {
  srcX: number;
  srcY: number;
  srcW: number;
  srcH: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * smooth=false 表示最近邻。只有用户已经放大、并且一个源像素要铺到超过 1 个设备像素时
 * 才关掉插值：适配状态下的缩小仍用高质量过滤；再放大就该看见像素格，而不是涂糊。
 */
export function imageViewerFrame(input: {
  naturalWidth: number;
  naturalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
  centerX: number;
  centerY: number;
  fitZoom: number;
  devicePixelRatio: number;
  vector: boolean;
}): { smooth: boolean; blit: ImageViewerBlit | null } {
  const {
    naturalWidth: nw,
    naturalHeight: nh,
    viewportWidth: vw,
    viewportHeight: vh,
    zoom,
    centerX,
    centerY,
    fitZoom,
    vector,
  } = input;
  const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  const zoomedIn = zoom > fitZoom * 1.001;
  const pastDevicePixel = zoom * dpr > 1;
  const smooth = vector || !(zoomedIn && pastDevicePixel);
  if (!(nw > 0) || !(nh > 0) || !(vw > 0) || !(vh > 0) || !(zoom > 0)) {
    return { smooth, blit: null };
  }
  const left = vw / 2 - centerX * zoom;
  const top = vh / 2 - centerY * zoom;
  const right = left + nw * zoom;
  const bottom = top + nh * zoom;
  const dx0 = Math.max(left, 0);
  const dy0 = Math.max(top, 0);
  const dx1 = Math.min(right, vw);
  const dy1 = Math.min(bottom, vh);
  if (dx1 - dx0 < 0.5 || dy1 - dy0 < 0.5) return { smooth, blit: null };
  let srcX = (dx0 - left) / zoom;
  let srcY = (dy0 - top) / zoom;
  let srcW = (dx1 - dx0) / zoom;
  let srcH = (dy1 - dy0) / zoom;
  if (srcX < 0) {
    srcW += srcX;
    srcX = 0;
  }
  if (srcY < 0) {
    srcH += srcY;
    srcY = 0;
  }
  if (srcX + srcW > nw) srcW = nw - srcX;
  if (srcY + srcH > nh) srcH = nh - srcY;
  if (srcW < 0.01 || srcH < 0.01) return { smooth, blit: null };
  return {
    smooth,
    blit: { srcX, srcY, srcW, srcH, dx: dx0, dy: dy0, dw: dx1 - dx0, dh: dy1 - dy0 },
  };
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.draggable = false;
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** 把一张已解码的图画到 canvas 转 PNG Blob。 */
async function drawImageToPng(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  if (!(w > 0 && h > 0)) throw new Error("image has no intrinsic size");
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.drawImage(source, 0, 0);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/** 非 PNG 图片画到 canvas 转 PNG（剪贴板 ClipboardItem 仅稳定支持 image/png） */
export async function convertBlobToPng(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      return await drawImageToPng(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close?.();
    }
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImageElement(url);
      return await drawImageToPng(img, img.naturalWidth, img.naturalHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * 图片地址（data: / blob: / asset / http(s)）→ PNG Blob，**不走 fetch**。
 *
 * ⛔ 桌面 tauri.conf.json 与网页 chat/bot.html 的 CSP `connect-src` 是白名单（CC-SEC-010），
 *   不放 `data:` / `blob:` / `asset:`：打包后 `fetch(这些地址)` 直接被拒（jsdom 没有 CSP，单测测不出来）。
 *   `<img>` 归 `img-src` 管（已放行），所以 data: 直接解码，其余经 `<img>` → canvas 转 PNG。
 */
export async function imageSrcToPngBlob(src: string): Promise<Blob> {
  if (/^data:/i.test(src)) {
    const blob = dataUrlToBlob(src);
    return blob.type === "image/png" ? blob : await convertBlobToPng(blob);
  }
  try {
    const img = await loadImageElement(src);
    return await drawImageToPng(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
  } catch (err) {
    // 跨域 http(s) 图画进 canvas 会被污染（toBlob 抛 SecurityError）：只有这种才退回 fetch（connect-src 白名单里的域仍可取）
    if (!/^https?:\/\//i.test(src) || /^https?:\/\/asset\.localhost\//i.test(src)) throw err;
    const blob = await (await fetch(src)).blob();
    return blob.type === "image/png" ? blob : await convertBlobToPng(blob);
  }
}

/** 把图片地址（Blob URL / Data URL / http URL）复制到系统剪贴板 */
export async function copyImageToClipboard(src: string): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      // 交给 ClipboardItem 一个 Promise：Safari 要求 write() 在用户手势同一拍里调用，转码放进 Promise 里做
      const png = imageSrcToPngBlob(src);
      png.catch(() => undefined);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(src);
    } else {
      throw new Error("clipboard unavailable");
    }
    showToast("已复制图片");
    return true;
  } catch (err) {
    console.warn("[image] copy image to clipboard failed:", err);
    showToast("复制图片失败");
    return false;
  }
}

export function openImageViewer(src: string): void {
  const prevDispose = activeViewerDispose;
  activeViewer = null;
  activeViewerDispose = null;
  prevDispose?.();
  document.querySelectorAll(".chat-image-lightbox").forEach((node) => node.remove());

  const kind = imageViewerKind(src);
  const lb = document.createElement("div");
  lb.className = "chat-image-lightbox";
  const canvas = document.createElement("canvas");
  canvas.className = "chat-image-lightbox-stage";
  const hint = document.createElement("div");
  hint.className = "chat-image-lightbox-hint";
  hint.textContent = "滚动缩放，拖动平移；点击空白处或按 Esc 关闭";
  lb.append(canvas, hint);

  let alive = true;
  let ready = false;
  let nw = 0;
  let nh = 0;
  let zoom = 1;
  let fitZoom = 1;
  let centerX = 0;
  let centerY = 0;
  let wheelFactor = 1;
  let seenVw = 0;
  let seenVh = 0;
  let bitmap: ImageBitmap | null = null;
  let loader: HTMLImageElement | null = null;
  let mode: "canvas" | "element" = "canvas";
  let source: CanvasImageSource | null = null;
  let raf = 0;
  let ro: ResizeObserver | null = null;
  let closeTimer = 0;
  let closing = false;
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;

  const viewSize = (): { vw: number; vh: number } => {
    const rect = lb.getBoundingClientRect();
    return {
      vw: rect.width || window.innerWidth,
      vh: rect.height || window.innerHeight,
    };
  };

  const releasePixels = () => {
    bitmap?.close();
    bitmap = null;
    if (loader && mode === "canvas") loader.src = "";
  };

  const paintElement = (el: HTMLImageElement, smooth: boolean, vw: number, vh: number) => {
    const left = vw / 2 - centerX * zoom;
    const top = vh / 2 - centerY * zoom;
    el.style.position = "absolute";
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.right = "auto";
    el.style.bottom = "auto";
    el.style.margin = "0";
    el.style.maxWidth = "none";
    el.style.maxHeight = "none";
    el.style.width = `${nw * zoom}px`;
    el.style.height = `${nh * zoom}px`;
    el.style.transform = `translate(${left}px, ${top}px)`;
    el.style.imageRendering = smooth ? "auto" : "pixelated";
  };

  const paint = () => {
    if (!alive || !ready || !(nw > 0) || !(nh > 0)) return;
    const { vw, vh } = viewSize();
    if (vw < 2 || vh < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const frame = imageViewerFrame({
      naturalWidth: nw,
      naturalHeight: nh,
      viewportWidth: vw,
      viewportHeight: vh,
      zoom,
      centerX,
      centerY,
      fitZoom,
      devicePixelRatio: dpr,
      vector: kind === "vector",
    });
    if (mode === "element" && loader) {
      paintElement(loader, frame.smooth, vw, vh);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx || !source || !frame.blit) {
      if (!frame.blit && ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }
    const bw = Math.max(1, Math.round(vw * dpr));
    const bh = Math.max(1, Math.round(vh * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = frame.smooth;
    if (frame.smooth) ctx.imageSmoothingQuality = "high";
    const b = frame.blit;
    ctx.drawImage(source, b.srcX, b.srcY, b.srcW, b.srcH, b.dx * dpr, b.dy * dpr, b.dw * dpr, b.dh * dpr);
  };

  const schedule = () => {
    if (!alive || raf !== 0) return;
    raf = 1;
    const id = requestAnimationFrame(() => {
      raf = 0;
      if (alive) paint();
    });
    if (raf !== 0) raf = id;
  };

  const applyZoom = (factor: number, clientX: number, clientY: number) => {
    if (!ready) {
      wheelFactor = Math.min(64, Math.max(IMAGE_VIEWER_MIN_FACTOR, wheelFactor * factor));
      return;
    }
    const rect = lb.getBoundingClientRect();
    const { vw, vh } = viewSize();
    const next = imageViewerZoomAtPointer({
      zoom,
      centerX,
      centerY,
      fitZoom,
      factor,
      px: clientX - rect.left,
      py: clientY - rect.top,
      viewportWidth: vw,
      viewportHeight: vh,
    });
    zoom = next.zoom;
    centerX = next.centerX;
    centerY = next.centerY;
    schedule();
  };

  const onWheel = (e: WheelEvent) => {
    if (closing || e.deltaY === 0) return;
    e.preventDefault();
    applyZoom(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, e.clientX, e.clientY);
  };

  const pointerOffset = (e: PointerEvent): { px: number; py: number; vw: number; vh: number } => {
    const rect = lb.getBoundingClientRect();
    const { vw, vh } = viewSize();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top, vw, vh };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (closing || e.button !== 0) return;
    dragging = true;
    moved = false;
    lastX = downX = e.clientX;
    lastY = downY = e.clientY;
    lb.classList.add("dragging");
    try { lb.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onPointerMove = (e: PointerEvent) => {
    const { px, py, vw, vh } = pointerOffset(e);
    const over = ready && imageViewerContainsPoint(px, py, nw, nh, vw, vh, zoom, centerX, centerY);
    lb.classList.toggle("is-over-image", over);
    if (!dragging || !ready) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 3) moved = true;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const pan = imageViewerPanBy(centerX, centerY, zoom, dx, dy);
    centerX = pan.centerX;
    centerY = pan.centerY;
    schedule();
  };

  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    lb.classList.remove("dragging");
    try { lb.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const teardown = () => {
    if (!alive) return;
    alive = false;
    if (closeTimer) window.clearTimeout(closeTimer);
    closeTimer = 0;
    document.removeEventListener("keydown", onKey, true);
    ro?.disconnect();
    ro = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    releasePixels();
  };

  const close = () => {
    if (closing) return;
    closing = true;
    document.removeEventListener("keydown", onKey, true);
    ro?.disconnect();
    ro = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (activeViewer === lb) activeViewer = null;
    lb.classList.add("is-closing");
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      teardown();
      lb.remove();
      if (activeViewerDispose === teardown) activeViewerDispose = null;
    };
    lb.addEventListener("animationend", remove, { once: true });
    closeTimer = window.setTimeout(remove, 180);
  };

  activeViewerDispose = teardown;

  lb.addEventListener("wheel", onWheel, { passive: false, capture: true });
  lb.addEventListener("pointerdown", onPointerDown);
  lb.addEventListener("pointermove", onPointerMove);
  lb.addEventListener("pointerup", endDrag);
  lb.addEventListener("pointercancel", endDrag);
  lb.addEventListener("pointerleave", () => {
    if (!dragging) lb.classList.remove("is-over-image");
  });
  lb.addEventListener("click", (e) => {
    if (moved) {
      moved = false;
      return;
    }
    if (!ready) {
      close();
      return;
    }
    const { px, py, vw, vh } = pointerOffset(e as unknown as PointerEvent);
    if (!imageViewerContainsPoint(px, py, nw, nh, vw, vh, zoom, centerX, centerY)) close();
  });
  lb.addEventListener("dblclick", (e) => {
    if (closing || !ready) return;
    const { px, py, vw, vh } = pointerOffset(e as unknown as PointerEvent);
    if (!imageViewerContainsPoint(px, py, nw, nh, vw, vh, zoom, centerX, centerY)) return;
    fitZoom = imageViewerFitZoom(nw, nh, vw, vh);
    zoom = fitZoom;
    centerX = nw / 2;
    centerY = nh / 2;
    wheelFactor = 1;
    e.preventDefault();
    schedule();
  });
  lb.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const { px, py, vw, vh } = pointerOffset(e as unknown as PointerEvent);
    if (!ready || imageViewerContainsPoint(px, py, nw, nh, vw, vh, zoom, centerX, centerY)) {
      showContextMenu(e.clientX, e.clientY, [
        { label: "复制图片", onClick: () => void copyImageToClipboard(src) },
      ], { anchor: lb });
    }
  });
  document.addEventListener("keydown", onKey, true);
  if (typeof ResizeObserver === "function") {
    ro = new ResizeObserver(() => {
      if (!alive || !ready) return;
      const { vw, vh } = viewSize();
      if (vw < 2 || vh < 2 || (vw === seenVw && vh === seenVh)) return;
      const nextFit = imageViewerFitZoom(nw, nh, vw, vh);
      if (fitZoom > 0 && nextFit > 0) {
        zoom = clampImageViewerZoom(nextFit * (zoom / fitZoom), nextFit);
        fitZoom = nextFit;
      }
      seenVw = vw;
      seenVh = vh;
      schedule();
    });
    ro.observe(lb);
  }

  document.body.appendChild(lb);
  activeViewer = lb;

  void (async () => {
    try {
      const img = await loadImageElement(src);
      if (!alive) return;
      loader = img;
      if (kind === "bitmap" && typeof createImageBitmap === "function") {
        try {
          const bmp = await createImageBitmap(img);
          if (!alive) {
            bmp.close();
            return;
          }
          bitmap = bmp;
        } catch {
          /* 画布直接采样这个 Image。它没进过小尺寸布局，解码是原图像素。 */
        }
      }
      if (!alive) return;
      nw = bitmap?.width ?? img.naturalWidth;
      nh = bitmap?.height ?? img.naturalHeight;
      if (!(nw > 0) || !(nh > 0)) return;
      const { vw, vh } = viewSize();
      fitZoom = imageViewerFitZoom(nw, nh, vw, vh);
      zoom = clampImageViewerZoom(fitZoom * wheelFactor, fitZoom);
      centerX = nw / 2;
      centerY = nh / 2;
      seenVw = vw;
      seenVh = vh;
      const ctxOk = kind === "bitmap" && canvas.getContext("2d") != null;
      if (!ctxOk) {
        mode = "element";
        canvas.remove();
        img.draggable = false;
        img.alt = "";
        lb.insertBefore(img, hint);
      } else {
        mode = "canvas";
        source = bitmap ?? img;
      }
      ready = true;
      schedule();
    } catch {
      /* 打不开就留着遮罩，点击或 Esc 关掉 */
    }
  })();
}
