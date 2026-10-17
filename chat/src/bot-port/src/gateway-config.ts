// 移植自 cancri-code/src/gateway-config.ts（scripts/sync-bot-port.mjs 原样拷贝，勿手改）
/**
 * 后端网关地址、首尔边缘中继、熔断回落。
 *
 * 语义对齐网页 `chat/src/main.js`（directBaseUrl / relayBaseUrl / gatewayFetch）。
 * Worker 经中继只接受：chat-gateway / api-gateway / gen-title / user-memory；
 * 其余 slug（auth、code-completion、ide-skills…）必须走直连。
 */

export const CF_GATEWAY_URL = "https://chat.nexusvai.xyz";
export const EDGE_RELAY_URL = "https://cn.nexusvai.xyz";
export const GATEWAY_API_KEY = "neon-auth-via-cf-shim";

const RELAY_BREAKER_KEY = "cancri_relay_down_until";
const RELAY_BREAKER_MS = 5 * 60 * 1000;
/** 支持侧：localStorage 设为 off 可强制直连 */
const RELAY_DISABLE_KEY = "cancri.edge-relay";

/** 媒体 / 大包体：强制直连（对齐网页 RELAY_EXCLUDED_ENDPOINT_RE） */
const RELAY_EXCLUDED_ENDPOINT_RE =
  /"endpoint"\s*:\s*"(?:image|video|media-download|voice_transcribe|media_generate|media_status)"/;

/** CLI / 无 sessionStorage 时的进程内熔断时刻 */
let memoryBreakerUntil = 0;

function readStorageItem(store: "session" | "local", key: string): string | null {
  try {
    const s = store === "session"
      ? (typeof sessionStorage !== "undefined" ? sessionStorage : null)
      : (typeof localStorage !== "undefined" ? localStorage : null);
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSessionItem(key: string, value: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, value);
  } catch {
    /* 隐私模式：只靠内存 */
  }
}

export function relayDisabled(): boolean {
  return readStorageItem("local", RELAY_DISABLE_KEY) === "off";
}

export function relayDown(): boolean {
  const fromStore = Number(readStorageItem("session", RELAY_BREAKER_KEY) || 0);
  const until = Number.isFinite(fromStore) && fromStore > 0 ? fromStore : memoryBreakerUntil;
  return Number.isFinite(until) && Date.now() < until;
}

export function markRelayDown(reason: string): void {
  const until = Date.now() + RELAY_BREAKER_MS;
  memoryBreakerUntil = until;
  writeSessionItem(RELAY_BREAKER_KEY, String(until));
  console.warn("[edge-relay] 已切回直连，原因:", reason);
}

/** 测试用：清熔断（不改 localStorage 禁用开关） */
export function __resetRelayBreakerForTest(): void {
  memoryBreakerUntil = 0;
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(RELAY_BREAKER_KEY);
  } catch { /* ignore */ }
}

/** 网关调用基址：中继可用则中继，否则直连 */
export function gatewayBaseUrl(): string {
  if (relayDisabled() || relayDown()) return CF_GATEWAY_URL;
  return EDGE_RELAY_URL;
}

/** chat-gateway 完整 URL（含 path） */
export function chatGatewayEndpoint(): string {
  return `${gatewayBaseUrl()}/functions/v1/chat-gateway`;
}

/** 直连 chat-gateway（媒体 / 大上传 / 显式 direct） */
export function chatGatewayDirectEndpoint(): string {
  return `${CF_GATEWAY_URL}/functions/v1/chat-gateway`;
}

/** 公开 API（cancri_sk_）直连 Worker 的 OpenAI-compatible 路径 */
export const API_GATEWAY_DIRECT_CHAT =
  `${CF_GATEWAY_URL}/functions/v1/api-gateway/v1/chat/completions`;

/**
 * 中继 URL → 直连 URL。
 * `cn…/v1/*` 不是 chat. 上的同名路径：nginx `/v1/` 才转到 api-gateway，
 * Worker 直连必须带 `/functions/v1/api-gateway` 前缀。
 */
export function relayToDirectUrl(target: string): string {
  if (!target.startsWith(EDGE_RELAY_URL)) return target;
  const path = target.slice(EDGE_RELAY_URL.length);
  if (path.startsWith("/v1/")) {
    return `${CF_GATEWAY_URL}/functions/v1/api-gateway${path}`;
  }
  return `${CF_GATEWAY_URL}${path}`;
}

