import { describe, expect, it } from 'vitest'
import { CHROMA_PRESETS } from '@/app/lib/chromaPresets'
import { TILESET_BY_ROLE, TILESET_SLOTS } from '@/app/lib/tileset'

describe('CHROMA_PRESETS', () => {
  it('pins the four tunings the studios and the bridge key with', () => {
    expect(CHROMA_PRESETS).toEqual({
      default: { castThreshold: 80, castSoftness: 30, despill: 1, despillGreenBoost: 0.5 },
      tile: { castThreshold: 40, castSoftness: 35, despill: 1, despillGreenBoost: 0.6 },
      prop: { castThreshold: 70, castSoftness: 30, despill: 1, despillGreenBoost: 0.5 },
      despill: { castThreshold: 256, castSoftness: 0, despill: 1, despillGreenBoost: 0.6 },
    })
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
