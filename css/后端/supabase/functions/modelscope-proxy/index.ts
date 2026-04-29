/// <reference lib="dom" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id, x-api-key, accept, origin',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const MODELSCOPE_API_BASE = 'https://api-inference.modelscope.cn/v1'
const MODELSCOPE_API_KEY = Deno.env.get('MODELSCOPE_API_KEY') || ''

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

async function handleWebSearchRequest(requestData: Record<string, unknown>): Promise<Response> {
  const query = cleanText(requestData.query || requestData.search_query)
  if (!query) {
    return new Response(JSON.stringify({ error: 'Missing query' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const { endpoint = 'chat', ...requestData } = body

    if (endpoint === 'web_search') {
      return await handleWebSearchRequest(requestData)
    }

    let url = ''
    let headers: Record<string, string> = {
      'Authorization': `Bearer ${MODELSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    }

    // Configure based on endpoint type
    if (endpoint === 'image') {
      url = `${MODELSCOPE_API_BASE}/images/generations`
      headers['X-ModelScope-Async-Mode'] = 'true'
    } else if (endpoint === 'task') {
      const { taskId } = requestData
      url = `${MODELSCOPE_API_BASE}/tasks/${taskId}`
      headers['X-ModelScope-Task-Type'] = 'image_generation'
    } else {
      // Default to chat endpoint
      url = `${MODELSCOPE_API_BASE}/chat/completions`
    }

    // Forward request to ModelScope
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: JSON.stringify(requestData),
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

      return new Response(stream, {
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
        status: response.status,
      })
    }

    // Handle JSON response
    const data = await response.json()

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: response.status,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
