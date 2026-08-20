/**
 * Minimal relay for the OpenAI API.
 *
 * WHY THIS EXISTS: OpenAI refuses cross-origin requests from browsers, so a
 * web page cannot call it directly no matter how the request is formed. This
 * function is the smallest possible bridge.
 *
 * WHAT IT DOES NOT DO, deliberately:
 *   - It never stores the API key. The key arrives in a header, is forwarded on
 *     the same request, and is discarded when the function returns.
 *   - It never logs the key, the prompt, or the response.
 *   - It has no database, no analytics and keeps no state between requests.
 *   - It cannot see anything the user has not chosen to send.
 *
 * The user's key stays the user's. This file is short on purpose, so anyone can
 * read it and verify that claim rather than take it on trust.
 */

export const config = { runtime: 'edge' }

const ALLOWED_PATHS: Record<string, { url: string; method: string }> = {
  chat: { url: 'https://api.openai.com/v1/chat/completions', method: 'POST' },
  models: { url: 'https://api.openai.com/v1/models', method: 'GET' }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const path = new URL(request.url).searchParams.get('path') ?? ''
  const target = ALLOWED_PATHS[path]
  if (!target) {
    return json({ error: { message: 'Unsupported path.' } }, 400)
  }

  const key = request.headers.get('x-api-key')
  if (!key) {
    return json({ error: { message: 'No API key supplied.' } }, 401)
  }

  try {
    const upstream = await fetch(target.url, {
      method: target.method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: target.method === 'POST' ? await request.text() : undefined
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json'
      }
    })
  } catch (err) {
    return json({ error: { message: `Could not reach OpenAI: ${(err as Error).message}` } }, 502)
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
  })
}
