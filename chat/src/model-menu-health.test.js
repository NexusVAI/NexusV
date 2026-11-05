// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  HEALTH_BACKOFF_BASE_MS,
  HEALTH_BACKOFF_MAX_MS,
  HEALTH_FRESH_MS,
  HEALTH_STORAGE_KEY,
  buildSegments,
  compactHealthPayload,
  createHealthStore,
  createUptimeBar,
  hourKeysEndingAt,
  paintHealthBars,
  paintUptimeBar,
} from "./model-menu-health.js";

const HOUR = 3600000;
// 2026-11-05T08:12:38Z：与线上 model_health 抽样时刻同一类（非整点）
const NOW = Date.UTC(2026, 10, 5, 8, 12, 38);

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

// 与网关 buildModelHealthResponse 同形：24 个整点桶，最旧在前。
function payload(models) {
  return { generated_at: new Date(NOW).toISOString(), window_days: 1, models };
}
function hourlyWith(map) {
  return hourKeysEndingAt(NOW).map((hour) => {
    const v = map[hour];
    return { hour, total: v ? v[0] : 0, success_rate: v ? v[1] : null };
  });
}

describe("hourKeysEndingAt", () => {
  it("returns 24 UTC hour keys ending at the current hour, oldest first", () => {
    const keys = hourKeysEndingAt(NOW);
    expect(keys).toHaveLength(24);
    expect(keys[23]).toBe("2026-11-05T08:00:00Z");
    expect(keys[0]).toBe("2026-11-04T09:00:00Z");
  });

  it("matches the key format the gateway emits (hourly[0] of the live sample)", () => {
    // 线上抽样：generated_at 08:12 时 hourly[0].hour === "2026-11-04T09:00:00Z"
    expect(hourKeysEndingAt(NOW)[0]).toBe("2026-11-04T09:00:00Z");
  });
});

describe("compactHealthPayload", () => {
  it("keeps only hours that have samples and lower-cases ids", () => {
    const keys = hourKeysEndingAt(NOW);
    const rows = compactHealthPayload(
      payload([
        { model_id: "Step-3.7-Flash", hourly: hourlyWith({ [keys[22]]: [10, 100], [keys[23]]: [4, 50] }) },
        { model_id: "empty-model", hourly: hourlyWith({}) },
      ]),
    );
    expect(rows["step-3.7-flash"]).toEqual({ [keys[22]]: [10, 100], [keys[23]]: [4, 50] });
    expect(rows["empty-model"]).toEqual({});
  });

  it("rejects malformed responses and skips rows without an id", () => {
    expect(compactHealthPayload(null)).toBeNull();
    expect(compactHealthPayload({})).toBeNull();
    expect(compactHealthPayload({ models: "x" })).toBeNull();
    expect(compactHealthPayload(payload([{ hourly: [] }, null]))).toEqual({});
  });

  it("tolerates a row with no hourly array and a bucket with a non-string hour", () => {
    const rows = compactHealthPayload(
      payload([{ model_id: "a" }, { model_id: "b", hourly: [{ hour: 5, total: 3, success_rate: 100 }] }]),
    );
    expect(rows).toEqual({ a: {}, b: {} });
  });
});

