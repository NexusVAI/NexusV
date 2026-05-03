/// <reference lib="dom" />
/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

type JsonObject = Record<string, unknown>

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
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '')

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

const SUPABASE_PUBLISHABLE_KEY = firstKey(readSupabaseKeyDict('SUPABASE_PUBLISHABLE_KEYS'))
const SUPABASE_SECRET_KEY = firstKey(readSupabaseKeyDict('SUPABASE_SECRET_KEYS'))

function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin') || ''
  if (!origin) return null
  if (ALLOWED_ORIGINS.some(allowed => origin === allowed)) return origin
  return null
}

const BANNED_IPS = new Set([
  '18.141.169.136', '47.130.152.123', '84.20.17.72', '110.248.68.12', '112.65.37.61', '113.13.223.225',
  '114.103.210.205', '5.34.220.150',
  '192.3.209.49', '137.184.239.207', '173.242.127.138', '31.172.69.16',
  '89.125.244.207', '138.2.31.37',
  '113.224.60.216',
])
const BANNED_USERS = new Set([
  '2613bd…a797', '804f13…edcd',
  '2787e3…62f9', 'eda2e7…fd73', '92c7a6…94a0',
])

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = getAllowedOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin || ALLOWED_ORIGINS[0] || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, accept, origin, x-chat-turn-id, x-supabase-auth',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'x-gateway-build, x-cancri-user-limit, x-cancri-user-remaining, x-cancri-model-limit, x-cancri-model-remaining, retry-after',
    'X-Gateway-Build': 'internal-headers-auth-0503',
  }
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
  if (!value) return 'anonymous'
  if (value.length <= 10) return value
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

function checkBanned(req: Request, jwt: string, ch: Record<string, string>): Response | null {
  const ip = getClientIp(req)
  const userId = decodeJwtSubject(jwt)
  if (BANNED_IPS.has(ip)) {
    console.log(JSON.stringify({ event: 'banned_ip', ip }))
    return jsonResponse({
      error: 'access_blocked',
      code: 'access_blocked',
      message: '访问被拒绝',
    }, 403, ch)
  }
  if (userId && BANNED_USERS.has(userId)) {
    console.log(JSON.stringify({ event: 'banned_user', ip, userId: maskIdentifier(userId) }))
    return jsonResponse({
      error: 'access_blocked',
      code: 'access_blocked',
      message: '访问被拒绝',
    }, 403, ch)
  }
  return null
}

function getBearerToken(req: Request): string {
  // 优先从自定义 header 读取，避免 Origin + Authorization 同时存在触发 Cloudflare Error 1000
  const custom = cleanHeader(req.headers.get('x-supabase-auth'))
  const customMatch = custom.match(/^Bearer\s+(.+)$/i)
  if (customMatch?.[1]?.trim()) return customMatch[1].trim()
  const authorization = cleanHeader(req.headers.get('authorization'))
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || ''
}

function decodeJwtSubject(token: string): string {
  try {
    const payload = token.split('.')[1]
    if (!payload) return ''
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const parsed = JSON.parse(atob(padded))
    return cleanHeader(typeof parsed?.sub === 'string' ? parsed.sub : '')
  } catch {
    return ''
  }
}

function jsonResponse(data: JsonObject, status: number, ch: Record<string, string>, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...ch, ...extraHeaders, 'Content-Type': 'application/json' },
  })
}

function rejectDisallowedOrigin(req: Request, ch: Record<string, string>): Response | null {
  if (getAllowedOrigin(req)) return null
  return jsonResponse({ error: 'Origin not allowed', code: 'origin_not_allowed' }, 403, ch)
}

function functionUrl(name: string): string {
  if (!SUPABASE_URL) return ''
  return `${SUPABASE_URL}/functions/v1/${name}`
}

