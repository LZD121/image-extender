/**
 * `ie anim` against two in-process seams — the gate for the money path.
 *
 * `ctx.api` (HTTP to the gateway) and `ctx.bridge` (the `strip-frames` op) are
 * replaced here, so this file proves the runner's behaviour with no network
 * call, no browser and no cent. The fakes assert the shape of what they are
 * handed — a stub that accepts anything leaves the runner↔op interface
 * unguarded — and the zero-call arms count invocations of the seams instead of
 * grepping the source for the word `dry`. `ctx.server` is counted too: a dry
 * path that touched it would hang against a port nothing listens on, so it is a
 * second, independent reading of "this run went nowhere, not even to the dev
 * server".
 *
 * `sharp` builds the stub op's frames (real, decodable 512² PNGs) and nothing
 * else; `bridge.mjs`'s `runJobs` is deliberately absent — vitest stays
 * browser-free (`npm run test:cli` is the tier that launches Chromium).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { nodeBundle } from '../../native/bundle.mjs'
import { CliError, parseCommand } from '../../lib/args.mjs'
import { dataUrlFromFile } from '../../lib/media.mjs'
import commands from '../anim.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIXTURE = path.join(REPO, 'tests/fixtures/anim/chaser_idle_f1_8dir.png')

/** The hero shape: 2 states × 4 frames × dirs8 → 4096×512 canvases. */
const HERO_STATES = [
  { name: 'idle', motion: 'a calm breathing idle', frames: 4, fps: 4, loop: true },
  { name: 'walk', motion: 'a mid-step of a heavy stalking walk', frames: 4, fps: 8, loop: true },
]
const ONE_STATE = [{ name: 'idle', motion: 'a calm breathing idle', frames: 1, fps: 4, loop: true }]

const SUBJECT = 'a hulking armored beast chaser'
const STYLE = 'Hand-painted dark-fantasy dungeon art'
const MODEL = 'teamo-router/gemini-3.1-flash-image'

let root
/** Directories an arm made read-only; restored here so `rmSync` can win. */
const locked = []

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ie-anim-'))
})

afterEach(() => {
  for (const dir of locked.splice(0)) {
    try {
      chmodSync(dir, 0o700)
    } catch {
      /* already gone */
    }
  }
  rmSync(root, { recursive: true, force: true })
})

/** A spec written to disk — the primary source, exactly as a caller would write it. */
function specFile(spec, name = 'spec.json') {
  const file = path.join(root, name)
  writeFileSync(file, JSON.stringify(spec))
  return file
}

function spec({ states = HERO_STATES, out = path.join(root, 'out'), ...rest } = {}) {
  return {
    actor: 'chaser',
    subject: SUBJECT,
    dirs: 'dirs8',
    states,
    cell: 512,
    styleText: STYLE,
    background: 'magenta',
    model: MODEL,
    out,
    ...rest,
  }
}

/**
 * The eight frames a good strip yields: real, decodable 512² PNGs (04-03's
 * facts decode them in full, so content does not matter — decodability does).
 * All eight derive from one buffer; the op is stubbed, so no pixel is inspected.
 */
let frameBuffer = null
async function frames() {
  if (!frameBuffer) {
    frameBuffer = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
  }
  return new Array(8).fill('data:image/png;base64,' + frameBuffer.toString('base64'))
}

/**
 * The op's real `meta`, anchored on Phase 3's measurements of the committed
 * fixture (03-01-SUMMARY §实测确认) — a synthesised meta would only assert
 * itself.
 */
function fixtureMeta() {
  return {
    ok: true,
    cells: 8,
    cell: 512,
    preset: 'binary',
    dirs: ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'],
    fitted: { spacing: 255, phase: 253, residual: 0.2, residualPct: 0.07943581, medianMass: 246, trials: 20000, gutterOk: false, cutLines: [] },
    field: { rgb: [253, 5, 250], hex: '#FD05FA', cast: 245, preset: 'binary' },
    windows: [],
    gutter: { ok: true, tolerance: 5, lines: [], unrescued: [] },
    counters: { keyed: 8, fieldSurvived: 0, borderTrimmed: 5, borderFailed: 0, isolated: 1, isolatedPx: 365, isolateFailed: 0, scaled: 0, centred: 8, empty: 0, rescued: 1 },
    frames: [],
  }
}

