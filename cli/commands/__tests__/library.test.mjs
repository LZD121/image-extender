/**
 * `ie library` against a throwaway $IE_ASSETS_DIR — the round-trip an agent
 * relies on when it catalogs generated art. Runs the real command module with
 * the same context shape `cli/ie.mjs` builds, and the real on-disk library.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
    await run(['save', 'demo', 'tiles', 'smoke'], { sheet: PNG })
    await expect(run(['save', 'demo', 'tiles', 'smoke'], { sheet: PNG })).rejects.toMatchObject({ code: 'EEXISTS' })
    const again = await run(['save', 'demo', 'tiles', 'smoke'], { sheet: PNG, overwrite: true })
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
    await run(['save', 'demo', 'tiles', 'smoke'], { sheet: PNG })
    await expect(run(['file', 'demo', 'tiles', 'smoke', 'raw/body.png'])).rejects.toMatchObject({ code: 'usage' })
  })

  it('rejects an unknown subcommand as a usage error', async () => {
    await expect(run(['frobnicate'])).rejects.toThrow(/unknown library subcommand/)
  })
})
