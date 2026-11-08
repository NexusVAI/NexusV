// Synthetic requests for local UI screenshots only. IPs use RFC 5737 documentation ranges.
export const usage = [
  ["22:42:34", "gpt-6.1-sol", 6743, 941, 5248, 1024, 820, 8140, 35218, "max", true, "203.0.113.24", "生产环境"],
  ["22:42:18", "claude-opus-5.5", 48320, 1824, 43840, 2048, 1240, 18600, 128476, "xhigh", true, "198.51.100.18", "Claude Code"],
  ["22:41:56", "gpt-6-astra", 12800, 642, 6656, 3072, 560, 5720, 46920, "high", true, "203.0.113.24", "生产环境"],
  ["22:41:32", "gemini-3.8-flash", 4200, 386, 1680, 1024, 310, 2380, 6234, "medium", true, "192.0.2.86", "测试环境"],
  ["22:41:08", "deepseek-v4.1-flash", 8640, 1280, 1037, 4096, 420, 6640, 1824, "low", true, "198.51.100.64", "自动化任务"],
  ["22:40:45", "gpt-6.1-sol", 2100, 148, 0, 1536, 940, 2690, 12580, "none", false, "192.0.2.86", "测试环境"],
  ["22:40:21", "claude-opus-5.5", 108240, 3421, 98720, 8192, 1760, 32480, 245600, "high", true, "198.51.100.18", "Claude Code"],
  ["22:39:58", "gemini-3.8-flash", 0, 0, null, null, null, 1240, 0, "none", false, "203.0.113.112", "开发环境", 429],
  ["22:39:36", "gpt-6.1-sol", 16384, 2048, 11520, 4096, 680, 15360, 86320, "medium", true, "203.0.113.24", "生产环境"],
  ["22:39:12", "deepseek-v4.1-flash", 1920, 256, 0, 0, 280, 1580, 409, "low", false, "198.51.100.64", "自动化任务"],
].map(([time, model, tokens_in, tokens_out, tokens_cached, cache_creation_input_tokens, ttft_ms, latency_ms, charged_micro, reasoning_effort, stream, ip, key_name, status_code = 200]) => ({
  created_at: `2026-11-08T${time}+08:00`, model, tokens_in, tokens_out, tokens_cached,
  cache_creation_input_tokens, ttft_ms, latency_ms, charged_micro, reasoning_effort, stream, ip, key_name, status_code,
}));

export const legacyUsage = [{
  created_at: "2026-11-08T22:42:34+08:00", model: "gpt-6.1-sol", tokens_in: 6743,
  tokens_out: 941, charged_micro: 35218, status_code: 200,
}];
