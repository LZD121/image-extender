import { describe, expect, it } from 'vitest'
import { buildAssetMeta, collectStudioAsset, slugify } from '@/app/lib/libraryCollect'
import { isBackendLabel } from '@/app/lib/libraryTypes'

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
      backend: 'openrouter',
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
      backend: 'openrouter',
      prompt: null, model: 'm', tileSet: [], tileSheetDataUrl: PNG, manifest: null,
    })
    expect(out?.kind).toBe('tiles')
    expect(out?.provenance.params).toEqual({ derived: 0, sheet: true })
  })

  it('collects props with their file names and the manifest', () => {
    const out = collectStudioAsset({
      mode: 'props',
      backend: 'openrouter',
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
        backend: 'openrouter',
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
        backend: 'openrouter',
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
      backend: 'openrouter',
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
      backend: 'openrouter',
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
      backend: 'openrouter',
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
      backend: 'openrouter',
      prompt: null, model: 'm', tileSet: [], tileSheetDataUrl: null, manifest: null,
    })).toBeNull()
  })
})

describe('buildAssetMeta', () => {
  it('splits raw/ and derived/ and keeps a non-null manifest type', () => {
    const collected = collectStudioAsset({
      mode: 'props',
      backend: 'openrouter',
      prompt: 'rocks',
      model: 'm',
      propItems: [{ id: 'p1', name: 'Rock', imageUrl: PNG }],
      propFiles: ['rock.png'],
      propAtlasDataUrl: PNG,
      manifest: { type: 'prop-atlas' },
    })
    const meta = buildAssetMeta(collected!, { project: 'dungeon', slug: 'rocks', now: '2026-10-05T00:00:00.000Z' })
    expect(meta.type).toBe('prop-atlas')
    expect(meta.files).toEqual({ sheet: 'raw/sheet.png', derived: ['derived/rock.png'] })
    expect(meta.createdAt).toBe('2026-10-05T00:00:00.000Z')
    expect(meta.provenance.backend).toBe('openrouter')
    expect(meta.schemaVersion).toBe(1)
  })

  it('falls back to <kind>-set when the manifest has no type', () => {
    const collected = collectStudioAsset({
      mode: 'sprite',
      backend: 'openrouter',
      prompt: 'knight',
      model: 'm',
      frames: [{ imageUrl: PNG }],
      manifest: null,
    })
    const meta = buildAssetMeta(collected!, { project: 'p', slug: 'knight' })
    expect(meta.type).toBe('sprites-set')
    expect(meta.files).toEqual({ sheet: null, derived: ['derived/frame_01.png'] })
  })

  it('produces a meta the route accepts (shape contract)', () => {
    const collected = collectStudioAsset({
      mode: 'tile',
      backend: 'openrouter',
      prompt: 'stone',
      model: 'm',
      tileSet: [{ role: 'body', imageUrl: PNG }],
      tileSheetDataUrl: PNG,
      manifest: null,
    })
    const meta = buildAssetMeta(collected!, { project: 'dungeon', slug: 'stone' })
    // Every field the /api/library POST validates or surfaces in the index.
    for (const key of ['schemaVersion', 'type', 'project', 'kind', 'slug', 'createdAt', 'updatedAt', 'manifest', 'files', 'provenance']) {
      expect(meta).toHaveProperty(key)
    }
    expect(typeof meta.provenance.model).toBe('string')
  })
})

describe('the facts an asset records', () => {
  it('carries the producer, the requested canvas and the reported cost to disk', () => {
    const collected = collectStudioAsset({
      mode: 'extender',
      backend: 'apimart',
      requested: '2048x1024',
      cost: { usd: 0.04, source: 'apimart' },
      prompt: 'a cliff',
      model: 'gpt-image-1',
      imageUrl: PNG,
      dimensions: { width: 2048, height: 1024 },
      manifest: null,
    })
    const meta = buildAssetMeta(collected!, { project: 'dungeon', slug: 'cliff' })
    expect(meta.provenance.backend).toBe('apimart')
    expect(meta.provenance.requested).toBe('2048x1024')
    expect(meta.provenance.returned).toBe('2048x1024')
    expect(meta.provenance.cost).toEqual({ usd: 0.04, source: 'apimart' })
  })

  it('leaves the optional facts null rather than absent', () => {
    const collected = collectStudioAsset({
      mode: 'tile',
      backend: 'magpie',
      prompt: 'stone',
      model: 'm',
      tileSet: [{ role: 'body', imageUrl: PNG }],
      tileSheetDataUrl: null,
      manifest: null,
    })
    expect(collected?.provenance).toMatchObject({
      backend: 'magpie',
      requested: null,
      returned: null,
      cost: null,
    })
  })

  it('knows every gateway plus the pixel vendor, and nothing else', () => {
    for (const label of ['openrouter', 'magpie', 'apimart', 'pixellab']) {
      expect(isBackendLabel(label)).toBe(true)
    }
    expect(isBackendLabel('midjourney')).toBe(false)
    expect(isBackendLabel('')).toBe(false)
    expect(isBackendLabel(undefined)).toBe(false)
  })
})
