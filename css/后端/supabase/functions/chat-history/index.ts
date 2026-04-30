import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }
}

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

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

serve(async (req) => {
  const ch = corsHeadersFor(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: ch });
  }

  // Proxy token auth
  if (!validateProxyAuth(req)) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...ch, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { method } = req;
    const url = new URL(req.url);
    const userId = req.headers.get('x-user-id');
    const apiKey = req.headers.get('x-api-key');

    if (!userId && !apiKey) {
      return new Response(
        JSON.stringify({ error: 'Missing user identification' }),
        { status: 401, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveUserId = userId || apiKey;

    // Rate limiting
    if (!checkRateLimit(effectiveUserId)) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded' }),
        { status: 429, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
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

        return new Response(
          JSON.stringify({ data }),
          { status: 200, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (method === 'POST') {
      const body = await req.json();
      const { title, messages, model } = body;

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

      return new Response(
        JSON.stringify({ data }),
        { status: 201, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'PUT') {
      const body = await req.json();
      const { id, messages, title } = body;

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

      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'DELETE') {
      const id = url.searchParams.get('id');

      if (!id) {
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
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          { status: 404, headers: { ...ch, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, deletedCount: deletedRows.length }),
        { status: 200, headers: { ...ch, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...ch, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { ...corsHeadersFor(req), 'Content-Type': 'application/json' } }
    );
  }
});
