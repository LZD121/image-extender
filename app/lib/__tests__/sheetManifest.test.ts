import { describe, expect, it } from 'vitest'
import { buildPropManifest, buildSpriteManifest, buildTileSetManifest } from '@/app/lib/sheetManifest'
import type { PropItem } from '@/app/lib/props'
import type { SpriteFrame } from '@/app/lib/sprite'

/**
 * The manifests are an export contract: an engine importer reads them by key.
 * These tests pin the key ORDER as well as the values, because the ZIP path and
 * the CLI write the same JSON and a reordering would change the bytes a
 * downstream diff or checksum sees.
 */
const keysOf = (value: object) => Object.keys(value)

describe('the tile set manifest', () => {
  const input = {
    prompt: 'mossy stone',
    sceneBrief: '   ',
    artStyle: 'none',
    presentRoles: ['body', 'top'] as const,
  }

  it('keeps the key order the exporters have always written', () => {
    const manifest = buildTileSetManifest(input)
    expect(keysOf(manifest)).toEqual([
      'version',
      'tileSize',
      'cols',
      'rows',
      'sheetWidth',
      'sheetHeight',
      'productionAtlas',
      'prompt',
      'sceneBrief',
      'artStyle',
      'tiles',
    ])
    expect(keysOf(manifest.productionAtlas)).toEqual([
      'fileName',
      'tileSize',
      'extrudePx',
      'stride',
      'sheetWidth',
      'sheetHeight',
      'importNote',
    ])
    expect(keysOf(manifest.tiles[0])).toEqual([
      'role',
      'label',
      'col',
      'row',
      'index',
      'fileName',
      'present',
      'sourceX',
      'sourceY',
      'paddedX',
      'paddedY',
    ])
  })

  it('lists every slot, marking only the roles it was handed as present', () => {
    const manifest = buildTileSetManifest(input)
    expect(manifest.tiles).toHaveLength(13)
    expect(manifest.tiles.filter((t) => t.present).map((t) => t.role)).toEqual(['top', 'body'])
  })

  it('treats a blank brief and no style as absent', () => {
    const manifest = buildTileSetManifest(input)
    expect(manifest.sceneBrief).toBeNull()
    expect(manifest.artStyle).toBeNull()
    expect(manifest.prompt).toBe('mossy stone')
  })

  it('places each tile at its padded atlas rect', () => {
    const manifest = buildTileSetManifest({ ...input, presentRoles: [] })
    for (const tile of manifest.tiles) {
      expect(tile.index).toBe(tile.row * manifest.cols + tile.col)
      expect(tile.paddedX).toBeGreaterThan(tile.sourceX)
      expect(tile.paddedY).toBeGreaterThan(tile.sourceY)
    }
  })
})

describe('the prop manifest', () => {
  const items: PropItem[] = [
    { id: 'p1', name: 'Lantern', imageUrl: 'data:a', generating: false },
    { id: 'p2', name: 'Rock', imageUrl: null, generating: true },
    { id: 'p3', name: 'Rock', imageUrl: 'data:b', generating: false },
  ]

  it('keeps the key order and describes only the props that have an image', () => {
    const manifest = buildPropManifest({ prompt: ' cave props ', sceneBrief: 'a cave', items })
    expect(keysOf(manifest)).toEqual([
      'type',
      'generator',
      'prompt',
      'sceneBrief',
      'sheet',
      'grid',
      'count',
      'props',
    ])
    expect(keysOf(manifest.props[0])).toEqual(['id', 'name', 'file', 'x', 'y', 'width', 'height'])
    expect(manifest.count).toBe(2)
    expect(manifest.props.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(manifest.prompt).toBe('cave props')
  })

  it('gives two props that share a name distinct files', () => {
    const manifest = buildPropManifest({
      prompt: 'rocks',
      sceneBrief: '',
      items: [
        { id: 'a', name: 'Rock', imageUrl: 'data:a', generating: false },
        { id: 'b', name: 'Rock', imageUrl: 'data:b', generating: false },
      ],
    })
    expect(manifest.props.map((p) => p.file)).toEqual(['rock_01.png', 'rock_02.png'])
  })

  it('lays the rects out inside the sheet it declares', () => {
    const manifest = buildPropManifest({ prompt: 'rocks', sceneBrief: '', items })
    for (const p of manifest.props) {
      expect(p.x + p.width).toBeLessThanOrEqual(manifest.sheet.width)
      expect(p.y + p.height).toBeLessThanOrEqual(manifest.sheet.height)
    }
  })
})

describe('the sprite manifest', () => {
  const frames: SpriteFrame[] = [
    { index: 0, imageUrl: 'data:0' },
    { index: 1, imageUrl: 'data:1', disabled: true },
    { index: 2, imageUrl: null },
    { index: 3, imageUrl: 'data:3' },
  ]
  const input = {
    anim: 'walk',
    bodyPlan: 'biped',
    fps: 12,
    prompt: 'a knight',
    sceneBrief: '',
    artStyle: 'pixel-art',
    frames,
  } as const

  it('keeps the key order the exporters have always written', () => {
    const manifest = buildSpriteManifest(input)
    expect(keysOf(manifest)).toEqual([
      'version',
      'bodyPlan',
      'bodyPlanLabel',
      'anim',
      'label',
      'frameCount',
      'frameSize',
      'fps',
      'frameDurationMs',
      'loop',
      'grid',
      'strip',
      'prompt',
      'sceneBrief',
      'artStyle',
      'frames',
    ])
    expect(keysOf(manifest.frames[0])).toEqual([
      'index',
      'sourceIndex',
      'fileName',
      'gridCol',
      'gridRow',
      'gridX',
      'gridY',
      'stripX',
      'stripY',
    ])
  })

  it('drops excluded and empty frames and repacks the rest contiguously', () => {
    const manifest = buildSpriteManifest(input)
    expect(manifest.frameCount).toBe(2)
    expect(manifest.frames.map((f) => f.sourceIndex)).toEqual([0, 3])
    expect(manifest.frames.map((f) => f.index)).toEqual([0, 1])
    expect(manifest.frames.map((f) => f.fileName)).toEqual(['frame_01.png', 'frame_02.png'])
    expect(manifest.strip.cols).toBe(2)
    expect(manifest.strip.sheetWidth).toBe(2 * manifest.frameSize)
  })

  it('reads grid coordinates from the exported order, not the original slots', () => {
    const manifest = buildSpriteManifest({
      ...input,
      frames: Array.from({ length: 6 }, (_, i) => ({ index: i, imageUrl: `data:${i}` })),
    })
    expect(manifest.frames[4]).toMatchObject({ index: 4, gridCol: 0, gridRow: 1, gridX: 0 })
    expect(manifest.frames[5]).toMatchObject({ index: 5, gridCol: 1, gridRow: 1 })
  })

  it('prefers the prompt the sheet was painted with', () => {
    expect(buildSpriteManifest({ ...input, sheetPrompt: 'repaired knight' }).prompt).toBe(
      'repaired knight'
    )
    expect(buildSpriteManifest(input).prompt).toBe('a knight')
    expect(buildSpriteManifest(input).frameDurationMs).toBe(83)
  })
})
