import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCompletion, type ChatReply } from '@/app/lib/llmChat'
import { PROVIDERS } from '@/app/lib/providers'

const original = globalThis.fetch
const target = {
  provider: PROVIDERS.openrouter,
  url: 'https://gw.test/v1/chat/completions',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
}

let sentBody: Record<string, unknown> = {}

function stubFetch(response: () => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (_url: unknown, init: { body: string }) => {
    sentBody = JSON.parse(init.body)
    return response()
  }) as unknown as typeof fetch
}

function call(): Promise<ChatReply> {
  return chatCompletion({
    target,
    model: 'some/model',
    messages: [{ role: 'user', content: 'hi' }],
    maxTokens: 2000,
    temperature: 0.7,
  })
}

afterEach(() => {
  globalThis.fetch = original
})

describe('chatCompletion', () => {
  it('sends one non-streaming chat body and returns the message', async () => {
    stubFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { cost: 0.5 } }), { status: 200 }))
    const reply = await call()
    expect(reply).toEqual({ ok: true, message: { content: 'hi' }, data: { choices: [{ message: { content: 'hi' } }], usage: { cost: 0.5 } } })
    expect(sentBody).toMatchObject({ model: 'some/model', max_tokens: 2000, temperature: 0.7, stream: false })
  })

  it('reports a reply with no message', async () => {
    stubFetch(() => new Response(JSON.stringify({ choices: [] }), { status: 200 }))
    expect(await call()).toEqual({ ok: false, status: 500, error: 'No message in response' })
  })

  it('reports a 200 that is not JSON', async () => {
    stubFetch(() => new Response('not json', { status: 200 }))
    expect(await call()).toEqual({ ok: false, status: 500, error: 'Gateway returned invalid JSON' })
  })

  it('takes the gateway message off an error body', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { message: 'slow down' } }), { status: 429 }))
    expect(await call()).toEqual({ ok: false, status: 429, error: 'slow down' })
  })

  it('falls back to the raw error text', async () => {
    stubFetch(() => new Response('oh no', { status: 500 }))
    expect(await call()).toEqual({ ok: false, status: 500, error: 'oh no' })
  })

  it('reports a dead connection as 502', async () => {
    stubFetch(() => {
      throw new Error('connect ECONNREFUSED')
    })
    const reply = await call()
    expect(reply).toMatchObject({ ok: false, status: 502, error: 'connect ECONNREFUSED' })
  })
})
