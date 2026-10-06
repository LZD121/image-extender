import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/tile-review/route'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const original = globalThis.fetch

afterEach(() => {
  globalThis.fetch = original
})

function stubFetch(content: string) {
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
  ) as unknown as typeof fetch
}

function request(): NextRequest {
  return new NextRequest(new URL('/api/tile-review', 'http://localhost:3000'), {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'mossy stone',
      apiKey: 'k',
      model: 'qa/model',
      previewImage: PNG,
    }),
  })
}

describe('POST /api/tile-review', () => {
  it('reads a fenced verdict out of the model text', async () => {
    stubFetch('```json\n{"ok":false,"issues":["seam"],"fix":"retexture"}\n```')
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, issues: ['seam'], fix: 'retexture' })
  })

  it('treats unparseable text as an approval', async () => {
    stubFetch('nonsense')
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, issues: [], fix: '' })
  })
})