/** A `ctx.bridge` that checks the job the runner hands it, then answers. */
function strictBridge(data, meta) {
  const calls = []
  const fn = (job) => {
    calls.push(job)
    expect(job.op).toBe('strip-frames')
    expect(typeof job.opts.cell).toBe('number')
    expect(job.opts.cell).toBe(512)
    expect(job.opts.dirs.length).toBe(8)
    expect(job.opts.dirs[0]).toBe('east')
    expect(job.opts.dirs[7]).toBe('north-east')
    expect(typeof job.inputs[0]).toBe('string')
    expect(job.inputs[0].startsWith('data:')).toBe(false)
    expect(job.inputs[0].endsWith('.png')).toBe(true)
    return { ok: true, data, meta, written: [] }
  }
  fn.calls = calls
  return fn
}

/** A `ctx.api` that records each body and answers with the given imageUrl. */
function stubApi(imageUrl) {
  const bodies = []
  const fn = async (route, body) => {
    bodies.push({ route, body })
    // A real generation takes seconds; the stub takes just long enough that the
    // wall clock the runner books is a non-zero, observable number.
    await new Promise((resolve) => setTimeout(resolve, 5))
    return { imageUrl }
  }
  fn.bodies = bodies
  return fn
}

/** A seam that throws the moment it is touched, counting every invocation. */
function forbidden(counter, what) {
  return () => {
    counter.count += 1
    throw new Error(`${what} must not be touched on the dry path`)
  }
}

/**
 * The subset of the CLI context `anim.mjs` uses — `library.test.mjs`'s shape
 * plus the seams this command drives.
 */
async function ctxFor(args, flags = {}, seams = {}) {
  const config = seams.config || { profiles: {}, defaultProfile: null, path: null }
  return {
    args,
    flags,
    spec: commands.anim,
    json: true,
    profile: seams.profile,
    model: seams.model,
    config,
    baseUrl: 'http://127.0.0.1:1',
    note() {},
    fail(code, message, detail) {
      throw new CliError(code, message, detail)
    },
    llmFields() {
      const fields = {}
      if (seams.profile) fields.profile = seams.profile
      if (seams.model) fields.model = seams.model
      return fields
    },
    async modules(name, imports) {
      return import(pathToFileURL(nodeBundle(name, imports)).href)
    },
    api: seams.api || forbidden(seams.apiCalls, 'ctx.api'),
    server: seams.server || forbidden(seams.serverCalls, 'ctx.server'),
    bridge: seams.bridge || forbidden(seams.bridgeCalls, 'ctx.bridge'),
  }
}

/** Run a command the way `ie.mjs` does, through the strict parser. */
async function runCli(argv, seams = {}) {
  const { values, positionals } = parseCommand(argv, commands.anim)
  return commands.anim.run(await ctxFor(positionals, values, seams))
}

const tree = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String) : [])
const tempsIn = (dir) => tree(dir).filter((name) => name.includes('.tmp-'))
const derivedNames = (out) => (existsSync(path.join(out, 'derived')) ? readdirSync(path.join(out, 'derived')).sort() : [])
const DIRS8 = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']

