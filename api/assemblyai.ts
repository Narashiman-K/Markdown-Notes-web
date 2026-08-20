/**
 * Minimal relay for the AssemblyAI API, used for audio transcription.
 *
 * Same reasoning and same guarantees as api/openai.ts: AssemblyAI does not
 * allow cross-origin browser requests, so this is the smallest possible bridge.
 * The key is forwarded and discarded. Nothing is stored, logged or retained —
 * including the audio, which is streamed straight through.
 */

export const config = { runtime: 'edge' }

const BASE = 'https://api.assemblyai.com/v2'

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const path = new URL(request.url).searchParams.get('path') ?? ''

  // Only the three endpoints the app actually needs, so this cannot be used as
  // an open relay to arbitrary URLs.
  const allowed = path === 'upload' || path === 'transcript' || /^transcript\/[\w-]+$/.test(path)
  if (!allowed) {
    return json({ error: 'Unsupported path.' }, 400)
  }

  const key = request.headers.get('x-api-key')
  if (!key) {
    return json({ error: 'No API key supplied.' }, 401)
  }

  try {
    const upstream = await fetch(`${BASE}/${path}`, {
      method: request.method,
      headers: {
        authorization: key,
        'content-type': request.headers.get('content-type') ?? 'application/json'
      },
      body: request.method === 'POST' ? request.body : undefined,
      // Required by the Fetch standard when streaming a request body.
      duplex: 'half'
    } as RequestInit & { duplex: string })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json'
      }
    })
  } catch (err) {
    return json({ error: `Could not reach AssemblyAI: ${(err as Error).message}` }, 502)
  }
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
  })
}
