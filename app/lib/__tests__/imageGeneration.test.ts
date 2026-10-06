import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImage } from '@/app/lib/imageGeneration'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const originalFetch = globalThis.fetch
const originalKey = process.env.APIMART_API_KEY
const originalConfig = process.env.IE_CONFIG

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.APIMART_API_KEY
  else process.env.APIMART_API_KEY = originalKey
  if (originalConfig === undefined) delete process.env.IE_CONFIG
  else process.env.IE_CONFIG = originalConfig
  vi.useRealTimers()
})

type Call = { url: string; body?: unknown }

function stub(handler: (url: string, body: unknown) => Response): Call[] {
  const calls: Call[] = []
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const body: unknown = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), body })
    return handler(String(url), body)
  }) as unknown as typeof fetch
  return calls
}

/** The three round trips an APIMart generation makes. */
function stubApimart(): Call[] {
  let polls = 0
  return stub((url) => {
    if (url.endsWith('/images/generations')) {
      return new Response(JSON.stringify({ data: [{ task_id: 'task_1' }] }), { status: 200 })
    }
    if (url.includes('/tasks/')) {
      const status = polls++ === 0 ? 'pending' : 'completed'
      const payload =
        status === 'completed'
          ? { data: { status, cost: 0.004, result: { images: [{ url: 'https://cdn.test/a.png' }] } } }
          : { data: { status, cost: 0.004 } }
      return new Response(JSON.stringify(payload), { status: 200 })
    }
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })
  })
}

/** A chat gateway answering with a render and a names line. */
function stubChat(content: string | null, image = PNG): Call[] {
  return stub(
    () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content, images: image ? [{ image_url: { url: image } }] : [] } }],
          usage: { cost: 0.02 },
        }),
        { status: 200 },
      ),
  )
}

const CHAT = { provider: 'openrouter' as const, apiKey: 'sk-or-x', model: 'image/model', title: 't' }

describe('generateImage', () => {
  it('hands back the resolved credential error as a 401', async () => {
    delete process.env.APIMART_API_KEY
    const result = await generateImage({
      ...CHAT,
      provider: 'apimart',
      apiKey: undefined,
      model: 'gpt-image-2-official',
      prompt: 'x',
      width: 1024,
      height: 1024,
      temperature: 0.7,
    })
    expect(result).toMatchObject({ status: 401, reason: 'credentials' })
    expect('error' in result && result.error).toContain('APIMart API key missing')
  })

  it('refuses an APIMart request that names no canvas, and does not call out', async () => {
    const calls = stubApimart()
    const result = await generateImage({
      provider: 'apimart',
      apiKey: 'sk-test',
      model: 'gpt-image-2-official',
      title: 't',
      prompt: 'x',
      temperature: 0.7,
    })
    expect(result).toMatchObject({ status: 400, reason: 'size' })
    expect('error' in result && result.error).toContain('full-context extend path')
    expect(calls.filter((c) => c.url.includes('/images/generations'))).toHaveLength(0)
  })

  it('uses the async adapter for APIMart, inlining the result and its cost', async () => {
    const calls = stubApimart()
    vi.useFakeTimers()
    const pending = generateImage({
      provider: 'apimart',
      apiKey: 'sk-test',
      model: 'gpt-image-2-official',
      title: 't',
      prompt: 'a red square',
      width: 2048,
      height: 1024,
      temperature: 0.7,
      references: [PNG],
    })
    // The adapter waits between task lookups; fake time makes it instant.
    for (let round = 0; round < 4; round++) await vi.advanceTimersByTimeAsync(2500)
    const result = await pending
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.imageUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(result.provider).toBe('apimart')
    expect(result.model).toBe('gpt-image-2-official')
    expect(result.size).toBe('2048x1024')
    expect(result.cost).toEqual({ usd: 0.004, source: 'apimart' })
    expect(calls.some((c) => c.url.includes('/chat/completions'))).toBe(false)
  })

  it('uses the chat adapter otherwise, keeping the reply text and the cost', async () => {
    const calls = stubChat('ITEMS: a | b')
    const result = await generateImage({
      ...CHAT,
      prompt: 'a red square',
      temperature: 0.7,
      content: [{ type: 'text', text: 'a red square' }],
      extra: { modalities: ['image', 'text'] },
    })
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result).toEqual({
      imageUrl: PNG,
      cost: { usd: 0.02, source: 'openrouter' },
      provider: 'openrouter',
      model: 'image/model',
      text: 'ITEMS: a | b',
    })
    const chat = calls.find((c) => c.url.includes('/chat/completions'))
    expect(chat?.body).toMatchObject({ model: 'image/model', modalities: ['image', 'text'], stream: false })
  })

  it('reports a reply with no render, carrying the message for the caller', async () => {
    stubChat(null, '')
    const result = await generateImage({ ...CHAT, prompt: 'x', temperature: 0.7 })
    expect(result).toMatchObject({ status: 500, reason: 'no-image' })
    expect('message' in result && !!result.message).toBe(true)
  })
})
