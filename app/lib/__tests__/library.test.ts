import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assetsRoot,
  deleteAsset,
  listAssets,
  readAssetFile,
  readMeta,
  saveAsset,
} from '@/app/lib/library'
import type { AssetMeta } from '@/app/lib/libraryTypes'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function meta(slug = 'mossy-stone'): AssetMeta {
  return {
    schemaVersion: 1,
    type: 'tile-set',
    project: 'dungeon',
    kind: 'tiles',
    slug,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    manifest: null,
    files: { sheet: 'raw/sheet.png', derived: ['derived/body.png'] },
    provenance: {
      backend: 'apimart',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'mossy stone',
      sceneBrief: null,
      artStyle: null,
      params: { width: 4096, height: 4096 },
      requested: '4096x4096',
      returned: '4096x4096',
      cost: { usd: 0.0262, source: 'apimart' },
      toolVersion: 'web',
    },
  }
}

describe('library fs layer', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'ie-lib-'))
    process.env.IE_ASSETS_DIR = root
  })

  afterEach(async () => {
    delete process.env.IE_ASSETS_DIR
    await rm(root, { recursive: true, force: true })
  })

  it('defaults the root to <cwd>/assets', () => {
    delete process.env.IE_ASSETS_DIR
    expect(assetsRoot()).toBe(path.join(process.cwd(), 'assets'))
  })

  it('writes meta, sheet and derived files', async () => {
    const written = await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), {
      'raw/sheet.png': PNG,
      'derived/body.png': PNG,
    })
    expect(written.sort()).toEqual(['derived/body.png', 'raw/sheet.png'])

    const dir = path.join(root, 'dungeon', 'tiles', 'mossy-stone')
    expect((await stat(path.join(dir, 'meta.json'))).isFile()).toBe(true)
    expect((await stat(path.join(dir, 'derived', 'body.png'))).isFile()).toBe(true)

    const roundTrip = await readMeta('dungeon', 'tiles', 'mossy-stone')
    expect(roundTrip.slug).toBe('mossy-stone')
    expect(roundTrip.provenance.cost?.usd).toBe(0.0262)
  })

  it('leaves no directory behind when a payload is not a data URL', async () => {
    await expect(
      saveAsset('dungeon', 'tiles', 'broken', meta('broken'), { 'derived/body.png': 'nope' })
    ).rejects.toThrow(/data URL/)

    const dir = path.join(root, 'dungeon', 'tiles', 'broken')
    await expect(stat(dir)).rejects.toThrow()
  })

  it('refuses to overwrite without the flag, and allows it with', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    await expect(
      saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    ).rejects.toThrow(/exists/)

    const again = await saveAsset(
      'dungeon',
      'tiles',
      'mossy-stone',
      meta(),
      { 'derived/body.png': PNG },
      { overwrite: true }
    )
    expect(again).toEqual(['derived/body.png'])
  })

  it('lists assets and skips a corrupt meta.json with a warning', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    const brokenDir = path.join(root, 'dungeon', 'tiles', 'broken')
    await mkdir(brokenDir, { recursive: true })
    await writeFile(path.join(brokenDir, 'meta.json'), '{ not json')

    const index = await listAssets()
    expect(index.warnings).toHaveLength(1)
    expect(index.projects.map((p) => p.name)).toEqual(['dungeon'])
    expect(index.projects[0].kinds[0].assets.map((a) => a.slug)).toEqual(['mossy-stone'])
  })

  it('reads a derived file as bytes and refuses a traversal path', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    const bytes = await readAssetFile('dungeon', 'tiles', 'mossy-stone', 'derived/body.png')
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')

    await expect(
      readAssetFile('dungeon', 'tiles', 'mossy-stone', '../meta.json')
    ).rejects.toThrow(/invalid asset file path/)
  })

  it('deletes an asset directory', async () => {
    await saveAsset('dungeon', 'tiles', 'mossy-stone', meta(), { 'derived/body.png': PNG })
    await deleteAsset('dungeon', 'tiles', 'mossy-stone')
    const index = await listAssets()
    expect(index.projects).toHaveLength(0)
  })
})
