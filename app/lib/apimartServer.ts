// app/lib/apimartServer.ts
/**
 * APIMart's image models are an ASYNC TASK API, not a chat completion:
 *
 *   POST {base}/images/generations → { code, data: [{ task_id }] }
 *   GET  {base}/tasks/{id}         → { data: { status, result: { images: [{ url }] }, cost } }
 *
 * Two consequences shape everything here:
 *  - the finished render is an EXPIRING cross-origin URL, so it is downloaded
 *    and inlined as a data URL. A canvas the client cannot read would break
 *    every deterministic post-process (chroma key, slicing, Poisson blending).
 *  - one image costs several round trips and ~10–20s, so the poll is bounded
 *    and every failure carries the vendor's own message instead of a guess.
 */

import { providerKey, serverProvider } from '@/app/lib/llmServer'

const POLL_EVERY_MS = 2500
const POLL_LIMIT_MS = 6 * 60 * 1000
const REQUEST_TIMEOUT_MS = 60_000

/**
 * The models that take an exact `2048x1024` rather than a ratio, capped at
 * 3840 per edge: gpt-image-2 (measured) and the dall-e family, which rejects
 * ratios outright ("size must be one of 1024x1024, 1024x1792 or 1792x1024").
 */
const EXACT_PIXEL_MODEL = /gpt-image-2-official|^dall-e/
const MAX_EXACT_EDGE = 3840

/**
 * Ratios APIMart's gpt-image-2 family accepts. A different set than the chat
 * gateways expose (OpenRouter rejects `2:1`), which is why this table is local
 * to the adapter rather than shared with `supportedAspectRatioForSize`.
 */
const APIMART_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '2:1',
  '1:2',
  '21:9',
  '9:21',
  '3:1',
  '1:3',
]

export function closestRatio(target: number, ratios: readonly string[] = APIMART_RATIOS): string {
  let best = ratios[0]
  let bestError = Number.POSITIVE_INFINITY
  for (const ratio of ratios) {
    const parts = ratio.split(':')
    // Log space so 2:1 and 1:2 are equally wrong, and an error compares to 1.
    const error = Math.abs(Math.log(Number(parts[0]) / Number(parts[1]) / target))
    if (error < bestError) {
      bestError = error
      best = ratio
    }
  }
  return best
}

/** APIMart rejects an exact size whose edges are not multiples of 16. */
const EXACT_PIXEL_STEP = 16

/** One shape of the `size` parameter (plus the tier that goes with a ratio). */
export type ApimartSizeParam = { size?: string; resolution?: string }

function exactSize(width: number, height: number): string {
  // An extension canvas is 38% wider than the original (1024 → 1413), and the
  // vendor refuses any edge that is not a multiple of 16.
  const snapped = (edge: number) => Math.max(EXACT_PIXEL_STEP, Math.round(edge / EXACT_PIXEL_STEP) * EXACT_PIXEL_STEP)
  return `${snapped(width)}x${snapped(height)}`
}

/** The vendor's resolution ladder, cheapest first. */
const TIERS = ['1k', '2k', '4k']

function resolutionFor(maxEdge: number): string {
  return maxEdge <= 1536 ? '1k' : maxEdge <= 2048 ? '2k' : '4k'
}

/**
 * What to ask for first: exact pixels where the model family takes them (the
 * studios' grids land unmodified that way), otherwise a ratio plus a tier,
 * which the client re-normalises to the studio's cell grid as it always does.
 */
export function apimartSize(width: number, height: number, model: string): ApimartSizeParam & { size: string } {
  const maxEdge = Math.max(width, height)
  if (EXACT_PIXEL_MODEL.test(model) && maxEdge <= MAX_EXACT_EDGE) return { size: exactSize(width, height) }
  return { size: closestRatio(width / height), resolution: resolutionFor(maxEdge) }
}

function paramKey(param: ApimartSizeParam): string {
  return `${param.size ?? ''}|${param.resolution ?? ''}`
}

/**
 * Every shape worth trying, best first. The vendor's models do not agree on
 * `size` or on the resolution tier, and the rejections say which: most take a
 * ratio, some only their own exact pixels, xAI's grok-imagine rejects the
 * parameter entirely ("size is not supported for asynchronous xAI image
 * tasks"), and seedream-4-5 refuses 1K ("does not support 1K resolution,
 * please use 2K or 4K"). A rejection that names either steps to the next shape
 * instead of failing the generation.
 */
export function apimartSizeCandidates(width: number, height: number, model: string): ApimartSizeParam[] {
  const maxEdge = Math.max(width, height)
  const ratio = { size: closestRatio(width / height) }
  const preferredTier = resolutionFor(maxEdge)
  const shapes: ApimartSizeParam[] = [
    apimartSize(width, height, model),
    ...(maxEdge <= MAX_EXACT_EDGE ? [{ size: exactSize(width, height) }] : []),
    { ...ratio, resolution: preferredTier },
    // Only upward: a model that refuses the tier asks for a *bigger* one.
    ...TIERS.slice(TIERS.indexOf(preferredTier) + 1).map((tier) => ({ ...ratio, resolution: tier })),
    {},
  ]

  const candidates: ApimartSizeParam[] = []
  const seen = new Set<string>()
  for (const shape of shapes) {
    const key = paramKey(shape)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(shape)
  }
  return candidates
}

function dataField(payload: unknown): unknown {
  return payload && typeof payload === 'object' && 'data' in payload ? payload.data : undefined
}

