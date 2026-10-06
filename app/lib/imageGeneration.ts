// app/lib/imageGeneration.ts
/**
 * One image, from whichever adapter the resolved provider needs.
 *
 * Two real adapters exist: a chat/completions gateway that returns the render
 * inside the message, and APIMart's async submit-and-poll task API. A route
 * asks for an image and gets one or an error — the adapter choice leaves the
 * routes, and the capability guard that only one adapter needs travels with it.
 *
 * Credentials are resolved here, once, so the endpoint and the adapter can
 * never come from two different readings of the same request.
 */
import { extractCost } from '@/app/lib/generateCost'
import { generateViaApimart } from '@/app/lib/apimartServer'
import { chatCompletion } from '@/app/lib/llmChat'
import { extractImageUrl, messageText } from '@/app/lib/llmResponse'
import { llmCredentials, targetFor } from '@/app/lib/llmServer'
import type { Provider, ProviderId } from '@/app/lib/providers'

export type GeneratedImage = {
  imageUrl: string
  /** What the gateway charged, when it says. `source` names where it came from. */
  cost: { usd: number; source: string } | null
  provider: ProviderId
  model: string
  /** The reply's text, for the routes that also parse names out of it. */
  text: string
  /** The size string APIMart asked for, when it named one. */
  size?: string
}

export type ImageFailure = {
  error: string
  status: number
  /** Why it failed, for the callers whose response shape differs per cause. */
  reason: 'credentials' | 'size' | 'gateway' | 'no-image'
  /** The assistant message, when one arrived — the shape to diagnose in a log. */
  message?: Record<string, unknown>
}

export type ImageOutcome = GeneratedImage | ImageFailure

/** Only APIMart needs it, and only it can say why. */
const APIMART_NEEDS_FULL_CONTEXT =
  'APIMart needs the full-context extend path — switch to a chat gateway for chunked extends.'

/** What a route asks for: every knob any adapter might need. */
export type GenerateImageOpts = {
  provider: unknown
  apiKey: unknown
  profile?: unknown
  title: string
  referer?: string | null
  model: string
  prompt: string
  /** The canvas to ask for. APIMart needs both; a chunked extend names none. */
  width?: number
  height?: number
  temperature: number
  references?: string[]
  content?: unknown
  extra?: Record<string, unknown>
}

/** The same request once the gateway and its credential are resolved. */
export type ImageRequest = Omit<GenerateImageOpts, 'provider' | 'apiKey' | 'profile'> & {
  provider: Provider
  key: string
}

/** One way to get an image out of a gateway. */
export type ImageAdapter = (request: ImageRequest) => Promise<ImageOutcome>

/**
 * A chat/completions gateway: the render arrives inside the message.
 *
 * `content` overrides the chat message body (the image routes attach references
 * as content parts); `extra` carries the chat-only knobs (`modalities`,
 * `image_config`). APIMart ignores both — it takes the prompt and the references.
 */
async function viaChat(request: ImageRequest): Promise<ImageOutcome> {
  const { provider, key } = request
  const target = targetFor({ provider, key }, { title: request.title, referer: request.referer })
  const reply = await chatCompletion({
    target,
    model: request.model,
    messages: [{ role: 'user', content: request.content ?? [{ type: 'text', text: request.prompt }] }],
    maxTokens: 2000,
    temperature: request.temperature,
    extra: request.extra,
  })
  if (!reply.ok) return { error: reply.error, status: reply.status, reason: 'gateway' }

  const imageUrl = extractImageUrl(reply.message)
  if (!imageUrl) {
    return {
      error: 'No image generated. The model may not support pure image generation.',
      status: 500,
      reason: 'no-image',
      message: reply.message,
    }
  }
  return {
    imageUrl,
    cost: extractCost(reply.data),
    provider: provider.id,
    model: request.model,
    text: messageText(reply.message.content, ' '),
  }
}

/**
 * APIMart: submit the task, poll it, and inline the expiring render URL. The
 * adapter itself owns the size shape; the caller only names the canvas.
 */
async function viaApimart(request: ImageRequest): Promise<ImageOutcome> {
  const { provider, key } = request
  if (request.width == null || request.height == null) {
    return { error: APIMART_NEEDS_FULL_CONTEXT, status: 400, reason: 'size' }
  }
  const result = await generateViaApimart({
    provider,
    key,
    model: request.model,
    prompt: request.prompt,
    width: request.width,
    height: request.height,
    references: request.references ?? [],
  })
  if ('error' in result) {
    console.error('APIMart error:', result.error)
    return { error: result.error, status: 502, reason: 'gateway' }
  }
  return {
    imageUrl: result.dataUrl,
    // APIMart reports a plain USD number; the chat path reports a shape.
    cost: result.cost == null ? null : { usd: result.cost, source: 'apimart' },
    provider: provider.id,
    model: result.model,
    // APIMart answers with the render, not prose.
    text: '',
    size: result.size,
  }
}

/**
 * Which adapter serves which gateway — the one place the pairing is written
 * down. A new provider does not compile until it is given an adapter here.
 */
export const IMAGE_ADAPTERS: Record<ProviderId, ImageAdapter> = {
  openrouter: viaChat,
  magpie: viaChat,
  apimart: viaApimart,
}

/** An image for this request, with the adapter the resolved gateway needs. */
export async function generateImage(opts: GenerateImageOpts): Promise<ImageOutcome> {
  const credentials = llmCredentials({ provider: opts.provider, apiKey: opts.apiKey, profile: opts.profile })
  if ('error' in credentials) return { error: credentials.error, status: 401, reason: 'credentials' }
  return IMAGE_ADAPTERS[credentials.provider.id]({
    ...opts,
    provider: credentials.provider,
    key: credentials.key,
  })
}
