/// <reference lib="dom" />
/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalizeAllowedOrigin(value: string): string {
  const clean = value.trim().replace(/\/+$/, "");
  if (!clean) return "";
  try {
    return new URL(clean).origin;
  } catch {
    return clean;
  }
}

// Configure via ALLOWED_ORIGINS env var (comma-separated origins).
// 2026-05-13 审查：fallback 对齐 chat-gateway 的生产域名，env 缺失时不再
// 直接全拒，让 OPTIONS 探测和本地调试也能跑通。
const ALLOWED_ORIGINS = (
  Deno.env.get("ALLOWED_ORIGINS") ||
  "https://www.nexusvai.xyz,https://nexusvai.xyz"
)
  .split(",")
  .map(normalizeAllowedOrigin)
  .filter(Boolean);

function readSupabaseKeyDict(name: string): Record<string, string> {
  const raw = Deno.env.get(name) || "{}";
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function firstKey(dict: Record<string, string>): string {
  return dict.default || Object.values(dict)[0] || "";
}

const SUPABASE_SECRET_KEY = firstKey(
  readSupabaseKeyDict("SUPABASE_SECRET_KEYS"),
);
const INTERNAL_GATEWAY_SECRET =
  Deno.env.get("INTERNAL_GATEWAY_SECRET") || SUPABASE_SECRET_KEY;
const LOG_HASH_SECRET =
  Deno.env.get("LOG_HASH_SECRET") ||
  Deno.env.get("ALTCHA_HMAC_KEY") ||
  INTERNAL_GATEWAY_SECRET;
if (!Deno.env.get("INTERNAL_GATEWAY_SECRET")) {
  console.warn(
    "[security] INTERNAL_GATEWAY_SECRET not set, falling back to SUPABASE_SECRET_KEY. Set a unique INTERNAL_GATEWAY_SECRET in Supabase secrets for better security.",
  );
}

const MAX_IN_MEMORY_MAP_SIZE = 5000;

function trimMapIfNeeded<K, V>(map: Map<K, V>): void {
  if (map.size > MAX_IN_MEMORY_MAP_SIZE) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
}

function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin") || "";
  if (!origin) return null;
  if (ALLOWED_ORIGINS.some((allowed) => origin === allowed)) return origin;
  return null;
}

// ─── Hardening: secure response headers ─────────────────────────────
const SECURE_RESPONSE_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "interest-cohort=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

let lastHttpOriginWarn = 0;
function noteHttpOriginIfAny(origin: string): void {
  if (!origin || !origin.startsWith("http://")) return;
  const now = Date.now();
  if (now - lastHttpOriginWarn < 60_000) return;
  lastHttpOriginWarn = now;
  console.warn(
    `[security] http_origin_used ${JSON.stringify({ service: "modelscope-proxy", origin, time: new Date().toISOString() })}`,
  );
}

const STRICT_HTTPS_ONLY =
  (Deno.env.get("STRICT_HTTPS_ONLY") || "").toLowerCase() === "true";

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = getAllowedOrigin(req);
  const headers: Record<string, string> = {
    ...SECURE_RESPONSE_HEADERS,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, accept, origin, x-chat-turn-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers":
      "modelscope-ratelimit-requests-limit, modelscope-ratelimit-requests-remaining, modelscope-ratelimit-model-requests-limit, modelscope-ratelimit-model-requests-remaining",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function rejectInsecureOriginIfStrict(
  req: Request,
  ch: Record<string, string>,
): Response | null {
  if (!STRICT_HTTPS_ONLY) return null;
  const origin = String(req.headers.get("origin") || "")
    .replace(/[\r\n\t]/g, "")
    .trim();
  if (!origin) return null;
  if (origin.startsWith("https://")) return null;
  return new Response(
    JSON.stringify({
      error: "insecure_origin",
      code: "insecure_origin",
      message: "请使用 HTTPS 访问",
    }),
    {
      status: 426,
      headers: { ...ch, "Content-Type": "application/json" },
    },
  );
}

const abuseMap = new Map<
  string,
  {
    count: number;
    resetAt: number;
    lastAt: number;
    rapidHits: number;
    challengeUntil: number;
    blockedUntil: number;
  }
>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const CHALLENGE_DURATION_MS = 10 * 60_000;
const BLOCK_DURATION_MS = 60 * 60_000;
const RAPID_REQUEST_MS = 650;
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MODEL_UNAVAILABLE_WINDOW_MS = 3 * 60_000;
const MODEL_UNAVAILABLE_BLOCK_MS = 5 * 60_000;
const MODEL_UNAVAILABLE_FAILURE_LIMIT = 6;
const modelAvailabilityMap = new Map<
  string,
  { failures: number; resetAt: number; blockedUntil: number }
>();
const turnUsageMap = new Map<
  string,
  { count: number; resetAt: number; counted: boolean; blockedUntil: number }
>();
const TURN_USAGE_TTL_MS = 15 * 60_000;
const TURN_LIMITS: Record<string, number> = {
  direct_chat: 18,
  tool_followup_chat: 32,
  compare_model_answer: 4,
  arena_model_answer: 4,
  arena_create_match: 4,
  tool_call: 12,
};
const DEFAULT_TURN_LIMIT = 18;

function getTurnCallLimit(requestKind: string): number {
  return TURN_LIMITS[requestKind] ?? DEFAULT_TURN_LIMIT;
}

interface RequestContext {
  service: string;
  endpoint: string;
  ip: string;
  ip_hash: string;
  device: string;
  device_hash: string;
  user: string;
  user_hash: string;
  origin: string;
  model: string;
}

function cleanHeader(value: string | null): string {
  return String(value || "")
    .replace(/[\r\n\t]/g, "")
    .trim();
}

function getForwardedUserId(req: Request): string {
  const internalSecret = cleanHeader(req.headers.get("x-internal-secret"));
  if (!INTERNAL_GATEWAY_SECRET || internalSecret !== INTERNAL_GATEWAY_SECRET)
    return "";
  return cleanHeader(req.headers.get("x-forwarded-user-id"));
}

function getTrustedGatewayHeader(req: Request, name: string): string {
  if (!getForwardedUserId(req)) return "";
  return cleanHeader(req.headers.get(name));
}

function getClientIp(req: Request): string {
  // Trust the gateway-forwarded IP first (chat-gateway already resolved it).
  // For direct calls, fall back to the standard proxy headers. Supabase Edge
  // Functions populate X-Forwarded-For with the real client IP — `cf-connecting-ip`
  // is only present when the request happens to traverse Cloudflare, so XFF
  // must be checked first or IP-scoped rate limits collapse onto "unknown".
  const gatewayIp = getTrustedGatewayHeader(req, "x-cancri-client-ip");
  if (gatewayIp) return gatewayIp;
  const xff = cleanHeader(req.headers.get("x-forwarded-for"));
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const cfIp = cleanHeader(req.headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;
  const realIp = cleanHeader(req.headers.get("x-real-ip"));
  if (realIp) return realIp;
  return "unknown";
}

function maskIdentifier(value: string): string {
  const clean = cleanHeader(value);
  if (!clean) return "anonymous";
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`;
}

async function hashLogIdentifier(
  label: string,
  value: string,
): Promise<string> {
  const clean = cleanHeader(value);
  if (!clean) return "anonymous";
  if (!LOG_HASH_SECRET) return "hash_unconfigured";
  return (await hmacSha256(LOG_HASH_SECRET, `${label}:${clean}`)).slice(0, 10);
}

async function getRequestContext(
  req: Request,
  service: string,
  endpoint = "unknown",
  model = "",
  userId = "",
): Promise<RequestContext> {
  const ip = getClientIp(req);
  const user = userId;
  const ua =
    (
      getTrustedGatewayHeader(req, "x-cancri-client-ua") ||
      cleanHeader(req.headers.get("user-agent"))
    ).slice(0, 96) || "unknown";
  const origin =
    getTrustedGatewayHeader(req, "x-cancri-client-origin") ||
    cleanHeader(req.headers.get("origin")) ||
    "none";
  const device = `${ip}|ua:${maskIdentifier(ua)}|user:${maskIdentifier(user)}`;
  // Parallelize the three HMACs — every chat request runs through here
  // before the upstream fetch even starts, so cutting 2 sequential awaits
  // (~2 ms on Edge runtime) shows up directly in TTFB. Promise.all is
  // safe because the inputs are already captured in locals.
  const [ipHash, deviceHash, userHash] = await Promise.all([
    hashLogIdentifier("ip", ip),
    hashLogIdentifier("device", `${ip}|${ua}|${user}`),
    hashLogIdentifier("user", user),
  ]);
  return {
    service,
    endpoint: cleanHeader(endpoint) || "unknown",
    model: cleanHeader(model) || "unknown",
    ip,
    ip_hash: ipHash,
    device,
    device_hash: deviceHash,
    user: maskIdentifier(user),
    user_hash: userHash,
    origin,
  };
}

function logSecurityEvent(
  event: string,
  ctx: RequestContext,
  extra: Record<string, unknown> = {},
): void {
  const { ip: _ip, device: _device, user: _user, ...safeCtx } = ctx;
  const maskedIp = _ip ? _ip.replace(/\.\d+$/, ".*") : "";
  const maskedUser = _user || "";
  console.info(
    `[security] ${JSON.stringify({ event, time: new Date().toISOString(), ...safeCtx, masked_ip: maskedIp, masked_user: maskedUser, ...extra })}`,
  );
}

function sanitizeUpstreamError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg
    .replace(/https?:\/\/[^\s"']+(:\d+)?/g, "[upstream]")
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, "[upstream]");
}

// ─── Outbound third-party masking ─────────────────────────────────────
//
// We aggregate ~25 upstream providers (chshapi, new-api, openrouter,
// xiangluapi, supxh, xem8k5, …). Their raw error bodies leak that we are
// reselling through them — e.g. `type:"new_api_error"`, "您的余额不足", or
// `model:"openrouter:meta-llama/llama-3.3-70b-instruct:free"`. We translate
// every outbound payload into a single Cancri-formatted shape before it
// reaches the browser, and route the raw upstream body to the security log
// (visible to us, never to the user).
//
// Classification policy (2026-05-16): **HTTP status only, never body text**.
// We deliberately do NOT match keywords/regex against the upstream error
// body. Keyword classification is fragile (every new provider's wording
// escapes it), invites false positives on legitimate model output, and
// risks bleeding upstream vocabulary into our own error code. HTTP status
// is contractual — 401/403/404 = unavailable, 429 = quota, 4xx = bad
// request, 5xx/0 = transient. Anything finer must come from a structured
// field whitelist (e.g. an upstream `error.type` enum value), never a
// free-text scan.
type SanitizedErrorCode =
  | "model_unavailable"
  | "model_quota_exceeded"
  | "model_request_invalid"
  | "model_temporary_failure";

const SANITIZED_ERROR_TEMPLATES: Record<SanitizedErrorCode, string> = {
  model_unavailable: "该模型当前无法使用，请尝试其他模型。",
  model_quota_exceeded: "该模型今日额度已用完，请稍后或切换其他模型。",
  model_request_invalid: "请求未被模型接受，请调整内容后重试。",
  model_temporary_failure: "当前模型服务暂时不可用，请稍后重试。",
};

function classifyByStatus(status: number): SanitizedErrorCode {
  if (status === 429) return "model_quota_exceeded";
  if (status === 401 || status === 403 || status === 404) return "model_unavailable";
  if (status === 400 || status === 413 || status === 422) return "model_request_invalid";
  // 5xx, 408, 504, 0 (network), and any other non-success → transient.
  return "model_temporary_failure";
}

// Backward-compatible wrapper so existing call sites keep their signature.
// `_rawText` is intentionally ignored — see classification policy comment
// above. Kept for grep-friendly naming and to make refactor diffs minimal.
function classifyUpstreamError(
  status: number,
  _rawText: string,
): { code: SanitizedErrorCode; message: string } {
  const code = classifyByStatus(status);
  return { code, message: SANITIZED_ERROR_TEMPLATES[code] };
}

function sanitizedErrorJson(
  status: number,
  _rawText: string,
  _canonicalModel: string,
): string {
  const code = classifyByStatus(status);
  const message = SANITIZED_ERROR_TEMPLATES[code];
  // Keep both nested `error` (OpenAI shape) and top-level `code`/`message`
  // (legacy frontend reads these). Do NOT echo the canonical model — the
  // client already knows which model it asked for; emitting it here only
  // creates one more token to scrape. Do NOT include any byte derived
  // from the upstream body — every field is a constant from our template
  // table, parametrised only by HTTP status.
  //
  // 2026-05-18: 给 transient 故障（5xx / 408 / 504 / network）注入一个短
  // `retry_after_seconds` 提示。SSE 客户端 / Web 前端的 applyBackendModelBlock
  // 会用它做 model lock 时长（默认 60s 短锁），CLI / SDK 也能据此设
  // Retry-After。其它 code（quota → 配额满到午夜，unavailable → key 死，
  // request_invalid → 客户端 bug）由调用方自决 retry 节奏，不在这里塞 hint
  // 以免变成"鼓励重打坏上游"。chat-gateway 的 PROXY_PAYLOAD_BLOCKED_KEYS
  // 不含 retry_after_seconds，所以会原样透传出去。
  const out: {
    error: { message: string; type: string; code: string; retry_after_seconds?: number };
    code: string;
    message: string;
    retry_after_seconds?: number;
  } = {
    error: { message, type: code, code },
    code,
    message,
  };
  if (code === "model_temporary_failure") {
    out.retry_after_seconds = 30;
    out.error.retry_after_seconds = 30;
  }
  return JSON.stringify(out);
}

// Cheap regex rewrite of `"model":"<anything>"` → `"model":"<canonical>"`.
// Used on raw upstream JSON/SSE text to avoid parse + re-serialize on multi-MB
// payloads (image b64, long completions). Safe because the JSON spec disallows
// raw `"` or newline inside string values without escaping, so the pattern
// only matches the field value and never crosses object boundaries.
const MODEL_FIELD_RE = /"model"\s*:\s*"(?:[^"\\]|\\.)*"/g;

function regexRewriteModel(text: string, canonicalModel: string): string {
  if (!canonicalModel || !text) return text;
  // JSON-escape the canonical id (handles the rare case it contains a quote
  // or backslash; in our routing table it never does, but be defensive).
  const escaped = canonicalModel.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return text.replace(MODEL_FIELD_RE, `"model":"${escaped}"`);
}

// SSE chunk schema enforcement.
//
// Background — relay frameworks (new-api / one-api / chshapi / freemodel.dev
// / xem8k5 / hhhl …) routinely smuggle upstream errors into the
// `choices[i].delta.content` field of a successful 200 SSE stream
// instead of emitting a top-level `"error":` frame. The browser would
// render raw text like
//   "[UPSTREAM_ERROR]_上游API返回状态码402,错误信息:{...visit https://...}"
// or "加群解锁更多额度 QQ群:xxxxx", which exposes that we resell.
//
// The legacy approach was a regex keyword list (`UPSTREAM_LEAK_RE`)
// matching upstream-only vocabulary. It was deleted on 2026-05-16 because:
//   1. it's an arms race — every new relay vocabulary escapes it;
//   2. false positives nuke legitimate model output (a user asking
//      "what is new_api_error" had their reply blocked);
//   3. it bleeds upstream wording into our own error-detection code.
//
// Replacement — **protocol schema enforcement**. Every `data:` frame must
// reshape into a strictly-typed OpenAI Chat Completion chunk via the
// field whitelists below. Frames carrying `error` at the top level, or
// anything that doesn't match the chunk schema (no `choices` array, etc),
// are replaced with our sanitized error frame and abort the stream.
// Whitelisted choice-level fields are reshaped — every upstream-only key
// (`provider`, `request_id`, `system_fingerprint_full`, `error_metadata`,
// `reasoning_details`, `native_finish_reason`, …) is dropped before the
// frame leaves this function. This is keyword-free.
const ALLOWED_CHUNK_KEYS: ReadonlySet<string> = new Set([
  "id", "object", "created", "model", "choices", "usage",
  "system_fingerprint", "service_tier",
]);
const ALLOWED_CHOICE_KEYS: ReadonlySet<string> = new Set([
  "index", "delta", "message", "finish_reason", "logprobs",
]);
const ALLOWED_DELTA_KEYS: ReadonlySet<string> = new Set([
  "role", "content", "reasoning_content", "tool_calls", "refusal", "function_call",
  // 2026-05-18：OpenAI Chat Completions audio response 字段（mimo-v2.5-tts 也按此契约）。
  // 形如 { audio: { id, data: "<base64 PCM>", transcript, expires_at } }；data 是
  // base64 编码的二进制 PCM，里面不含上游错误文本，加白名单不会引入泄漏面。
  "audio",
]);
const ALLOWED_MESSAGE_KEYS: ReadonlySet<string> = new Set([
  "role", "content", "reasoning_content", "tool_calls", "refusal", "function_call",
  "audio",
]);
const ALLOWED_USAGE_KEYS: ReadonlySet<string> = new Set([
  "prompt_tokens", "completion_tokens", "total_tokens",
  "prompt_tokens_details", "completion_tokens_details",
  "input_tokens", "output_tokens",
  "cache_read_input_tokens", "cache_creation_input_tokens",
]);

function pickAllowedKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (allowed.has(k)) out[k] = obj[k];
  }
  return out;
}

// Reshape a `chat.completion.chunk` payload to a fixed whitelist of
// fields, rewriting `model` to canonical. Returns `null` when the
// payload is not a recognizable chunk (top-level `error`, missing
// `choices` array, non-object), signalling the caller to abort the
// stream and emit a sanitized error frame.
function reshapeChatChunk(
  parsed: unknown,
  canonicalModel: string,
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  // Top-level `error` field → not a legitimate chunk.
  if (obj.error !== undefined && obj.error !== null) return null;
  const choices = obj.choices;
  // Schema contract: `choices` must be an array. Initial frames may
  // carry an empty array (e.g. only id/created), but the field must
  // exist — its presence is what defines the OpenAI Chat Completion
  // chunk shape.
  if (!Array.isArray(choices)) return null;
  const reshaped: Record<string, unknown> = {
    id: typeof obj.id === "string" ? obj.id : "",
    object: typeof obj.object === "string" ? obj.object : "chat.completion.chunk",
    created: typeof obj.created === "number" && Number.isFinite(obj.created)
      ? obj.created
      : Math.floor(Date.now() / 1000),
    model: canonicalModel,
    choices: choices.map((raw, idx) => {
      if (!raw || typeof raw !== "object") return { index: idx, delta: {} };
      const c = raw as Record<string, unknown>;
      const reshapedChoice: Record<string, unknown> = {
        index: typeof c.index === "number" ? c.index : idx,
      };
      if (c.delta && typeof c.delta === "object") {
        reshapedChoice.delta = pickAllowedKeys(
          c.delta as Record<string, unknown>,
          ALLOWED_DELTA_KEYS,
        );
      } else {
        reshapedChoice.delta = {};
      }
      if (c.message && typeof c.message === "object") {
        reshapedChoice.message = pickAllowedKeys(
          c.message as Record<string, unknown>,
          ALLOWED_MESSAGE_KEYS,
        );
      }
      if (c.finish_reason !== undefined && c.finish_reason !== null) {
        reshapedChoice.finish_reason = c.finish_reason;
      }
      if (c.logprobs !== undefined) reshapedChoice.logprobs = c.logprobs;
      return reshapedChoice;
    }),
  };
  if (obj.usage && typeof obj.usage === "object") {
    reshaped.usage = pickAllowedKeys(
      obj.usage as Record<string, unknown>,
      ALLOWED_USAGE_KEYS,
    );
  }
  if (typeof obj.system_fingerprint === "string") {
    reshaped.system_fingerprint = obj.system_fingerprint;
  }
  if (typeof obj.service_tier === "string") {
    reshaped.service_tier = obj.service_tier;
  }
  // Drop everything else — provider, request_id, native_finish_reason,
  // reasoning_details, error_metadata, etc.
  void ALLOWED_CHUNK_KEYS; // referenced via the explicit copies above
  void ALLOWED_CHOICE_KEYS;
  return reshaped;
}

// Non-stream `chat.completion` JSON sibling of `reshapeChatChunk`. Same
// schema-enforcement contract: parse, allow only whitelisted fields,
// rewrite `model` to canonical. Returns null on any non-conformant
// payload (top-level error, missing choices, non-object) so the caller
// can swap in a sanitized error frame. The only structural difference
// from chunks is that choices carry `message` instead of `delta`; we
// reuse `ALLOWED_MESSAGE_KEYS` (which includes the same set of fields
// plus role) for both paths.
function reshapeChatNonStreamJson(
  parsed: unknown,
  canonicalModel: string,
): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.error !== undefined && obj.error !== null) return null;
  const choices = obj.choices;
  if (!Array.isArray(choices)) return null;
  const reshaped: Record<string, unknown> = {
    id: typeof obj.id === "string" ? obj.id : "",
    object: typeof obj.object === "string" ? obj.object : "chat.completion",
    created: typeof obj.created === "number" && Number.isFinite(obj.created)
      ? obj.created
      : Math.floor(Date.now() / 1000),
    model: canonicalModel,
    choices: choices.map((raw, idx) => {
      if (!raw || typeof raw !== "object") {
        return {
          index: idx,
          message: { role: "assistant", content: "" },
        };
      }
      const c = raw as Record<string, unknown>;
      const reshapedChoice: Record<string, unknown> = {
        index: typeof c.index === "number" ? c.index : idx,
      };
      if (c.message && typeof c.message === "object") {
        reshapedChoice.message = pickAllowedKeys(
          c.message as Record<string, unknown>,
          ALLOWED_MESSAGE_KEYS,
        );
      } else {
        reshapedChoice.message = { role: "assistant", content: "" };
      }
      if (c.finish_reason !== undefined && c.finish_reason !== null) {
        reshapedChoice.finish_reason = c.finish_reason;
      }
      if (c.logprobs !== undefined) reshapedChoice.logprobs = c.logprobs;
      return reshapedChoice;
    }),
  };
  if (obj.usage && typeof obj.usage === "object") {
    reshaped.usage = pickAllowedKeys(
      obj.usage as Record<string, unknown>,
      ALLOWED_USAGE_KEYS,
    );
  }
  if (typeof obj.system_fingerprint === "string") {
    reshaped.system_fingerprint = obj.system_fingerprint;
  }
  if (typeof obj.service_tier === "string") {
    reshaped.service_tier = obj.service_tier;
  }
  return reshaped;
}

// Line-buffered SSE sanitizer.
//
// Behaviour per `data:` frame:
//   • payload empty / `[DONE]` / unparseable JSON pass straight through
//     (`[DONE]` and empty are protocol-level; unparseable is treated as
//     an upstream protocol violation → abort with sanitized frame).
//   • `reshapeChatChunk` returns null (top-level error, missing choices,
//     non-object) → emit sanitized error frame and abort the stream.
//   • Any other shape is reshaped to the chunk-field whitelist; upstream
//     keys outside the whitelist (provider / request_id / reasoning_details
//     / native_finish_reason / error_metadata / etc) are stripped silently.
// Non-`data:` lines (event:, id:, retry:, comments, blank lines) are
// always passed through. The buffering preserves SSE framing across
// arbitrary chunk boundaries.
function makeSseSanitizer(canonicalModel: string) {
  let buffer = "";
  let aborted = false;

  function transformFrame(rawLine: string): { out: string; abort: boolean } {
    // Preserve the line terminator the upstream used (usually \n, sometimes \r\n).
    const eolMatch = rawLine.match(/\r?\n$/);
    const eol = eolMatch ? eolMatch[0] : "";
    const trimmed = eol ? rawLine.slice(0, -eol.length) : rawLine;
    if (!trimmed.startsWith("data:"))
      return { out: rawLine, abort: false };
    const payload = trimmed.slice(5).trimStart();
    if (!payload || payload === "[DONE]")
      return { out: rawLine, abort: false };
    // Strict JSON parse. Anything else means upstream is smuggling raw
    // text into the SSE channel — abort with sanitized frame.
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return {
        out: `data: ${sanitizedErrorJson(502, "", canonicalModel)}${eol || "\n"}`,
        abort: true,
      };
    }
    const reshaped = reshapeChatChunk(parsed, canonicalModel);
    if (reshaped === null) {
      // Read upstream HTTP status from structured fields only — no text
      // search. `error.code` / `status_code` / `status` are the canonical
      // places upstreams put the numeric HTTP status; otherwise default
      // to 502 (transient).
      const obj =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : {};
      const errObj =
        obj.error && typeof obj.error === "object"
          ? (obj.error as Record<string, unknown>)
          : null;
      const status =
        Number((obj as { status_code?: unknown }).status_code) ||
        Number((obj as { status?: unknown }).status) ||
        Number(errObj?.code) ||
        502;
      return {
        out: `data: ${sanitizedErrorJson(status >= 400 ? status : 502, "", canonicalModel)}${eol || "\n"}`,
        abort: true,
      };
    }
    return {
      out: `data: ${JSON.stringify(reshaped)}${eol || "\n"}`,
      abort: false,
    };
  }

  function process(chunk: string): { out: string; abort: boolean } {
    if (aborted) return { out: "", abort: true };
    buffer += chunk;
    const outLines: string[] = [];
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) break;
      const rawLine = buffer.slice(0, idx + 1);
      buffer = buffer.slice(idx + 1);
      const transformed = transformFrame(rawLine);
      outLines.push(transformed.out);
      if (transformed.abort) {
        aborted = true;
        // Append a [DONE] sentinel so OpenAI-style clients exit cleanly.
        outLines.push("data: [DONE]\n\n");
        return { out: outLines.join(""), abort: true };
      }
    }
    return { out: outLines.join(""), abort: false };
  }

  function flush(): string {
    if (aborted) return "";
    const tail = buffer;
    buffer = "";
    if (!tail) return "";
    const transformed = transformFrame(tail);
    return transformed.out;
  }

  return { process, flush };
}

// ─── freemodel.dev (OpenAI Responses API) adapter ─────────────────────
//
// freemodel.dev only speaks the OpenAI Responses API (`/v1/responses`)
// and returns Responses-shaped objects (`output[]` / `response.*` SSE
// events) instead of Chat Completions. Translate both directions inside
// the proxy so the rest of the stack (frontend, chat-gateway, api-gateway)
// can keep using a single Chat Completions wire format.

function freemodelTextPartsForRole(
  role: string,
  content: unknown,
): Array<Record<string, unknown>> {
  // Map a single Chat Completions message.content payload (string OR
  // multimodal array) to a Responses API content-parts array. Image parts
  // get the Responses API `input_image` shape; text parts use
  // input_text/output_text depending on role.
  const textType = role === "assistant" ? "output_text" : "input_text";
  if (typeof content === "string") {
    return content ? [{ type: textType, text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as Record<string, unknown>;
    const ptype = String(part.type || "");
    if (ptype === "text" || ptype === "input_text" || ptype === "output_text") {
      out.push({ type: textType, text: String(part.text || "") });
    } else if (ptype === "image_url") {
      const url =
        typeof part.image_url === "object" && part.image_url
          ? String(
              (part.image_url as Record<string, unknown>).url || "",
            )
          : typeof part.image_url === "string"
            ? part.image_url
            : "";
      if (url) out.push({ type: "input_image", image_url: url });
    } else if (ptype === "input_image" && part.image_url) {
      out.push({ type: "input_image", image_url: part.image_url });
    }
  }
  return out;
}

// Translate Chat Completions `tools[]` (`{type:"function",function:{name,...}}`)
// to Responses API tools (`{type:"function",name,description,parameters}` —
// flat, no nested function wrapper).
function chatToFreemodelTools(
  rawTools: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(rawTools)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const raw of rawTools) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    if (String(t.type || "") !== "function") continue;
    const fn = (t.function || {}) as Record<string, unknown>;
    const name = String(fn.name || t.name || "");
    if (!name) continue;
    const item: Record<string, unknown> = { type: "function", name };
    const description = fn.description ?? t.description;
    if (typeof description === "string" && description) {
      item.description = description;
    }
    const parameters = fn.parameters ?? t.parameters;
    if (parameters && typeof parameters === "object") {
      item.parameters = parameters;
    }
    out.push(item);
  }
  return out;
}

// Translate Chat Completions `tool_choice` to Responses API form. Both
// accept "auto" | "none" | "required". The object form differs:
// Chat Completions: `{type:"function", function:{name}}`
// Responses API:    `{type:"function", name}`
function chatToFreemodelToolChoice(raw: unknown): unknown {
  if (raw === "auto" || raw === "none" || raw === "required") return raw;
  if (raw && typeof raw === "object") {
    const tc = raw as Record<string, unknown>;
    if (String(tc.type || "") === "function") {
      const fn = (tc.function || {}) as Record<string, unknown>;
      const name = String(fn.name || tc.name || "");
      if (name) return { type: "function", name };
    }
  }
  return undefined;
}

function chatToFreemodelRequest(
  body: Record<string, unknown>,
  canonicalModel: string,
): Record<string, unknown> {
  const messages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
    : [];
  let instructions = "";
  const input: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const role = String(msg.role || "user");
    if (role === "system" || role === "developer") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as Array<Record<string, unknown>>)
                .filter((p) => p && (p.type === "text" || p.type === "input_text"))
                .map((p) => String(p.text || ""))
                .join("\n")
            : "";
      if (text) instructions = instructions ? `${instructions}\n\n${text}` : text;
      continue;
    }
    // Tool result message → Responses API `function_call_output` top-level
    // input item (NOT nested under role). The Responses API requires the
    // matching `call_id` and a plain string `output`.
    if (role === "tool") {
      const callId = String(
        (msg.tool_call_id as string) ||
          (msg.call_id as string) ||
          "",
      );
      const out =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as Array<Record<string, unknown>>)
                .filter((p) => p && (p.type === "text" || p.type === "input_text"))
                .map((p) => String(p.text || ""))
                .join("")
            : msg.content === undefined || msg.content === null
              ? ""
              : JSON.stringify(msg.content);
      if (callId) {
        input.push({
          type: "function_call_output",
          call_id: callId,
          output: out,
        });
      }
      continue;
    }
    // Assistant message that triggered tool calls → emit each call as its
    // own `function_call` input item, then (optionally) the assistant's
    // text reply as a normal message item if any text was present.
    if (role === "assistant" && Array.isArray(msg.tool_calls)) {
      const toolCalls = msg.tool_calls as Array<Record<string, unknown>>;
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== "object") continue;
        const fn = (tc.function || {}) as Record<string, unknown>;
        const callId = String(tc.id || tc.call_id || "");
        const name = String(fn.name || tc.name || "");
        const args =
          typeof fn.arguments === "string"
            ? fn.arguments
            : fn.arguments === undefined
              ? ""
              : JSON.stringify(fn.arguments);
        if (!callId || !name) continue;
        input.push({
          type: "function_call",
          call_id: callId,
          name,
          arguments: args || "{}",
        });
      }
      const textParts = freemodelTextPartsForRole(role, msg.content);
      if (textParts.length > 0) {
        input.push({ role: "assistant", content: textParts });
      }
      continue;
    }
    const parts = freemodelTextPartsForRole(role, msg.content);
    if (parts.length === 0) continue;
    input.push({
      role: role === "function" ? "user" : role,
      content: parts,
    });
  }
  const out: Record<string, unknown> = {
    model: canonicalModel,
    input,
    stream: Boolean(body.stream),
  };
  if (instructions) out.instructions = instructions;
  if (typeof body.max_tokens === "number") {
    out.max_output_tokens = body.max_tokens;
  }
  if (typeof body.max_completion_tokens === "number") {
    out.max_output_tokens = body.max_completion_tokens;
  }
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number") out.top_p = body.top_p;
  // Tool calling — translate Chat Completions `tools` / `tool_choice` /
  // `parallel_tool_calls` to the Responses API equivalents. freemodel.dev
  // confirmed working 2026-05-10: returns `output[].type==="function_call"`
  // with `{call_id, name, arguments}` for both stream and non-stream.
  const tools = chatToFreemodelTools(body.tools);
  if (tools.length > 0) out.tools = tools;
  const toolChoice = chatToFreemodelToolChoice(body.tool_choice);
  if (toolChoice !== undefined) out.tool_choice = toolChoice;
  if (typeof body.parallel_tool_calls === "boolean") {
    out.parallel_tool_calls = body.parallel_tool_calls;
  }
  return out;
}

function chatContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Array<Record<string, unknown>>)
    .filter((part) => part && typeof part === "object")
    .filter((part) => {
      const type = String(part.type || "");
      return type === "text" || type === "input_text" || type === "output_text";
    })
    .map((part) => String(part.text || ""))
    .filter(Boolean)
    .join("\n");
}

function parseToolInput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function anthropicImageSourceFromUrl(url: string): Record<string, unknown> | null {
  if (!url) return null;
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (match) {
    return {
      type: "base64",
      media_type: match[1] || "image/png",
      data: match[2] || "",
    };
  }
  if (/^https?:\/\//i.test(url)) {
    return { type: "url", url };
  }
  return null;
}

function chatContentToAnthropicBlocks(
  content: unknown,
): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const part = raw as Record<string, unknown>;
    const type = String(part.type || "");
    if (type === "text" || type === "input_text" || type === "output_text") {
      const text = String(part.text || "");
      if (text) out.push({ type: "text", text });
    } else if (type === "image_url" || type === "input_image") {
      const imageUrl = part.image_url;
      const url = imageUrl && typeof imageUrl === "object"
        ? String((imageUrl as Record<string, unknown>).url || "")
        : typeof imageUrl === "string"
          ? imageUrl
          : "";
      const source = anthropicImageSourceFromUrl(url);
      if (source) out.push({ type: "image", source });
    } else if (type === "image" && part.source && typeof part.source === "object") {
      const source = part.source as Record<string, unknown>;
      const sourceType = String(source.type || "");
      if (sourceType === "base64" || sourceType === "url") {
        out.push({ type: "image", source });
      }
    }
  }
  return out;
}

function chatToolCallsToAnthropicBlocks(
  rawToolCalls: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(rawToolCalls)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const raw of rawToolCalls) {
    if (!raw || typeof raw !== "object") continue;
    const toolCall = raw as Record<string, unknown>;
    const fn = (toolCall.function || {}) as Record<string, unknown>;
    const id = String(toolCall.id || toolCall.call_id || "");
    const name = String(fn.name || toolCall.name || "");
    if (!id || !name) continue;
    out.push({
      type: "tool_use",
      id,
      name,
      input: parseToolInput(fn.arguments ?? toolCall.input),
    });
  }
  return out;
}

function chatToolResultContentToAnthropic(content: unknown): unknown {
  if (typeof content === "string") return content;
  const blocks = chatContentToAnthropicBlocks(content);
  if (blocks.length > 0) return blocks;
  if (content === undefined || content === null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function chatToAnthropicTools(rawTools: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rawTools)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const raw of rawTools) {
    if (!raw || typeof raw !== "object") continue;
    const tool = raw as Record<string, unknown>;
    const fn = (tool.function || {}) as Record<string, unknown>;
    const name = String(fn.name || tool.name || "");
    if (!name) continue;
    const item: Record<string, unknown> = {
      name,
      input_schema: fn.parameters || tool.input_schema || tool.parameters || {
        type: "object",
        properties: {},
      },
    };
    const description = fn.description || tool.description;
    if (typeof description === "string" && description) {
      item.description = description;
    }
    out.push(item);
  }
  return out;
}

function chatToAnthropicToolChoice(raw: unknown): unknown {
  if (raw === "auto") return { type: "auto" };
  if (raw === "none") return { type: "none" };
  if (raw === "required") return { type: "any" };
  if (!raw || typeof raw !== "object") return undefined;
  const choice = raw as Record<string, unknown>;
  const type = String(choice.type || "");
  if (type === "auto" || type === "none" || type === "any") {
    return { type };
  }
  if (type === "required") return { type: "any" };
  const fn = (choice.function || {}) as Record<string, unknown>;
  const name = String(choice.name || fn.name || "");
  if ((type === "tool" || type === "function") && name) {
    return { type: "tool", name };
  }
  return undefined;
}

function chatToAnthropicRequest(
  body: Record<string, unknown>,
  canonicalModel: string,
): Record<string, unknown> {
  const rawMessages = Array.isArray(body.messages)
    ? (body.messages as Array<Record<string, unknown>>)
    : [];
  const systemParts: string[] = [];
  const messages: Array<Record<string, unknown>> = [];

  for (const raw of rawMessages) {
    if (!raw || typeof raw !== "object") continue;
    const role = String(raw.role || "user").toLowerCase();
    if (role === "system" || role === "developer") {
      const text = chatContentText(raw.content);
      if (text) systemParts.push(text);
      continue;
    }
    if (role === "tool") {
      const toolUseId = String(raw.tool_call_id || raw.tool_use_id || raw.id || "");
      if (!toolUseId) continue;
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolUseId,
          content: chatToolResultContentToAnthropic(raw.content),
        }],
      });
      continue;
    }
    if (role === "assistant") {
      const contentBlocks = chatContentToAnthropicBlocks(raw.content);
      const toolBlocks = chatToolCallsToAnthropicBlocks(raw.tool_calls);
      if (toolBlocks.length > 0) {
        messages.push({
          role: "assistant",
          content: [...contentBlocks, ...toolBlocks],
        });
      } else if (typeof raw.content === "string") {
        messages.push({ role: "assistant", content: raw.content });
      } else if (contentBlocks.length > 0) {
        messages.push({ role: "assistant", content: contentBlocks });
      }
      continue;
    }

    const contentBlocks = chatContentToAnthropicBlocks(raw.content);
    if (typeof raw.content === "string") {
      messages.push({ role: "user", content: raw.content });
    } else if (contentBlocks.length > 0) {
      messages.push({ role: "user", content: contentBlocks });
    }
  }

  const maxTokens = Number(
    body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? 4096,
  );
  const out: Record<string, unknown> = {
    model: canonicalModel,
    messages,
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0
      ? Math.floor(maxTokens)
      : 4096,
    stream: Boolean(body.stream),
  };
  if (systemParts.length > 0) out.system = systemParts.join("\n\n");
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (typeof body.top_p === "number") out.top_p = body.top_p;
  if (typeof body.stop === "string") out.stop_sequences = [body.stop];
  if (Array.isArray(body.stop)) out.stop_sequences = body.stop;
  const tools = chatToAnthropicTools(body.tools);
  if (tools.length > 0) out.tools = tools;
  const toolChoice = chatToAnthropicToolChoice(body.tool_choice);
  if (toolChoice !== undefined) out.tool_choice = toolChoice;
  return out;
}

type FreemodelToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function extractFreemodelOutput(output: unknown): {
  content: string;
  reasoning: string;
  toolCalls: FreemodelToolCall[];
} {
  let content = "";
  let reasoning = "";
  const toolCalls: FreemodelToolCall[] = [];
  if (!Array.isArray(output)) return { content, reasoning, toolCalls };
  for (const raw of output) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const itype = String(item.type || "");
    if (itype === "message") {
      const parts = Array.isArray(item.content)
        ? (item.content as Array<Record<string, unknown>>)
        : [];
      for (const p of parts) {
        if (!p || typeof p !== "object") continue;
        const ptype = String(p.type || "");
        if (ptype === "output_text" || ptype === "text") {
          content += String(p.text || "");
        }
      }
    } else if (itype === "reasoning") {
      const summary = Array.isArray(item.summary)
        ? (item.summary as Array<Record<string, unknown>>)
        : [];
      for (const s of summary) {
        if (s && typeof s === "object" && s.text) {
          reasoning += String(s.text);
        }
      }
      const parts = Array.isArray(item.content)
        ? (item.content as Array<Record<string, unknown>>)
        : [];
      for (const p of parts) {
        if (p && typeof p === "object" && p.text) {
          reasoning += String(p.text);
        }
      }
    } else if (itype === "function_call") {
      // Responses API returns `{id:"fc_*", call_id:"call_*", name, arguments}`.
      // Translate to Chat Completions `tool_calls[]` shape. We expose
      // `call_id` (NOT `id`) downstream because that's what the client
      // must echo back via `{role:"tool", tool_call_id:"call_*"}` and
      // what the Responses API matches on for follow-up requests.
      const callId = String(item.call_id || item.id || "");
      const name = String(item.name || "");
      const args =
        typeof item.arguments === "string"
          ? item.arguments
          : item.arguments === undefined || item.arguments === null
            ? ""
            : JSON.stringify(item.arguments);
      if (callId && name) {
        toolCalls.push({
          id: callId,
          type: "function",
          function: { name, arguments: args || "{}" },
        });
      }
    }
  }
  return { content, reasoning, toolCalls };
}

function freemodelResponseToChat(
  rawText: string,
  canonicalModel: string,
): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return sanitizedErrorJson(502, rawText, canonicalModel);
  }
  const created =
    Number((parsed as { created_at?: unknown }).created_at) ||
    Math.floor(Date.now() / 1000);
  const status = String((parsed as { status?: unknown }).status || "completed");
  const incompleteDetails = (parsed as { incomplete_details?: unknown })
    .incomplete_details;
  const { content, reasoning, toolCalls } = extractFreemodelOutput(
    (parsed as { output?: unknown }).output,
  );
  let finishReason: string;
  if (
    status === "incomplete" ||
    (incompleteDetails &&
      typeof incompleteDetails === "object" &&
      String(
        (incompleteDetails as Record<string, unknown>).reason || "",
      ) === "max_output_tokens")
  ) {
    finishReason = "length";
  } else if (toolCalls.length > 0) {
    finishReason = "tool_calls";
  } else {
    finishReason = "stop";
  }
  const usage = (parsed as { usage?: Record<string, number> }).usage || {};
  const message: Record<string, unknown> = {
    role: "assistant",
    // OpenAI clients tolerate `null` content when tool_calls is set; emit
    // `null` instead of "" so downstream JSON schema validators pass.
    content: toolCalls.length > 0 && !content ? null : content,
  };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return JSON.stringify({
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created,
    model: canonicalModel,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: Number(usage.input_tokens) || 0,
      completion_tokens: Number(usage.output_tokens) || 0,
      total_tokens: Number(usage.total_tokens) || 0,
    },
  });
}

// 2026-05-18 计费修复：Anthropic Messages 上游返回的 input_tokens **不含**
// cache_read_input_tokens / cache_creation_input_tokens（与 OpenAI 的
// prompt_tokens 已含 cached 不同）。以前这里只取 input_tokens 赋给
// prompt_tokens，cache 字段被丢失，导致 chat-gateway 计费公式
//   effective = (in - cached)*1 + cached*0.1 + out
// 在 Anthropic 上少计 ~30%（用户受益、平台失衡）。修正：合并
// input + cache_read + cache_creation 进 prompt_tokens，同时通过
// prompt_tokens_details.cached_tokens 报告 cached 部分，下游
// chat-gateway extractUsageTokens 自然读到。
function anthropicResponseToChat(
  rawText: string,
  canonicalModel: string,
): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return sanitizedErrorJson(502, rawText, canonicalModel);
  }
  const created = Math.floor(Date.now() / 1000);
  const stopReason = String((parsed as { stop_reason?: unknown }).stop_reason || "");
  const contentArr = Array.isArray((parsed as { content?: unknown }).content)
    ? ((parsed as { content: Array<Record<string, unknown>> }).content)
    : [];
  let text = "";
  const toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> = [];
  for (const block of contentArr) {
    if (!block || typeof block !== "object") continue;
    const btype = String(block.type || "");
    if (btype === "text") text += String(block.text || "");
    else if (btype === "tool_use") {
      toolCalls.push({
        id: String(block.id || ""),
        type: "function",
        function: {
          name: String(block.name || ""),
          arguments: JSON.stringify(block.input ?? {}),
        },
      });
    }
  }
  const finishReason =
    stopReason === "tool_use"
      ? "tool_calls"
      : stopReason === "max_tokens"
        ? "length"
        : "stop";
  const usage = (parsed as { usage?: Record<string, number> }).usage || {};
  const inTokens = Number(usage.input_tokens) || 0;
  const cacheRead = Number(usage.cache_read_input_tokens) || 0;
  const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;
  const promptTokens = inTokens + cacheRead + cacheCreation;
  const completionTokens = Number(usage.output_tokens) || 0;
  const message: Record<string, unknown> = {
    role: "assistant",
    content: toolCalls.length > 0 && !text ? null : text,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return JSON.stringify({
    id: `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created,
    model: canonicalModel,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: Number(usage.total_tokens) || (promptTokens + completionTokens),
      prompt_tokens_details: { cached_tokens: cacheRead },
    },
  });
}

// SSE adapter for Anthropic Messages → OpenAI Chat completion.chunk.
// Anthropic streams events like `message_start / content_block_start /
// content_block_delta / content_block_stop / message_delta / message_stop`,
// each with their own `data:` JSON. We translate to chat.completion.chunk
// stream that the client (and rest of our code) already understands.
function makeAnthropicSseToChatTransform(canonicalModel: string) {
  const sanitizedId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let aborted = false;
  let roleSent = false;
  let finalEmitted = false;
  // index map: anthropic content_block index -> our tool_call index.
  const toolIndexMap = new Map<number, number>();
  let nextToolIndex = 0;
  // Tool-call assembly state per anthropic block index.
  const toolState = new Map<number, { id: string; name: string }>();

  function emit(
    delta: Record<string, unknown>,
    finish: string | null = null,
  ): string {
    const chunk = {
      id: sanitizedId,
      object: "chat.completion.chunk",
      created,
      model: canonicalModel,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  function processBlock(block: string): { out: string; abort: boolean } {
    let dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return { out: "", abort: false };
    const payload = dataLines.join("");
    if (!payload) return { out: "", abort: false };
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload);
    } catch {
      return { out: "", abort: false };
    }
    const etype = String(evt.type || "");
    let chunks = "";
    if (etype === "message_start") {
      if (!roleSent) {
        chunks += emit({ role: "assistant", content: "" });
        roleSent = true;
      }
    } else if (etype === "content_block_start") {
      const idx = Number(evt.index);
      const cb = (evt.content_block || {}) as Record<string, unknown>;
      const cbtype = String(cb.type || "");
      if (cbtype === "tool_use") {
        const ourIdx = nextToolIndex++;
        toolIndexMap.set(idx, ourIdx);
        toolState.set(idx, {
          id: String(cb.id || ""),
          name: String(cb.name || ""),
        });
        chunks += emit({
          tool_calls: [
            {
              index: ourIdx,
              id: String(cb.id || ""),
              type: "function",
              function: { name: String(cb.name || ""), arguments: "" },
            },
          ],
        });
      }
    } else if (etype === "content_block_delta") {
      const idx = Number(evt.index);
      const d = (evt.delta || {}) as Record<string, unknown>;
      const dtype = String(d.type || "");
      if (dtype === "text_delta") {
        chunks += emit({ content: String(d.text || "") });
      } else if (dtype === "input_json_delta") {
        const ourIdx = toolIndexMap.get(idx);
        if (ourIdx !== undefined) {
          chunks += emit({
            tool_calls: [
              {
                index: ourIdx,
                function: { arguments: String(d.partial_json || "") },
              },
            ],
          });
        }
      } else if (dtype === "thinking_delta") {
        // Anthropic extended-thinking. Surface as reasoning_content delta —
        // our cancri_chat.js already routes that into the collapsible
        // reasoning panel.
        chunks += emit({ reasoning_content: String(d.thinking || "") });
      }
    } else if (etype === "content_block_stop") {
      // No-op for our chunk stream.
    } else if (etype === "message_delta") {
      const d = (evt.delta || {}) as Record<string, unknown>;
      const stopReason = String(d.stop_reason || "");
      const finish =
        stopReason === "tool_use"
          ? "tool_calls"
          : stopReason === "max_tokens"
            ? "length"
            : stopReason
              ? "stop"
              : null;
      if (finish && !finalEmitted) {
        chunks += emit({}, finish);
        finalEmitted = true;
      }
    } else if (etype === "message_stop") {
      if (!finalEmitted) {
        chunks += emit({}, "stop");
        finalEmitted = true;
      }
      chunks += "data: [DONE]\n\n";
    } else if (etype === "error") {
      // Anthropic returned an error during stream — abort and let upstream
      // error sanitization handle the surface.
      return { out: "", abort: true };
    }
    return { out: chunks, abort: false };
  }

  return {
    process(text: string): { out: string; abort: boolean } {
      if (aborted) return { out: "", abort: true };
      buffer += text;
      let result = "";
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const { out, abort } = processBlock(block);
        if (abort) {
          aborted = true;
          return { out: result, abort: true };
        }
        result += out;
      }
      return { out: result, abort: false };
    },
    flush(): string {
      if (aborted) return "";
      if (buffer.trim()) {
        const { out } = processBlock(buffer);
        buffer = "";
        if (!finalEmitted) {
          return out + emit({}, "stop") + "data: [DONE]\n\n";
        }
        return out;
      }
      if (!finalEmitted) {
        return emit({}, "stop") + "data: [DONE]\n\n";
      }
      return "";
    },
  };
}

// SSE adapter with the same `{ process, flush }` shape that
// makeSseSanitizer returns. Translates Responses API events
// (response.created / response.output_text.delta / response.output_item.* /
// response.function_call_arguments.* / response.completed / response.failed
// / …) into Chat Completions chunks. The output stream uses a single
// synthetic chatcmpl-* id across all chunks.
function makeFreemodelSseToChatTransform(canonicalModel: string) {
  const sanitizedId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = "";
  let aborted = false;
  let roleSent = false;
  let finalEmitted = false;
  // Map upstream `output_index` (per Responses API) → our Chat Completions
  // tool_call array index. Multiple parallel tool calls may arrive
  // interleaved; we assign them sequential indexes in arrival order.
  const toolIndexMap = new Map<number, number>();
  let nextToolIndex = 0;
  let toolCallEmitted = false;

  function emit(
    delta: Record<string, unknown>,
    opts?: { finish?: string | null; usage?: Record<string, number> },
  ): string {
    const finish = opts?.finish ?? null;
    const obj: Record<string, unknown> = {
      id: sanitizedId,
      object: "chat.completion.chunk",
      created,
      model: canonicalModel,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    if (opts?.usage) obj.usage = opts.usage;
    return `data: ${JSON.stringify(obj)}\n\n`;
  }

  function processBlock(block: string): { out: string; abort: boolean } {
    const dataParts: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) dataParts.push(line.slice(5).trimStart());
    }
    if (dataParts.length === 0) return { out: "", abort: false };
    const payload = dataParts.join("");
    if (!payload) return { out: "", abort: false };
    if (payload === "[DONE]") {
      // Some upstreams send their own [DONE]; we emit our own at completion.
      return { out: "", abort: false };
    }
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(payload);
    } catch {
      return { out: "", abort: false };
    }
    const type = String(parsed.type || "");
    if (type === "response.output_text.delta") {
      const delta = String(parsed.delta || "");
      let out = "";
      if (!roleSent) {
        out += emit({ role: "assistant", content: "" });
        roleSent = true;
      }
      if (delta) out += emit({ content: delta });
      return { out, abort: false };
    }
    // Tool call lifecycle — Responses API streams function calls as
    // `response.output_item.added` (with item.type==="function_call"),
    // followed by N `response.function_call_arguments.delta` events,
    // then `response.function_call_arguments.done` and
    // `response.output_item.done`. We translate added→initial chunk
    // with id+name, deltas→argument deltas, ignore done events (the
    // arguments are already streamed verbatim).
    if (type === "response.output_item.added") {
      const item = (parsed.item || {}) as Record<string, unknown>;
      const itype = String(item.type || "");
      if (itype !== "function_call") {
        // reasoning / message items: ignore the "added" event; we only
        // care about their deltas, which arrive via separate event types
        // (response.output_text.delta, response.reasoning_summary.delta,
        // …). Passing through `added` with role-only would emit an
        // unnecessary empty chunk.
        return { out: "", abort: false };
      }
      const outputIndex = Number(parsed.output_index);
      if (!Number.isFinite(outputIndex)) return { out: "", abort: false };
      const callId = String(item.call_id || item.id || "");
      const name = String(item.name || "");
      if (!callId || !name) return { out: "", abort: false };
      const idx = nextToolIndex++;
      toolIndexMap.set(outputIndex, idx);
      let out = "";
      // First chunk of the response should still announce the assistant
      // role — even if there's no text content, OpenAI clients use the
      // role chunk as the start-of-message marker.
      if (!roleSent) {
        out += emit({ role: "assistant", content: null });
        roleSent = true;
      }
      out += emit({
        tool_calls: [
          {
            index: idx,
            id: callId,
            type: "function",
            function: { name, arguments: "" },
          },
        ],
      });
      toolCallEmitted = true;
      return { out, abort: false };
    }
    if (type === "response.function_call_arguments.delta") {
      const outputIndex = Number(parsed.output_index);
      const idx = toolIndexMap.get(outputIndex);
      if (idx === undefined) return { out: "", abort: false };
      const delta = String(parsed.delta || "");
      if (!delta) return { out: "", abort: false };
      return {
        out: emit({
          tool_calls: [
            { index: idx, function: { arguments: delta } },
          ],
        }),
        abort: false,
      };
    }
    // We intentionally drop response.function_call_arguments.done and
    // response.output_item.done — they carry the same arguments we
    // already streamed delta-by-delta and translating them would emit
    // duplicate content.
    if (type === "response.completed") {
      const resp = (parsed.response || {}) as Record<string, unknown>;
      const status = String(resp.status || "completed");
      const incomplete = resp.incomplete_details as
        | Record<string, unknown>
        | undefined;
      let finishReason: string;
      if (
        status === "incomplete" ||
        (incomplete && String(incomplete.reason || "") === "max_output_tokens")
      ) {
        finishReason = "length";
      } else if (toolCallEmitted) {
        finishReason = "tool_calls";
      } else {
        finishReason = "stop";
      }
      const u = (resp.usage || {}) as Record<string, number>;
      const usage = {
        prompt_tokens: Number(u.input_tokens) || 0,
        completion_tokens: Number(u.output_tokens) || 0,
        total_tokens: Number(u.total_tokens) || 0,
      };
      let out = "";
      if (!roleSent) {
        // No deltas were emitted (rare — non-stream-style response); flush
        // the full content/tool_calls from response.output as one batch.
        const { content, toolCalls } = extractFreemodelOutput(resp.output);
        out += emit({
          role: "assistant",
          content: toolCalls.length > 0 && !content ? null : content,
        });
        roleSent = true;
        if (toolCalls.length > 0) {
          out += emit({
            tool_calls: toolCalls.map((tc, i) => ({
              index: i,
              id: tc.id,
              type: tc.type,
              function: tc.function,
            })),
          });
          toolCallEmitted = true;
          if (finishReason === "stop") finishReason = "tool_calls";
        }
      }
      out += emit({}, { finish: finishReason, usage });
      out += "data: [DONE]\n\n";
      finalEmitted = true;
      return { out, abort: false };
    }
    if (
      type === "response.failed" ||
      type === "response.error" ||
      type === "error"
    ) {
      const respObj = (parsed.response || parsed) as Record<string, unknown>;
      const errObj = (respObj.error || parsed.error) as
        | Record<string, unknown>
        | undefined;
      const msg = String(errObj?.message || "upstream error");
      const status = Number(errObj?.code) || 502;
      const errFrame = sanitizedErrorJson(
        status >= 400 ? status : 502,
        msg,
        canonicalModel,
      );
      return {
        out: `data: ${errFrame}\n\ndata: [DONE]\n\n`,
        abort: true,
      };
    }
    // Other event types (response.created, response.in_progress,
    // response.content_part.*, response.function_call_arguments.done,
    // response.output_item.done, etc.) are intentionally dropped —
    // Chat Completions has no equivalent and passing them through
    // would leak Responses-API shape.
    return { out: "", abort: false };
  }

  function process(chunk: string): { out: string; abort: boolean } {
    if (aborted) return { out: "", abort: true };
    buffer += chunk;
    let outAll = "";
    let bIdx = buffer.indexOf("\n\n");
    while (bIdx !== -1) {
      const block = buffer.slice(0, bIdx);
      buffer = buffer.slice(bIdx + 2);
      const res = processBlock(block);
      outAll += res.out;
      if (res.abort) {
        aborted = true;
        return { out: outAll, abort: true };
      }
      bIdx = buffer.indexOf("\n\n");
    }
    return { out: outAll, abort: false };
  }

  function flush(): string {
    if (aborted) return "";
    let out = "";
    const tail = buffer;
    buffer = "";
    if (tail) {
      const res = processBlock(tail);
      out += res.out;
    }
    if (!finalEmitted) {
      // Upstream stream ended without a response.completed event. Emit a
      // best-effort terminator so OpenAI-style clients exit cleanly.
      if (!roleSent) out += emit({ role: "assistant", content: "" });
      out += emit({}, { finish: "stop" });
      out += "data: [DONE]\n\n";
      finalEmitted = true;
    }
    return out;
  }

  return { process, flush };
}

function normalizeArenaModeForLog(mode: unknown): string {
  const clean = cleanHeader(String(mode || ""));
  return clean === "anonymous" ? "blind_arena" : clean;
}

function buildUsageLogMeta(params: {
  endpointName: string;
  activeTurnId: string;
  requestKind: string;
  arenaMode?: unknown;
  arenaSlot?: unknown;
  arenaMatchId?: unknown;
  toolName?: unknown;
  toolIndex?: number;
  provider?: string;
  billable?: boolean;
}): Record<string, unknown> {
  const isModelCall =
    params.endpointName === "chat" ||
    params.endpointName === "image" ||
    params.endpointName === "video";
  const isToolCall =
    params.endpointName === "web_search" || params.requestKind === "tool_call";
  const usageClass = isToolCall
    ? "tool_call"
    : isModelCall
      ? "model_call"
      : "provider_retry";
  const turnId = params.activeTurnId
    ? maskIdentifier(params.activeTurnId)
    : "none";
  return {
    usage_class: usageClass,
    billable_model_call: params.billable ?? false,
    parent_turn_id: turnId,
    client_turn_id: turnId,
    request_kind: params.requestKind,
    arena_mode: normalizeArenaModeForLog(params.arenaMode),
    arena_match_id: cleanHeader(String(params.arenaMatchId || "")),
    arena_slot: cleanHeader(String(params.arenaSlot || "")),
    tool_name: cleanHeader(String(params.toolName || "")),
    tool_index: Number(params.toolIndex || 0),
    provider: cleanHeader(String(params.provider || "")),
  };
}

function startedEventName(endpointName: string, requestKind: string): string {
  if (endpointName === "web_search" || requestKind === "tool_call")
    return "tool_call_started";
  if (
    endpointName === "chat" ||
    endpointName === "image" ||
    endpointName === "video"
  )
    return "model_call_started";
  return "provider_attempt";
}

function jsonResponse(
  payload: Record<string, unknown>,
  status: number,
  ch: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...ch, ...extraHeaders, "Content-Type": "application/json" },
  });
}

function rejectDisallowedOrigin(
  req: Request,
  ch: Record<string, string>,
): Response | null {
  if (getAllowedOrigin(req)) return null;
  return jsonResponse(
    { error: "Origin not allowed", code: "origin_not_allowed" },
    403,
    ch,
  );
}

function getEndpointLimit(endpoint: string): number {
  if (endpoint === "ping") return 120;
  if (endpoint === "web_search") return 12;
  if (endpoint === "image" || endpoint === "task") return 24;
  return RATE_LIMIT_MAX;
}

function inspectAbuseScope(
  key: string,
  max: number,
  options: { ignoreSpeed?: boolean } = {},
):
  | { ok: true }
  | {
      ok: false;
      action: "challenge" | "block";
      reason: string;
      retryAfter: number;
    } {
  const now = Date.now();
  const entry = abuseMap.get(key) || {
    count: 0,
    resetAt: now + RATE_LIMIT_WINDOW_MS,
    lastAt: 0,
    rapidHits: 0,
    challengeUntil: 0,
    blockedUntil: 0,
  };
  if (entry.blockedUntil > now) {
    return {
      ok: false,
      action: "block",
      reason: "blocked",
      retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
    };
  }

  if (!entry || now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    entry.rapidHits = Math.max(0, entry.rapidHits - 1);
  }

  const interval = entry.lastAt ? now - entry.lastAt : Number.POSITIVE_INFINITY;
  if (interval < RAPID_REQUEST_MS) {
    entry.rapidHits += 1;
  } else {
    entry.rapidHits = Math.max(0, entry.rapidHits - 1);
  }
  entry.count += 1;
  entry.lastAt = now;
  abuseMap.set(key, entry);
  trimMapIfNeeded(abuseMap);

  const limitHit = entry.count > max;
  const speedHit = !options.ignoreSpeed && entry.rapidHits >= 4;
  if (entry.challengeUntil > now) {
    if (
      limitHit ||
      speedHit ||
      (!options.ignoreSpeed && interval < RAPID_REQUEST_MS)
    ) {
      entry.blockedUntil = now + BLOCK_DURATION_MS;
      abuseMap.set(key, entry);
      return {
        ok: false,
        action: "block",
        reason: limitHit ? "challenge_limit_repeat" : "challenge_speed_repeat",
        retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000),
      };
    }
    return {
      ok: false,
      action: "challenge",
      reason: "challenge_required",
      retryAfter: Math.ceil((entry.challengeUntil - now) / 1000),
    };
  }

  if (limitHit || speedHit) {
    entry.challengeUntil = now + CHALLENGE_DURATION_MS;
    abuseMap.set(key, entry);
    return {
      ok: false,
      action: "challenge",
      reason: limitHit ? "rate_limit" : "rapid_requests",
      retryAfter: Math.ceil(CHALLENGE_DURATION_MS / 1000),
    };
  }

  return { ok: true };
}

function checkBanned(
  ctx: RequestContext,
  ch: Record<string, string>,
  userId = "",
): Response | null {
  if (isIpBlocked(ctx.ip)) {
    logSecurityEvent("banned_ip", ctx, {});
    return jsonResponse(
      {
        error: "access_blocked",
        code: "access_blocked",
        message: "访问被拒绝",
      },
      403,
      ch,
    );
  }
  if (isUserBlocked(userId)) {
    logSecurityEvent("banned_user", ctx, {});
    return jsonResponse(
      {
        error: "access_blocked",
        code: "access_blocked",
        message: "访问被拒绝",
      },
      403,
      ch,
    );
  }
  if (
    BLOCKED_IP_HASHES.has(ctx.ip_hash) ||
    BLOCKED_DEVICE_HASHES.has(ctx.device_hash) ||
    BLOCKED_USER_HASHES.has(ctx.user_hash)
  ) {
    logSecurityEvent("banned_hash", ctx, {});
    return jsonResponse(
      {
        error: "access_blocked",
        code: "access_blocked",
        message: "访问被拒绝",
      },
      403,
      ch,
    );
  }
  return null;
}

function enforceAbuseGuard(
  ctx: RequestContext,
  ch: Record<string, string>,
  options: { ignoreSpeed?: boolean } = {},
): Response | null {
  const max = getEndpointLimit(ctx.endpoint);
  const scopes = [
    `ip:${ctx.endpoint}:${ctx.ip}`,
    `device:${ctx.endpoint}:${ctx.device}`,
    `user:${ctx.endpoint}:${ctx.user}`,
  ];

  for (const scope of scopes) {
    const result = inspectAbuseScope(scope, max, options);
    if (result.ok) continue;
    logSecurityEvent("security_guard", ctx, {
      action: result.action,
      reason: result.reason,
      retryAfter: result.retryAfter,
    });
    if (result.action === "block") {
      // Persist block to database so it survives cold starts
      if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
        try {
          const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
          supabase
            .rpc("cancri_consume_abuse_token", {
              p_scope: `proxy:block:${scope}`,
              p_limit: 0,
              p_window_seconds: 3600,
              p_block_seconds: 3600,
            })
            .then(() => {})
            .catch(() => {});
        } catch {
          /* non-blocking */
        }
      }
      return jsonResponse(
        {
          error: "access_blocked",
          code: "access_blocked",
          message: "检测到异常高频请求，已暂时停止为此 IP 提供服务。",
          retry_after_seconds: result.retryAfter,
        },
        403,
        ch,
        { "Retry-After": String(result.retryAfter) },
      );
    }
    return jsonResponse(
      {
        error: "challenge_required",
        code: "challenge_required",
        message:
          "检测到异常发送速度。出于公平使用，本次请求需要安全验证或稍后重试。",
        retry_after_seconds: result.retryAfter,
      },
      403,
      ch,
      { "Retry-After": String(result.retryAfter) },
    );
  }

  return null;
}

function enforceTurnAwareAbuseGuard(
  ctx: RequestContext,
  ch: Record<string, string>,
  turnId: string,
  requestKind: string,
  options: { ignoreSpeed?: boolean } = {},
): Response | null {
  const cleanTurnId = cleanHeader(turnId).slice(0, 96);
  if (ctx.endpoint !== "chat" || !cleanTurnId) {
    return enforceAbuseGuard(ctx, ch, options);
  }

  const now = Date.now();
  const key = `turn:${ctx.user}:${ctx.device}:${ctx.model}:${cleanTurnId}`;
  const entry = turnUsageMap.get(key) || {
    count: 0,
    resetAt: now + TURN_USAGE_TTL_MS,
    counted: false,
    blockedUntil: 0,
  };
  if (entry.resetAt <= now) {
    entry.count = 0;
    entry.resetAt = now + TURN_USAGE_TTL_MS;
    entry.counted = false;
    entry.blockedUntil = 0;
  }
  if (entry.blockedUntil > now) {
    return jsonResponse(
      {
        error: "challenge_required",
        code: "challenge_required",
        message:
          "这个对话回合触发了异常多次模型调用，已临时停止以防止脚本消耗额度。",
        retry_after_seconds: Math.ceil((entry.blockedUntil - now) / 1000),
      },
      403,
      ch,
      { "Retry-After": String(Math.ceil((entry.blockedUntil - now) / 1000)) },
    );
  }

  entry.count += 1;
  const turnLimit = getTurnCallLimit(requestKind);
  if (entry.count > turnLimit) {
    entry.blockedUntil = now + CHALLENGE_DURATION_MS;
    turnUsageMap.set(key, entry);
    logSecurityEvent("security_guard", ctx, {
      action: "challenge",
      reason: "turn_call_limit",
      turnId: maskIdentifier(cleanTurnId),
      requestKind,
      count: entry.count,
      limit: turnLimit,
      retryAfter: Math.ceil(CHALLENGE_DURATION_MS / 1000),
    });
    return jsonResponse(
      {
        error: "challenge_required",
        code: "challenge_required",
        message: "这个对话回合的工具链调用次数异常偏高，请重新发起一轮对话。",
        retry_after_seconds: Math.ceil(CHALLENGE_DURATION_MS / 1000),
      },
      403,
      ch,
      { "Retry-After": String(Math.ceil(CHALLENGE_DURATION_MS / 1000)) },
    );
  }

  turnUsageMap.set(key, entry);
  trimMapIfNeeded(turnUsageMap);
  if (entry.counted) return null;

  const abuseResponse = enforceAbuseGuard(ctx, ch, {
    ...options,
    ignoreSpeed: true,
  });
  if (!abuseResponse) {
    entry.counted = true;
    turnUsageMap.set(key, entry);
  }
  return abuseResponse;
}

function rejectOversizedRequest(
  req: Request,
  ch: Record<string, string>,
  ctx: RequestContext,
): Response | null {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    logSecurityEvent("security_guard", ctx, {
      action: "reject",
      reason: "payload_too_large",
      contentLength,
    });
    return jsonResponse({ error: "Payload too large" }, 413, ch);
  }
  return null;
}

