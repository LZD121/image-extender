import { describe, expect, it } from 'vitest'
import { collectStudioAsset, slugify } from '@/app/lib/libraryCollect'

const PNG = 'data:image/png;base64,AAAA'

describe('slugify', () => {
  it('lower-cases, collapses and truncates', () => {
    expect(slugify('Mossy Grey Dungeon Stone!')).toBe('mossy-grey-dungeon-stone')
    expect(slugify('   ')).toBe('asset')
    expect(slugify('a'.repeat(90))).toHaveLength(64)
    expect(slugify('--weird__name--')).toBe('weird-name')
  })
})

describe('collectStudioAsset', () => {
  it('collects tiles: one derived PNG per role plus the sheet', () => {
    const out = collectStudioAsset('tile', {
      prompt: 'mossy stone',
      model: 'google/gemini-3.1-flash-image-preview',
      tileSet: [
        { role: 'body', imageUrl: PNG },
        { role: 'top', imageUrl: null },
      ],
      tileSheetDataUrl: PNG,
      manifest: null,
    })
    expect(out?.kind).toBe('tiles')
    expect(Object.keys(out?.files ?? {}).sort()).toEqual(['derived/body.png', 'raw/sheet.png'])
    expect(out?.provenance.params).toEqual({ derived: 1, sheet: true })
  })

  it('reports zero derived tiles when only the sheet exists', () => {
    const out = collectStudioAsset('tile', {
      prompt: null, model: 'm', tileSet: [], tileSheetDataUrl: PNG, manifest: null,
    })
    expect(out?.kind).toBe('tiles')
    expect(out?.provenance.params).toEqual({ derived: 0, sheet: true })
  })

  it('collects props with their file names and the manifest', () => {
    const out = collectStudioAsset('props', {
      prompt: 'rocks',
      model: 'm',
      propItems: [{ id: 'p1', name: 'Rock', imageUrl: PNG }],
      propFiles: ['rock.png'],
      propAtlasDataUrl: PNG,
      manifest: { type: 'prop-atlas' },
    })
    expect(out?.kind).toBe('props')
    expect(Object.keys(out?.files ?? {}).sort()).toEqual(['derived/rock.png', 'raw/sheet.png'])
    expect(out?.manifest).toEqual({ type: 'prop-atlas' })
  })

  it('refuses props without a matching propFiles list', () => {
    expect(() =>
      collectStudioAsset('props', {
        prompt: 'r', model: 'm',
        propItems: [{ id: 'p1', name: 'Rock', imageUrl: PNG }],
        propAtlasDataUrl: null,
        manifest: null,
      })
    ).toThrow(/propFiles/)
  })

  it('collects sprite frames reindexed to contiguous names', () => {
    const out = collectStudioAsset('sprite', {
      prompt: 'knight',
      model: 'm',
      frames: [{ imageUrl: PNG }, { imageUrl: null }, { imageUrl: PNG }],
      manifest: null,
    })
    expect(out?.kind).toBe('sprites')
    expect(Object.keys(out?.files ?? {})).toEqual(['derived/frame_01.png', 'derived/frame_02.png'])
  })

  it('collects a single extender/parallax image', () => {
    const out = collectStudioAsset('extender', {
      prompt: null,
      model: 'm',
      imageUrl: PNG,
      dimensions: { width: 1413, height: 1024 },
      manifest: null,
    })
    expect(out?.kind).toBe('extend')
    expect(Object.keys(out?.files ?? {})).toEqual(['derived/image.png'])
    expect(out?.provenance.returned).toBe('1413x1024')
  })

  it('returns null when there is nothing to save', () => {
    expect(collectStudioAsset('tile', {
      prompt: null, model: 'm', tileSet: [], tileSheetDataUrl: null, manifest: null,
    })).toBeNull()
  })
})
