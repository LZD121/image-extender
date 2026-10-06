import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeGatewayModels } from '@/app/lib/gatewayProbe'

const original = globalThis.fetch

function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) =>
    handler(String(url), (init ?? {}) as RequestInit),
  ) as unknown as typeof fetch
}

afterEach(() => {
  globalThis.fetch = original
})

describe('probeGatewayModels', () => {
  it('lists the reported models, image-capable first', async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ data: [{ id: 'b', owned_by: null }, { id: 'a-image', owned_by: 'v' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await probeGatewayModels({ providerId: 'magpie', baseUrl: 'http://gw.test/v1', key: '' })
    expect(result).toEqual({
      ok: true,
      provider: 'magpie',
      baseUrl: 'http://gw.test/v1',
      models: [
        { id: 'a-image', vendor: 'v', imageCapable: true },
        { id: 'b', vendor: 'b', imageCapable: false },
      ],
    })
  })

  it('carries the status and the gateway text of a refused probe', async () => {
    stubFetch(() => new Response('boom', { status: 500 }))
    const result = await probeGatewayModels({ providerId: null, baseUrl: 'http://gw.test/v1', key: 'k' })
    expect(result).toEqual({ ok: false, provider: null, baseUrl: 'http://gw.test/v1', status: 500, error: 'boom' })
  })

  it('names the timeout in the error', async () => {
    stubFetch(() => {
      const error = new Error('timed out')
      error.name = 'TimeoutError'
      throw error
    })
    const result = await probeGatewayModels({ providerId: null, baseUrl: 'http://gw.test/v1', key: '' })
    expect(result).toEqual({
      ok: false,
      provider: null,
      baseUrl: 'http://gw.test/v1',
      error: 'No answer within 15s from http://gw.test/v1.',
    })
  })

  it('treats a payload with no model list as an empty gateway', async () => {
    stubFetch(() => new Response(JSON.stringify({ object: 'list' }), { status: 200 }))
    const result = await probeGatewayModels({ providerId: null, baseUrl: 'http://gw.test/v1', key: '' })
    expect(result).toEqual({ ok: true, provider: null, baseUrl: 'http://gw.test/v1', models: [] })
  })
})
