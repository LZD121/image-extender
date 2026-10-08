/**
 * `ie library` against a throwaway $IE_ASSETS_DIR — the round-trip an agent
 * relies on when it catalogs generated art. Runs the real command module with
 * the same context shape `cli/ie.mjs` builds, and the real on-disk library.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { nodeBundle } from '../../native/bundle.mjs'
import { CliError } from '../../lib/args.mjs'
import commands from '../library.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PNG = path.join(REPO, 'e2e/fixtures/assets/demo/tiles/sample/derived/body.png')

let root
const savedEnv = process.env.IE_ASSETS_DIR

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ie-library-'))
  process.env.IE_ASSETS_DIR = root
})

afterEach(async () => {
  if (savedEnv === undefined) delete process.env.IE_ASSETS_DIR
  else process.env.IE_ASSETS_DIR = savedEnv
  await rm(root, { recursive: true, force: true })
})

/** The subset of the CLI context `library.mjs` uses. */
async function ctxFor(args, flags = {}) {
  return {
    args,
    flags,
    spec: commands.library,
    json: true,
    note() {},
    fail(code, message, detail) {
      throw new CliError(code, message, detail)
    },
    async modules(name, imports) {
      return import(pathToFileURL(nodeBundle(name, imports)).href)
    },
    /** Same as the real context: the app authors the provenance shape. */
    async provenance(fields) {
      const { buildProvenance } = await this.modules('librarycollect', ['app/lib/libraryCollect'])
      return buildProvenance(fields)
    },
  }
}

const run = async (args, flags) => commands.library.run(await ctxFor(args, flags))

describe('ie library', () => {
  it('lists an empty root without failing', async () => {
    const payload = await run(['list'])
    expect(payload.root).toBe(root)
    expect(payload.projects).toEqual([])
    expect(payload.warnings).toEqual([])
  })

  it('saves, reads back and deletes one asset', async () => {
    const save = await run(['save', 'demo', 'tiles', 'smoke'], {
      sheet: PNG,
      derived: PNG,
      type: 'dungeon-set',
      backend: 'openrouter',
    })
    expect(save.path).toBe('demo/tiles/smoke')
    expect(save.written.length).toBe(2)

    const meta = JSON.parse(await readFile(path.join(root, 'demo/tiles/smoke/meta.json'), 'utf8'))
    expect(meta).toMatchObject({ schemaVersion: 1, type: 'dungeon-set', project: 'demo', kind: 'tiles', slug: 'smoke' })
    expect(meta.files.sheet).toBe('raw/body.png')
    expect(meta.files.derived).toEqual(['derived/body.png'])
    // The CLI stamps its own toolVersion so a reader can tell what wrote this.
    expect(meta.provenance.toolVersion).toMatch(/^ie@/)

    const list = await run(['list'])
    expect(list.projects[0].kinds[0].assets[0].slug).toBe('smoke')

    const get = await run(['get', 'demo', 'tiles', 'smoke'])
    expect(get.meta.slug).toBe('smoke')

    const out = path.join(root, 'copy.png')
    await run(['file', 'demo', 'tiles', 'smoke', 'derived/body.png'], { out })
    expect((await stat(out)).size).toBe((await stat(PNG)).size)

    const del = await run(['delete', 'demo', 'tiles', 'smoke'])
    expect(del.deleted).toBe('demo/tiles/smoke')
    expect((await run(['list'])).projects).toEqual([])
  })

  it('refuses to clobber an existing asset without --overwrite, and allows it with', async () => {
    await run(['save', 'demo', 'tiles', 'smoke'], { sheet: PNG, backend: 'openrouter' })
    await expect(
      run(['save', 'demo', 'tiles', 'smoke'], { sheet: PNG, backend: 'openrouter' })
    ).rejects.toMatchObject({ code: 'EEXISTS' })
    const again = await run(['save', 'demo', 'tiles', 'smoke'], {
      sheet: PNG,
      backend: 'openrouter',
      overwrite: true,
    })
    expect(again.written.length).toBe(1)
  })

  it('reports a missing asset and a bad id with the app"s own rules', async () => {
    await expect(run(['delete', 'demo', 'tiles', 'ghost'])).rejects.toMatchObject({ code: 'ENOTFOUND' })
    await expect(run(['get', 'demo', 'tilez', 'smoke'])).rejects.toMatchObject({ code: 'invalid_kind' })
    await expect(run(['file', 'demo', 'tiles', 'smoke', '../secret'], { out: '/tmp/ie-nope.png' })).rejects.toMatchObject({
      code: 'invalid_file_path',
    })
  })

  it('requires a file and an --out where they make no sense to omit', async () => {
    await expect(run(['save', 'demo', 'tiles', 'smoke'])).rejects.toMatchObject({ code: 'usage' })
    await run(['save', 'demo', 'tiles', 'smoke'], { sheet: PNG, backend: 'openrouter' })
    await expect(run(['file', 'demo', 'tiles', 'smoke', 'raw/body.png'])).rejects.toMatchObject({ code: 'usage' })
  })
  it('names the gateway instead of defaulting to one (LIB-04)', async () => {
    // The flag used to fall back to `openrouter`, so an APIMart asset could be
    // stamped with a gateway that never painted it. It is required now, and the
    // label it carries is the label that reaches `meta.json`.
    await expect(run(['save', 'demo', 'tiles', 'x'], { sheet: PNG })).rejects.toMatchObject({
      code: 'missing_flag',
    })
    await expect(run(['save', 'demo', 'tiles', 'x'], { sheet: PNG, backend: 'nope' })).rejects.toMatchObject({
      code: 'bad_backend',
    })
    const saved = await run(['save', 'demo', 'tiles', 'x'], { sheet: PNG, backend: 'apimart' })
    expect(saved.meta.provenance.backend).toBe('apimart')
  })


  it('rejects an unknown subcommand as a usage error', async () => {
    await expect(run(['frobnicate'])).rejects.toThrow(/unknown library subcommand/)
  })
})