describe("buildSegments", () => {
  const keys = hourKeysEndingAt(NOW);

  it("colours by success rate: >=90 ok, below that bad, no samples empty", () => {
    const segs = buildSegments(
      { [keys[20]]: [10, 90], [keys[21]]: [10, 89], [keys[22]]: [5, null] },
      NOW,
    );
    expect(segs[20].level).toBe("ok");
    expect(segs[21].level).toBe("bad");
    expect(segs[22].level).toBe("bad");
    expect(segs[23].level).toBe("empty");
    expect(segs[0].level).toBe("empty");
  });

  it("scales height by volume with a 42% floor and 34% for empty hours", () => {
    const segs = buildSegments({ [keys[10]]: [100, 100], [keys[11]]: [1, 100] }, NOW);
    expect(segs[10].ratio).toBe(1);
    expect(segs[11].ratio).toBe(0.42);
    expect(segs[12].ratio).toBe(0.34);
  });

  it("handles a model with no data at all", () => {
    const segs = buildSegments(null, NOW);
    expect(segs).toHaveLength(24);
    expect(segs.every((s) => s.level === "empty" && s.ratio === 0.34)).toBe(true);
  });

  it("re-aligns when the cache is older than an hour instead of shifting bars", () => {
    const old = { [keys[23]]: [10, 100] }; // 数据属于 08:00 这个小时
    const later = buildSegments(old, NOW + HOUR); // 一小时后 08:00 桶应移到倒数第二格
    expect(later[22].level).toBe("ok");
    expect(later[23].level).toBe("empty");
  });
});

describe("paintUptimeBar", () => {
  it("writes class, height and tooltip per segment and a summary aria-label", () => {
    const keys = hourKeysEndingAt(NOW);
    const bar = createUptimeBar();
    expect(bar.children).toHaveLength(24);
    paintUptimeBar(bar, { [keys[23]]: [20, 95], [keys[22]]: [10, 50] }, NOW);
    expect(bar.children[23].className).toBe("nmm-uptime__seg nmm-uptime__seg--ok");
    expect(bar.children[23].style.height).toBe("100%");
    expect(bar.children[22].className).toBe("nmm-uptime__seg nmm-uptime__seg--bad");
    expect(bar.children[23].title).toMatch(/成功率 95% · 20 次/);
    expect(bar.children[0].title).toMatch(/无调用样本/);
    // 加权：(95*20 + 50*10) / 30 = 80
    expect(bar.getAttribute("aria-label")).toBe("近24小时用户请求成功率 80%，共 30 次");
  });

  it("labels a bar with no samples", () => {
    const bar = createUptimeBar();
    paintUptimeBar(bar, null, NOW);
    expect(bar.getAttribute("aria-label")).toBe("近24小时无调用样本");
  });
});

