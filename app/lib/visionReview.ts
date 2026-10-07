// app/lib/visionReview.ts
/**
 * One art-director review call, shared by both QA routes (tile, sprite).
 *
 * The two routes had the same eleven steps spelled out twice — resolve the
 * target and the QA model, attach the images in order, call the chat endpoint,
 * read the verdict tolerantly, treat an unparseable answer as an approval. The
 * rubric and the prompt text stay in `qaRubric` (that is policy); what a route
 * is left with is which images to send and how to translate the outcome onto
 * HTTP.
 *
 * Critics fail open, deliberately: a flaky vision model must never block a
 * generation, so a reply we cannot parse is reported as "approved" rather than
 * as an error (docs/agent-api.md).
 */
import { llmTarget, modelOrDefault } from '@/app/lib/llmServer'
import { chatCompletion } from '@/app/lib/llmChat'
import { messageText, parseReviewJson, type Review } from '@/app/lib/llmResponse'
import type { ReviewPrompt } from '@/app/lib/qaRubric'

export type VisionReviewResult = Review | { error: string; status: number }

export async function runVisionReview(opts: {
  provider: unknown
  apiKey: unknown
  profile?: unknown
  model: unknown
  title: string
  referer?: string | null
  /** Data URLs, attached in array order. */
  images: string[]
  prompt: ReviewPrompt
}): Promise<VisionReviewResult> {
  const target = llmTarget({
    provider: opts.provider,
    profile: opts.profile,
    apiKey: opts.apiKey,
    referer: opts.referer,
    title: opts.title,
  })
  if ('error' in target) return { error: target.error, status: 401 }

  const model = modelOrDefault({ model: opts.model, provider: opts.provider, profile: opts.profile, kind: 'qa' })

  const content: Array<Record<string, unknown>> = opts.images.map((url) => ({
    type: 'image_url',
    image_url: { url },
  }))
  content.push({ type: 'text', text: opts.prompt.user })

  const reply = await chatCompletion({
    target,
    model,
    messages: [
      { role: 'system', content: opts.prompt.system },
      { role: 'user', content },
    ],
    maxTokens: 600,
    // Low temperature: this is a judgment call, we want consistency.
    temperature: 0.2,
  })
  if (!reply.ok) return { error: reply.error, status: reply.status }

  // Don't block the user on a parse failure — treat as approved.
  return parseReviewJson(messageText(reply.message.content)) ?? { ok: true, issues: [], fix: '' }
}
