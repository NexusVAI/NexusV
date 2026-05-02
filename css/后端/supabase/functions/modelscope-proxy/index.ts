/// <reference lib="dom" />
/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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
  if (ALLOWED_ORIGINS.some(allowed => origin === allowed)) return origin
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  return null
}

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = getAllowedOrigin(req)
  return {
    'Access-Control-Allow-Origin': origin || ALLOWED_ORIGINS[0] || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id, x-api-key, x-proxy-token, accept, origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'modelscope-ratelimit-requests-limit, modelscope-ratelimit-requests-remaining, modelscope-ratelimit-model-requests-limit, modelscope-ratelimit-model-requests-remaining',
  }
}

const abuseMap = new Map<string, { count: number; resetAt: number; lastAt: number; rapidHits: number; challengeUntil: number; blockedUntil: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30
const CHALLENGE_DURATION_MS = 10 * 60_000
const BLOCK_DURATION_MS = 60 * 60_000
const RAPID_REQUEST_MS = 650
const MAX_REQUEST_BYTES = 8 * 1024 * 1024
const MODEL_UNAVAILABLE_WINDOW_MS = 10 * 60_000
const MODEL_UNAVAILABLE_BLOCK_MS = 60 * 60_000
const MODEL_UNAVAILABLE_FAILURE_LIMIT = 3
const modelAvailabilityMap = new Map<string, { failures: number; resetAt: number; blockedUntil: number }>()

interface RequestContext {
  service: string
  endpoint: string
  ip: string
  device: string
  user: string
  origin: string
  model: string
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

function getRequestContext(req: Request, service: string, endpoint = 'unknown', model = ''): RequestContext {
  const ip = getClientIp(req)
  const user = cleanHeader(req.headers.get('x-user-id')) || cleanHeader(req.headers.get('x-api-key'))
  const ua = cleanHeader(req.headers.get('user-agent')).slice(0, 96) || 'unknown'
  return {
    service,
    endpoint: cleanHeader(endpoint) || 'unknown',
    model: cleanHeader(model) || 'unknown',
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

function getEndpointLimit(endpoint: string): number {
  if (endpoint === 'ping') return 120
  if (endpoint === 'web_search') return 12
  if (endpoint === 'image' || endpoint === 'task') return 24
  return RATE_LIMIT_MAX
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
  const speedHit = entry.rapidHits >= 4
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
  const max = getEndpointLimit(ctx.endpoint)
  const scopes = [
    `ip:${ctx.endpoint}:${ctx.ip}`,
    `device:${ctx.endpoint}:${ctx.device}`,
  ]

  for (const scope of scopes) {
    const result = inspectAbuseScope(scope, max)
    if (result.ok) continue
    logSecurityEvent(result.action, ctx, { reason: result.reason, retryAfter: result.retryAfter })
    if (result.action === 'block') {
      return jsonResponse({
        error: 'access_blocked',
        code: 'access_blocked',
        message: '检测到异常高频请求，已暂时停止为此 IP 提供服务。',
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

function getModelBlock(model: string): { retryAfter: number } | null {
  const entry = modelAvailabilityMap.get(model)
  const now = Date.now()
  if (!entry || entry.blockedUntil <= now) return null
  return { retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) }
}

function isModelUnavailableStatus(status: number): boolean {
  return status === 404 || status === 409 || status === 410 || status === 424 || status === 500 || status === 502 || status === 503 || status === 504
}

function recordModelAvailability(model: string, status: number, ctx: RequestContext): void {
  if (!model) return
  const now = Date.now()
  if (status >= 200 && status < 300) {
    modelAvailabilityMap.delete(model)
    return
  }
  if (!isModelUnavailableStatus(status)) return
  const entry = modelAvailabilityMap.get(model) || { failures: 0, resetAt: now + MODEL_UNAVAILABLE_WINDOW_MS, blockedUntil: 0 }
  if (now > entry.resetAt) {
    entry.failures = 0
    entry.resetAt = now + MODEL_UNAVAILABLE_WINDOW_MS
  }
  entry.failures += 1
  if (entry.failures >= MODEL_UNAVAILABLE_FAILURE_LIMIT) {
    entry.blockedUntil = now + MODEL_UNAVAILABLE_BLOCK_MS
    logSecurityEvent('model_blocked', ctx, { model, status, retryAfter: Math.ceil(MODEL_UNAVAILABLE_BLOCK_MS / 1000) })
  }
  modelAvailabilityMap.set(model, entry)
}

function modelBlockedResponse(model: string, retryAfter: number, ch: Record<string, string>): Response {
  return jsonResponse({
    error: 'model_temporarily_unavailable',
    code: 'model_temporarily_unavailable',
    model,
    message: '该模型近期连续不可用，已临时关闭一小时。',
    retry_after_seconds: retryAfter,
  }, 503, ch, { 'Retry-After': String(retryAfter) })
}

function validateProxyAuth(req: Request): boolean {
  if (!PROXY_AUTH_TOKEN) return true
  const token = req.headers.get('x-proxy-token') || ''
  return token === PROXY_AUTH_TOKEN
}

const MODELSCOPE_API_BASE = 'https://api-inference.modelscope.cn/v1'
const MODELSCOPE_API_KEY = (Deno.env.get('MODELSCOPE_API_KEY') || '').trim()
const MODELSCOPE_API_KEY_1 = (Deno.env.get('MODELSCOPE_API_KEY_1') || '').trim()
const MODELSCOPE_API_KEY_2 = (Deno.env.get('MODELSCOPE_API_KEY_2') || '').trim()
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const OPENAI_COMPATIBLE_BASE_URL = (Deno.env.get('OPENAI_COMPATIBLE_BASE_URL') || '').replace(/\/$/, '')
const OPENAI_COMPATIBLE_API_KEY = Deno.env.get('OPENAI_COMPATIBLE_API_KEY') || ''
const MOONSHOT_BASE_URL = (Deno.env.get('MOONSHOT_BASE_URL') || 'https://api.moonshot.cn/v1').replace(/\/$/, '')
const MOONSHOT_API_KEY = Deno.env.get('MOONSHOT_API_KEY') || ''
const MOONSHOT_API_KEY_LINE3 = Deno.env.get('MOONSHOT_API_KEY_LINE3') || ''
let moonshotKeyCursor = 0
const DASHSCOPE_COMPATIBLE_BASE_URL = (Deno.env.get('DASHSCOPE_COMPATIBLE_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
const DASHSCOPE_API_KEY = (Deno.env.get('DASHSCOPE_API_KEY') || '').trim()
const DASHSCOPE_API_KEY_1 = (Deno.env.get('DASHSCOPE_API_KEY_1') || '').trim()
const DASHSCOPE_API_KEY_2 = (Deno.env.get('DASHSCOPE_API_KEY_2') || Deno.env.get('DASHSCOPE_API_KEY_NEW') || '').trim()
let dashScopeKeyCursor = 0

const SILICONFLOW_BASE_URL = (Deno.env.get('SILICONFLOW_BASE_URL') || 'https://api.siliconflow.cn/v1').replace(/\/$/, '')
const SILICONFLOW_API_KEY = Deno.env.get('SILICONFLOW_API_KEY') || ''

const OPENROUTER_BASE_URL = (Deno.env.get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const OPENROUTER_API_KEY_1 = Deno.env.get('OPENROUTER_API_KEY_1') || ''
const OPENROUTER_API_KEY_2 = Deno.env.get('OPENROUTER_API_KEY_2') || ''
const OPENROUTER_API_KEY_3 = Deno.env.get('OPENROUTER_API_KEY_3') || ''

const SPARK_BASE_URL = (Deno.env.get('SPARK_BASE_URL') || 'https://spark-api-open.xf-yun.com/x2').replace(/\/+$/, '')
const SPARK_API_KEY = Deno.env.get('SPARK_API_KEY') || ''

const MIMO_BASE_URL = (Deno.env.get('MIMO_BASE_URL') || 'https://api.xiaomimimo.com/v1').replace(/\/$/, '')
const MIMO_API_KEY = Deno.env.get('MIMO_API_KEY') || ''

const NEWAPI_BASE_URL = (Deno.env.get('NEWAPI_BASE_URL') || '').replace(/\/+$/, '')
const NEWAPI_API_KEY = Deno.env.get('NEWAPI_API_KEY') || ''
const NEWAPI_API_KEY_2 = Deno.env.get('NEWAPI_API_KEY_2') || ''

type ProviderKind = 'modelscope' | 'openai_compatible' | 'moonshot' | 'dashscope' | 'siliconflow' | 'openrouter' | 'spark' | 'mimo' | 'newapi'

function isOpenAICompatibleModel(model: string): boolean {
  return model === 'dall-e-3'
}

function isMoonshotModel(model: string): boolean {
  return model === 'kimi-k2.6-moonshot' || model === 'kimi-k2.6-line3'
}

function isDashScopeCompatibleModel(model: string): boolean {
  const dashScopeModels = [
    'kimi-k2.6', 'glm-5', 'glm-5.1', 'glm-5.1-dashscope', 'glm-4.7', 'qwen3.6-plus', 'qwen3.6-max-preview', 'deepseek-v4-flash', 'deepseek-v4-pro-dashscope',
    // 百炼新增模型
    'deepseek-r1', 'qwen3.6-flash', 'kimi-k2.5-dashscope', 'deepseek-v3.2', 'deepseek-v3.2-exp',
    'glm-4.5-air', 'minimax-m2.5-dashscope', 'deepseek-v3.1', 'qwen3-coder-plus', 'qwen3-max',
    'kimi-k2-instruct', 'qwen3.6-plus-20260402', 'deepseek-r1-0528'
  ]
  return dashScopeModels.includes(model)
}

// 百炼模型ID映射：将前端简写ID映射到百炼真实模型ID
function toDashScopeModelId(model: string): string {
  const modelMap: Record<string, string> = {
    // 已有模型
    'kimi-k2.6': 'kimi-k2.6',
    'glm-5': 'glm-5',
    'glm-5.1': 'glm-5.1',
    'glm-5.1-dashscope': 'glm-5.1',
    'glm-4.7': 'glm-4.7',
    'qwen3.6-plus': 'qwen3.6-plus',
    'qwen3.6-max-preview': 'qwen3.6-max-preview',
    'deepseek-v4-flash': 'deepseek-v4-flash',
    'deepseek-v4-pro-dashscope': 'deepseek-v4-pro',
    // 百炼新增模型 - 使用真实模型ID
    'deepseek-r1': 'deepseek-r1',
    'qwen3.6-flash': 'qwen3.6-flash',
    'kimi-k2.5-dashscope': 'kimi-k2.5',
    'deepseek-v3.2': 'deepseek-v3.2',
    'deepseek-v3.2-exp': 'deepseek-v3.2-exp',
    'glm-4.5-air': 'glm-4.5-air',
    'minimax-m2.5-dashscope': 'minimax-m2.5',
    'deepseek-v3.1': 'deepseek-v3.1',
    'qwen3-coder-plus': 'qwen3-coder-plus',
    'qwen3-max': 'qwen3-max',
    'kimi-k2-instruct': 'kimi-k2-instruct',
    'qwen3.6-plus-20260402': 'qwen3.6-plus-2026-04-02',
    'deepseek-r1-0528': 'deepseek-r1-0528'
  }
  return modelMap[model] || model
}

function expandProviderKeys(keys: string[]): string[] {
  return keys.flatMap(key => key.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))
}

function uniqueProviderKeys(keys: string[]): string[] {
  return Array.from(new Set(expandProviderKeys(keys)))
}

function getDashScopeKeyPool(model: string): string[] {
  const oldKeys = uniqueProviderKeys([DASHSCOPE_API_KEY, DASHSCOPE_API_KEY_1])
  const newKeys = uniqueProviderKeys([DASHSCOPE_API_KEY_2])
  if (model === 'deepseek-v4-pro-dashscope' || model === 'glm-5.1' || model === 'glm-5.1-dashscope') {
    return newKeys
  }
  return uniqueProviderKeys([...oldKeys, ...newKeys])
}

function pickDashScopeApiKey(model: string): string {
  const keys = getDashScopeKeyPool(model)
  if (!keys.length) return ''
  const key = keys[dashScopeKeyCursor % keys.length] || ''
  dashScopeKeyCursor = (dashScopeKeyCursor + 1) % Math.max(keys.length, 1)
  return key
}

function getDashScopeMissingKeys(model: string): string[] {
  if (model === 'deepseek-v4-pro-dashscope' || model === 'glm-5.1' || model === 'glm-5.1-dashscope') {
    return ['DASHSCOPE_API_KEY_2 or DASHSCOPE_API_KEY_NEW']
  }
  return ['DASHSCOPE_API_KEY or DASHSCOPE_API_KEY_1 or DASHSCOPE_API_KEY_2']
}

// Moonshot key 池：根据模型选择不同的 key
function getMoonshotKeyPool(model: string): string[] {
  if (model === 'kimi-k2.6-line3') {
    return uniqueProviderKeys([MOONSHOT_API_KEY_LINE3])
  }
  return uniqueProviderKeys([MOONSHOT_API_KEY])
}

function pickMoonshotApiKey(model: string): string {
  const keys = getMoonshotKeyPool(model)
  if (!keys.length) return ''
  const key = keys[moonshotKeyCursor % keys.length] || ''
  moonshotKeyCursor = (moonshotKeyCursor + 1) % Math.max(keys.length, 1)
  return key
}

function getMoonshotMissingKeys(model: string): string[] {
  if (model === 'kimi-k2.6-line3') {
    return ['MOONSHOT_API_KEY_LINE3']
  }
  return ['MOONSHOT_API_KEY']
}

function isSiliconFlowModel(model: string): boolean {
  return model === 'stepfun-ai/Step-3.5-Flash' || model === 'deepseek-ai/DeepSeek-V4-Flash' || model === 'zai-org/GLM-5.1'
}

function isOpenRouterModel(model: string): boolean {
  return model === 'tencent/hy3-preview:free' || model === 'openai/gpt-oss-120b:free' || model === 'nvidia/nemotron-3-super-120b-a12b:free' || model === 'inclusionai/ling-2.6-1t:free'
}

function isSparkModel(model: string): boolean {
  return model === 'spark-x'
}

function isMimoModel(model: string): boolean {
  return model === 'mimo-v2.5-pro' || model === 'mimo-v2.5-tts' || model === 'mimo-v2.5-tts-voicedesign'
}

function isNewApiModel(model: string): boolean {
  return model === 'gpt-5.4' || model === 'claude-opus-4.6' || model === 'claude-sonnet-4.6' || model === 'gemini-2.5-pro'
}

function getNewApiKey(model: string): string {
  // GPT-5.4 uses original key, others use new key
  if (model === 'gpt-5.4') return NEWAPI_API_KEY
  return NEWAPI_API_KEY_2
}

function getProviderKind(model: string): ProviderKind {
  if (isOpenAICompatibleModel(model)) return 'openai_compatible'
  if (isMoonshotModel(model)) return 'moonshot'
  if (isDashScopeCompatibleModel(model)) return 'dashscope'
  if (isSiliconFlowModel(model)) return 'siliconflow'
  if (isOpenRouterModel(model)) return 'openrouter'
  if (isSparkModel(model)) return 'spark'
  if (isMimoModel(model)) return 'mimo'
  if (isNewApiModel(model)) return 'newapi'
  return 'modelscope'
}

function providerConfigError(provider: ProviderKind, missing: string[], ch: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'Provider not configured', provider, missing }), {
    status: 500,
    headers: { ...ch, 'Content-Type': 'application/json' },
  })
}

function getPingUrl(provider: ProviderKind, probeEndpoint: string): string {
  if (probeEndpoint === 'image') {
    if (provider === 'openai_compatible') {
      return `${OPENAI_COMPATIBLE_BASE_URL}/images/generations`
    }
    if (provider === 'modelscope') {
      return `${MODELSCOPE_API_BASE}/images/generations`
    }
  }

  if (provider === 'openai_compatible') {
    return `${OPENAI_COMPATIBLE_BASE_URL}/chat/completions`
  }
  if (provider === 'moonshot') {
    return `${MOONSHOT_BASE_URL}/chat/completions`
  }
  if (provider === 'dashscope') {
    return `${DASHSCOPE_COMPATIBLE_BASE_URL}/chat/completions`
  }
  if (provider === 'siliconflow') {
    return `${SILICONFLOW_BASE_URL}/chat/completions`
  }
  if (provider === 'openrouter') {
    return `${OPENROUTER_BASE_URL}/chat/completions`
  }
  if (provider === 'spark') {
    return `${SPARK_BASE_URL}/chat/completions`
  }
  if (provider === 'mimo') {
    return `${MIMO_BASE_URL}/chat/completions`
  }
  if (provider === 'newapi') {
    return `${NEWAPI_BASE_URL}/chat/completions`
  }
  return `${MODELSCOPE_API_BASE}/chat/completions`
}

async function handlePingRequest(requestData: Record<string, unknown>, req: Request): Promise<Response> {
  const ch = corsHeadersFor(req)
  const model = String(requestData.model || '').trim()
  if (!model) {
    return new Response(JSON.stringify({ error: 'Missing model' }), {
      status: 400,
      headers: { ...ch, 'Content-Type': 'application/json' },
    })
  }

  const provider = getProviderKind(model)
  const probeEndpoint = String(requestData.probe_endpoint || requestData.target_endpoint || 'chat').trim() || 'chat'
  const pingUrl = getPingUrl(provider, probeEndpoint)
  const start = performance.now()

  try {
    const modelScopeKeys = provider === 'modelscope' ? await resolveModelScopeApiKeys() : []
    const basePingHeaders: Record<string, string> = {
      'Accept': '*/*',
      'User-Agent': USER_AGENT,
    }
    const responses = provider === 'modelscope' && modelScopeKeys.length
      ? await Promise.all(modelScopeKeys.map(apiKey => fetch(pingUrl, {
        method: 'HEAD',
        headers: { ...basePingHeaders, 'Authorization': `Bearer ${apiKey}` },
      })))
      : [await fetch(pingUrl, {
        method: 'HEAD',
        headers: basePingHeaders,
      })]
    const response = responses[0]

    const latencyMs = Math.max(0, Math.round(performance.now() - start))
    const rateLimitHeaders = provider === 'modelscope' ? collectModelScopeRateLimitHeaders(responses.map(item => item.headers)) : {}
    return new Response(JSON.stringify({
      ok: true,
      model,
      provider,
      probe_endpoint: probeEndpoint,
      url: pingUrl,
      status: response.status,
      latencyMs,
    }), {
      status: 200,
      headers: { ...ch, 'Content-Type': 'application/json', ...rateLimitHeaders },
    })
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - start))
    return new Response(JSON.stringify({
      ok: false,
      model,
      provider,
      probe_endpoint: probeEndpoint,
      url: pingUrl,
      latencyMs,
      error: 'Ping failed',
    }), {
      status: 200,
      headers: { ...ch, 'Content-Type': 'application/json' },
    })
  }
}

function isLocalOnlyBaseUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url)
}

const HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/'
const INSTANT_SEARCH_URL = 'https://api.duckduckgo.com/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface SearchResult {
  title: string
  url: string
  snippet: string
  source: string
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function isPlaceholderModelScopeKey(value: string): boolean {
  const normalized = value.trim().toUpperCase()
  return !normalized || normalized === 'YOUR_MODELSCOPE_API_KEY' || normalized === 'REPLACE_WITH_YOUR_MODELSCOPE_API_KEY'
}

let cachedModelScopeApiKeys: string[] = []
let modelScopeApiKeyLoaded = false
const modelScopeTurnKeySlots = new Map<string, number>()

function expandModelScopeKeys(keys: string[]): string[] {
  return keys.flatMap(key => key.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))
}

function uniqueModelScopeKeys(keys: string[]): string[] {
  return Array.from(new Set(expandModelScopeKeys(keys).filter(key => !isPlaceholderModelScopeKey(key))))
}

async function resolveModelScopeApiKeys(): Promise<string[]> {
  const envKeys = uniqueModelScopeKeys([MODELSCOPE_API_KEY, MODELSCOPE_API_KEY_1, MODELSCOPE_API_KEY_2])
  if (envKeys.length) {
    return envKeys
  }

  if (modelScopeApiKeyLoaded) {
    return cachedModelScopeApiKeys
  }

  modelScopeApiKeyLoaded = true

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return []
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await supabase
      .from('api_config')
      .select('api_key')
      .eq('service_name', 'modelscope')
      .maybeSingle()

    if (error) {
      console.error('读取 ModelScope API key 失败:', error)
      return []
    }

    const apiKey = String(data?.api_key || '').trim()
    if (!isPlaceholderModelScopeKey(apiKey)) {
      cachedModelScopeApiKeys = uniqueModelScopeKeys([apiKey])
    }
  } catch (error) {
    console.error('读取 ModelScope API key 时发生异常:', error)
  }

  return cachedModelScopeApiKeys
}

function hashStableText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

function getModelScopeTurnId(requestData: Record<string, unknown>, req: Request): string {
  return cleanHeader(String(requestData.client_turn_id || requestData.turn_id || req.headers.get('x-chat-turn-id') || '')).slice(0, 96)
}

function pickModelScopeKeySlot(keys: string[], turnId = '', offset = 0): number {
  if (!keys.length) return -1
  const remembered = turnId ? modelScopeTurnKeySlots.get(turnId) : undefined
  const base = Number.isInteger(remembered) ? Number(remembered) : (turnId ? hashStableText(turnId) : Math.floor(Math.random() * keys.length))
  return (base + offset) % keys.length
}

function rememberModelScopeKeySlot(turnId: string, slot: number): void {
  if (!turnId || !Number.isInteger(slot)) return
  if (modelScopeTurnKeySlots.size > 1000) {
    const firstKey = modelScopeTurnKeySlots.keys().next().value
    if (firstKey) modelScopeTurnKeySlots.delete(firstKey)
  }
  modelScopeTurnKeySlots.set(turnId, slot)
}

function pickModelScopeApiKey(keys: string[], turnId = '', offset = 0): { key: string; slot: number } {
  const slot = pickModelScopeKeySlot(keys, turnId, offset)
  if (slot < 0) return { key: '', slot }
  return { key: keys[slot] || '', slot }
}

function parseProviderHeaderInteger(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function collectModelScopeRateLimitHeaders(headersList: Headers[]): Record<string, string> {
  const headerPairs = [
    ['modelscope-ratelimit-requests-limit', 'modelscope-ratelimit-requests-limit'],
    ['modelscope-ratelimit-requests-remaining', 'modelscope-ratelimit-requests-remaining'],
    ['modelscope-ratelimit-model-requests-limit', 'modelscope-ratelimit-model-requests-limit'],
    ['modelscope-ratelimit-model-requests-remaining', 'modelscope-ratelimit-model-requests-remaining'],
  ] as const
  const output: Record<string, string> = {}
  for (const [sourceKey, outputKey] of headerPairs) {
    const values = headersList
      .map(headers => parseProviderHeaderInteger(headers.get(sourceKey) || headers.get(sourceKey.replace(/(^|-)([a-z])/g, item => item.toUpperCase()))))
      .filter((value): value is number => Number.isFinite(value))
    if (values.length) {
      output[outputKey] = String(values.reduce((sum, value) => sum + value, 0))
    }
  }
  return output
}

async function fetchProviderRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
  provider: ProviderKind,
  modelScopeApiKeys: string[],
  modelScopeTurnId: string,
  initialModelScopeSlot: number
): Promise<{ response: Response; rateLimitHeaderSources: Headers[] }> {
  const response = await fetch(url, { method, headers, body })
  const rateLimitHeaderSources = [response.headers]
  if (provider !== 'modelscope' || response.status !== 429 || modelScopeApiKeys.length <= 1) {
    if (provider === 'modelscope' && response.status !== 429) {
      rememberModelScopeKeySlot(modelScopeTurnId, initialModelScopeSlot)
    }
    return { response, rateLimitHeaderSources }
  }
  for (let offset = 1; offset < modelScopeApiKeys.length; offset += 1) {
    const retrySelection = pickModelScopeApiKey(modelScopeApiKeys, modelScopeTurnId, offset)
    if (!retrySelection.key || retrySelection.slot === initialModelScopeSlot) continue
    const retryResponse = await fetch(url, {
      method,
      headers: { ...headers, 'Authorization': `Bearer ${retrySelection.key}` },
      body,
    })
    rateLimitHeaderSources.push(retryResponse.headers)
    if (retryResponse.status !== 429) {
      rememberModelScopeKeySlot(modelScopeTurnId, retrySelection.slot)
      return { response: retryResponse, rateLimitHeaderSources }
    }
  }
  return { response, rateLimitHeaderSources }
}

function resolveDuckDuckGoUrl(rawHref: string): string {
  if (!rawHref) return ''

  try {
    const url = new URL(rawHref, HTML_SEARCH_URL)
    const target = url.searchParams.get('uddg')
    if (target) {
      return decodeURIComponent(target)
    }
    return url.toString()
  } catch {
    return rawHref
  }
}

function uniqueResults(results: SearchResult[], limit: number): SearchResult[] {
  const seen = new Set<string>()
  const output: SearchResult[] = []

  for (const result of results) {
    const key = `${result.title}::${result.url}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(result)
    if (output.length >= limit) break
  }

  return output
}

function parseHtmlSearchResults(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = []

  if (typeof DOMParser === 'undefined') {
    return results
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc) return results

  const blocks = Array.from(doc.querySelectorAll('.result__body'))
  for (const block of blocks) {
    if (results.length >= limit) break

    const titleLink = block.querySelector('a.result__a')
    const title = cleanText(titleLink?.textContent || '')
    const href = resolveDuckDuckGoUrl(titleLink?.getAttribute('href') || '')
    const snippet = cleanText(block.querySelector('.result__snippet')?.textContent || '')

    if (!title || !href) continue
    results.push({ title, url: href, snippet, source: 'duckduckgo_html' })
  }

  return results
}

function collectInstantTopics(items: unknown, bucket: SearchResult[], limit: number): void {
  if (!Array.isArray(items) || bucket.length >= limit) return

  for (const item of items) {
    if (bucket.length >= limit) return

    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>

      if (Array.isArray(record.Topics)) {
        collectInstantTopics(record.Topics, bucket, limit)
        continue
      }

      const text = cleanText(record.Text)
      const url = cleanText(record.FirstURL || record.FirstUrl || '')
      if (!text || !url) continue

      bucket.push({
        title: text,
        url,
        snippet: text,
        source: 'duckduckgo_instant',
      })
    }
  }
}

async function fetchInstantResults(query: string, lang: string, limit: number): Promise<SearchResult[]> {
  const url = new URL(INSTANT_SEARCH_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('no_html', '1')
  url.searchParams.set('no_redirect', '1')
  url.searchParams.set('skip_disambig', '1')
  url.searchParams.set('kl', lang === 'en' ? 'us-en' : 'cn-zh')

  const response = await fetch(url.toString(), {
    headers: {
      'Accept-Language': lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9,en;q=0.6',
      'User-Agent': USER_AGENT,
    },
  })

  if (!response.ok) {
    return []
  }

  const data = await response.json()
  const results: SearchResult[] = []
  const heading = cleanText(data?.Heading || query)
  const abstractText = cleanText(data?.AbstractText || '')
  const abstractUrl = cleanText(data?.AbstractURL || data?.AbstractSource || '')

  if (abstractText && abstractUrl) {
    results.push({
      title: heading,
      url: abstractUrl,
      snippet: abstractText,
      source: 'duckduckgo_instant',
    })
  }

  collectInstantTopics(data?.RelatedTopics, results, limit)
  return uniqueResults(results, limit)
}

async function searchDuckDuckGo(query: string, lang: string, limit: number): Promise<SearchResult[]> {
  let htmlResults: SearchResult[] = []

  try {
    const searchUrl = new URL(HTML_SEARCH_URL)
    searchUrl.searchParams.set('q', query)
    searchUrl.searchParams.set('kl', lang === 'en' ? 'us-en' : 'cn-zh')
    searchUrl.searchParams.set('kp', '-1')

    const response = await fetch(searchUrl.toString(), {
      headers: {
        'Accept-Language': lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9,en;q=0.6',
        'User-Agent': USER_AGENT,
      },
    })

    if (response.ok) {
      const html = await response.text()
      htmlResults = parseHtmlSearchResults(html, limit)
    }
  } catch (error) {
    console.error('DuckDuckGo HTML search failed:', error)
  }

  if (htmlResults.length >= limit) {
    return uniqueResults(htmlResults, limit)
  }

  const instantResults = await fetchInstantResults(query, lang, limit).catch(error => {
    console.error('DuckDuckGo instant search failed:', error)
    return []
  })
  const mergedResults = uniqueResults([...htmlResults, ...instantResults], limit)

  if (!mergedResults.length) {
    throw new Error('未获取到联网搜索结果')
  }

  return mergedResults
}

async function handleWebSearchRequest(requestData: Record<string, unknown>, req: Request): Promise<Response> {
  const ch = corsHeadersFor(req)
  const query = cleanText(requestData.query || requestData.search_query)
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400,
      headers: { ...ch, 'Content-Type': 'application/json' },
    })
  }

  const lang = requestData.lang === 'en' ? 'en' : 'zh'
  const limitValue = Number(requestData.limit)
  const limit = Math.max(1, Math.min(10, Number.isFinite(limitValue) ? Math.round(limitValue) : 5))
  const results = await searchDuckDuckGo(query, lang, limit)

  return new Response(JSON.stringify({
    query,
    lang,
    source: 'duckduckgo',
    count: results.length,
    results,
  }), {
    status: 200,
    headers: { ...ch, 'Content-Type': 'application/json' },
  })
}

const BLOCKED_IPS = new Set(['185.212.58.222', '185.212.58.66'])
const BLOCKED_IP_RANGES = ['185.212.58.0/24']

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bits = '32'] = cidr.split('/')
  const mask = parseInt(bits, 10)
  const ipNum = ip.split('.').reduce((a, b) => (a << 8) + parseInt(b, 10), 0) >>> 0
  const rangeNum = range.split('.').reduce((a, b) => (a << 8) + parseInt(b, 10), 0) >>> 0
  const maskNum = (0xFFFFFFFF << (32 - mask)) >>> 0
  return (ipNum & maskNum) === (rangeNum & maskNum)
}

function isIpBlocked(ip: string): boolean {
  if (BLOCKED_IPS.has(ip)) return true
  return BLOCKED_IP_RANGES.some(cidr => ipInCidr(ip, cidr))
}

// === 并发炸弹检测 ===
const BURST_MAX = 8
const BURST_WINDOW_MS = 5000
const burstMap = new Map<string, { count: number; resetAt: number }>()

function checkBurst(ip: string): boolean {
  const now = Date.now()
  const entry = burstMap.get(ip) || { count: 0, resetAt: now + BURST_WINDOW_MS }
  if (now > entry.resetAt) {
    entry.count = 0
    entry.resetAt = now + BURST_WINDOW_MS
  }
  entry.count++
  burstMap.set(ip, entry)
  if (burstMap.size > 5000) {
    const first = burstMap.keys().next().value
    if (first) burstMap.delete(first)
  }
  return entry.count > BURST_MAX
}
// ===================

// === ALTCHA Proof-of-Work 验证 ===
const ALTCHA_MAX_NUMBER = 1_000_000  // 难度控制：普通电脑 50-200ms

async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message))
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

async function handleAltchaChallenge(req: Request): Promise<Response> {
  const ch = corsHeadersFor(req)
  const hmacKey = Deno.env.get('ALTCHA_HMAC_KEY') || ''
  if (!hmacKey) {
    return jsonResponse({ error: 'server_misconfig', message: 'ALTCHA not configured' }, 500, ch)
  }

  const salt = crypto.randomUUID()
  const number = Math.floor(Math.random() * ALTCHA_MAX_NUMBER)
  const signature = await hmacSha256(hmacKey, salt + number)

  return jsonResponse({
    algorithm: 'SHA-256',
    challenge: signature,
    salt,
    signature,
    maxnumber: ALTCHA_MAX_NUMBER,
  }, 200, ch)
}

async function verifyAltcha(payload: string, hmacKey: string): Promise<boolean> {
  try {
    const data = JSON.parse(atob(payload))
    const { salt, number, signature } = data
    if (!salt || typeof number !== 'number' || !signature) return false
    const check = await hmacSha256(hmacKey, salt + number)
    return check === signature
  } catch {
    return false
  }
}

async function verifyAltchaOrFail(req: Request, ch: Record<string, string>): Promise<Response | null> {
  const hmacKey = Deno.env.get('ALTCHA_HMAC_KEY') || ''
  if (!hmacKey) {
    return jsonResponse({ error: 'server_misconfig', message: 'ALTCHA not configured' }, 500, ch)
  }

  const altchaPayload = cleanHeader(req.headers.get('x-altcha-payload'))
  if (!altchaPayload || !(await verifyAltcha(altchaPayload, hmacKey))) {
    return jsonResponse({
      error: 'bot_challenge_failed',
      code: 'altcha_required',
      message: '请完成验证后重试',
      altcha_endpoint: '/altcha/challenge',
    }, 403, ch)
  }
  return null
}
// ===================

serve(async (req: Request) => {
  const ch = corsHeadersFor(req)

  const clientIp = getClientIp(req)

  // 自动拦截并发轰炸
  if (checkBurst(clientIp)) {
    console.log(JSON.stringify({ event: 'burst_blocked', ip: clientIp }))
    return new Response(JSON.stringify({ error: 'blocked', code: 'burst_detected', message: '检测到异常并发请求' }), { status: 403, headers: { ...ch, 'Content-Type': 'application/json' } })
  }

  if (isIpBlocked(clientIp)) {
    console.log(JSON.stringify({ event: 'ip_blocked', ip: clientIp }))
    return new Response(JSON.stringify({ error: 'blocked', code: 'ip_blocked', message: '该 IP 已被永久封禁' }), { status: 403, headers: { ...ch, 'Content-Type': 'application/json' } })
  }

  const startedAt = performance.now()
  const originResponse = rejectDisallowedOrigin(req, ch)
  if (originResponse) return originResponse

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ch })
  }

  try {
    const baseCtx = getRequestContext(req, 'modelscope-proxy')
    const oversized = rejectOversizedRequest(req, ch, baseCtx)
    if (oversized) return oversized

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const { endpoint = 'chat', client_turn_id: clientTurnId, turn_id: legacyTurnId, ...requestData } = body
    const endpointName = cleanHeader(String(endpoint || 'chat'))
    const model = String(requestData.model || '')
    const ctx = getRequestContext(req, 'modelscope-proxy', endpointName, model)
    const abuseResponse = enforceAbuseGuard(ctx, ch)
    if (abuseResponse) return abuseResponse
    logSecurityEvent('request_started', ctx, { method: req.method })

    if (endpointName === 'altcha/challenge' || (req.method === 'GET' && req.url.includes('/altcha/challenge'))) {
      return handleAltchaChallenge(req)
    }

    if (endpointName === 'web_search') {
      const response = await handleWebSearchRequest(requestData, req)
      logSecurityEvent('request_finished', ctx, { status: response.status, durationMs: Math.round(performance.now() - startedAt) })
      return response
    }

    if (endpointName === 'ping') {
      const response = await handlePingRequest(requestData, req)
      logSecurityEvent('request_finished', ctx, { status: response.status, durationMs: Math.round(performance.now() - startedAt) })
      return response
    }

    // ALTCHA 验证：所有 chat/image/task 请求必须先完成 PoW
    if (['chat', 'image', 'task'].includes(endpointName)) {
      const altchaFail = await verifyAltchaOrFail(req, ch)
      if (altchaFail) return altchaFail
    }

    const block = getModelBlock(model)
    if (block) {
      logSecurityEvent('model_block_active', ctx, { model, retryAfter: block.retryAfter })
      return modelBlockedResponse(model, block.retryAfter, ch)
    }

    const provider = getProviderKind(model)
    const modelScopeApiKeys = provider === 'modelscope' ? await resolveModelScopeApiKeys() : []
    const modelScopeTurnId = provider === 'modelscope' ? getModelScopeTurnId({ client_turn_id: clientTurnId, turn_id: legacyTurnId }, req) : ''
    const modelScopeSelection = provider === 'modelscope' ? pickModelScopeApiKey(modelScopeApiKeys, modelScopeTurnId) : { key: '', slot: -1 }
    const modelScopeApiKey = modelScopeSelection.key
    const dashScopeApiKey = provider === 'dashscope' ? pickDashScopeApiKey(model) : ''
    const moonshotApiKey = provider === 'moonshot' ? pickMoonshotApiKey(model) : ''

    if (provider === 'openai_compatible' && (!OPENAI_COMPATIBLE_BASE_URL || !OPENAI_COMPATIBLE_API_KEY)) {
      return providerConfigError(provider, [
        ...(!OPENAI_COMPATIBLE_BASE_URL ? ['OPENAI_COMPATIBLE_BASE_URL'] : []),
        ...(!OPENAI_COMPATIBLE_API_KEY ? ['OPENAI_COMPATIBLE_API_KEY'] : []),
      ], ch)
    }

    if (provider === 'moonshot' && (!MOONSHOT_BASE_URL || !moonshotApiKey)) {
      return providerConfigError(provider, [
        ...(!MOONSHOT_BASE_URL ? ['MOONSHOT_BASE_URL'] : []),
        ...(!moonshotApiKey ? getMoonshotMissingKeys(model) : []),
      ], ch)
    }

    if (provider === 'openai_compatible' && isLocalOnlyBaseUrl(OPENAI_COMPATIBLE_BASE_URL)) {
      return new Response(JSON.stringify({ error: 'Invalid provider configuration' }), {
        status: 500,
        headers: { ...ch, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'moonshot' && isLocalOnlyBaseUrl(MOONSHOT_BASE_URL)) {
      return new Response(JSON.stringify({ error: 'Invalid provider configuration' }), {
        status: 500,
        headers: { ...ch, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'moonshot' && !moonshotApiKey) {
      return providerConfigError(provider, getMoonshotMissingKeys(model), ch)
    }

    if (provider === 'dashscope' && !dashScopeApiKey) {
      return providerConfigError(provider, getDashScopeMissingKeys(model), ch)
    }

    if (provider === 'siliconflow' && !SILICONFLOW_API_KEY) {
      return providerConfigError(provider, ['SILICONFLOW_API_KEY'], ch)
    }

    if (provider === 'openrouter' && !OPENROUTER_API_KEY_1 && !OPENROUTER_API_KEY_2 && !OPENROUTER_API_KEY_3) {
      return providerConfigError(provider, ['OPENROUTER_API_KEY_1 or OPENROUTER_API_KEY_2 or OPENROUTER_API_KEY_3'], ch)
    }

    if (provider === 'spark' && !SPARK_API_KEY) {
      return providerConfigError(provider, ['SPARK_API_KEY'], ch)
    }

    if (provider === 'mimo' && !MIMO_API_KEY) {
      return providerConfigError(provider, ['MIMO_API_KEY'], ch)
    }

    if (provider === 'newapi' && !NEWAPI_BASE_URL) {
      return providerConfigError(provider, ['NEWAPI_BASE_URL'], ch)
    }
    if (provider === 'newapi') {
      const requiredKey = getNewApiKey(model)
      if (!requiredKey) {
        const missingKey = model === 'gpt-5.4' ? 'NEWAPI_API_KEY' : 'NEWAPI_API_KEY_2'
        return providerConfigError(provider, [missingKey], ch)
      }
    }

    if (provider === 'dashscope' && isLocalOnlyBaseUrl(DASHSCOPE_COMPATIBLE_BASE_URL)) {
      return new Response(JSON.stringify({ error: 'Invalid provider configuration' }), {
        status: 500,
        headers: { ...ch, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'siliconflow' && isLocalOnlyBaseUrl(SILICONFLOW_BASE_URL)) {
      return new Response(JSON.stringify({ error: 'Invalid provider configuration' }), {
        status: 500,
        headers: { ...ch, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'openrouter' && isLocalOnlyBaseUrl(OPENROUTER_BASE_URL)) {
      return new Response(JSON.stringify({ error: 'Invalid provider configuration' }), {
        status: 500,
        headers: { ...ch, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'mimo' && isLocalOnlyBaseUrl(MIMO_BASE_URL)) {
      return new Response(JSON.stringify({ error: 'Invalid provider configuration' }), {
        status: 500,
        headers: { ...ch, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'newapi' && isLocalOnlyBaseUrl(NEWAPI_BASE_URL)) {
      return new Response(JSON.stringify({ error: 'Invalid provider configuration' }), {
        status: 500,
        headers: { ...ch, 'Content-Type': 'application/json' },
      })
    }

    if (provider === 'modelscope' && !modelScopeApiKey) {
      return providerConfigError(provider, ['MODELSCOPE_API_KEY or api_config.service_name=modelscope'], ch)
    }

    let url = ''
    let forwardedRequestData = requestData
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Configure based on endpoint type and model
    if (endpointName === 'image') {
      if (provider === 'openai_compatible') {
        url = `${OPENAI_COMPATIBLE_BASE_URL}/images/generations`
        headers['Authorization'] = `Bearer ${OPENAI_COMPATIBLE_API_KEY}`
      } else if (provider === 'dashscope') {
        return new Response(JSON.stringify({ error: 'Image generation not supported for this provider' }), {
          status: 400,
          headers: { ...ch, 'Content-Type': 'application/json' },
        })
      } else {
        url = `${MODELSCOPE_API_BASE}/images/generations`
        headers['Authorization'] = `Bearer ${modelScopeApiKey}`
        headers['X-ModelScope-Async-Mode'] = 'true'
      }
    } else if (endpointName === 'task') {
      if (provider !== 'modelscope') {
        return new Response(JSON.stringify({ error: 'Task polling not supported for this provider' }), {
          status: 400,
          headers: { ...ch, 'Content-Type': 'application/json' },
        })
      }
      const { taskId } = requestData
      url = `${MODELSCOPE_API_BASE}/tasks/${taskId}`
      headers['Authorization'] = `Bearer ${modelScopeApiKey}`
      headers['X-ModelScope-Task-Type'] = 'image_generation'
    } else {
      // 根据provider进行模型ID映射
      if (provider === 'moonshot') {
        forwardedRequestData = { ...requestData, model: 'kimi-k2.6' }
      } else if (provider === 'dashscope') {
        forwardedRequestData = { ...requestData, model: toDashScopeModelId(model) }
      } else {
        forwardedRequestData = requestData
      }

      if (provider === 'openai_compatible') {
        url = `${OPENAI_COMPATIBLE_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${OPENAI_COMPATIBLE_API_KEY}`
      } else if (provider === 'moonshot') {
        url = `${MOONSHOT_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${moonshotApiKey}`
      } else if (provider === 'dashscope') {
        url = `${DASHSCOPE_COMPATIBLE_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${dashScopeApiKey}`
      } else if (provider === 'siliconflow') {
        url = `${SILICONFLOW_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${SILICONFLOW_API_KEY}`
      } else if (provider === 'openrouter') {
        url = `${OPENROUTER_BASE_URL}/chat/completions`
        // Rotate between 3 API keys randomly
        const openRouterKeys = [OPENROUTER_API_KEY_1, OPENROUTER_API_KEY_2, OPENROUTER_API_KEY_3].filter(k => k)
        const randomKey = openRouterKeys[Math.floor(Math.random() * openRouterKeys.length)]
        headers['Authorization'] = `Bearer ${randomKey}`
      } else if (provider === 'spark') {
        url = `${SPARK_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${SPARK_API_KEY}`
      } else if (provider === 'mimo') {
        url = `${MIMO_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${MIMO_API_KEY}`
      } else if (provider === 'newapi') {
        url = `${NEWAPI_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${getNewApiKey(model)}`
      } else {
        url = `${MODELSCOPE_API_BASE}/chat/completions`
        headers['Authorization'] = `Bearer ${modelScopeApiKey}`
      }
    }

    // Forward request to provider
    const providerRequestBody = JSON.stringify(forwardedRequestData)
    const { response, rateLimitHeaderSources } = await fetchProviderRequest(
      url,
      req.method,
      headers,
      providerRequestBody,
      provider,
      modelScopeApiKeys,
      modelScopeTurnId,
      modelScopeSelection.slot
    )
    recordModelAvailability(model, response.status, ctx)

    // Handle streaming response
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const encoder = new TextEncoder()
      const decoder = new TextDecoder()

      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              controller.enqueue(encoder.encode(decoder.decode(value)))
            }
            controller.close()
          } catch (error) {
            controller.error(error)
          }
        }
      })

      // Forward rate limit headers
      const rateLimitHeaders = provider === 'modelscope'
        ? collectModelScopeRateLimitHeaders(rateLimitHeaderSources)
        : (() => {
          const output: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            if (key.toLowerCase().startsWith('modelscope-ratelimit')) output[key] = value
          })
          return output
        })()

      logSecurityEvent('request_finished', ctx, { status: response.status, provider, streamed: true, durationMs: Math.round(performance.now() - startedAt) })

      return new Response(stream, {
        headers: { ...ch, 'Content-Type': 'text/event-stream', ...rateLimitHeaders },
        status: response.status,
      })
    }

    // Handle JSON response
    const data = await response.json()

    // Forward rate limit headers
    const rateLimitHeaders = provider === 'modelscope'
      ? collectModelScopeRateLimitHeaders(rateLimitHeaderSources)
      : (() => {
        const output: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          if (key.toLowerCase().startsWith('modelscope-ratelimit')) output[key] = value
        })
        return output
      })()

    logSecurityEvent('request_finished', ctx, { status: response.status, provider, durationMs: Math.round(performance.now() - startedAt) })

    return new Response(JSON.stringify(data), {
      headers: { ...ch, 'Content-Type': 'application/json', ...rateLimitHeaders },
      status: response.status,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const ctx = getRequestContext(req, 'modelscope-proxy')
    logSecurityEvent('request_failed', ctx, { durationMs: Math.round(performance.now() - startedAt), error: message.slice(0, 160) })
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      headers: { ...ch, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