// LIB-02 / CLI-03. An animation set enters the library as a run directory — the
// derived frames plus the ledger, never a raw — and its provenance is read off
// that ledger rather than from a CLI default.
describe('ie library save — the animations kind', () => {
  /** A throwaway run directory: a real PNG twice over, plus a real ledger. */
  const makeRunDir = async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ie-run-'))
    await mkdir(path.join(dir, 'derived'))
    await cp(PNG, path.join(dir, 'derived/idle_f1_east.png'))
    await cp(PNG, path.join(dir, 'derived/idle_f1_south.png'))
    await writeFile(
      path.join(dir, 'set.json'),
      JSON.stringify({
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
      })
    )
    return dir
  }

  it('saves from a run directory with no --sheet and no --derived', async () => {
    const dir = await makeRunDir()
    try {
      const payload = await run(['save', 'dungeon', 'animations', 'chaser-idle'], {
        'set-json': path.join(dir, 'set.json'),
        'derived-dir': path.join(dir, 'derived'),
      })
      expect(payload.path).toBe('dungeon/animations/chaser-idle')

      const assetDir = path.join(root, 'dungeon/animations/chaser-idle')
      const meta = JSON.parse(await readFile(path.join(assetDir, 'meta.json'), 'utf8'))
      expect(meta.kind).toBe('animations')
      expect(meta.files.sheet).toBe(null)
      expect(meta.files.derived).toEqual([
        'derived/idle_f1_east.png',
        'derived/idle_f1_south.png',
        'derived/set.json',
      ])
      expect(meta.manifest).not.toHaveProperty('strips')
      expect(meta.manifest.states[0]).not.toHaveProperty('motion')
      expect(meta.provenance.backend).toBe('apimart')
      expect(meta.provenance.model).toBe('teamo-router/gemini-3.1-flash-image')
      expect(meta.provenance.params.calls).toBe(1)

      // D-50's whole point: the ledger really lands where the validator accepts
      // it. A top-level `set.json` would have thrown before any disk I/O.
      await stat(path.join(assetDir, 'derived/set.json'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('names the missing flag instead of guessing a path', async () => {
    await expect(run(['save', 'dungeon', 'animations', 'x'], {})).rejects.toMatchObject({
      code: 'missing_flag',
    })
    await expect(
      run(['save', 'dungeon', 'animations', 'x'], { 'set-json': '/tmp/nope.json' })
    ).rejects.toMatchObject({ code: 'missing_flag' })
  })

  it('still demands a file for every other kind', async () => {
    // The animations dispatch sits before this guard; the guard must still fire
    // for the kinds it was written for.
    await expect(run(['save', 'dungeon', 'tiles', 'x'], {})).rejects.toThrow(/needs at least one file/)
  })
})
