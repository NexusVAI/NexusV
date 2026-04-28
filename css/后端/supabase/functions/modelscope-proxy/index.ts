import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODELSCOPE_API_BASE = 'https://api-inference.modelscope.cn/v1'
const MODELSCOPE_API_KEY = 'ms-e5cc3b83-f654-433f-befb-d5d96e8df57e'

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { endpoint = 'chat', ...requestData } = body

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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
