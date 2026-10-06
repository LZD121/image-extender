// app/lib/llmChat.ts
/**
 * One gateway round trip: POST the resolved target, map an error body to a
 * status + message, and hand back the assistant message. Every route that talks
 * to a chat/completions endpoint goes through here, so the SSE guard
 * (`stream: false`), the error idioms and the missing-message case exist once.
 */
import type { LlmTarget } from '@/app/lib/llmServer'

export type ChatReply =
  | { ok: true; message: Record<string, unknown>; data: Record<string, unknown> }
  | { ok: false; status: number; error: string }

export async function chatCompletion(opts: {
  target: LlmTarget
  model: string
  messages: Array<{ role: string; content: unknown }>
  maxTokens: number
  temperature: number
  extra?: Record<string, unknown>
}): Promise<ChatReply> {
  let response: Response
  try {
    response = await fetch(opts.target.url, {
      method: 'POST',
      headers: opts.target.headers,
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        max_tokens: opts.maxTokens,
        // Some gateways (APIMart) default to SSE, which is not JSON to parse.
        stream: false,
        temperature: opts.temperature,
        ...opts.extra,
      }),
    })
  } catch (error) {
    return { ok: false, status: 502, error: error instanceof Error ? error.message : 'gateway request failed' }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let message = ''
    try {
      const parsed: unknown = JSON.parse(body)
      const candidate = (parsed as { error?: { message?: unknown } } | null)?.error?.message
      if (typeof candidate === 'string') message = candidate
    } catch {
      message = body.slice(0, 500)
    }
    console.error(`${opts.target.provider.label} API error:`, response.status, message)
    return { ok: false, status: response.status, error: message.trim() || `HTTP ${response.status}` }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { ok: false, status: 500, error: 'Gateway returned invalid JSON' }
  }
  const message = (data as { choices?: Array<{ message?: unknown }> } | null)?.choices?.[0]?.message
  if (!message || typeof message !== 'object') {
    return { ok: false, status: 500, error: 'No message in response' }
  }
  // `data` rides along for the callers that read a sibling field of it — the
  // generate route reports the provider's cost from `usage`.
  return { ok: true, message: message as Record<string, unknown>, data: data as Record<string, unknown> }
}