function appendInternalForwardHeaders(req: Request, headers: Record<string, string>): Record<string, string> {
  const origin = cleanHeader(req.headers.get('origin'))
  const userAgent = cleanHeader(req.headers.get('user-agent'))
  const clientIp = getClientIp(req)
  if (clientIp && clientIp !== 'unknown') headers['X-Cancri-Client-IP'] = clientIp
  if (userAgent) headers['X-Cancri-Client-UA'] = userAgent.slice(0, 160)
  if (origin) headers['X-Cancri-Client-Origin'] = origin
  return headers
}

function cancriHeadersFrom(response: Response, ch: Record<string, string>, contentType = ''): Record<string, string> {
  const headers: Record<string, string> = {
    ...ch,
    'Content-Type': contentType || response.headers.get('content-type') || 'application/json',
    'Cache-Control': 'no-store',
  }

  const mappings = [
    ['x-cancri-user-limit', 'x-cancri-user-limit'],
    ['x-cancri-user-remaining', 'x-cancri-user-remaining'],
    ['x-cancri-model-limit', 'x-cancri-model-limit'],
    ['x-cancri-model-remaining', 'x-cancri-model-remaining'],
    ['modelscope-ratelimit-requests-limit', 'x-cancri-user-limit'],
    ['modelscope-ratelimit-requests-remaining', 'x-cancri-user-remaining'],
    ['modelscope-ratelimit-model-requests-limit', 'x-cancri-model-limit'],
    ['modelscope-ratelimit-model-requests-remaining', 'x-cancri-model-remaining'],
  ] as const

  for (const [source, target] of mappings) {
    const value = response.headers.get(source)
    if (value) headers[target] = value
  }

  const retryAfter = response.headers.get('retry-after')
  if (retryAfter) headers['Retry-After'] = retryAfter
  return headers
}

function sanitizeProxyPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const blocked = new Set(['provider', 'missing', 'api_key', 'route', 'backend', 'base_url', 'probe_endpoint', 'url'])
  const output: JsonObject = {}
  for (const [key, value] of Object.entries(payload as JsonObject)) {
    if (!blocked.has(key)) output[key] = value
  }
  return output
}

async function forwardJsonResponse(response: Response, ch: Record<string, string>, sanitizeProxy = false): Promise<Response> {
  const contentType = response.headers.get('content-type') || 'application/json'
  const headers = cancriHeadersFrom(response, ch, contentType)

  if (contentType.includes('text/event-stream')) {
    return new Response(response.body, { status: response.status, headers })
  }

  const text = await response.text()
  if (sanitizeProxy && contentType.includes('json')) {
    try {
      return new Response(JSON.stringify(sanitizeProxyPayload(JSON.parse(text))), {
        status: response.status,
        headers,
      })
    } catch {
      return new Response(JSON.stringify({ error: 'Upstream response parse failed', code: 'upstream_parse_failed' }), {
        status: 502,
        headers,
      })
    }
  }

  return new Response(text, { status: response.status, headers })
}

async function forwardToModelProxy(req: Request, ch: Record<string, string>, body: JsonObject, userId: string, endpoint: string): Promise<Response> {
  const proxyUrl = functionUrl('modelscope-proxy')
  if (!proxyUrl || !SUPABASE_SECRET_KEY) {
    return jsonResponse({ error: 'Service not configured', code: 'service_not_configured' }, 500, ch)
  }

  const response = await fetch(proxyUrl, {
    method: 'POST',
    headers: appendInternalForwardHeaders(req, {
      'Content-Type': 'application/json',
      'X-Internal-Secret': SUPABASE_SECRET_KEY,
      'X-Forwarded-User-Id': userId,
    }),
    body: JSON.stringify({ ...body, endpoint }),
  })

  return forwardJsonResponse(response, ch, true)
}

async function forwardToWebSearch(req: Request, ch: Record<string, string>, body: JsonObject, endpoint: string, jwt: string, userId: string): Promise<Response> {
  const targetUrl = functionUrl('web-search')
  if (!targetUrl || !jwt) {
    return jsonResponse({ error: 'Invalid session', code: 'invalid_session' }, 401, ch)
  }

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: appendInternalForwardHeaders(req, {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'X-Internal-Secret': SUPABASE_SECRET_KEY,
      'X-Forwarded-User-Id': userId,
      'X-Supabase-Auth': `Bearer ${jwt}`,
    }),
    body: JSON.stringify({ ...body, endpoint }),
  })

  return forwardJsonResponse(response, ch)
}

