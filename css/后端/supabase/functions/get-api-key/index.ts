import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      'https://diusqgphvybnzazgopor.supabase.co',
      'sb_secret_pp22ORhCOGN6Mpaac0SkRQ_ZF00QFAM',
      {
        global: {
          headers: {
            'apikey': 'sb_secret_pp22ORhCOGN6Mpaac0SkRQ_ZF00QFAM',
            'Authorization': 'Bearer sb_secret_pp22ORhCOGN6Mpaac0SkRQ_ZF00QFAM'
          }
        }
      }
    )

    const { data: apiKeyData, error: apiKeyError } = await supabaseClient
      .rpc('get_api_key', { p_service_name: 'modelscope' })

    if (apiKeyError || !apiKeyData) {
      return new Response(JSON.stringify({ error: 'Failed to retrieve API key' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      })
    }

    return new Response(JSON.stringify({ apiKey: apiKeyData }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
