import { describe, expect, it } from 'vitest'
import { buildAssetMeta, buildProvenance, collectSetAsset, collectStudioAsset, slugify } from '@/app/lib/libraryCollect'
import type { SetJson } from '@/app/lib/animSet'
import { ASSET_KINDS, isBackendLabel } from '@/app/lib/libraryTypes'

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

// LIB-01. The kind is a directory name on disk (`<project>/<kind>/<slug>/`), so
// adding one is a data-layout commitment, not just a type change: `KIND_KEY`'s
// `Record<AssetKind, string>` makes the panel label a compile error if it is
// missed, and the length assertion here keeps a silent removal from passing.
describe('ASSET_KINDS includes animations (LIB-01)', () => {
  it('contains animations', () => {
    expect(ASSET_KINDS).toContain('animations')
  })

  it('has exactly 6 kinds', () => {
    expect(ASSET_KINDS).toHaveLength(6)
  })
})

// LIB-05 / LIB-06. The set payload is the derived frames plus the ledger, and its
// provenance is read off that ledger — never from a CLI default.
const SET_JSON: SetJson = {
  schemaVersion: 1,
  kind: 'animation-set',
  actor: 'chaser',
  dirs: {
    preset: 'dirs8',
    order: ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'],
  },
  cell: 512,
  states: [{ name: 'idle', frames: 2, fps: 4, durationsMs: [250, 250], loop: true }],
  strips: [],
  frames: [],
  backend: { provider: 'apimart', model: 'teamo-router/gemini-3.1-flash-image' },
  totals: { calls: 1, cells: 8, seconds: 12.5 },
}

const SET_ARGS = {
  setJson: SET_JSON,
  setJsonDataUrl: 'data:application/json;base64,e30=',
  derived: [
    { name: 'idle_f1_east.png', dataUrl: PNG },
    { name: 'idle_f1_south.png', dataUrl: PNG },
  ],
  project: 'dungeon',
  slug: 'chaser-idle',
}

describe('collectSetAsset (the animations kind)', () => {
  it('sends derived frames plus the ledger, and never a raw', () => {
    const { files } = collectSetAsset(SET_ARGS)
    expect(Object.keys(files).sort()).toEqual([
      'derived/idle_f1_east.png',
      'derived/idle_f1_south.png',
      'derived/set.json',
    ])
    expect(Object.keys(files).every((f) => f.startsWith('derived/'))).toBe(true)
    expect(Object.keys(files).some((f) => f.startsWith('raw/'))).toBe(false)
    // `files.sheet` is derived from a `raw/` entry, so an animations asset has none.
    expect(collectSetAsset(SET_ARGS).meta.files.sheet).toBe(null)
  })

  it('carries the spec block and no frame list (LIB-05)', () => {
    const manifest = collectSetAsset(SET_ARGS).meta.manifest!
    expect(manifest.type).toBe('animation-set')
    expect(manifest.actor).toBe('chaser')
    expect(manifest.cell).toBe(512)
    expect(manifest.dirs).toEqual(SET_JSON.dirs)
    expect(manifest).not.toHaveProperty('frames')
    expect(manifest).not.toHaveProperty('strips')
    // The state shape the ledger actually has — `motion` was never in `SetJson`.
    expect(manifest.states).toEqual([{ name: 'idle', frames: 2, fps: 4, durationsMs: [250, 250], loop: true }])
    expect((manifest.states as Record<string, unknown>[])[0]).not.toHaveProperty('motion')
  })

  it('reads backend, model and the totals off the ledger (LIB-03 / LIB-06)', () => {
    const { meta } = collectSetAsset(SET_ARGS)
    expect(meta.kind).toBe('animations')
    expect(meta.provenance.backend).toBe('apimart')
    expect(meta.provenance.model).toBe('teamo-router/gemini-3.1-flash-image')
    expect(meta.provenance.params).toEqual({
      dirs: 8,
      states: 1,
      frames: 2,
      cell: 512,
      calls: 1,
      cells: 8,
      seconds: 12.5,
    })
    // Unknown cost is `null`, never a zero dressed up as a measurement (D-45).
    expect(meta.provenance.cost).toBe(null)
  })

  it('refuses a backend the allow-list does not know, instead of stamping it', () => {
    expect(() =>
      collectSetAsset({ ...SET_ARGS, setJson: { ...SET_JSON, backend: { provider: 'gpt-image-9', model: 'm' } } })
    ).toThrow(/not one of/)
  })
})

// LIB-03. A cost is recorded only when the vendor reported one, and the vendor it
// names has to be the vendor that painted the asset — otherwise `meta.json`
// carries exactly the kind of lie this phase exists to end.
describe('buildProvenance cost consistency (LIB-03)', () => {
  it('throws when cost.source names another vendor', () => {
    expect(() =>
      buildProvenance({ backend: 'apimart', model: 'm', cost: { usd: 0.01, source: 'openrouter' } })
    ).toThrow('cost.source (openrouter) must match backend (apimart)')
  })

  it('accepts an unreported cost as null', () => {
    expect(buildProvenance({ backend: 'apimart', model: 'm', cost: null }).cost).toBe(null)
  })

  it('accepts a cost whose source is the backend', () => {
    expect(
      buildProvenance({ backend: 'openrouter', model: 'm', cost: { usd: 0.01, source: 'openrouter' } }).cost
    ).toEqual({ usd: 0.01, source: 'openrouter' })
  })
})
