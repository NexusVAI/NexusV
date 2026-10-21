// 模型菜单三层归属（2026-10-21，Notion AI 模型菜单样式）。
//
//   第一层：推荐 + 「其他模型 ›」
//   第二层：其他模型（按品牌分组）+ 「较早的模型 ›」
//   第三层：较早的模型
//
// 后端 model_ui_catalog 没有「推荐 / 较早」字段，这里只按后端下发的模型自动推导：
//   • 推荐 = MODEL_MENU_RECOMMENDED_IDS 里、且当前 catalog 确实在售的模型；
//   • 较早 = 同一产品线（家族名 + 线名，如 Qwen·Max、Gemini·Flash、GPT·Sol）里
//     版本号不是最新的模型（例：Qwen 3.8 Max 上架后 Qwen 3.7 Max 自动进「较早」）；
//   • 其余 = 其他模型。
// 纯函数、无 DOM 依赖，由 model-menu-layers.test.js 锁行为。

export const MODEL_MENU_RECOMMENDED_IDS = [
  "gpt-6.1-sol",
  "claude-opus-4-6-thinking",
  "deepseek-v4-flash",
];

// 线名里不算「产品线」的修饰词：同一条线的思考档 / 推理强度档 / 发布形态。
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
]);

// 版本号 token：可带一个字母前缀（V4.1 / K2.6 / M2.5 / R1），纯数字 + 点。
// 「14B」「0823」这类参数量 / 日期 token 不会被当成版本（前者带后缀，后者只在
// 已经拿到版本号之后出现，取第一个命中即止）。
const VERSION_TOKEN_RE = /^[a-z]?(\d+(?:\.\d+)*)$/i;

function splitNameTokens(name) {
  return String(name || "")
    .split(/[\s\-_()（）/]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function parseModelLine(displayName) {
  const tokens = splitNameTokens(displayName);
  if (!tokens.length) return { family: "", line: "", version: null };
  // 「Qwen3.5」这种家族名与版本号粘在一起的写法：拆成两段。
  const head = /^([a-z]+)(\d+(?:\.\d+)*)$/i.exec(tokens[0]);
  const family = (head ? head[1] : tokens[0].replace(/[^a-z]/gi, "")).toLowerCase();
  let version = head ? head[2].split(".").map(Number) : null;
  let line = "";
  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i];
    const vm = VERSION_TOKEN_RE.exec(tok);
    if (vm) {
      if (!version) version = vm[1].split(".").map(Number);
      continue;
    }
    if (!line && /^[a-z]+$/i.test(tok) && !LINE_QUALIFIER_WORDS.has(tok.toLowerCase())) {
      line = tok.toLowerCase();
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

// models: [{ id, displayName }]，保持传入顺序。
// 返回 { recommended, other, older }，每个元素是原 model 对象。
export function classifyModelMenuLayers(models, recommendedIds = MODEL_MENU_RECOMMENDED_IDS) {
  const list = Array.isArray(models) ? models : [];
  const byId = new Map(list.map((m) => [m.id, m]));
  const recommended = recommendedIds.map((id) => byId.get(id)).filter(Boolean);
  const recommendedSet = new Set(recommended.map((m) => m.id));

  // 最新版本按产品线统计（推荐模型也参与：推荐了 Opus 4.6 时，Opus 4.5 仍算较早）。
  const parsed = new Map();
  const latestByLine = new Map();
  for (const m of list) {
    const info = parseModelLine(m.displayName || m.id);
    parsed.set(m.id, info);
    if (!info.family || !info.version) continue;
    const key = `${info.family}\u0000${info.line}`;
    const prev = latestByLine.get(key);
    if (!prev || compareVersions(info.version, prev) > 0) latestByLine.set(key, info.version);
  }

  const other = [];
  const older = [];
  for (const m of list) {
    if (recommendedSet.has(m.id)) continue;
    const info = parsed.get(m.id);
    const latest = info && info.version
      ? latestByLine.get(`${info.family}\u0000${info.line}`)
      : null;
    if (latest && compareVersions(info.version, latest) < 0) older.push(m);
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
