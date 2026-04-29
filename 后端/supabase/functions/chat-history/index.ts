import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'https://diusqgphvybnzazgopor.supabase.co';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id, x-api-key',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { method } = req;
    const url = new URL(req.url);
    const userId = req.headers.get('x-user-id');
    const apiKey = req.headers.get('x-api-key');

    if (!userId && !apiKey) {
      return new Response(
        JSON.stringify({ error: 'Missing user identification' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveUserId = userId || apiKey;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 使用 service role key 访问数据库，并通过显式 user_id 过滤隔离每个用户的记录

    if (method === 'GET') {
      const id = url.searchParams.get('id');
      
      if (id) {
        // 获取单条聊天记录详情
        const { data, error } = await supabase
          .from('chat_history')
          .select('*')
          .eq('id', id)
          .eq('user_id', effectiveUserId)
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        // 获取聊天记录列表
        const { data, error } = await supabase
          .from('chat_history')
          .select('id, title, model, created_at, updated_at')
          .eq('user_id', effectiveUserId)
          .order('updated_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ data }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    if (method === 'POST') {
      // 创建新聊天记录
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
        { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'PUT') {
      // 更新聊天记录
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
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (method === 'DELETE') {
      // 删除聊天记录
      const id = url.searchParams.get('id');

      if (!id) {
        return new Response(
          JSON.stringify({ error: 'Missing chat history id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
          JSON.stringify({ error: 'Chat history not found or not owned by current user' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, deletedCount: deletedRows.length }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