/** `data[0].task_id` from a submit response. */
function taskIdOf(payload: unknown): string | null {
  const data = dataField(payload)
  if (!Array.isArray(data)) return null
  const first: unknown = data[0]
  if (!first || typeof first !== 'object' || !('task_id' in first) || typeof first.task_id !== 'string') return null
  return first.task_id
}

function statusOf(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('status' in data) || typeof data.status !== 'string') return null
  return data.status
}

/** The vendor reports the render as a one-element list. */
function firstImageUrl(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('result' in data)) return null
  const result = data.result
  if (!result || typeof result !== 'object' || !('images' in result) || !Array.isArray(result.images)) return null
  const first: unknown = result.images[0]
  if (!first || typeof first !== 'object' || !('url' in first)) return null
  const url = first.url
  if (typeof url === 'string') return url
  if (Array.isArray(url) && typeof url[0] === 'string') return url[0]
  return null
}

function costOf(data: unknown): number | null {
  if (!data || typeof data !== 'object' || !('cost' in data) || typeof data.cost !== 'number') return null
  return data.cost
}

function errorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  if ('error' in payload) {
    const error = payload.error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  }
  if ('message' in payload && typeof payload.message === 'string') return payload.message
  return null
}

/** APIMart reports progress as pending/processing/submitted/running. */
function isSettled(status: string): boolean {
  return status !== 'pending' && status !== 'processing' && status !== 'submitted' && status !== 'running'
}

async function inlineResult(url: string): Promise<{ dataUrl: string } | { error: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) return { error: `Could not download the APIMart result (HTTP ${response.status}).` }
    const type = response.headers.get('content-type') || 'image/png'
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64')
    return { dataUrl: `data:${type};base64,${base64}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not download the APIMart result.' }
  }
}

export type ApimartImage = {
  dataUrl: string
  cost: number | null
  /** The size string actually requested (exact pixels or a ratio). */
  size: string
  model: string
  taskId: string
}

/**
 * One image, from an APIMart image model. `references` are data URLs the model
 * restyles (tile guides, sprite pose maps / anchors, prop montages, an expanded
 * canvas to extend) — APIMart takes up to 16.
 */
export async function generateViaApimart(opts: {
  provider: unknown
  apiKey: unknown
  model: string
  prompt: string
  width: number
  height: number
  references?: string[]
}): Promise<ApimartImage | { error: string }> {
  const provider = serverProvider(opts.provider)
  if (provider.id !== 'apimart') return { error: `The APIMart adapter cannot serve ${provider.label}.` }

  const key = providerKey(provider, opts.apiKey)
  if (!key) return { error: `${provider.label} API key missing. Add one in Settings.` }

  const references = (opts.references ?? []).filter((reference) => reference.startsWith('data:image/')).slice(0, 16)

  // Models disagree about the size parameter: gpt-image-2 takes exact pixels,
  // most take a ratio and a tier, dall-e-3 takes only its own exact pixels, and
  // xAI's grok-imagine rejects `size` entirely ("parameter size is not
  // supported for asynchronous xAI image tasks"). Try the richest shape first
  // and step down on a rejection that names the size, so no model needs a
  // hand-written entry here.
  const attempts = apimartSizeCandidates(opts.width, opts.height, opts.model)
  let submitted: unknown = null
  let usedSize = attempts[0].size ?? 'model default'
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const candidate = attempts[attempt]
    let response: Response
    try {
      response = await fetch(`${provider.baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: opts.model,
          prompt: opts.prompt,
          ...candidate,
          n: 1,
          ...(references.length > 0 ? { image_urls: references } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'APIMart submit failed.' }
    }

    submitted = await response.json().catch(() => null)
    if (response.ok) {
      usedSize = candidate.size ?? 'model default'
      break
    }

    const message = errorMessage(submitted)
    const isLast = attempt === attempts.length - 1
    if (isLast || !message || !/size|resolution/i.test(message)) {
      return { error: message ?? `APIMart rejected the request (HTTP ${response.status}).` }
    }
  }

  const taskId = taskIdOf(submitted)
  if (!taskId) return { error: errorMessage(submitted) ?? 'APIMart did not return a task id.' }

  const startedAt = Date.now()
  for (;;) {
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, POLL_EVERY_MS)
    await promise

    let polled: unknown = null
    try {
      const response = await fetch(`${provider.baseUrl}/tasks/${encodeURIComponent(taskId)}?language=en`, {
        headers: { Authorization: `Bearer ${key}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      polled = await response.json().catch(() => null)
      if (!response.ok) {
        return { error: errorMessage(polled) ?? `APIMart task lookup failed (HTTP ${response.status}).` }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'APIMart poll failed.' }
    }

    const data = dataField(polled)
    const status = statusOf(data)
    if (status === 'failed' || status === 'error') {
      return { error: errorMessage(data) ?? `APIMart task ${taskId} failed.` }
    }
    if (status && isSettled(status)) {
      const url = firstImageUrl(data)
      if (!url) return { error: `APIMart task ${taskId} completed without an image.` }
      const inlined = await inlineResult(url)
      if ('error' in inlined) return inlined
      return { dataUrl: inlined.dataUrl, cost: costOf(data), size: usedSize, model: opts.model, taskId }
    }
    if (Date.now() - startedAt > POLL_LIMIT_MS) {
      return { error: `APIMart task ${taskId} is still running after ${Math.round(POLL_LIMIT_MS / 1000)}s.` }
    }
  }
}
