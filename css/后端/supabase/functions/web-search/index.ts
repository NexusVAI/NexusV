/// <reference lib="dom" />

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s: string) => s.trim()).filter(Boolean)
const PROXY_AUTH_TOKEN = (Deno.env.get('PROXY_AUTH_TOKEN') || '').trim()

function getAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin') || ''
  if (!origin) return null
  if (ALLOWED_ORIGINS.length === 0) return origin
  if (ALLOWED_ORIGINS.some((allowed: string) => origin === allowed || origin.endsWith('.' + allowed.replace(/^https?:\/\//, '')))) return origin
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

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 20

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

function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|localhost|::1|fc|fd|fe80)/i.test(host)) return true
    return false
  } catch {
    return true
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
  const response = await fetch(searchUrl.toString(), {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': lang === 'en' ? 'en-US,en;q=0.9' : 'zh-CN,zh;q=0.9,en;q=0.6',
      'Referer': 'https://www.baidu.com/',
      'User-Agent': USER_AGENT,
    },
  });

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
      const results = extractBaiduResultsFromHtml(html, limit);
      if (results.length) return results;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors.length ? `未获取到百度搜索结果 / ${errors[errors.length - 1]}` : '未获取到百度搜索结果');
}

async function fetchWebPage(url: string): Promise<{ title: string; content: string }> {
  const maxLength = 10000;

  const fetchDirectPage = async (): Promise<{ title: string; content: string }> => {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'Referer': url,
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
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

    // 限制内容长度
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...（内容已截断）';
    }

    return { title, content };
  };

  const fetchReadableMirror = async (): Promise<{ title: string; content: string }> => {
    const readableUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
    const response = await fetch(readableUrl, {
      headers: {
        'Accept': 'text/plain,text/markdown,text/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'Referer': url,
        'User-Agent': USER_AGENT,
      },
    });

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
    if (/HTTP\s+(412|403|406|429|451|500|502|503|504)/i.test(message)) {
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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ch });
  }

  // Proxy auth check (temporarily disabled for emergency recovery)
  // if (!validateProxyAuth(req)) {
  //   return new Response(JSON.stringify({ error: 'Unauthorized' }), {
  //     status: 401,
  //     headers: { ...ch, 'Content-Type': 'application/json' },
  //   });
  // }

  // Rate limiting
  const rateLimitKey = req.headers.get('x-user-id') || req.headers.get('x-api-key') || req.headers.get('cf-connecting-ip') || 'anonymous'
  if (!checkRateLimit(rateLimitKey)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { ...ch, 'Content-Type': 'application/json' },
    });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...ch, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const endpoint = cleanText(body.endpoint || 'web_search');

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
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...ch, 'Content-Type': 'application/json' },
    });
  }
});