describe('ie anim — the dry path', () => {
  it('plans without a single seam invocation and without a single write', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out }))
    // Counters, not source text: an apiCalls / serverCalls reading of 0 is an
    // observation of the seams, and the fakes throw if anything touches them.
    const apiCalls = { count: 0 }
    const serverCalls = { count: 0 }
    const bridgeCalls = { count: 0 }

    const payload = await runCli(['plan', '--spec', file], { apiCalls, serverCalls, bridgeCalls })

    expect(apiCalls.count).toBe(0)
    expect(serverCalls.count).toBe(0)
    expect(bridgeCalls.count).toBe(0)
    expect(payload.plan.length).toBe(8)
    expect(payload.calls).toBe(8)
    expect(payload.cells).toBe(64)
    expect(payload.canvas).toBe('4096x512')
    expect(payload.plan[0]).toEqual({
      index: 0,
      state: 'idle',
      frame: 0,
      canvas: '4096x512',
      calls: 1,
      out: 'raw/idle_f1_8dir.png',
    })
    expect(payload.plan[7].out).toBe('raw/walk_f4_8dir.png')
    expect(payload.dirs).toEqual({ preset: 'dirs8', order: DIRS8 })
    expect(payload.cell).toBe(512)
    expect(payload.states).toEqual([
      { name: 'idle', frames: 4, fps: 4 },
      { name: 'walk', frames: 4, fps: 8 },
    ])
    expect(payload.model).toBe(MODEL)
    expect(payload.provider).toBe('openrouter')
    expect(path.isAbsolute(payload.out)).toBe(true)
    expect(payload.out).toBe(out)
    expect(existsSync(out)).toBe(false)
  })

  it('makes a dry run say exactly what plan says', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out }))
    const apiCalls = { count: 0 }
    const serverCalls = { count: 0 }

    const planned = await runCli(['plan', '--spec', file], { apiCalls, serverCalls })
    const dry = await runCli(['run', '--spec', file], { apiCalls, serverCalls })

    expect(dry).toEqual(planned)
    expect(apiCalls.count).toBe(0)
    expect(serverCalls.count).toBe(0)
    expect(existsSync(out)).toBe(false)
  })
})

