/// <reference lib="dom" />
/// <reference lib="deno.ns" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean)
const PROXY_AUTH_TOKEN = (Deno.env.get('PROXY_AUTH_TOKEN') || '').trim()

function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin') || ''
  if (!origin) return null
  if (ALLOWED_ORIGINS.length === 0) return origin
  if (ALLOWED_ORIGINS.some(allowed => origin === allowed || origin.endsWith('.' + allowed.replace(/^https?:\/\//, '')))) return origin
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

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 30

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= RATE_LIMIT_MAX
}

function validateProxyAuth(req: Request): boolean {
  if (!PROXY_AUTH_TOKEN) return true
  const token = req.headers.get('x-proxy-token') || ''
  return token === PROXY_AUTH_TOKEN
}

const MODELSCOPE_API_BASE = 'https://api-inference.modelscope.cn/v1'
const MODELSCOPE_API_KEY = (Deno.env.get('MODELSCOPE_API_KEY') || '').trim()
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const OPENAI_COMPATIBLE_BASE_URL = (Deno.env.get('OPENAI_COMPATIBLE_BASE_URL') || '').replace(/\/$/, '')
const OPENAI_COMPATIBLE_API_KEY = Deno.env.get('OPENAI_COMPATIBLE_API_KEY') || ''
const MOONSHOT_BASE_URL = (Deno.env.get('MOONSHOT_BASE_URL') || 'https://api.moonshot.cn/v1').replace(/\/$/, '')
const MOONSHOT_API_KEY = Deno.env.get('MOONSHOT_API_KEY') || ''
const DASHSCOPE_COMPATIBLE_BASE_URL = (Deno.env.get('DASHSCOPE_COMPATIBLE_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
const DASHSCOPE_API_KEY = Deno.env.get('DASHSCOPE_API_KEY') || ''

const SILICONFLOW_BASE_URL = (Deno.env.get('SILICONFLOW_BASE_URL') || 'https://api.siliconflow.cn/v1').replace(/\/$/, '')
const SILICONFLOW_API_KEY = Deno.env.get('SILICONFLOW_API_KEY') || ''

const OPENROUTER_BASE_URL = (Deno.env.get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/$/, '')
const OPENROUTER_API_KEY_1 = Deno.env.get('OPENROUTER_API_KEY_1') || ''
const OPENROUTER_API_KEY_2 = Deno.env.get('OPENROUTER_API_KEY_2') || ''
const OPENROUTER_API_KEY_3 = Deno.env.get('OPENROUTER_API_KEY_3') || ''

const SPARK_BASE_URL = (Deno.env.get('SPARK_BASE_URL') || 'https://spark-api-open.xf-yun.com/x2').replace(/\/$$/, '')
const SPARK_API_KEY = Deno.env.get('SPARK_API_KEY') || ''

type ProviderKind = 'modelscope' | 'openai_compatible' | 'moonshot' | 'dashscope' | 'siliconflow' | 'openrouter' | 'spark'

function isOpenAICompatibleModel(model: string): boolean {
  return model === 'dall-e-3'
}

function isMoonshotModel(model: string): boolean {
  return model === 'kimi-k2.6-moonshot'
}

function isDashScopeCompatibleModel(model: string): boolean {
  const dashScopeModels = [
    'kimi-k2.6', 'glm-5', 'glm-5.1', 'glm-4.7', 'qwen3.6-plus', 'qwen3.6-max-preview', 'deepseek-v4-flash',
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
    'glm-4.7': 'glm-4.7',
    'qwen3.6-plus': 'qwen3.6-plus',
    'qwen3.6-max-preview': 'qwen3.6-max-preview',
    'deepseek-v4-flash': 'deepseek-v4-flash',
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

function isSiliconFlowModel(model: string): boolean {
  return model === 'stepfun-ai/Step-3.5-Flash' || model === 'deepseek-ai/DeepSeek-V4-Flash' || model === 'zai-org/GLM-5.1'
}

function isOpenRouterModel(model: string): boolean {
  return model === 'tencent/hy3-preview:free' || model === 'openai/gpt-oss-120b:free' || model === 'nvidia/nemotron-3-super-120b-a12b:free' || model === 'inclusionai/ling-2.6-1t:free'
}

function isSparkModel(model: string): boolean {
  return model === 'spark-x'
}

function getProviderKind(model: string): ProviderKind {
  if (isOpenAICompatibleModel(model)) return 'openai_compatible'
  if (isMoonshotModel(model)) return 'moonshot'
  if (isDashScopeCompatibleModel(model)) return 'dashscope'
  if (isSiliconFlowModel(model)) return 'siliconflow'
  if (isOpenRouterModel(model)) return 'openrouter'
  if (isSparkModel(model)) return 'spark'
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
    const response = await fetch(pingUrl, {
      method: 'HEAD',
      headers: {
        'Accept': '*/*',
        'User-Agent': USER_AGENT,
      },
    })

    const latencyMs = Math.max(0, Math.round(performance.now() - start))
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
      headers: { ...ch, 'Content-Type': 'application/json' },
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

let cachedModelScopeApiKey = ''
let modelScopeApiKeyLoaded = false

async function resolveModelScopeApiKey(): Promise<string> {
  if (!isPlaceholderModelScopeKey(MODELSCOPE_API_KEY)) {
    return MODELSCOPE_API_KEY
  }

  if (modelScopeApiKeyLoaded) {
    return cachedModelScopeApiKey
  }

  modelScopeApiKeyLoaded = true

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return ''
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
      return ''
    }

    const apiKey = String(data?.api_key || '').trim()
    if (!isPlaceholderModelScopeKey(apiKey)) {
      cachedModelScopeApiKey = apiKey
    }
  } catch (error) {
    console.error('读取 ModelScope API key 时发生异常:', error)
  }

  return cachedModelScopeApiKey
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

serve(async (req: Request) => {
  const ch = corsHeadersFor(req)

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ch })
  }

  // Proxy auth check (temporarily disabled for emergency recovery)
  // if (!validateProxyAuth(req)) {
  //   return new Response(JSON.stringify({ error: 'Unauthorized' }), {
  //     status: 401,
  //     headers: { ...ch, 'Content-Type': 'application/json' },
  //   })
  // }

  // Rate limiting
  const rateLimitKey = req.headers.get('x-user-id') || req.headers.get('x-api-key') || req.headers.get('cf-connecting-ip') || 'anonymous'
  if (!checkRateLimit(rateLimitKey)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...ch, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const { endpoint = 'chat', ...requestData } = body

    if (endpoint === 'web_search') {
      return await handleWebSearchRequest(requestData, req)
    }

    if (endpoint === 'ping') {
      return await handlePingRequest(requestData, req)
    }

    const model = String(requestData.model || '')
    const provider = getProviderKind(model)
    const modelScopeApiKey = provider === 'modelscope' ? await resolveModelScopeApiKey() : ''

    if (provider === 'openai_compatible' && (!OPENAI_COMPATIBLE_BASE_URL || !OPENAI_COMPATIBLE_API_KEY)) {
      return providerConfigError(provider, [
        ...(!OPENAI_COMPATIBLE_BASE_URL ? ['OPENAI_COMPATIBLE_BASE_URL'] : []),
        ...(!OPENAI_COMPATIBLE_API_KEY ? ['OPENAI_COMPATIBLE_API_KEY'] : []),
      ], ch)
    }

    if (provider === 'moonshot' && (!MOONSHOT_BASE_URL || !MOONSHOT_API_KEY)) {
      return providerConfigError(provider, [
        ...(!MOONSHOT_BASE_URL ? ['MOONSHOT_BASE_URL'] : []),
        ...(!MOONSHOT_API_KEY ? ['MOONSHOT_API_KEY'] : []),
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

    if (provider === 'moonshot' && !MOONSHOT_API_KEY) {
      return providerConfigError(provider, ['MOONSHOT_API_KEY'], ch)
    }

    if (provider === 'dashscope' && !DASHSCOPE_API_KEY) {
      return providerConfigError(provider, ['DASHSCOPE_API_KEY'], ch)
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

    if (provider === 'modelscope' && !modelScopeApiKey) {
      return providerConfigError(provider, ['MODELSCOPE_API_KEY or api_config.service_name=modelscope'], ch)
    }

    let url = ''
    let forwardedRequestData = requestData
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Configure based on endpoint type and model
    if (endpoint === 'image') {
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
    } else if (endpoint === 'task') {
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
        headers['Authorization'] = `Bearer ${MOONSHOT_API_KEY}`
      } else if (provider === 'dashscope') {
        url = `${DASHSCOPE_COMPATIBLE_BASE_URL}/chat/completions`
        headers['Authorization'] = `Bearer ${DASHSCOPE_API_KEY}`
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
      } else {
        url = `${MODELSCOPE_API_BASE}/chat/completions`
        headers['Authorization'] = `Bearer ${modelScopeApiKey}`
      }
    }

    // Forward request to provider
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: JSON.stringify(forwardedRequestData),
    })

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
      const rateLimitHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        if (key.toLowerCase().startsWith('modelscope-ratelimit')) {
          rateLimitHeaders[key] = value
        }
      })

      return new Response(stream, {
        headers: { ...ch, 'Content-Type': 'text/event-stream', ...rateLimitHeaders },
        status: response.status,
      })
    }

    // Handle JSON response
    const data = await response.json()

    // Forward rate limit headers
    const rateLimitHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith('modelscope-ratelimit')) {
        rateLimitHeaders[key] = value
      }
    })

    return new Response(JSON.stringify(data), {
      headers: { ...ch, 'Content-Type': 'application/json', ...rateLimitHeaders },
      status: response.status,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('modelscope-proxy internal error:', message)
    return new Response(JSON.stringify({ error: 'Internal error', detail: message.slice(0, 300) }), {
      headers: { ...ch, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
