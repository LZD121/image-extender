import { describe, expect, it } from 'vitest'
import { extractImageUrl } from '@/app/lib/llmResponse'

/** Only needs to clear the >100-char heuristic that guards the raw-base64 fallback. */
const B64 = 'A'.repeat(120)
const PNG = `data:image/png;base64,${B64}`

describe('extractImageUrl', () => {
  it('reads the OpenRouter images[] shape', () => {
    expect(extractImageUrl({ images: [{ image_url: { url: PNG } }] })).toBe(PNG)
  })

  it('reads a bare b64_json payload', () => {
    expect(extractImageUrl({ b64_json: B64 })).toBe(PNG)
  })

  it('reads inline_data parts, keeping their mime type', () => {
    expect(
      extractImageUrl({ content: [{ type: 'text', text: 'here' }, { inline_data: { data: B64, mime_type: 'image/webp' } }] }),
    ).toBe(`data:image/webp;base64,${B64}`)
  })

  it('reads a data URL that is the whole content string', () => {
    expect(extractImageUrl({ content: PNG })).toBe(PNG)
  })

  it('reads raw base64 content', () => {
    expect(extractImageUrl({ content: B64 })).toBe(PNG)
  })

  it('reads the markdown link a gateway puts in string content (magpie → teamo-router)', () => {
    expect(extractImageUrl({ content: `![image](${PNG})` })).toBe(PNG)
  })

  it('reads a markdown link embedded in prose', () => {
    expect(extractImageUrl({ content: `Here is the render:\n\n![generated image](https://cdn.example/a.png)\n\nEnjoy.` })).toBe(
      'https://cdn.example/a.png',
    )
  })

  it('reads a markdown link inside a content part', () => {
    expect(extractImageUrl({ content: [{ type: 'text', text: `![i](${PNG})` }] })).toBe(PNG)
  })

  it('does not mistake a plain prose link for the render', () => {
    expect(extractImageUrl({ content: 'See [the docs](https://example.com/docs) before continuing.' })).toBeNull()
  })

  it('returns null when there is nothing to extract', () => {
    expect(extractImageUrl({ content: 'I cannot draw that.' })).toBeNull()
    expect(extractImageUrl({ content: null })).toBeNull()
    expect(extractImageUrl(null)).toBeNull()
    expect(extractImageUrl(undefined)).toBeNull()
    expect(extractImageUrl('not an object')).toBeNull()
  })

  it('prefers images[] over the content string', () => {
    expect(extractImageUrl({ images: [{ image_url: { url: PNG } }], content: 'https://ignored.example/x.png' })).toBe(PNG)
  })
})
