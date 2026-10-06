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
import type { ProviderId } from '@/app/lib/providers'

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

/**
 * An image for this request. `content` overrides the chat message body (the
 * image routes attach references as content parts); `extra` carries the
 * chat-only knobs (`modalities`, `image_config`). APIMart ignores both — it
 * takes the prompt and the references.
 */
export async function generateImage(opts: {
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
}): Promise<ImageOutcome> {
  const credentials = llmCredentials({ provider: opts.provider, apiKey: opts.apiKey, profile: opts.profile })
  if ('error' in credentials) return { error: credentials.error, status: 401, reason: 'credentials' }
  const { provider, key } = credentials

  if (provider.id === 'apimart') {
    if (opts.width == null || opts.height == null) {
      return { error: APIMART_NEEDS_FULL_CONTEXT, status: 400, reason: 'size' }
    }
    const result = await generateViaApimart({
      provider,
      key,
      model: opts.model,
      prompt: opts.prompt,
      width: opts.width,
      height: opts.height,
      references: opts.references ?? [],
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

  const target = targetFor(credentials, { title: opts.title, referer: opts.referer })
  const reply = await chatCompletion({
    target,
    model: opts.model,
    messages: [{ role: 'user', content: opts.content ?? [{ type: 'text', text: opts.prompt }] }],
    maxTokens: 2000,
    temperature: opts.temperature,
    extra: opts.extra,
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
    model: opts.model,
    text: messageText(reply.message.content, ' '),
  }
}
