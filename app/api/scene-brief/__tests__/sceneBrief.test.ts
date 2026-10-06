import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/scene-brief/route'

const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
})

function stubFetch(handler: () => Response) {
  globalThis.fetch = vi.fn(async () => handler()) as unknown as typeof fetch
}

function request(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(new URL('/api/scene-brief', 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify({ anchorPrompt: 'a misty vale', apiKey: 'k', model: 'qa/model', ...body }),
  })
}

describe('POST /api/scene-brief', () => {
  it('returns the model text, trimmed', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '  A misty vale.  ' } }] }), { status: 200 }),
    )
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sceneBrief: 'A misty vale.' })
  })

  it('passes the gateway error message and status through', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }))
    const res = await POST(request())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })

  it('passes a non-JSON error body through as the message', async () => {
    stubFetch(() => new Response('oh no', { status: 500 }))
    const res = await POST(request())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'oh no' })
  })
})
