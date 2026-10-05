import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/generate/route'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const MODEL = 'google/gemini-3.1-flash-image-preview'

/** Flatten OpenRouter's `messages[].content` (string | parts[]) into plain text. */
function promptText(responseBody: string): string {
  const sent: unknown = JSON.parse(responseBody)
  if (!sent || typeof sent !== 'object' || !('messages' in sent)) return ''
  const messages = sent.messages
  if (!Array.isArray(messages)) return ''
  const parts: string[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object' || !('content' in message)) continue
    const content = message.content
    for (const part of Array.isArray(content) ? content : [content]) {
      if (typeof part === 'string') parts.push(part)
      else if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        parts.push(part.text)
      }
    }
  }
  return parts.join('\n')
}

/** Call the route with fetch stubbed, and return the prompt it actually sent. */
async function capturePrompt(body: Record<string, unknown>): Promise<string> {
  const fetchMock = vi.fn(async (_url: unknown, init: { body: string }) => {
    void _url
    void init
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, images: [{ image_url: { url: PNG } }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  })
  const original = globalThis.fetch
  globalThis.fetch = fetchMock as unknown as typeof fetch
  try {
    const res = await POST(
      new NextRequest(new URL('/api/generate', 'http://localhost:3000'), {
        method: 'POST',
        body: JSON.stringify({ apiKey: 'dummy', model: MODEL, width: 512, height: 512, ...body }),
      })
    )
    expect(res.status).toBe(200)
    return promptText(fetchMock.mock.calls[0][1].body)
  } finally {
    globalThis.fetch = original
  }
}

const MODES: { name: string; body: Record<string, unknown> }[] = [
  { name: 'plain generate', body: { prompt: 'a mossy stone' } },
  { name: 'sprite sheet', body: { prompt: 'a knight', spriteSheet: true, spriteAnim: 'walk', spriteBodyPlan: 'biped', width: 2048, height: 1024 } },
  { name: 'tile sheet', body: { prompt: 'mossy stone', tileSheet: true, width: 4096, height: 4096 } },
  { name: 'prop sheet', body: { prompt: 'rocks', propSheet: true, width: 2048, height: 1024 } },
  { name: 'sprite anchor', body: { prompt: 'a knight', spriteAnchor: true, spriteBodyPlan: 'biped', width: 1024, height: 1024 } },
]

describe('artStyle reaches the model in every mode', () => {
  for (const { name, body } of MODES) {
    it(`${name} carries the style directive`, async () => {
      const prompt = await capturePrompt({ ...body, artStyle: 'pixel-art' })
      expect(prompt).toContain('RENDER STYLE')
      expect(prompt.toLowerCase()).toContain('no anti-aliasing')
    })

    it(`${name} stays style-free when no style is selected`, async () => {
      const prompt = await capturePrompt(body)
      expect(prompt).not.toContain('RENDER STYLE')
    })
  }
})
