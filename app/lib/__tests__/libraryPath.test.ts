import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  assertInsideRoot,
  isValidKind,
  isValidName,
  isValidRelPath,
  resolveAssetDir,
  resolveAssetFile,
} from '@/app/lib/libraryPath'

const ROOT = '/tmp/ie-assets'

describe('isValidName', () => {
  it('accepts lower-case slugs', () => {
    expect(isValidName('mossy-stone')).toBe(true)
    expect(isValidName('dungeon2')).toBe(true)
    expect(isValidName('a')).toBe(true)
  })

  it('rejects anything that could escape a path', () => {
    for (const bad of ['..', '../x', 'a/b', '/abs', 'a b', 'UPPER', 'a_b', '', '-lead', '.hidden']) {
      expect(isValidName(bad), bad).toBe(false)
    }
  })

  it('rejects names longer than 64 chars', () => {
    expect(isValidName('a'.repeat(64))).toBe(true)
    expect(isValidName('a'.repeat(65))).toBe(false)
  })
})

describe('isValidKind', () => {
  it('accepts only the five asset kinds', () => {
    for (const k of ['tiles', 'sprites', 'props', 'parallax', 'extend']) expect(isValidKind(k)).toBe(true)
    for (const k of ['tile', 'TILES', '', 'raw', '../tiles']) expect(isValidKind(k)).toBe(false)
  })
})

describe('isValidRelPath', () => {
  it('accepts raw/ and derived/ files', () => {
    expect(isValidRelPath('raw/sheet.png')).toBe(true)
    expect(isValidRelPath('derived/edge-top.png')).toBe(true)
    expect(isValidRelPath('derived/body.v2.png')).toBe(true)
  })

  it('rejects anything outside raw/ and derived/, and any nesting', () => {
    for (const bad of [
      'meta.json',
      'derived/',
      'derived/sub/x.png',
      '../derived/x.png',
      'derived/../meta.json',
      '/derived/x.png',
      'derived/UPPER.png',
      'derived/x',
      '',
    ]) {
      expect(isValidRelPath(bad), bad).toBe(false)
    }
  })
})

describe('assertInsideRoot', () => {
  it('accepts a path inside the root', () => {
    expect(() => assertInsideRoot(ROOT, path.join(ROOT, 'a/b/c.png'))).not.toThrow()
  })

  it('rejects the root itself and anything above or beside it', () => {
    expect(() => assertInsideRoot(ROOT, ROOT)).toThrow(/outside/)
    expect(() => assertInsideRoot(ROOT, '/tmp/other/x.png')).toThrow(/outside/)
    expect(() => assertInsideRoot(ROOT, path.join(ROOT, '../escape.png'))).toThrow(/outside/)
  })

  it('rejects a sibling directory whose name merely shares the prefix', () => {
    expect(() => assertInsideRoot(ROOT, '/tmp/ie-assets-evil/x.png')).toThrow(/outside/)
    expect(() => assertInsideRoot(ROOT, ROOT + '-evil')).toThrow(/outside/)
  })
})

describe('resolveAssetDir / resolveAssetFile', () => {
  it('builds the canonical layout', () => {
    expect(resolveAssetDir(ROOT, 'dungeon', 'tiles', 'mossy-stone')).toBe(
      path.join(ROOT, 'dungeon', 'tiles', 'mossy-stone')
    )
  })

  it('builds the canonical file path for a valid rel', () => {
    expect(resolveAssetFile(ROOT, 'dungeon', 'tiles', 'mossy-stone', 'derived/body.png')).toBe(
      path.join(ROOT, 'dungeon', 'tiles', 'mossy-stone', 'derived', 'body.png')
    )
    expect(resolveAssetFile(ROOT, 'dungeon', 'tiles', 'mossy-stone', 'raw/sheet.png')).toBe(
      path.join(ROOT, 'dungeon', 'tiles', 'mossy-stone', 'raw', 'sheet.png')
    )
  })

  it('refuses to build a path from an invalid name', () => {
    expect(() => resolveAssetDir(ROOT, 'dungeon', 'tiles', '../x')).toThrow()
    expect(() => resolveAssetFile(ROOT, 'dungeon', 'tiles', 'ok', '../meta.json')).toThrow()
  })
})
