import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, studioRequest } from '@/app/lib/studioRequest'

const original = globalThis.fetch
let sentBody: unknown

function stubFetch(handler: () => Response) {
  globalThis.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
    sentBody = JSON.parse(init.body)
    return handler()
  }) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe('studioRequest', () => {
  it('returns the parsed body and sends the caller object as JSON', async () => {
    stubFetch(() => new Response(JSON.stringify({ imageUrl: 'x' }), { status: 200 }))
    expect(await studioRequest('/api/x', { prompt: 'a', width: 8 })).toEqual({ imageUrl: 'x' })
    expect(sentBody).toEqual({ prompt: 'a', width: 8 })
  })

  it('routes a 401 to the callback and rejects with a 401 ApiError', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'no key' }), { status: 401 }))
    const on401 = vi.fn()
    await expect(studioRequest('/api/x', {}, { on401 })).rejects.toMatchObject({ status: 401, message: 'no key' })
    expect(on401).toHaveBeenCalledTimes(1)
  })

  it('rejects with the gateway message', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
    const error = await studioRequest('/api/x', {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('boom')
  })

  it('keeps a non-JSON error body as the message', async () => {
    stubFetch(() => new Response('oh no', { status: 500 }))
    await expect(studioRequest('/api/x', {})).rejects.toThrow('oh no')
  })

  it('falls back to the caller copy when the body names nothing', async () => {
    stubFetch(() => new Response('', { status: 500 }))
    await expect(studioRequest('/api/x', {}, { fallbackMessage: 'fb' })).rejects.toThrow('fb')
  })
})