/**
 * 内置模型走 API Key 时的 completions URL。
 * 国内默认 `https://cn.nexusvai.xyz/v1/chat/completions`；熔断后直连 Worker。
 */
export function apiGatewayChatCompletionsUrl(): string {
  if (relayDisabled() || relayDown()) return API_GATEWAY_DIRECT_CHAT;
  return `${EDGE_RELAY_URL}/v1/chat/completions`;
}

type HeaderSource =
  | Headers
  | { get(name: string): string | null }
  | Record<string, string>
  | null
  | undefined;

function headerGet(headers: HeaderSource, name: string): string {
  if (!headers) return "";
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) || (headers as Headers).get(name.toLowerCase()) || "";
  }
  const rec = headers as Record<string, string>;
  return rec[name] || rec[name.toLowerCase()] || "";
}

/**
 * 中继故障判据（对齐网页 looksLikeRelayOutage）。
 * ⛔ 429 + X-Cancri-Relay-Limited 不是故障（刻意限流，勿开熔断）。
 * Rust 流无响应头时用 body 是否 JSON 兜底。
 */
export function looksLikeRelayOutage(
  status: number,
  headers?: HeaderSource,
  bodyText?: string,
): boolean {
  if (headerGet(headers, "x-cancri-relay-error") === "1") return true;
  if (status < 400) return false;
  const ct = headerGet(headers, "content-type");
  if (ct) return !ct.includes("json");
  if (bodyText != null) {
    const t = bodyText.trim();
    if (!t) return true;
    try {
      JSON.parse(t);
      return false;
    } catch {
      return true;
    }
  }
  return false;
}

/** 解析 Retry-After（秒）→ ms；非法 / 缺省 → undefined */
export function parseRetryAfterMs(headers?: HeaderSource): number | undefined {
  const raw = headerGet(headers, "retry-after").trim();
  if (!raw) return undefined;
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < 0) return undefined;
  return Math.round(sec * 1000);
}

function bodyWantsDirectGateway(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string" || !body) return false;
  return RELAY_EXCLUDED_ENDPOINT_RE.test(body.slice(0, 512));
}

export interface GatewayFetchMeta {
  /** 只读幂等：中继故障时立刻改打直连重试一次 */
  idempotent?: boolean;
  /** 强制直连（大上传 / 媒体） */
  direct?: boolean;
}

/**
 * 中继感知的 fetch。仅当 url 落在 EDGE_RELAY_URL 上时启用熔断逻辑；
 * 直连 URL 原样转发。AbortError 不开熔断；非幂等请求不重放。
 */
export async function gatewayFetch(
  url: string,
  init?: RequestInit,
  meta: GatewayFetchMeta = {},
): Promise<Response> {
  const target = String(url || "");
  const relay = EDGE_RELAY_URL;
  if (!target.startsWith(relay)) return fetch(target, init);
  const direct = relayToDirectUrl(target);
  if (relayDisabled() || relayDown() || meta.direct || bodyWantsDirectGateway(init?.body ?? null)) {
    return fetch(direct, init);
  }
  let resp: Response;
  try {
    resp = await fetch(target, init);
  } catch (err) {
    if (err && typeof err === "object" && (err as { name?: string }).name === "AbortError") throw err;
    markRelayDown(err && typeof err === "object" && "name" in err
      ? String((err as { name: string }).name)
      : "network_error");
    if (meta.idempotent) return fetch(direct, init);
    throw err;
  }
  if (looksLikeRelayOutage(resp.status, resp.headers)) {
    markRelayDown(`relay_http_${resp.status}`);
    if (meta.idempotent) return fetch(direct, init);
  }
  return resp;
}

/** 把超时与调用方 signal 合成；优先 AbortSignal.any */
export function withTimeoutSignal(ms: number, outer?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!outer) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([outer, timeout]);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(outer.reason);
  if (outer.aborted) ctrl.abort(outer.reason);
  else outer.addEventListener("abort", onAbort, { once: true });
  timeout.addEventListener("abort", () => ctrl.abort(timeout.reason), { once: true });
  return ctrl.signal;
}
