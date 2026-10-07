import { describe, expect, it } from 'vitest'
import { CHROMA_PRESETS } from '@/app/lib/chromaPresets'
import { TILESET_BY_ROLE, TILESET_SLOTS } from '@/app/lib/tileset'

describe('CHROMA_PRESETS', () => {
  it('pins the five tunings the studios and the bridge key with', () => {
    expect(CHROMA_PRESETS).toEqual({
      default: { castThreshold: 80, castSoftness: 30, despill: 1, despillGreenBoost: 0.5 },
      tile: { castThreshold: 40, castSoftness: 35, despill: 1, despillGreenBoost: 0.6 },
      prop: { castThreshold: 70, castSoftness: 30, despill: 1, despillGreenBoost: 0.5 },
      despill: { castThreshold: 256, castSoftness: 0, despill: 1, despillGreenBoost: 0.6 },
      binary: { castThreshold: 128, castSoftness: 0, despill: 1, despillGreenBoost: 0.5 },
    })
  })

  // The snapshot above says the numbers; this says what they MEAN. `binary` is the
  // one preset whose key must be a step function: a soft edge would leave a
  // translucent film over every strip cell (measured 2595 partial-alpha pixels for
  // `default`, 0 for `binary`). Turning it back into a ramp has to fail here.
  it('keeps `binary` the only preset with no soft edge', () => {
    expect(CHROMA_PRESETS.binary.castSoftness).toBe(0)
    expect(CHROMA_PRESETS.default.castSoftness).not.toBe(0)
    expect(CHROMA_PRESETS.tile.castSoftness).not.toBe(0)
    expect(CHROMA_PRESETS.prop.castSoftness).not.toBe(0)
  })
})

describe('the tile role → file name table the CLI derives', () => {
  /** `cli/native/bridge.mjs` builds this map from IE.TILESET_SLOTS. */
  const roleFile = Object.fromEntries(TILESET_SLOTS.map((slot) => [slot.role, slot.fileName]))

  it('covers every role the sheet and the atlas address, one name each', () => {
    expect(Object.keys(roleFile).sort()).toEqual(Object.keys(TILESET_BY_ROLE).sort())
    expect(new Set(TILESET_SLOTS.map((slot) => slot.fileName)).size).toBe(TILESET_SLOTS.length)
    expect(roleFile.body).toBe('body')
    expect(roleFile.tl_outer).toBe('corner-tl-outer')
  })
})
