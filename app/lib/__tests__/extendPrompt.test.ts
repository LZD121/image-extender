import { describe, expect, it } from 'vitest'
import { EXTENSION_DIRECTIONS, buildExtendPrompt, isDirection } from '@/app/lib/extendPrompt'

const base = { direction: 'right' as const }

function chunk() {
  return {
    direction: 'up' as const,
    chunkWidth: 1024,
    chunkHeight: 512,
    extensionSize: 190,
    originalWidth: 1024,
    originalHeight: 512,
  }
}

describe('isDirection', () => {
  it('accepts exactly the four directions the prompt can describe', () => {
    expect(EXTENSION_DIRECTIONS).toHaveLength(4)
    for (const direction of EXTENSION_DIRECTIONS) expect(isDirection(direction)).toBe(true)
  })

  it('rejects everything else, so the prompt can never interpolate it', () => {
    // A raw caller can send any of these: /api/extend is a documented endpoint.
    for (const value of ['diagonal', 'right ', '', 'UP', 1, null, undefined, {}]) {
      expect(isDirection(value)).toBe(false)
    }
  })
})

describe('buildExtendPrompt', () => {
  it('leads with the style directive instead of burying it as item 7', () => {
    const prompt = buildExtendPrompt({ ...base, artStyle: 'pixel-art' })
    expect(prompt.startsWith('RENDER STYLE')).toBe(true)
    expect(prompt).toContain('No anti-aliasing')
    expect(prompt).not.toContain('7. ARTISTIC STYLE')
  })

  it('adds no style directive for an absent or unknown style', () => {
    expect(buildExtendPrompt(base)).not.toContain('RENDER STYLE')
    expect(buildExtendPrompt({ ...base, artStyle: 'none' })).not.toContain('RENDER STYLE')
    expect(buildExtendPrompt({ ...base, artStyle: 'invented-style' })).not.toContain('RENDER STYLE')
  })

  it('numbers the user instruction 6 whether or not a style was asked for', () => {
    const styled = buildExtendPrompt({ ...base, artStyle: 'pixel-art', customPrompt: 'two pines' })
    const plain = buildExtendPrompt({ ...base, customPrompt: 'two pines' })
    expect(styled).toContain('6. USER\'S SPECIFIC REQUEST FOR THE NEW EXTENDED AREA: "two pines"')
    expect(plain).toContain('6. USER\'S SPECIFIC REQUEST')
    expect(styled).not.toContain('7. USER')
  })

  it('picks one of the three base prompts', () => {
    expect(buildExtendPrompt({ ...base, useFullContext: true })).toContain('OUTPAINTING TASK')
    expect(buildExtendPrompt({ ...base, chunkInfo: chunk() })).toContain('PARTIAL edge strip')
    expect(buildExtendPrompt(base)).toContain('You are an expert at seamlessly extending images')
  })

  it('continues the scene when no custom prompt was given, and follows one when it was', () => {
    expect(buildExtendPrompt(base)).toContain('NATURAL SCENE CONTINUATION')
    expect(buildExtendPrompt(base)).not.toContain("USER'S SPECIFIC REQUEST")
    expect(buildExtendPrompt({ ...base, customPrompt: 'two pines' })).toContain("USER'S SPECIFIC REQUEST")
    expect(buildExtendPrompt({ ...base, customPrompt: 'two pines' })).not.toContain('NATURAL SCENE CONTINUATION')
  })

  it('adds the parallax layer rules for the layers that need them', () => {
    expect(buildExtendPrompt({ ...base, layerRole: 'sky' })).toContain('PARALLAX LAYER — SKY / BACK')
    expect(buildExtendPrompt({ ...base, layerRole: 'near' })).toContain('PARALLAX LAYER — NEAR')
    expect(buildExtendPrompt(base)).not.toContain('PARALLAX LAYER')
  })

  it('states the output canvas from whichever geometry the caller named', () => {
    expect(buildExtendPrompt({ ...base, extensionInfo: { newWidth: 1400, newHeight: 512 } })).toContain(
      'exactly 1400x512 pixels',
    )
    // Chunked: the strip plus its extension, from the chunk's own geometry.
    expect(buildExtendPrompt({ ...base, chunkInfo: chunk() })).toContain('exactly 1024x702 pixels')
  })
})