describe('ie anim — the --go gate', () => {
  it('refuses to spend from plan, and refuses a subcommand it does not have', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out }))
    await expect(runCli(['plan', '--spec', file, '--go'])).rejects.toThrow(/plan never spends/)
    await expect(runCli(['anim'])).rejects.toThrow(/unknown anim subcommand/)
    await expect(runCli(['frobnicate'])).rejects.toThrow(/unknown anim subcommand/)
    expect(existsSync(out)).toBe(false)
  })

  it('rejects a flag this wave has not implemented instead of ignoring it', () => {
    const file = specFile(spec())
    expect(() => parseCommand(['run', '--spec', file, '--keep-going'], commands.anim)).toThrow(/keep-going/)
    expect(() => parseCommand(['run', '--spec', file, '--redo', 'idle:2'], commands.anim)).toThrow(/redo/)
  })

  it('spends on run --go, one generation call per strip', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out, states: ONE_STATE }))
    const api = stubApi(dataUrlFromFile(FIXTURE))
    const bridge = strictBridge(await frames(), fixtureMeta())

    const payload = await runCli(['run', '--spec', file, '--go'], { api, bridge })

    expect(api.bodies.length).toBe(1)
    expect(bridge.calls.length).toBe(1)
    expect(payload.strips.length).toBe(1)
    expect(payload.strips[0].ok).toBe(true)
    expect(payload.setJson).toBe(path.join(out, 'set.json'))
    expect(payload.written.some((p) => p.endsWith('raw/idle_f1_8dir.png'))).toBe(true)
    expect(payload.written.some((p) => p.endsWith('set.json'))).toBe(true)
  })

  it('carries the plan’s canvas, the model, and the profile in the body', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out, states: ONE_STATE }))
    const api = stubApi(dataUrlFromFile(FIXTURE))
    const bridge = strictBridge(await frames(), fixtureMeta())

    await runCli(['run', '--spec', file, '--go'], { api, bridge, profile: 'probe-x' })

    const { route, body } = api.bodies[0]
    expect(route).toBe('generate')
    expect(body.width).toBe(4096)
    expect(body.height).toBe(512)
    expect(body.model).toBe(MODEL)
    expect(body.profile).toBe('probe-x')
    expect(body.prompt).toContain('cell 1 facing east')
    expect(body.prompt).toContain('cell 8 facing north-east')
  })

  it('books what came back, not what it asked for', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out, states: ONE_STATE }))
    const api = stubApi(dataUrlFromFile(FIXTURE))
    const bridge = strictBridge(await frames(), fixtureMeta())
    await runCli(['run', '--spec', file, '--go'], { api, bridge })

    const set = JSON.parse(readFileSync(path.join(out, 'set.json'), 'utf8'))
    const strip = set.strips[0]
    // The fixture is 2048×246 while the request said 4096×512 — an echo could
    // never produce `returned`.
    expect(strip.ok).toBe(true)
    expect(strip.state).toBe('idle')
    expect(strip.frame).toBe(0)
    expect(strip.requested).toBe('4096x512')
    expect(strip.returned).toBe('2048x246')
    expect(strip.fitted.spacing).toBe(255)
    expect(strip.fitted.phase).toBe(253)
    expect(strip.field.hex).toBe('#FD05FA')
    expect(strip.steps.keyed).toBe(8)
    expect(strip.steps.centred).toBe(8)
    expect(strip.seconds).toBeGreaterThan(0)
    expect(strip.prompt).toContain('cell 1 facing east')
    expect(set.backend.provider).not.toBe('')
    expect(set.backend.model).toBe(MODEL)
    expect(set.totals.calls).toBe(1)
    expect(set.totals.cells).toBe(8)
    expect(set.frames.length).toBe(8)
  })

  it('writes the raw reply, then one derived frame per direction in preset order', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out, states: ONE_STATE }))
    const api = stubApi(dataUrlFromFile(FIXTURE))
    const bridge = strictBridge(await frames(), fixtureMeta())
    await runCli(['run', '--spec', file, '--go'], { api, bridge })

    expect(readFileSync(path.join(out, 'raw/idle_f1_8dir.png'))).toEqual(readFileSync(FIXTURE))
    // Names come from Phase 2's frameFile and the set is exactly one file per
    // direction; `dirs` order IS the contract, so the ledger's own frame rows
    // (not the filesystem's lexicographic listing) prove the order.
    expect([...derivedNames(out)].sort()).toEqual(DIRS8.map((d) => `idle_f1_${d}.png`).sort())
    expect(derivedNames(out)).toContain('idle_f1_east.png')
    expect(derivedNames(out)).toContain('idle_f1_north-east.png')
    const set = JSON.parse(readFileSync(path.join(out, 'set.json'), 'utf8'))
    expect(set.frames.map((f) => f.dir)).toEqual(DIRS8)
    expect(set.frames.map((f) => f.file)).toEqual(DIRS8.map((d) => `derived/idle_f1_${d}.png`))
    expect(tempsIn(out)).toEqual([])
  })

  it('stops and books ok:false when the op refuses the strip', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out, states: ONE_STATE }))
    const api = stubApi(dataUrlFromFile(FIXTURE))
    const meta = { ...fixtureMeta(), ok: false, gutter: { ok: false, tolerance: 5, lines: [], unrescued: [2180] } }
    // The op answered ok:false but still handed frames back: the runner must
    // read the verdict, not the payload.
    const bridge = strictBridge(await frames(), meta)

    const payload = await runCli(['run', '--spec', file, '--go'], { api, bridge })

    expect(payload.strips[0].ok).toBe(false)
    expect(existsSync(path.join(out, 'raw/idle_f1_8dir.png'))).toBe(true)
    expect(derivedNames(out)).toEqual([])
    const set = JSON.parse(readFileSync(path.join(out, 'set.json'), 'utf8'))
    expect(set.strips[0].ok).toBe(false)
    expect(set.strips[0].returned).toBe('2048x246')
    expect(set.strips[0].fitted.gutterOk).toBe(false)
    expect(set.totals.calls).toBe(0)
  })

  it('stops and books ok:false when the op hands back the wrong number of cells', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out, states: ONE_STATE }))
    const api = stubApi(dataUrlFromFile(FIXTURE))
    const bridge = strictBridge((await frames()).slice(0, 7), fixtureMeta())

    const payload = await runCli(['run', '--spec', file, '--go'], { api, bridge })

    expect(payload.strips[0].ok).toBe(false)
    expect(derivedNames(out)).toEqual([])
  })
})

