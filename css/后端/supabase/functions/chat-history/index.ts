import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

function readSupabaseKeyDict(name: string): Record<string, string> {
  const raw = Deno.env.get(name) || '{}'
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function firstKey(dict: Record<string, string>): string {
  return dict.default || Object.values(dict)[0] || ''
}

const supabaseAnonKey = firstKey(readSupabaseKeyDict('SUPABASE_PUBLISHABLE_KEYS'))
const supabaseSecretKey = firstKey(readSupabaseKeyDict('SUPABASE_SECRET_KEYS'))

function normalizeAllowedOrigin(value: string): string {
  const clean = value.trim().replace(/\/+$/, "");
  if (!clean) return "";
  try {
    return new URL(clean).origin;
  } catch {
    return clean;
  }
}

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://nexusvai.github.io")
  .split(",")
  .map(normalizeAllowedOrigin)
  .filter(Boolean);

function cleanHeader(value: string | null): string {
  return String(value || "").replace(/[\r\n\t]/g, "").trim();
}

function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin") || "";
  if (!origin) return null;
  if (ALLOWED_ORIGINS.some((allowed: string) => origin === allowed)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = getAllowedOrigin(req);
  return {
    "Access-Control-Allow-Origin": origin || ALLOWED_ORIGINS[0] || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept, origin, x-supabase-auth",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(payload: Record<string, unknown>, status: number, ch: Record<string, string>, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...ch, ...extraHeaders, "Content-Type": "application/json" },
  });
}

function isInternalGatewayRequest(req: Request): boolean {
  const internalSecret = cleanHeader(req.headers.get("x-internal-secret"));
  return Boolean(supabaseSecretKey && internalSecret === supabaseSecretKey);
}

function getTrustedGatewayHeader(req: Request, name: string): string {
  if (!isInternalGatewayRequest(req)) return "";
  return cleanHeader(req.headers.get(name));
}

function rejectDisallowedOrigin(req: Request, ch: Record<string, string>): Response | null {
  if (getAllowedOrigin(req) || isInternalGatewayRequest(req)) return null;
  return jsonResponse({ error: "Origin not allowed", code: "origin_not_allowed" }, 403, ch);
}

