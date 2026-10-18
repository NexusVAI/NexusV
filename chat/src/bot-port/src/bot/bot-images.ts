// 移植自 cancri-code/src/bot/bot-images.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * Bot 发给用户的截图（以及 pc_* 发来的录屏 / 文件、主对话里发出的图片）存在 IndexedDB，线程里只记 id。
 *
 * ⛔ 不进 localStorage：一张截图 15–100KB，Bot 线程本来就和记事本、模型历史挤在
 * 同一个 key 里（约 5MB 配额），塞几十张图就会让整份 Bot 存档写失败。
 * 没有 IndexedDB 的环境（测试 / 极端 WebView）退回进程内 Map，重启后图片显示为「已不在本机」。
 */
const DB_NAME = "cancri-bot-images";
const STORE = "images";

/**
 * 进程内缓存：Map 的插入顺序当 LRU（命中就挪到最后）。录屏 / 文件附件动辄十几 MB，
 * 不设上限的话翻几页聊天就能把内存吃满 —— 总量超出预算就从最久没用的开始丢，
 * 但只丢已经写进 IndexedDB 的（没 IDB / 还没写完的丢了就真没了）。
 */
const MEMORY_BUDGET = 48 * 1024 * 1024;
/** 比这大的写进 IDB 后就不留在内存里（播放 / 另存时再读，一次而已） */
const KEEP_IN_MEMORY_MAX = 2 * 1024 * 1024;
const memory = new Map<string, Blob>();
const persisted = new Set<string>();
let memoryBytes = 0;

function remember(id: string, blob: Blob): void {
  const old = memory.get(id);
  if (old) {
    memoryBytes -= old.size;
    memory.delete(id);
  }
  memory.set(id, blob);
  memoryBytes += blob.size;
  trimMemory();
}

function forget(id: string): void {
  const old = memory.get(id);
  if (!old) return;
  memoryBytes -= old.size;
  memory.delete(id);
}

function trimMemory(): void {
  if (memoryBytes <= MEMORY_BUDGET) return;
  for (const [id, blob] of [...memory]) {
    if (memoryBytes <= MEMORY_BUDGET) break;
    if (!persisted.has(id)) continue;
    memory.delete(id);
    memoryBytes -= blob.size;
  }
}

/** 测试用：内存里现在缓存了多少字节 / 几项 */
export function botImageMemoryStats(): { bytes: number; count: number } {
  return { bytes: memoryBytes, count: memory.size };
}

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
  persisted.delete(id);
  remember(id, blob);
  if (!(await openDb())) return; // 没 IDB：只能留在内存里（重启后显示「已不在本机」）
  await tx("readwrite", (s) => { s.put(blob, id); });
  if (memory.get(id) !== blob) return; // 写的过程中被删 / 被覆盖
  persisted.add(id);
  if (blob.size > KEEP_IN_MEMORY_MAX) forget(id);
  else trimMemory();
}

export async function getBotImage(id: string): Promise<Blob | null> {
  const hit = memory.get(id);
  if (hit) {
    memory.delete(id);
    memory.set(id, hit); // 挪到最近使用
    return hit;
  }
  const blob = await tx<Blob>("readonly", (s) => s.get(id)).catch(() => undefined);
  if (blob instanceof Blob) {
    persisted.add(id);
    if (blob.size <= KEEP_IN_MEMORY_MAX && !memory.has(id)) remember(id, blob);
    return blob;
  }
  return null;
}

export async function deleteBotImages(ids: string[]): Promise<void> {
  if (!ids.length) return;
  for (const id of ids) {
    forget(id);
    persisted.delete(id);
  }
  await tx("readwrite", (s) => { for (const id of ids) s.delete(id); }).catch(() => undefined);
}
