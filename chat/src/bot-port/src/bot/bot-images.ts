// 移植自 cancri-code/src/bot/bot-images.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Bot 发给用户的截图存在 IndexedDB，线程里只记 id。
 *
 * ⛔ 不进 localStorage：一张截图 15–100KB，Bot 线程本来就和记事本、模型历史挤在
 * 同一个 key 里（约 5MB 配额），塞几十张图就会让整份 Bot 存档写失败。
 * 没有 IndexedDB 的环境（测试 / 极端 WebView）退回进程内 Map，重启后图片显示为「已不在本机」。
 */
const DB_NAME = "cancri-bot-images";
const STORE = "images";

const memory = new Map<string, Blob>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export function base64ToBlob(base64: string, type = "image/jpeg"): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function putBotImage(id: string, blob: Blob): Promise<void> {
  memory.set(id, blob);
  await tx("readwrite", (s) => { s.put(blob, id); });
}

export async function getBotImage(id: string): Promise<Blob | null> {
  const hit = memory.get(id);
  if (hit) return hit;
  const blob = await tx<Blob>("readonly", (s) => s.get(id)).catch(() => undefined);
  if (blob instanceof Blob) {
    memory.set(id, blob);
    return blob;
  }
  return null;
}

export async function deleteBotImages(ids: string[]): Promise<void> {
  if (!ids.length) return;
  for (const id of ids) memory.delete(id);
  await tx("readwrite", (s) => { for (const id of ids) s.delete(id); }).catch(() => undefined);
}
