/* Request log presentation. Optional telemetry stays unknown until the API supplies it. */
(function (root) {
  "use strict";

  var COPY = {
    zh: {
      columns: ["时间", "模型 / 状态", "缓存命中率", "输入 / 输出", "首字 / 耗时", "成本", "参数", "速度", "请求 IP", "密钥昵称"],
      caption: "API 请求日志", read: "缓存读取", write: "缓存写入", cache: "缓存", unknown: "未记录",
      unavailable: "未提供", success: "成功", failure: "失败", stream: "流式", nonstream: "非流",
      effort: "推理强度", first: "首字", duration: "耗时", cost: "实际扣费（人民币）",
      cacheHint: "缓存命中率 = 缓存读取 token / 输入 token；不包含缓存写入",
      timingHint: "首字：请求开始至首个正文 token；耗时：请求开始至结束",
      streamSpeed: "输出 token /（总耗时 − 首字时间）", nonstreamSpeed: "输出 token / 总耗时（非流请求平均吞吐）",
      readUnknown: "缓存读取未提供", writeUnknown: "缓存写入未提供",
      scroll: "左右滑动查看完整日志", note: "缓存命中率按输入 token 计算 · 金额单位为人民币 · 未记录的数据以 — 显示",
    },
    en: {
      columns: ["Time", "Model / Status", "Cache hit", "Input / Output", "TTFT / Duration", "Cost", "Parameters", "Speed", "Request IP", "Key nickname"],
      caption: "API request logs", read: "Cache read", write: "Cache write", cache: "Cache", unknown: "Not recorded",
      unavailable: "Not available", success: "Success", failure: "Failed", stream: "Stream", nonstream: "Non-stream",
      effort: "Reasoning effort", first: "TTFT", duration: "Duration", cost: "Actual charge (CNY)",
      cacheHint: "Cache hit = cache-read tokens / input tokens; cache writes are excluded",
      timingHint: "TTFT: request start to first content token; duration: request start to completion",
      streamSpeed: "Output tokens / (duration − TTFT)", nonstreamSpeed: "Output tokens / duration (non-stream average throughput)",
      readUnknown: "Cache read unavailable", writeUnknown: "Cache write unavailable",
      scroll: "Scroll horizontally to see all columns", note: "Cache hit is based on input tokens · Costs in CNY · Unrecorded values appear as —",
    },
  };
  var EFFORT = {
    max: ["Max", "red"], xhigh: ["XHigh", "yellow"], high: ["High", "yellow"],
    medium: ["medium", "green"], low: ["Low", "green"], none: ["none", "gray"],
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function nonnegative(value) {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
    var n = Number(value);
    return isFinite(n) && n >= 0 ? n : null;
  }

  function tokens(value) {
    var n = nonnegative(value);
    return n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function seconds(value) {
    return value === null ? "—" : (value / 1000).toFixed(2) + " s";
  }

  function missing(copy, title) {
    return '<span class="cnc-log-missing" title="' + esc(title || copy.unknown) + '">—</span>';
  }

  function renderRow(r, copy) {
    var input = nonnegative(r.input_tokens_total);
    if (input === null) input = nonnegative(r.tokens_in);
    var output = nonnegative(r.tokens_out);
    var cached = nonnegative(r.tokens_cached);
    var written = nonnegative(r.cache_creation_input_tokens);
    var hit = input > 0 && cached !== null && cached <= input ? cached / input * 100 : null;
    var cacheCell = missing(copy);
    if (hit !== null) {
      var tone = hit > 70 ? "green" : hit >= 30 ? "yellow" : "red";
      cacheCell = '<div class="cnc-log-hit" data-cache-tone="' + tone + '">' +
        '<span class="cnc-log-hit__value">' + hit.toFixed(1) + '%</span>' +
        '<span class="cnc-log-hit__track" aria-hidden="true"><span style="width:' + hit + '%"></span></span></div>';
    }

    var latency = nonnegative(r.latency_ms);
    var ttft = nonnegative(r.ttft_ms);
    if (latency !== null && ttft !== null && ttft > latency) ttft = null;
    var speed = null;
    var speedHint = copy.unknown;
    if (r.stream === true && latency !== null && ttft !== null && latency > ttft && output > 0) {
      speed = output / ((latency - ttft) / 1000);
      speedHint = copy.streamSpeed;
    } else if (r.stream === false && latency > 0 && output > 0) {
      speed = output / (latency / 1000);
      speedHint = copy.nonstreamSpeed;
    }

    var charged = nonnegative(r.charged_micro);
    var cost = charged === null ? missing(copy) : "¥" + (charged / 1000000).toLocaleString("en-US", {
      minimumFractionDigits: charged > 0 && charged < 100 ? 6 : 4,
      maximumFractionDigits: charged > 0 && charged < 100 ? 6 : 4,
    });
    var effortId = typeof r.reasoning_effort === "string" ? r.reasoning_effort.trim().toLowerCase() : "";
    var effort = Object.prototype.hasOwnProperty.call(EFFORT, effortId) ? EFFORT[effortId] : null;
    var params = effort
      ? '<span class="cnc-log-effort" data-effort="' + effortId + '" data-tone="' + effort[1] + '" title="' + esc(copy.effort) + '">' + effort[0] + '</span>'
      : missing(copy);
    var mode = typeof r.stream === "boolean" ? esc(r.stream ? copy.stream : copy.nonstream) : missing(copy);
    var date = r.created_at ? new Date(r.created_at) : null;
    var validDate = date && isFinite(date.getTime());
    var time = validDate ? date.toLocaleTimeString("en-GB", { hour12: false }) : "—";
    var day = validDate ? date.toLocaleDateString("en-CA") : "—";
    var status = nonnegative(r.status_code);
    var ok = status !== null && status >= 200 && status < 400;
    var statusHtml = status === null ? missing(copy) :
      '<span class="cnc-log-status" data-ok="' + (ok ? "1" : "0") + '">' + esc(status) + '</span>' +
      '<span class="cnc-log-outcome">' + esc(ok ? copy.success : copy.failure) + '</span>';
    var readValue = cached !== null ? tokens(cached) : "—";
    var writeValue = written !== null ? tokens(written) : "—";
    var readTitle = cached === null ? copy.readUnknown : copy.read + ": " + readValue;
    var writeTitle = written === null ? copy.writeUnknown : copy.write + ": " + writeValue;

    return '<tr>' +
      '<td><div class="cnc-log-primary cnc-log-mono">' + esc(time) + '</div><div class="cnc-log-secondary cnc-log-date">' + esc(day) + '</div></td>' +
      '<td><div class="cnc-log-primary cnc-log-model" title="' + esc(r.model) + '">' + esc(r.model || "—") + '</div><div class="cnc-log-secondary cnc-log-result">' + statusHtml + '</div></td>' +
      '<td title="' + esc(copy.cacheHint) + '">' + cacheCell + '</td>' +
      '<td><div class="cnc-log-primary cnc-log-mono" aria-label="' + esc(copy.columns[3]) + '">' + tokens(input) + '<span class="cnc-log-separator"> / </span>' + tokens(output) + '</div>' +
        '<div class="cnc-log-secondary cnc-log-cache-detail"><span>' + esc(copy.cache) + '</span> ' +
        '<span class="cnc-log-cache-read" title="' + esc(readTitle) + '" aria-label="' + esc(readTitle) + '"><span aria-hidden="true">↓ </span>' + readValue + '</span>' +
        '<span class="cnc-log-cache-write" title="' + esc(writeTitle) + '" aria-label="' + esc(writeTitle) + '"><span aria-hidden="true">↑ </span>' + writeValue + '</span></div></td>' +
      '<td><div class="cnc-log-primary cnc-log-mono" title="' + esc(copy.first) + '">' + seconds(ttft) + '</div><div class="cnc-log-secondary cnc-log-mono" title="' + esc(copy.duration) + '">' + seconds(latency) + '</div></td>' +
      '<td><div class="cnc-log-primary cnc-log-mono cnc-log-cost" title="' + esc(copy.cost) + '">' + cost + '</div><div class="cnc-log-secondary">CNY</div></td>' +
      '<td><div class="cnc-log-primary">' + params + '</div><div class="cnc-log-secondary cnc-log-mode">' +
        (typeof r.stream === "boolean" ? '<span class="cnc-log-mode-dot" aria-hidden="true"></span>' : "") + mode + '</div></td>' +
      '<td title="' + esc(speedHint) + '"><div class="cnc-log-primary cnc-log-mono">' + (speed === null ? missing(copy) : speed.toFixed(1)) + '</div><div class="cnc-log-secondary">token/s</div></td>' +
      '<td class="cnc-log-mono cnc-log-ip" title="' + esc(r.ip) + '">' + (r.ip ? esc(r.ip) : missing(copy)) + '</td>' +
      '<td class="cnc-log-key" title="' + esc(r.key_name) + '">' + (r.key_name ? esc(r.key_name) : missing(copy)) + '</td>' +
      '</tr>';
  }

  function render(rows, options) {
    var copy = COPY[options && options.lang === "en" ? "en" : "zh"];
    var hints = { 2: copy.cacheHint, 4: copy.timingHint, 5: copy.cost };
    var widths = [8, 15, 9, 15, 9, 8, 7, 7, 12, 10];
    return '<div class="cnc-log-scroll" role="region" tabindex="0" aria-label="' + esc(copy.scroll) + '">' +
      '<table class="cnc-log-table cnc-log-table--detail"><caption class="cnc-log-sr-only">' + esc(copy.caption) + '</caption><colgroup>' +
      widths.map(function (width) { return '<col style="width:' + width + '%">'; }).join("") + '</colgroup><thead><tr>' +
      copy.columns.map(function (label, index) {
        return '<th scope="col"' + (hints[index] ? ' title="' + esc(hints[index]) + '"' : "") + '>' + esc(label) +
          (hints[index] ? '<span class="cnc-log-info" aria-hidden="true">?</span>' : "") + '</th>';
      }).join("") + '</tr></thead><tbody>' + rows.map(function (r) { return renderRow(r, copy); }).join("") + '</tbody></table></div>' +
      '<div class="cnc-log-table-note">' + esc(copy.note) + '</div>';
  }

  root.CancriLogsTable = { render: render };
})(typeof window === "undefined" ? globalThis : window);
