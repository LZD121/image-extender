import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/providers/route'

const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
})

function stubFetch(handler: () => Response) {
  globalThis.fetch = vi.fn(async () => handler()) as unknown as typeof fetch
}

function request(body: unknown): NextRequest {
  return new NextRequest(new URL('/api/providers', 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/providers', () => {
  it('reports the model list the gateway returned', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ data: [{ id: 'chat-model' }, { id: 'gemini-3-image' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const res = await POST(request({ provider: 'openrouter', apiKey: 'k' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, provider: 'openrouter', count: 2, imageModelCount: 1 })
  })

  it('answers 200 with ok:false when the gateway refuses', async () => {
    stubFetch(() => new Response('nope', { status: 500 }))
    const res = await POST(request({ provider: 'openrouter', apiKey: 'k' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, status: 500, error: 'nope' })
  })
})