describe("createHealthStore", () => {
  it("fetches when empty, then not while fresh, then again once stale", () => {
    let t = NOW;
    const store = createHealthStore({ now: () => t });
    expect(store.shouldFetch()).toBe(true);
    expect(store.apply(payload([{ model_id: "a", hourly: [] }]))).toBe(true);
    expect(store.shouldFetch()).toBe(false);
    t += HEALTH_FRESH_MS - 1;
    expect(store.shouldFetch()).toBe(false);
    t += 1;
    expect(store.shouldFetch()).toBe(true);
  });

  it("backs off exponentially on failure, capped, and resets on success", () => {
    let t = NOW;
    const store = createHealthStore({ now: () => t });
    store.fail();
    expect(store.shouldFetch()).toBe(false);
    t += HEALTH_BACKOFF_BASE_MS;
    expect(store.shouldFetch()).toBe(true);
    store.fail(); // 第二次：120s
    t += HEALTH_BACKOFF_BASE_MS * 2 - 1;
    expect(store.shouldFetch()).toBe(false);
    t += 1;
    expect(store.shouldFetch()).toBe(true);
    for (let i = 0; i < 10; i++) store.fail();
    t += HEALTH_BACKOFF_MAX_MS - 1;
    expect(store.shouldFetch()).toBe(false); // 退避上限 10 分钟，不再增长
    t += 1;
    expect(store.shouldFetch()).toBe(true);
    store.apply(payload([{ model_id: "a", hourly: [] }]));
    expect(store.failures).toBe(0);
  });

  it("a bad response does not replace good data or advance freshness", () => {
    const store = createHealthStore({ now: () => NOW });
    const keys = hourKeysEndingAt(NOW);
    store.apply(payload([{ model_id: "a", hourly: hourlyWith({ [keys[23]]: [3, 100] }) }]));
    const v = store.version;
    expect(store.apply({ models: null })).toBe(false);
    expect(store.version).toBe(v);
    expect(store.bucketsFor("A")).toEqual({ [keys[23]]: [3, 100] });
    expect(store.bucketsFor("unknown")).toBeNull();
    expect(store.bucketsFor("")).toBeNull();
    expect(store.bucketsFor("__proto__")).toBeNull();
    expect(store.bucketsFor("constructor")).toBeNull();
  });

  it("persists to storage and a new store starts from it without refetching", () => {
    let t = NOW;
    const storage = memoryStorage();
    const keys = hourKeysEndingAt(NOW);
    const a = createHealthStore({ storage, now: () => t });
    a.apply(payload([{ model_id: "m", hourly: hourlyWith({ [keys[23]]: [7, 100] }) }]));
    expect(storage.data[HEALTH_STORAGE_KEY]).toBeTruthy();

    t += 60 * 1000; // 刷新页面：1 分钟后
    const b = createHealthStore({ storage, now: () => t });
    expect(b.bucketsFor("m")).toEqual({ [keys[23]]: [7, 100] });
    expect(b.shouldFetch()).toBe(false);
    t += HEALTH_FRESH_MS;
    expect(b.shouldFetch()).toBe(true);
  });

  it("ignores corrupt / wrong-version storage and survives a throwing storage", () => {
    for (const raw of ["{not json", JSON.stringify({ v: 99, at: 1, rows: {} }), JSON.stringify({ v: 1, rows: {} })]) {
      const store = createHealthStore({ storage: memoryStorage({ [HEALTH_STORAGE_KEY]: raw }), now: () => NOW });
      expect(store.version).toBe(0);
      expect(store.shouldFetch()).toBe(true);
    }
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    const store = createHealthStore({ storage: throwing, now: () => NOW });
    expect(store.apply(payload([{ model_id: "a", hourly: [] }]))).toBe(true);
  });

  it("treats a clock moved backwards as stale rather than fresh forever", () => {
    let t = NOW;
    const store = createHealthStore({ now: () => t });
    store.apply(payload([{ model_id: "a", hourly: [] }]));
    t -= 3 * HOUR;
    expect(store.shouldFetch()).toBe(true);
  });
});

describe("paintHealthBars", () => {
  function menu(ids) {
    const root = document.createElement("div");
    for (const id of ids) {
      const row = document.createElement("div");
      row.className = "model-option";
      row.dataset.model = id;
      row.appendChild(createUptimeBar());
      root.appendChild(row);
    }
    return root;
  }

  it("paints each row from its own model id and skips bars whose data version is unchanged", () => {
    const keys = hourKeysEndingAt(NOW);
    const store = createHealthStore({ now: () => NOW });
    store.apply(
      payload([
        { model_id: "alpha", hourly: hourlyWith({ [keys[23]]: [9, 100] }) },
        { model_id: "beta", hourly: hourlyWith({ [keys[23]]: [9, 10] }) },
      ]),
    );
    const root = menu(["alpha", "beta", "gamma"]);
    paintHealthBars(root, store, NOW);
    const last = (i) => root.querySelectorAll(".nmm-uptime")[i].children[23].className;
    expect(last(0)).toContain("--ok");
    expect(last(1)).toContain("--bad");
    expect(last(2)).toContain("--empty");

    // 同一版本再调不应重画：手动改一格，若被重画就会被还原
    const probe = root.querySelectorAll(".nmm-uptime")[0].children[23];
    probe.className = "touched";
    paintHealthBars(root, store, NOW);
    expect(probe.className).toBe("touched");

    // 数据版本变了 → 重画
    store.apply(payload([{ model_id: "alpha", hourly: hourlyWith({ [keys[23]]: [9, 100] }) }]));
    paintHealthBars(root, store, NOW);
    expect(probe.className).toContain("--ok");
  });

  it("is a no-op for a missing root", () => {
    expect(() => paintHealthBars(null, createHealthStore({ now: () => NOW }), NOW)).not.toThrow();
  });
});
