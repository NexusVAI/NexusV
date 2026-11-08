import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../api/logs-table.js", import.meta.url), "utf8").catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return "";
});
const context = vm.createContext({});
vm.runInContext(source, context);
const row = {
  model: "gpt-6.1-sol", created_at: "2026-11-08T14:42:34Z", status_code: 200,
  tokens_in: 6743, tokens_out: 941, tokens_cached: 5248, cache_creation_input_tokens: 1024,
  latency_ms: 8140, ttft_ms: 820, charged_micro: 35218,
  reasoning_effort: "high", stream: true, ip: "203.0.113.24", key_name: "生产环境",
};
function render(overrides = {}, options = {}) {
  assert.equal(typeof context.CancriLogsTable?.render, "function", "日志表格需要独立的渲染模块");
  return context.CancriLogsTable.render([{ ...row, ...overrides }], { lang: "zh", ...options });
}

test("renders every requested column and two-line cache token detail", () => {
  const html = render();
  for (const label of ["时间", "模型 / 状态", "缓存命中率", "输入 / 输出", "首字 / 耗时", "成本", "参数", "速度", "请求 IP", "密钥昵称"]) {
    assert.ok(html.includes(label), `missing column: ${label}`);
  }
  for (const value of ["6,743", "941", "5,248", "1,024", "77.8%", "0.82 s", "8.14 s", "¥0.0352", "128.6", "token/s", "203.0.113.24", "生产环境"]) {
    assert.ok(html.includes(value), `missing request detail: ${value}`);
  }
  assert.match(html, /缓存读取/);
  assert.match(html, /缓存写入/);
});

for (const [ratio, tone] of [[0, "red"], [20, "red"], [25, "red"], [29.9, "red"], [30, "yellow"], [60, "yellow"], [65, "yellow"], [70, "yellow"], [70.1, "green"], [100, "green"]]) {
  test(`cache hit ${ratio}% uses ${tone} without threshold gaps`, () => {
    const html = render({ tokens_in: 1000, tokens_cached: ratio * 10 });
    assert.ok(html.includes(`data-cache-tone="${tone}"`));
    assert.ok(html.includes(`${ratio.toFixed(1)}%`));
  });
}

test("missing cache telemetry is unknown, not a zero cache hit", () => {
  const html = render({ tokens_cached: null, cache_creation_input_tokens: null });
  assert.doesNotMatch(html, /data-cache-tone=|0\.0%|NaN|Infinity/);
  assert.match(html, /缓存读取未提供/);
  assert.match(html, /缓存写入未提供/);
});

test("zero input and out-of-range cache values do not produce made-up percentages", () => {
  for (const overrides of [{ tokens_in: 0, tokens_cached: 0 }, { tokens_cached: 7000 }, { tokens_cached: -1 }]) {
    assert.doesNotMatch(render(overrides), /data-cache-tone=|NaN|Infinity/);
  }
});

test("actual micro-CNY charges preserve zero, null and very small amounts", () => {
  assert.match(render({ charged_micro: 0 }), /¥0\.0000/);
  assert.match(render({ charged_micro: 1 }), /¥0\.000001/);
  assert.match(render({ charged_micro: 42 }), /¥0\.000042/);
  for (const value of [null, undefined, "", false, -1]) {
    assert.doesNotMatch(render({ charged_micro: value }), /¥/);
  }
});

test("legacy rows keep missing timing, parameters, IP and key names unknown", () => {
  const html = render({
    ttft_ms: null, latency_ms: null, reasoning_effort: null, stream: null,
    ip: null, key_name: null, tokens_per_second: null,
  });
  assert.doesNotMatch(html, /0\.00 s|0\.0 token\/s|data-effort=|非流|NaN|Infinity/);
  assert.match(html, /未记录/);
});

for (const [effort, label, tone] of [["max", "Max", "red"], ["xhigh", "XHigh", "yellow"], ["high", "High", "yellow"], ["medium", "medium", "green"], ["low", "Low", "green"], ["none", "none", "gray"]]) {
  test(`${effort} reasoning is labeled ${label} in ${tone}`, () => {
    const html = render({ reasoning_effort: effort });
    assert.ok(html.includes(`data-effort="${effort}" data-tone="${tone}"`));
    assert.ok(html.includes(`>${label}</span>`));
  });
}

test("stream and non-stream requests use explicit mode and labeled speed calculations", () => {
  assert.match(render({ stream: true }), /流式/);
  const html = render({ stream: false });
  assert.match(html, /非流/);
  assert.match(html, /115\.6/);
  assert.match(html, /输出 token \/ 总耗时/);
  assert.doesNotMatch(render({ stream: "false" }), /非流/);
  assert.doesNotMatch(render({ stream: true, ttft_ms: 9000 }), /128\.6|Infinity|NaN/);
});

test("one-chunk streams retain average throughput instead of dividing by zero", () => {
  const html = render({ ttft_ms: 8140, latency_ms: 8140, stream: true });
  assert.match(html, /115\.6/);
  assert.match(html, /平均吞吐/);
  assert.doesNotMatch(html, /Infinity|NaN/);
});

test("new requests with no explicit reasoning setting show default, not none", () => {
  const html = render({ timing_version: 2, reasoning_effort: null });
  assert.match(html, /默认/);
  assert.doesNotMatch(html, /data-effort="none"/);
});

test("raw input totals exclude pricing multipliers in the cache denominator", () => {
  const html = render({ tokens_in: 950, input_tokens_total: 900, tokens_cached: 600 });
  assert.match(html, /66\.7%/);
  assert.match(html, />900</);
});

test("TTFT is the first content token, never inferred from total duration", () => {
  const html = render({ ttft_ms: null, latency_ms: 3100 });
  assert.match(html, /3\.10 s/);
  assert.doesNotMatch(html, /0\.00 s|128\.6/);
});

test("upstream text is escaped in both visible cells and attributes", () => {
  const html = render({ model: '<img src=x onerror="alert(1)">', key_name: '"<script>alert(1)</script>', ip: '<svg onload="x">' });
  assert.doesNotMatch(html, /<img|<script|<svg/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&quot;&lt;script/);
});

test("English table uses the same data contract", () => {
  const html = render({}, { lang: "en" });
  assert.match(html, /Cache hit/);
  assert.match(html, /TTFT \/ Duration/);
  assert.match(html, /Key nickname/);
  assert.match(html, /¥0\.0352/);
});
