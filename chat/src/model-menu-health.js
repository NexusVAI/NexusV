// 模型菜单「近 24h 状态条」。
//
// 口径与模型广场（chat/api/oai-models.js 的 uptimeHtml）保持一致：
//   · 数据来自 chat-gateway `model_health`（model_health_logs 里真实用户请求的成功/失败），
//     不是定时探测；
//   · 每小时一根竖条，成功率 >= 90 为绿，其余为黄，没有样本为灰；
//   · 竖条高度 = 该小时请求量 / 24h 内最大请求量（下限 42%，无样本 34%）。
//
// 打爆网关的防线（调用方是 main.js 的 fetchModelHealthStatus）：
//   1. 请求体与既有调用完全相同（{endpoint:"model_health", window_days:1}），
//      网关侧按这个键缓存 300s（MODEL_HEALTH_CACHE_TTL_MS），多打也只是命中同一份缓存；
//   2. 客户端 5 分钟内不重复请求（HEALTH_FRESH_MS，与网关缓存 TTL 对齐，更勤拿不到更新数据）；
//   3. 失败后指数退避 60s → 120s → … 上限 10 分钟，网关挂了时反复开菜单不会连环重试；
//   4. 结果落 localStorage，刷新页面先用旧数据画，不为画条再发一次请求。
//
// 这个文件只管「数据怎么存、条怎么画」，不发请求。

export const HEALTH_HOURS = 24;
export const HEALTH_FRESH_MS = 5 * 60 * 1000;
export const HEALTH_BACKOFF_BASE_MS = 60 * 1000;
export const HEALTH_BACKOFF_MAX_MS = 10 * 60 * 1000;
export const HEALTH_STORAGE_KEY = "cancri_model_health_hourly";
const HEALTH_STORAGE_VERSION = 1;
const HOUR_MS = 3600000;
const OK_RATE = 90;

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

/** 以 nowMs 所在小时为终点、往前共 24 个整点桶的 key，最旧在前。格式与网关一致：2026-11-04T09:00:00Z。 */
export function hourKeysEndingAt(nowMs) {
  const end = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const keys = [];
  for (let i = HEALTH_HOURS - 1; i >= 0; i--) {
    keys.push(new Date(end - i * HOUR_MS).toISOString().slice(0, 13) + ":00:00Z");
  }
  return keys;
}

/**
 * model_health 响应 → { 小写模型id: { 小时key: [total, successRate|null] } }。
 * 只保留有样本的小时：绝大多数模型大多数小时是空的，这样落 localStorage 很小。
 * 响应不合法返回 null。
 */
export function compactHealthPayload(data) {
  if (!data || !Array.isArray(data.models)) return null;
  const rows = {};
  for (const m of data.models) {
    const id = String((m && m.model_id) || "").trim().toLowerCase();
    if (!id) continue;
    const buckets = {};
    if (Array.isArray(m.hourly)) {
      for (const h of m.hourly) {
        const total = Number(h && h.total) || 0;
        if (total <= 0 || typeof h.hour !== "string") continue;
        buckets[h.hour] = [total, typeof h.success_rate === "number" ? h.success_rate : null];
      }
    }
    rows[id] = buckets;
  }
  return rows;
}

/** 按「现在」重新对齐 24 个小时桶。缓存放久了、跨了整点也不会错位，只会在最新那格显示为空。 */
export function buildSegments(buckets, nowMs) {
  const keys = hourKeysEndingAt(nowMs);
  let maxTotal = 1;
  const cells = keys.map((hour) => {
    const b = buckets ? buckets[hour] : null;
    const total = b ? Number(b[0]) || 0 : 0;
    const rate = b && typeof b[1] === "number" ? b[1] : null;
    if (total > maxTotal) maxTotal = total;
    return { hour, total, rate };
  });
  return cells.map((c) => ({
    hour: c.hour,
    total: c.total,
    rate: c.rate,
    level: c.total > 0 ? (c.rate != null && c.rate >= OK_RATE ? "ok" : "bad") : "empty",
    ratio: c.total > 0 ? Math.max(0.42, c.total / maxTotal) : 0.34,
  }));
}