function getModelBlock(model: string): { retryAfter: number } | null {
  const entry = modelAvailabilityMap.get(model);
  const now = Date.now();
  if (!entry || entry.blockedUntil <= now) return null;
  return { retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
}

// ─── SRE / line-health decisions only — NOT user-visible error mapping ──
//
// The two functions below (`isTemporaryUnavailableText` and
// `shouldAutoDisableLine`) inspect upstream body text to decide whether
// a model line should be soft-blocked in memory (1h) or hard-disabled
// in `model_line_disabled` (24h, admin re-enable required). Their inputs
// (status + upstream text) drive **internal availability state only**;
// they NEVER reach the client. The client always sees the sanitized
// status-only error from `sanitizedErrorJson` / template tables.
//
// The keyword matching here is acceptable precisely because it stays
// inside the SRE control plane: false positives only delay how fast
// a line auto-recovers, and false negatives only mean an extra retry
// on a dead line — neither leaks upstream wording to users.
function isTemporaryUnavailableText(status: number, text: string): boolean {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return false;
  const lower = value.toLowerCase();
  const apiIncompatible = lower.includes(
    "does not support the chat_completions api",
  );
  const modelMissing = lower.includes(
    "does not exist or you do not have access",
  );
  const invalidToken = lower.includes("invalid token");
  const exhausted = /free tier[\s\S]{0,80}exhausted/i.test(value);
  const chineseQuota =
    value.includes("用户额度不足") || value.includes("模型额度已超");

  if (status === 400) return apiIncompatible || modelMissing;
  if (status === 403)
    return modelMissing || invalidToken || exhausted || chineseQuota;
  return (
    apiIncompatible || modelMissing || invalidToken || exhausted || chineseQuota
  );
}

function isModelUnavailableStatus(status: number, text = ""): boolean {
  if (status === 401 || status === 402) return true;
  if (status === 400 || status === 403)
    return isTemporaryUnavailableText(status, text);
  if (isTemporaryUnavailableText(status, text)) return true;
  return (
    status === 404 ||
    status === 409 ||
    status === 410 ||
    status === 424 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function isPersistentAutoDisableProtectedModel(model: string): boolean {
  return /^gpt-5\.5(?:-|$)/i.test(String(model || ""));
}

// Detects "the API key / account itself is permanently dead" signals.
// Only these warrant a hard, persistent 24h disable written to
// `model_line_disabled` (admin must re-enable from admin_lines.html after
// rotating the key). Everything else — per-user rate limits, per-day
// model quotas that auto-recover at midnight, transient 5xx — must fall
// through to the soft 1-hour memory block in `recordModelAvailability`,
// so the line auto-recovers without manual intervention.
//
// Historical bug (2026-05-14): the previous implementation hard-disabled
// any 4xx whose body contained "quota" / "insufficient" / "额度" / etc.
// That misclassified ALL of these as "key dead":
//   • 429 + "you exceeded your current quota" (user-level dashscope throttle)
//   • 429 + "exceeded today's quota for model X" (modelscope per-day cap)
//   • 403 + "用户剩余额度: ¥0.004 / insufficient_user_quota" (chunxueapi
//     account low-balance — recoverable by topping up)
// All seven entries currently in `model_line_disabled` are false positives
// from this bug. The new logic excludes them from hard disable.
function shouldAutoDisableLine(status: number, upstreamText = ""): boolean {
  // Rate limits NEVER hard-disable. 429 is by definition transient — every
  // upstream uses it for "back off and retry", whether per-second, per-
  // minute, per-day, or per-IP. Hard disabling on 429 punishes the line
  // for a per-user throttle the next request wouldn't have hit.
  if (status === 429) return false;
  // 5xx = upstream blip / overload. Soft 1h block handles it; never hard.
  if (status >= 500) return false;
  // 401 = unauthorized at the protocol layer (key revoked / wrong header
  // shape). Treat as line death.
  if (status === 401) return true;
  // 402 = payment required. The account itself stopped accepting requests.
  if (status === 402) return true;
  // 403 is ambiguous — some upstreams use it for "API key invalid" (line
  // death) and others for "user-level quota / today's free tier exhausted"
  // (recoverable). Inspect the body and be conservative: only hard-disable
  // when the text clearly says the account or key itself is terminated.
  if (status !== 403) return false;
  const t = (upstreamText || "").toLowerCase();
  if (!t) return false;
  // Per-user / per-day / per-minute throttle phrases — auto-recover, do
  // NOT escalate to a 24h hard disable. Match BEFORE the account-death
  // check so phrases like "insufficient_user_quota" win.
  const transientPhrases = [
    "today's quota",
    "exceeded.{0,40}quota.{0,80}(today|day|hour|minute)",
    "quota.{0,40}(per|each).{0,40}(minute|second|hour|day)",
    "rate.?limit",
    "too many requests",
    "please.{0,12}retry",
    "please.{0,12}slow.?down",
    "请稍后",
    "稍后再试",
    "频繁",
    "今日额度",
    "今日配额",
    "用户额度不足",
    "用户剩余额度",
    "insufficient_user_quota",
    "model.{0,40}quota",
    "free tier",
    "free.{0,12}quota",
    "每分钟",
    "每秒",
    "每天",
    "每小时",
  ];
  for (const phrase of transientPhrases) {
    if (new RegExp(phrase, "i").test(t)) return false;
  }
  // Account-level termination phrases — hard disable.
  return (
    /api[\s\-_]?key.{0,40}(invalid|expired|revoked|disabled|deactivat)/i.test(t) ||
    /account.{0,40}(suspend|terminat|disabled|ban|deactivat)/i.test(t) ||
    /(密钥|秘钥|api ?密钥).{0,20}(无效|失效|过期|停用|删除|撤销|未授权)/i.test(t) ||
    /账户.{0,20}(欠费|停用|封禁|暂停|过期|删除|被封)/i.test(t) ||
    t.includes("invalid token") ||
    t.includes("token is invalid") ||
    t.includes("token expired") ||
    t.includes("billing")
  );
}

const persistedDisabledLines = new Set<string>();

// Fire-and-forget write to model_line_disabled. Skips if we already wrote it
// in this isolate (per-process dedupe). The chat-gateway / api-gateway sides
// each cache the disabled set for 60s so the next request after this write
// will route around the dead line.
function persistDisableLine(
  model: string,
  status: number,
  upstreamText: string,
): void {
  if (!model || persistedDisabledLines.has(model)) return;
  persistedDisabledLines.add(model);
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    const reason =
      status === 401
        ? "unauthorized"
        : status === 402
          ? "payment_required"
          : "quota_or_billing";
    supabase
      .from("model_line_disabled")
      .upsert(
        {
          model_id: model,
          disabled_at: new Date().toISOString(),
          status_code: status,
          reason,
          upstream_excerpt: (upstreamText || "").slice(0, 500),
          disabled_by: "auto:modelscope-proxy",
        },
        { onConflict: "model_id" },
      )
      .then(() => {})
      .catch(() => {});
  } catch {
    /* non-blocking */
  }
}

function recordModelAvailability(
  model: string,
  status: number,
  ctx: RequestContext,
  upstreamText = "",
): void {
  if (!model) return;
  const now = Date.now();
  if (status >= 200 && status < 300) {
    modelAvailabilityMap.delete(model);
    return;
  }

  // 2026-05-20: 按 admin 要求关闭自动持久化禁用。任何自动写入
  // model_line_disabled 都禁用，统一通过 admin_lines.html 手工管理。
  // 历史问题：单次 401/402/403+key-text 即触发 24h 持久化禁用，
  // 误伤上游临时鉴权抖动的可恢复模型，而 5xx 流的真坏模型反而不会被禁。
  // 现在改为：所有故障一律走下面的 soft 5-min 内存块（per-isolate），
  // 自然恢复，永不触达 DB。如需永久封堵，admin 手动操作。
  // 仅日志，便于事后排查；shouldAutoDisableLine / persistDisableLine /
  // isPersistentAutoDisableProtectedModel 保留以便 admin 工具或将来策略复用。
  if (shouldAutoDisableLine(status, upstreamText) && !isPersistentAutoDisableProtectedModel(model)) {
    logSecurityEvent("model_auto_disable_skipped", ctx, { model, status });
    // 仍记一次 in-memory failure，让后续 6 次/3 分钟阈值能将该上游推入 5min soft block。
  }

  if (!isModelUnavailableStatus(status, upstreamText)) return;
  const entry = modelAvailabilityMap.get(model) || {
    failures: 0,
    resetAt: now + MODEL_UNAVAILABLE_WINDOW_MS,
    blockedUntil: 0,
  };
  if (now > entry.resetAt) {
    entry.failures = 0;
    entry.resetAt = now + MODEL_UNAVAILABLE_WINDOW_MS;
  }
  entry.failures += 1;
  if (entry.failures >= MODEL_UNAVAILABLE_FAILURE_LIMIT) {
    entry.blockedUntil = now + MODEL_UNAVAILABLE_BLOCK_MS;
    logSecurityEvent("model_blocked", ctx, {
      model,
      status,
      retryAfter: Math.ceil(MODEL_UNAVAILABLE_BLOCK_MS / 1000),
    });
  }
  modelAvailabilityMap.set(model, entry);
  trimMapIfNeeded(modelAvailabilityMap);
}

function extractUpstreamErrorText(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data !== "object") return "";
  const value = data as Record<string, unknown>;
  const pieces: string[] = [];
  for (const key of ["error", "message", "detail", "code"]) {
    const item = value[key];
    if (typeof item === "string") pieces.push(item);
    else if (item && typeof item === "object")
      pieces.push(extractUpstreamErrorText(item));
  }
  return pieces.filter(Boolean).join(" ");
}

function modelBlockedResponse(
  model: string,
  retryAfter: number,
  ch: Record<string, string>,
): Response {
  return jsonResponse(
    {
      error: "model_temporarily_unavailable",
      code: "model_temporarily_unavailable",
      model,
      message: "该模型近期连续不可用，已临时关闭一小时。",
      retry_after_seconds: retryAfter,
    },
    503,
    ch,
    { "Retry-After": String(retryAfter) },
  );
}

function toModelScopeModelId(model: string): string {
  // Cold-failover canonicals → ModelScope-prefixed wire id.
  // Verified 2026-05-13 via /v1/chat/completions probes against api-inference.modelscope.cn.
  if (model === "minimax-m2.5") return "minimax/MiniMax-M2.5";
  if (model === "deepseek-v4-flash") return "deepseek-ai/DeepSeek-V4-Flash";
  if (model === "deepseek-v4-pro") return "deepseek-ai/DeepSeek-V4-Pro";
  if (model === "glm-5.1") return "ZhipuAI/GLM-5.1";
  if (model === "ling-2.6-flash") return "inclusionAI/Ling-2.6-flash";
  if (model === "ling-2.6-1t") return "inclusionAI/Ling-2.6-1T";
  return model;
}

const MODELSCOPE_API_BASE = Deno.env.get("MODELSCOPE_API_BASE") || "https://api-inference.modelscope.cn/v1";
const MODELSCOPE_API_KEY = (Deno.env.get("MODELSCOPE_API_KEY") || "").trim();
const MODELSCOPE_API_KEY_1 = (Deno.env.get("MODELSCOPE_API_KEY_1") || "").trim();
const MODELSCOPE_API_KEY_2 = (Deno.env.get("MODELSCOPE_API_KEY_2") || "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";

const IAMHC_BASE_URL = (Deno.env.get("IAMHC_BASE_URL") || '').replace(/\/$/, "");
const IAMHC_API_KEY = Deno.env.get("IAMHC_API_KEY") || "";
const TOKENFLUX_BASE_URL = (
  Deno.env.get("TOKENFLUX_BASE_URL") ||
  Deno.env.get("CHATAPI4_BASE_URL") ||
  'https://tokenflux.dev/v1'
).replace(/\/$/, "");
const TOKENFLUX_API_KEY = Deno.env.get("TOKENFLUX_API_KEY") || Deno.env.get("CHATAPI4_API_KEY") || "";
const FREEAPI_BASE_URL = (Deno.env.get("FREEAPI_BASE_URL") || '').replace(/\/$/, "");
const FREEAPI_API_KEY = Deno.env.get("FREEAPI_API_KEY") || "";
// 之前这里被改成 ("" || "")，导致 DASHSCOPE_COMPATIBLE_BASE_URL 为空字符串，
// 所有 dashscope 走 chat/completions 的 URL 拼出来是 "/chat/completions"
// （没有 host），整批阿里云百炼的 chat 模型对外都是死的。回到正常实现：
// 优先读 env，没设就回到官方 OpenAI 兼容端点。
const DASHSCOPE_COMPATIBLE_BASE_URL = (
  Deno.env.get("DASHSCOPE_COMPATIBLE_BASE_URL") ||
  "https://dashscope.aliyuncs.com/compatible-mode/v1"
).replace(/\/$/, "");
const DASHSCOPE_API_KEY = (Deno.env.get("DASHSCOPE_API_KEY") || "").trim();
const DASHSCOPE_API_KEY_1 = (Deno.env.get("DASHSCOPE_API_KEY_1") || "").trim();
const DASHSCOPE_API_KEY_2 = (Deno.env.get("DASHSCOPE_API_KEY_2") || "").trim();
const DASHSCOPE_GLM5_API_KEY = (Deno.env.get("DASHSCOPE_GLM5_API_KEY") || "").trim();
// HappyHorse can use DASHSCOPE_HAPPYHORSE_API_KEY; other DashScope media lines
// use DASHSCOPE_VIDEO_API_KEY, then the legacy Wan key, then chat keys.
const DASHSCOPE_VIDEO_API_KEY = (Deno.env.get("DASHSCOPE_VIDEO_API_KEY") || "").trim();
const DASHSCOPE_HAPPYHORSE_API_KEY = (Deno.env.get("DASHSCOPE_HAPPYHORSE_API_KEY") || "").trim();
// Legacy Wan-specific key kept readable for back-compat. If both are set,
// `DASHSCOPE_VIDEO_API_KEY` wins. New deployments should leave this empty.
const DASHSCOPE_WAN_API_KEY = (Deno.env.get("DASHSCOPE_WAN_API_KEY") || "").trim();
let dashScopeKeyCursor = 0;

const HHHL_BASE_URL = (Deno.env.get("HHHL_BASE_URL") || 'https://ai.hhhl.cc/v1').replace(/\/$/, "");
const HHHL_API_KEY = (Deno.env.get("HHHL_API_KEY") || "").trim();
const AIIONLY_BASE_URL = (Deno.env.get("AIIONLY_BASE_URL") || "https://api.aiionly.com").replace(/\/+$/, "");
// 2026-05-16: aiionly 现在承载两个视频模型，分别有独立 key（各 ¥16 预算）：
//   AIIONLY_API_KEY        → doubao-seedance-2-0-260128（480p 5s ~¥4/次）
//   AIIONLY_VEO_API_KEY    → veo-3.1-lite-generate-preview（720p 5s ~¥1.75/次）
// 用 per-model key 是为了一条线烧光不会影响另一条，也方便单独充值/换 key。
// 缺 VEO key 时优雅 fallback 到 AIIONLY_API_KEY 以保持 dev 体验，但生产建议
// 一定要把两条 key 都设上（chat-gateway 已 VIP-only + 7d 配额硬挡，问题不大）。
const AIIONLY_API_KEY = (Deno.env.get("AIIONLY_API_KEY") || "").trim();
const AIIONLY_VEO_API_KEY = (Deno.env.get("AIIONLY_VEO_API_KEY") || "").trim();

function pickAiionlyApiKey(model: string): string {
  if (model === "veo-3.1-lite-generate-preview") {
    return AIIONLY_VEO_API_KEY || AIIONLY_API_KEY;
  }
  return AIIONLY_API_KEY;
}

function aiionlyKeyEnvName(model: string): string {
  if (model === "veo-3.1-lite-generate-preview") return "AIIONLY_VEO_API_KEY";
  return "AIIONLY_API_KEY";
}

const SILICONFLOW_BASE_URL = (Deno.env.get("SILICONFLOW_BASE_URL") || '').replace(/\/$/, "");
const SILICONFLOW_API_KEY = Deno.env.get("SILICONFLOW_API_KEY") || "";

const MIMO_BASE_URL = (Deno.env.get("MIMO_BASE_URL") || 'https://api.modelscope.cn/v1').replace(/\/$/, "");
const MIMO_API_KEY = Deno.env.get("MIMO_API_KEY") || "";
const MIMO_TTS_API_KEY =
  (Deno.env.get("MIMO_TTS_API_KEY") || "").trim() || MIMO_API_KEY;
// 2026-05-18：MiMo-V2.5-TTS 上游 = api.xiaomimimo.com/v1（与 MiMo 聊天模型的 modelscope.cn 不同）。
// 其 OpenAI 兼容接口鉴权走 `api-key: <KEY>` 而不是 Authorization: Bearer，详见 key.md。
// 2026-05-18 v2：用户买了 Max 月度套餐后，专属 Base URL 走
// https://token-plan-cn.xiaomimimo.com/v1（同样的 `api-key` header 鉴权），
// 通过 MIMO_TTS_BASE_URL secret 覆盖默认值。
const MIMO_TTS_BASE_URL = (
  Deno.env.get("MIMO_TTS_BASE_URL") || "https://api.xiaomimimo.com/v1"
).replace(/\/$/, "");
const MIMO_PRO_BASE_URL = (
  Deno.env.get("MIMO_PRO_BASE_URL") || MIMO_BASE_URL
).replace(/\/$/, "");

const FUTUREPPO_BASE_URL = (Deno.env.get("FUTUREPPO_BASE_URL") || '').replace(/\/+$/, "");
const FUTUREPPO_API_KEY = Deno.env.get("FUTUREPPO_API_KEY") || "";
const FUTUREPPO_GEMMA_API_KEY = Deno.env.get("FUTUREPPO_GEMMA_API_KEY") || "";
const FUTUREPPO_MODEL_PREFIX = "futureppo:";

const SENSENOVA_BASE_URL = (Deno.env.get("SENSENOVA_BASE_URL") || 'https://token.sensenova.cn/v1').replace(/\/$/, "");
const SENSENOVA_API_KEY = Deno.env.get("SENSENOVA_API_KEY") || "";

// 2026-05-18: new.pwcen.cn 承载 GPT-5.5（上游 model id 是 "gpt-5-5"，dash 不是 dot）。
// Supabase 100-secret 上限触顶，无法新建 PWCEN_API_KEY；hhhl 已下线（isHhhlModel
// return false，无 canonical 走 hhhl），复用其 secret slot：HHHL_API_KEY 现在
// 实际存的是 new.pwcen.cn 的 key（sk-u7EQ…）。读取顺序优先 PWCEN_API_KEY（万一
// 将来腾出名额可平滑迁），fallback 到 HHHL_API_KEY。
const PWCEN_BASE_URL = (Deno.env.get("PWCEN_BASE_URL") || 'https://new.pwcen.cn/v1').replace(/\/$/, "");
const PWCEN_API_KEY = Deno.env.get("PWCEN_API_KEY") || Deno.env.get("HHHL_API_KEY") || "";
const XIANGLUAPI_BASE_URL = (Deno.env.get("XIANGLUAPI_BASE_URL") || '').replace(/\/$/, "");
const XIANGLUAPI_API_KEY = Deno.env.get("XIANGLUAPI_API_KEY") || "";
const GEMAI_BASE_URL = (Deno.env.get("GEMAI_BASE_URL") || 'https://api2.gemai.cc/v1').replace(/\/$/, "");
const GEMAI_API_KEY = Deno.env.get("GEMAI_API_KEY") || "";
const GEMAI_API_KEY_2 = Deno.env.get("GEMAI_API_KEY_2") || "";
const API456_BASE_URL = (Deno.env.get("API456_BASE_URL") || 'https://api456.me/v1').replace(/\/$/, "");
const API456_API_KEY = Deno.env.get("API456_API_KEY") || "";
const CHSHAPI_BASE_URL = (Deno.env.get("CHSHAPI_BASE_URL") || '').replace(/\/$/, "");
const CHSHAPI_API_KEY = Deno.env.get("CHSHAPI_API_KEY") || "";
const XEM8K5_BASE_URL = (Deno.env.get("XEM8K5_BASE_URL") || '').replace(/\/$/, "");
const XEM8K5_API_KEY = Deno.env.get("XEM8K5_API_KEY") || "";
// Secondary xem8k5 key for glm-5.1.
const XEM8K5_API_KEY_2 = Deno.env.get("XEM8K5_API_KEY_2") || "";
const TXT180_BASE_URL = (Deno.env.get("TXT180_BASE_URL") || 'https://api.180txt.cn/v1').replace(/\/$/, "");
const TXT180_API_KEY = Deno.env.get("TXT180_API_KEY") || "";
const PQGPT_BASE_URL = (Deno.env.get("PQGPT_BASE_URL") || 'https://www.pqgpt.online/v1').replace(/\/$/, "");
const PQGPT_API_KEY = (Deno.env.get("PQGPT_API_KEY") || TXT180_API_KEY || "").trim();
const PQGPT_MODEL_ID = (Deno.env.get("PQGPT_MODEL_ID") || "gpt-5.2-pro").trim();
const CLAWTO_BASE_URL = (Deno.env.get("CLAWTO_BASE_URL") || 'https://api.clawto.link/v1').replace(/\/$/, "");
const CLAWTO_API_KEY_B = Deno.env.get("CLAWTO_API_KEY_B") || "";
const CLAWTO_API_KEY_C = Deno.env.get("CLAWTO_API_KEY_C") || "";
const AISTUDIO_BASE_URL = (Deno.env.get("AISTUDIO_BASE_URL") || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, "");
const AISTUDIO_API_KEY = Deno.env.get("AISTUDIO_API_KEY") || Deno.env.get("GEMINI_API_KEY") || "";
const NEWAPI_QWQTAO_BASE_URL = (Deno.env.get("NEWAPI_QWQTAO_BASE_URL") || '').replace(/\/$/, "");
const NEWAPI_QWQTAO_API_KEY = Deno.env.get("NEWAPI_QWQTAO_API_KEY") || "";
// Independent qwqtao key for grok-4.3 (separate upstream account). Falls
// back to the shared key so an admin can collapse to one key if desired.
const NEWAPI_QWQTAO_GROK_API_KEY = Deno.env.get("NEWAPI_QWQTAO_GROK_API_KEY") || "";
// Shared qwqtao key #2 (independent account) used by openai/gpt-5.4-nano
// and gpt-5-mini. Falls back to the primary key so an admin can collapse
// to one key if desired.
const NEWAPI_QWQTAO_API_KEY_2 = Deno.env.get("NEWAPI_QWQTAO_API_KEY_2") || "";

function pickNewapiQwqtaoApiKey(model: string): string {
  if (model === "grok-4.3") {
    return NEWAPI_QWQTAO_GROK_API_KEY || NEWAPI_QWQTAO_API_KEY;
  }
  if (model === "gpt-5.4-nano" || model === "gpt-5-mini") {
    return NEWAPI_QWQTAO_API_KEY_2 || NEWAPI_QWQTAO_API_KEY;
  }
  return NEWAPI_QWQTAO_API_KEY || NEWAPI_QWQTAO_GROK_API_KEY;
}

function pickClawtoApiKey(model: string): string {
  if (model === "gpt-5.5-c") return CLAWTO_API_KEY_C || CLAWTO_API_KEY_B;
  return CLAWTO_API_KEY_B || CLAWTO_API_KEY_C;
}

function newapiQwqtaoKeyEnvName(model: string): string {
  if (model === "grok-4.3") return "NEWAPI_QWQTAO_GROK_API_KEY";
  if (model === "gpt-5.4-nano" || model === "gpt-5-mini")
    return "NEWAPI_QWQTAO_API_KEY_2";
  return "NEWAPI_QWQTAO_API_KEY";
}
// ── freeapi.dgbmc.top (multi-vendor relay) ──
// 2026-05-13 审查：原代码读 FREEAPI_DGBMC_API_KEY / FREEAPI_DGBMC_CLAUDE_API_KEY，
// 但 Supabase secret 实际只存分模型专用 key，导致 dgbmc 上游请求拿不到 key
// 全部被 providerConfigError 拦住。现按上游实际的 3 类账号分流读取，
// 每类 _A 优先 _B 做干干净净的 fallback（类似 FREEMODEL_API_KEY 模式）。
const FREEAPI_DGBMC_BASE_URL = (Deno.env.get("FREEAPI_DGBMC_BASE_URL") || 'https://freeapi.dgbmc.top/v1').replace(/\/$/, "");
const DGBMC_OPUS46_API_KEY_A = (Deno.env.get("DGBMC_OPUS46_API_KEY_A") || "").trim();
const DGBMC_OPUS46_API_KEY_B = (Deno.env.get("DGBMC_OPUS46_API_KEY_B") || "").trim();
const DGBMC_GROK_API_KEY_A = (Deno.env.get("DGBMC_GROK_API_KEY_A") || "").trim();
const DGBMC_GROK_API_KEY_B = (Deno.env.get("DGBMC_GROK_API_KEY_B") || "").trim();
// 2026-05-14: grok-imagine-image-lite 单拆出来的 key（DGBMC_GROK_API_KEY_A
// 那条账户对 image-lite 失效），grok-4.20-0309 聊天仍用原 _A/_B 池，
// 互不影响。pickFreeapiDgbmcApiKey 在该模型上优先取这个，其次回 _A/_B。
const DGBMC_GROK_IMAGE_API_KEY = (Deno.env.get("DGBMC_GROK_IMAGE_API_KEY") || "").trim();

// ── pie-xian (api.pie-xian.com) ──
// 2026-05-13 (Phase 1): pie-xian carries 5 models split across two protocols:
//   /v1/messages  (Anthropic Messages):  claude-haiku-4-5-20251001
//   /v1/responses (OpenAI Responses):    gpt-5.3-codex / doubao-1.5-pro / kimi-k2.6
// Each model owns a dedicated key (per user spec):
//   PIEXIAN_HAIKU_API_KEY        → claude-haiku
//   PIEXIAN_CODEX_API_KEY        → gpt-5.3-codex
//   PIEXIAN_DOUBAO_KIMI_API_KEY  → doubao-1.5-pro + kimi-k2.6 (shared)
const PIEXIAN_BASE_URL = (Deno.env.get("PIEXIAN_BASE_URL") || 'https://api.pie-xian.com').replace(/\/$/, "");
const PIEXIAN_API_KEY = (Deno.env.get("PIEXIAN_API_KEY") || "").trim();
const PIEXIAN_HAIKU_API_KEY = (Deno.env.get("PIEXIAN_HAIKU_API_KEY") || "").trim();
const PIEXIAN_CODEX_API_KEY = (Deno.env.get("PIEXIAN_CODEX_API_KEY") || "").trim();
const PIEXIAN_DOUBAO_KIMI_API_KEY = (Deno.env.get("PIEXIAN_DOUBAO_KIMI_API_KEY") || "").trim();

// ── ai.121628.xyz cold backup (chat completions, OpenAI-compatible) ──
// 2026-05-14: kimi-k2.6 cold backup line. pie-xian remains the primary
// route; ai121628 participates in the same random pool for kimi-k2.6 so
// a single account outage on either side doesn't take the model offline.
// Default base URL ends in /v1 because the URL builder appends /chat/completions.
const AI121628_BASE_URL = (
  Deno.env.get("AI121628_BASE_URL") || "https://ai.121628.xyz/v1"
).replace(/\/$/, "");
const AI121628_KIMI_K26_API_KEY = (Deno.env.get("AI121628_KIMI_K26_API_KEY") || "").trim();

function isPiexianModel(model: string): boolean {
  return (
    model === "claude-haiku-4-5-20251001" ||
    model === "doubao-1.5-pro" ||
    model === "gpt-5.3-codex" ||
    model === "kimi-k2.6"
  );
}

// Anthropic Messages protocol (/v1/messages, x-api-key auth).
function isPiexianMessagesModel(model: string): boolean {
  return model === "claude-haiku-4-5-20251001";
}

// OpenAI Responses protocol (/v1/responses, Authorization Bearer auth).
// 2026-05-13 verified upstream behavior:
//   gpt-5.3-codex   ✓ /v1/responses (OpenAI-native, supports Responses)
//   doubao-1.5-pro  ✗ /v1/responses returns 403 "model does not have access
//                     to responses api" → use /v1/chat/completions instead
//   kimi-k2.6       ✗ /v1/responses returns 404 → use /v1/chat/completions
function isPiexianResponsesModel(model: string): boolean {
  return model === "gpt-5.3-codex";
}

function pickPiexianApiKey(model: string): string {
  if (model === "claude-haiku-4-5-20251001") {
    return PIEXIAN_HAIKU_API_KEY || PIEXIAN_API_KEY;
  }
  if (model === "gpt-5.3-codex") {
    // OpenAI-family on pie-xian; codex key covers both per user direction.
    return PIEXIAN_CODEX_API_KEY || PIEXIAN_API_KEY;
  }
  if (model === "doubao-1.5-pro" || model === "kimi-k2.6") {
    return PIEXIAN_DOUBAO_KIMI_API_KEY || PIEXIAN_API_KEY;
  }
  return PIEXIAN_API_KEY;
}

function piexianKeyEnvName(model: string): string {
  if (model === "claude-haiku-4-5-20251001") return "PIEXIAN_HAIKU_API_KEY";
  if (model === "gpt-5.3-codex") return "PIEXIAN_CODEX_API_KEY";
  if (model === "doubao-1.5-pro" || model === "kimi-k2.6") return "PIEXIAN_DOUBAO_KIMI_API_KEY";
  return "PIEXIAN_API_KEY";
}

// Translate canonical id → upstream model id at pie-xian. All 5 lines
// use bare canonical ids on the wire.
function toPiexianModelId(model: string): string {
  return model;
}

function isFreeapiDgbmcClaudeModel(model: string): boolean {
  return (
    model === "claude-opus-4-6" ||
    model === "claude-opus-4-6-thinking" ||
    model === "claude-sonnet-4-6" ||
    model === "claude-sonnet-4-6-thinking"
  );
}

function pickFreeapiDgbmcApiKey(model: string): string {
  if (isFreeapiDgbmcClaudeModel(model)) {
    return DGBMC_OPUS46_API_KEY_A || DGBMC_OPUS46_API_KEY_B;
  }
  if (model === "grok-imagine-image-lite") {
    // 2026-05-14: 这条线优先用 DGBMC_GROK_IMAGE_API_KEY 单拆 key，
    // 旧 _A/_B 那条账户对 image-lite 已失效（用户实测 "未返回图片数据"
    // = 上游 200 但内容里没图）。回退到老池仅作灰度过渡用。
    return DGBMC_GROK_IMAGE_API_KEY || DGBMC_GROK_API_KEY_A || DGBMC_GROK_API_KEY_B;
  }
  if (model === "grok-4.20-0309") {
    return DGBMC_GROK_API_KEY_A || DGBMC_GROK_API_KEY_B;
  }
  // 不该到达：isFreeapiDgbmcModel 里的所有分支都在上面取完了。保留
  // 为防未来加新型号时不小心踩成同一个坑。
  return "";
}

function freeapiDgbmcKeyEnvName(model: string): string {
  if (isFreeapiDgbmcClaudeModel(model)) return "DGBMC_OPUS46_API_KEY_A";
  if (model === "grok-imagine-image-lite") return "DGBMC_GROK_IMAGE_API_KEY";
  if (model === "grok-4.20-0309") return "DGBMC_GROK_API_KEY_A";
  return "DGBMC_OPUS46_API_KEY_A";
}

function isFreeapiDgbmcModel(model: string): boolean {
  return (
    model === "grok-4.20-0309" ||
    model === "grok-imagine-image-lite"
  );
}

// Translate canonical id → upstream model id at freeapi.dgbmc.top.
// Verified 2026-05-13 via dgbmc /v1/models:
//   - claude-opus-4-6-thinking : passthrough ✅
//   - grok-4.20-0309           : maps to grok-4.20-0309-non-reasoning
//   - grok-imagine-image-lite  : passthrough ✅
function toFreeapiDgbmcModelId(model: string): string {
  if (model === "claude-sonnet-4-6-freeapi") return "claude-sonnet-4-6";
  if (model === "grok-4.20-0309") return "grok-4.20-0309-non-reasoning";
  return model;
}
const ORBITAI_BASE_URL = (Deno.env.get("ORBITAI_BASE_URL") || 'https://api.orbitai.com/v1').replace(/\/$/, "");
const ORBITAI_API_KEY = Deno.env.get("ORBITAI_API_KEY") || "";
// orbitai.cc (root domain) — second line for gpt-5.4-mini, paired with
// newapi.qwqtao.com via the routing pool below.
const ORBITAICC_BASE_URL = (Deno.env.get("ORBITAICC_BASE_URL") || 'https://orbitai.cc/v1').replace(/\/$/, "");
// Legacy single-key fallback (kept for back-compat).
const ORBITAICC_API_KEY = Deno.env.get("ORBITAICC_API_KEY") || "";
// 2026-05-13: orbitai.cc serves two models with two distinct keys.
// gpt-5.4-mini → ORBITAICC_GPT_API_KEY,
// doubao-seed-2-0-lite-260215 → ORBITAICC_DOUBAO_API_KEY.
// Pickers fall back to ORBITAICC_API_KEY when the per-model var is unset.
const ORBITAICC_GPT_API_KEY = Deno.env.get("ORBITAICC_GPT_API_KEY") || "";
const ORBITAICC_DOUBAO_API_KEY = Deno.env.get("ORBITAICC_DOUBAO_API_KEY") || "";
const UGLYCAT_BASE_URL = (Deno.env.get("UGLYCAT_BASE_URL") || 'https://api.uglycat.cc/v1').replace(/\/$/, "");
const UGLYCAT_API_KEY = Deno.env.get("UGLYCAT_API_KEY") || "";
const CXYQUAN_BASE_URL = (Deno.env.get("CXYQUAN_BASE_URL") || '').replace(/\/$/, "");
const CXYQUAN_API_KEY = Deno.env.get("CXYQUAN_API_KEY") || "";
const QNAIGC_BASE_URL = (Deno.env.get("QNAIGC_BASE_URL") || '').replace(/\/$/, "");
const QNAIGC_API_KEY = Deno.env.get("QNAIGC_API_KEY") || "";
const SPARKCODE_BASE_URL = (Deno.env.get("SPARKCODE_BASE_URL") || '').replace(/\/$/, "");
const SPARKCODE_API_KEY = Deno.env.get("SPARKCODE_API_KEY") || "";
const CHUNXUEAPI_BASE_URL = (Deno.env.get("CHUNXUEAPI_BASE_URL") || 'https://www.chunxueapi.com/v1').replace(/\/$/, "");
const CHUNXUEAPI_API_KEY = Deno.env.get("CHUNXUEAPI_API_KEY") || "";
const CHUNXUEAPI_CLAUDE_KEY = Deno.env.get("CHUNXUEAPI_CLAUDE_KEY") || "";
const CHUNXUEAPI_GPT55_KEY = Deno.env.get("CHUNXUEAPI_GPT55_KEY") || "";
const UNIVIBE_BASE_URL = (Deno.env.get("UNIVIBE_BASE_URL") || '').replace(/\/$/, "");
const UNIVIBE_API_KEY = Deno.env.get("UNIVIBE_API_KEY") || "";
// ── aspirin (api.aspirin.cc) ──
// 2026-05-18: claude-opus-4-7 主线。OpenAI Chat Completions 兼容。
const ASPIRIN_BASE_URL = (Deno.env.get("ASPIRIN_BASE_URL") || 'https://api.aspirin.cc/v1').replace(/\/$/, "");
const ASPIRIN_API_KEY = (Deno.env.get("ASPIRIN_API_KEY") || "").trim();

const TOKAIFY_BASE_URL = (Deno.env.get("TOKAIFY_BASE_URL") || 'https://api.tokaify.com/v1').replace(/\/$/, "");
const TOKAIFY_API_KEY = (Deno.env.get("TOKAIFY_API_KEY") || "").trim();
const TOKAIFY_GPT_IMAGE_2_API_KEY = (Deno.env.get("TOKAIFY_GPT_IMAGE_2_API_KEY") || "").trim();

const SUPXH_BASE_URL = (Deno.env.get("SUPXH_BASE_URL") || 'https://api.supxh.xin').replace(/\/$/, "");
const SUPXH_API_KEYS_RAW = Deno.env.get("SUPXH_API_KEYS_RAW") || "";
// Dedicated key for claude-opus-4-5 on supxh (the only Claude model on this
// relay). Mapped from SUPXH_OPUS45_API_KEY (named per the user spec).
const SUPXH_CLAUDE_API_KEY = Deno.env.get("SUPXH_OPUS45_API_KEY") || Deno.env.get("SUPXH_CLAUDE_API_KEY") || "sk-MK5OMZ8NrD3Ivc8YlRO2dlRALLJlYKJf4kHtmkHjKnc9vJ5K";
const SUPXH_KEY_BLOCK_MS = 60 * 60_000;
let supxhKeyCursor = 0;
const supxhBlockedKeys = new Map<string, number>();
const API456_API_KEY_2 = (Deno.env.get("API456_API_KEY_2") || "").trim();
const API456_API_KEY_3 = (Deno.env.get("API456_API_KEY_3") || "").trim();
const OPENROUTER_BASE_URL = Deno.env.get("OPENROUTER_BASE_URL") || "https://openrouter.ai/api/v1";
// 2026-05-13 审查：原代码只读 OPENROUTER_API_KEYS_RAW（不存在），但 Supabase
// secret 实际是 OPENROUTER_API_KEY_1 / _2 / _3 分别存储，导致 OpenRouter
// 池为空 → 15 个 or:* 模型 + minimax-m2.5 / glm-4.5-air 路由池里的
// OpenRouter 候选全挂。和 dgbmc 同类命名 mismatch。改为合并 3 个 _N
// 与旧的 _RAW（如果有人手工设过）一起，下游 expandProviderKeys 用
// /[\s,;]+/ split 拆出独立 key，无需改 pool 逻辑。
const OPENROUTER_API_KEYS_RAW = [
  Deno.env.get("OPENROUTER_API_KEY_1") || "",
  Deno.env.get("OPENROUTER_API_KEY_2") || "",
  Deno.env.get("OPENROUTER_API_KEY_3") || "",
  Deno.env.get("OPENROUTER_API_KEYS_RAW") || "",
].filter(Boolean).join(",");
const OPENROUTER_KEY_BLOCK_MS = 60 * 60_000;
let openRouterKeyCursor = 0;
const openRouterBlockedKeys = new Map<string, number>();
let api456KeyCursor = 0;
const CLOUDFLARE_ACCOUNT_ID = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") || "0f1b7c999bc792df5a98e37997f8d247";
const CLOUDFLARE_API_KEY = Deno.env.get("CLOUDFLARE_API_KEY") || "";
const CLOUDFLARE_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1`;
const CPASS_BASE_URL = (Deno.env.get("CPASS_BASE_URL") || '').replace(/\/$/, "");
const CPASS_API_KEY = (Deno.env.get("CPASS_API_KEY") || "").trim();
const CPASS_API_KEY_2 = (Deno.env.get("CPASS_API_KEY_2") || "").trim();
let cpassKeyCursor = 0;
const FREEMODEL_BASE_URL = (Deno.env.get("FREEMODEL_BASE_URL") || 'https://api.freemodel.dev').replace(/\/$/, "");
const FREEMODEL_API_KEY = Deno.env.get("FREEMODEL_API_KEY") || "";
// 2026-05-19: 福利 GPT-5.5 使用独立 key，不与 GPT-5.5 High 共享
const FREEMODEL_WELFARE_API_KEY = Deno.env.get("FREEMODEL_WELFARE_API_KEY") || "";
// 2026-05-18: 用户主导 — gpt-5.5-high 是 freemodel 当前唯一承载模型，
// 用户要求"两把 key 都失败 → 模型熔断 5H（此模型特例）"。把 per-key
// block 从 1h 提到 5h：单请求两把 key 同时 401/402/403/429 时双双进入
// 5h 黑名单；后续请求 pickFreemodelApiKey 走 fallback 取最早恢复的（仍在
// 5h 内）只会继续 401，recordModelAvailability 在 3 次失败 / 10min 后把
// model 推进 modelAvailabilityMap 1h 软块（getModelBlock 在 line 5099 直接
// 短路），形成 1h-cycle 的快速失败窗口直到 5h 后两把 key 自然解锁。
const FREEMODEL_KEY_BLOCK_MS = 5 * 60 * 60_000;
let freemodelKeyCursor = 0;
const freemodelBlockedKeys = new Map<string, number>();
function getFreemodelKeyPool(): string[] {
  return uniqueProviderKeys([FREEMODEL_API_KEY]);
}
function pickFreemodelApiKey(_lineId: string): string {
  const keys = getFreemodelKeyPool();
  if (!keys.length) return "";
  const now = Date.now();
  for (const [key, unblockAt] of freemodelBlockedKeys) {
    if (now >= unblockAt) freemodelBlockedKeys.delete(key);
  }
  for (let i = 0; i < keys.length; i += 1) {
    const idx = (freemodelKeyCursor + i) % keys.length;
    const key = keys[idx];
    if (!freemodelBlockedKeys.has(key)) {
      freemodelKeyCursor = (idx + 1) % keys.length;
      return key;
    }
  }
  let earliest = Infinity;
  let earliestKey = "";
  for (const [key, unblockAt] of freemodelBlockedKeys) {
    if (unblockAt < earliest) {
      earliest = unblockAt;
      earliestKey = key;
    }
  }
  return earliestKey || keys[0] || "";
}
function pickFreemodelApiKeyForModel(lineId: string): string {
  return lineId === "gpt-5.5-welfare" ? FREEMODEL_WELFARE_API_KEY : pickFreemodelApiKey(lineId);
}
function hasFreemodelKeyForModel(lineId: string): boolean {
  return lineId === "gpt-5.5-welfare" ? !!FREEMODEL_WELFARE_API_KEY : hasAnyFreemodelKey();
}
function freemodelKeySecretNameForModel(lineId: string): string {
  return lineId === "gpt-5.5-welfare" ? "FREEMODEL_WELFARE_API_KEY" : "FREEMODEL_API_KEY";
}
function markFreemodelKeyBlocked(key: string): void {
  if (!key) return;
  freemodelBlockedKeys.set(key, Date.now() + FREEMODEL_KEY_BLOCK_MS);
  trimMapIfNeeded(freemodelBlockedKeys);
}
function hasAnyFreemodelKey(): boolean {
  return getFreemodelKeyPool().length > 0;
}
const DIALOGUEDUI_BASE_URL = (Deno.env.get("DIALOGUEDUI_BASE_URL") || 'https://token.dialoguedui.com/v1').replace(/\/$/, "");
const DIALOGUEDUI_API_KEY = (Deno.env.get("DIALOGUEDUI_API_KEY") || "").trim();
const UU6TOP_BASE_URL = (Deno.env.get("UU6TOP_BASE_URL") || 'https://api.uu6.top/v1').replace(/\/$/, "");
const UU6TOP_CLAUDE_OPUS_47_API_KEY = (Deno.env.get("UU6TOP_CLAUDE_OPUS_47_API_KEY") || "").trim();
const UU6TOP_GPT52_API_KEY = (Deno.env.get("UU6TOP_GPT52_API_KEY") || "").trim();
const UU6TOP_HAIKU_THINKING_API_KEY = (Deno.env.get("UU6TOP_HAIKU_THINKING_API_KEY") || "").trim();
const GPT55_XHIGH_UU6TOP_MODEL_ID = (Deno.env.get("GPT55_XHIGH_UU6TOP_MODEL_ID") || "gpt-5.2").trim();
const CODERELAY_BASE_URL = (Deno.env.get("CODERELAY_BASE_URL") || 'https://api.code-relay.com/v1').replace(/\/$/, "");
const CODERELAY_API_KEY = (Deno.env.get("CODERELAY_API_KEY") || "").trim();
const ANTHROPIC_BASE_URL = (Deno.env.get("ANTHROPIC_BASE_URL") || '').replace(/\/$/, "");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// ── chatapi4 (chat-api4.087654.xyz, OpenAI Chat compat) ──
const CHATAPI4_BASE_URL = (
  Deno.env.get("CHATAPI4_BASE_URL") || "https://chat-api4.087654.xyz/v1"
).replace(/\/$/, "");
const CHATAPI4_API_KEY = Deno.env.get("CHATAPI4_API_KEY") || "";

function isChatApi4Model(model: string): boolean {
  return model === "gpt-5.4-mini";
}

function toChatApi4ModelId(model: string): string {
  return model;
}

// ── beijixingxing (gemini.beijixingxing.com, OpenAI Chat compat) ──
const BEIJIXINGXING_BASE_URL = (
  Deno.env.get("BEIJIXINGXING_BASE_URL") || "https://gemini.beijixingxing.com/v1"
).replace(/\/$/, "");
const BEIJIXINGXING_API_KEY = Deno.env.get("BEIJIXINGXING_API_KEY") || "";

function isBeijixingxingModel(model: string): boolean {
  return model === "minimax-m2.7";
}

function toBeijixingxingModelId(model: string): string {
  return model;
}

function toGemaiModelId(model: string): string {
  // gemai.cc routes models by a bracketed label prefix that selects the
  // upstream channel pool. The user's spec (进模型清单.md) labels:
  //   [满血A]gemini-3.1-pro-preview        → premium pool A
  //   [福利]gemini-3.1-flash-lite-preview   → free-tier welfare pool
  // The plain canonical id also works (returns 200 with empty body when
  // max_tokens is tiny), but using the bracketed prefix routes to the
  // user-intended quality tier.
  if (model === "gemini-3.1-pro-preview") return "[满血A]gemini-3.1-pro-preview";
  if (model === "gemini-3.1-flash-lite-preview") return "[福利]gemini-3.1-flash-lite-preview";
  if (model === "gemini-3-flash-preview") return "[福利]gemini-3-flash-preview";
  return model;
}

function toChunxueapiModelId(model: string): string {
  return model;
}

function toUglycatModelId(model: string): string {
  return model;
}

// ── zhipu (open.bigmodel.cn, OpenAI Chat compat at /api/paas/v4) ──
const ZHIPU_BASE_URL = (
  Deno.env.get("ZHIPU_BASE_URL") || "https://open.bigmodel.cn/api/paas/v4"
).replace(/\/$/, "");
const ZHIPU_API_KEY = Deno.env.get("ZHIPU_API_KEY") || "";

function isZhipuModel(model: string): boolean {
  return model === "glm-4.7" || model === "glm-4.7-flash";
}

function toZhipuModelId(model: string): string {
  return model;
}

// ── mistral (api.mistral.ai, OpenAI Chat compat) ──
const MISTRAL_BASE_URL = (
  Deno.env.get("MISTRAL_BASE_URL") || "https://api.mistral.ai/v1"
).replace(/\/$/, "");
const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY") || "";

function isMistralModel(model: string): boolean {
  return (
    model === "mistral-medium-3-5" ||
    model === "mistral-small-2603" ||
    model === "mistral-large-2512" ||
    model === "ministral-14b-2512"
  );
}

function toMistralModelId(model: string): string {
  return model;
}


type ProviderKind =
  | "modelscope"
  | "dashscope"
  | "siliconflow"
  | "futureppo"
  | "sensenova"
  | "iamhc"
  | "tokenflux"
  | "freeapi"
  | "pwcen"
  | "xiangluapi"
  | "gemai"
  | "api456"
  | "chshapi"
  | "xem8k5"
  | "newapi_qwqtao"
  | "freeapi_dgbmc"
  | "piexian"
  | "orbitai"
  | "orbitaicc"
  | "uglycat"
  | "cxyquan"
  | "sparkcode"
  | "chunxueapi"
  | "univibe"
  | "supxh"
  | "mimo"
  | "openrouter"
  | "cpass"
  | "freemodel"
  | "dialoguedui"
  | "uu6top"
  | "coderelay"
  | "anthropic"
  | "qnaigc"
  | "chatapi4"
  | "beijixingxing"
  | "zhipu"
  | "mistral"
  | "ai121628"
  | "aiionly"
  | "hhhl"
  | "aspirin"
  | "aistudio"
  | "tokaify"
  | "txt180"
  | "pqgpt"
  | "clawto"
  | "cloudflare"
;

type PublicModelRoute = {
  upstreamId: string;
  brand: string;
  canonicalId: string;
  lineLabel: string;
  visible: boolean;
  enabled: boolean;
  arena: boolean;
};

const PUBLIC_MODEL_ROUTES: Record<string, PublicModelRoute> = {
  // 2026-05-18：mimo-v2.5-tts 是文本→语音合成 utility，不进 public catalog（visible:false），
  // 不进 arena。chat-gateway 通过 SERVER_MODEL_REGISTRY 同样以 visible:false 注册。
  // 上游域名 / 鉴权 header 在 provider="mimo" + isMimoTtsModel 分支里特殊处理。
  "mimo-v2.5-tts": { upstreamId: "mimo-v2.5-tts", brand: "小米 MiMo", canonicalId: "mimo-v2.5-tts", lineLabel: "xiaomimimo", visible: false, enabled: true, arena: false },
  "gemini-3.1-flash-lite-preview": { upstreamId: "gemini-3.1-flash-lite-preview", brand: "Google", canonicalId: "gemini-3.1-flash-lite-preview", lineLabel: "gemai.cc", visible: true, enabled: true, arena: true },
  "minimax-m2.7": { upstreamId: "minimax-m2.7", brand: "MiniMax", canonicalId: "minimax-m2.7", lineLabel: "beijixingxing", visible: true, enabled: true, arena: true },
  "gpt-5.4-mini": { upstreamId: "gpt-5.4-mini", brand: "OpenAI", canonicalId: "gpt-5.4-mini", lineLabel: "tokenflux", visible: true, enabled: true, arena: true },
  "gpt-5.4": { upstreamId: "gpt-5.4", brand: "OpenAI", canonicalId: "gpt-5.4", lineLabel: "tokaify", visible: true, enabled: true, arena: true },
  "gpt-4": { upstreamId: "gpt-5.4", brand: "OpenAI", canonicalId: "gpt-4", lineLabel: "iamhc", visible: true, enabled: true, arena: true },
  "step-3.5-flash": { upstreamId: "step-3.5-flash", brand: "Stepfun", canonicalId: "step-3.5-flash", lineLabel: "iamhc", visible: true, enabled: true, arena: true },
  "minimax-m2.5": { upstreamId: "minimax-m2.5", brand: "MiniMax", canonicalId: "minimax-m2.5", lineLabel: "uglycat", visible: true, enabled: true, arena: true },
  "claude-opus-4-6": { upstreamId: "claude-opus-4-6", brand: "Anthropic", canonicalId: "claude-opus-4-6", lineLabel: "aspirin", visible: true, enabled: true, arena: true },
  "claude-opus-4-7": { upstreamId: "claude-opus-4-7", brand: "Anthropic", canonicalId: "claude-opus-4-7", lineLabel: "aspirin", visible: true, enabled: true, arena: true },
  "claude-sonnet-4-6": { upstreamId: "claude-sonnet-4-6", brand: "Anthropic", canonicalId: "claude-sonnet-4-6", lineLabel: "aspirin", visible: true, enabled: true, arena: true },
  "grok-4.20-0309": { upstreamId: "grok-4.20-0309", brand: "xAI", canonicalId: "grok-4.20-0309", lineLabel: "dgbmc", visible: true, enabled: true, arena: true },
  "grok-4.3": { upstreamId: "grok-4.3", brand: "xAI", canonicalId: "grok-4.3", lineLabel: "gemai.cc", visible: true, enabled: true, arena: true },
  "grok-imagine-image-lite": { upstreamId: "grok-imagine-image-lite", brand: "xAI", canonicalId: "grok-imagine-image-lite", lineLabel: "dgbmc", visible: true, enabled: true, arena: false },
  "gpt-image-2-all": { upstreamId: "gpt-image-2-all", brand: "OpenAI", canonicalId: "gpt-image-2-all", lineLabel: "tokaify", visible: true, enabled: true, arena: false },
  "gpt-image-2-pro": { upstreamId: "gpt-image-2-pro", brand: "OpenAI", canonicalId: "gpt-image-2-pro", lineLabel: "gemai.cc", visible: true, enabled: true, arena: false },
  "gpt-5.3-codex": { upstreamId: "gpt-5.3-codex", brand: "OpenAI", canonicalId: "gpt-5.3-codex", lineLabel: "pie-xian", visible: true, enabled: true, arena: true },
  "gpt-5.2": { upstreamId: "gpt-5.2", brand: "OpenAI", canonicalId: "gpt-5.2", lineLabel: "uu6", visible: true, enabled: true, arena: true },
  "claude-haiku-4-5-20251001-thinking": { upstreamId: "claude-haiku-4-5-20251001-thinking", brand: "Anthropic", canonicalId: "claude-haiku-4-5-20251001-thinking", lineLabel: "aspirin", visible: true, enabled: true, arena: true },
  "doubao-1.5-pro": { upstreamId: "doubao-1.5-pro", brand: "Doubao", canonicalId: "doubao-1.5-pro", lineLabel: "pie-xian", visible: true, enabled: true, arena: true },
  "kimi-k2.6": { upstreamId: "kimi-k2.6", brand: "Moonshot", canonicalId: "kimi-k2.6", lineLabel: "pie-xian", visible: true, enabled: true, arena: true },
  "claude-haiku-4-5-20251001": { upstreamId: "claude-haiku-4-5-20251001", brand: "Anthropic", canonicalId: "claude-haiku-4-5-20251001", lineLabel: "aspirin", visible: true, enabled: true, arena: true },
  // 2026-05-18: GPT-5.5 swap.
  //   • canonical gpt-5.5  (displayName "GPT-5.5")      → new.pwcen.cn (provider=pwcen), upstream id "gpt-5-5".
  //   • canonical gpt-5.5-high (displayName "GPT-5.5 High") → freemodel.dev (provider=freemodel), upstream id "gpt-5.5".
  // 旧 hhhl 线下线（isHhhlModel 已返回 false）。
  "gpt-5.5": { upstreamId: "gpt-5-5", brand: "OpenAI", canonicalId: "gpt-5.5", lineLabel: "pwcen", visible: true, enabled: true, arena: true },
  "gpt-5.5-high": { upstreamId: "gpt-5.5", brand: "OpenAI", canonicalId: "gpt-5.5-high", lineLabel: "freemodel", visible: true, enabled: true, arena: true },
  "gpt-5.5-welfare": { upstreamId: "gpt-5.5", brand: "OpenAI", canonicalId: "gpt-5.5-welfare", lineLabel: "freemodel", visible: true, enabled: true, arena: false },
  "gpt-5.5-xhigh": { upstreamId: GPT55_XHIGH_UU6TOP_MODEL_ID, brand: "OpenAI", canonicalId: "gpt-5.5-xhigh", lineLabel: "uu6", visible: true, enabled: true, arena: false },
  "deepseek-v4-flash": { upstreamId: "deepseek-v4-flash", brand: "DeepSeek", canonicalId: "deepseek-v4-flash", lineLabel: "sensenova", visible: true, enabled: true, arena: true },
  "deepseek-v4-pro": { upstreamId: "deepseek-v4-pro", brand: "DeepSeek", canonicalId: "deepseek-v4-pro", lineLabel: "modelscope", visible: true, enabled: true, arena: true },
  // 2026-05-18: gemini-3.1-pro 切换到 supxh.xin（取消 api456 路由）。
  // SUPXH_CLAUDE_API_KEY (= sk-MK5O…) 同时承载 claude-opus-4-5 与 gemini-3.1-pro，
  // 由 getSupxhKeyPool 把这个 key 加入 gemini-3.1-pro 的池子。
  "gemini-3.1-pro": { upstreamId: "gemini-3.1-pro", brand: "Google", canonicalId: "gemini-3.1-pro", lineLabel: "supxh", visible: true, enabled: true, arena: true },
  "gpt-5.3-codex-spark": { upstreamId: "gpt-5.3-codex-spark", brand: "OpenAI", canonicalId: "gpt-5.3-codex-spark", lineLabel: "api456", visible: true, enabled: true, arena: true },
  "glm-5.1": { upstreamId: "ZhipuAI/GLM-5.1", brand: "Zhipu", canonicalId: "glm-5.1", lineLabel: "modelscope", visible: true, enabled: true, arena: true },
  "ling-2.6-flash": { upstreamId: "inclusionAI/Ling-2.6-flash", brand: "Inclusion AI", canonicalId: "ling-2.6-flash", lineLabel: "modelscope", visible: true, enabled: true, arena: false },
  "ling-2.6-1t": { upstreamId: "inclusionAI/Ling-2.6-1T", brand: "Inclusion AI", canonicalId: "ling-2.6-1t", lineLabel: "modelscope", visible: true, enabled: true, arena: true },
  "deepseek-v3": { upstreamId: "deepseek-v3", brand: "DeepSeek", canonicalId: "deepseek-v3", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "deepseek-v3.2-exp": { upstreamId: "deepseek-v3.2-exp", brand: "DeepSeek", canonicalId: "deepseek-v3.2-exp", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "deepseek-r1-0528": { upstreamId: "deepseek-r1-0528", brand: "DeepSeek", canonicalId: "deepseek-r1-0528", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "deepseek-r1": { upstreamId: "deepseek-r1", brand: "DeepSeek", canonicalId: "deepseek-r1", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "deepseek-v3.1": { upstreamId: "deepseek-v3.1", brand: "DeepSeek", canonicalId: "deepseek-v3.1", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "deepseek-v3.2": { upstreamId: "deepseek-v3.2", brand: "DeepSeek", canonicalId: "deepseek-v3.2", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.6-flash": { upstreamId: "qwen3.6-flash", brand: "Qwen", canonicalId: "qwen3.6-flash", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.5-flash-2026-02-23": { upstreamId: "qwen3.5-flash-2026-02-23", brand: "Qwen", canonicalId: "qwen3.5-flash-2026-02-23", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.5-plus-2026-04-20": { upstreamId: "qwen3.5-plus-2026-04-20", brand: "Qwen", canonicalId: "qwen3.5-plus-2026-04-20", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.5-plus-2026-02-15": { upstreamId: "qwen3.5-plus-2026-02-15", brand: "Qwen", canonicalId: "qwen3.5-plus-2026-02-15", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.6-max-preview": { upstreamId: "qwen3.6-max-preview", brand: "Qwen", canonicalId: "qwen3.6-max-preview", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.5-397b-a17b": { upstreamId: "qwen3.5-397b-a17b", brand: "Qwen", canonicalId: "qwen3.5-397b-a17b", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.6-plus-2026-04-02": { upstreamId: "qwen3.6-plus-2026-04-02", brand: "Qwen", canonicalId: "qwen3.6-plus-2026-04-02", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.5-plus": { upstreamId: "qwen3.5-plus", brand: "Qwen", canonicalId: "qwen3.5-plus", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.6-flash-2026-04-16": { upstreamId: "qwen3.6-flash-2026-04-16", brand: "Qwen", canonicalId: "qwen3.6-flash-2026-04-16", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen-max": { upstreamId: "qwen-max", brand: "Qwen", canonicalId: "qwen-max", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3-max-preview": { upstreamId: "qwen3-max-preview", brand: "Qwen", canonicalId: "qwen3-max-preview", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "MiniMax-M2.1": { upstreamId: "MiniMax-M2.1", brand: "MiniMax", canonicalId: "MiniMax-M2.1", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3-max": { upstreamId: "qwen3-max", brand: "Qwen", canonicalId: "qwen3-max", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen-vl-max": { upstreamId: "qwen-vl-max", brand: "Qwen", canonicalId: "qwen-vl-max", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "kimi-k2.5": { upstreamId: "kimi-k2.5", brand: "Moonshot", canonicalId: "kimi-k2.5", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "kimi-k2-thinking": { upstreamId: "kimi-k2-thinking", brand: "Moonshot", canonicalId: "kimi-k2-thinking", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "Moonshot-Kimi-K2-Instruct": { upstreamId: "Moonshot-Kimi-K2-Instruct", brand: "Moonshot", canonicalId: "Moonshot-Kimi-K2-Instruct", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "glm-4.5-air": { upstreamId: "glm-4.5-air", brand: "Zhipu", canonicalId: "glm-4.5-air", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "glm-4.5": { upstreamId: "glm-4.5", brand: "Zhipu", canonicalId: "glm-4.5", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "glm-4.6": { upstreamId: "glm-4.6", brand: "Zhipu", canonicalId: "glm-4.6", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3-coder-plus-2025-07-22": { upstreamId: "qwen3-coder-plus-2025-07-22", brand: "Qwen", canonicalId: "qwen3-coder-plus-2025-07-22", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3-coder-next": { upstreamId: "qwen3-coder-next", brand: "Qwen", canonicalId: "qwen3-coder-next", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen-coder-plus": { upstreamId: "qwen-coder-plus", brand: "Qwen", canonicalId: "qwen-coder-plus", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen-coder-turbo": { upstreamId: "qwen-coder-turbo", brand: "Qwen", canonicalId: "qwen-coder-turbo", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3-coder-flash-2025-07-28": { upstreamId: "qwen3-coder-flash-2025-07-28", brand: "Qwen", canonicalId: "qwen3-coder-flash-2025-07-28", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "tongyi-xiaomi-analysis-pro": { upstreamId: "tongyi-xiaomi-analysis-pro", brand: "Qwen", canonicalId: "tongyi-xiaomi-analysis-pro", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "gui-plus": { upstreamId: "gui-plus", brand: "Qwen", canonicalId: "gui-plus", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "qwen3.6-35b-a3b": { upstreamId: "qwen3.6-35b-a3b", brand: "Qwen", canonicalId: "qwen3.6-35b-a3b", lineLabel: "bailian", visible: true, enabled: true, arena: true },
  "wan2.7-t2v": { upstreamId: "wan2.7-t2v", brand: "Wan", canonicalId: "wan2.7-t2v", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.6-t2v": { upstreamId: "wan2.6-t2v", brand: "Wan", canonicalId: "wan2.6-t2v", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.5-t2v-preview": { upstreamId: "wan2.5-t2v-preview", brand: "Wan", canonicalId: "wan2.5-t2v-preview", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.7-t2v-2026-04-25": { upstreamId: "wan2.7-t2v-2026-04-25", brand: "Wan", canonicalId: "wan2.7-t2v-2026-04-25", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.2-t2v-plus": { upstreamId: "wan2.2-t2v-plus", brand: "Wan", canonicalId: "wan2.2-t2v-plus", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.7-i2v": { upstreamId: "wan2.7-i2v", brand: "Wan", canonicalId: "wan2.7-i2v", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.6-i2v-flash": { upstreamId: "wan2.6-i2v-flash", brand: "Wan", canonicalId: "wan2.6-i2v-flash", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.6-i2v": { upstreamId: "wan2.6-i2v", brand: "Wan", canonicalId: "wan2.6-i2v", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.5-i2v-preview": { upstreamId: "wan2.5-i2v-preview", brand: "Wan", canonicalId: "wan2.5-i2v-preview", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.2-i2v-plus": { upstreamId: "wan2.2-i2v-plus", brand: "Wan", canonicalId: "wan2.2-i2v-plus", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.7-i2v-2026-04-25": { upstreamId: "wan2.7-i2v-2026-04-25", brand: "Wan", canonicalId: "wan2.7-i2v-2026-04-25", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.7-r2v": { upstreamId: "wan2.7-r2v", brand: "Wan", canonicalId: "wan2.7-r2v", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.6-r2v-flash": { upstreamId: "wan2.6-r2v-flash", brand: "Wan", canonicalId: "wan2.6-r2v-flash", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "wan2.6-r2v": { upstreamId: "wan2.6-r2v", brand: "Wan", canonicalId: "wan2.6-r2v", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "happyhorse-1.0-r2v": { upstreamId: "happyhorse-1.0-r2v", brand: "HappyHorse", canonicalId: "happyhorse-1.0-r2v", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "happyhorse-1.0-video-edit": { upstreamId: "happyhorse-1.0-video-edit", brand: "HappyHorse", canonicalId: "happyhorse-1.0-video-edit", lineLabel: "bailian", visible: true, enabled: true, arena: false },
  "doubao-seedance-2-0-260128": { upstreamId: "doubao-seedance-2-0-260128", brand: "Doubao", canonicalId: "doubao-seedance-2-0-260128", lineLabel: "aiionly", visible: true, enabled: true, arena: false },
  "veo-3.1-lite-generate-preview": { upstreamId: "veo-3.1-lite-generate-preview", brand: "Google", canonicalId: "veo-3.1-lite-generate-preview", lineLabel: "aiionly", visible: true, enabled: true, arena: false },
  "wan2.6-t2i": { upstreamId: "wan2.6-t2i", brand: "Wan", canonicalId: "wan2.6-t2i", lineLabel: "bailian", visible: false, enabled: true, arena: false },
  "wan2.5-t2i-preview": { upstreamId: "wan2.5-t2i-preview", brand: "Wan", canonicalId: "wan2.5-t2i-preview", lineLabel: "bailian", visible: false, enabled: true, arena: false },
  "z-image-turbo": { upstreamId: "z-image-turbo", brand: "Zhipu", canonicalId: "z-image-turbo", lineLabel: "bailian", visible: false, enabled: true, arena: false },
  "wanx-poster-generation-v1": { upstreamId: "wanx-poster-generation-v1", brand: "Wan", canonicalId: "wanx-poster-generation-v1", lineLabel: "bailian", visible: false, enabled: true, arena: false },
  "sensenova-6.7-flash-lite": { upstreamId: "sensenova-6.7-flash-lite", brand: "SenseNova", canonicalId: "sensenova-6.7-flash-lite", lineLabel: "sensenova", visible: true, enabled: true, arena: false },
  "sensenova-u1-fast": { upstreamId: "sensenova-u1-fast", brand: "SenseNova", canonicalId: "sensenova-u1-fast", lineLabel: "sensenova", visible: false, enabled: true, arena: false },
  "glm-4.7": { upstreamId: "glm-4.7", brand: "Zhipu", canonicalId: "glm-4.7", lineLabel: "zhipu", visible: true, enabled: true, arena: true },
  "glm-4.7-flash": { upstreamId: "glm-4.7-flash", brand: "Zhipu", canonicalId: "glm-4.7-flash", lineLabel: "zhipu", visible: true, enabled: true, arena: false },
  "mistral-medium-3-5": { upstreamId: "mistral-medium-3-5", brand: "Mistral", canonicalId: "mistral-medium-3-5", lineLabel: "mistral", visible: true, enabled: true, arena: true },
  "mistral-small-2603": { upstreamId: "mistral-small-2603", brand: "Mistral", canonicalId: "mistral-small-2603", lineLabel: "mistral", visible: true, enabled: true, arena: false },
  "mistral-large-2512": { upstreamId: "mistral-large-2512", brand: "Mistral", canonicalId: "mistral-large-2512", lineLabel: "mistral", visible: true, enabled: true, arena: true },
  "ministral-14b-2512": { upstreamId: "ministral-14b-2512", brand: "Mistral", canonicalId: "ministral-14b-2512", lineLabel: "mistral", visible: true, enabled: true, arena: false },
  "or:nvidia/nemotron-3-super-120b-a12b": { upstreamId: "nvidia/nemotron-3-super-120b-a12b:free", brand: "NVIDIA", canonicalId: "or:nvidia/nemotron-3-super-120b-a12b", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:inclusionai/ring-2.6-1t": { upstreamId: "inclusionai/ring-2.6-1t:free", brand: "InclusionAI", canonicalId: "or:inclusionai/ring-2.6-1t", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:openai/gpt-oss-120b": { upstreamId: "openai/gpt-oss-120b:free", brand: "OpenAI", canonicalId: "or:openai/gpt-oss-120b", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:nvidia/nemotron-3-nano-30b-a3b": { upstreamId: "nvidia/nemotron-3-nano-30b-a3b:free", brand: "NVIDIA", canonicalId: "or:nvidia/nemotron-3-nano-30b-a3b", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:openai/gpt-oss-20b": { upstreamId: "openai/gpt-oss-20b:free", brand: "OpenAI", canonicalId: "or:openai/gpt-oss-20b", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": { upstreamId: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", brand: "NVIDIA", canonicalId: "or:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:google/gemma-4-31b-it": { upstreamId: "google/gemma-4-31b-it:free", brand: "Google", canonicalId: "or:google/gemma-4-31b-it", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  // Google AI Studio free models (OpenAI-compatible endpoint)
  "gemini-2.5-flash": { upstreamId: "gemini-2.5-flash", brand: "Google", canonicalId: "gemini-2.5-flash", lineLabel: "aistudio", visible: true, enabled: true, arena: true },
  "gemini-3.5-flash-welfare": { upstreamId: "gemini-3.5-flash", brand: "Google", canonicalId: "gemini-3.5-flash-welfare", lineLabel: "aistudio", visible: true, enabled: true, arena: false },
  "gemini-2.5-flash-lite": { upstreamId: "gemini-2.5-flash-lite", brand: "Google", canonicalId: "gemini-2.5-flash-lite", lineLabel: "aistudio", visible: true, enabled: true, arena: true },
  "gemini-3.1-flash-lite-welfare": { upstreamId: "gemini-2.5-flash-lite", brand: "Google", canonicalId: "gemini-3.1-flash-lite-welfare", lineLabel: "aistudio", visible: true, enabled: true, arena: false },
  "gemini-3-flash-preview": { upstreamId: "gemini-3-flash-preview", brand: "Google", canonicalId: "gemini-3-flash-preview", lineLabel: "gemai.cc", visible: true, enabled: true, arena: true },
  "gemma-4-31b-it": { upstreamId: "gemma-4-31b-it", brand: "Google", canonicalId: "gemma-4-31b-it", lineLabel: "aistudio", visible: true, enabled: true, arena: false },
  "gemma-4-26b-a4b-it": { upstreamId: "gemma-4-26b-a4b-it", brand: "Google", canonicalId: "gemma-4-26b-a4b-it", lineLabel: "aistudio", visible: true, enabled: true, arena: false },
  "or:arcee-ai/trinity-large-thinking": { upstreamId: "arcee-ai/trinity-large-thinking:free", brand: "Arcee", canonicalId: "or:arcee-ai/trinity-large-thinking", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:google/gemma-4-26b-a4b-it": { upstreamId: "google/gemma-4-26b-a4b-it:free", brand: "Google", canonicalId: "or:google/gemma-4-26b-a4b-it", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:qwen/qwen3-coder": { upstreamId: "qwen/qwen3-coder:free", brand: "Qwen", canonicalId: "or:qwen/qwen3-coder", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:qwen/qwen3-next-80b-a3b-instruct": { upstreamId: "qwen/qwen3-next-80b-a3b-instruct:free", brand: "Qwen", canonicalId: "or:qwen/qwen3-next-80b-a3b-instruct", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  "or:meta-llama/llama-3.3-70b-instruct": { upstreamId: "meta-llama/llama-3.3-70b-instruct:free", brand: "Meta", canonicalId: "or:meta-llama/llama-3.3-70b-instruct", lineLabel: "openrouter", visible: true, enabled: true, arena: false },
  // Cloudflare Workers AI — free tier models
  "cf:phi-2": { upstreamId: "@cf/microsoft/phi-2", brand: "Microsoft", canonicalId: "cf:phi-2", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:gemma-2b-it": { upstreamId: "@cf/google/gemma-2b-it-lora", brand: "Google", canonicalId: "cf:gemma-2b-it", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:gemma-7b-it": { upstreamId: "@cf/google/gemma-7b-it-lora", brand: "Google", canonicalId: "cf:gemma-7b-it", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:llama-2-7b-chat": { upstreamId: "@cf/meta/llama-2-7b-chat-int8", brand: "Meta", canonicalId: "cf:llama-2-7b-chat", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:mistral-7b-instruct-v02": { upstreamId: "@cf/mistral/mistral-7b-instruct-v0.2-lora", brand: "Mistral", canonicalId: "cf:mistral-7b-instruct-v02", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:hermes-2-pro-mistral-7b": { upstreamId: "@hf/nousresearch/hermes-2-pro-mistral-7b", brand: "HuggingFace", canonicalId: "cf:hermes-2-pro-mistral-7b", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:llama-3.2-1b-instruct": { upstreamId: "@cf/meta/llama-3.2-1b-instruct", brand: "Meta", canonicalId: "cf:llama-3.2-1b-instruct", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:llama-3.2-3b-instruct": { upstreamId: "@cf/meta/llama-3.2-3b-instruct", brand: "Meta", canonicalId: "cf:llama-3.2-3b-instruct", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:granite-4.0-h-micro": { upstreamId: "@cf/ibm-granite/granite-4.0-h-micro", brand: "IBM", canonicalId: "cf:granite-4.0-h-micro", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:qwen3-30b-a3b": { upstreamId: "@cf/qwen/qwen3-30b-a3b-fp8", brand: "Qwen", canonicalId: "cf:qwen3-30b-a3b", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:glm-4.7-flash": { upstreamId: "@cf/zai-org/glm-4.7-flash", brand: "Zhipu", canonicalId: "cf:glm-4.7-flash", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  // Cloudflare Workers AI — free image generation models
  "cf:flux-2-dev": { upstreamId: "@cf/black-forest-labs/flux-2-dev", brand: "FLUX", canonicalId: "cf:flux-2-dev", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:flux-2-klein-4b": { upstreamId: "@cf/black-forest-labs/flux-2-klein-4b", brand: "FLUX", canonicalId: "cf:flux-2-klein-4b", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
  "cf:flux-2-klein-9b": { upstreamId: "@cf/black-forest-labs/flux-2-klein-9b", brand: "FLUX", canonicalId: "cf:flux-2-klein-9b", lineLabel: "cloudflare", visible: true, enabled: true, arena: false },
};

function getPublicModelRoute(model: string): PublicModelRoute | null {
  const clean = String(model || "").trim();
  return PUBLIC_MODEL_ROUTES[clean] || null;
}

// ───────────────────────────────────────────────────────────────────────
// FREE/PAID 档位推断（2026-05-17 配额系统）
//
// 单一权威源：下面两个 ReadonlySet。不在 PUBLIC_MODEL_ROUTES 表里逐条
// 加字段，因为：
//   1) routes 表 100+ 行，逐条加 `costTier: 'free'` 噪声大、维护成本高
//   2) 推断规则简单（Anthropic 全系 + 精确 ID 表），用 Set 表达最自然
//   3) 与前端 chat\api\api-models-app.js 的 PAID_IDS 一对一对齐
//
// 规则（与前端 api-models-app.js 2026-05-17 注释字面一致）：
//   • brand === "Anthropic"             → PAID（Claude 全系，含未来子型）
//   • PAID_MODEL_IDS Set 内的精确 ID    → PAID
//   • 其余                              → FREE
//
// FREE_USER_BLOCKED_IDS：FREE 用户完全禁止调用（仅 GPT-5.5 系列）。
// 即使共享池有余、当日 25 次未满，FREE 用户调用这些 ID 也返回 403。
// ───────────────────────────────────────────────────────────────────────
const PAID_MODEL_IDS: ReadonlySet<string> = new Set<string>([
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.5-high",
  "gpt-5.3-codex",
  "gpt-5.2",
  "grok-4.20-0309",
  "grok-4.3",
  "mistral-large-2512",
  "gemini-3.1-pro",
  "gemini-3.1-pro-preview",
  "glm-5.1",
  "deepseek-v4-pro",
  "qwen3.6-max-preview",
  "minimax-m2.7",
  "kimi-k2.6",
  "gpt-image-2-all",
  "gpt-image-2-pro",
]);

// 2026-05-18: gpt-5.5 / gpt-5.5-high / gemini-3.1-pro 对 FREE 用户硬挡
const FREE_USER_BLOCKED_IDS: ReadonlySet<string> = new Set<string>([
  "gpt-5.4-mini",
  "gpt-5.5",
  "gpt-5.5-high",
  "grok-4.3",
  "gemini-3.1-pro",
  "gpt-image-2-all",
  "gpt-image-2-pro",
]);

function getModelCostTier(route: PublicModelRoute | null): 'free' | 'paid' {
  if (!route) return 'free';
  if (route.brand === 'Anthropic') return 'paid';
  if (PAID_MODEL_IDS.has(route.canonicalId)) return 'paid';
  return 'free';
}

function isModelFreeUserBlocked(route: PublicModelRoute | null): boolean {
  if (!route) return false;
  return FREE_USER_BLOCKED_IDS.has(route.canonicalId);
}

// 给外部调用方（chat-gateway / api-gateway）暴露 catalog 数据时附加 costTier。
// 这是 chat-gateway 的 `model_public_catalog` endpoint 返回每条 model 的字段，
// 前端 api_models.html 据此渲染 PAID/FREE badge。
function publicRouteToCatalogEntry(modelId: string, route: PublicModelRoute): Record<string, unknown> {
  return {
    id: modelId,
    canonicalId: route.canonicalId,
    upstreamId: route.upstreamId,
    brand: route.brand,
    lineLabel: route.lineLabel,
    visible: route.visible,
    enabled: route.enabled,
    arena: route.arena,
    costTier: getModelCostTier(route),
    freeUserBlocked: isModelFreeUserBlocked(route),
  };
}

function resolvePublicModelId(model: string): string {
  const route = getPublicModelRoute(model);
  if (!route || route.enabled === false) return "";
  return route.upstreamId;
}

function isFuturePpoModel(model: string): boolean {
  return model.startsWith(FUTUREPPO_MODEL_PREFIX);
}

function toFuturePpoModelId(model: string): string {
  return model.startsWith(FUTUREPPO_MODEL_PREFIX)
    ? model.slice(FUTUREPPO_MODEL_PREFIX.length)
    : model;
}

function getFuturePpoApiKey(model: string): string {
  void model;
  return FUTUREPPO_API_KEY;
}

function isDashScopeCompatibleModel(model: string): boolean {
  const dashScopeModels = [
    "MiniMax-M2.1",
    "Moonshot-Kimi-K2-Instruct",
    "deepseek-r1",
    "deepseek-r1-0528",
    "deepseek-v3",
    "deepseek-v3.1",
    "deepseek-v3.2",
    "deepseek-v3.2-exp",
    "glm-4.5",
    "glm-4.5-air",
    "glm-4.6",
    "gui-plus",
    "happyhorse-1.0-r2v",
    "happyhorse-1.0-video-edit",
    "kimi-k2-thinking",
    "kimi-k2.5",
    "qwen-coder-plus",
    "qwen-coder-turbo",
    "qwen-max",
    "qwen-vl-max",
    "qwen3-coder-flash-2025-07-28",
    "qwen3-coder-next",
    "qwen3-coder-plus-2025-07-22",
    "qwen3-max",
    "qwen3-max-preview",
    "qwen3.5-397b-a17b",
    "qwen3.5-flash-2026-02-23",
    "qwen3.5-plus",
    "qwen3.5-plus-2026-02-15",
    "qwen3.5-plus-2026-04-20",
    "qwen3.6-35b-a3b",
    "qwen3.6-flash",
    "qwen3.6-flash-2026-04-16",
    "qwen3.6-max-preview",
    "qwen3.6-plus-2026-04-02",
    "tongyi-xiaomi-analysis-pro",
    "wan2.2-i2v-plus",
    "wan2.2-t2v-plus",
    "wan2.5-i2v-preview",
    "wan2.5-t2i-preview",
    "wan2.5-t2v-preview",
    "wan2.6-i2v",
    "wan2.6-i2v-flash",
    "wan2.6-r2v",
    "wan2.6-r2v-flash",
    "wan2.6-t2i",
    "wan2.6-t2v",
    "wan2.7-i2v",
    "wan2.7-i2v-2026-04-25",
    "wan2.7-r2v",
    "wan2.7-t2v",
    "wan2.7-t2v-2026-04-25",
    "wanx-poster-generation-v1",
    "z-image-turbo",
  ];
  return (
    dashScopeModels.includes(model) ||
    isDashScopeVideoModel(model) ||
    isDashScopeImageModel(model)
  );
}

// All DashScope async video models (HappyHorse 1.0 i2v/t2v/r2v + Wan 2.7 t2v)
// live on the same async video-synthesis endpoint. `getProviderKind()` MUST
// resolve every video model id to "dashscope" or the request gets routed
// through the ModelScope key check and fails with `MODELSCOPE_API_KEY missing`
// even though it's a DashScope call.
function isDashScopeVideoModel(model: string): boolean {
  return (
    // Text-to-video
    model === "wan2.7-t2v" ||
    model === "wan2.6-t2v" ||
    model === "wan2.5-t2v-preview" ||
    model === "wan2.7-t2v-2026-04-25" ||
    model === "wan2.2-t2v-plus" ||
    // Image-to-video
    model === "wan2.7-i2v" ||
    model === "wan2.6-i2v-flash" ||
    model === "wan2.6-i2v" ||
    model === "wan2.5-i2v-preview" ||
    model === "wan2.2-i2v-plus" ||
    model === "wan2.7-i2v-2026-04-25" ||
    // Reference-to-video
    model === "wan2.7-r2v" ||
    model === "wan2.6-r2v-flash" ||
    model === "wan2.6-r2v" ||
    model === "happyhorse-1.0-r2v" ||
    // Video editing
    model === "happyhorse-1.0-video-edit"
  );
}

function isAiionlyVideoModel(model: string): boolean {
  return (
    model === "doubao-seedance-2-0-260128" ||
    model === "veo-3.1-lite-generate-preview"
  );
}

// Sync DashScope multimodal-generation endpoint models (image-gen / image-edit).
// Verified 2026-05-13 via direct /multimodal-generation/generation probes:
//   wan2.6-t2i        ✅ 200
//   z-image-turbo     ✅ 200
// The following 2 need the ASYNC text2image/image-synthesis endpoint + polling,
// which the current sync `endpoint: "image"` branch doesn't cover — they are
// registered in PUBLIC_MODEL_ROUTES with `enabled: false` until the async
// image flow is wired:
//   wan2.5-t2i-preview          (async via /text2image/image-synthesis)
//   wanx-poster-generation-v1   (async via /text2image/image-synthesis)
function isDashScopeImageModel(model: string): boolean {
  return (
    model === "wan2.6-t2i" ||
    model === "z-image-turbo"
  );
}

// ASYNC DashScope image models — submit to /text2image/image-synthesis
// with X-DashScope-Async: enable, then poll /api/v1/tasks/<id> until the
// task reports SUCCEEDED and yields image URLs. Used for:
//   wan2.5-t2i-preview         (standard t2i, input: {prompt, size})
//   wanx-poster-generation-v1  (poster, input: {title, sub_title, body_text, prompt_text_zh, wh_ratios})
// The poll loop runs on the edge function (Supabase caps each request at
// ~150s, so the UX caller sees a single blocking image call that matches
// the OpenAI {data:[{url}]} contract, no separate task endpoint needed).
function isDashScopeAsyncImageModel(model: string): boolean {
  return (
    model === "wan2.5-t2i-preview" ||
    model === "wanx-poster-generation-v1"
  );
}

// Every line in this set is *only* wired to an image-generation endpoint —
// driving one through /v1/chat/completions would hit the image upstream
// with a bogus payload and produce a confusing upstream 4xx. We reject
// that cross-endpoint mismatch ourselves (with a sanitized 400) rather
// than letting the user see a leaked upstream shape. The list matches
// every line PUBLIC_MODEL_ROUTES flags as image-only.
const IMAGE_ONLY_MODEL_IDS = new Set<string>([
  "gpt-image-2-all",
  "gpt-image-2-pro",
  "wan2.6-t2i",
  "wan2.5-t2i-preview",
  "z-image-turbo",
  "wanx-poster-generation-v1",
  "sensenova-u1-fast",
  "grok-imagine-image-lite",
]);

// Video-only lines. Same rationale as IMAGE_ONLY_MODEL_IDS: mismatches
// produce our own error instead of leaking upstream error shapes.
const VIDEO_ONLY_MODEL_IDS = new Set<string>([
  "happyhorse-1.0-r2v",
  "happyhorse-1.0-video-edit",
  "wan2.7-t2v",
  "doubao-seedance-2-0-260128",
  "veo-3.1-lite-generate-preview",
]);

function isImageOnlyUpstreamModel(
  canonicalOrLine: string,
  resolvedUpstream: string,
): boolean {
  return (
    IMAGE_ONLY_MODEL_IDS.has(canonicalOrLine) ||
    (resolvedUpstream ? IMAGE_ONLY_MODEL_IDS.has(resolvedUpstream) : false)
  );
}

function isVideoOnlyUpstreamModel(
  canonicalOrLine: string,
  resolvedUpstream: string,
): boolean {
  return (
    VIDEO_ONLY_MODEL_IDS.has(canonicalOrLine) ||
    (resolvedUpstream ? VIDEO_ONLY_MODEL_IDS.has(resolvedUpstream) : false)
  );
}

// DashScope media key picker. HappyHorse can use a dedicated key; other media
// lines use the shared video key, then the legacy Wan key, then chat keys.
function pickDashScopeVideoApiKey(model: string): string {
  if (model.startsWith("happyhorse-") && DASHSCOPE_HAPPYHORSE_API_KEY) {
    return DASHSCOPE_HAPPYHORSE_API_KEY;
  }
  return (
    DASHSCOPE_VIDEO_API_KEY ||
    DASHSCOPE_WAN_API_KEY ||
    pickDashScopeApiKey(model)
  );
}

function dashScopeVideoKeyEnvName(_model: string): string {
  if (_model.startsWith("happyhorse-")) return "DASHSCOPE_HAPPYHORSE_API_KEY";
  return "DASHSCOPE_VIDEO_API_KEY";
}

function toDashScopeModelId(model: string): string {
  const modelMap: Record<string, string> = {
    "minimax-m2.5-dashscope": "minimax/MiniMax-M2.5",
    "minimax-m2.1-dashscope": "minimax/MiniMax-M2.1",
    "kimi-k2-thinking-dashscope": "kimi-k2-thinking",
    "moonshot-kimi-k2-instruct-dashscope": "Moonshot-Kimi-K2-Instruct",
    "kimi-k2.5-dashscope": "kimi-k2.5",
    "glm-4.6-dashscope": "glm-4.6",
    "glm-4.5-dashscope": "glm-4.5",
    "deepseek-v3-dashscope": "deepseek-v3",
    "qwen3.6-flash-2026-04-16-dashscope": "qwen3.6-flash-2026-04-16",
    "qwen3.6-plus-2026-04-02-dashscope": "qwen3.6-plus-2026-04-02",
    "qwen3.6-plus-20260402": "qwen3.6-plus-2026-04-02",
    "moonshot-kimi-k2-instruct": "Moonshot-Kimi-K2-Instruct",
  };
  return modelMap[model] || model;
}

function expandProviderKeys(keys: string[]): string[] {
  return keys.flatMap((key) =>
    key
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function uniqueProviderKeys(keys: string[]): string[] {
  return Array.from(new Set(expandProviderKeys(keys)));
}

function getDashScopeKeyPool(model: string): string[] {
  return uniqueProviderKeys([
    DASHSCOPE_API_KEY,
    DASHSCOPE_API_KEY_1,
    DASHSCOPE_API_KEY_2,
  ]);
}

function pickDashScopeApiKey(model: string): string {
  if (model === "glm-5" && DASHSCOPE_GLM5_API_KEY) return DASHSCOPE_GLM5_API_KEY;
  const keys = getDashScopeKeyPool(model);
  if (!keys.length) return "";
  const key = keys[dashScopeKeyCursor % keys.length] || "";
  dashScopeKeyCursor = (dashScopeKeyCursor + 1) % Math.max(keys.length, 1);
  return key;
}

function getDashScopeMissingKeys(model?: string): string[] {
  if (model === "glm-5") return ["DASHSCOPE_GLM5_API_KEY"];
  return ["DASHSCOPE_API_KEY or DASHSCOPE_API_KEY_1 or DASHSCOPE_API_KEY_2"];
}

function isSiliconFlowModel(model: string): boolean {
  return false;
}

function isMimoModel(model: string): boolean {
  // 2026-05-18：重新启用。mimo-v2.5-tts 走 mimo provider 分支（加 isMimoTtsModel 进一步
  // 路由到 xiaomimimo 上游）。mimo-v2.5-pro / mimo-v2.5 聊天模型仍众 modelscope.cn，
  // 略过该函数仅释放 TTS，其他路由走原有路径。
  return model === "mimo-v2.5-tts";
}

function isMimoTtsModel(model: string): boolean {
  // 2026-05-18：重新启用（原来全是死代码返 false）。 mimo-v2.5-tts 是语音合成
  // 主模型（预置音色），VoiceDesign / VoiceClone 变体仍未接入。
  return model === "mimo-v2.5-tts";
}

function pickMimoApiKey(model: string): string {
  return isMimoTtsModel(model) ? MIMO_TTS_API_KEY : MIMO_API_KEY;
}

function isSenseNovaModel(model: string): boolean {
  return (
    model === "deepseek-v4-flash" ||
    model === "sensenova-6.7-flash-lite" ||
    model === "sensenova-u1-fast"
  );
}

function toSensenovaModelId(model: string): string {
  // Verified 2026-05-13: SenseNova accepts the bare lowercase canonical
  // ids (sensenova-6.7-flash-lite, deepseek-v4-flash) on the wire. Earlier
  // CamelCase guesses ("SenseNova-V6.7-Flash-Lite") returned 404 not_found.
  return model;
}

function isIamhcModel(model: string): boolean {
  return model === "gpt-4" || model === "step-3.5-flash";
}

function pickIamhcApiKey(): string {
  return IAMHC_API_KEY;
}

function isTokenfluxModel(model: string): boolean {
  return model === "gpt-5.4-mini";
}

function isFreeapiModel(model: string): boolean {
  return false;
}

function isChshapiModel(model: string): boolean {
  return false;
}

function isFreeModelModel(model: string): boolean {
  return model === "gpt-5.5-high" || model === "gpt-5.5-welfare";
}

function isHhhlModel(_model: string): boolean {
  // 2026-05-18: hhhl 线下线（gpt-5.5-high 切到 freemodel.dev）。保留死代码框架，
  // 不再有任何 canonical 走这条线；getProviderKind 的 isHhhlModel 分支永远不命中。
  return false;
}

function toHhhlModelId(model: string): string {
  return model;
}

function isAnthropicModel(model: string): boolean {
  return false;
}

function isXem8k5Model(model: string): boolean {
  return false;
}

// Returns the right xem8k5 bearer key for a given model.
function getXem8k5ApiKey(model: string): string {
  void model;
  return XEM8K5_API_KEY;
}

function toXem8k5ModelId(model: string): string {
  return model;
}

function isNewapiQwqtaoModel(model: string): boolean {
  return false;
}

// Translate frontend canonical id to the upstream model id at qwqtao.
// gemini-3.1-flash-lite-preview only ships with the `google/` prefix on this
// relay; gpt-5.4-mini and gemini-3.1-pro-preview accept the bare id;
// grok-4.3 ships only as `x-ai/grok-4.3`; gpt-5.4-nano ships only as
// `openai/gpt-5.4-nano`; gpt-5-mini accepts the bare id.
function toNewapiQwqtaoModelId(model: string): string {
  if (model === "gemini-3.1-flash-lite-preview")
    return "google/gemini-3.1-flash-lite-preview";
  if (model === "grok-4.3") return "x-ai/grok-4.3";
  if (model === "gpt-5.4-nano") return "openai/gpt-5.4-nano";
  return model;
}

function isOrbitaiModel(model: string): boolean {
  return false;
}

function isOrbitaiccModel(model: string): boolean {
  // 2026-05-13: doubao-seed-2-0-lite-260215 retired — orbitai.cc's doubao
  // key was invalid and user decided not to re-issue. Only gpt-5.4-mini
  // (line 2 of the cold-failover pool) remains on this provider.
  return model === "gpt-5.4-mini";
}

// ── Multi-upstream routing pools ─────────────────────────────────────
// Some models are served by multiple unrelated upstreams. We pick one at
// random per request for load balancing and resilience. Each pool entry
// references an existing provider id; if a provider's key is unset we
// drop it from the pool so the surviving line keeps serving.
//
// `wantStream` lets us exclude upstreams whose non-stream mode is broken.
// orbitai.cc returns `text/event-stream` and an empty payload regardless
// of the `stream` flag, so we only route to it when the client actually
// wants a stream. Non-stream traffic deterministically lands on qwqtao.
function pickPoolProvider(
  model: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _wantStream = true,
): ProviderKind | null {
  // Cold-failover groups (2026-05-13). For canonicals with multiple
  // upstreams, randomly pick one whose key is configured. The selected
  // provider is then routed by the standard endpoint branches below.
  if (model === "gpt-5.4-mini") {
    return "tokenflux";
  }
  // 2026-05-14: gpt-5.5 dual-provider cold-failover. freemodel.dev had
  // single-line saturation issues (KEY_2 never deployed); chunxueapi was
  // intended as the second upstream. **chunxueapi temporarily disabled**
  // for 5.5 because the account balance is ~¥0.004 and gpt-5.5 pre-charge
  // is ~¥0.18-0.78 per call — every request 403s with
  // `insufficient_user_quota`. Re-add to candidates once chunxueapi is
  // topped up. gpt-5.4 stays on chunxueapi (per-call ~¥0.01, balance still
  // covers a few requests) via the standard isChunxueapiModel path.
  // 2026-05-18: GPT-5.5 swap.
  //   • gpt-5.5      → new.pwcen.cn (provider=pwcen). 上游 model 改名 "gpt-5-5"（dash）by PUBLIC_MODEL_ROUTES.upstreamId。
  //   • gpt-5.5-high → freemodel.dev (provider=freemodel)，上游 model 仍是 "gpt-5.5"。
  if (model === "gpt-5.5") {
    if (PWCEN_API_KEY) return "pwcen";
    return null;
  }
  if (model === "gpt-5.5-high") {
    if (hasAnyFreemodelKey()) return "freemodel";
    return null;
  }
  if (model === "gpt-5.5-welfare") {
    if (hasFreemodelKeyForModel(model)) return "freemodel";
    return null;
  }
  if (model === "gpt-5.5-xhigh") {
    if (UU6TOP_GPT52_API_KEY) return "uu6top";
    return null;
  }
  // Google AI Studio free models
  if (model === "gemini-2.5-flash" || model === "gemini-2.5-flash-lite" ||
      model === "gemma-4-31b-it" ||
      model === "gemma-4-26b-a4b-it" || model === "gemini-3.5-flash-welfare" ||
      model === "gemini-3.1-flash-lite-welfare") {
    if (AISTUDIO_API_KEY) return "aistudio";
    return null;
  }
  if (model === "gpt-5.3-codex") {
    // dialoguedui 优先（piexian 端点不稳定，2026-05-18 成功率仅 60%）
    if (DIALOGUEDUI_API_KEY) return "dialoguedui";
    if (PIEXIAN_CODEX_API_KEY || PIEXIAN_API_KEY) return "piexian";
    return null;
  }
  // 2026-05-16: claude-opus-4-6 cold-failover. dgbmc is primary,
  // api456 is cold backup. If dgbmc key is missing, falls through
  // to isApi456Model which also routes claude-opus-4-6.
  //
  // 2026-05-17: bug fix. The previous 50/50 random pool produced
  // status=200/tokens_out=0 responses on ~half the calls because
  // api456 returns an empty SSE (just `data: [DONE]`) for this
  // model — a silent failure mode invisible to our SSE sanitizer
  // (no error frame to abort on; no content chunk to forward).
  // Front-end then shows "我刚刚没有拿到有效回复" while telemetry
  // logs status=200/tokens_in=0/tokens_out=0. Deterministic dgbmc
  // preference fixes this; api456 stays as cold backup only when
  // both dgbmc keys are blank (matches claude-opus-4-6-thinking /
  // claude-sonnet-4-6* routing, which never had this issue).
  if (model === "minimax-m2.5") {
    const candidates: ProviderKind[] = [];
    if (UGLYCAT_API_KEY) candidates.push("uglycat");
    if (MODELSCOPE_API_KEY_1 || MODELSCOPE_API_KEY_2) candidates.push("modelscope");
    if (pickOpenRouterApiKey()) candidates.push("openrouter");
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  if (model === "gpt-image-2-all") {
    if (TOKAIFY_GPT_IMAGE_2_API_KEY) return "tokaify";
    return null;
  }
  if (model === "kimi-k2.6") {
    // 2026-05-14: 加 ai.121628.xyz 作为冷备线 (provider="ai121628")。
    // pie-xian 仍为主线；两边并入随机池，单边账户故障时模型仍可用。
    const candidates: ProviderKind[] = [];
    if (PIEXIAN_DOUBAO_KIMI_API_KEY || PIEXIAN_API_KEY) candidates.push("piexian");
    if (AI121628_KIMI_K26_API_KEY) candidates.push("ai121628");
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  // 2026-05-19: deepseek-v4-flash 统一走 sensenova 线路（免费共享池）。
  // modelscope 线路已从池中移除。
  if (model === "glm-4.5-air") {
    const candidates: ProviderKind[] = [];
    if (DASHSCOPE_API_KEY || DASHSCOPE_API_KEY_1 || DASHSCOPE_API_KEY_2) candidates.push("dashscope");
    if (pickOpenRouterApiKey()) candidates.push("openrouter");
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  // glm-4.7 同时在「智谱直连」和「阿里云百炼」上线（进模型清单.md line
  // 118 + 186）。线路一智谱（自家 key 更稳）、线路二百炼。两边随机挑，
  // 避免单线挂了用户感知到 "不可用"。
  if (model === "glm-4.7") {
    const candidates: ProviderKind[] = [];
    if (ZHIPU_API_KEY) candidates.push("zhipu");
    if (DASHSCOPE_API_KEY || DASHSCOPE_API_KEY_1 || DASHSCOPE_API_KEY_2) candidates.push("dashscope");
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return null;
}

function isUglycatModel(model: string): boolean {
  return (
    model === "minimax-m2.5"
  );
}

function isOpenRouterModel(model: string): boolean {
  return (
    model === "glm-4.5-air" ||
    model === "minimax-m2.5" ||
    model === "or:arcee-ai/trinity-large-thinking" ||
    model === "or:google/gemma-4-26b-a4b-it" ||
    model === "or:google/gemma-4-31b-it" ||
    model === "or:inclusionai/ring-2.6-1t" ||
    model === "or:meta-llama/llama-3.3-70b-instruct" ||
    model === "or:nvidia/nemotron-3-nano-30b-a3b" ||
    model === "or:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning" ||
    model === "or:nvidia/nemotron-3-super-120b-a12b" ||
    model === "or:openai/gpt-oss-120b" ||
    model === "or:openai/gpt-oss-20b" ||
    model === "or:qwen/qwen3-coder" ||
    model === "or:qwen/qwen3-next-80b-a3b-instruct"
  );
}

function toOpenRouterModelId(model: string): string {
  if (model === "minimax-m2.5") return "minimax/minimax-m2.5:free";
  if (model === "glm-4.5-air") return "z-ai/glm-4.5-air:free";
  if (model.startsWith("or:")) return model.slice(3) + ":free";
  // Legacy "openrouter:" prefix kept for safety.
  if (model.startsWith("openrouter:")) return model.slice("openrouter:".length);
  return model;
}

function getOpenRouterKeyPool(): string[] {
  return uniqueProviderKeys([OPENROUTER_API_KEYS_RAW]);
}

function pickOpenRouterApiKey(): string {
  const keys = getOpenRouterKeyPool();
  if (!keys.length) return "";
  const now = Date.now();
  for (const [key, unblockAt] of openRouterBlockedKeys) {
    if (now >= unblockAt) openRouterBlockedKeys.delete(key);
  }
  for (let i = 0; i < keys.length; i++) {
    const idx = (openRouterKeyCursor + i) % keys.length;
    const key = keys[idx];
    if (!openRouterBlockedKeys.has(key)) {
      openRouterKeyCursor = (idx + 1) % keys.length;
      return key;
    }
  }
  let earliest = Infinity;
  let earliestKey = "";
  for (const [key, unblockAt] of openRouterBlockedKeys) {
    if (unblockAt < earliest) {
      earliest = unblockAt;
      earliestKey = key;
    }
  }
  return earliestKey || keys[0] || "";
}

function markOpenRouterKeyBlocked(key: string): void {
  if (!key) return;
  openRouterBlockedKeys.set(key, Date.now() + OPENROUTER_KEY_BLOCK_MS);
  trimMapIfNeeded(openRouterBlockedKeys);
}

function isCpassModel(model: string): boolean {
  return false;
}

function pickCpassApiKey(): string {
  const keys = [CPASS_API_KEY, CPASS_API_KEY_2].filter(Boolean);
  if (!keys.length) return "";
  const key = keys[cpassKeyCursor % keys.length] || "";
  cpassKeyCursor = (cpassKeyCursor + 1) % Math.max(keys.length, 1);
  return key;
}

function isCloudflareModel(model: string): boolean {
  return model.startsWith("cf:") || model.startsWith("@cf/") || model.startsWith("@hf/");
}

function isCxyquanModel(model: string): boolean {
  return false;
}

function isQnaigcModel(model: string): boolean {
  return false;
}

function toQnaigcModelId(model: string): string {
  if (model === "deepseek-v4-pro-qnaigc") return "deepseek/deepseek-v4-pro";
  return model;
}

function isSparkcodeModel(model: string): boolean {
  return false;
}

function isChunxueapiModel(model: string): boolean {
  return false;
}
function isUnivibeModel(model: string): boolean {
  return false;
}
function isSupxhModel(model: string): boolean {
  return model === "gemini-3.1-pro";
}
function isAspirinModel(model: string): boolean {
  return (
    model === "claude-opus-4-6" ||
    model === "claude-opus-4-7" ||
    model === "claude-sonnet-4-6" ||
    model === "claude-haiku-4-5-20251001" ||
    model === "claude-haiku-4-5-20251001-thinking"
  );
}
function isTokaifyModel(model: string): boolean {
  return model === "gpt-5.4" || model === "gpt-image-2-all";
}
function getSupxhKeyPool(model: string): string[] {
  // 2026-05-18: SUPXH_CLAUDE_API_KEY (= sk-MK5O…) 同账号同时承载 claude-opus-4-5 与
  // gemini-3.1-pro，所以两者共用同一把 key 进池。SUPXH_API_KEYS_RAW 是可选的旧式逗号
  // 列表，留作管理员手动追加。
  const sharedKey =
    model === "gemini-3.1-pro"
      ? SUPXH_CLAUDE_API_KEY
      : "";
  return uniqueProviderKeys([
    SUPXH_API_KEYS_RAW,
    sharedKey,
  ]);
}
function pickSupxhApiKey(model: string): string {
  const keys = getSupxhKeyPool(model);
  if (!keys.length) return "";
  const now = Date.now();
  for (const [key, unblockAt] of supxhBlockedKeys) {
    if (now >= unblockAt) supxhBlockedKeys.delete(key);
  }
  for (let i = 0; i < keys.length; i++) {
    const idx = (supxhKeyCursor + i) % keys.length;
    const key = keys[idx];
    if (!supxhBlockedKeys.has(key)) {
      supxhKeyCursor = (idx + 1) % keys.length;
      return key;
    }
  }
  let earliest = Infinity;
  let earliestKey = "";
  for (const [key, unblockAt] of supxhBlockedKeys) {
    if (unblockAt < earliest) {
      earliest = unblockAt;
      earliestKey = key;
    }
  }
  return earliestKey || keys[0] || "";
}
function markSupxhKeyBlocked(key: string): void {
  if (!key) return;
  supxhBlockedKeys.set(key, Date.now() + SUPXH_KEY_BLOCK_MS);
  trimMapIfNeeded(supxhBlockedKeys);
}

function isPwcenModel(model: string): boolean {
  return false;
}

function isTxt180Model(model: string): boolean {
  return false;
}

function isAiStudioModel(model: string): boolean {
  return false;
}

function isXiangluapiModel(model: string): boolean {
  return false;
}

function isGemaiModel(model: string): boolean {
  return (
    model === "gemini-3.1-flash-lite-preview" ||
    model === "gemini-3-flash-preview" ||
    model === "[福利]gemini-3-flash-preview" ||
    model === "grok-4.3" ||
    model === "gpt-image-2-pro"
  );
}

function isApi456Model(model: string): boolean {
  // 2026-05-18: gemini-3.1-pro 已切到 supxh.xin，不再走 api456。
  return model === "gpt-5.3-codex-spark";
}

function toApi456ModelId(model: string): string {
  return model;
}

function isCodeRelayModel(_model: string): boolean {
  return false;
}

function isUu6TopModel(model: string): boolean {
  return model === "gpt-5.2" || model === "gpt-5.5-xhigh";
}

function pickUu6TopApiKey(model: string): string {
  if (model === "gpt-5.2" || model === "gpt-5.5-xhigh") return UU6TOP_GPT52_API_KEY;
  return "";
}

function uu6TopKeyEnvName(model: string): string {
  if (model === "gpt-5.2" || model === "gpt-5.5-xhigh") return "UU6TOP_GPT52_API_KEY";
  return "UU6TOP_API_KEY";
}

function toUu6TopModelId(model: string): string {
  if (model === "gpt-5.5-xhigh") return GPT55_XHIGH_UU6TOP_MODEL_ID || "gpt-5.2";
  return model;
}

function toChshapiModelId(model: string): string {
  if (model === "gpt-5.2") return "gpt-5.2";
  return model;
}

function toSiliconflowModelId(model: string): string {
  if (model === "kimi-k2.6-siliconflow") return "Pro/moonshotai/Kimi-K2.6";
  if (model === "glm-4.7-siliconflow") return "Pro/zai-org/GLM-4.7";
  if (model === "step-3.5-flash-siliconflow")
    return "stepfun-ai/Step-3.5-Flash";
  return model;
}

function pickApi456ApiKey(): string {
  const keys = uniqueProviderKeys([
    API456_API_KEY,
    API456_API_KEY_2,
    API456_API_KEY_3,
  ]);
  if (!keys.length) return "";
  const key = keys[api456KeyCursor % keys.length] || "";
  api456KeyCursor = (api456KeyCursor + 1) % Math.max(keys.length, 1);
  return key;
}

function getProviderKind(
  model: string,
  resolvedModel?: string,
  wantStream = true,
): ProviderKind {
  const pooled = pickPoolProvider(model, wantStream);
  if (pooled) return pooled;
  // 2026-05-12: pie-xian must win over dashscope / xem8k5 / freeapi_dgbmc
  // for glm-5.1 / kimi-k2.6 / minimax-m2.5 / minimax-m2.7, since those
  // canonical ids previously matched older provider helpers. Check it
  // before any other provider helper so historical fall-throughs don't
  // accidentally hijack the new route.
  if (
    isPiexianModel(model) ||
    (resolvedModel && isPiexianModel(resolvedModel))
  )
    return "piexian";
  if (
    isOpenRouterModel(model) ||
    (resolvedModel && isOpenRouterModel(resolvedModel))
  )
    return "openrouter";
  if (isFuturePpoModel(model)) return "futureppo";
  if (
    isAiionlyVideoModel(model) ||
    (resolvedModel && isAiionlyVideoModel(resolvedModel))
  )
    return "aiionly";
  if (isDashScopeCompatibleModel(model)) return "dashscope";
  if (isSiliconFlowModel(model)) return "siliconflow";
  if (isMimoModel(model)) return "mimo";
  if (isSenseNovaModel(model)) return "sensenova";
  if (isIamhcModel(model)) return "iamhc";
  if (isTokenfluxModel(model)) return "tokenflux";
  if (isFreeapiModel(model)) return "freeapi";
  if (isChshapiModel(model)) return "chshapi";
  if (isXem8k5Model(model)) return "xem8k5";
  if (isNewapiQwqtaoModel(model)) return "newapi_qwqtao";
  if (isFreeapiDgbmcModel(model)) return "freeapi_dgbmc";
  if (isOrbitaiModel(model)) return "orbitai";
  if (isUglycatModel(model)) return "uglycat";
  if (isChatApi4Model(model)) return "chatapi4";
  if (isBeijixingxingModel(model)) return "beijixingxing";
  if (isZhipuModel(model)) return "zhipu";
  if (isMistralModel(model)) return "mistral";
  if (isCxyquanModel(model)) return "cxyquan";
  if (isQnaigcModel(model)) return "qnaigc";
  if (isSparkcodeModel(model)) return "sparkcode";
  if (isAspirinModel(model)) return "aspirin";
  if (isTokaifyModel(model)) return "tokaify";
  if (isSupxhModel(model)) return "supxh";
  if (isUnivibeModel(model)) return "univibe";
  if (isChunxueapiModel(model)) return "chunxueapi";
  if (isPwcenModel(model)) return "pwcen";
  if (isXiangluapiModel(model)) return "xiangluapi";
  if (isGemaiModel(model)) return "gemai";
  if (isApi456Model(model)) return "api456";
  if (isCodeRelayModel(model)) return "coderelay";
  if (isUu6TopModel(model)) return "uu6top";
  if (isCpassModel(model)) return "cpass";
  if (isHhhlModel(model)) return "hhhl";
  if (isFreeModelModel(model)) return "freemodel";
  if (isAnthropicModel(model)) return "anthropic";
  if (isCloudflareModel(model)) return "cloudflare";
  return "modelscope";
}

function providerConfigError(
  provider: ProviderKind,
  missing: string[],
  ch: Record<string, string>,
): Response {
  console.error(
    `[config] provider ${provider} missing keys: ${missing.join(", ")}`,
  );
  return new Response(
    JSON.stringify({
      error: "Model temporarily unavailable",
      code: "provider_unavailable",
    }),
    {
      status: 503,
      headers: { ...ch, "Content-Type": "application/json" },
    },
  );
}

function getPingUrl(provider: ProviderKind, probeEndpoint: string): string {
  if (probeEndpoint === "image") {
    if (provider === "futureppo") {
      return `${FUTUREPPO_BASE_URL}/images/generations`;
    }
    if (provider === "tokaify") {
      return `${TOKAIFY_BASE_URL}/images/generations`;
    }
    if (provider === "modelscope") {
      return `${MODELSCOPE_API_BASE}/images/generations`;
    }
  }

  if (provider === "dashscope") {
    return `${DASHSCOPE_COMPATIBLE_BASE_URL}/chat/completions`;
  }
  if (provider === "siliconflow") {
    return `${SILICONFLOW_BASE_URL}/chat/completions`;
  }
  if (provider === "mimo") {
    return `${MIMO_BASE_URL}/chat/completions`;
  }
  if (provider === "futureppo") {
    return `${FUTUREPPO_BASE_URL}/chat/completions`;
  }
  if (provider === "sensenova") {
    return `${SENSENOVA_BASE_URL}/chat/completions`;
  }
  if (provider === "iamhc") {
    return `${IAMHC_BASE_URL}/chat/completions`;
  }
  if (provider === "tokenflux") {
    return `${TOKENFLUX_BASE_URL}/chat/completions`;
  }
  if (provider === "freeapi") {
    return `${FREEAPI_BASE_URL}/chat/completions`;
  }
  if (provider === "pwcen") {
    return `${PWCEN_BASE_URL}/chat/completions`;
  }
  if (provider === "txt180") {
    return `${TXT180_BASE_URL}/chat/completions`;
  }
   if (provider === "pqgpt") {
    return `${PQGPT_BASE_URL}/responses`;
  }
  if (provider === "aistudio") {
    return `${AISTUDIO_BASE_URL}/chat/completions`;
  }
  if (provider === "cloudflare") {
    return `${CLOUDFLARE_BASE_URL}/chat/completions`;
  }
  if (provider === "xiangluapi") {
    return `${XIANGLUAPI_BASE_URL}/chat/completions`;
  }
  if (provider === "gemai") {
    return `${GEMAI_BASE_URL}/chat/completions`;
  }
  if (provider === "api456") {
    return `${API456_BASE_URL}/chat/completions`;
  }
  if (provider === "chshapi") {
    return `${CHSHAPI_BASE_URL}/chat/completions`;
  }
  if (provider === "xem8k5") {
    return `${XEM8K5_BASE_URL}/chat/completions`;
  }
  if (provider === "newapi_qwqtao") {
    return `${NEWAPI_QWQTAO_BASE_URL}/chat/completions`;
  }
  if (provider === "freeapi_dgbmc") {
    return `${FREEAPI_DGBMC_BASE_URL}/chat/completions`;
  }
  if (provider === "piexian") {
    return `${PIEXIAN_BASE_URL}/chat/completions`;
  }
  if (provider === "orbitai") {
    return `${ORBITAI_BASE_URL}/chat/completions`;
  }
  if (provider === "orbitaicc") {
    return `${ORBITAICC_BASE_URL}/chat/completions`;
  }
  if (provider === "uglycat") {
    return `${UGLYCAT_BASE_URL}/chat/completions`;
  }
  if (provider === "cxyquan") {
    return `${CXYQUAN_BASE_URL}/chat/completions`;
  }
  if (provider === "qnaigc") {
    return `${QNAIGC_BASE_URL}/chat/completions`;
  }
  if (provider === "sparkcode") {
    return `${SPARKCODE_BASE_URL}/chat/completions`;
  }
  if (provider === "chunxueapi") {
    return `${CHUNXUEAPI_BASE_URL}/chat/completions`;
  }
  if (provider === "univibe") {
    return `${UNIVIBE_BASE_URL}/chat/completions`;
  }
  if (provider === "supxh") {
    if (probeEndpoint === "gemini-3-flash-supxh") {
      return `https://www.xiangluapi.com/v1/chat/completions`;
    }
    if (probeEndpoint === "gemini-3.1-pro") {
      return `${SUPXH_BASE_URL}/v1/chat/completions`;
    }
    return `${SUPXH_BASE_URL}/chat/completions`;
  }
  if (provider === "aspirin") {
    return `${ASPIRIN_BASE_URL}/chat/completions`;
  }
  if (provider === "tokaify") {
    return `${TOKAIFY_BASE_URL}/chat/completions`;
  }
  if (provider === "openrouter") {
    return `${OPENROUTER_BASE_URL}/chat/completions`;
  }
  if (provider === "cpass") {
    return `${CPASS_BASE_URL}/v1/chat/completions`;
  }
  if (provider === "freemodel") {
    // freemodel.dev natively exposes OpenAI Chat Completions at
    // /v1/chat/completions (verified 2026-05-10). The legacy /v1/responses
    // translators (`chatToFreemodelRequest` / `freemodelResponseToChat` /
    // `makeFreemodelSseToChatTransform`) are kept as dead-code fallbacks in
    // case we ever need to switch back.
    return `${FREEMODEL_BASE_URL}/v1/chat/completions`;
  }
  if (provider === "dialoguedui") {
    return `${DIALOGUEDUI_BASE_URL}/chat/completions`;
  }
  if (provider === "uu6top") {
    return `${UU6TOP_BASE_URL}/chat/completions`;
  }
  if (provider === "coderelay") {
    return `${CODERELAY_BASE_URL}/chat/completions`;
  }
  if (provider === "anthropic") {
    return `${ANTHROPIC_BASE_URL}/v1/chat/completions`;
  }
  if (provider === "ai121628") {
    return `${AI121628_BASE_URL}/chat/completions`;
  }
  if (provider === "hhhl") {
    return `${HHHL_BASE_URL}/chat/completions`;
  }
  return `${MODELSCOPE_API_BASE}/chat/completions`;
}

