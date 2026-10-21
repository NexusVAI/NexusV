// 模型菜单三层归属（2026-10-21，Notion AI 模型菜单样式）。
//
//   第一层：推荐 + 「其他模型 ›」
//   第二层：其他模型（按品牌分组）+ 「较早的模型 ›」
//   第三层：较早的模型
//
// 后端 model_ui_catalog 没有「推荐 / 较早」字段，这里只按后端下发的模型自动推导：
//   • 推荐 = MODEL_MENU_RECOMMENDED_IDS 里、且当前 catalog 确实在售的模型；
//   • 较早 = 同一产品线（家族 + 线名，如 GPT·Sol、Gemini·Flash、Gemini·Flash Lite）里
//     「隔代」的版本，判据见 isOlderThan：
//       - 大版本落后（GPT 5.6 Sol ← GPT 6.1 Sol、Kimi K2.6 ← K3、MiniMax M2.7 ← M3）；
//       - 同大版本但小版本落后 ≥ 2 档（GLM 5 ← 5.2、Gemini 3.6 Flash ← 3.8 Flash）。
//     只差一个小版本（GPT 6 Sol / 6.1 Sol、Gemini 3.7 / 3.8 Flash、DeepSeek V4 / V4.1 Flash）
//     是同时在售的两代主力，不算过时 —— 运营方 2026-10-21 明确：GPT 6 Sol 不是过时模型。
//   • 没有线名的「裸名」模型（GPT-5.5、GLM-4-9B）只要同家族已有更高大版本，也算较早；
//   • MODEL_MENU_CURRENT_IDS / MODEL_MENU_OLDER_IDS 两张表可人工钉死，优先于自动判定；
//   • 其余 = 其他模型。
// 纯函数、无 DOM 依赖，由 model-menu-layers.test.js 锁行为。

export const MODEL_MENU_RECOMMENDED_IDS = [
  "gpt-6.1-sol",
  "claude-opus-4-6-thinking",
  "deepseek-v4-flash",
];

// 人工钉死「不算过时」：自动规则判错时在这里加（填 catalog id）。
export const MODEL_MENU_CURRENT_IDS = [
  // GPT 6 Sol 一家（标准 / Plus / XHigh）与 6.1 Sol 并行在售，见 模型运维总纲 §3.10 / §3.12。
  "gpt-6-sol",
  "gpt-6-sol-plus",
  "gpt-6-sol-xhigh",
];

// 人工钉死「较早」：自动规则看不出来、但运营上已是上一代的模型。
export const MODEL_MENU_OLDER_IDS = [];

// 线名里不算「产品线」的修饰词：同一条线的思考档 / 推理强度档 / 发布形态 / 渠道分组。
const LINE_QUALIFIER_WORDS = new Set([
  "thinking",
  "high",
  "xhigh",
  "medium",
  "low",
  "preview",
  "latest",
  "instruct",
  "it",
  "chat",
  "pro5x",
]);

// 紧跟在线名后面、构成独立子线的词：Gemini Flash Lite ≠ Gemini Flash。
const SUBLINE_WORDS = new Set(["lite", "mini", "nano", "micro", "air"]);

// 版本号 token：可带一个字母前缀（V4.1 / K2.6 / M2.5 / R1），纯数字 + 点。
// 「14B」「0823」「2512」这类参数量 / 日期 token 不会被当成版本（前者带后缀，
// 后者是 ≥1000 的纯数字快照号）。
const VERSION_TOKEN_RE = /^[a-z]?(\d+(?:\.\d+)*)$/i;

