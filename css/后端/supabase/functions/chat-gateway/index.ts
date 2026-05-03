/// <reference lib="dom" />
/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

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

const SUPABASE_PUBLISHABLE_KEY = firstKey(readSupabaseKeyDict('SUPABASE_PUBLISHABLE_KEYS')) || Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || ''
const SUPABASE_SECRET_KEY = firstKey(readSupabaseKeyDict('SUPABASE_SECRET_KEYS')) || Deno.env.get('SUPABASE_SECRET_KEY') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || SUPABASE_SECRET_KEY

function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin') || ''
  if (!origin) return null
  if (ALLOWED_ORIGINS.some((allowed: string) => origin === allowed)) return origin
  return null
}

const BANNED_IPS = new Set([
  '18.141.169.136', '47.130.152.123', '84.20.17.72', '110.248.68.12', '112.65.37.61', '113.13.223.225',
  '114.103.210.205', '5.34.220.150',
  '192.3.209.49', '137.184.239.207', '173.242.127.138', '31.172.69.16',
  '89.125.244.207', '138.2.31.37',
  '113.224.60.216',
  '221.215.44.36', '223.78.71.11',
  '61.185.160.206',
])
const BANNED_USERS = new Set([
  '2613bd…a797', '804f13…edcd',
  '2787e3…62f9', 'eda2e7…fd73', '92c7a6…94a0',
  'b88673…e13f', '40a8b3…7ba3',
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

function isAnonymousJwt(token: string): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const parsed = JSON.parse(atob(padded))
    return parsed?.is_anonymous === true
  } catch {
    return false
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

let arenaSupabaseClient: SupabaseClient | null = null

function getArenaSupabaseClient(): SupabaseClient | null {
  if (arenaSupabaseClient) return arenaSupabaseClient
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  arenaSupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return arenaSupabaseClient
}

async function verifySupabaseUser(jwt: string): Promise<string> {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !jwt) return ''
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await supabase.auth.getUser(jwt)
    if (error || !data?.user?.id) return ''
    return data.user.id
  } catch {
    return ''
  }
}

function cleanText(value: unknown, max = 12000): string {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max)
}