async function handlePingRequest(
  requestData: Record<string, unknown>,
  req: Request,
): Promise<Response> {
  const ch = corsHeadersFor(req);
  const model = String(requestData.model || "").trim();
  if (!model) {
    return new Response(JSON.stringify({ error: "Missing model" }), {
      status: 400,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const provider = getProviderKind(model);
  if (provider === "pqgpt" && (!PQGPT_BASE_URL || !PQGPT_API_KEY)) {
    return new Response(
      JSON.stringify({
        ok: false,
        model,
        provider,
        probe_endpoint: requestData.probe_endpoint || requestData.target_endpoint || "chat",
        status: 503,
        error: "missing_provider_config",
      }),
      {
        status: 503,
        headers: { ...ch, "Content-Type": "application/json" },
      },
    );
  }
  const probeEndpoint =
    String(
      requestData.probe_endpoint || requestData.target_endpoint || "chat",
    ).trim() || "chat";
  const pingUrl = getPingUrl(provider, probeEndpoint);
  const start = performance.now();

  try {
    const modelScopeKeys =
      provider === "modelscope" ? await resolveModelScopeApiKeys() : [];
    const basePingHeaders: Record<string, string> = {
      Accept: "*/*",
      "User-Agent": USER_AGENT,
    };
    if (provider === "pqgpt") {
      basePingHeaders.Authorization = `Bearer ${PQGPT_API_KEY}`;
    }
    const responses =
      provider === "modelscope" && modelScopeKeys.length
        ? await Promise.all(
            modelScopeKeys.map((apiKey) =>
              fetch(pingUrl, {
                method: "HEAD",
                headers: {
                  ...basePingHeaders,
                  Authorization: `Bearer ${apiKey}`,
                },
              }),
            ),
          )
        : [
            await fetch(pingUrl, {
              method: "HEAD",
              headers: basePingHeaders,
            }),
          ];
    const response = responses[0];

    const latencyMs = Math.max(0, Math.round(performance.now() - start));
    const rateLimitHeaders =
      provider === "modelscope"
        ? collectModelScopeRateLimitHeaders(
            responses.map((item) => item.headers),
          )
        : {};
    return new Response(
      JSON.stringify({
        ok: provider === "pqgpt" ? response.ok : true,
        model,
        provider,
        probe_endpoint: probeEndpoint,
        url: pingUrl,
        status: response.status,
        latencyMs,
      }),
      {
        status: provider === "pqgpt" && !response.ok ? response.status : 200,
        headers: {
          ...ch,
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
      },
    );
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - start));
    return new Response(
      JSON.stringify({
        ok: false,
        model,
        provider,
        probe_endpoint: probeEndpoint,
        url: pingUrl,
        latencyMs,
        error: "Ping failed",
      }),
      {
        status: 200,
        headers: { ...ch, "Content-Type": "application/json" },
      },
    );
  }
}

function isLocalOnlyBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    if (
      /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|localhost|::1$|fc|fd|fe80)/i.test(
        host,
      )
    )
      return true;
    if (/(\.local|metadata\.google\.internal)$/i.test(host)) return true;
    if (/^0[xX][0-9a-fA-F]+$/i.test(host)) return true;
    if (/^0[0-7]+$/.test(host)) return true;
    if (/^\d{8,}$/.test(host)) return true;
    if (/^::ffff:/i.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

const HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";
const INSTANT_SEARCH_URL = "https://api.duckduckgo.com/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderModelScopeKey(value: string): boolean {
  const normalized = value.trim().toUpperCase();
  return (
    !normalized ||
    normalized === "YOUR_MODELSCOPE_API_KEY" ||
    normalized === "REPLACE_WITH_YOUR_MODELSCOPE_API_KEY"
  );
}

let cachedModelScopeApiKeys: string[] = [];
let modelScopeApiKeyLoaded = false;
const modelScopeTurnKeySlots = new Map<string, number>();

function expandModelScopeKeys(keys: string[]): string[] {
  return keys.flatMap((key) =>
    key
      .split(/[\s,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function uniqueModelScopeKeys(keys: string[]): string[] {
  return Array.from(
    new Set(
      expandModelScopeKeys(keys).filter(
        (key) => !isPlaceholderModelScopeKey(key),
      ),
    ),
  );
}

async function resolveModelScopeApiKeys(): Promise<string[]> {
  const envKeys = uniqueModelScopeKeys([
    MODELSCOPE_API_KEY,
    MODELSCOPE_API_KEY_1,
    MODELSCOPE_API_KEY_2,
  ]);
  if (envKeys.length) {
    return envKeys;
  }

  if (modelScopeApiKeyLoaded) {
    return cachedModelScopeApiKeys;
  }

  modelScopeApiKeyLoaded = true;

  if (!SUPABASE_SECRET_KEY) {
    return [];
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    const { data, error } = await supabase
      .from("api_config")
      .select("api_key")
      .eq("service_name", "modelscope")
      .maybeSingle();

    if (error) {
      console.error("读取 ModelScope API key 失败:", error);
      return [];
    }

    const apiKey = String(data?.api_key || "").trim();
    if (!isPlaceholderModelScopeKey(apiKey)) {
      cachedModelScopeApiKeys = uniqueModelScopeKeys([apiKey]);
    }
  } catch (error) {
    console.error("读取 ModelScope API key 时发生异常:", error);
  }

  return cachedModelScopeApiKeys;
}

function hashStableText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function getModelScopeTurnId(
  requestData: Record<string, unknown>,
  req: Request,
): string {
  return cleanHeader(
    String(
      requestData.client_turn_id ||
        requestData.turn_id ||
        req.headers.get("x-chat-turn-id") ||
        "",
    ),
  ).slice(0, 96);
}

function pickModelScopeKeySlot(
  keys: string[],
  turnId = "",
  offset = 0,
): number {
  if (!keys.length) return -1;
  const remembered = turnId ? modelScopeTurnKeySlots.get(turnId) : undefined;
  const base = Number.isInteger(remembered)
    ? Number(remembered)
    : turnId
      ? hashStableText(turnId)
      : Math.floor(Math.random() * keys.length);
  return (base + offset) % keys.length;
}

function rememberModelScopeKeySlot(turnId: string, slot: number): void {
  if (!turnId || !Number.isInteger(slot)) return;
  if (modelScopeTurnKeySlots.size > 1000) {
    const firstKey = modelScopeTurnKeySlots.keys().next().value;
    if (firstKey) modelScopeTurnKeySlots.delete(firstKey);
  }
  modelScopeTurnKeySlots.set(turnId, slot);
}

function pickModelScopeApiKey(
  keys: string[],
  turnId = "",
  offset = 0,
): { key: string; slot: number } {
  const slot = pickModelScopeKeySlot(keys, turnId, offset);
  if (slot < 0) return { key: "", slot };
  return { key: keys[slot] || "", slot };
}

function parseProviderHeaderInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectModelScopeRateLimitHeaders(
  headersList: Headers[],
): Record<string, string> {
  const headerPairs = [
    [
      "modelscope-ratelimit-requests-limit",
      "modelscope-ratelimit-requests-limit",
    ],
    [
      "modelscope-ratelimit-requests-remaining",
      "modelscope-ratelimit-requests-remaining",
    ],
    [
      "modelscope-ratelimit-model-requests-limit",
      "modelscope-ratelimit-model-requests-limit",
    ],
    [
      "modelscope-ratelimit-model-requests-remaining",
      "modelscope-ratelimit-model-requests-remaining",
    ],
  ] as const;
  const output: Record<string, string> = {};
  for (const [sourceKey, outputKey] of headerPairs) {
    const values = headersList
      .map((headers) =>
        parseProviderHeaderInteger(
          headers.get(sourceKey) ||
            headers.get(
              sourceKey.replace(/(^|-)([a-z])/g, (item) => item.toUpperCase()),
            ),
        ),
      )
      .filter((value): value is number => Number.isFinite(value));
    if (values.length) {
      output[outputKey] = String(values.reduce((sum, value) => sum + value, 0));
    }
  }
  return output;
}

function collectProviderRateLimitHeaders(
  provider: ProviderKind,
  headersList: Headers[],
  response: Response,
): Record<string, string> {
  if (provider === "modelscope") {
    return collectModelScopeRateLimitHeaders(headersList);
  }

  const output: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith("modelscope-ratelimit"))
      output[key] = value;
  });
  return output;
}

// 上游 fetch 默认超时。chat 走 SSE，fetch 一收到响应头就返回，超时主要防
// 上游连接卡死导致函数被 Supabase 以 "compute resources" 杀掉；image 同步
// 接口实测 30-90s，给到 4 分钟避免误伤；其它
// 端点 60s 已足够。
const UPSTREAM_FETCH_TIMEOUT_DEFAULT_MS = 60_000;
const UPSTREAM_FETCH_TIMEOUT_IMAGE_MS = 240_000;
const UPSTREAM_FETCH_TIMEOUT_CHAT_MS = 90_000;
const MODELSCOPE_RETRY_STATUSES = new Set([401, 402, 403, 429]);
// 2026-05-16: video / video-task 单独的 timeout。aiionly createVideo
// 实测真 key 秒级，但 cold-start + 我们自己的 logSecurityEvent + 限流
// 写入加起来在 60s 默认值偶发踩边 → 误报 "上游响应超时"。提到 110s
// 给链路足够余量；chat-gateway 自身 120s timeout，这里少 10s 是为了
// 让 modelscope-proxy 的 abort 优先于 chat-gateway，让用户拿到我们的
// sanitized 错误而不是网关层裸 504。
const UPSTREAM_FETCH_TIMEOUT_VIDEO_MS = 110_000;

async function fetchWithUpstreamTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProviderRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  provider: ProviderKind,
  modelScopeApiKeys: string[],
  modelScopeTurnId: string,
  initialModelScopeSlot: number,
  attemptLog?: { ctx: RequestContext; meta: Record<string, unknown> },
  timeoutMs: number = UPSTREAM_FETCH_TIMEOUT_DEFAULT_MS,
): Promise<{ response: Response; rateLimitHeaderSources: Headers[] }> {
  const response = await fetchWithUpstreamTimeout(
    url,
    { method, headers, body },
    timeoutMs,
  );
  if (attemptLog) {
    logSecurityEvent("provider_attempt", attemptLog.ctx, {
      ...attemptLog.meta,
      usage_class: "provider_retry",
      billable_model_call: false,
      provider,
      attempt: 1,
      provider_key_slot:
        initialModelScopeSlot >= 0 ? initialModelScopeSlot : undefined,
      status: response.status,
    });
  }
  const rateLimitHeaderSources = [response.headers];
  if (
    provider === "freemodel" &&
    [401, 402, 403, 429].includes(response.status) &&
    getFreemodelKeyPool().length > 1
  ) {
    const initialFreemodelKey = headers["x-api-key"] || "";
    markFreemodelKeyBlocked(initialFreemodelKey);
    for (const retryKey of getFreemodelKeyPool()) {
      if (!retryKey || retryKey === initialFreemodelKey) continue;
      const retryResponse = await fetchWithUpstreamTimeout(
        url,
        {
          method,
          headers: { ...headers, "x-api-key": retryKey },
          body,
        },
        timeoutMs,
      );
      if (attemptLog) {
        logSecurityEvent("provider_attempt", attemptLog.ctx, {
          ...attemptLog.meta,
          usage_class: "provider_retry",
          billable_model_call: false,
          provider,
          attempt: rateLimitHeaderSources.length + 1,
          status: retryResponse.status,
        });
      }
      rateLimitHeaderSources.push(retryResponse.headers);
      if (![401, 402, 403, 429].includes(retryResponse.status)) {
        return { response: retryResponse, rateLimitHeaderSources };
      }
      markFreemodelKeyBlocked(retryKey);
    }
  }
  if (
    provider !== "modelscope" ||
    !MODELSCOPE_RETRY_STATUSES.has(response.status) ||
    modelScopeApiKeys.length <= 1
  ) {
    if (
      provider === "modelscope" &&
      !MODELSCOPE_RETRY_STATUSES.has(response.status)
    ) {
      rememberModelScopeKeySlot(modelScopeTurnId, initialModelScopeSlot);
    }
    return { response, rateLimitHeaderSources };
  }
  for (let offset = 1; offset < modelScopeApiKeys.length; offset += 1) {
    const retrySelection = pickModelScopeApiKey(
      modelScopeApiKeys,
      modelScopeTurnId,
      offset,
    );
    if (!retrySelection.key || retrySelection.slot === initialModelScopeSlot)
      continue;
    const retryResponse = await fetchWithUpstreamTimeout(
      url,
      {
        method,
        headers: { ...headers, Authorization: `Bearer ${retrySelection.key}` },
        body,
      },
      timeoutMs,
    );
    if (attemptLog) {
      logSecurityEvent("provider_attempt", attemptLog.ctx, {
        ...attemptLog.meta,
        usage_class: "provider_retry",
        billable_model_call: false,
        provider,
        attempt: offset + 1,
        provider_key_slot: retrySelection.slot,
        retry_from_slot: initialModelScopeSlot,
        status: retryResponse.status,
      });
    }
    rateLimitHeaderSources.push(retryResponse.headers);
    if (!MODELSCOPE_RETRY_STATUSES.has(retryResponse.status)) {
      rememberModelScopeKeySlot(modelScopeTurnId, retrySelection.slot);
      return { response: retryResponse, rateLimitHeaderSources };
    }
  }
  return { response, rateLimitHeaderSources };
}

function resolveDuckDuckGoUrl(rawHref: string): string {
  if (!rawHref) return "";

  try {
    const url = new URL(rawHref, HTML_SEARCH_URL);
    const target = url.searchParams.get("uddg");
    if (target) {
      return decodeURIComponent(target);
    }
    return url.toString();
  } catch {
    return rawHref;
  }
}

function uniqueResults(results: SearchResult[], limit: number): SearchResult[] {
  const seen = new Set<string>();
  const output: SearchResult[] = [];

  for (const result of results) {
    const key = `${result.title}::${result.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
    if (output.length >= limit) break;
  }

  return output;
}

function parseHtmlSearchResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  if (typeof DOMParser === "undefined") {
    return results;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return results;

  const blocks = Array.from(doc.querySelectorAll(".result__body"));
  for (const block of blocks) {
    if (results.length >= limit) break;

    const titleLink = block.querySelector("a.result__a");
    const title = cleanText(titleLink?.textContent || "");
    const href = resolveDuckDuckGoUrl(titleLink?.getAttribute("href") || "");
    const snippet = cleanText(
      block.querySelector(".result__snippet")?.textContent || "",
    );

    if (!title || !href) continue;
    results.push({ title, url: href, snippet, source: "duckduckgo_html" });
  }

  return results;
}

function collectInstantTopics(
  items: unknown,
  bucket: SearchResult[],
  limit: number,
): void {
  if (!Array.isArray(items) || bucket.length >= limit) return;

  for (const item of items) {
    if (bucket.length >= limit) return;

    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;

      if (Array.isArray(record.Topics)) {
        collectInstantTopics(record.Topics, bucket, limit);
        continue;
      }

      const text = cleanText(record.Text);
      const url = cleanText(record.FirstURL || record.FirstUrl || "");
      if (!text || !url) continue;

      bucket.push({
        title: text,
        url,
        snippet: text,
        source: "duckduckgo_instant",
      });
    }
  }
}

async function fetchInstantResults(
  query: string,
  lang: string,
  limit: number,
): Promise<SearchResult[]> {
  const url = new URL(INSTANT_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("skip_disambig", "1");
  url.searchParams.set("kl", lang === "en" ? "us-en" : "cn-zh");

  const response = await fetch(url.toString(), {
    headers: {
      "Accept-Language":
        lang === "en" ? "en-US,en;q=0.9" : "zh-CN,zh;q=0.9,en;q=0.6",
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  const results: SearchResult[] = [];
  const heading = cleanText(data?.Heading || query);
  const abstractText = cleanText(data?.AbstractText || "");
  const abstractUrl = cleanText(
    data?.AbstractURL || data?.AbstractSource || "",
  );

  if (abstractText && abstractUrl) {
    results.push({
      title: heading,
      url: abstractUrl,
      snippet: abstractText,
      source: "duckduckgo_instant",
    });
  }

  collectInstantTopics(data?.RelatedTopics, results, limit);
  return uniqueResults(results, limit);
}

async function searchDuckDuckGo(
  query: string,
  lang: string,
  limit: number,
): Promise<SearchResult[]> {
  let htmlResults: SearchResult[] = [];

  try {
    const searchUrl = new URL(HTML_SEARCH_URL);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("kl", lang === "en" ? "us-en" : "cn-zh");
    searchUrl.searchParams.set("kp", "-1");

    const response = await fetch(searchUrl.toString(), {
      headers: {
        "Accept-Language":
          lang === "en" ? "en-US,en;q=0.9" : "zh-CN,zh;q=0.9,en;q=0.6",
        "User-Agent": USER_AGENT,
      },
    });

    if (response.ok) {
      const html = await response.text();
      htmlResults = parseHtmlSearchResults(html, limit);
    }
  } catch (error) {
    console.error("DuckDuckGo HTML search failed:", error);
  }

  if (htmlResults.length >= limit) {
    return uniqueResults(htmlResults, limit);
  }

  const instantResults = await fetchInstantResults(query, lang, limit).catch(
    (error) => {
      console.error("DuckDuckGo instant search failed:", error);
      return [];
    },
  );
  const mergedResults = uniqueResults(
    [...htmlResults, ...instantResults],
    limit,
  );

  if (!mergedResults.length) {
    throw new Error("未获取到联网搜索结果");
  }

  return mergedResults;
}

async function handleWebSearchRequest(
  requestData: Record<string, unknown>,
  req: Request,
): Promise<Response> {
  const ch = corsHeadersFor(req);
  const query = cleanText(requestData.query || requestData.search_query);
  if (!query) {
    return new Response(JSON.stringify({ error: "Missing query" }), {
      status: 400,
      headers: { ...ch, "Content-Type": "application/json" },
    });
  }

  const lang = requestData.lang === "en" ? "en" : "zh";
  const limitValue = Number(requestData.limit);
  const limit = Math.max(
    1,
    Math.min(10, Number.isFinite(limitValue) ? Math.round(limitValue) : 5),
  );
  const results = await searchDuckDuckGo(query, lang, limit);

  return new Response(
    JSON.stringify({
      query,
      lang,
      source: "duckduckgo",
      count: results.length,
      results,
    }),
    {
      status: 200,
      headers: { ...ch, "Content-Type": "application/json" },
    },
  );
}

const BLOCKED_IPS = new Set(
  (Deno.env.get("BLOCKED_IPS") || "").split(",").map((s) => s.trim()).filter(Boolean),
);
const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBlockedUserIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((value) => value.trim().toLowerCase())
      .filter((value) => USER_ID_RE.test(value)),
  );
}

const BLOCKED_USERS = parseBlockedUserIds(
  Deno.env.get("BANNED_USER_IDS") || Deno.env.get("BLOCKED_USER_IDS") || "",
);
const BLOCKED_IP_RANGES = (Deno.env.get("BLOCKED_IP_RANGES") || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const BLOCKED_USER_HASHES = new Set(
  (Deno.env.get("BLOCKED_USER_HASHES") || "").split(",").map((s) => s.trim()).filter(Boolean),
);
const BLOCKED_DEVICE_HASHES = new Set<string>(
  (Deno.env.get("BLOCKED_DEVICE_HASHES") || "").split(",").map((s) => s.trim()).filter(Boolean),
);
const BLOCKED_IP_HASHES = new Set<string>(
  (Deno.env.get("BLOCKED_IP_HASHES") || "").split(",").map((s) => s.trim()).filter(Boolean),
);

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bits = "32"] = cidr.split("/");
  const mask = parseInt(bits, 10);
  const ipNum =
    ip.split(".").reduce((a, b) => (a << 8) + parseInt(b, 10), 0) >>> 0;
  const rangeNum =
    range.split(".").reduce((a, b) => (a << 8) + parseInt(b, 10), 0) >>> 0;
  const maskNum = (0xffffffff << (32 - mask)) >>> 0;
  return (ipNum & maskNum) === (rangeNum & maskNum);
}

function isIpBlocked(ip: string): boolean {
  if (BLOCKED_IPS.has(ip)) return true;
  return BLOCKED_IP_RANGES.some((cidr) => ipInCidr(ip, cidr));
}

function isUserBlocked(user: string): boolean {
  return BLOCKED_USERS.has(user.trim().toLowerCase());
}

// === 并发炸弹检测 ===
const BURST_MAX = 8;
const BURST_WINDOW_MS = 5000;
const burstMap = new Map<string, { count: number; resetAt: number }>();

function checkBurst(ip: string): boolean {
  const now = Date.now();
  const entry = burstMap.get(ip) || {
    count: 0,
    resetAt: now + BURST_WINDOW_MS,
  };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + BURST_WINDOW_MS;
  }
  entry.count++;
  burstMap.set(ip, entry);
  if (burstMap.size > 5000) {
    const first = burstMap.keys().next().value;
    if (first) burstMap.delete(first);
  }
  return entry.count > BURST_MAX;
}
// ===================

// === ALTCHA Proof-of-Work 验证 ===
const ALTCHA_MAX_NUMBER = 1_000_000; // 难度控制：普通电脑 50-200ms

async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handleAltchaChallenge(req: Request): Promise<Response> {
  const ch = corsHeadersFor(req);
  const hmacKey = Deno.env.get("ALTCHA_HMAC_KEY") || "";
  if (!hmacKey) {
    return jsonResponse(
      { error: "server_misconfig", message: "ALTCHA not configured" },
      500,
      ch,
    );
  }

  const salt = crypto.randomUUID();
  const number = Math.floor(Math.random() * ALTCHA_MAX_NUMBER);
  const signature = await hmacSha256(hmacKey, salt + number);

  return jsonResponse(
    {
      algorithm: "SHA-256",
      challenge: signature,
      salt,
      signature,
      maxnumber: ALTCHA_MAX_NUMBER,
    },
    200,
    ch,
  );
}

async function verifyAltcha(
  payload: string,
  hmacKey: string,
): Promise<boolean> {
  try {
    const data = JSON.parse(atob(payload));
    const { salt, number, signature } = data;
    if (!salt || typeof number !== "number" || !signature) return false;
    const check = await hmacSha256(hmacKey, salt + number);
    return check === signature;
  } catch {
    return false;
  }
}

async function verifyAltchaOrFail(
  req: Request,
  ch: Record<string, string>,
): Promise<Response | null> {
  const hmacKey = Deno.env.get("ALTCHA_HMAC_KEY") || "";
  if (!hmacKey) {
    return jsonResponse(
      { error: "server_misconfig", message: "ALTCHA not configured" },
      500,
      ch,
    );
  }

  const altchaPayload = cleanHeader(req.headers.get("x-altcha-payload"));
  if (!altchaPayload || !(await verifyAltcha(altchaPayload, hmacKey))) {
    return jsonResponse(
      {
        error: "bot_challenge_failed",
        code: "altcha_required",
        message: "请完成验证后重试",
        altcha_endpoint: "/altcha/challenge",
      },
      403,
      ch,
    );
  }
  return null;
}
// ===================

const MAINTENANCE_MODE =
  (Deno.env.get("MAINTENANCE_MODE") || "").trim().toLowerCase() === "true";

serve(async (req: Request) => {
  const ch = corsHeadersFor(req);
  noteHttpOriginIfAny(req.headers.get("origin") || "");
  const insecureResp = rejectInsecureOriginIfStrict(req, ch);
  if (insecureResp) return insecureResp;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  if (MAINTENANCE_MODE) {
    return jsonResponse(
      {
        error: "service_unavailable",
        code: "maintenance_mode",
        message: "系统维护中，服务暂时不可用，请稍后再试。",
        retry_after_seconds: 600,
      },
      503,
      ch,
      { "Retry-After": "600" },
    );
  }

  const clientIp = getClientIp(req);

  if (isIpBlocked(clientIp)) {
    console.log(
      JSON.stringify({ event: "security_guard", reason: "ip_blocked" }),
    );
    return new Response(
      JSON.stringify({
        error: "blocked",
        code: "ip_blocked",
        message: "该 IP 已被永久封禁",
      }),
      { status: 403, headers: { ...ch, "Content-Type": "application/json" } },
    );
  }

  if (checkBurst(clientIp)) {
    console.log(
      JSON.stringify({ event: "security_guard", reason: "burst_limit" }),
    );
    return jsonResponse(
      {
        error: "rate_limited",
        code: "burst_limit",
        message: "请求过于频繁，请稍后重试。",
      },
      429,
      ch,
    );
  }

  const startedAt = performance.now();
  const authenticatedUserId = getForwardedUserId(req);
  if (!authenticatedUserId) {
    const originResponse = rejectDisallowedOrigin(req, ch);
    if (originResponse) return originResponse;
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  if (!authenticatedUserId) {
    return jsonResponse(
      { error: "Internal gateway required", code: "gateway_required" },
      403,
      ch,
    );
  }

  try {
    const baseCtx = await getRequestContext(
      req,
      "modelscope-proxy",
      "unknown",
      "",
      authenticatedUserId,
    );
    const banned = checkBanned(baseCtx, ch, authenticatedUserId);
    if (banned) return banned;
    const oversized = rejectOversizedRequest(req, ch, baseCtx);
    if (oversized) return oversized;

    // Read the raw body once so we can measure size without re-stringifying
    // a parsed object — i2i requests carry ~1 MB base64 attachments and the
    // double serialisation we used to do here burned non-trivial CPU on
    // every image generation, contributing to "Function failed due to not
    // having enough compute resources" errors. The header-based check above
    // already rejects oversized payloads; this is the post-parse safety net
    // against forged content-length headers.
    const rawBodyText = await req.text();
    if (rawBodyText.length > MAX_REQUEST_BYTES) {
      logSecurityEvent("security_guard", baseCtx, {
        action: "reject",
        reason: "payload_too_large_post_parse",
        bodySize: rawBodyText.length,
      });
      return jsonResponse(
        { error: "Payload too large", code: "payload_too_large" },
        413,
        ch,
      );
    }
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try {
      body = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch {
      body = {};
    }
    const {
      endpoint = "chat",
      client_turn_id: clientTurnId,
      turn_id: legacyTurnId,
      request_kind: rawRequestKind,
      arena_mode: arenaMode,
      arena_slot: arenaSlot,
      arena_match_id: arenaMatchId,
      tool_name: toolName,
      tool_index: rawToolIndex,
      // 2026-05-18: NexusV-internal protocol fields that must not leak to
      // upstream chat/completions bodies. Most relays silently ignore
      // unknown fields, but Google AI Studio's OpenAI-compat endpoint
      // (generativelanguage.googleapis.com/v1beta/openai) returns
      // 400 INVALID_ARGUMENT "Unknown name \"<field>\": Cannot find field"
      // and the whole request fails. Strip them here, at the proxy
      // boundary, so every provider receives a clean OpenAI-shaped body.
      web_search_enabled: _wsEnabled,
      queue_session_id: _queueSessionId,
      ...rawRequestData
    } = body;
    const endpointName = cleanHeader(String(endpoint || "chat"));
    const requestKind = cleanHeader(String(rawRequestKind || "direct_chat"));
    const toolIndex = Number(rawToolIndex || 0);
    const requestedModel = String(rawRequestData.model || "").trim();
    const publicRoute = requestedModel
      ? getPublicModelRoute(requestedModel)
      : null;
    const model = requestedModel ? resolvePublicModelId(requestedModel) : "";
    const availabilityModelId =
      publicRoute?.canonicalId || requestedModel || model;
    if (requestedModel && !model) {
      return jsonResponse(
        {
          error: "invalid_model",
          code: "invalid_model",
          reason: publicRoute ? "disabled" : "unknown",
          canonical_id: publicRoute?.canonicalId || "",
          message: "The selected model is unavailable.",
        },
        400,
        ch,
      );
    }
    const requestData = model ? { ...rawRequestData, model } : rawRequestData;

    // ── Endpoint ↔ model purpose guard ──────────────────────────────
    // Belt-and-suspenders defense: even if a caller somehow bypasses
    // chat-gateway's `isPublicModelAllowed` (or hits this function via
    // the internal secret path), image-only lines must never be driven
    // through chat/completions, and chat-only lines must never be
    // driven through /v1/images/generations or the video endpoints.
    // Mismatches produce our own sanitized 400 so upstream error shapes
    // never leak to the client.
    if (isImageOnlyUpstreamModel(requestedModel, model) &&
        (endpointName === "chat" || endpointName === "video")) {
      return jsonResponse(
        {
          error: "invalid_model_for_endpoint",
          code: "invalid_model_for_endpoint",
          message: "This model is image-only and cannot be used for chat or video.",
        },
        400,
        ch,
      );
    }
    if (isVideoOnlyUpstreamModel(requestedModel, model) &&
        (endpointName === "chat" || endpointName === "image")) {
      return jsonResponse(
        {
          error: "invalid_model_for_endpoint",
          code: "invalid_model_for_endpoint",
          message: "This model is video-only and cannot be used for chat or image.",
        },
        400,
        ch,
      );
    }

    const ctx = await getRequestContext(
      req,
      "modelscope-proxy",
      endpointName,
      model,
      authenticatedUserId,
    );

    const activeTurnId = cleanHeader(
      String(
        clientTurnId || legacyTurnId || req.headers.get("x-chat-turn-id") || "",
      ),
    );
    const hasTurnId = Boolean(activeTurnId);
    const ignoreRapidSpeed =
      hasTurnId || endpointName === "ping" || endpointName === "task";
    const requestLogMeta = buildUsageLogMeta({
      endpointName,
      activeTurnId,
      requestKind,
      arenaMode,
      arenaSlot,
      arenaMatchId,
      toolName,
      toolIndex,
    });

    const abuseResponse = enforceTurnAwareAbuseGuard(
      ctx,
      ch,
      activeTurnId,
      requestKind,
      { ignoreSpeed: ignoreRapidSpeed },
    );
    if (abuseResponse) return abuseResponse;
    logSecurityEvent(startedEventName(endpointName, requestKind), ctx, {
      method: req.method,
      ...requestLogMeta,
    });

    if (
      endpointName === "altcha/challenge" ||
      (req.method === "GET" && req.url.includes("/altcha/challenge"))
    ) {
      return handleAltchaChallenge(req);
    }

    if (endpointName === "web_search") {
      const response = await handleWebSearchRequest(requestData, req);
      logSecurityEvent("tool_call_finished", ctx, {
        ...requestLogMeta,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return response;
    }

    if (endpointName === "ping") {
      const response = await handlePingRequest(requestData, req);
      logSecurityEvent("provider_attempt", ctx, {
        ...requestLogMeta,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return response;
    }

    if (endpointName === "model_availability") {
      const now = Date.now();
      const blocked: string[] = [];
      for (const [modelId, entry] of modelAvailabilityMap) {
        if (entry.blockedUntil > now) blocked.push(modelId);
      }
      return jsonResponse({ blocked }, 200, ch);
    }

    // ALTCHA 验证：所有 chat/image/task 请求必须先完成 PoW
    // if (['chat', 'image', 'task'].includes(endpointName)) {
    //   const altchaFail = await verifyAltchaOrFail(req, ch)
    //   if (altchaFail) return altchaFail
    // }

    const block = getModelBlock(availabilityModelId);
    if (block) {
      logSecurityEvent("model_block_active", ctx, {
        model: availabilityModelId,
        upstreamModel: model,
        retryAfter: block.retryAfter,
      });
      return modelBlockedResponse(availabilityModelId, block.retryAfter, ch);
    }

    // Pass the requested stream flag to the provider router so the pool
    // can avoid upstreams whose non-stream mode is broken (e.g. orbitai.cc).
    const wantStream = Boolean(
      (requestData as Record<string, unknown>).stream,
    );
    const provider = getProviderKind(
      requestedModel || model,
      model,
      wantStream,
    );
    const modelScopeApiKeys =
      provider === "modelscope" ? await resolveModelScopeApiKeys() : [];
    const modelScopeTurnId =
      provider === "modelscope"
        ? getModelScopeTurnId(
            { client_turn_id: clientTurnId, turn_id: legacyTurnId },
            req,
          )
        : "";
    const modelScopeSelection =
      provider === "modelscope"
        ? pickModelScopeApiKey(modelScopeApiKeys, modelScopeTurnId)
        : { key: "", slot: -1 };
    const modelScopeApiKey = modelScopeSelection.key;
    const dashScopeApiKey =
      provider === "dashscope" ? pickDashScopeApiKey(model) : "";
    const currentApi456Key = provider === "api456" ? pickApi456ApiKey() : "";
    const currentOpenRouterKey =
      provider === "openrouter" ? pickOpenRouterApiKey() : "";
    const currentSupxhKey = provider === "supxh" ? pickSupxhApiKey(model) : "";
    const currentAspirinKey = provider === "aspirin" ? ASPIRIN_API_KEY : "";
    const currentTokaifyKey = provider === "tokaify" ? (model === "gpt-image-2-all" ? TOKAIFY_GPT_IMAGE_2_API_KEY : TOKAIFY_API_KEY) : "";
    const freemodelModelId = publicRoute?.canonicalId || requestedModel || model;
    const currentFreemodelKey = provider === "freemodel" ? pickFreemodelApiKeyForModel(freemodelModelId) : "";
    const clawtoModelId = publicRoute?.canonicalId || requestedModel || model;
    const currentClawtoKey = provider === "clawto" ? pickClawtoApiKey(clawtoModelId) : "";

    if (provider === "iamhc" && (!IAMHC_BASE_URL || !IAMHC_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!IAMHC_BASE_URL ? ["IAMHC_BASE_URL"] : []),
          ...(!IAMHC_API_KEY ? ["IAMHC_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (
      provider === "tokenflux" &&
      (!TOKENFLUX_BASE_URL || !TOKENFLUX_API_KEY)
    ) {
      return providerConfigError(
        provider,
        [
          ...(!TOKENFLUX_BASE_URL ? ["TOKENFLUX_BASE_URL"] : []),
          ...(!TOKENFLUX_API_KEY ? ["TOKENFLUX_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "freeapi" && (!FREEAPI_BASE_URL || !FREEAPI_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!FREEAPI_BASE_URL ? ["FREEAPI_BASE_URL"] : []),
          ...(!FREEAPI_API_KEY ? ["FREEAPI_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "pwcen" && (!PWCEN_BASE_URL || !PWCEN_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!PWCEN_BASE_URL ? ["PWCEN_BASE_URL"] : []),
          ...(!PWCEN_API_KEY ? ["PWCEN_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "txt180" && (!TXT180_BASE_URL || !TXT180_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!TXT180_BASE_URL ? ["TXT180_BASE_URL"] : []),
          ...(!TXT180_API_KEY ? ["TXT180_API_KEY"] : []),
        ],
        ch,
      );
    }
    if (provider === "pqgpt" && (!PQGPT_BASE_URL || !PQGPT_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!PQGPT_BASE_URL ? ["PQGPT_BASE_URL"] : []),
          ...(!PQGPT_API_KEY ? ["PQGPT_API_KEY"] : []),
        ],
        ch,
      );
    }
    if (provider === "clawto" && (!CLAWTO_BASE_URL || !currentClawtoKey)) {
      return providerConfigError(
        provider,
        [
          ...(!CLAWTO_BASE_URL ? ["CLAWTO_BASE_URL"] : []),
          ...(!currentClawtoKey ? ["CLAWTO_API_KEY"] : []),
        ],
        ch,
      );
    }
    if (provider === "aistudio" && !AISTUDIO_API_KEY) {
      return providerConfigError(provider, ["GEMINI_API_KEY"], ch);
    }
    if (provider === "cloudflare" && !CLOUDFLARE_API_KEY) {
      return providerConfigError(provider, ["CLOUDFLARE_API_KEY"], ch);
    }

    if (
      provider === "xiangluapi" &&
      (!XIANGLUAPI_BASE_URL || !XIANGLUAPI_API_KEY)
    ) {
      return providerConfigError(
        provider,
        [
          ...(!XIANGLUAPI_BASE_URL ? ["XIANGLUAPI_BASE_URL"] : []),
          ...(!XIANGLUAPI_API_KEY ? ["XIANGLUAPI_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (
      provider === "gemai" &&
      (!GEMAI_BASE_URL || (!GEMAI_API_KEY && !GEMAI_API_KEY_2))
    ) {
      return providerConfigError(
        provider,
        [
          ...(!GEMAI_BASE_URL ? ["GEMAI_BASE_URL"] : []),
          ...(!GEMAI_API_KEY && !GEMAI_API_KEY_2 ? ["GEMAI_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "api456" && (!API456_BASE_URL || !currentApi456Key)) {
      return providerConfigError(
        provider,
        [
          ...(!API456_BASE_URL ? ["API456_BASE_URL"] : []),
          ...(!currentApi456Key ? ["API456_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "chshapi" && (!CHSHAPI_BASE_URL || !CHSHAPI_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!CHSHAPI_BASE_URL ? ["CHSHAPI_BASE_URL"] : []),
          ...(!CHSHAPI_API_KEY ? ["CHSHAPI_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "xem8k5") {
      const xemKey = getXem8k5ApiKey(model);
      if (!XEM8K5_BASE_URL || !xemKey) {
        return providerConfigError(
          provider,
          [
            ...(!XEM8K5_BASE_URL ? ["XEM8K5_BASE_URL"] : []),
            ...(!xemKey ? ["XEM8K5_API_KEY"] : []),
          ],
          ch,
        );
      }
    }

    if (provider === "freeapi_dgbmc") {
      const dgbmcKey = pickFreeapiDgbmcApiKey(model);
      if (!FREEAPI_DGBMC_BASE_URL || !dgbmcKey) {
        return providerConfigError(
          provider,
          [
            ...(!FREEAPI_DGBMC_BASE_URL ? ["FREEAPI_DGBMC_BASE_URL"] : []),
            ...(!dgbmcKey ? [freeapiDgbmcKeyEnvName(model)] : []),
          ],
          ch,
        );
      }
    }

    if (provider === "piexian") {
      const piexianKey = pickPiexianApiKey(model);
      if (!PIEXIAN_BASE_URL || !piexianKey) {
        return providerConfigError(
          provider,
          [
            ...(!PIEXIAN_BASE_URL ? ["PIEXIAN_BASE_URL"] : []),
            ...(!piexianKey ? [piexianKeyEnvName(model)] : []),
          ],
          ch,
        );
      }
    }

    if (provider === "newapi_qwqtao") {
      const qwqtaoKey = pickNewapiQwqtaoApiKey(model);
      if (!NEWAPI_QWQTAO_BASE_URL || !qwqtaoKey) {
        return providerConfigError(
          provider,
          [
            ...(!NEWAPI_QWQTAO_BASE_URL ? ["NEWAPI_QWQTAO_BASE_URL"] : []),
            ...(!qwqtaoKey ? [newapiQwqtaoKeyEnvName(model)] : []),
          ],
          ch,
        );
      }
    }

    if (provider === "orbitai" && (!ORBITAI_BASE_URL || !ORBITAI_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!ORBITAI_BASE_URL ? ["ORBITAI_BASE_URL"] : []),
          ...(!ORBITAI_API_KEY ? ["ORBITAI_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "orbitaicc") {
      // 2026-05-14: orbitai.cc carries multiple per-model keys
      // (chat: ORBITAICC_GPT_API_KEY / ORBITAICC_DOUBAO_API_KEY,
      // legacy fallback
      // ORBITAICC_API_KEY. Accept any of them — model-specific routing
      // selects the right one downstream.
      const hasAnyOrbitaiccKey = Boolean(
        ORBITAICC_API_KEY ||
          ORBITAICC_GPT_API_KEY ||
          ORBITAICC_DOUBAO_API_KEY,
      );
      if (!ORBITAICC_BASE_URL || !hasAnyOrbitaiccKey) {
        return providerConfigError(
          provider,
          [
            ...(!ORBITAICC_BASE_URL ? ["ORBITAICC_BASE_URL"] : []),
            ...(!hasAnyOrbitaiccKey
              ? [
                  "ORBITAICC_API_KEY",
                  "ORBITAICC_GPT_API_KEY",
                  "ORBITAICC_DOUBAO_API_KEY",
                ]
              : []),
          ],
          ch,
        );
      }
    }

    if (provider === "chatapi4" && (!CHATAPI4_BASE_URL || !CHATAPI4_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!CHATAPI4_BASE_URL ? ["CHATAPI4_BASE_URL"] : []),
          ...(!CHATAPI4_API_KEY ? ["CHATAPI4_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "beijixingxing" && (!BEIJIXINGXING_BASE_URL || !BEIJIXINGXING_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!BEIJIXINGXING_BASE_URL ? ["BEIJIXINGXING_BASE_URL"] : []),
          ...(!BEIJIXINGXING_API_KEY ? ["BEIJIXINGXING_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "zhipu" && (!ZHIPU_BASE_URL || !ZHIPU_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!ZHIPU_BASE_URL ? ["ZHIPU_BASE_URL"] : []),
          ...(!ZHIPU_API_KEY ? ["ZHIPU_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "mistral" && (!MISTRAL_BASE_URL || !MISTRAL_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!MISTRAL_BASE_URL ? ["MISTRAL_BASE_URL"] : []),
          ...(!MISTRAL_API_KEY ? ["MISTRAL_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "uglycat" && (!UGLYCAT_BASE_URL || !UGLYCAT_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!UGLYCAT_BASE_URL ? ["UGLYCAT_BASE_URL"] : []),
          ...(!UGLYCAT_API_KEY ? ["UGLYCAT_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "cxyquan" && (!CXYQUAN_BASE_URL || !CXYQUAN_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!CXYQUAN_BASE_URL ? ["CXYQUAN_BASE_URL"] : []),
          ...(!CXYQUAN_API_KEY ? ["CXYQUAN_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (provider === "qnaigc" && (!QNAIGC_BASE_URL || !QNAIGC_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!QNAIGC_BASE_URL ? ["QNAIGC_BASE_URL"] : []),
          ...(!QNAIGC_API_KEY ? ["QNAIGC_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (
      provider === "sparkcode" &&
      (!SPARKCODE_BASE_URL || !SPARKCODE_API_KEY)
    ) {
      return providerConfigError(
        provider,
        [
          ...(!SPARKCODE_BASE_URL ? ["SPARKCODE_BASE_URL"] : []),
          ...(!SPARKCODE_API_KEY ? ["SPARKCODE_API_KEY"] : []),
        ],
        ch,
      );
    }

    if (
      provider === "freemodel" &&
      (!FREEMODEL_BASE_URL || !currentFreemodelKey)
    ) {
      return providerConfigError(
        provider,
        [
          ...(!FREEMODEL_BASE_URL ? ["FREEMODEL_BASE_URL"] : []),
          ...(!currentFreemodelKey ? [freemodelKeySecretNameForModel(freemodelModelId)] : []),
        ],
        ch,
      );
    }
    if (provider === "dialoguedui" && (!DIALOGUEDUI_BASE_URL || !DIALOGUEDUI_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!DIALOGUEDUI_BASE_URL ? ["DIALOGUEDUI_BASE_URL"] : []),
          ...(!DIALOGUEDUI_API_KEY ? ["DIALOGUEDUI_API_KEY"] : []),
        ],
        ch,
      );
    }
    if (provider === "coderelay") {
      if (!CODERELAY_BASE_URL || !CODERELAY_API_KEY) {
        return providerConfigError(
          provider,
          [
            ...(!CODERELAY_BASE_URL ? ["CODERELAY_BASE_URL"] : []),
            ...(!CODERELAY_API_KEY ? ["CODERELAY_API_KEY"] : []),
          ],
          ch,
        );
      }
    }

    if (provider === "uu6top") {
      const uu6Key = pickUu6TopApiKey(model);
      if (!UU6TOP_BASE_URL || !uu6Key) {
        return providerConfigError(
          provider,
          [
            ...(!UU6TOP_BASE_URL ? ["UU6TOP_BASE_URL"] : []),
            ...(!uu6Key ? [uu6TopKeyEnvName(model)] : []),
          ],
          ch,
        );
      }
    }
    if (provider === "hhhl" && (!HHHL_BASE_URL || !HHHL_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!HHHL_BASE_URL ? ["HHHL_BASE_URL"] : []),
          ...(!HHHL_API_KEY ? ["HHHL_API_KEY"] : []),
        ],
        ch,
      );
    }
    if (
      provider === "anthropic" &&
      (!ANTHROPIC_BASE_URL || !ANTHROPIC_API_KEY)
    ) {
      return providerConfigError(
        provider,
        [
          ...(!ANTHROPIC_BASE_URL ? ["ANTHROPIC_BASE_URL"] : []),
          ...(!ANTHROPIC_API_KEY ? ["ANTHROPIC_API_KEY"] : []),
        ],
        ch,
      );
    }
    if (provider === "univibe" && (!UNIVIBE_BASE_URL || !UNIVIBE_API_KEY)) {
      return providerConfigError(
        provider,
        [
          ...(!UNIVIBE_BASE_URL ? ["UNIVIBE_BASE_URL"] : []),
          ...(!UNIVIBE_API_KEY ? ["UNIVIBE_API_KEY"] : []),
        ],
        ch,
      );
    }
    if (provider === "supxh" && !pickSupxhApiKey(model)) {
      return providerConfigError(provider, ["SUPXH_API_KEYS_RAW or SUPXH_OPUS45_API_KEY"], ch);
    }
    if (provider === "aspirin" && !ASPIRIN_API_KEY) {
      return providerConfigError(provider, ["ASPIRIN_API_KEY"], ch);
    }
    if (provider === "tokaify") {
      const needsImageKey = model === "gpt-image-2-all"
      if (needsImageKey && !TOKAIFY_GPT_IMAGE_2_API_KEY) return providerConfigError(provider, ["TOKAIFY_GPT_IMAGE_2_API_KEY"], ch)
      if (!needsImageKey && !TOKAIFY_API_KEY) return providerConfigError(provider, ["TOKAIFY_API_KEY"], ch)
    }

    if (provider === "openrouter" && !pickOpenRouterApiKey()) {
      return providerConfigError(provider, ["OPENROUTER_API_KEY_1"], ch);
    }
    if (provider === "openrouter" && !OPENROUTER_BASE_URL) {
      return providerConfigError(provider, ["OPENROUTER_BASE_URL"], ch);
    }

    if (provider === "cpass" && !CPASS_API_KEY && !CPASS_API_KEY_2) {
      return providerConfigError(
        provider,
        ["CPASS_API_KEY or CPASS_API_KEY_2"],
        ch,
      );
    }

    if (provider === "dashscope" && !dashScopeApiKey) {
      return providerConfigError(provider, getDashScopeMissingKeys(model), ch);
    }

    if (provider === "siliconflow" && !SILICONFLOW_API_KEY) {
      return providerConfigError(provider, ["SILICONFLOW_API_KEY"], ch);
    }

    if (provider === "mimo" && isMimoTtsModel(model) && !MIMO_TTS_API_KEY) {
      return providerConfigError(provider, ["MIMO_TTS_API_KEY"], ch);
    }
    if (provider === "mimo" && !isMimoTtsModel(model) && !MIMO_API_KEY) {
      return providerConfigError(provider, ["MIMO_API_KEY"], ch);
    }

    if (provider === "sensenova" && !SENSENOVA_API_KEY) {
      return providerConfigError(provider, ["SENSENOVA_API_KEY"], ch);
    }

    if (provider === "chunxueapi" && !CHUNXUEAPI_API_KEY) {
      return providerConfigError(provider, ["CHUNXUEAPI_API_KEY"], ch);
    }

    if (provider === "ai121628" && !AI121628_KIMI_K26_API_KEY) {
      return providerConfigError(provider, ["AI121628_KIMI_K26_API_KEY"], ch);
    }

    if (provider === "aiionly") {
      const aiionlyKey = pickAiionlyApiKey(model);
      if (!AIIONLY_BASE_URL || !aiionlyKey) {
        return providerConfigError(
          provider,
          [
            ...(!AIIONLY_BASE_URL ? ["AIIONLY_BASE_URL"] : []),
            ...(!aiionlyKey ? [aiionlyKeyEnvName(model)] : []),
          ],
          ch,
        );
      }
    }

    const futurePpoApiKey =
      provider === "futureppo" ? getFuturePpoApiKey(model) : "";

    if (provider === "futureppo" && (!FUTUREPPO_BASE_URL || !futurePpoApiKey)) {
      const publicModel = toFuturePpoModelId(model);
      const missingKeyLabel = !futurePpoApiKey
        ? publicModel === "gemma-4-31b-chat"
          ? "FUTUREPPO_GEMMA_API_KEY or FUTUREPPO_API_KEY"
          : "FUTUREPPO_API_KEY"
        : "";
      return providerConfigError(
        provider,
        [
          ...(!FUTUREPPO_BASE_URL ? ["FUTUREPPO_BASE_URL"] : []),
          ...(!futurePpoApiKey ? [missingKeyLabel] : []),
        ],
        ch,
      );
    }

    if (
      provider === "dashscope" &&
      isLocalOnlyBaseUrl(DASHSCOPE_COMPATIBLE_BASE_URL)
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid provider configuration" }),
        {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        },
      );
    }

    if (
      provider === "siliconflow" &&
      isLocalOnlyBaseUrl(SILICONFLOW_BASE_URL)
    ) {
      return new Response(
        JSON.stringify({ error: "Invalid provider configuration" }),
        {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        },
      );
    }

    if (provider === "mimo" && isLocalOnlyBaseUrl(MIMO_BASE_URL)) {
      return new Response(
        JSON.stringify({ error: "Invalid provider configuration" }),
        {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        },
      );
    }

    if (provider === "futureppo" && isLocalOnlyBaseUrl(FUTUREPPO_BASE_URL)) {
      return new Response(
        JSON.stringify({ error: "Invalid provider configuration" }),
        {
          status: 500,
          headers: { ...ch, "Content-Type": "application/json" },
        },
      );
    }

    if (provider === "modelscope" && !modelScopeApiKey) {
      return providerConfigError(
        provider,
        ["MODELSCOPE_API_KEY or api_config.service_name=modelscope"],
        ch,
      );
    }

    let url = "";
    let forwardedRequestData = requestData;
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Configure based on endpoint type and model
    if (endpointName === "image") {
      if (provider === "futureppo") {
        url = `${FUTUREPPO_BASE_URL}/images/generations`;
        headers["Authorization"] = `Bearer ${futurePpoApiKey}`;
        headers["User-Agent"] = USER_AGENT;
        const { image: _img1, ...rest1 } = requestData;
        forwardedRequestData = { ...rest1, model: toFuturePpoModelId(model) };
      } else if (provider === "dashscope" && isDashScopeAsyncImageModel(model)) {
        // ─── DashScope 异步图像生成（提交+轮询） ───
        //   wan2.5-t2i-preview        — t2i 异步
        //   wanx-poster-generation-v1 — 海报异步 (title/sub_title)
        // Endpoint:
        //   POST /api/v1/services/aigc/text2image/image-synthesis
        //     headers: X-DashScope-Async: enable
        //     response: {output: {task_id, task_status:"PENDING"}}
        //   GET  /api/v1/tasks/<task_id>
        //     response: {output: {task_status:"SUCCEEDED", results:[{url}]}}
        //                OR {output: {task_status:"SUCCEEDED", render_urls:["..."]}}
        const asyncImageKey = pickDashScopeVideoApiKey(model);
        if (!asyncImageKey) {
          return providerConfigError(
            "dashscope",
            [dashScopeVideoKeyEnvName(model), "DASHSCOPE_API_KEY"],
            ch,
          );
        }
        const isPoster = model === "wanx-poster-generation-v1";
        const submitBody = isPoster
          ? {
              model,
              input: {
                title: String((requestData as Record<string, unknown>).title || (requestData as Record<string, unknown>).prompt || " ").slice(0, 50),
                sub_title: String((requestData as Record<string, unknown>).sub_title || (requestData as Record<string, unknown>).subTitle || "").slice(0, 50),
                body_text: String((requestData as Record<string, unknown>).body_text || "").slice(0, 500),
                prompt_text_zh: String((requestData as Record<string, unknown>).prompt || "").slice(0, 500),
                wh_ratios: String((requestData as Record<string, unknown>).wh_ratios || "横版"),
              },
              parameters: { n: 1, generate_mode: "generate" },
            }
          : {
              model,
              input: {
                prompt: String((requestData as Record<string, unknown>).prompt || " ").slice(0, 5000),
              },
              parameters: {
                size: String((requestData as Record<string, unknown>).size || "1024*1024").replace(/x/i, "*"),
                n: Math.max(1, Math.min(4, Number((requestData as Record<string, unknown>).n) || 1)),
                prompt_extend: true,
              },
            };
        try {
          const submitResp = await fetchWithUpstreamTimeout(
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${asyncImageKey}`,
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable",
              },
              body: JSON.stringify(submitBody),
            },
            UPSTREAM_FETCH_TIMEOUT_DEFAULT_MS,
          );
          if (!submitResp.ok) {
            const errText = await submitResp.text().catch(() => "");
            recordModelAvailability(availabilityModelId, submitResp.status, ctx, errText);
            return new Response(
              JSON.stringify({
                error: "image_submit_failed",
                code: "image_submit_failed",
                message: "图像提交失败，请稍后重试。",
              }),
              {
                status: submitResp.status === 403 ? 502 : submitResp.status,
                headers: { ...ch, "Content-Type": "application/json" },
              },
            );
          }
          const submitJson = await submitResp.json().catch(() => ({}));
          const taskId = String((submitJson?.output as Record<string, unknown>)?.task_id || "");
          if (!taskId) {
            return new Response(
              JSON.stringify({
                error: "image_no_task_id",
                code: "image_no_task_id",
                message: "图像生成任务初始化失败。",
              }),
              { status: 502, headers: { ...ch, "Content-Type": "application/json" } },
            );
          }
          // Poll. 2s interval, ~150s deadline (Supabase edge limit is ~150s).
          const pollDeadline = Date.now() + 145_000;
          while (Date.now() < pollDeadline) {
            await new Promise((r) => setTimeout(r, 2000));
            const pollResp = await fetch(
              `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
              { method: "GET", headers: { Authorization: `Bearer ${asyncImageKey}` } },
            );
            if (!pollResp.ok) continue;
            const pollJson = await pollResp.json().catch(() => ({}));
            const taskOut = (pollJson?.output as Record<string, unknown>) || {};
            const status = String(taskOut.task_status || "");
            if (status === "SUCCEEDED") {
              // DashScope's async image response lists image URLs under
              // `output.results[].url` for wan t2i, and under
              // `output.render_urls[]` (plain strings) for wanx-poster.
              let urls: string[] = [];
              if (Array.isArray(taskOut.results)) {
                urls = (taskOut.results as Array<Record<string, unknown>>)
                  .map((r) => String(r?.url || ""))
                  .filter(Boolean);
              } else if (Array.isArray(taskOut.render_urls)) {
                urls = (taskOut.render_urls as string[])
                  .map((u) => String(u))
                  .filter(Boolean);
              }
              if (urls.length === 0) {
                return new Response(
                  JSON.stringify({
                    error: "image_no_urls",
                    code: "image_no_urls",
                    message: "图像生成完成但未返回 URL。",
                  }),
                  { status: 502, headers: { ...ch, "Content-Type": "application/json" } },
                );
              }
              recordModelAvailability(availabilityModelId, 200, ctx);
              return new Response(
                JSON.stringify({ data: urls.map((url) => ({ url })) }),
                { headers: { ...ch, "Content-Type": "application/json" } },
              );
            }
            if (status === "FAILED" || status === "UNKNOWN") {
              const reason = String(taskOut.message || taskOut.code || "");
              recordModelAvailability(availabilityModelId, 502, ctx, reason);
              return new Response(
                JSON.stringify({
                  error: "image_generation_failed",
                  code: "image_generation_failed",
                  message: "图像生成失败，请调整提示词后重试。",
                }),
                { status: 502, headers: { ...ch, "Content-Type": "application/json" } },
              );
            }
            // RUNNING / PENDING — loop again.
          }
          return new Response(
            JSON.stringify({
              error: "image_generation_timeout",
              code: "image_generation_timeout",
              message: "图像生成超时，请稍后重试。",
            }),
            { status: 504, headers: { ...ch, "Content-Type": "application/json" } },
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          recordModelAvailability(availabilityModelId, 502, ctx, msg);
          return new Response(
            JSON.stringify({
              error: "image_pipeline_error",
              code: "image_pipeline_error",
              message: "图像生成管道异常，请稍后重试。",
            }),
            { status: 502, headers: { ...ch, "Content-Type": "application/json" } },
          );
        }
      } else if (provider === "dashscope") {
        // ─── DashScope 万相图像生成与编辑（同步）──
        // Endpoint: /api/v1/services/aigc/multimodal-generation/generation
        // Body shape: { model, input.messages[{role:"user",content:[{text}|{image}]}],
        //                parameters: { size, n, watermark, ... } }
        // Response shape: { output.choices[0].message.content[].image }
        // We translate the OpenAI-style {prompt,image,size} request from
        // the frontend into the DashScope shape, fire the call, and rewrite
        // the response into the OpenAI-compatible {data:[{url}]} shape so
        // the existing image fast-path at line ~5466 stays intact.
        if (!isDashScopeImageModel(model)) {
          return new Response(
            JSON.stringify({
              error: "Image generation not supported for this dashscope model",
            }),
            {
              status: 400,
              headers: { ...ch, "Content-Type": "application/json" },
            },
          );
        }
        const dsImageKey = pickDashScopeVideoApiKey(model);
        if (!dsImageKey) {
          return providerConfigError(
            "dashscope",
            [dashScopeVideoKeyEnvName(model), "DASHSCOPE_API_KEY"],
            ch,
          );
        }
        url =
          "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
        headers["Authorization"] = `Bearer ${dsImageKey}`;

        // Map size: frontend defaults to "1024x1024". Wan 2.7 image-pro
        // accepts "1K" / "2K" / "4K" or explicit "WxH" (e.g. "1376*768").
        // Accept either form — translate "1024x1024" → "1024*1024".
        const requestedSize = String(requestData.size || "").trim();
        const sizeParam =
          /^\d+[*x]\d+$/i.test(requestedSize)
            ? requestedSize.replace(/x/i, "*")
            : requestedSize || "2K";

        // Image edit / multi-image reference: frontend sends `image` as
        // string or array of http(s) URLs / data: URIs. Build a content
        // array with one {image} block per attachment, followed by the
        // {text} prompt.
        const rawImage = (requestData as Record<string, unknown>).image;
        const imageList: string[] = Array.isArray(rawImage)
          ? rawImage.map((v) => String(v || "").trim()).filter(Boolean)
          : typeof rawImage === "string" && rawImage.trim()
            ? [rawImage.trim()]
            : [];
        const imageContents = imageList
          .filter(
            (u) => /^https?:\/\//i.test(u) || u.startsWith("data:image/"),
          )
          .slice(0, 9)
          .map((u) => ({ image: u }));

        const promptText = String(requestData.prompt || "").slice(0, 5000);
        const messageContent: Array<Record<string, unknown>> = [];
        for (const imgBlock of imageContents) messageContent.push(imgBlock);
        if (promptText) messageContent.push({ text: promptText });

        forwardedRequestData = {
          model,
          input: {
            messages: [
              {
                role: "user",
                content:
                  messageContent.length > 0
                    ? messageContent
                    : [{ text: promptText || " " }],
              },
            ],
          },
          parameters: {
            size: sizeParam,
            n: Math.max(1, Math.min(4, Number(requestData.n) || 1)),
            watermark: false,
          },
        };
      } else if (provider === "sensenova") {
        url = `${SENSENOVA_BASE_URL}/images/generations`;
        headers["Authorization"] = `Bearer ${SENSENOVA_API_KEY}`;
        // SenseNova U1 Fast only supports specific sizes
        const validSenseNovaSizes = [
          "1664x2496",
          "2496x1664",
          "1760x2368",
          "2368x1760",
          "1824x2272",
          "2272x1824",
          "2048x2048",
          "2752x1536",
          "1536x2752",
          "3072x1376",
          "1344x3136",
        ];
        const requestedSize = String(requestData.size || "").trim();
        if (!validSenseNovaSizes.includes(requestedSize)) {
          forwardedRequestData = { ...requestData, size: "2752x1536" };
        }
      } else if (provider === "gemai") {
        const gemaiKeys = [GEMAI_API_KEY, GEMAI_API_KEY_2].filter(Boolean);
        const gemaiKey =
          gemaiKeys.length > 1 ? gemaiKeys[Math.floor(Math.random() * gemaiKeys.length)] : gemaiKeys[0] || GEMAI_API_KEY;
        const promptText = String((requestData as Record<string, unknown>).prompt || "");
        const chatResp = await fetch(`${GEMAI_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${gemaiKey}`,
            "User-Agent": USER_AGENT,
          },
          body: JSON.stringify({
            model: toGemaiModelId(model),
            messages: [{ role: "user", content: promptText }],
            max_tokens: 1024,
            stream: false,
          }),
        });
        const chatRespText = await chatResp.text().catch(() => "");
        if (!chatResp.ok) {
          recordModelAvailability(availabilityModelId, chatResp.status, ctx, chatRespText);
          return new Response(
            JSON.stringify({
              error: "image_generation_failed",
              code: "image_generation_failed",
              message: "图像生成失败，请稍后重试或更换模型。",
            }),
            {
              status: 502,
              headers: { ...ch, "Content-Type": "application/json" },
            },
          );
        }
        let chatData: Record<string, unknown> = {};
        try {
          chatData = JSON.parse(chatRespText);
        } catch {
          chatData = {};
        }
        const choices = (chatData.choices as Array<Record<string, unknown>>) || [];
        const message = (choices[0]?.message as Record<string, unknown>) || {};
        const content = String(message.content || "");
        const imageMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        const imageUrl = imageMatch?.[1] || "";
        if (!imageUrl) {
          recordModelAvailability(availabilityModelId, 502, ctx, content.slice(0, 200));
          return new Response(
            JSON.stringify({
              error: "image_generation_failed",
              code: "image_generation_failed",
              message: "图像生成失败，请稍后重试。",
            }),
            {
              status: 502,
              headers: { ...ch, "Content-Type": "application/json" },
            },
          );
        }
        recordModelAvailability(availabilityModelId, 200, ctx);
        return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
          headers: { ...ch, "Content-Type": "application/json" },
        });
      } else if (provider === "api456") {
        url = `${API456_BASE_URL}/images/generations`;
        headers["Authorization"] = `Bearer ${currentApi456Key}`;
        headers["User-Agent"] = USER_AGENT;
        const { image: _imgApi456, ...restApi456 } = requestData;
        forwardedRequestData = { ...restApi456, model: toApi456ModelId(model) };
      } else if (provider === "freeapi") {
        // grok-imagine-image-lite: chat-based image gen, extract URL from markdown
        const chatBody = JSON.stringify({
          model: "grok-imagine-image-lite",
          messages: [{ role: "user", content: requestData.prompt || "" }],
          max_tokens: 1024,
          stream: false,
        });
        const chatResp = await fetch(`${FREEAPI_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${FREEAPI_API_KEY}`,
          },
          body: chatBody,
        });
        const chatData = await chatResp.json();
        const content = String(chatData?.choices?.[0]?.message?.content || "");
        const imageMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        const imageUrl = imageMatch?.[1] || "";
        if (!imageUrl) {
          return new Response(
            JSON.stringify({
              error: "No image generated",
              raw: content.slice(0, 200),
            }),
            {
              status: 500,
              headers: { ...ch, "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
          headers: { ...ch, "Content-Type": "application/json" },
        });
      } else if (provider === "freeapi_dgbmc") {
        // freeapi.dgbmc.top 走 chat-completions 包装做 image gen（跟
        // 上面 provider==="freeapi" 的 grok-imagine 同模式）。dgbmc 中
        // 转站不暴露原生 /v1/images/generations 给 OpenAI 系图像模型，
        // 输出是 markdown 形式的 image URL，从 choices[0].message.content
        // 用 ![](url) 正则提一次。
        const upstreamModel = toFreeapiDgbmcModelId(model);
        const dgbmcKey = pickFreeapiDgbmcApiKey(model);
        const promptText = String(
          (requestData as Record<string, unknown>).prompt || "",
        );
        const chatBody = JSON.stringify({
          model: upstreamModel,
          messages: [{ role: "user", content: promptText }],
          max_tokens: 1024,
          stream: false,
        });
        const chatResp = await fetch(
          `${FREEAPI_DGBMC_BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${dgbmcKey}`,
            },
            body: chatBody,
          },
        );
        const chatRespText = await chatResp.text().catch(() => "");
        if (!chatResp.ok) {
          recordModelAvailability(availabilityModelId, chatResp.status, ctx, chatRespText);
          // 跟其他 image-gen 失败路径一致：返回友好 sanitized 错误，
          // 不下发 upstream body / 域名（满足 brand_safety 铁律）。
          return new Response(
            JSON.stringify({
              error: "image_generation_failed",
              code: "image_generation_failed",
              message: "图像生成失败，请稍后重试或更换模型。",
            }),
            {
              status: 502,
              headers: { ...ch, "Content-Type": "application/json" },
            },
          );
        }
        let chatData: Record<string, unknown> = {};
        try {
          chatData = JSON.parse(chatRespText);
        } catch {
          chatData = {};
        }
        const choices = (chatData.choices as Array<Record<string, unknown>>) || [];
        const message = (choices[0]?.message as Record<string, unknown>) || {};
        const content = String(message.content || "");
        const imageMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
        const imageUrl = imageMatch?.[1] || "";
        if (!imageUrl) {
          recordModelAvailability(availabilityModelId, 502, ctx, content.slice(0, 200));
          return new Response(
            JSON.stringify({
              error: "image_generation_failed",
              code: "image_generation_failed",
              message: "图像生成失败，请稍后重试。",
            }),
            {
              status: 502,
              headers: { ...ch, "Content-Type": "application/json" },
            },
          );
        }
        recordModelAvailability(availabilityModelId, 200, ctx);
        return new Response(JSON.stringify({ data: [{ url: imageUrl }] }), {
          headers: { ...ch, "Content-Type": "application/json" },
        });
      } else if (provider === "xem8k5") {
        url = `${XEM8K5_BASE_URL}/images/generations`;
        headers["Authorization"] = `Bearer ${getXem8k5ApiKey(model)}`;
        const { image: imgXem, ...restXem } = requestData;
        forwardedRequestData = { ...restXem, model: toXem8k5ModelId(model) };
        if (imgXem != null) {
          (forwardedRequestData as Record<string, unknown>).image = imgXem;
        }
      } else if (provider === "tokaify") {
        // 2026-05-19: gpt-image-2-all via tokaify native OpenAI image endpoint.
        // Strip response_format (tokaify returns b64_json natively, setting
        // response_format causes it to wrap base64 in a data: URI which can
        // confuse downstream validation). Also strip endpoint / image / messages.
        url = `${TOKAIFY_BASE_URL}/images/generations`;
        headers["Authorization"] = `Bearer ${TOKAIFY_GPT_IMAGE_2_API_KEY}`;
        const { image: _imgTokaify, messages: _msgTokaify, endpoint: _epTokaify, response_format: _rfTokaify, ...restTokaify } = requestData as Record<string, unknown>;
        forwardedRequestData = { ...restTokaify, model: "gpt-image-2-all" };
      } else if (provider === "cloudflare") {
        // Cloudflare Workers AI image generation via native /ai/run/ endpoint.
        // Returns raw base64 PNG; we wrap it into OpenAI-compatible {data:[{url}]}.
        if (!CLOUDFLARE_API_KEY) {
          return providerConfigError("cloudflare", ["CLOUDFLARE_API_KEY"], ch);
        }
        const cfPrompt = String((requestData as Record<string, unknown>).prompt || " ").slice(0, 4000);
        const cfImgResp = await fetchWithUpstreamTimeout(
          `${CLOUDFLARE_BASE_URL.replace("/v1", "")}/run/${model}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${CLOUDFLARE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ prompt: cfPrompt }),
          },
          UPSTREAM_FETCH_TIMEOUT_DEFAULT_MS,
        );
        if (!cfImgResp.ok) {
          const cfErr = await cfImgResp.text().catch(() => "");
          recordModelAvailability(availabilityModelId, cfImgResp.status, ctx, cfErr);
          return new Response(
            JSON.stringify({
              error: "image_generation_failed",
              code: "image_generation_failed",
              message: "图像生成失败，请稍后重试。",
            }),
            { status: 502, headers: { ...ch, "Content-Type": "application/json" } },
          );
        }
        const cfImgBuf = await cfImgResp.arrayBuffer();
        const cfImgB64 = btoa(String.fromCharCode(...new Uint8Array(cfImgBuf)));
        recordModelAvailability(availabilityModelId, 200, ctx);
        return new Response(
          JSON.stringify({ data: [{ url: `data:image/png;base64,${cfImgB64}` }] }),
          { headers: { ...ch, "Content-Type": "application/json" } },
        );
      } else {
        url = `${MODELSCOPE_API_BASE}/images/generations`;
        headers["Authorization"] = `Bearer ${modelScopeApiKey}`;
        headers["X-ModelScope-Async-Mode"] = "true";
        const { image: _img2, ...rest2 } = requestData;
        forwardedRequestData = rest2;
      }
    } else if (endpointName === "task") {
      if (provider !== "modelscope") {
        return new Response(
          JSON.stringify({
            error: "Task polling not supported for this provider",
          }),
          {
            status: 400,
            headers: { ...ch, "Content-Type": "application/json" },
          },
        );
      }
      const { taskId } = requestData;
      url = `${MODELSCOPE_API_BASE}/tasks/${taskId}`;
      headers["Authorization"] = `Bearer ${modelScopeApiKey}`;
      headers["X-ModelScope-Task-Type"] = "image_generation";
    } else if (endpointName === "video") {
      if (provider === "aiionly") {
        const prompt = String(
          requestData.prompt || requestData.input?.prompt || "",
        ).slice(0, 4000);
        url = `${AIIONLY_BASE_URL}/v1/createVideo`;
        headers["Authorization"] = `Bearer ${pickAiionlyApiKey(model)}`;
        if (model === "veo-3.1-lite-generate-preview") {
          // VEO 3.1 Lite：720p 高清有声，~¥0.35/秒 → 5s = ¥1.75。
          // 用户要求"高清有声"，所以 generateAudio:true / resolution:720p。
          // 16:9 默认横屏（per 78.md veo-3.0-generate-preview 不支持 9:16，
          // veo-3.1-lite 文档没明说，保守用 16:9）。
          forwardedRequestData = {
            model,
            input: { prompt },
            parameters: {
              duration: 5,
              resolution: "720p",
              aspectRatio: "16:9",
              generateAudio: true,
              sampleCount: 1,
            },
          };
        } else {
          // Seedance 2.0：480p 标清无声，~¥0.8/秒 → 5s = ¥4。
          // 标清 + 无水印 + 无声音（用户明确要求最便宜）。
          forwardedRequestData = {
            model,
            input: { prompt },
            parameters: {
              duration: 5,
              resolution: "480p",
              watermark: false,
              generate_audio: false,
            },
          };
        }
      } else {
      // ─── DashScope 视频生成（异步）── 4 lines today:
      //   happyhorse-1.0-r2v  reference-image / reference-video（≤9 张参考）
      //   wan2.7-t2v          Wan 2.7 文生视频（无需媒体）
      //
      // `pickDashScopeVideoApiKey()` handles HappyHorse's dedicated key first,
      // then the shared DashScope video key.
      //
      // We build the per-model `input` and `parameters` shape per the
      // DashScope spec, defaulting to 720P / 5-10s. The frontend posts
      // {model, prompt, media:[{type,url}, ...]} and we never trust the
      // client-supplied `model` field for routing — only for shape.
      const videoApiKey = pickDashScopeVideoApiKey(model);
      if (!videoApiKey) {
        return providerConfigError(
          "dashscope",
          [dashScopeVideoKeyEnvName(model), "DASHSCOPE_API_KEY"],
          ch,
        );
      }
      url =
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";
      headers["Authorization"] = `Bearer ${videoApiKey}`;
      headers["X-DashScope-Async"] = "enable";

      const prompt = String(
        requestData.prompt || requestData.input?.prompt || "",
      ).slice(0, 4000);
      // `media` may live at top-level (frontend sends it that way) or
      // nested in `input` (passthrough callers); accept both.
      const rawMedia = Array.isArray(requestData.media)
        ? requestData.media
        : Array.isArray(requestData.input?.media)
          ? requestData.input.media
          : [];
      // Allowlist of media block types per DashScope spec — drop anything
      // unknown to prevent prompt injection or future-deprecated tags
      // sneaking through.
      const allowedMediaTypes = new Set([
        "first_frame",
        "video",
        "reference_image",
        "reference_video",
        "driving_audio",
      ]);
      const media: Array<Record<string, unknown>> = [];
      for (const m of rawMedia) {
        if (!m || typeof m !== "object") continue;
        const mObj = m as Record<string, unknown>;
        const t = String(mObj.type || "");
        const u = String(mObj.url || "").trim();
        if (!allowedMediaTypes.has(t)) continue;
        if (!/^https?:\/\//i.test(u) && !u.startsWith("data:")) continue;
        media.push({ type: t, url: u });
        if (media.length >= 9) break; // hard cap matches r2v upstream limit
      }

      const input: Record<string, unknown> = { prompt };
      const parameters: Record<string, unknown> = {
        resolution: "720P",
        duration: 5,
      };

      // Helper to fail fast with a clean 400 when the user picked a video
      // model that requires media but didn't attach any. Without this guard
      // we forward an empty `input.media` and DashScope replies with a
      // cryptic "Field required: input.media" that the chat UI shows verbatim.
      const missingMediaResponse = (hint: string) =>
        new Response(
          JSON.stringify({
            error: "missing_media",
            code: "missing_media",
            message: hint,
          }),
          {
            status: 400,
            headers: { ...ch, "Content-Type": "application/json" },
          },
        );

      if (model === "happyhorse-1.0-r2v") {
        // Reference-to-video: 支持最多 9 张参考图（reference_image）。
        // 把任何 first_frame 参数转成 reference_image，避免上游报错。
        const referenceMedia = media
          .filter((m) => {
            const t = String(m.type || "");
            return t === "reference_image" || t === "first_frame";
          })
          .map((m) => {
            return { type: "reference_image", url: m.url };
          })
          .slice(0, 9);
        if (referenceMedia.length === 0)
          return missingMediaResponse(
            "HappyHorse 参考生视频需要至少上传一张参考图（最多 9 张）。",
          );
        input.media = referenceMedia;
        parameters.ratio = "16:9";
      } else if (model === "happyhorse-1.0-video-edit") {
        const editVideo = media.find((m) => String(m.type || "") === "video");
        if (!editVideo)
          return missingMediaResponse(
            "HappyHorse 视频编辑需要先上传一个视频，可再附加最多 5 张参考图。",
          );
        const editVideoUrl = String(editVideo.url || "").trim();
        if (!/^https?:\/\//i.test(editVideoUrl))
          return missingMediaResponse(
            "HappyHorse 视频编辑的视频素材必须是公网可访问的 HTTP(S) URL，请粘贴 mp4/mov 链接后重试。",
          );
        const referenceMedia = media
          .filter((m) => String(m.type || "") === "reference_image")
          .slice(0, 5);
        input.media = [editVideo, ...referenceMedia];
        delete parameters.duration;
      } else if (model === "wan2.7-t2v") {
        parameters.resolution = "720P";
        parameters.duration = 10;
        parameters.ratio = "16:9";
        parameters.prompt_extend = true;
        parameters.watermark = true;
        // 文生视频，无需媒体。
      } else {
        // Unknown video model id reached the proxy — surface a clean 400
        // instead of forwarding garbage to DashScope.
        return new Response(
          JSON.stringify({
            error: "unsupported_video_model",
            code: "unsupported_video_model",
            message: `Video model not supported: ${model}`,
          }),
          { status: 400, headers: { ...ch, "Content-Type": "application/json" } },
        );
      }

      forwardedRequestData = { model, input, parameters };
      }
    } else if (endpointName === "video-task") {
      if (provider === "aiionly") {
        const { taskId: videoTaskId } = requestData;
        url = `${AIIONLY_BASE_URL}/v1/getVideoResult`;
        headers["Authorization"] = `Bearer ${pickAiionlyApiKey(model)}`;
        forwardedRequestData = { model, taskId: videoTaskId };
      } else {
      // Video task polling uses the same key picker as the submit call.
      const videoTaskApiKey = pickDashScopeVideoApiKey(model);
      if (!videoTaskApiKey) {
        return providerConfigError(
          "dashscope",
          [dashScopeVideoKeyEnvName(model), "DASHSCOPE_API_KEY"],
          ch,
        );
      }
      const { taskId: videoTaskId } = requestData;
      url = `https://dashscope.aliyuncs.com/api/v1/tasks/${videoTaskId}`;
      headers["Authorization"] = `Bearer ${videoTaskApiKey}`;
      }
    } else {
      // 根据provider进行模型ID映射
      if (provider === "futureppo") {
        forwardedRequestData = {
          ...requestData,
          model: toFuturePpoModelId(model),
        };
      } else if (provider === "dashscope") {
        forwardedRequestData = {
          ...requestData,
          model: toDashScopeModelId(model),
        };
      } else if (provider === "gemai") {
        forwardedRequestData = { ...requestData, model: toGemaiModelId(model) };
      } else if (provider === "hhhl") {
        forwardedRequestData = {
          ...requestData,
          model: toHhhlModelId(model),
        };
      } else if (provider === "api456") {
        forwardedRequestData = {
          ...requestData,
          model: toApi456ModelId(model),
        };
      } else if (provider === "chshapi") {
        forwardedRequestData = {
          ...requestData,
          model: toChshapiModelId(model),
        };
      } else if (provider === "siliconflow") {
        forwardedRequestData = {
          ...requestData,
          model: toSiliconflowModelId(model),
        };
      } else if (provider === "xem8k5") {
        forwardedRequestData = {
          ...requestData,
          model: toXem8k5ModelId(model),
        };
      } else if (provider === "freeapi_dgbmc") {
        forwardedRequestData = {
          ...requestData,
          model: toFreeapiDgbmcModelId(model),
        };
      } else if (provider === "piexian") {
        // pie-xian splits 5 models across 2 protocols. Translate the
        // OpenAI Chat body into the right upstream shape.
        if (isPiexianMessagesModel(model)) {
          forwardedRequestData = chatToAnthropicRequest(
            requestData as Record<string, unknown>,
            toPiexianModelId(model),
          );
        } else if (isPiexianResponsesModel(model)) {
          forwardedRequestData = chatToFreemodelRequest(
            requestData as Record<string, unknown>,
            toPiexianModelId(model),
          );
        } else {
          forwardedRequestData = {
            ...requestData,
            model: toPiexianModelId(model),
          };
        }
      } else if (provider === "dialoguedui") {
        forwardedRequestData = { ...requestData, model };
      } else if (provider === "uu6top") {
        forwardedRequestData = { ...requestData, model: toUu6TopModelId(model) };
      } else if (provider === "supxh" && model === "claude-opus-4-5") {
        // supxh.xin claude-opus-4-5 → Anthropic Messages protocol probe.
        // If the relay 404s on /v1/messages we'll need to flip to Chat
        // Completions; logged failures will surface that.
        forwardedRequestData = chatToAnthropicRequest(
          requestData as Record<string, unknown>,
          model,
        );
      } else if (provider === "newapi_qwqtao") {
        forwardedRequestData = {
          ...requestData,
          model: toNewapiQwqtaoModelId(model),
        };
      } else if (provider === "pqgpt") {
        forwardedRequestData = chatToFreemodelRequest(
          requestData as Record<string, unknown>,
          PQGPT_MODEL_ID || model,
        );
      } else if (provider === "modelscope") {
        // ModelScope wire ids use vendor/model format (e.g.
        // "deepseek-ai/DeepSeek-V4-Flash"). Cold-failover canonicals
        // map their bare canonical id to the namespaced id here.
        forwardedRequestData = {
          ...requestData,
          model: toModelScopeModelId(model),
        };
      } else if (provider === "sensenova") {
        forwardedRequestData = {
          ...requestData,
          model: toSensenovaModelId(model),
        };
      } else {
        forwardedRequestData = requestData;
      }

      if (provider === "iamhc") {
        url = `${IAMHC_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${IAMHC_API_KEY}`;
      } else if (provider === "tokenflux") {
        url = `${TOKENFLUX_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${TOKENFLUX_API_KEY}`;
      } else if (provider === "freeapi") {
        url = `${FREEAPI_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${FREEAPI_API_KEY}`;
      } else if (provider === "dashscope") {
        url = `${DASHSCOPE_COMPATIBLE_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${dashScopeApiKey}`;
      } else if (provider === "siliconflow") {
        url = `${SILICONFLOW_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${SILICONFLOW_API_KEY}`;
      } else if (provider === "mimo") {
        if (isMimoTtsModel(model)) {
          // 2026-05-18：MiMo-V2.5-TTS 上游在 api.xiaomimimo.com（独立域名，不是
          // modelscope.cn），且鉴权 header 是 `api-key`，不是 Authorization: Bearer。
          // 该路径不需 X-Modelscope-Async-Mode，仅走标准 OpenAI 兼容 chat completions，
          // 服务器以 SSE 流返回 delta.audio.data（base64 PCM16LE @ 24kHz）。
          url = `${MIMO_TTS_BASE_URL}/chat/completions`;
          delete headers["Authorization"];
          headers["api-key"] = pickMimoApiKey(model);
        } else {
          const mimoBase = model === "mimo-v2.5-pro" ? MIMO_PRO_BASE_URL : MIMO_BASE_URL;
          url = `${mimoBase}/chat/completions`;
          headers["Authorization"] = `Bearer ${pickMimoApiKey(model)}`;
        }
      } else if (provider === "futureppo") {
        url = `${FUTUREPPO_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${futurePpoApiKey}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "sensenova") {
        url = `${SENSENOVA_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${SENSENOVA_API_KEY}`;
      } else if (provider === "pwcen") {
        url = `${PWCEN_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${PWCEN_API_KEY}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "txt180") {
        url = `${TXT180_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${TXT180_API_KEY}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "pqgpt") {
        url = `${PQGPT_BASE_URL}/responses`;
        headers["Authorization"] = `Bearer ${PQGPT_API_KEY}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "clawto") {
        url = `${CLAWTO_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${currentClawtoKey}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "aistudio") {
        url = `${AISTUDIO_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${AISTUDIO_API_KEY}`;
      } else if (provider === "cloudflare") {
        url = `${CLOUDFLARE_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${CLOUDFLARE_API_KEY}`;
      } else if (provider === "xiangluapi") {
        url = `${XIANGLUAPI_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${XIANGLUAPI_API_KEY}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "gemai") {
        url = `${GEMAI_BASE_URL}/chat/completions`;
        const gemaiKeys = [GEMAI_API_KEY, GEMAI_API_KEY_2].filter(Boolean);
        headers["Authorization"] =
          `Bearer ${gemaiKeys.length > 1 ? gemaiKeys[Math.floor(Math.random() * gemaiKeys.length)] : gemaiKeys[0] || GEMAI_API_KEY}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "api456") {
        url = `${API456_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${currentApi456Key}`;
        headers["User-Agent"] = USER_AGENT;
      } else if (provider === "chshapi") {
        url = `${CHSHAPI_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${CHSHAPI_API_KEY}`;
      } else if (provider === "xem8k5") {
        url = `${XEM8K5_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${getXem8k5ApiKey(model)}`;
      } else if (provider === "freeapi_dgbmc") {
        url = `${FREEAPI_DGBMC_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${pickFreeapiDgbmcApiKey(model)}`;
      } else if (provider === "piexian") {
        // Protocol routing per model:
        //   /v1/messages   (Anthropic) for claude-haiku — x-api-key auth
        //   /v1/responses  (OpenAI Responses) for the rest — Bearer auth
        if (isPiexianMessagesModel(model)) {
          url = `${PIEXIAN_BASE_URL}/v1/messages`;
          headers["x-api-key"] = pickPiexianApiKey(model);
          headers["anthropic-version"] = "2023-06-01";
          delete headers["Authorization"];
        } else if (isPiexianResponsesModel(model)) {
          url = `${PIEXIAN_BASE_URL}/v1/responses`;
          headers["Authorization"] = `Bearer ${pickPiexianApiKey(model)}`;
        } else {
          url = `${PIEXIAN_BASE_URL}/v1/chat/completions`;
          headers["Authorization"] = `Bearer ${pickPiexianApiKey(model)}`;
        }
      } else if (provider === "dialoguedui") {
        url = `${DIALOGUEDUI_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${DIALOGUEDUI_API_KEY}`;
      } else if (provider === "coderelay") {
        url = `${CODERELAY_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${CODERELAY_API_KEY}`;
      } else if (provider === "uu6top") {
        url = `${UU6TOP_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${pickUu6TopApiKey(model)}`;
      } else if (provider === "newapi_qwqtao") {
        url = `${NEWAPI_QWQTAO_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${pickNewapiQwqtaoApiKey(model)}`;
      } else if (provider === "orbitai") {
        url = `${ORBITAI_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${ORBITAI_API_KEY}`;
      } else if (provider === "orbitaicc") {
        url = `${ORBITAICC_BASE_URL}/chat/completions`;
        // 2026-05-13: orbitai.cc serves two distinct models with two
        // model-specific keys. Pick by canonical id, fall back to the
        // legacy single key when the per-model var isn't set.
        const orbitaiccKey =
          model === "doubao-seed-2-0-lite-260215"
            ? (ORBITAICC_DOUBAO_API_KEY || ORBITAICC_API_KEY)
            : (ORBITAICC_GPT_API_KEY || ORBITAICC_API_KEY);
        headers["Authorization"] = `Bearer ${orbitaiccKey}`;
      } else if (provider === "uglycat") {
        url = `${UGLYCAT_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${UGLYCAT_API_KEY}`;
      } else if (provider === "chatapi4") {
        url = `${CHATAPI4_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${CHATAPI4_API_KEY}`;
      } else if (provider === "beijixingxing") {
        url = `${BEIJIXINGXING_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${BEIJIXINGXING_API_KEY}`;
      } else if (provider === "zhipu") {
        url = `${ZHIPU_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${ZHIPU_API_KEY}`;
      } else if (provider === "mistral") {
        url = `${MISTRAL_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${MISTRAL_API_KEY}`;
      } else if (provider === "ai121628") {
        // 2026-05-14: ai.121628.xyz 冷备线（仅 kimi-k2.6）。OpenAI 兼容
        // /v1/chat/completions，Bearer 鉴权。本路径只在 pickPoolProvider
        // 把 kimi-k2.6 路由到 ai121628 时触发。
        url = `${AI121628_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${AI121628_KIMI_K26_API_KEY}`;
      } else if (provider === "cxyquan") {
        url = `${CXYQUAN_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${CXYQUAN_API_KEY}`;
      } else if (provider === "qnaigc") {
        url = `${QNAIGC_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${QNAIGC_API_KEY}`;
        forwardedRequestData = {
          ...requestData,
          model: toQnaigcModelId(model),
        };
      } else if (provider === "sparkcode") {
        url = `${SPARKCODE_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${SPARKCODE_API_KEY}`;
      } else if (provider === "freemodel") {
        // freemodel.dev speaks native OpenAI Chat Completions. Each
        // `gpt-5.5*` line owns a distinct upstream account; the line
        // ID (pre-rewrite `requestedModel`) selects the matching key
        // so admin disable / enable on a single line only affects that
        // key, not the sibling account. The body's `model` field is
        // already rewritten to upstreamId="gpt-5.5" by resolvePublicModelId.
        // Auth header: freemodel.dev requires `x-api-key: <key>` for new
        // accounts (verified 2026-05-11). Older accounts also accept
        // `x-api-key`, so we use it uniformly and drop `Authorization`.
        url = `${FREEMODEL_BASE_URL}/v1/chat/completions`;
        headers["x-api-key"] = currentFreemodelKey;
        delete headers["Authorization"];
      } else if (provider === "anthropic") {
        url = `${ANTHROPIC_BASE_URL}/v1/chat/completions`;
        headers["Authorization"] = `Bearer ${ANTHROPIC_API_KEY}`;
      } else if (provider === "supxh") {
        if (model === "claude-opus-4-5") {
          // claude-opus-4-5 — try Anthropic Messages first (canonical for
          // claude relays). If it 404s we'll iterate.
          url = `${SUPXH_BASE_URL}/v1/messages`;
          headers["x-api-key"] = currentSupxhKey;
          headers["anthropic-version"] = "2023-06-01";
          delete headers["Authorization"];
        } else if (model === "gemini-3-flash-supxh") {
          url = `https://www.xiangluapi.com/v1/chat/completions`;
          headers["Authorization"] = `Bearer ${currentSupxhKey}`;
        } else if (model === "gemini-3.1-pro") {
          url = `${SUPXH_BASE_URL}/v1/chat/completions`;
          headers["Authorization"] = `Bearer ${currentSupxhKey}`;
        } else {
          url = `${SUPXH_BASE_URL}/chat/completions`;
          headers["Authorization"] = `Bearer ${currentSupxhKey}`;
        }
      } else if (provider === "aspirin") {
        url = `${ASPIRIN_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${ASPIRIN_API_KEY}`;
      } else if (provider === "tokaify") {
        url = `${TOKAIFY_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${TOKAIFY_API_KEY}`;
      } else if (provider === "openrouter") {
        url = `${OPENROUTER_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${currentOpenRouterKey}`;
        headers["HTTP-Referer"] = "" || "https://example.com";
        headers["X-Title"] = "ChatAI";
        forwardedRequestData = {
          ...requestData,
          model: toOpenRouterModelId(model),
        };
      } else if (provider === "cpass") {
        url = `${CPASS_BASE_URL}/v1/chat/completions`;
        headers["Authorization"] = `Bearer ${pickCpassApiKey()}`;
      } else if (provider === "chunxueapi") {
        // chunxueapi.com — OpenAI Chat Completions compatible relay.
        // Verified 2026-05-14 via direct probe: gpt-5.4 / gpt-5.5 both
        // return well-formed `chat.completion` JSON. Body's `model` field
        // (gpt-5.4 / gpt-5.5) is forwarded as-is — chunxueapi uses the
        // same canonical id we expose to clients.
        url = `${CHUNXUEAPI_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${CHUNXUEAPI_API_KEY}`;
      } else if (provider === "hhhl") {
        // ai.hhhl.cc — OpenAI Chat Completions compatible relay.
        // gpt-5.5-high maps to upstream id "gpt-5.5" via toHhhlModelId.
        url = `${HHHL_BASE_URL}/chat/completions`;
        headers["Authorization"] = `Bearer ${HHHL_API_KEY}`;
      } else {
        url = `${MODELSCOPE_API_BASE}/chat/completions`;
        headers["Authorization"] = `Bearer ${modelScopeApiKey}`;
      }
    }

    // Forward request to provider
    const providerRequestBody = JSON.stringify(forwardedRequestData);
    // Per-endpoint upstream timeout. image is slow and routinely
    // burns 30-90s, edge cases push to 2-3 min) so 4 min; chat returns headers
    // fast since the body is streamed afterwards; everything else (task / video
    // submit + poll) is quick.
    // 2026-05-16: 把 video / video-task 也算作 "可能慢" 的端点：aiionly
    // 上游 createVideo 实测秒级，但 cold-start + 网络抖动 + 我们自己的
    // logSecurityEvent / 限流写入 加起来偶发踩 60s 边界，导致 AbortError
    // → 前端报 "上游服务响应超时"。chat-gateway 自身 120s，这里给 110s
    // 留 10s 余量做响应回写。getVideoResult 轮询正常 < 5s 不受影响。
    const upstreamTimeoutMs =
      endpointName === "image"
        ? UPSTREAM_FETCH_TIMEOUT_IMAGE_MS
        : endpointName === "chat"
          ? UPSTREAM_FETCH_TIMEOUT_CHAT_MS
          : endpointName === "video" || endpointName === "video-task"
            ? UPSTREAM_FETCH_TIMEOUT_VIDEO_MS
            : UPSTREAM_FETCH_TIMEOUT_DEFAULT_MS;
    let response: Response;
    let rateLimitHeaderSources: Headers[];
    try {
      ({ response, rateLimitHeaderSources } = await fetchProviderRequest(
        url,
        req.method,
        headers,
        providerRequestBody,
        provider,
        modelScopeApiKeys,
        modelScopeTurnId,
        modelScopeSelection.slot,
        {
          ctx,
          meta: buildUsageLogMeta({
            endpointName,
            activeTurnId,
            requestKind,
            arenaMode,
            arenaSlot,
            arenaMatchId,
            toolName,
            toolIndex,
            provider,
          }),
        },
        upstreamTimeoutMs,
      ));
    } catch (fetchErr) {
      const isAbort =
        (fetchErr as { name?: string })?.name === "AbortError" ||
        (fetchErr as { name?: string })?.name === "TimeoutError";
      recordModelAvailability(availabilityModelId, 504, ctx, "upstream_timeout");
      logSecurityEvent("upstream_timeout", ctx, {
        ...buildUsageLogMeta({
          endpointName,
          activeTurnId,
          requestKind,
          arenaMode,
          arenaSlot,
          arenaMatchId,
          toolName,
          toolIndex,
          provider,
        }),
        timeoutMs: upstreamTimeoutMs,
        durationMs: Math.round(performance.now() - startedAt),
        isAbort,
        error:
          fetchErr instanceof Error
            ? fetchErr.message.slice(0, 240)
            : String(fetchErr).slice(0, 240),
      });
      return jsonResponse(
        {
          error: isAbort ? "upstream_timeout" : "upstream_fetch_failed",
          code: isAbort ? "upstream_timeout" : "upstream_fetch_failed",
          message: isAbort
            ? "上游服务响应超时，请稍后重试。"
            : "上游服务连接失败，请稍后重试。",
        },
        504,
        ch,
      );
    }
    const contentType = response.headers.get("content-type") || "";
    if (
      provider === "openrouter" &&
      [401, 402, 403, 429].includes(response.status) &&
      currentOpenRouterKey
    ) {
      markOpenRouterKeyBlocked(currentOpenRouterKey);
      const openRouterKeyPool = getOpenRouterKeyPool();
      if (openRouterKeyPool.length > 1) {
        for (const retryKey of openRouterKeyPool) {
          if (!retryKey || retryKey === currentOpenRouterKey) continue;
          const retryResponse = await fetchWithUpstreamTimeout(
            url,
            {
              method: req.method,
              headers: { ...headers, "Authorization": `Bearer ${retryKey}` },
              body: providerRequestBody,
            },
            upstreamTimeoutMs,
          );
          rateLimitHeaderSources.push(retryResponse.headers);
          if (![401, 402, 403, 429].includes(retryResponse.status)) {
            response = retryResponse;
            break;
          }
          markOpenRouterKeyBlocked(retryKey);
        }
      }
    }
    if (provider === "supxh" && response.status === 429 && currentSupxhKey) {
      markSupxhKeyBlocked(currentSupxhKey);
    }
    const rateLimitHeaders = collectProviderRateLimitHeaders(
      provider,
      rateLimitHeaderSources,
      response,
    );
    const modelCallFinishedMeta = buildUsageLogMeta({
      endpointName,
      activeTurnId,
      requestKind,
      arenaMode,
      arenaSlot,
      arenaMatchId,
      toolName,
      toolIndex,
      provider,
      billable:
        endpointName === "chat" ||
        endpointName === "image" ||
        endpointName === "video",
    });

    // Handle streaming response — line-buffer + sanitize each `data:` frame
    // so upstream model names are rewritten and any inline error frames are
    // masked into a Cancri-formatted error before reaching the browser.
    // For freemodel (OpenAI Responses API), use a translator transform
    // instead so clients keep seeing the standard Chat Completions stream.
    if (contentType.includes("text/event-stream")) {
      recordModelAvailability(availabilityModelId, response.status, ctx);
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      // All providers share the same `{ process, flush }` contract; the
      // implementation differs depending on the upstream protocol.
      //   - pie-xian Messages   → makeAnthropicSseToChatTransform
      //   - pie-xian Responses  → makeFreemodelSseToChatTransform
      //   - supxh claude-opus-4-5 → makeAnthropicSseToChatTransform
      //   - everyone else (incl. freemodel — now native /v1/chat/completions)
      //                         → makeSseSanitizer (passthrough w/ sanitisation)
      const sseSanitizer =
        (provider === "piexian" && isPiexianMessagesModel(model)) ||
        (provider === "supxh" && model === "claude-opus-4-5")
          ? makeAnthropicSseToChatTransform(model)
          : (provider === "piexian" && isPiexianResponsesModel(model)) ||
              provider === "pqgpt"
            ? makeFreemodelSseToChatTransform(model)
            : makeSseSanitizer(model);

      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value, { stream: true });
              const { out, abort } = sseSanitizer.process(text);
              if (out) controller.enqueue(encoder.encode(out));
              if (abort) {
                logSecurityEvent("upstream_sse_error_masked", ctx, {
                  model,
                  provider,
                });
                try {
                  await reader.cancel();
                } catch {
                  /* ignore */
                }
                break;
              }
            }
            const tail = decoder.decode();
            if (tail) {
              const tailRes = sseSanitizer.process(tail);
              if (tailRes.out) controller.enqueue(encoder.encode(tailRes.out));
            }
            const flushed = sseSanitizer.flush();
            if (flushed) controller.enqueue(encoder.encode(flushed));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });

      logSecurityEvent("model_call_finished", ctx, {
        ...modelCallFinishedMeta,
        status: response.status,
        streamed: true,
        durationMs: Math.round(performance.now() - startedAt),
      });

      return new Response(stream, {
        headers: {
          ...ch,
          "Content-Type": "text/event-stream",
          ...rateLimitHeaders,
        },
        status: response.status,
      });
    }

    if (!contentType.includes("json")) {
      const upstreamText = await response.text().catch(() => "");
      recordModelAvailability(availabilityModelId, response.status, ctx, upstreamText);
      // Mask 403 as 502 to avoid hinting that an upstream auth check rejected us.
      const exposedStatus = response.status === 403 ? 502 : response.status;
      logSecurityEvent("model_call_finished", ctx, {
        ...modelCallFinishedMeta,
        status: response.status,
        exposedStatus,
        nonJson: true,
        upstreamContentType: contentType || "none",
        upstreamPreview: upstreamText.slice(0, 480),
        durationMs: Math.round(performance.now() - startedAt),
      });

      return new Response(
        sanitizedErrorJson(response.status, upstreamText, model),
        {
          headers: {
            ...ch,
            "Content-Type": "application/json",
            ...rateLimitHeaders,
          },
          status: exposedStatus,
        },
      );
    }

    // ─── Image fast path ────────────────────────────────────────────
    // Image responses can carry ~3 MB of
    // base64 in a single `b64_json` field. `response.json()` plus the
    // downstream `JSON.stringify(data)` we used to run here burned
    // enough CPU that Supabase killed the function with "Function failed
    // due to not having enough compute resources". Instead read the
    // body once as text, do a cheap regex validation, and return the
    // original bytes — no parse, no re-serialization.
    if (endpointName === "image") {
      let upstreamText = await response.text();
      const isSuccess = response.status >= 200 && response.status < 300;

      // ── Wan 2.7 image-pro response translator ────────────────────────
      // DashScope multimodal-generation returns:
      //   { output: { choices: [{ message: { content: [{image: "https://..."}] } }] }, ... }
      // The chat UI expects OpenAI-compatible `{data:[{url}]}` (the same
      // shape every other image provider returns). Rewrite the body here
      // so the regex fast-path below sees a `"url"` field and so the
      // browser-side `data?.data?.[0]?.url` access lands on the image.
      if (isSuccess && isDashScopeImageModel(model)) {
        try {
          const dsData = JSON.parse(upstreamText);
          const choices = Array.isArray(dsData?.output?.choices)
            ? dsData.output.choices
            : [];
          const urls: string[] = [];
          for (const ch of choices) {
            const content = Array.isArray(ch?.message?.content)
              ? ch.message.content
              : [];
            for (const part of content) {
              const u = String(part?.image || part?.url || "").trim();
              if (u) urls.push(u);
            }
          }
          if (urls.length > 0) {
            upstreamText = JSON.stringify({
              data: urls.map((u) => ({ url: u })),
              model,
              usage: dsData?.usage,
              request_id: dsData?.request_id,
            });
          }
        } catch (err) {
          console.warn(
            `[${model}] failed to parse upstream DashScope image response:`,
            err,
          );
        }
      }

      const hasValidImage =
        /"url"\s*:\s*"[^"]{4,}"/i.test(upstreamText) ||
        /"b64_json"\s*:\s*"[^"]{64,}"/i.test(upstreamText);

      recordModelAvailability(
        availabilityModelId,
        response.status,
        ctx,
        isSuccess ? "" : upstreamText.slice(0, 240),
      );
      logSecurityEvent("model_call_finished", ctx, {
        ...modelCallFinishedMeta,
        status: response.status,
        durationMs: Math.round(performance.now() - startedAt),
      });

      // Upstream 4xx/5xx — log the raw body to security log only and return a
      // generic Cancri error. Do not let chshapi/new-api/etc. error shape leak.
      if (!isSuccess) {
        logSecurityEvent("upstream_error_masked", ctx, {
          model,
          provider,
          upstream_status: response.status,
          upstream_body_preview: upstreamText.slice(0, 480),
        });
        // Searchable console.error tag for diagnosing image upstream 4xx
        // events from the function logs UI.
        // Includes upstream HTTP status + first 500 chars of body so we
        // can spot content_policy / unknown_parameter / quota signatures
        // without redeploying. Tag is intentionally specific.
        console.error(
          "[IMAGE_UPSTREAM_4XX]",
          JSON.stringify({
            model,
            provider,
            status: response.status,
            body: upstreamText.slice(0, 500),
          }),
        );
        // Image error mapping — **structured field whitelist only**. The
        // OpenAI Images API error contract is `{ error: { code, type,
        // message, param } }` where `code` and `type` are enum values
        // from a fixed vocabulary. We do exact-equality matching against
        // those enum values to surface friendly codes for the cases that
        // require user action (edit prompt for content_policy, retry
        // later for quota). Free-text searches against `message` were
        // removed on 2026-05-16 — they're keyword-based, fragile, and
        // bleed upstream wording into our control flow. Anything not in
        // the enum table falls through to status-only classification via
        // sanitizedErrorJson below.
        let imageSpecificError:
          | { code: string; message: string; status: number }
          | null = null;
        try {
          const parsedErr = JSON.parse(upstreamText);
          const errObj = parsedErr?.error ?? parsedErr;
          // Lowercased so we tolerate `Content_Policy_Violation` /
          // `CONTENT_POLICY_VIOLATION` style variants — still equality
          // against a fixed enum vocabulary, not substring/keyword match.
          const codeRaw = String(errObj?.code || "").toLowerCase().trim();
          const typeRaw = String(errObj?.type || "").toLowerCase().trim();
          // OpenAI Images API enum values — see
          // https://platform.openai.com/docs/api-reference/images
          // `content_policy_violation` (DALL·E / gpt-image safety reject),
          // `moderation_blocked` (input moderation), `billing_hard_limit_reached`
          // (account capped), `insufficient_quota` (quota exceeded),
          // `unknown_parameter` / `invalid_request_error` (request shape).
          const CONTENT_POLICY_CODES = new Set([
            "content_policy_violation",
            "moderation_blocked",
            "image_generation_user_error",
          ]);
          const QUOTA_CODES = new Set([
            "billing_hard_limit_reached",
            "insufficient_quota",
            "rate_limit_exceeded",
            "quota_exceeded",
          ]);
          const REQUEST_INVALID_CODES = new Set([
            "unknown_parameter",
            "invalid_request_error",
            "invalid_value",
          ]);
          if (CONTENT_POLICY_CODES.has(codeRaw) || CONTENT_POLICY_CODES.has(typeRaw)) {
            imageSpecificError = {
              code: "image_content_policy",
              message:
                "提示词被内容安全策略拒绝，请修改后重试（避免明确版权角色名 / 真人姓名 / 暴力或不当描述）。",
              status: 400,
            };
          } else if (QUOTA_CODES.has(codeRaw) || QUOTA_CODES.has(typeRaw)) {
            imageSpecificError = {
              code: "model_quota_exceeded",
              message: SANITIZED_ERROR_TEMPLATES.model_quota_exceeded,
              status: 429,
            };
          } else if (REQUEST_INVALID_CODES.has(codeRaw) || REQUEST_INVALID_CODES.has(typeRaw)) {
            imageSpecificError = {
              code: "image_request_invalid",
              message: "请求参数被模型拒绝。已记录，请稍后重试。",
              status: 400,
            };
          }
        } catch {
          /* non-JSON upstream — fall through to generic sanitized error */
        }
        if (imageSpecificError) {
          return new Response(
            JSON.stringify({
              error: imageSpecificError.code,
              code: imageSpecificError.code,
              message: imageSpecificError.message,
            }),
            {
              headers: {
                ...ch,
                "Content-Type": "application/json",
                ...rateLimitHeaders,
              },
              status: imageSpecificError.status,
            },
          );
        }
        return new Response(
          sanitizedErrorJson(response.status, upstreamText, model),
          {
            headers: {
              ...ch,
              "Content-Type": "application/json",
              ...rateLimitHeaders,
            },
            status: response.status,
          },
        );
      }

      if (isSuccess && !hasValidImage) {
        // Only parse the (small) error-shaped body on this cold path — we
        // need revised_prompt and the upstream key list for diagnostics.
        let revisedPrompt = "";
        let upstreamKeys: string[] = [];
        try {
          const parsed = JSON.parse(upstreamText);
          const firstImage = Array.isArray(parsed?.data) ? parsed.data[0] : null;
          revisedPrompt = String(firstImage?.revised_prompt || "");
          upstreamKeys = Object.keys(parsed || {});
        } catch {
          /* non-JSON — leave diagnostics empty */
        }
        logSecurityEvent("image_no_data", ctx, {
          revisedPrompt: revisedPrompt.slice(0, 120),
          upstreamKeys,
        });
        return new Response(
          JSON.stringify({
            error: "image_generation_failed",
            code: "image_generation_failed",
            message:
              "图片生成未返回有效图片。上游可能拒绝了提示词内容或服务暂时不可用。",
            revised_prompt: revisedPrompt || undefined,
          }),
          {
            headers: {
              ...ch,
              "Content-Type": "application/json",
              ...rateLimitHeaders,
            },
            status: 502,
          },
        );
      }

      // Success path — cheap regex rewrite of any `model` field so the
      // upstream's internal id (e.g. routed via xem8k5) never reaches the
      // browser. Avoids parse + re-stringify on the multi-MB b64_json blob.
      return new Response(regexRewriteModel(upstreamText, model), {
        headers: {
          ...ch,
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
        status: response.status,
      });
    }

    // Handle JSON response — read body as text once. The text path lets us
    // (a) cheaply regex-rewrite the `model` field on multi-MB success bodies
    // without parse + re-stringify, and (b) log the raw upstream body to the
    // security log on errors without echoing it to the client.
    const upstreamText = await response.text();
    let data: unknown = null;
    try {
      data = JSON.parse(upstreamText);
    } catch {
      // Upstream said `application/json` but body is malformed — treat as
      // a temporary failure rather than leaking the half-baked text.
      logSecurityEvent("upstream_error_masked", ctx, {
        model,
        provider,
        upstream_status: response.status,
        reason: "json_parse_failed",
        upstream_body_preview: upstreamText.slice(0, 480),
      });
      return new Response(
        sanitizedErrorJson(
          response.status >= 400 ? response.status : 502,
          upstreamText,
          model,
        ),
        {
          headers: {
            ...ch,
            "Content-Type": "application/json",
            ...rateLimitHeaders,
          },
          status: response.status >= 400 ? response.status : 502,
        },
      );
    }

    recordModelAvailability(
      availabilityModelId,
      response.status,
      ctx,
      extractUpstreamErrorText(data),
    );

    logSecurityEvent("model_call_finished", ctx, {
      ...modelCallFinishedMeta,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });

    // Upstream 4xx/5xx — mask the body, route raw to security log only.
    if (response.status >= 400) {
      logSecurityEvent("upstream_error_masked", ctx, {
        model,
        provider,
        upstream_status: response.status,
        upstream_body_preview: upstreamText.slice(0, 480),
      });
      return new Response(
        sanitizedErrorJson(response.status, upstreamText, model),
        {
          headers: {
            ...ch,
            "Content-Type": "application/json",
            ...rateLimitHeaders,
          },
          status: response.status,
        },
      );
    }

    if (
      provider === "aiionly" &&
      (endpointName === "video" || endpointName === "video-task") &&
      data &&
      typeof data === "object"
    ) {
      const dataObj = data as Record<string, unknown>;
      const codeValue = Number(dataObj.code);
      if (Number.isFinite(codeValue) && codeValue !== 200) {
        return new Response(
          JSON.stringify({
            error: "video_generation_failed",
            code: "video_generation_failed",
            message: "视频生成失败，请稍后重试。",
          }),
          {
            headers: {
              ...ch,
              "Content-Type": "application/json",
              ...rateLimitHeaders,
            },
            status: 502,
          },
        );
      }
      let out: Record<string, unknown> = {};
      if (dataObj.data && typeof dataObj.data === "object") {
        out = dataObj.data as Record<string, unknown>;
      } else if (typeof dataObj.data === "string") {
        try {
          const parsed = JSON.parse(dataObj.data);
          if (parsed && typeof parsed === "object") out = parsed;
        } catch {
          out = {};
        }
      }
      const flat: Record<string, unknown> = { ...dataObj, model };
      if (out.task_id != null) flat.task_id = out.task_id;
      if (out.task_status != null) {
        const statusText = String(out.task_status);
        flat.task_status = statusText === "SUCCESS" ? "SUCCEEDED" : statusText;
      }
      const urls = Array.isArray(out.url)
        ? out.url.map((u) => String(u || "").trim()).filter(Boolean)
        : [];
      if (urls.length > 0) {
        flat.video_url = urls[0];
        flat.video_urls = urls;
      }
      delete flat.data;
      return new Response(JSON.stringify(flat), {
        headers: {
          ...ch,
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
        status: response.status,
      });
    }

    // ─── DashScope 视频响应扁平化 ───────────────────────────────
    // DashScope returns:
    //   { request_id, output: { task_id, task_status, video_url? }, usage? }
    // The frontend (and any future API consumer) expects task_id /
    // task_status / video_url at the top level. We hoist them here so
    // chat-gateway can keep doing a dumb passthrough and we don't have
    // to teach the frontend about DashScope's wire shape.
    if (
      (endpointName === "video" || endpointName === "video-task") &&
      data &&
      typeof data === "object" &&
      (data as Record<string, unknown>).output &&
      typeof (data as Record<string, unknown>).output === "object"
    ) {
      const dataObj = data as Record<string, unknown>;
      const out = dataObj.output as Record<string, unknown>;
      const flat: Record<string, unknown> = { ...dataObj, model };
      if (out.task_id != null) flat.task_id = out.task_id;
      if (out.task_status != null) flat.task_status = out.task_status;
      if (out.video_url != null) flat.video_url = out.video_url;
      if (out.submit_time != null) flat.submit_time = out.submit_time;
      if (out.end_time != null) flat.end_time = out.end_time;
      // DashScope surfaces FAILED reasons under output.message / output.code.
      // We **never** echo the upstream text — only the presence/absence
      // of the field is observed, and we substitute a fixed Cancri
      // template. This is keyword-free.
      if (out.message != null && flat.message == null) {
        flat.message = "视频生成失败，请稍后重试。";
      }
      if (out.code != null && flat.code == null) flat.code = "video_generation_failed";
      // Drop the nested `output` to keep the contract clean — anything we
      // need is now at the top level.
      delete flat.output;
      return new Response(JSON.stringify(flat), {
        headers: {
          ...ch,
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
        status: response.status,
      });
    }

    // Pie-xian non-stream Responses API: translate to Chat Completions JSON.
    if (
      (provider === "piexian" && isPiexianResponsesModel(model)) ||
      provider === "pqgpt"
    ) {
      return new Response(freemodelResponseToChat(upstreamText, model), {
        headers: {
          ...ch,
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
        status: response.status,
      });
    }
    // Pie-xian non-stream Anthropic Messages (claude-haiku) and supxh
    // claude-opus-4-5: translate to Chat Completions JSON.
    if (
      (provider === "piexian" && isPiexianMessagesModel(model)) ||
      (provider === "supxh" && model === "claude-opus-4-5")
    ) {
      return new Response(anthropicResponseToChat(upstreamText, model), {
        headers: {
          ...ch,
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
        status: response.status,
      });
    }
    // Legacy freemodel translator block kept as documented dead code.
    if (false && provider === "freemodel") {
      return new Response(freemodelResponseToChat(upstreamText, model), {
        headers: {
          ...ch,
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
        status: response.status,
      });
    }

    // Generic success — same protocol-schema enforcement we apply to SSE
    // chunks (see makeSseSanitizer / reshapeChatChunk above), now to the
    // single-shot Chat Completion JSON. We parse, reshape via the field
    // whitelist, and re-emit. Upstream-only keys (provider, request_id,
    // native_finish_reason, reasoning_details, error_metadata, …) are
    // dropped silently. A non-conformant body (top-level `error`, missing
    // `choices`, non-object) is replaced with a sanitized error frame.
    //
    // The legacy fast-path used `regexRewriteModel(upstreamText)` to skip
    // parse+stringify on multi-MB bodies; we keep that for the image
    // endpoint above (which can carry b64_json blobs), but for chat we
    // need full schema enforcement, so the cost of one parse + stringify
    // is acceptable.
    if (response.status >= 200 && response.status < 300) {
      let parsedJson: unknown = null;
      try {
        parsedJson = JSON.parse(upstreamText);
      } catch {
        // Successful HTTP but unparseable body — upstream protocol
        // violation. Mask as transient.
        logSecurityEvent("upstream_protocol_violation", ctx, {
          model,
          provider,
          path: "non-stream",
          reason: "non_json_2xx",
        });
        return new Response(sanitizedErrorJson(502, "", model), {
          headers: { ...ch, "Content-Type": "application/json", ...rateLimitHeaders },
          status: 502,
        });
      }
      // Chat Completion non-stream: shape is `{id,object:'chat.completion',
      // choices:[{message:{...}}], usage}`. We borrow `reshapeChatChunk`
      // (which expects choices[].delta) by treating the message field as
      // delta-equivalent — same field whitelist applies.
      const reshapedJson = reshapeChatNonStreamJson(parsedJson, model);
      if (reshapedJson === null) {
        logSecurityEvent("upstream_protocol_violation", ctx, {
          model,
          provider,
          path: "non-stream",
          reason: "schema_mismatch",
        });
        return new Response(sanitizedErrorJson(502, "", model), {
          headers: { ...ch, "Content-Type": "application/json", ...rateLimitHeaders },
          status: 502,
        });
      }
      return new Response(JSON.stringify(reshapedJson), {
        headers: { ...ch, "Content-Type": "application/json", ...rateLimitHeaders },
        status: response.status,
      });
    }

    return new Response(regexRewriteModel(upstreamText, model), {
      headers: {
        ...ch,
        "Content-Type": "application/json",
        ...rateLimitHeaders,
      },
      status: response.status,
    });
  } catch (error) {
    const message = sanitizeUpstreamError(error);
    const ctx = await getRequestContext(
      req,
      "modelscope-proxy",
      "unknown",
      "",
      authenticatedUserId,
    );
    logSecurityEvent("model_call_failed", ctx, {
      usage_class: "model_call",
      billable_model_call: false,
      durationMs: Math.round(performance.now() - startedAt),
      error: message.slice(0, 160),
    });
    return new Response(JSON.stringify({ error: "Internal error" }), {
      headers: { ...ch, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