function getClientIp(req: Request): string {
  const gatewayIp = getTrustedGatewayHeader(req, "x-cancri-client-ip");
  if (gatewayIp) return gatewayIp;
  const cfIp = cleanHeader(req.headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;
  const forwardedFor = cleanHeader(req.headers.get("x-forwarded-for"));
  if (forwardedFor) {
    const first = forwardedFor.split(",").map(item => item.trim()).find(Boolean);
    if (first) return first;
  }
  return cleanHeader(req.headers.get("x-real-ip")) || "unknown";
}

function maskIdentifier(value: string): string {
  const clean = cleanHeader(value);
  if (!clean) return "anonymous";
  if (clean.length <= 10) return clean;
  return `${clean.slice(0, 6)}...${clean.slice(-4)}`;
}

function getBearerToken(req: Request): string {
  const custom = cleanHeader(req.headers.get("x-supabase-auth"));
  const customMatch = custom.match(/^Bearer\s+(.+)$/i);
  if (customMatch?.[1]?.trim()) return customMatch[1].trim();
  const authorization = cleanHeader(req.headers.get("authorization"));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function decodeJwtSubject(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    return cleanHeader(typeof parsed?.sub === "string" ? parsed.sub : "");
  } catch {
    return "";
  }
}

interface RequestContext {
  service: string;
  endpoint: string;
  ip: string;
  device: string;
  user: string;
  origin: string;
}

function getRequestContext(req: Request, service: string, endpoint = "unknown", userId = ""): RequestContext {
  const ip = getClientIp(req);
  const jwtUser = userId || decodeJwtSubject(getBearerToken(req));
  const ua = (getTrustedGatewayHeader(req, "x-cancri-client-ua") || cleanHeader(req.headers.get("user-agent"))).slice(0, 96) || "unknown";
  const origin = getTrustedGatewayHeader(req, "x-cancri-client-origin") || cleanHeader(req.headers.get("origin")) || "none";
  return {
    service,
    endpoint: cleanHeader(endpoint) || "unknown",
    ip,
    device: `${ip}|ua:${maskIdentifier(ua)}|user:${maskIdentifier(jwtUser)}`,
    user: maskIdentifier(jwtUser),
    origin,
  };
}

function logSecurityEvent(event: string, ctx: RequestContext, extra: Record<string, unknown> = {}): void {
  console.info(`[security] ${JSON.stringify({ event, time: new Date().toISOString(), ...ctx, ...extra })}`);
}

const abuseMap = new Map<string, { count: number; resetAt: number; lastAt: number; rapidHits: number; challengeUntil: number; blockedUntil: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const CHALLENGE_DURATION_MS = 10 * 60_000;
const BLOCK_DURATION_MS = 60 * 60_000;
const RAPID_REQUEST_MS = 500;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function inspectAbuseScope(key: string, max: number): { ok: true } | { ok: false; action: "challenge" | "block"; reason: string; retryAfter: number } {
  const now = Date.now();
  const entry = abuseMap.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS, lastAt: 0, rapidHits: 0, challengeUntil: 0, blockedUntil: 0 };
  if (entry.blockedUntil > now) {
    return { ok: false, action: "block", reason: "blocked", retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    entry.rapidHits = Math.max(0, entry.rapidHits - 1);
  }
  const interval = entry.lastAt ? now - entry.lastAt : Number.POSITIVE_INFINITY;
  entry.rapidHits = interval < RAPID_REQUEST_MS ? entry.rapidHits + 1 : Math.max(0, entry.rapidHits - 1);
  entry.count += 1;
  entry.lastAt = now;
  abuseMap.set(key, entry);

  const limitHit = entry.count > max;
  const speedHit = entry.rapidHits >= 6;
  if (entry.challengeUntil > now) {
    if (limitHit || speedHit || interval < RAPID_REQUEST_MS) {
      entry.blockedUntil = now + BLOCK_DURATION_MS;
      abuseMap.set(key, entry);
      return { ok: false, action: "block", reason: limitHit ? "challenge_limit_repeat" : "challenge_speed_repeat", retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000) };
    }
    return { ok: false, action: "challenge", reason: "challenge_required", retryAfter: Math.ceil((entry.challengeUntil - now) / 1000) };
  }
  if (limitHit || speedHit) {
    entry.challengeUntil = now + CHALLENGE_DURATION_MS;
    abuseMap.set(key, entry);
    return { ok: false, action: "challenge", reason: limitHit ? "rate_limit" : "rapid_requests", retryAfter: Math.ceil(CHALLENGE_DURATION_MS / 1000) };
  }
  return { ok: true };
}

function enforceAbuseGuard(ctx: RequestContext, ch: Record<string, string>): Response | null {
  const scopes = [
    `ip:${ctx.endpoint}:${ctx.ip}`,
    `device:${ctx.endpoint}:${ctx.device}`,
    `user:${ctx.endpoint}:${ctx.user}`,
  ];
  for (const scope of scopes) {
    const result = inspectAbuseScope(scope, RATE_LIMIT_MAX);
    if (result.ok) continue;
    logSecurityEvent(result.action, ctx, { reason: result.reason, retryAfter: result.retryAfter });
    return jsonResponse({
      error: result.action === "block" ? "access_blocked" : "challenge_required",
      code: result.action === "block" ? "access_blocked" : "challenge_required",
      message: result.action === "block" ? "检测到异常高频请求，已暂时停止服务。" : "检测到异常请求速度，请稍后重试。",
      retry_after_seconds: result.retryAfter,
    }, 403, ch, { "Retry-After": String(result.retryAfter) });
  }
  return null;
}

function rejectOversizedRequest(req: Request, ch: Record<string, string>, ctx: RequestContext): Response | null {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    logSecurityEvent("request_rejected", ctx, { reason: "payload_too_large", contentLength });
    return jsonResponse({ error: "Payload too large", code: "payload_too_large" }, 413, ch);
  }
  return null;
}

async function createUserScopedClient(req: Request, ch: Record<string, string>, ctx: RequestContext): Promise<
  { ok: true; supabase: SupabaseClient; userId: string } | { ok: false; response: Response }
> {
  if (!supabaseUrl || !supabaseAnonKey) {
    logSecurityEvent("request_rejected", ctx, { reason: "service_not_configured" });
    return { ok: false, response: jsonResponse({ error: "Service not configured", code: "service_not_configured" }, 500, ch) };
  }

  const jwt = getBearerToken(req);
  if (!jwt) {
    logSecurityEvent("request_rejected", ctx, { reason: "missing_authorization" });
    return { ok: false, response: jsonResponse({ error: "Missing Authorization bearer token", code: "missing_authorization" }, 401, ch) };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user?.id) {
    logSecurityEvent("request_rejected", ctx, { reason: "invalid_jwt", detail: error?.message || "no_user" });
    return { ok: false, response: jsonResponse({ error: "Invalid session", code: "invalid_session" }, 401, ch) };
  }
  const forwardedUserId = getTrustedGatewayHeader(req, "x-forwarded-user-id");
  if (forwardedUserId && forwardedUserId !== data.user.id) {
    logSecurityEvent("request_rejected", ctx, { reason: "user_mismatch" });
    return { ok: false, response: jsonResponse({ error: "Invalid session", code: "invalid_session" }, 401, ch) };
  }
  return { ok: true, supabase, userId: data.user.id };
}

