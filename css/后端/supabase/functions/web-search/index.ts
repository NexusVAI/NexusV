/// <reference lib="dom" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
}

function validateProxyAuth(req: Request): boolean {
  if (!PROXY_AUTH_TOKEN) return true
  const token = req.headers.get('x-proxy-token') || ''
  return token === PROXY_AUTH_TOKEN
}

const abuseMap = new Map<string, { count: number; resetAt: number; lastAt: number; rapidHits: number; challengeUntil: number; blockedUntil: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20
const CHALLENGE_DURATION_MS = 10 * 60_000
const BLOCK_DURATION_MS = 60 * 60_000
const RAPID_REQUEST_MS = 700
const MAX_REQUEST_BYTES = 1024 * 1024
const SEARCH_FETCH_TIMEOUT_MS = 12_000
const PAGE_FETCH_TIMEOUT_MS = 18_000

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

function getEndpointLimit(endpoint: string): number {
  if (endpoint === 'fetch_web_page') return 12
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
        message: '检测到异常高频搜索请求，已暂时停止为此 IP 提供服务。',
        retry_after_seconds: result.retryAfter,
      }, 403, ch, { 'Retry-After': String(result.retryAfter) })
    }
    return jsonResponse({
      error: 'challenge_required',
      code: 'challenge_required',
      message: '检测到异常搜索速度。出于公平使用，本次请求需要安全验证或稍后重试。',
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

function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
    const host = parsed.hostname
    if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|localhost|::1|fc|fd|fe80)/i.test(host)) return true
    if (/(\.local|metadata\.google\.internal)$/i.test(host)) return true
    return false
  } catch {
    return true
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = SEARCH_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

const BAIDU_SEARCH_URL = 'https://www.baidu.com/s';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripHtml(value: string): string {
  return cleanText(value.replace(/<[^>]+>/g, ' '));
}

function normalizeBaiduResultUrl(url: string): string {
  const cleaned = cleanText(url);
  if (!cleaned) return '';
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) return cleaned;
  if (cleaned.startsWith('/')) return `https://www.baidu.com${cleaned}`;
  return cleaned;
}

async function resolveBaiduRedirectUrl(url: string): Promise<string> {
  if (!/^https?:\/\/(?:www\.)?baidu\.com\/link\?/i.test(url)) return url;
  try {
    const response = await fetchWithTimeout(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'Accept': '*/*',
        'Referer': 'https://www.baidu.com/',
        'User-Agent': USER_AGENT,
      },
    }, 6000);
    const finalUrl = response.url || url;
    return isPrivateUrl(finalUrl) ? url : finalUrl;
  } catch {
    return url;
  }
}

function isLikelySearchResultTitle(title: string): boolean {
  const normalized = cleanText(title);
  if (!normalized) return false;
  if (normalized.length < 4 || normalized.length > 180) return false;
  return !/^(百度一下|首页|新闻|视频|图片|地图|贴吧|知道|文库|更多|登录|注册|设置|帮助|下载|反馈|换一换|上一页|下一页|搜索|我的)$/i.test(normalized);
}

function extractBaiduResultsFromHtml(html: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const candidatePatterns = [
    /<h3[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gis,
    /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*(?:c-title-text|c-title|result|title)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gis,
  ];

  for (const pattern of candidatePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const url = normalizeBaiduResultUrl(match[1]);
      const title = stripHtml(match[2]);
      if (!isLikelySearchResultTitle(title)) continue;
      if (!url || /^(javascript:|#)/i.test(url)) continue;

      const key = `${title}::${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        title,
        url,
        snippet: '点击查看详情',
        source: 'baidu',
      });

      if (results.length >= limit) return results;
    }
  }

  if (results.length < limit) {
    const genericPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gis;
    let match: RegExpExecArray | null;
    while ((match = genericPattern.exec(html)) !== null) {
      const url = normalizeBaiduResultUrl(match[1]);
      const title = stripHtml(match[2]);
      if (!isLikelySearchResultTitle(title)) continue;
      if (!url || /^(javascript:|#)/i.test(url)) continue;
      if (/^(百度一下|首页|新闻|视频|图片|地图|贴吧|知道|文库|更多|登录|注册|设置|帮助|下载|反馈)$/i.test(title)) continue;

      const key = `${title}::${url}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        title,
        url,
        snippet: '点击查看详情',
        source: 'baidu',
      });

      if (results.length >= limit) break;
    }
  }

  return uniqueResults(results, limit);
}

