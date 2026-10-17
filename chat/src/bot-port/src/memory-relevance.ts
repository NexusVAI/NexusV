// 移植自 cancri-code/src/memory-relevance.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 记忆相关性选择（纯函数，无 I/O）。
 *
 * 只把与当前问题相关的记忆注入上下文，而不是整包注入。
 * 打分：查询与记忆共有的每个 token 加 idf = ln(1 + N/df)。
 * 结果顺序：相关条目（分数降序，同分按更新时间降序）→ 若干条用户手写的常驻偏好 → 截断。
 * 与网页端 chat/src/main.js 里的 selectRelevantMemories 同一算法，修改时两边同步。
 */

export interface RelevanceItem {
  content: string;
  source: string;
  updatedAt: number;
}

export interface RelevanceOptions {
  maxItems?: number;
  maxChars?: number;
  pinnedUser?: number;
}

const LATIN_TOKEN_RE = /[a-z0-9]{2,}/g;
const CJK_RUN_RE = /[\u3400-\u9fff\uf900-\ufaff]+/g;

function tokenize(text: string): Set<string> {
  const lower = text.toLowerCase();
  const tokens = new Set<string>();
  for (const match of lower.matchAll(LATIN_TOKEN_RE)) tokens.add(match[0]);
  for (const match of lower.matchAll(CJK_RUN_RE)) {
    const chars = [...match[0]];
    if (chars.length === 1) tokens.add(chars[0]);
    for (let i = 0; i + 1 < chars.length; i++) tokens.add(chars[i] + chars[i + 1]);
  }
  return tokens;
}

export function selectRelevantMemories<T extends RelevanceItem>(
  memories: T[],
  query: string,
  opts: RelevanceOptions = {},
): T[] {
  const maxItems = opts.maxItems ?? 10;
  const maxChars = opts.maxChars ?? 1600;
  const pinnedUser = opts.pinnedUser ?? 3;
  const total = memories.length;
  if (total === 0) return [];

  const queryTokens = tokenize(query);
  const memoryTokens = memories.map((m) => tokenize(m.content));
  const df = new Map<string, number>();
  for (const tokens of memoryTokens) {
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }

  const scored = memories.map((memory, index) => {
    let score = 0;
    for (const token of queryTokens) {
      const count = memoryTokens[index].has(token) ? df.get(token) : undefined;
      if (count) score += Math.log(1 + total / count);
    }
    return { memory, index, score };
  });

  const byRecency = (a: { memory: T; index: number }, b: { memory: T; index: number }) =>
    b.memory.updatedAt - a.memory.updatedAt || a.index - b.index;

  const relevant = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || byRecency(a, b));
  const picked = new Set(relevant.map((s) => s.index));
  const pinned = scored
    .filter((s) => s.memory.source === "user" && !picked.has(s.index))
    .sort(byRecency)
    .slice(0, Math.max(0, pinnedUser));

  const result: T[] = [];
  let chars = 0;
  for (const { memory } of [...relevant, ...pinned]) {
    if (result.length >= maxItems) break;
    if (chars + memory.content.length > maxChars) break;
    chars += memory.content.length;
    result.push(memory);
  }
  return result;
}