function normalizeTitle(value: unknown): string {
  const title = String(value || "").trim();
  return title ? title.slice(0, 120) : "新对话";
}

serve(async (req: Request) => {
  const ch = corsHeadersFor(req);
  const startedAt = performance.now();
  const originResponse = rejectDisallowedOrigin(req, ch);
  if (originResponse) return originResponse;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ch });
  }

  const method = req.method;
  const url = new URL(req.url);
  const baseCtx = getRequestContext(req, "chat-history", method.toLowerCase());

  try {
    const oversized = rejectOversizedRequest(req, ch, baseCtx);
    if (oversized) return oversized;

    const scoped = await createUserScopedClient(req, ch, baseCtx);
    if (!scoped.ok) return scoped.response;
    const { supabase, userId } = scoped;
    const ctx = getRequestContext(req, "chat-history", method.toLowerCase(), userId);
    const abuseResponse = enforceAbuseGuard(ctx, ch);
    if (abuseResponse) return abuseResponse;
    logSecurityEvent("request_started", ctx, { method });

    if (method === "GET") {
      const id = url.searchParams.get("id");
      if (id) {
        const { data, error } = await supabase
          .from("chat_history")
          .select("*")
          .eq("id", id)
          .eq("owner_id", userId)
          .maybeSingle();

        if (error) throw error;
        if (!data) return jsonResponse({ error: "Not found", code: "not_found" }, 404, ch);

        logSecurityEvent("request_finished", ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) });
        return jsonResponse({ data }, 200, ch);
      }

      const { data, error } = await supabase
        .from("chat_history")
        .select("id, title, model, created_at, updated_at")
        .eq("owner_id", userId)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      logSecurityEvent("request_finished", ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) });
      return jsonResponse({ data: data || [] }, 200, ch);
    }

    if (method === "POST") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const messages = body.messages;
      if (!Array.isArray(messages) || JSON.stringify(messages).length > MAX_REQUEST_BYTES) {
        logSecurityEvent("request_rejected", ctx, { reason: "invalid_messages_payload" });
        return jsonResponse({ error: "Invalid messages payload", code: "invalid_messages_payload" }, 400, ch);
      }

      const { data, error } = await supabase
        .from("chat_history")
        .insert({
          owner_id: userId,
          user_id: userId,
          title: normalizeTitle(body.title),
          messages,
          model: String(body.model || "deepseek-v4-flash").slice(0, 120),
        })
        .select()
        .single();

      if (error) throw error;
      logSecurityEvent("request_finished", ctx, { status: 201, durationMs: Math.round(performance.now() - startedAt) });
      return jsonResponse({ data }, 201, ch);
    }

    if (method === "PUT") {
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      const id = String(body.id || "").trim();
      const messages = body.messages;
      if (!id || !Array.isArray(messages) || JSON.stringify(messages).length > MAX_REQUEST_BYTES) {
        logSecurityEvent("request_rejected", ctx, { reason: "invalid_update_payload" });
        return jsonResponse({ error: "Invalid update payload", code: "invalid_update_payload" }, 400, ch);
      }

      const { data, error } = await supabase
        .from("chat_history")
        .update({
          messages,
          title: normalizeTitle(body.title),
        })
        .eq("id", id)
        .eq("owner_id", userId)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) return jsonResponse({ error: "Not found", code: "not_found" }, 404, ch);

      logSecurityEvent("request_finished", ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) });
      return jsonResponse({ data }, 200, ch);
    }

    if (method === "DELETE") {
      const id = String(url.searchParams.get("id") || "").trim();
      if (!id) {
        logSecurityEvent("request_rejected", ctx, { reason: "missing_chat_history_id" });
        return jsonResponse({ error: "Missing chat history id", code: "missing_chat_history_id" }, 400, ch);
      }

      const { data: deletedRows, error } = await supabase
        .from("chat_history")
        .delete()
        .select("id")
        .eq("id", id)
        .eq("owner_id", userId);

      if (error) throw error;
      if (!deletedRows || deletedRows.length === 0) {
        logSecurityEvent("request_finished", ctx, { status: 404, durationMs: Math.round(performance.now() - startedAt) });
        return jsonResponse({ error: "Not found", code: "not_found" }, 404, ch);
      }

      logSecurityEvent("request_finished", ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) });
      return jsonResponse({ success: true, deletedCount: deletedRows.length }, 200, ch);
    }

    logSecurityEvent("request_finished", ctx, { status: 405, durationMs: Math.round(performance.now() - startedAt) });
    return jsonResponse({ error: "Method not allowed", code: "method_not_allowed" }, 405, ch);
  } catch (error) {
    logSecurityEvent("request_failed", baseCtx, { error: error instanceof Error ? error.message : String(error), durationMs: Math.round(performance.now() - startedAt) });
    return jsonResponse({ error: "Internal server error", code: "internal_error" }, 500, ch);
  }
});