describe('ie anim — the spec', () => {
  it('reports the offending field and never calls out', async () => {
    const out = path.join(root, 'out')
    const apiCalls = { count: 0 }
    const serverCalls = { count: 0 }
    const states = [
      { name: 'idle', motion: 'a calm breathing idle', frames: 4, fps: 4, loop: true },
      { name: 'walk', motion: 'a mid-step of a heavy stalking walk', frames: 3, fps: 8, loop: true },
    ]
    const file = specFile(spec({ out, states }), 'uneven.json')

    await expect(runCli(['plan', '--spec', file], { apiCalls, serverCalls })).rejects.toMatchObject({
      code: 'bad_spec',
      detail: { field: 'states' },
    })
    expect(apiCalls.count).toBe(0)
    expect(serverCalls.count).toBe(0)
    expect(existsSync(out)).toBe(false)
  })

  it('refuses to let --spec and inline fields argue', async () => {
    const file = specFile(spec())
    await expect(runCli(['plan', '--spec', file, '--actor', 'chaser'])).rejects.toThrow(/only override/)
  })

  it('takes a spec from inline flags and reaches the same plan', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out }), 'file.json')
    const inline = [
      'plan',
      '--actor', 'chaser',
      '--subject', SUBJECT,
      '--states', JSON.stringify(HERO_STATES),
      '--dirs', 'dirs8',
      '--cell', '512',
      '--style', STYLE,
      '--out', out,
    ]
    const fromFile = await runCli(['plan', '--spec', file], { model: MODEL })
    const fromFlags = await runCli(inline, { model: MODEL })

    expect(fromFlags).toEqual(fromFile)
    expect(fromFile.model).toBe(MODEL)
  })

  it('lets --out override the spec, and writes there and nowhere else', async () => {
    const specOut = path.join(root, 'A')
    const override = path.join(root, 'B')
    const file = specFile(spec({ out: specOut, states: ONE_STATE }), 'one.json')

    const dry = await runCli(['plan', '--spec', file, '--out', override])
    expect(dry.out).toBe(override)
    expect(existsSync(specOut)).toBe(false)

    const api = stubApi(dataUrlFromFile(FIXTURE))
    const bridge = strictBridge(await frames(), fixtureMeta())
    const payload = await runCli(['run', '--spec', file, '--out', override, '--go'], { api, bridge })
    expect(existsSync(specOut)).toBe(false)
    expect(payload.written.every((p) => p.startsWith(override))).toBe(true)
  })

  it('resolves a relative --out before writing anything', async () => {
    const target = path.join(root, 'rel')
    const relative = path.relative(process.cwd(), target)
    const file = specFile(spec())

    const dry = await runCli(['plan', '--spec', file, '--out', relative])
    expect(dry.out).toBe(target)
    expect(path.isAbsolute(dry.out)).toBe(true)
    expect(existsSync(target)).toBe(false)
  })
})

describe('ie anim — the write path', () => {
  it('lets an unwritable raw/ fail loudly, with nothing half-written', async () => {
    const out = path.join(root, 'out')
    const file = specFile(spec({ out, states: ONE_STATE }), 'one.json')
    const api = stubApi(dataUrlFromFile(FIXTURE))
    const bridge = strictBridge(await frames(), fixtureMeta())

    // The first pass creates <out>/raw; making the directory read-only then
    // stops the atomic write from creating its sibling temp file.
    await runCli(['run', '--spec', file, '--go'], { api, bridge })
    const raw = path.join(out, 'raw')
    chmodSync(raw, 0o500)
    locked.push(raw)

    const before = derivedNames(out).length
    await expect(runCli(['run', '--spec', file, '--go'], { api, bridge })).rejects.toThrow()
    expect(tempsIn(out)).toEqual([])
    expect(derivedNames(out).length).toBe(before)
    expect(existsSync(path.join(out, 'raw/idle_f1_8dir.png'))).toBe(true)
  })
})
