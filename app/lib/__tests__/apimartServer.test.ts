import { afterEach, describe, expect, it, vi } from 'vitest'
import { apimartSize, apimartSizeCandidates, generateViaApimart } from '@/app/lib/apimartServer'

const originalFetch = globalThis.fetch
const originalKey = process.env.APIMART_API_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.APIMART_API_KEY
  else process.env.APIMART_API_KEY = originalKey
  vi.useRealTimers()
})

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * Stub the three round trips a generation makes: submit, poll, download. The
 * poll counts calls so a completed task is reported on the second look, which
 * is what the real API does behind the ~2.5s interval.
 */
function stubApimart(options: {
  submit?: unknown
  submitStatus?: number
  taskStatus?: string[]
  imageUrl?: string | string[]
  /** Reject every submit that carries a `size`, the way xAI's models do. */
  rejectAnySize?: boolean
}) {
  const calls: { url: string; body?: unknown }[] = []
  const statuses = options.taskStatus ?? ['pending', 'completed']
  let polls = 0
  globalThis.fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
    const href = String(url)
    const body: unknown = init?.body ? JSON.parse(init.body) : undefined
    calls.push({ url: href, body })
    if (href.endsWith('/images/generations')) {
      const carriesSize = !!body && typeof body === 'object' && 'size' in body
      if (options.rejectAnySize && carriesSize) {
        return json({ error: { message: 'parameter "size" is not supported for asynchronous xAI image tasks' } }, 400)
      }
      return options.submitStatus && options.submitStatus !== 200
        ? json(options.submit ?? {}, options.submitStatus)
        : json(options.submit ?? { code: 200, data: [{ status: 'submitted', task_id: 'task_1' }] })
    }
    if (href.includes('/tasks/')) {
      const status = statuses[Math.min(polls, statuses.length - 1)]
      polls += 1
      return json({
        code: 200,
        data: {
          status,
          cost: 0.00322,
          ...(status === 'completed' ? { result: { images: [{ url: options.imageUrl ?? 'https://getapib.org/image/a.png' }] } } : {}),
        },
      })
    }
    return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } })
  }) as unknown as typeof fetch
  return calls
}

const GENERATE = { provider: 'apimart', apiKey: 'sk-test', model: 'gpt-image-2-official', prompt: 'a red square', width: 2048, height: 1024 }

describe('apimartSize', () => {
  it('asks for exact pixels on the model that takes them', () => {
    expect(apimartSize(2048, 1024, 'gpt-image-2-official')).toEqual({ size: '2048x1024' })
    expect(apimartSize(1024, 1024, 'gpt-image-2-official')).toEqual({ size: '1024x1024' })
  })

  it('snaps exact edges to the multiple of 16 the vendor demands', () => {
    // The full-context extend canvas is 38% wider than 1024; the vendor refuses
    // 1413x1024 with "pixel dimensions must be multiples of 16".
    expect(apimartSize(1413, 1024, 'gpt-image-2-official')).toEqual({ size: '1408x1024' })
    expect(apimartSize(1400, 1000, 'gpt-image-2-official')).toEqual({ size: '1408x1008' })
  })

  it('falls back to a ratio + tier past the exact-pixel edge cap', () => {
    // 4096 is over the 3840 cap, so a tile sheet asks for 1:1 @ 4k instead.
    expect(apimartSize(4096, 4096, 'gpt-image-2-official')).toEqual({ size: '1:1', resolution: '4k' })
  })

  it('uses the ratio set the chat gateways reject, for other models', () => {
    // 2:1 exists on APIMart and does not exist on OpenRouter.
    expect(apimartSize(2048, 1024, 'some-other-image-model')).toEqual({ size: '2:1', resolution: '2k' })
    expect(apimartSize(512, 512, 'some-other-image-model')).toEqual({ size: '1:1', resolution: '1k' })
    expect(apimartSize(1440, 1080, 'some-other-image-model')).toEqual({ size: '4:3', resolution: '1k' })
  })

  it('takes exact pixels for the dall-e family, which rejects ratios', () => {
    expect(apimartSize(1024, 1024, 'dall-e-3')).toEqual({ size: '1024x1024' })
  })

  it('offers the size shapes in the order worth trying, without duplicates', () => {
    // Ratio first for a model with no exact-pixel habit, then the exact size,
    // then the higher tiers a model like seedream-4-5 demands, then no size.
    expect(apimartSizeCandidates(1024, 1024, 'z-image-turbo')).toEqual([
      { size: '1:1', resolution: '1k' },
      { size: '1024x1024' },
      { size: '1:1', resolution: '2k' },
      { size: '1:1', resolution: '4k' },
      {},
    ])
    // The 1:1 @ 2k tier is the preferred shape here, so it is not repeated.
    expect(apimartSizeCandidates(2048, 1024, 'gpt-image-2-official')).toEqual([
      { size: '2048x1024' },
      { size: '2:1', resolution: '2k' },
      { size: '2:1', resolution: '4k' },
      {},
    ])
    // Past the exact-pixel cap there is no point offering an exact size.
    expect(apimartSizeCandidates(4096, 4096, 'gpt-image-2-official')).toEqual([
      { size: '1:1', resolution: '4k' },
      {},
    ])
  })
})

