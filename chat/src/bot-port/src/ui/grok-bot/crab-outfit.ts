// 移植自 cancri-code/src/ui/grok-bot/crab-outfit.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 小蟹的装饰搭配：用户选、全局生效、本地持久化。
 *
 * 互斥按「占用部位」判：选一件就挤掉和它共用任一部位的旧装饰（帽子只能戴一顶、右钳只能拿一样）。
 * 生日 = 帽子 + 蛋糕，同时占头顶和右钳；墨镜金链同时占眼部和脖子。
 * 状态（思考 / 干活 / 出错…）由系统驱动，不在这里。
 */
export type AccessoryId =
  | "wizard" | "cowboy" | "cap" | "crown" | "santa" | "birthday"
  | "glasses" | "bling" | "stache"
  | "magnifier" | "coffee" | "baton" | "zongzi" | "mooncake";

export type OutfitSlot = "head" | "eyes" | "mouth" | "neck" | "clawL" | "clawR";

export interface AccessoryDef {
  id: AccessoryId;
  label: string;
  slots: readonly OutfitSlot[];
  /** 单件图标的 viewBox，取自 cancri-crab.js 里该装饰图形的坐标范围 */
  icon: string;
}

export const ACCESSORIES: readonly AccessoryDef[] = [
  { id: "wizard", label: "魔法帽", slots: ["head"], icon: "38 -26 68 68" },
  { id: "cowboy", label: "牛仔帽", slots: ["head"], icon: "28 -19 88 88" },
  { id: "cap", label: "鸭舌帽", slots: ["head"], icon: "46 -12 74 74" },
  { id: "crown", label: "皇冠", slots: ["head"], icon: "41 -3 62 62" },
  { id: "santa", label: "圣诞帽", slots: ["head"], icon: "36 -15 72 72" },
  { id: "birthday", label: "生日帽和蛋糕", slots: ["head", "clawR"], icon: "48 -35 102 102" },
  { id: "glasses", label: "眼镜", slots: ["eyes"], icon: "28 21 88 88" },
  { id: "bling", label: "墨镜和金链", slots: ["eyes", "neck"], icon: "34 43 76 76" },
  { id: "stache", label: "胡子", slots: ["mouth"], icon: "44 54 56 56" },
  { id: "magnifier", label: "放大镜", slots: ["clawL"], icon: "-10 -4 62 62" },
  { id: "coffee", label: "咖啡", slots: ["clawR"], icon: "100 -13 56 56" },
  { id: "baton", label: "指挥棒", slots: ["clawR"], icon: "96 -20 58 58" },
  { id: "zongzi", label: "粽子", slots: ["clawR"], icon: "100 -2 48 48" },
  { id: "mooncake", label: "月饼", slots: ["clawR"], icon: "100 1 46 46" },
];

const BY_ID = new Map<AccessoryId, AccessoryDef>(ACCESSORIES.map((a) => [a.id, a]));

export function isAccessoryId(v: unknown): v is AccessoryId {
  return typeof v === "string" && BY_ID.has(v as AccessoryId);
}

function conflicts(a: AccessoryId, b: AccessoryId): boolean {
  const sa = BY_ID.get(a)!.slots;
  return BY_ID.get(b)!.slots.some((s) => sa.includes(s));
}

/** 穿上 id，挤掉同部位的旧装饰 */
export function wearAccessory(outfit: readonly AccessoryId[], id: AccessoryId): AccessoryId[] {
  return [...outfit.filter((x) => x !== id && !conflicts(x, id)), id];
}

/** 网格点一下：穿着就脱，没穿就穿 */
export function toggleAccessory(outfit: readonly AccessoryId[], id: AccessoryId): AccessoryId[] {
  return outfit.includes(id) ? outfit.filter((x) => x !== id) : wearAccessory(outfit, id);
}

/** 存储里读出来的东西不可信：丢掉未知项，按顺序穿（后者挤掉同部位的前者） */
export function normalizeOutfit(raw: unknown): AccessoryId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isAccessoryId).reduce<AccessoryId[]>((acc, id) => wearAccessory(acc, id), []);
}

export function sameOutfit(a: readonly AccessoryId[], b: readonly AccessoryId[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** 左右箭头轮换的预设套装 */
export const OUTFIT_PRESETS: readonly { name: string; items: readonly AccessoryId[] }[] = [
  { name: "素颜", items: [] },
  { name: "魔法师", items: ["wizard", "baton"] },
  { name: "牛仔侦探", items: ["cowboy", "magnifier"] },
  { name: "学霸", items: ["glasses", "coffee"] },
  { name: "国王", items: ["crown", "stache"] },
  { name: "嘻哈", items: ["cap", "bling"] },
  { name: "圣诞", items: ["santa"] },
  { name: "生日", items: ["birthday"] },
  { name: "端午", items: ["zongzi"] },
  { name: "中秋", items: ["mooncake"] },
];

/** 当前搭配在预设里的位置；自己搭的（对不上任何预设）返回 -1 */
export function presetIndexOf(outfit: readonly AccessoryId[]): number {
  return OUTFIT_PRESETS.findIndex((p) => sameOutfit(p.items, outfit));
}

/** 从当前搭配往 dir 方向走一格；自己搭的往右从第一个开始、往左从最后一个开始 */
export function stepPreset(outfit: readonly AccessoryId[], dir: 1 | -1): number {
  const n = OUTFIT_PRESETS.length;
  const at = presetIndexOf(outfit);
  if (at < 0) return dir === 1 ? 0 : n - 1;
  return (at + dir + n) % n;
}

// ── 持久化 + 广播 ────────────────────────────────────────

export const OUTFIT_STORAGE_KEY = "cancri.mascot.outfit";

type Store = Pick<Storage, "getItem" | "setItem">;
const listeners = new Set<(outfit: readonly AccessoryId[]) => void>();

export function getOutfit(storage: Store = localStorage): AccessoryId[] {
  try {
    return normalizeOutfit(JSON.parse(storage.getItem(OUTFIT_STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

export function setOutfit(outfit: readonly AccessoryId[], storage: Store = localStorage): void {
  const next = normalizeOutfit(outfit);
  try {
    storage.setItem(OUTFIT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / 隐私模式：本次会话照样生效，只是下次启动记不住 */
  }
  for (const fn of listeners) fn(next);
}

export function subscribeOutfit(fn: (outfit: readonly AccessoryId[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 给一只小蟹穿上当前搭配，并跟随后续修改；返回解绑函数 */
export function bindCrabOutfit(el: HTMLElement): () => void {
  el.setAttribute("accessory", getOutfit().join(" "));
  return subscribeOutfit((o) => el.setAttribute("accessory", o.join(" ")));
}
