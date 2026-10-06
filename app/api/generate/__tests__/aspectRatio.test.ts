import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/generate/route'
import { SUPPORTED_IMAGE_ASPECT_RATIOS } from '@/app/lib/aspectRatio'

/**
 * TRAN-04 regression: the aspect table gained `4:1` / `8:1`, and this file pins
 * what that cost.
 *
 * Why it reads the wire instead of the table: `width`/`height` never leave this
 * machine — the only size signal a chat gateway sees is
 * `image_config.aspect_ratio`. A test that re-implemented
 * `supportedAspectRatioForSize` locally would be testing a copy; this one
 * stubs `globalThis.fetch` and reads the ratio the ROUTE actually emitted.
 *
 * Measured blast radius (enumerated on this machine, both tables): exactly 4 of
 * the 56 ladder combinations move, all `21:9 -> 4:1`. The research's earlier
 * "10 of 56" figure was computed against a table that also added
 * `3:1`/`1:3`/`1:4`/`1:8`; those are NOT in this change, and any entry like
 * `1920x720` or `512x1536` appearing here as a change would be that mix-up.
 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const MODEL = 'google/gemini-3.1-flash-image-preview'

/** The ratio the route actually puts on the wire for a given canvas. */
async function emittedRatio(width: number, height: number): Promise<string> {
  const fetchMock = vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, images: [{ image_url: { url: PNG } }] } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  )
  const original = globalThis.fetch
  globalThis.fetch = fetchMock as unknown as typeof fetch
  try {
    const res = await POST(
      new NextRequest(new URL('/api/generate', 'http://localhost:3000'), {
        method: 'POST',
        body: JSON.stringify({ apiKey: 'dummy', model: MODEL, width, height, prompt: 'x' }),
      })
    )
    expect(res.status).toBe(200)
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body) as {
      image_config?: { aspect_ratio?: string }
    }
    const ratio = sent.image_config?.aspect_ratio
    if (typeof ratio !== 'string') throw new Error(`no image_config.aspect_ratio for ${width}x${height}`)
    return ratio
  } finally {
    globalThis.fetch = original
  }
}

/** The studio ladder (`app/components/Modals.tsx:836,853`) — 7 × 8 = 56 canvases. */
const LADDER_W = [512, 768, 960, 1024, 1280, 1536, 1920]
const LADDER_H = [360, 540, 720, 768, 1024, 1080, 1280, 1536]

/** Every ladder canvas's ratio BEFORE this change, enumerated offline from the 10-item table. */
const BEFORE: Record<string, string> = {
  '512x360': '3:2',
  '512x540': '1:1',
  '512x720': '3:4',
  '512x768': '2:3',
  '512x1024': '9:16',
  '512x1080': '9:16',
  '512x1280': '9:16',
  '512x1536': '9:16',
  '768x360': '21:9',
  '768x540': '3:2',
  '768x720': '1:1',
  '768x768': '1:1',
  '768x1024': '3:4',
  '768x1080': '3:4',
  '768x1280': '9:16',
  '768x1536': '9:16',
  '960x360': '21:9',
  '960x540': '16:9',
  '960x720': '4:3',
  '960x768': '5:4',
  '960x1024': '1:1',
  '960x1080': '4:5',
  '960x1280': '3:4',
  '960x1536': '2:3',
  '1024x360': '21:9',
  '1024x540': '16:9',
  '1024x720': '3:2',
  '1024x768': '4:3',
  '1024x1024': '1:1',
  '1024x1080': '1:1',
  '1024x1280': '4:5',
  '1024x1536': '2:3',
  '1280x360': '21:9',
  '1280x540': '21:9',
  '1280x720': '16:9',
  '1280x768': '16:9',
  '1280x1024': '5:4',
  '1280x1080': '5:4',
  '1280x1280': '1:1',
  '1280x1536': '4:5',
  '1536x360': '21:9',
  '1536x540': '21:9',
  '1536x720': '21:9',
  '1536x768': '16:9',
  '1536x1024': '3:2',
  '1536x1080': '3:2',
  '1536x1280': '5:4',
  '1536x1536': '1:1',
  '1920x360': '21:9',
  '1920x540': '21:9',
  '1920x720': '21:9',
  '1920x768': '21:9',
  '1920x1024': '16:9',
  '1920x1080': '16:9',
  '1920x1280': '3:2',
  '1920x1536': '5:4',
}

describe('aspect table blast radius (TRAN-04)', () => {
  it('moves exactly 4 of the 56 ladder canvases, all 21:9 -> 4:1', async () => {
    const changed: { size: string; before: string; after: string }[] = []
    const unchanged: string[] = []
    const after: Record<string, string> = {}

    for (const w of LADDER_W) {
      for (const h of LADDER_H) {
        const key = `${w}x${h}`
        const before = BEFORE[key]
        expect(before, `missing baseline for ${key}`).toBeTruthy()
        const now = await emittedRatio(w, h)
        after[key] = now
        if (now === before) unchanged.push(key)
        else changed.push({ size: key, before, after: now })
      }
    }

    // The four and only four, in a fixed order so a new mover names itself.
    expect(changed).toEqual([
      { size: '1280x360', before: '21:9', after: '4:1' },
      { size: '1536x360', before: '21:9', after: '4:1' },
      { size: '1920x360', before: '21:9', after: '4:1' },
      { size: '1920x540', before: '21:9', after: '4:1' },
    ])
    expect(changed.length).toBe(4)

    // 52 canvases must be individually equal — "mostly equal" is not the claim.
    expect(unchanged.length).toBe(52)

    const counts: Record<string, number> = {}
    for (const value of Object.values(after)) counts[value] = (counts[value] ?? 0) + 1
    expect(counts['4:1']).toBe(4)
    expect(counts['21:9']).toBe(8)

    // Nothing in the ladder can reach the 8:1 slot (widest is 1920×360 = 5.333).
    expect(counts['8:1']).toBeUndefined()
  })

  it('leaves every existing studio canvas on the same step', async () => {
    // tileSheet (page.tsx:1397) — the 8×8 template sheet
    expect(await emittedRatio(4096, 4096)).toBe('1:1')
    // spriteSheet (page.tsx:2095) — the 4×2 sprite sheet
    expect(await emittedRatio(2048, 1024)).toBe('16:9')
    // propSheet (page.tsx:2212) — the props batch, same canvas, independent caller
    expect(await emittedRatio(2048, 1024)).toBe('16:9')
    // spriteAnchor / propMode / tileMode (page.tsx:2351, 2405, 1147) — one 512 cell
    expect(await emittedRatio(512, 512)).toBe('1:1')
  })

  it('carries the canvases this phase exists for', async () => {
    expect(await emittedRatio(4096, 512)).toBe('8:1') // 8 cells × 512
    expect(await emittedRatio(2048, 512)).toBe('4:1') // 4 cells × 512
  })

  it('did not smuggle in any inverse ratio', async () => {
    // If someone also added '1:8', this canvas would flip off 9:16.
    expect(await emittedRatio(256, 2048)).toBe('9:16')
    const inverses = SUPPORTED_IMAGE_ASPECT_RATIOS.filter((r) => {
      const [w, h] = r.split(':').map(Number)
      return w < h && r !== '1:1'
    })
    expect(inverses).toEqual(['2:3', '3:4', '4:5', '9:16'])
  })

  it('has no duplicate or missing table entries', () => {
    expect(new Set(SUPPORTED_IMAGE_ASPECT_RATIOS).size).toBe(12)
  })
})