/**
 * The adapter waits `POLL_EVERY_MS` between task lookups. Fake time makes the
 * whole submit/poll/download exchange instant instead of a real sleep.
 */
async function runGeneration(opts: Parameters<typeof generateViaApimart>[0], rounds = 4) {
  vi.useFakeTimers()
  const pending = generateViaApimart(opts)
  for (let round = 0; round < rounds; round++) await vi.advanceTimersByTimeAsync(2500)
  return pending
}

describe('generateViaApimart', () => {
  it('submits, polls, inlines the expiring result and reports the vendor cost', async () => {
    const calls = stubApimart({ imageUrl: ['https://getapib.org/image/a.png', 'https://getapib.org/image/b.png'] })
    const result = await runGeneration(GENERATE)

    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(result.cost).toBe(0.00322)
    expect(result.size).toBe('2048x1024')

    const submit = calls.find((c) => c.url.endsWith('/images/generations'))
    expect(submit?.body).toEqual({ model: 'gpt-image-2-official', prompt: 'a red square', size: '2048x1024', n: 1 })
    expect(calls.filter((c) => c.url.includes('/tasks/')).length).toBe(2)
    expect(calls.some((c) => c.url === 'https://getapib.org/image/a.png')).toBe(true)
  })

  it('passes reference images through as data URLs and drops anything else', async () => {
    const calls = stubApimart({})
    await runGeneration({
      ...GENERATE,
      references: ['data:image/png;base64,AAAA', 'https://elsewhere.example/x.png'],
    })
    const submit = calls.find((c) => c.url.endsWith('/images/generations'))
    expect(submit?.body).toMatchObject({ image_urls: ['data:image/png;base64,AAAA'] })
  })

  it('refuses a gateway it does not serve', async () => {
    const result = await generateViaApimart({ ...GENERATE, provider: 'magpie' })
    expect('error' in result && result.error).toContain('Magpie')
  })

  it('asks for a key when there is none anywhere', async () => {
    delete process.env.APIMART_API_KEY
    const result = await generateViaApimart({ ...GENERATE, apiKey: '' })
    expect('error' in result && result.error).toContain('APIMart API key missing')
  })

  it('carries the vendor message when the submit is rejected', async () => {
    stubApimart({ submit: { error: { message: '`/v1/images/edits` only supports Grok image models.' } }, submitStatus: 400 })
    const result = await generateViaApimart(GENERATE)
    expect('error' in result && result.error).toContain('only supports Grok')
  })

  it('reports a failed task with the vendor message', async () => {
    stubApimart({ taskStatus: ['failed'] })
    const result = await runGeneration(GENERATE)
    expect('error' in result).toBe(true)
  })

  it('reports a completed task that carries no image', async () => {
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('/tasks/')
        ? json({ data: { status: 'completed', result: { images: [] } } })
        : json({ data: [{ task_id: 'task_1' }] }),
    ) as unknown as typeof fetch

    const result = await runGeneration(GENERATE)
    expect('error' in result && result.error).toContain('without an image')
  })

  it('steps down to a size-less submit when the vendor rejects the parameter', async () => {
    const calls = stubApimart({ rejectAnySize: true })
    const result = await runGeneration({ ...GENERATE, model: 'grok-imagine-image' })

    expect('error' in result).toBe(false)
    if ('error' in result) return
    // Every shape that carries a size is refused; the last one omits it.
    const submits = calls.filter((c) => c.url.endsWith('/images/generations')).map((c) => c.body)
    expect(submits).toHaveLength(4)
    expect(submits[0]).toMatchObject({ size: '2:1' })
    expect(submits[1]).toMatchObject({ size: '2048x1024' })
    expect(submits[2]).toMatchObject({ size: '2:1', resolution: '4k' })
    expect(submits[3]).toEqual({ model: 'grok-imagine-image', prompt: 'a red square', n: 1 })
    expect(result.size).toBe('model default')
  })

  it('does not retry a rejection that is not about the size', async () => {
    const calls = stubApimart({ submit: { error: { message: 'This API key does not have access to model X.' } }, submitStatus: 403 })
    const result = await generateViaApimart(GENERATE)
    expect('error' in result && result.error).toContain('does not have access')
    expect(calls.filter((c) => c.url.endsWith('/images/generations'))).toHaveLength(1)
  })
})
