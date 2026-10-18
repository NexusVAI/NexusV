// 移植自 cancri-code/src/composer-media.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Cancri Code — Composer 媒体附件（图片粘贴 / 拖拽）
 */

export interface ComposerImageAttachment {
  id: string;
  name: string;
  mime: string;
  dataUrl: string;
}

/** 聊天气泡图片拖拽复用的自定义 DataTransfer 类型（JSON: { name, dataUrl }） */
export const CANCRI_IMAGE_DRAG_TYPE = "application/x-cancri-chat-image";

/** 一条消息最多几张图。上游不支持多模态的模型会自己回「看不到图」，前端不按模型过滤。 */
export const COMPOSER_MAX_IMAGES = 20;
/** 单张**原始**文件大小上限。超过这个直接拒；没超的会先按下面参数压缩再上传。 */
export const COMPOSER_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * 上传前压缩参数。
 *
 * 为什么必须压：网关 chat 端点的 body 上限是 **2MB**（chat-gateway.ported.ts:1127），
 * 而 base64 还要再涨约 1/3。网页端早就在发送前压到 1280px / JPEG 0.82
 *（`GitHub/chat/cancri_chat.js` 的 shrinkImageForEdit），桌面端此前**没有**这一步，
 * 直接把原图 data URL 塞进请求 —— 稍大的截图就会被网关 413 挡掉。
 * 这也是把张数上限从 4 提到 20 的前提：不压的话 20 张必然超限。
 */
const IMAGE_MAX_EDGE = 1280;
const IMAGE_JPEG_QUALITY = 0.82;
/** 已经很小的图就别再重编码了，省得画质白掉一层 */
const IMAGE_SHRINK_SKIP_BYTES = 256 * 1024;

const IMAGE_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".avif", ".heic", ".tif", ".tiff", ".svg",
]);

export const TEXT_SKIP_EXT = new Set([
  ".woff", ".woff2", ".ttf", ".otf", ".exe", ".dll", ".so", ".zip", ".gz",
  ".mp3", ".mp4", ".pdf", ".db", ".sqlite", ".wasm", ".class", ".jar",
]);

export function getFileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.has(getFileExt(file.name));
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.has(getFileExt(path));
}

export function isLikelyTextFile(name: string): boolean {
  const ext = getFileExt(name);
  if (!ext) return true;
  if (IMAGE_EXT.has(ext)) return false;
  if (TEXT_SKIP_EXT.has(ext)) return false;
  return true;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("read failed"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * 缩到 IMAGE_MAX_EDGE 以内并转 JPEG。失败（无 canvas / 解码不了）就退回原图，
 * 不因为压缩失败而丢掉用户的图。
 */
async function shrinkImageForUpload(file: File): Promise<{ dataUrl: string; mime: string }> {
  const mime = file.type || guessMimeFromName(file.name);
  // GIF 可能是动图，重编码会只剩一帧；SVG 是矢量文本，光栅化反而变大
  if (mime === "image/gif" || mime === "image/svg+xml" || file.size <= IMAGE_SHRINK_SKIP_BYTES) {
    return { dataUrl: await readFileAsDataUrl(file), mime };
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY), mime: "image/jpeg" };
  } catch {
    return { dataUrl: await readFileAsDataUrl(file), mime };
  } finally {
    bitmap?.close?.();
  }
}

export async function fileToImageAttachment(
  file: File,
): Promise<ComposerImageAttachment | null> {
  if (!isImageFile(file)) return null;
  if (file.size > COMPOSER_MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（>${COMPOSER_MAX_IMAGE_BYTES / 1024 / 1024}MB）`);
  }
  const { dataUrl, mime } = await shrinkImageForUpload(file);
  return {
    id: crypto.randomUUID(),
    name: file.name || "image",
    mime,
    dataUrl,
  };
}

export async function blobToImageAttachment(
  blob: Blob,
  name: string,
): Promise<ComposerImageAttachment | null> {
  if (!blob.type.startsWith("image/") && !IMAGE_EXT.has(getFileExt(name))) return null;
  if (blob.size > COMPOSER_MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（>${COMPOSER_MAX_IMAGE_BYTES / 1024 / 1024}MB）`);
  }
  const file = new File([blob], name, { type: blob.type || guessMimeFromName(name) });
  return fileToImageAttachment(file);
}

export async function pathToImageAttachment(absPath: string): Promise<ComposerImageAttachment | null> {
  if (!isImagePath(absPath)) return null;
  const name = absPath.split(/[/\\]/).pop() || "image";
  // ⛔ 不用 fetch(convertFileSrc(path))：打包后 CSP connect-src 不放 asset: / http://asset.localhost，
  //   会被直接拒掉（拖进来的图片文件全部失败；jsdom 没有 CSP，单测测不出来）。
  //   改走 Rust 原样读字节（与 Bot workspace_files 同一条命令、同一道凭据路径闸门），超限由 Rust 侧拒绝。
  const { invoke } = await import("@tauri-apps/api/core");
  let buf: ArrayBuffer | number[];
  try {
    buf = await invoke<ArrayBuffer | number[]>("cancri_read_file_bytes", {
      path: absPath,
      maxBytes: COMPOSER_MAX_IMAGE_BYTES,
    });
  } catch (err) {
    const msg = String((err as { message?: unknown } | null)?.message ?? err);
    if (/file too large/i.test(msg)) {
      throw new Error(`图片过大（>${COMPOSER_MAX_IMAGE_BYTES / 1024 / 1024}MB）`);
    }
    throw new Error(`读取图片失败：${msg}`);
  }
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : Uint8Array.from(buf);
  return blobToImageAttachment(new Blob([bytes], { type: guessMimeFromName(name) }), name);
}

function guessMimeFromName(name: string): string {
  const ext = getFileExt(name);
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".bmp": return "image/bmp";
    case ".ico": return "image/x-icon";
    case ".avif": return "image/avif";
    case ".heic": return "image/heic";
    case ".tif":
    case ".tiff": return "image/tiff";
    case ".svg": return "image/svg+xml";
    default: return "image/png";
  }
}

export const CANCRI_FILE_DRAG_TYPE = "application/x-cancri-file-path";

export function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}