export function segmentTooltip(seg) {
  const d = new Date(seg.hour);
  if (!seg.total) {
    if (isNaN(d.getTime())) return "无调用样本";
  }
  const end = new Date(d.getTime() + HOUR_MS);
  const span = `${pad2(d.getHours())}:${pad2(d.getMinutes())}–${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
  if (!seg.total) return span + " 无调用样本";
  return `${span} 成功率 ${seg.rate == null ? "—" : seg.rate + "%"} · ${seg.total} 次`;
}

function summaryLabel(segs) {
  let total = 0;
  let okWeighted = 0;
  for (const s of segs) {
    total += s.total;
    okWeighted += (s.rate || 0) * s.total;
  }
  if (!total) return "近24小时无调用样本";
  return `近24小时用户请求成功率 ${Math.round(okWeighted / total)}%，共 ${total} 次`;
}

/** 空白状态条（24 根灰柱）。画在每一行的行尾，数据到了再由 paintUptimeBar 填。 */
export function createUptimeBar() {
  const bar = document.createElement("div");
  bar.className = "nmm-uptime";
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", "近24小时无调用样本");
  for (let i = 0; i < HEALTH_HOURS; i++) {
    const seg = document.createElement("span");
    seg.className = "nmm-uptime__seg nmm-uptime__seg--empty";
    seg.style.height = "34%";
    bar.appendChild(seg);
  }
  return bar;
}

export function paintUptimeBar(bar, buckets, nowMs) {
  const segs = buildSegments(buckets, nowMs);
  const nodes = bar.children;
  for (let i = 0; i < HEALTH_HOURS && i < nodes.length; i++) {
    const s = segs[i];
    const node = nodes[i];
    node.className = "nmm-uptime__seg nmm-uptime__seg--" + s.level;
    node.style.height = Math.round(s.ratio * 100) + "%";
    node.title = segmentTooltip(s);
  }
  bar.setAttribute("aria-label", summaryLabel(segs));
}

/**
 * 健康数据仓库：内存 + localStorage，并负责「该不该发请求」的判断。
 * storage / now 可注入，方便测试。
 */
export function createHealthStore({ storage = null, now = Date.now } = {}) {
  let rows = {};
  let fetchedAt = 0;
  let version = 0;
  let failures = 0;
  let retryAt = 0;

  if (storage) {
    try {
      const raw = storage.getItem(HEALTH_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          parsed.v === HEALTH_STORAGE_VERSION &&
          parsed.rows &&
          typeof parsed.rows === "object" &&
          Number.isFinite(parsed.at)
        ) {
          rows = parsed.rows;
          fetchedAt = parsed.at;
          version = 1;
        }
      }
    } catch {
      // 缓存损坏就当没有，下次请求会覆盖
    }
  }

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(
        HEALTH_STORAGE_KEY,
        JSON.stringify({ v: HEALTH_STORAGE_VERSION, at: fetchedAt, rows }),
      );
    } catch {
      // 配额满 / 隐私模式：只影响刷新后的首屏，不影响本次会话
    }
  }

  return {
    get version() {
      return version;
    },
    get fetchedAt() {
      return fetchedAt;
    },
    get failures() {
      return failures;
    },
    /** 退避期内、或数据还新鲜都不该请求。本机时钟被拨回（age < 0）按过期处理。 */
    shouldFetch() {
      const t = now();
      if (t < retryAt) return false;
      const age = t - fetchedAt;
      return age < 0 || age >= HEALTH_FRESH_MS;
    },
    apply(data) {
      const next = compactHealthPayload(data);
      if (!next) return false;
      rows = next;
      fetchedAt = now();
      failures = 0;
      retryAt = 0;
      version += 1;
      persist();
      return true;
    },
    fail() {
      failures += 1;
      retryAt =
        now() + Math.min(HEALTH_BACKOFF_MAX_MS, HEALTH_BACKOFF_BASE_MS * 2 ** (failures - 1));
    },
    bucketsFor(modelId) {
      const key = String(modelId || "").trim().toLowerCase();
      return key && Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null;
    },
  };
}

/**
 * 给 root 下所有 .nmm-uptime 上色。(数据版本, 当前整点) 没变的条直接跳过，
 * 所以菜单每次打开、每次 updateModelDropdownIndicators 都可以放心调。
 */
export function paintHealthBars(root, store, nowMs = Date.now()) {
  if (!root) return;
  const keys = hourKeysEndingAt(nowMs);
  const stamp = store.version + ":" + keys[keys.length - 1];
  root.querySelectorAll(".nmm-uptime").forEach((bar) => {
    if (bar.dataset.hv === stamp) return;
    const row = bar.closest(".model-option");
    paintUptimeBar(bar, store.bucketsFor(row && row.dataset.model), nowMs);
    bar.dataset.hv = stamp;
  });
}