function chatHistoryForwardRequest(body: JsonObject): { method: string; path: string; payload?: JsonObject } | null {
  const action = cleanHeader(String(body.action || '')).toLowerCase()
  const id = cleanHeader(String(body.id || ''))

  if (action === 'list') {
    return { method: 'GET', path: '' }
  }
  if (action === 'get' && id) {
    return { method: 'GET', path: `?id=${encodeURIComponent(id)}` }
  }
  if (action === 'create') {
    return {
      method: 'POST',
      path: '',
      payload: {
        title: body.title,
        messages: body.messages,
        model: body.model,
      },
    }
  }
  if (action === 'update' && id) {
    return {
      method: 'PUT',
      path: '',
      payload: {
        id,
        title: body.title,
        messages: body.messages,
      },
    }
  }
  if (action === 'delete' && id) {
    return { method: 'DELETE', path: `?id=${encodeURIComponent(id)}` }
  }
  return null
}

async function forwardToChatHistory(req: Request, ch: Record<string, string>, body: JsonObject, jwt: string): Promise<Response> {
  const targetBaseUrl = functionUrl('chat-history')
  const forward = chatHistoryForwardRequest(body)
  if (!targetBaseUrl || !jwt) {
    return jsonResponse({ error: 'Invalid session', code: 'invalid_session' }, 401, ch)
  }
  if (!forward) {
    return jsonResponse({ error: 'Invalid chat history request', code: 'invalid_chat_history_request' }, 400, ch)
  }

  const response = await fetch(`${targetBaseUrl}${forward.path}`, {
    method: forward.method,
    headers: appendInternalForwardHeaders(req, {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'X-Internal-Secret': SUPABASE_SECRET_KEY,
      'X-Forwarded-User-Id': decodeJwtSubject(jwt),
      'X-Supabase-Auth': `Bearer ${jwt}`,
    }),
    body: forward.payload ? JSON.stringify(forward.payload) : undefined,
  })

  return forwardJsonResponse(response, ch)
}

serve(async (req: Request) => {
  const ch = corsHeadersFor(req)
  const originResponse = rejectDisallowedOrigin(req, ch)
  if (originResponse) return originResponse

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ch })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405, ch)
  }

  let body: JsonObject = {}
  let jwt = ''
  try {
    body = await req.json().catch(() => ({} as JsonObject))

    // JWT 优先从 body.__auth_token 读取（绕过 Cloudflare 对长 header 的拦截），其次从 header 读取
    const bodyToken = typeof body.__auth_token === 'string' ? body.__auth_token.trim() : ''
    delete body.__auth_token
    jwt = bodyToken || getBearerToken(req)

    const banned = checkBanned(req, jwt, ch)
    if (banned) return banned

    const userId = decodeJwtSubject(jwt)
    if (!userId) {
      return jsonResponse({ error: 'Invalid session', code: 'invalid_session' }, 401, ch)
    }

    const endpoint = cleanHeader(String(body.endpoint || 'chat')) || 'chat'

    if (endpoint === 'chat_history') {
      return await forwardToChatHistory(req, ch, body, jwt)
    }

    if (endpoint === 'web_search' || endpoint === 'fetch_web_page') {
      return await forwardToWebSearch(req, ch, body, endpoint, jwt, userId)
    }

    if (endpoint === 'chat' || endpoint === 'ping' || endpoint === 'image' || endpoint === 'task') {
      return await forwardToModelProxy(req, ch, body, userId, endpoint)
    }

    return jsonResponse({ error: 'Unknown endpoint', code: 'unknown_endpoint' }, 400, ch)
  } catch (error) {
    console.error('Chat gateway error:', error)
    return jsonResponse({
      error: 'service_unavailable',
      code: 'service_unavailable',
      message: '服务暂时不可用，请稍后重试。',
    }, 503, ch)
  }
})