async function sha256Hex(value: string): Promise<string> {
  const input = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function getArenaDevice(req: Request, userId: string): string {
  const ip = getClientIp(req)
  const ua = cleanHeader(req.headers.get('user-agent')).slice(0, 160)
  const origin = cleanHeader(req.headers.get('origin'))
  return `${ip}|${ua}|${origin}|${userId}`
}

const ARENA_MODELS = [
  'grok-4.20-fast',
  'grok-code-fast-1',
  'minimax-m2.7',
  'gemini-3-flash-preview',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-pro-alt',
  'step-3.5-flash',
  'gpt-5.4',
  'claude-sonnet-4.6',
  'qwen3.6-plus',
  'qwen3-max',
  'kimi-k2.6',
  'glm-5',
  'deepseek-r1',
]
const ARENA_INITIAL_ELO = 1000
const ARENA_ELO_K = 32

type ArenaStatsSnapshot = {
  wins: number
  losses: number
  ties: number
  bad: number
  totalVotes: number
  eloScore: number
  eloGames: number
}

function pickArenaPair(): { modelA: string; modelB: string } {
  const first = Math.floor(Math.random() * ARENA_MODELS.length)
  let second = Math.floor(Math.random() * ARENA_MODELS.length)
  if (second === first) second = (second + 1) % ARENA_MODELS.length
  return { modelA: ARENA_MODELS[first], modelB: ARENA_MODELS[second] }
}

function normalizeArenaModelChoice(value: unknown): string {
  const model = cleanHeader(String(value || '')).slice(0, 120)
  if (!model || model.startsWith('image-')) return ''
  return /^[a-zA-Z0-9._:/-]+$/.test(model) ? model : ''
}

function getArenaModelBrandName(modelId: string): string {
  const text = modelId.toLowerCase()
  if (text.includes('qwen')) return '通义千问'
  if (text.includes('deepseek')) return 'DeepSeek'
  if (text.includes('grok')) return 'Grok'
  if (text.includes('gemini') || text.includes('gemma')) return 'Google'
  if (text.includes('claude')) return 'Anthropic Claude'
  if (text.includes('gpt')) return 'OpenAI'
  if (text.includes('kimi')) return 'Kimi'
  if (text.includes('glm')) return '智谱 GLM'
  if (text.includes('minimax')) return 'MiniMax'
  if (text.includes('mimo')) return '小米 MiMo'
  if (text.includes('hy3')) return '腾讯混元'
  if (text.includes('spark')) return '讯飞星火'
  if (text.includes('ling')) return '蚂蚁 Ling'
  if (text.includes('nemotron')) return 'NVIDIA Nemotron'
  if (text.includes('step')) return '阶跃星辰'
  return '当前模型系列'
}

function getArenaSlotSystemPrompt(modelId: string): string {
  const brandName = getArenaModelBrandName(modelId)
  return [
    '你正在参加匿名 AI 对战。',
    `如果用户询问你是谁、你是什么模型、由谁支持，最多只允许回答厂商或模型系列：“${brandName}”。`,
    '不要透露具体模型型号、版本号、后端线路、路由、供应商密钥或评测规则。',
    '除非当前厂商确实是 DeepSeek，否则不要声称自己是 DeepSeek、DeepSeekV4 或 DeepSeek-V4。',
    '请直接回答用户问题，回答应清晰、有帮助、适度简洁。',
  ].join('\n')
}

function normalizeArenaStats(row: Record<string, unknown> | null | undefined): ArenaStatsSnapshot {
  return {
    wins: Number(row?.wins || 0),
    losses: Number(row?.losses || 0),
    ties: Number(row?.ties || 0),
    bad: Number(row?.bad || 0),
    totalVotes: Number(row?.total_votes || 0),
    eloScore: Number(row?.elo_score || ARENA_INITIAL_ELO),
    eloGames: Number(row?.elo_games || 0),
  }
}

async function getArenaStatsSnapshot(supabase: SupabaseClient, modelId: string): Promise<ArenaStatsSnapshot> {
  const { data, error } = await supabase
    .from('arena_model_stats')
    .select('wins,losses,ties,bad,total_votes,elo_score,elo_games')
    .eq('model_id', modelId)
    .maybeSingle()
  if (error) throw error
  return normalizeArenaStats(data as Record<string, unknown> | null)
}

function calculateArenaElo(modelAElo: number, modelBElo: number, winner: string): { modelA: number; modelB: number } {
  if (!['a', 'b', 'tie'].includes(winner)) {
    return { modelA: modelAElo, modelB: modelBElo }
  }
  const scoreA = winner === 'a' ? 1 : (winner === 'b' ? 0 : 0.5)
  const scoreB = 1 - scoreA
  const expectedA = 1 / (1 + Math.pow(10, (modelBElo - modelAElo) / 400))
  const expectedB = 1 / (1 + Math.pow(10, (modelAElo - modelBElo) / 400))
  return {
    modelA: Math.round((modelAElo + ARENA_ELO_K * (scoreA - expectedA)) * 10) / 10,
    modelB: Math.round((modelBElo + ARENA_ELO_K * (scoreB - expectedB)) * 10) / 10,
  }
}

function getArenaStatPatch(modelId: string, match: Record<string, unknown>, winner: string): Pick<ArenaStatsSnapshot, 'wins' | 'losses' | 'ties' | 'bad'> {
  return {
    wins: winner === 'a' && modelId === match.model_a || winner === 'b' && modelId === match.model_b ? 1 : 0,
    losses: winner === 'a' && modelId === match.model_b || winner === 'b' && modelId === match.model_a ? 1 : 0,
    ties: winner === 'tie' ? 1 : 0,
    bad: winner === 'bad' ? 1 : 0,
  }
}

async function upsertArenaModelStats(
  supabase: SupabaseClient,
  modelId: string,
  current: ArenaStatsSnapshot,
  patch: Pick<ArenaStatsSnapshot, 'wins' | 'losses' | 'ties' | 'bad'>,
  eloAfter: number,
  countEloGame: boolean
): Promise<void> {
  const next = {
    model_id: modelId,
    wins: current.wins + patch.wins,
    losses: current.losses + patch.losses,
    ties: current.ties + patch.ties,
    bad: current.bad + patch.bad,
    total_votes: current.totalVotes + 1,
    elo_score: eloAfter,
    elo_games: current.eloGames + (countEloGame ? 1 : 0),
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('arena_model_stats')
    .upsert(next, { onConflict: 'model_id' })
  if (error) throw error
}

async function consumeArenaLimit(
  supabase: SupabaseClient,
  scope: string,
  limit: number,
  windowSeconds: number,
  blockSeconds: number
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const { data, error } = await supabase.rpc('cancri_consume_abuse_token', {
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
    p_block_seconds: blockSeconds,
  })
  if (error) {
    console.warn('Arena rate limit RPC failed:', error.message)
    return { allowed: true }
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || row.allowed) return { allowed: true }
  return { allowed: false, retryAfter: Number(row.retry_after_seconds || 60) }
}

async function enforceArenaLimits(
  supabase: SupabaseClient,
  action: string,
  userId: string,
  ipHash: string,
  deviceHash: string
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const limits = action === 'vote'
    ? [
      { scope: `arena:vote:user:${userId}`, limit: 40, window: 3600, block: 900 },
      { scope: `arena:vote:device:${deviceHash}`, limit: 50, window: 3600, block: 900 },
      { scope: `arena:vote:ip:${ipHash}`, limit: 120, window: 3600, block: 1800 },
    ]
    : [
      { scope: `arena:create:user:${userId}`, limit: 12, window: 900, block: 900 },
      { scope: `arena:create:device:${deviceHash}`, limit: 18, window: 900, block: 900 },
      { scope: `arena:create:ip:${ipHash}`, limit: 45, window: 900, block: 1800 },
    ]

  for (const item of limits) {
    const result = await consumeArenaLimit(supabase, item.scope, item.limit, item.window, item.block)
    if (result.allowed) continue
    return {
      ok: false,
      response: jsonResponse({
        error: 'challenge_required',
        code: 'challenge_required',
        message: '检测到竞技场请求过快。为防止脚本刷量，请稍后再试。',
        retry_after_seconds: result.retryAfter,
      }, 403, corsHeadersFor(new Request('https://nexusvai.github.io')), { 'Retry-After': String(result.retryAfter) }),
    }
  }

  return { ok: true }
}

async function shouldCountGatewayTurn(supabase: SupabaseClient, scope: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('cancri_mark_turn_once', {
    p_scope: scope,
    p_ttl_seconds: 900,
  })
  if (error) {
    console.warn('Gateway turn dedup RPC failed:', error.message)
    return true
  }
  return data !== false
}

async function enforceGatewayModelLimits(
  req: Request,
  ch: Record<string, string>,
  body: JsonObject,
  endpoint: string,
  userId: string
): Promise<Response | null> {
  if (endpoint !== 'chat' && endpoint !== 'image') return null
  const supabase = getArenaSupabaseClient()
  if (!supabase) return null

  const ip = getClientIp(req)
  const ipHash = await sha256Hex(`ip:${ip}`)
  const deviceHash = await sha256Hex(`device:${getArenaDevice(req, userId)}`)
  const model = cleanHeader(String(body.model || 'unknown')).slice(0, 120) || 'unknown'
  const turnId = cleanHeader(String(body.client_turn_id || body.turn_id || req.headers.get('x-chat-turn-id') || ''))

  if (turnId) {
    const turnHash = await sha256Hex(`turn:${userId}:${deviceHash}:${endpoint}:${model}:${turnId}`)
    const shouldCount = await shouldCountGatewayTurn(supabase, `gateway:turn:${turnHash}`)
    if (!shouldCount) return null
  }

  const limits = endpoint === 'image'
    ? [
      { scope: `gateway:image:user:${userId}`, limit: 8, window: 3600, block: 1800 },
      { scope: `gateway:image:device:${deviceHash}`, limit: 10, window: 3600, block: 1800 },
      { scope: `gateway:image:ip:${ipHash}`, limit: 30, window: 3600, block: 3600 },
    ]
    : [
      { scope: `gateway:chat:user:${userId}`, limit: 24, window: 900, block: 900 },
      { scope: `gateway:chat:device:${deviceHash}`, limit: 32, window: 900, block: 900 },
      { scope: `gateway:chat:ip:${ipHash}`, limit: 90, window: 900, block: 1800 },
    ]

  for (const item of limits) {
    const result = await consumeArenaLimit(supabase, item.scope, item.limit, item.window, item.block)
    if (result.allowed) continue
    return jsonResponse({
      error: 'challenge_required',
      code: 'challenge_required',
      message: endpoint === 'image'
        ? '图片生成请求过于频繁，为防止脚本消耗额度，请稍后再试。'
        : '模型请求回合过于频繁。正常工具调用不会重复计数，请稍后再试。',
      retry_after_seconds: result.retryAfter,
    }, 403, ch, { 'Retry-After': String(result.retryAfter) })
  }

  return null
}

async function handleArenaRequest(req: Request, ch: Record<string, string>, body: JsonObject, jwt: string): Promise<Response> {
  const supabase = getArenaSupabaseClient()
  if (!supabase) {
    return jsonResponse({ error: 'Service not configured', code: 'service_not_configured' }, 500, ch)
  }

  const verifiedUserId = await verifySupabaseUser(jwt)
  if (!verifiedUserId) {
    return jsonResponse({ error: 'Invalid session', code: 'invalid_session' }, 401, ch)
  }

  const action = cleanHeader(String(body.endpoint || ''))
  const ip = getClientIp(req)
  const ipHash = await sha256Hex(`ip:${ip}`)
  const deviceHash = await sha256Hex(`device:${getArenaDevice(req, verifiedUserId)}`)

  if (action === 'arena_leaderboard') {
    const { data, error } = await supabase
      .from('arena_model_stats')
      .select('model_id,wins,losses,ties,bad,total_votes,elo_score,elo_games,updated_at')
      .order('elo_score', { ascending: false })
      .order('total_votes', { ascending: false })
      .limit(50)
    if (error) throw error
    const ranked = (data || []) as Record<string, unknown>[]
    const rows = ranked.map((row: Record<string, unknown>, index: number) => {
      const wins = Number(row.wins || 0)
      const total = Number(row.total_votes || 0)
      const games = Number(row.elo_games || 0)
      const elo = Number(row.elo_score || ARENA_INITIAL_ELO)
      const eloDelta = Math.max(8, Math.round(32 / Math.sqrt(games + 1)))
      let rankSpreadLow = index + 1
      let rankSpreadHigh = index + 1
      ranked.forEach((candidate: Record<string, unknown>, candidateIndex: number) => {
        const candidateElo = Number(candidate.elo_score || ARENA_INITIAL_ELO)
        if (Math.abs(candidateElo - elo) <= eloDelta) {
          rankSpreadLow = Math.min(rankSpreadLow, candidateIndex + 1)
          rankSpreadHigh = Math.max(rankSpreadHigh, candidateIndex + 1)
        }
      })
      return {
        ...row,
        win_rate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
        rank: index + 1,
        rank_spread_low: rankSpreadLow,
        rank_spread_high: rankSpreadHigh,
        elo_delta: eloDelta,
      }
    })
    return jsonResponse({ data: rows }, 200, ch)
  }

  if (action === 'arena_create_match') {
    const limited = await enforceArenaLimits(supabase, 'create', verifiedUserId, ipHash, deviceHash)
    if (!limited.ok) {
      return new Response(await limited.response.text(), {
        status: limited.response.status,
        headers: { ...ch, 'Content-Type': 'application/json', 'Retry-After': limited.response.headers.get('Retry-After') || '60' },
      })
    }

    const prompt = cleanText(body.prompt, 6000)
    if (prompt.length < 2) {
      return jsonResponse({ error: 'Missing prompt', code: 'missing_prompt' }, 400, ch)
    }
    const promptHash = await sha256Hex(prompt.toLowerCase().replace(/\s+/g, ' ').slice(0, 2000))
    const mode = cleanHeader(String(body.mode || 'anonymous')).toLowerCase()
    const requestedA = normalizeArenaModelChoice(body.model_a)
    const requestedB = normalizeArenaModelChoice(body.model_b)
    let pair = pickArenaPair()
    if (mode === 'side_by_side' && requestedA && requestedB && requestedA !== requestedB) {
      pair = { modelA: requestedA, modelB: requestedB }
    } else if (mode === 'single' && requestedA) {
      const fallback = pickArenaPair()
      pair = { modelA: requestedA, modelB: requestedB && requestedB !== requestedA ? requestedB : fallback.modelB }
      if (pair.modelB === pair.modelA) pair.modelB = fallback.modelA === pair.modelA ? fallback.modelB : fallback.modelA
    }
    const { data, error } = await supabase
      .from('arena_matches')
      .insert({
        owner_id: verifiedUserId,
        prompt,
        prompt_hash: promptHash,
        model_a: pair.modelA,
        model_b: pair.modelB,
        ip_hash: ipHash,
        device_hash: deviceHash,
      })
      .select('id,prompt,model_a,model_b,status,created_at,expires_at')
      .single()
    if (error) throw error
    return jsonResponse({
      data: {
        id: data.id,
        prompt: data.prompt,
        status: data.status,
        created_at: data.created_at,
        expires_at: data.expires_at,
        slots: [
          { slot: 'a', label: 'Model A' },
          { slot: 'b', label: 'Model B' },
        ],
      },
    }, 201, ch)
  }

  if (action === 'arena_slot_chat') {
    const id = cleanHeader(String(body.id || ''))
    const slot = cleanHeader(String(body.slot || '')).toLowerCase()
    if (!id || !['a', 'b'].includes(slot) || !Array.isArray(body.messages)) {
      return jsonResponse({ error: 'Invalid arena chat payload', code: 'invalid_arena_chat_payload' }, 400, ch)
    }

    const { data: match, error } = await supabase
      .from('arena_matches')
      .select('id,owner_id,model_a,model_b,expires_at')
      .eq('id', id)
      .eq('owner_id', verifiedUserId)
      .maybeSingle()
    if (error) throw error
    if (!match) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404, ch)
    if (new Date(String(match.expires_at)).getTime() < Date.now()) {
      return jsonResponse({ error: 'Match expired', code: 'match_expired' }, 409, ch)
    }

    const model = slot === 'a' ? String(match.model_a) : String(match.model_b)
    const limitResponse = await enforceGatewayModelLimits(req, ch, { ...body, model }, 'chat', verifiedUserId)
    if (limitResponse) return limitResponse
    const arenaMessages = Array.isArray(body.messages)
      ? [
        { role: 'system', content: getArenaSlotSystemPrompt(model) },
        ...body.messages.filter((message: unknown) => {
          const role = (message && typeof message === 'object' && 'role' in message)
            ? String((message as Record<string, unknown>).role || '')
            : ''
          return role !== 'system'
        }),
      ]
      : []
    const arenaChatPayload: JsonObject = {
      model,
      messages: arenaMessages,
      stream: body.stream !== false,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.6,
      client_turn_id: cleanHeader(String(body.client_turn_id || '')),
    }
    if (body.enable_thinking) arenaChatPayload.enable_thinking = true
    return await forwardToModelProxy(req, ch, arenaChatPayload, verifiedUserId, 'chat')
  }

  if (action === 'arena_record_response') {
    const id = cleanHeader(String(body.id || ''))
    const slot = cleanHeader(String(body.slot || '')).toLowerCase()
    const responseText = cleanText(body.response, 20000)
    if (!id || !['a', 'b'].includes(slot)) {
      return jsonResponse({ error: 'Invalid arena response payload', code: 'invalid_arena_response_payload' }, 400, ch)
    }

    const { data: existing, error: existingError } = await supabase
      .from('arena_matches')
      .select('id,owner_id,response_a,response_b')
      .eq('id', id)
      .eq('owner_id', verifiedUserId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404, ch)

    const patch: Record<string, unknown> = slot === 'a' ? { response_a: responseText } : { response_b: responseText }
    const nextA = slot === 'a' ? responseText : String(existing.response_a || '')
    const nextB = slot === 'b' ? responseText : String(existing.response_b || '')
    if (nextA && nextB) patch.status = 'answered'

    const { data, error } = await supabase
      .from('arena_matches')
      .update(patch)
      .eq('id', id)
      .eq('owner_id', verifiedUserId)
      .select('id,status,updated_at')
      .single()
    if (error) throw error
    return jsonResponse({ data }, 200, ch)
  }

  if (action === 'arena_vote') {
    const limited = await enforceArenaLimits(supabase, 'vote', verifiedUserId, ipHash, deviceHash)
    if (!limited.ok) {
      return new Response(await limited.response.text(), {
        status: limited.response.status,
        headers: { ...ch, 'Content-Type': 'application/json', 'Retry-After': limited.response.headers.get('Retry-After') || '60' },
      })
    }

    const id = cleanHeader(String(body.id || ''))
    const winner = cleanHeader(String(body.winner || '')).toLowerCase()
    if (!id || !['a', 'b', 'tie', 'bad'].includes(winner)) {
      return jsonResponse({ error: 'Invalid vote', code: 'invalid_vote' }, 400, ch)
    }

    const { data: match, error: matchError } = await supabase
      .from('arena_matches')
      .select('*')
      .eq('id', id)
      .eq('owner_id', verifiedUserId)
      .maybeSingle()
    if (matchError) throw matchError
    if (!match) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404, ch)
    if (new Date(String(match.expires_at)).getTime() < Date.now()) {
      return jsonResponse({ error: 'Match expired', code: 'match_expired' }, 409, ch)
    }

    const { data: existingVote, error: voteCheckError } = await supabase
      .from('arena_votes')
      .select('id')
      .eq('match_id', id)
      .or(`owner_id.eq.${verifiedUserId},device_hash.eq.${deviceHash}`)
      .maybeSingle()
    if (voteCheckError) throw voteCheckError
    if (existingVote) {
      return jsonResponse({ error: 'Already voted', code: 'already_voted' }, 409, ch)
    }

    const ageMs = Date.now() - new Date(String(match.created_at)).getTime()
    let riskScore = 0
    const reasons: string[] = []
    if (ageMs < 6000) {
      riskScore += 40
      reasons.push('too_fast')
    }
    if (!match.response_a || !match.response_b) {
      riskScore += 35
      reasons.push('missing_response')
    }
    const effective = riskScore < 70
    const winningModel = winner === 'a' ? String(match.model_a) : (winner === 'b' ? String(match.model_b) : null)
    const losingModel = winner === 'a' ? String(match.model_b) : (winner === 'b' ? String(match.model_a) : null)

    const { data: vote, error: insertError } = await supabase
      .from('arena_votes')
      .insert({
        match_id: id,
        owner_id: verifiedUserId,
        winner,
        winning_model: winningModel,
        losing_model: losingModel,
        model_a: match.model_a,
        model_b: match.model_b,
        prompt_hash: match.prompt_hash,
        ip_hash: ipHash,
        device_hash: deviceHash,
        risk_score: riskScore,
        effective,
        reason: reasons.join(',') || null,
      })
      .select('*')
      .single()
    if (insertError) {
      if (String(insertError.code || '') === '23505') {
        return jsonResponse({ error: 'Already voted', code: 'already_voted' }, 409, ch)
      }
      throw insertError
    }

    await supabase
      .from('arena_matches')
      .update({ status: 'voted' })
      .eq('id', id)
      .eq('owner_id', verifiedUserId)

    let eloAfter = { modelA: ARENA_INITIAL_ELO, modelB: ARENA_INITIAL_ELO }
    let modelAStats: ArenaStatsSnapshot = normalizeArenaStats(null)
    let modelBStats: ArenaStatsSnapshot = normalizeArenaStats(null)
    try {
      modelAStats = await getArenaStatsSnapshot(supabase, String(match.model_a))
      modelBStats = await getArenaStatsSnapshot(supabase, String(match.model_b))
      eloAfter = effective
        ? calculateArenaElo(modelAStats.eloScore, modelBStats.eloScore, winner)
        : { modelA: modelAStats.eloScore, modelB: modelBStats.eloScore }

      const countEloGame = effective && winner !== 'bad'
      await upsertArenaModelStats(
        supabase,
        String(match.model_a),
        modelAStats,
        getArenaStatPatch(String(match.model_a), match as Record<string, unknown>, winner),
        eloAfter.modelA,
        countEloGame
      )
      await upsertArenaModelStats(
        supabase,
        String(match.model_b),
        modelBStats,
        getArenaStatPatch(String(match.model_b), match as Record<string, unknown>, winner),
        eloAfter.modelB,
        countEloGame
      )

      if (effective) {
        await supabase
          .from('arena_votes')
          .update({
            model_a_elo_before: modelAStats.eloScore,
            model_b_elo_before: modelBStats.eloScore,
            model_a_elo_after: eloAfter.modelA,
            model_b_elo_after: eloAfter.modelB,
          })
          .eq('id', vote.id)
      }
    } catch (eloError) {
      console.warn('Arena ELO update failed (reveal still returned):', eloError)
    }

    return jsonResponse({
      data: {
        vote,
        effective,
        reveal: {
          model_a: match.model_a,
          model_b: match.model_b,
          model_a_elo_before: modelAStats.eloScore,
          model_b_elo_before: modelBStats.eloScore,
          model_a_elo_after: eloAfter.modelA,
          model_b_elo_after: eloAfter.modelB,
        },
      },
    }, 201, ch)
  }

  return jsonResponse({ error: 'Unknown arena endpoint', code: 'unknown_arena_endpoint' }, 400, ch)
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

const MAINTENANCE_MODE = (Deno.env.get('MAINTENANCE_MODE') || '').trim().toLowerCase() === 'true'
const MAX_GATEWAY_REQUEST_BYTES = 2 * 1024 * 1024

function rejectOversizedGatewayRequest(req: Request, ch: Record<string, string>): Response | null {
  const contentLength = Number(req.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_GATEWAY_REQUEST_BYTES) {
    return jsonResponse({ error: 'Payload too large', code: 'payload_too_large' }, 413, ch)
  }
  return null
}

serve(async (req: Request) => {
  const ch = corsHeadersFor(req)
  const originResponse = rejectDisallowedOrigin(req, ch)
  if (originResponse) return originResponse

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ch })
  }

  if (MAINTENANCE_MODE) {
    return jsonResponse({
      error: 'service_unavailable',
      code: 'maintenance_mode',
      message: '系统维护中，服务暂时不可用，请稍后再试。',
      retry_after_seconds: 600,
    }, 503, ch, { 'Retry-After': '600' })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'method_not_allowed' }, 405, ch)
  }

  const oversized = rejectOversizedGatewayRequest(req, ch)
  if (oversized) return oversized

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

    if (isAnonymousJwt(jwt)) {
      return jsonResponse({ error: '请使用邮箱验证码登录后再使用。', code: 'anonymous_not_allowed' }, 401, ch)
    }

    const endpoint = cleanHeader(String(body.endpoint || 'chat')) || 'chat'

    if (endpoint.startsWith('arena_')) {
      return await handleArenaRequest(req, ch, body, jwt)
    }

    if (endpoint === 'chat_history') {
      return await forwardToChatHistory(req, ch, body, jwt)
    }

    if (endpoint === 'web_search' || endpoint === 'fetch_web_page') {
      return await forwardToWebSearch(req, ch, body, endpoint, jwt, userId)
    }

    if (endpoint === 'chat' || endpoint === 'ping' || endpoint === 'image' || endpoint === 'task') {
      const limitResponse = await enforceGatewayModelLimits(req, ch, body, endpoint, userId)
      if (limitResponse) return limitResponse
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
