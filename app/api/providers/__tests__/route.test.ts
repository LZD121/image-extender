import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/providers/route'

const originalFetch = globalThis.fetch
const originalMagpieBase = process.env.IE_MAGPIE_BASE_URL
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalMagpieBase === undefined) delete process.env.IE_MAGPIE_BASE_URL
  else process.env.IE_MAGPIE_BASE_URL = originalMagpieBase
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey
})

function post(body: unknown, rawBody?: string) {
  return new NextRequest(new URL('/api/providers', 'http://localhost:3000'), {
    method: 'POST',
    body: rawBody ?? JSON.stringify(body),
  } as never)
}

/** Stub the gateway and record the URL it was asked for. */
function stubGateway(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = []
  globalThis.fetch = vi.fn(async (url: unknown) => {
    calls.push(String(url))
    return handler(String(url))
  }) as unknown as typeof fetch
  return calls
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('GET /api/providers', () => {
  it('lists every gateway with its defaults, no network call', async () => {
    const calls = stubGateway(() => json({}))
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.defaultProvider).toBe('openrouter')
    expect(body.providers.map((p: { id: string }) => p.id)).toEqual(['openrouter', 'magpie', 'apimart'])
    expect(calls).toEqual([])

    const openrouter = body.providers[0]
    expect(openrouter.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(openrouter.keyRequired).toBe(true)

    const magpie = body.providers[1]
    expect(magpie.baseUrl).toBe('http://127.0.0.1:3425/v1')
    expect(magpie.keyRequired).toBe(false)

    const apimart = body.providers[2]
    expect(apimart.baseUrl).toBe('https://api.apimart.ai/v1')
    expect(apimart.keyRequired).toBe(true)
  })

  it('lets the deployment move the magpie gateway', async () => {
    process.env.IE_MAGPIE_BASE_URL = 'http://gateway.internal:9000/v1/'
    const res = await GET()
    const body = await res.json()
    expect(body.providers[1].baseUrl).toBe('http://gateway.internal:9000/v1')
  })
})

describe('POST /api/providers', () => {
  it('probes magpie without a key and ranks image models first', async () => {
    const calls = stubGateway(() =>
      json({ data: [{ id: 'commandcode/Qwen/Qwen3.7-Plus' }, { id: 'teamo-router/gemini-3.1-flash-image' }] }),
    )
    const res = await POST(post({ provider: 'magpie' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(calls).toEqual(['http://127.0.0.1:3425/v1/models'])
    expect(body.ok).toBe(true)
    expect(body.count).toBe(2)
    expect(body.imageModelCount).toBe(1)
    expect(body.models[0]).toEqual({ id: 'teamo-router/gemini-3.1-flash-image', vendor: 'teamo-router', imageCapable: true })
    expect(body.models[1].imageCapable).toBe(false)
  })

  it('requires a key for OpenRouter', async () => {
    delete process.env.OPENROUTER_API_KEY
    const calls = stubGateway(() => json({ data: [] }))
    const res = await POST(post({ provider: 'openrouter' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toContain('OpenRouter')
    expect(calls).toEqual([])
  })

  it('credits a routing-group id to the supplier that actually serves it', async () => {
    stubGateway(() =>
      json({
        data: [
          { id: 'group/auto-claude-opus-4-5', owned_by: 'apimart' },
          { id: 'apimart/claude-opus-4-6', owned_by: 'apimart' },
          { id: 'teamo-router/gemini-3.1-flash-image', owned_by: 'teamo-router' },
          { id: 'no-owner-listed' },
        ],
      }),
    )
    const res = await POST(post({ provider: 'magpie' }))
    const body = await res.json()
    const vendorOfId = (id: string) => body.models.find((m: { id: string }) => m.id === id)?.vendor
    expect(vendorOfId('group/auto-claude-opus-4-5')).toBe('apimart')
    expect(vendorOfId('apimart/claude-opus-4-6')).toBe('apimart')
    expect(vendorOfId('teamo-router/gemini-3.1-flash-image')).toBe('teamo-router')
    // No `owned_by` → fall back to the id prefix.
    expect(vendorOfId('no-owner-listed')).toBe('no-owner-listed')
  })

  it('sends the browser key as a bearer token', async () => {
    let auth: string | undefined
    globalThis.fetch = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      auth = init?.headers?.Authorization
      return json({ data: [] })
    }) as unknown as typeof fetch

    await POST(post({ provider: 'openrouter', apiKey: 'sk-or-abc' }))
    expect(auth).toBe('Bearer sk-or-abc')
  })

  it('ignores a base URL in the body — the server must not be a fetch-anywhere proxy', async () => {
    const calls = stubGateway(() => json({ data: [] }))
    await POST(post({ provider: 'magpie', baseUrl: 'http://evil.example/v1' }))
    expect(calls).toEqual(['http://127.0.0.1:3425/v1/models'])
  })

  it('falls back to OpenRouter for an unknown provider id', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env'
    const calls = stubGateway(() => json({ data: [] }))
    const res = await POST(post({ provider: 'teamo' }))
    expect((await res.json()).provider).toBe('openrouter')
    expect(calls).toEqual(['https://openrouter.ai/api/v1/models'])
  })

  it('reports a gateway that answers with an error instead of throwing', async () => {
    stubGateway(() => new Response('Please pass a valid API key', { status: 401 }))
    const res = await POST(post({ provider: 'magpie' }))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.status).toBe(401)
    expect(body.error).toContain('valid API key')
  })

  it('reports an unreachable gateway instead of throwing', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch

    const res = await POST(post({ provider: 'magpie' }))
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('fetch failed')
  })

  it('rejects a malformed body', async () => {
    stubGateway(() => json({}))
    const res = await POST(post(null, 'not json'))
    expect(res.status).toBe(400)
  })
})
