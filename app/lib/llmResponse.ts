// app/lib/llmResponse.ts
/**
 * Reading a chat completion: the render out of it, and the text the art-director
 * passes are supposed to answer with.
 *
 * Gateways disagree about where an image lives, so we check every shape we have
 * actually seen rather than trusting one:
 *
 *   - OpenRouter / most image-output chat models → `message.images[0].image_url.url`
 *   - Gemini-native translated through a gateway → `content[]` part with
 *     `inline_data` / `image_url` / bare `data`
 *   - magpie → teamo-router → a markdown link inside a *string* `content`:
 *     `![image](data:image/png;base64,…)`
 *
 * A shared implementation matters: the extension route had the markdown branch
 * and the generate route did not, so the same model worked in one studio and
 * "responded without an image" in the other.
 */

export interface Review {
  ok: boolean
  issues: string[]
  fix: string
}

/** `content` as plain text: a string, or content parts with `text`, joined. */
export function messageText(content: unknown, separator = ''): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text
      return ''
    })
    .join(separator)
}

/** A bracketed block to look for inside a model's prose. */
export type JsonBlock = 'object' | 'array'

/**
 * Best-effort JSON from a model's text: strips ```json fences, then tries the
 * whole text, then the first block of each requested kind — in the order given,
 * so a reply carrying both is read as the kind the caller expects.
 *
 * Two callers used to carry their own copy of this salvage (the review parser
 * and the prop art-director's), with different tolerances and no shared test.
 */
export function salvageJson(raw: string, search: readonly JsonBlock[]): unknown {
  if (!raw) return null
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
  const whole = tryParse(text)
  if (whole) return whole
  for (const kind of search) {
    const open = kind === 'object' ? '{' : '['
    const close = kind === 'object' ? '}' : ']'
    const from = text.indexOf(open)
    const to = text.lastIndexOf(close)
    if (from === -1 || to <= from) continue
    const block = tryParse(text.slice(from, to + 1))
    if (block) return block
  }
  return null
}

/**
 * The art-director verdict, read tolerantly: `ok`/`approved`/`pass` all count as
 * an approval, `issues` is the list, `fix`/`report` is the report to hand back.
 */
export function parseReviewJson(raw: string): Review | null {
  const data = salvageJson(raw, ['object'])
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const ok = o.ok === true || o.approved === true || o.pass === true
  const issues = Array.isArray(o.issues)
    ? o.issues.map((x) => String(x).trim()).filter(Boolean)
    : []
  const fix =
    typeof o.fix === 'string'
      ? o.fix.trim()
      : typeof o.report === 'string'
        ? o.report.trim()
        : issues.join('; ')
  return { ok, issues, fix }
}

/** Only accept a markdown link that actually points at an image. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(<?(data:image\/[^)\s]+|https?:\/\/[^)\s]+)>?\)/

const BASE64_BLOB = /^[A-Za-z0-9+/=]+$/

function asDataUrl(base64: string, mimeType?: string): string {
  return `data:${mimeType || 'image/png'};base64,${base64}`
}

/**
 * `node` is a chat message (or any nesting of one). Returns a data URL or a
 * remote URL suitable for the client to draw into a canvas.
 */
export function extractImageUrl(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const n = node as Record<string, any>

  // images: [{ image_url: { url } }] — the OpenRouter shape.
  if (Array.isArray(n.images) && n.images.length > 0) {
    for (const img of n.images) {
      if (img?.image_url?.url) return img.image_url.url
      if (img?.url) return img.url
      if (img?.b64_json) return asDataUrl(img.b64_json)
    }
  }

  // Some OpenAI-style responses expose raw base64 as `b64_json`.
  if (typeof n.b64_json === 'string' && n.b64_json.length > 100) {
    return asDataUrl(n.b64_json)
  }

  const content = n.content

  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'image_url' && part?.image_url?.url) return part.image_url.url
      if (part?.type === 'image' && part?.url) return part.url
      if (part?.image_url?.data) return asDataUrl(part.image_url.data)
      if (part?.b64_json) return asDataUrl(part.b64_json)
      if (part?.data && typeof part.data === 'string' && part.data.length > 100) {
        return asDataUrl(part.data)
      }
      if (part?.inline_data?.data) {
        return asDataUrl(part.inline_data.data, part.inline_data.mime_type)
      }
      // A gateway can also put the markdown link inside a content *part*.
      if (typeof part?.text === 'string') {
        const link = part.text.match(MARKDOWN_IMAGE)
        if (link) return link[1]
      }
    }
    return null
  }

  if (typeof content === 'string') {
    if (content.startsWith('data:image') || content.startsWith('http')) return content
    if (content.length > 100 && BASE64_BLOB.test(content.substring(0, 100))) {
      return asDataUrl(content)
    }
    const link = content.match(MARKDOWN_IMAGE)
    if (link) return link[1]
    return null
  }

  if (content && typeof content === 'object') {
    if (content.data) return asDataUrl(content.data)
    if (content.inline_data?.data) {
      return asDataUrl(content.inline_data.data, content.inline_data.mime_type)
    }
  }

  return null
}
