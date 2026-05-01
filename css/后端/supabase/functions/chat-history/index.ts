import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function normalizeAllowedOrigin(value: string): string {
  const clean = value.trim().replace(/\/+$/, '')
  if (!clean) return ''
  try {
    return new URL(clean).origin
  } catch {
    return clean
  }
}

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || 'https://nexusvai.github.io').split(',').map(normalizeAllowedOrigin).filter(Boolean)
const PROXY_AUTH_TOKEN = (Deno.env.get('PROXY_AUTH_TOKEN') || '').trim()

function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin') || ''
  if (!origin) return null
  if (ALLOWED_ORIGINS.some((allowed: string) => origin === allowed)) return origin
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  return null
}

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = getAllowedOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin || ALLOWED_ORIGINS[0] || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id, x-api-key, x-proxy-token, accept, origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }
}

const abuseMap = new Map<string, { count: number; resetAt: number; lastAt: number; rapidHits: number; challengeUntil: number; blockedUntil: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60
const CHALLENGE_DURATION_MS = 10 * 60_000
const BLOCK_DURATION_MS = 60 * 60_000
const RAPID_REQUEST_MS = 500
const MAX_REQUEST_BYTES = 2 * 1024 * 1024

interface RequestContext {
  service: string
  endpoint: string
  ip: string
  device: string
  user: string
  origin: string
}

function cleanHeader(value: string | null): string {
  return String(value || '').replace(/[\r\n\t]/g, '').trim()
}

function getClientIp(req: Request): string {
  const cfIp = cleanHeader(req.headers.get('cf-connecting-ip'))
  if (cfIp) return cfIp
  const forwardedFor = cleanHeader(req.headers.get('x-forwarded-for'))
  if (forwardedFor) {
    const first = forwardedFor.split(',').map(item => item.trim()).find(Boolean)
    if (first) return first
  }
  return cleanHeader(req.headers.get('x-real-ip')) || 'unknown'
}

function maskIdentifier(value: string): string {
  const clean = cleanHeader(value)
  if (!clean) return 'anonymous'
  if (clean.length <= 10) return clean
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`
}

function getRequestContext(req: Request, service: string, endpoint = 'unknown'): RequestContext {
  const ip = getClientIp(req)
  const user = cleanHeader(req.headers.get('x-user-id')) || cleanHeader(req.headers.get('x-api-key'))
  const ua = cleanHeader(req.headers.get('user-agent')).slice(0, 96) || 'unknown'
  return {
    service,
    endpoint: cleanHeader(endpoint) || 'unknown',
    ip,
    device: `${ip}|ua:${maskIdentifier(ua)}|user:${maskIdentifier(user)}`,
    user: maskIdentifier(user),
    origin: cleanHeader(req.headers.get('origin')) || 'none',
  }
}

function logSecurityEvent(event: string, ctx: RequestContext, extra: Record<string, unknown> = {}): void {
  console.info(`[security] ${JSON.stringify({ event, time: new Date().toISOString(), ...ctx, ...extra })}`)
}

function jsonResponse(payload: Record<string, unknown>, status: number, ch: Record<string, string>, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...ch, ...extraHeaders, 'Content-Type': 'application/json' },
  })
}

function rejectDisallowedOrigin(req: Request, ch: Record<string, string>): Response | null {
  if (getAllowedOrigin(req)) return null
  return jsonResponse({ error: 'Origin not allowed', code: 'origin_not_allowed' }, 403, ch)
}

function inspectAbuseScope(key: string, max: number): { ok: true } | { ok: false; action: 'challenge' | 'block'; reason: string; retryAfter: number } {
  const now = Date.now()
  const entry = abuseMap.get(key) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS, lastAt: 0, rapidHits: 0, challengeUntil: 0, blockedUntil: 0 }
  if (entry.blockedUntil > now) {
    return { ok: false, action: 'block', reason: 'blocked', retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) }
  }

  if (!entry || now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + RATE_LIMIT_WINDOW_MS
    entry.rapidHits = Math.max(0, entry.rapidHits - 1)
  }

  const interval = entry.lastAt ? now - entry.lastAt : Number.POSITIVE_INFINITY
  if (interval < RAPID_REQUEST_MS) {
    entry.rapidHits += 1
  } else {
    entry.rapidHits = Math.max(0, entry.rapidHits - 1)
  }
  entry.count += 1
  entry.lastAt = now
  abuseMap.set(key, entry)

  const limitHit = entry.count > max
  const speedHit = entry.rapidHits >= 6
  if (entry.challengeUntil > now) {
    if (limitHit || speedHit || interval < RAPID_REQUEST_MS) {
      entry.blockedUntil = now + BLOCK_DURATION_MS
      abuseMap.set(key, entry)
      return { ok: false, action: 'block', reason: limitHit ? 'challenge_limit_repeat' : 'challenge_speed_repeat', retryAfter: Math.ceil(BLOCK_DURATION_MS / 1000) }
    }
    return { ok: false, action: 'challenge', reason: 'challenge_required', retryAfter: Math.ceil((entry.challengeUntil - now) / 1000) }
  }

  if (limitHit || speedHit) {
    entry.challengeUntil = now + CHALLENGE_DURATION_MS
    abuseMap.set(key, entry)
    return { ok: false, action: 'challenge', reason: limitHit ? 'rate_limit' : 'rapid_requests', retryAfter: Math.ceil(CHALLENGE_DURATION_MS / 1000) }
  }

  return { ok: true }
}

function enforceAbuseGuard(ctx: RequestContext, ch: Record<string, string>): Response | null {
  const scopes = [
    `ip:${ctx.endpoint}:${ctx.ip}`,
    `device:${ctx.endpoint}:${ctx.device}`,
    `user:${ctx.endpoint}:${ctx.user}`,
  ]

  for (const scope of scopes) {
    const result = inspectAbuseScope(scope, RATE_LIMIT_MAX)
    if (result.ok) continue
    logSecurityEvent(result.action, ctx, { reason: result.reason, retryAfter: result.retryAfter })
    if (result.action === 'block') {
      return jsonResponse({
        error: 'access_blocked',
        code: 'access_blocked',
        message: '检测到异常高频请求，已暂时停止为此 IP 提供聊天记录服务。',
        retry_after_seconds: result.retryAfter,
      }, 403, ch, { 'Retry-After': String(result.retryAfter) })
    }
    return jsonResponse({
      error: 'challenge_required',
      code: 'challenge_required',
      message: '检测到异常发送速度。出于公平使用，本次请求需要安全验证或稍后重试。',
      retry_after_seconds: result.retryAfter,
    }, 403, ch, { 'Retry-After': String(result.retryAfter) })
  }

  return null
}

function rejectOversizedRequest(req: Request, ch: Record<string, string>, ctx: RequestContext): Response | null {
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    logSecurityEvent('request_rejected', ctx, { reason: 'payload_too_large', contentLength })
    return jsonResponse({ error: 'Payload too large' }, 413, ch)
  }
  return null
}

function validateProxyAuth(req: Request): boolean {
  if (!PROXY_AUTH_TOKEN) return true
  const token = req.headers.get('x-proxy-token') || ''
  return token === PROXY_AUTH_TOKEN
}

serve(async (req: Request) => {
  const ch = corsHeadersFor(req)
  const startedAt = performance.now()
  const originResponse = rejectDisallowedOrigin(req, ch)
  if (originResponse) return originResponse

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ch });
  }

  try {
    const { method } = req;
    const url = new URL(req.url);
    const userId = req.headers.get('x-user-id');
    const apiKey = req.headers.get('x-api-key');
    const ctx = getRequestContext(req, 'chat-history', method.toLowerCase())
    const oversized = rejectOversizedRequest(req, ch, ctx)
    if (oversized) return oversized

    if (!userId && !apiKey) {
      logSecurityEvent('request_rejected', ctx, { reason: 'missing_user_identification' })
      return new Response(
        JSON.stringify({ error: 'Missing user identification' }),
        { status: 401, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveUserId = userId || apiKey;
    const abuseResponse = enforceAbuseGuard(ctx, ch)
    if (abuseResponse) return abuseResponse
    logSecurityEvent('request_started', ctx, { method })

    if (!supabaseUrl || !supabaseServiceKey) {
      logSecurityEvent('request_rejected', ctx, { reason: 'service_not_configured' })
      return new Response(
        JSON.stringify({ error: 'Service not configured' }),
        { status: 500, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (method === 'GET') {
      const id = url.searchParams.get('id');

      if (id) {
        const { data, error } = await supabase
          .from('chat_history')
          .select('*')
          .eq('id', id)
          .eq('user_id', effectiveUserId)
          .single();

        if (error) throw error;

        logSecurityEvent('request_finished', ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) })
        return new Response(
          JSON.stringify({ data }),
          { status: 200, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      } else {
        const { data, error } = await supabase
          .from('chat_history')
          .select('id, title, model, created_at, updated_at')
          .eq('user_id', effectiveUserId)
          .order('updated_at', { ascending: false });

        if (error) throw error;

        logSecurityEvent('request_finished', ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) })
        return new Response(
          JSON.stringify({ data }),
          { status: 200, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (method === 'POST') {
      const body = await req.json();
      const { title, messages, model } = body;
      if (!Array.isArray(messages) || JSON.stringify(messages).length > MAX_REQUEST_BYTES) {
        logSecurityEvent('request_rejected', ctx, { reason: 'invalid_messages_payload' })
        return new Response(
          JSON.stringify({ error: 'Invalid messages payload' }),
          { status: 400, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      }

      const { data, error } = await supabase
        .from('chat_history')
        .insert({
          user_id: effectiveUserId,
          title: title || '新对话',
          messages: messages || [],
          model: model || 'deepseek-v4'
        })
        .select()
        .single();

      if (error) throw error;

      logSecurityEvent('request_finished', ctx, { status: 201, durationMs: Math.round(performance.now() - startedAt) })
      return new Response(
        JSON.stringify({ data }),
        { status: 201, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'PUT') {
      const body = await req.json();
      const { id, messages, title } = body;
      if (!id || !Array.isArray(messages) || JSON.stringify(messages).length > MAX_REQUEST_BYTES) {
        logSecurityEvent('request_rejected', ctx, { reason: 'invalid_update_payload' })
        return new Response(
          JSON.stringify({ error: 'Invalid update payload' }),
          { status: 400, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      }

      const { data, error } = await supabase
        .from('chat_history')
        .update({
          messages,
          title
        })
        .eq('id', id)
        .eq('user_id', effectiveUserId)
        .select()
        .single();

      if (error) throw error;

      logSecurityEvent('request_finished', ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) })
      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'DELETE') {
      const id = url.searchParams.get('id');

      if (!id) {
        logSecurityEvent('request_rejected', ctx, { reason: 'missing_chat_history_id' })
        return new Response(
          JSON.stringify({ error: 'Missing chat history id' }),
          { status: 400, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      }

      const { data: deletedRows, error } = await supabase
        .from('chat_history')
        .delete()
        .select('id')
        .eq('id', id)
        .eq('user_id', effectiveUserId);

      if (error) throw error;

      if (!deletedRows || deletedRows.length === 0) {
        logSecurityEvent('request_finished', ctx, { status: 404, durationMs: Math.round(performance.now() - startedAt) })
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      }

      logSecurityEvent('request_finished', ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) })
      return new Response(
        JSON.stringify({ success: true, deletedCount: deletedRows.length }),
        { status: 200, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    logSecurityEvent('request_finished', ctx, { status: 405, durationMs: Math.round(performance.now() - startedAt) })
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...ch, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const ctx = getRequestContext(req, 'chat-history')
    const message = error instanceof Error ? error.message : String(error)
    logSecurityEvent('request_failed', ctx, { durationMs: Math.round(performance.now() - startedAt), error: message.slice(0, 160) })
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' } }
    );
  }
});