function splitNameTokens(name) {
  return String(name || "")
    .split(/[\s\-_()（）/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseVersionToken(tok) {
  const vm = VERSION_TOKEN_RE.exec(tok);
  if (!vm) return null;
  // 纯数字且 ≥1000 → 日期 / 快照号（0731、2512），不是版本
  if (/^\d+$/.test(tok) && tok.length >= 4) return null;
  return vm[1].split(".").map(Number);
}

export function parseModelLine(displayName) {
  const tokens = splitNameTokens(displayName);
  if (!tokens.length) return { family: "", line: "", version: null };
  // 「Qwen3.5」这种家族名与版本号粘在一起的写法：拆成两段。
  const head = /^([a-z]+)(\d+(?:\.\d+)*)$/i.exec(tokens[0]);
  const family = (head ? head[1] : tokens[0].replace(/[^a-z]/gi, "")).toLowerCase();
  let version = head ? head[2].split(".").map(Number) : null;
  let line = "";
  let lineDone = false;
  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const v = parseVersionToken(tok);
    if (v) {
      if (!version) version = v;
      if (line) lineDone = true;
      continue;
    }
    if (!/^[a-z]+$/i.test(tok)) continue;
    const word = tok.toLowerCase();
    if (LINE_QUALIFIER_WORDS.has(word)) continue;
    if (!line) {
      line = word;
    } else if (!lineDone && SUBLINE_WORDS.has(word) && !line.includes(" ")) {
      line = `${line} ${word}`;
      lineDone = true;
    } else {
      lineDone = true;
    }
  }
  return { family, line, version };
}

export function compareVersions(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// 「隔代」判据：大版本落后，或同大版本小版本落后 ≥ 2。只差一个小版本不算较早。
export function isOlderThan(version, latest) {
  if (!version || !latest) return false;
  const major = version[0] || 0;
  const latestMajor = latest[0] || 0;
  if (major !== latestMajor) return major < latestMajor;
  return (latest[1] || 0) - (version[1] || 0) >= 2;
}

// models: [{ id, displayName }]，保持传入顺序。
// 返回 { recommended, other, older }，每个元素是原 model 对象。
export function classifyModelMenuLayers(
  models,
  recommendedIds = MODEL_MENU_RECOMMENDED_IDS,
  { currentIds = MODEL_MENU_CURRENT_IDS, olderIds = MODEL_MENU_OLDER_IDS } = {},
) {
  const list = Array.isArray(models) ? models : [];
  const byId = new Map(list.map((m) => [m.id, m]));
  const recommended = recommendedIds.map((id) => byId.get(id)).filter(Boolean);
  const recommendedSet = new Set(recommended.map((m) => m.id));
  const pinnedCurrent = new Set(currentIds);
  const pinnedOlder = new Set(olderIds);

  // 最新版本按产品线 / 按家族统计（推荐模型也参与：推荐了 Opus 4.6 时，Opus 4.5 仍算较早）。
  const parsed = new Map();
  const latestByLine = new Map();
  const latestMajorByFamily = new Map();
  for (const m of list) {
    const info = parseModelLine(m.displayName || m.id);
    parsed.set(m.id, info);
    if (!info.family || !info.version) continue;
    const key = `${info.family}\u0000${info.line}`;
    const prev = latestByLine.get(key);
    if (!prev || compareVersions(info.version, prev) > 0) latestByLine.set(key, info.version);
    const major = info.version[0] || 0;
    if (major > (latestMajorByFamily.get(info.family) || 0)) latestMajorByFamily.set(info.family, major);
  }

  const isOlder = (m) => {
    if (pinnedCurrent.has(m.id)) return false;
    if (pinnedOlder.has(m.id)) return true;
    const info = parsed.get(m.id);
    if (!info || !info.version) return false;
    const latest = latestByLine.get(`${info.family}\u0000${info.line}`);
    if (isOlderThan(info.version, latest)) return true;
    // 裸名（无线名）：同家族已出更高大版本即算上一代
    if (!info.line) return (info.version[0] || 0) < (latestMajorByFamily.get(info.family) || 0);
    return false;
  };

  const other = [];
  const older = [];
  for (const m of list) {
    if (recommendedSet.has(m.id)) continue;
    if (isOlder(m)) older.push(m);
    else other.push(m);
  }
  return { recommended, other, older };
}

// FREE 胶囊：后端下发的 gateCostTier（与网关计费闸门同一判据）优先；
// 没有时退回 catalog costTier / 福利线判定。
export function isFreeMenuModel(meta) {
  if (!meta) return false;
  if (meta.gateCostTier) return meta.gateCostTier === "free";
  return meta.costTier === "free" || meta.isWelfare === true;
}

const COST_TIER_LEVEL = { free: 1, cheap: 2, normal: 3, expensive: 4, vip: 5 };

function levelByThresholds(value, thresholds) {
  for (let i = 0; i < thresholds.length; i += 1) {
    if (value <= thresholds[i]) return i + 2;
  }
  return thresholds.length + 2;
}

// 信号格 1..5：越满 = 消耗越高。
//   按量计费（wallet_v3 等）看 model_pricing 真实单价（输出 ¥/M 或 ¥/次）；
//   套餐制 plan_v4 看额度倍率（customMultiplier，缺省按 costTier 档位）。
export function getModelCostLevel(meta, billingMode) {
  if (!meta) return 3;
  if (isFreeMenuModel(meta)) return 1;
  if (billingMode === "plan_v4") {
    const mult = Number(meta.customMultiplier);
    if (Number.isFinite(mult) && mult > 0) return levelByThresholds(mult, [1, 2, 5]);
    return COST_TIER_LEVEL[meta.costTier] || 3;
  }
  const out = Number(meta.outputPricePerM);
  const inp = Number(meta.inputPricePerM);
  const tokenPrice = Math.max(Number.isFinite(out) ? out : 0, Number.isFinite(inp) ? inp : 0);
  if (tokenPrice > 0) return levelByThresholds(tokenPrice, [0.5, 2, 5]);
  const perCall = Number(meta.perCallPrice);
  if (Number.isFinite(perCall) && perCall > 0) return levelByThresholds(perCall, [0.01, 0.05, 0.2]);
  return COST_TIER_LEVEL[meta.costTier] || 3;
}

export const COST_LEVEL_LABELS = ["", "极低", "较低", "中等", "较高", "很高"];
