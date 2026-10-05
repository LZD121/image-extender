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
    const out = collectStudioAsset({
      mode: 'tile',
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
    const out = collectStudioAsset({
      mode: 'tile',
      prompt: null, model: 'm', tileSet: [], tileSheetDataUrl: PNG, manifest: null,
    })
    expect(out?.kind).toBe('tiles')
    expect(out?.provenance.params).toEqual({ derived: 0, sheet: true })
  })

  it('collects props with their file names and the manifest', () => {
    const out = collectStudioAsset({
      mode: 'props',
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

  it('refuses props whose propFiles count does not match the populated props', () => {
    expect(() =>
      collectStudioAsset({
        mode: 'props',
        prompt: 'r', model: 'm',
        propItems: [{ id: 'p1', name: 'Rock', imageUrl: PNG }],
        propFiles: [],
        propAtlasDataUrl: null,
        manifest: null,
      })
    ).toThrow(/propFiles must match/)
  })

  it('refuses props with duplicate file names', () => {
    expect(() =>
      collectStudioAsset({
        mode: 'props',
        prompt: 'r', model: 'm',
        propItems: [
          { id: 'p1', name: 'Rock', imageUrl: PNG },
          { id: 'p2', name: 'Rock', imageUrl: PNG },
        ],
        propFiles: ['rock.png', 'rock.png'],
        propAtlasDataUrl: null,
        manifest: null,
      })
    ).toThrow(/duplicate/)
  })

  it('collects sprite frames reindexed to contiguous names', () => {
    const out = collectStudioAsset({
      mode: 'sprite',
      prompt: 'knight',
      model: 'm',
      frames: [{ imageUrl: PNG }, { imageUrl: null }, { imageUrl: PNG }],
      manifest: null,
    })
    expect(out?.kind).toBe('sprites')
    expect(Object.keys(out?.files ?? {})).toEqual(['derived/frame_01.png', 'derived/frame_02.png'])
  })

  it('collects a single extender image', () => {
    const out = collectStudioAsset({
      mode: 'extender',
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

  it('collects a parallax image', () => {
    const out = collectStudioAsset({
      mode: 'parallax',
      prompt: 'hills',
      model: 'm',
      imageUrl: PNG,
      dimensions: { width: 2, height: 3 },
      manifest: null,
    })
    expect(out?.kind).toBe('parallax')
    expect(Object.keys(out?.files ?? {})).toEqual(['derived/image.png'])
    expect(out?.provenance.returned).toBe('2x3')
  })

  it('returns null when there is nothing to save', () => {
    expect(collectStudioAsset({
      mode: 'tile',
      prompt: null, model: 'm', tileSet: [], tileSheetDataUrl: null, manifest: null,
    })).toBeNull()
  })
})
