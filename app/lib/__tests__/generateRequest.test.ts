import { describe, expect, it } from 'vitest'
import { generateKind, toWire, type GenerateBody, type GenerateRequest } from '@/app/lib/generateRequest'

const SAMPLES: GenerateRequest[] = [
  { kind: 'plain', prompt: 'a mossy stone', width: 512, height: 512 },
  { kind: 'parallax', prompt: 'a sky', width: 2048, height: 512, layerRole: 'mid' },
  { kind: 'tileSheet', prompt: 'moss', width: 4096, height: 4096, tileGuideImage: 'data:x' },
  { kind: 'tileMode', prompt: 'moss', width: 1024, height: 1024, tileRole: 'body' },
  { kind: 'spriteAnchor', prompt: 'a knight', width: 1024, height: 1024, spriteBodyPlan: 'biped' },
  { kind: 'spriteSheet', prompt: 'a knight', width: 2048, height: 1024, spriteAnim: 'walk', spriteFrameCount: 6 },
  { kind: 'propSheet', prompt: 'rocks', width: 2048, height: 1024, propList: ['rock'] },
  { kind: 'propMode', prompt: 'a lantern', width: 512, height: 512, propRole: 'lantern' },
]

describe('the /api/generate wire contract', () => {
  for (const sample of SAMPLES) {
    it(`round-trips a ${sample.kind} request`, () => {
      expect(generateKind(toWire(sample))).toBe(sample.kind)
    })
  }

  it('flags a sheet body and keeps the kind off the wire', () => {
    const wire = toWire(SAMPLES[5])
    expect(wire).not.toHaveProperty('kind')
    expect(wire).toMatchObject({ spriteSheet: true, spriteAnim: 'walk', spriteFrameCount: 6 })
  })

  it('sends no flag at all for a plain body', () => {
    const wire = toWire(SAMPLES[0])
    expect(wire).not.toHaveProperty('kind')
    expect(Object.keys(wire).some((key) => wire[key] === true)).toBe(false)
  })

  it('ranks two flags the way the prompt ladder did', () => {
    expect(generateKind({ tileSheet: true, spriteSheet: true })).toBe('tileSheet')
  })

  it('only counts a flag that is exactly true', () => {
    expect(generateKind({ spriteSheet: false })).toBe('plain')
  })

  it('reads a known layer role as parallax, and an unknown one as plain', () => {
    expect(generateKind({ layerRole: 'mid' })).toBe('parallax')
    // A raw HTTP caller can put any string here; only a known role is parallax.
    expect(generateKind({ layerRole: 'sideways' } as unknown as GenerateBody)).toBe('plain')
  })
})