async function fetchSearchPage(searchUrl: URL, lang: string): Promise<string> {
  const response = await fetchWithTimeout(searchUrl.toString(), {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9,en;q=0.6',
      'Referer': 'https://www.baidu.com/',
      'User-Agent': USER_AGENT,
    },
  }, SEARCH_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.text();
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

async function searchBaidu(query: string, lang: string, limit: number): Promise<SearchResult[]> {
  const desktopUrl = new URL(BAIDU_SEARCH_URL);
  desktopUrl.searchParams.set('wd', query);
  desktopUrl.searchParams.set('rn', String(Math.max(limit * 2, 10)));
  desktopUrl.searchParams.set('ie', 'utf-8');

  const mobileUrl = new URL('https://m.baidu.com/s');
  mobileUrl.searchParams.set('word', query);
  mobileUrl.searchParams.set('rn', String(Math.max(limit * 2, 10)));
  mobileUrl.searchParams.set('ie', 'utf-8');

  const attempts = [desktopUrl, mobileUrl];
  const errors: string[] = [];

  for (const url of attempts) {
    try {
      const html = await fetchSearchPage(url, lang);
      const results = await Promise.all(extractBaiduResultsFromHtml(html, limit).map(async result => ({
        ...result,
        url: await resolveBaiduRedirectUrl(result.url),
      })));
      if (results.length) return results;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.length ? `未获取到百度搜索结果 / ${errors[errors.length - 1]}` : '未获取到百度搜索结果');
}

async function fetchWebPage(url: string): Promise<{ title: string; content: string }> {
  const maxLength = 10000;
  const targetUrl = await resolveBaiduRedirectUrl(url);

  const fetchDirectPage = async (): Promise<{ title: string; content: string }> => {
    const response = await fetchWithTimeout(targetUrl, {
      redirect: 'follow',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'Referer': targetUrl,
        'User-Agent': USER_AGENT,
      },
    }, PAGE_FETCH_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (response.url && isPrivateUrl(response.url)) {
      throw new Error('Redirect target not allowed');
    }

    const html = await response.text();

    // 提取标题
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
    const title = titleMatch ? stripHtml(titleMatch[1]) : '未知标题';

    // 提取正文内容 - 移除 script、style 等标签
    let content = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');

    // 提取主要内容区域
    const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/is);
    if (bodyMatch) {
      content = bodyMatch[1];
    }

    // 移除所有 HTML 标签，只保留文本
    content = content.replace(/<[^>]+>/g, '\n');

    // 清理多余空白
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    if (content.length < 120 || /百度安全验证|访问过于频繁|请输入验证码|Access Denied|Just a moment/i.test(content)) {
      throw new Error('Readable content too short or blocked');
    }

    // 限制内容长度
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...（内容已截断）';
    }

    return { title, content };
  };

  const fetchReadableMirror = async (): Promise<{ title: string; content: string }> => {
    const readableUrl = `https://r.jina.ai/${targetUrl}`;
    const response = await fetchWithTimeout(readableUrl, {
      headers: {
        'Accept': 'text/plain,text/markdown,text/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'Referer': targetUrl,
        'User-Agent': USER_AGENT,
      },
    }, PAGE_FETCH_TIMEOUT_MS);

    if (!response.ok) {
      throw new Error(`Readable mirror HTTP ${response.status}`);
    }

    let content = (await response.text()).replace(/\r\n/g, '\n').trim();
    if (!content) {
      throw new Error('Readable mirror returned empty content');
    }

    const firstHeadingMatch = content.match(/^#\s+(.+)$/m) || content.match(/^Title:\s*(.+)$/im);
    const title = firstHeadingMatch ? cleanText(firstHeadingMatch[1]) : '网页内容';

    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...（内容已截断）';
    }

    return { title, content };
  };

  try {
    return await fetchDirectPage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP\s+(412|403|406|429|451|500|502|503|504)|Readable content too short|Redirect target not allowed|aborted|timeout/i.test(message)) {
      try {
        return await fetchReadableMirror();
      } catch (mirrorError) {
        throw new Error(`获取网页内容失败: ${message} / ${mirrorError instanceof Error ? mirrorError.message : String(mirrorError)}`);
      }
    }

    throw new Error(`获取网页内容失败: ${message}`);
  }
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
    const baseCtx = getRequestContext(req, 'web-search')
    const oversized = rejectOversizedRequest(req, ch, baseCtx)
    if (oversized) return oversized

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...ch, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const endpoint = cleanText(body.endpoint || 'web_search');
    const ctx = getRequestContext(req, 'web-search', endpoint)
    const abuseResponse = enforceAbuseGuard(ctx, ch)
    if (abuseResponse) return abuseResponse
    logSecurityEvent('request_started', ctx, { method: req.method })

    if (endpoint === 'fetch_web_page') {
      const url = cleanText(body.url);
      if (!url) {
        return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
          status: 400,
          headers: { ...ch, 'Content-Type': 'application/json' },
        });
      }

      // SSRF protection: block private/internal URLs
      if (isPrivateUrl(url)) {
        return new Response(JSON.stringify({ error: 'URL not allowed' }), {
          status: 400,
          headers: { ...ch, 'Content-Type': 'application/json' },
        });
      }

      const pageData = await fetchWebPage(url);
      logSecurityEvent('request_finished', ctx, { status: 200, durationMs: Math.round(performance.now() - startedAt) })
      return new Response(JSON.stringify({
        url,
        title: pageData.title,
        content: pageData.content,
      }), {
        status: 200,
        headers: { ...ch, 'Content-Type': 'application/json' },
      });
    }

    // 默认 web_search 端点
    const query = cleanText(body.query || body.search_query);
    if (!query) {
      return new Response(JSON.stringify({ error: 'Missing query' }), {
        status: 400,
        headers: { ...ch, 'Content-Type': 'application/json' },
      });
    }

    const lang = body.lang === 'en' ? 'en' : 'zh';
    const limitValue = Number(body.limit);
    const limit = Math.max(1, Math.min(10, Number.isFinite(limitValue) ? Math.round(limitValue) : 5));
    const results = await searchBaidu(query, lang, limit);
    logSecurityEvent('request_finished', ctx, { status: 200, resultCount: results.length, durationMs: Math.round(performance.now() - startedAt) })

    return new Response(JSON.stringify({
      query,
      lang,
      source: 'baidu',
      count: results.length,
      results,
    }), {
      status: 200,
      headers: { ...ch, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const ctx = getRequestContext(req, 'web-search')
    const message = error instanceof Error ? error.message : String(error)
    logSecurityEvent('request_failed', ctx, { durationMs: Math.round(performance.now() - startedAt), error: message.slice(0, 160) })
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...ch, 'Content-Type': 'application/json' },
    });
  }
});
