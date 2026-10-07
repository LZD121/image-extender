/**
 * Bridge smoke test — the app's own pixel code, driven headlessly.
 *
 * No network, no API keys, no cost: every op here is local image math. It is the
 * regression net for the ops the studio commands compose, so a broken bundle,
 * a missing export or a changed option name fails before an agent spends money.
 *
 * Run: npm run test:cli
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { browserBundle } from '../bundle.mjs'
import { bridgeBatch } from '../../lib/bridge.mjs'

const REPO = path.resolve(import.meta.dirname, '..', '..', '..')
const FIXTURE = path.join(REPO, 'e2e/fixtures/assets/demo/tiles/sample/derived/body.png')

/** A magenta sheet with opaque blocks, the shape the AI sheet ops expect. */
async function synthSheet(file, { cols, rows, cell }) {
  const block = Math.max(8, Math.round(cell / 4))
  const overlays = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      overlays.push({
        input: {
          create: {
            width: block,
            height: block,
            channels: 4,
            background: { r: 40 + c * 8, g: 90 + r * 6, b: 60, alpha: 1 },
          },
        },
        left: c * cell + Math.round(cell / 4),
        top: r * cell + Math.round(cell / 4),
      })
    }
  }
  await sharp({
    create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } },
  })
    .composite(overlays)
    .png()
    .toFile(file)
  return file
}

/** Alpha census: how many pixels are fully opaque / fully transparent. */
async function alphaCensus(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opaque = 0
  let transparent = 0
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] === 0) transparent++
    else if (data[i] === 255) opaque++
  }
  return { opaque, transparent, total: info.width * info.height }
}

test('bridge ops, in one browser session', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ie-bridge-'))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const sheet8 = await synthSheet(path.join(dir, 'sheet-8x8.png'), { cols: 8, rows: 8, cell: 64 })
  const sheet42 = await synthSheet(path.join(dir, 'sheet-4x2.png'), { cols: 4, rows: 2, cell: 64 })
  const tileDir = path.join(dir, 'tiles')
  const sliceDir = path.join(dir, 'slice')
  await mkdir(tileDir, { recursive: true })

  const results = bridgeBatch([
    { op: 'chroma', opts: { preset: 'prop' }, inputs: [sheet42], out: [path.join(dir, 'chroma.png')] },
    { op: 'slice', opts: { cols: 4, rows: 2, cell: 64 }, inputs: [sheet42], outDir: sliceDir },
    { op: 'tile-guide', inputs: [], out: [path.join(dir, 'guide.png')] },
    { op: 'tile-extract', opts: { cell: 64 }, inputs: [sheet8], outDir: tileDir },
    { op: 'prop-sheet', opts: { cols: 4, rows: 2, cell: 64 }, inputs: [sheet42] },
    { op: 'pose-guide', opts: { cell: 128, cols: 4, rows: 2, anim: 'walk', bodyPlan: 'biped' }, inputs: [FIXTURE] },
    { op: 'expand-canvas', opts: { direction: 'right', percent: 38, maxDim: 512 }, inputs: [FIXTURE] },
    { op: 'tileable', opts: { axis: 'h' }, inputs: [FIXTURE] },
  ])
  assert.equal(results.length, 8, 'one result per job')

  await t.test('chroma keys the magenta out but keeps the art', async () => {
    const census = await alphaCensus(path.join(dir, 'chroma.png'))
    assert.ok(census.transparent > 0, `expected transparent pixels, got ${JSON.stringify(census)}`)
    assert.ok(census.opaque > 0, `expected surviving art pixels, got ${JSON.stringify(census)}`)
  })

  await t.test('slice writes cols×rows cells at the exact size', async () => {
    const written = results[1].written
    assert.equal(written.length, 8)
    for (const file of written) {
      const meta = await sharp(file).metadata()
      assert.equal(meta.width, 64)
      assert.equal(meta.height, 64)
    }
  })

  await t.test('tile-guide renders the 8×8 template at 512px cells', async () => {
    const meta = await sharp(path.join(dir, 'guide.png')).metadata()
    assert.equal(meta.width, 4096)
    assert.equal(meta.height, 4096)
  })

  await t.test('tile-extract produces the 13 roles plus their raw cells', async () => {
    const written = results[3].written
    assert.equal(results[3].meta.roles, 13)
    const derived = written.filter((f) => !f.includes(`${path.sep}raw${path.sep}`))
    const raw = written.filter((f) => f.includes(`${path.sep}raw${path.sep}`))
    assert.equal(derived.length, 13)
    assert.equal(raw.length, 13)
    const sizes = await Promise.all(derived.map(async (f) => sharp(f).metadata()))
    for (const meta of sizes) {
      assert.equal(meta.width, 64, 'role cells come out at the requested cell size')
      assert.equal(meta.height, 64)
    }
  })

  await t.test('prop-sheet returns one keyed+trimmed cell per grid cell', async () => {
    const cells = results[4].data
    assert.equal(cells.length, 8)
    for (const cell of cells) assert.ok(cell.startsWith('data:image/png;base64,'))
  })

  await t.test('pose-guide lays the rig out on a cols×rows grid', async () => {
    const buf = Buffer.from(results[5].data[0].split(',')[1], 'base64')
    const meta = await sharp(buf).metadata()
    assert.equal(meta.width, 512)
    assert.equal(meta.height, 256)
    assert.ok(results[5].meta.subject.height > 0, 'the anchor subject was measured')
  })

  await t.test('expand-canvas grows toward the direction and reports where', async () => {
    const buf = Buffer.from(results[6].data[0].split(',')[1], 'base64')
    const meta = await sharp(buf).metadata()
    assert.ok(meta.width > 64, `expected a wider canvas, got ${meta.width}`)
    assert.equal(meta.height, 64)
    assert.equal(results[6].meta.extensionInfo.direction, 'right')
    assert.ok(results[6].meta.extensionInfo.extensionRegion.width > 0, 'the new strip is reported')
  })

  await t.test('tileable returns a same-size image', async () => {
    const buf = Buffer.from(results[7].data[0].split(',')[1], 'base64')
    const meta = await sharp(buf).metadata()
    assert.equal(meta.width, 64)
    assert.equal(meta.height, 64)
  })

  await t.test('tile-preview and tile-sheet rebuild the sheet from role cells', async () => {
    const roles = ['tl_outer', 'top', 'tr_outer', 'tl_inner', 'left', 'body', 'right', 'tr_inner', 'bl_outer', 'bottom', 'br_outer', 'bl_inner', 'br_inner']
    const index = Object.fromEntries(roles.map((role, i) => [role, i]))
    const inputs = results[3].written
      .filter((f) => !f.includes(`${path.sep}raw${path.sep}`))
      .slice(0, roles.length)
    assert.equal(inputs.length, 13)
    const [preview, sheet] = bridgeBatch([
      { op: 'tile-preview', opts: { roles: index }, inputs },
      { op: 'tile-sheet', opts: { roles: index }, inputs },
    ])
    const previewMeta = await sharp(Buffer.from(preview.data[0].split(',')[1], 'base64')).metadata()
    assert.deepEqual({ w: previewMeta.width, h: previewMeta.height }, { w: 768, h: 768 })
    const sheetMeta = await sharp(Buffer.from(sheet.data[0].split(',')[1], 'base64')).metadata()
    assert.deepEqual({ w: sheetMeta.width, h: sheetMeta.height }, { w: 2048, h: 2048 })
    assert.equal(preview.meta.roles, 13)
    assert.equal(sheet.meta.roles, 13)
  })
})

// ── strip-frames, on the real delivered strip ────────────────────────────────
//
// The one place the smoke touches a stamp the model actually painted
// (`tests/fixtures/anim/chaser_idle_f1_8dir.png`, 2048x246). A synthetic magenta
// sheet cannot stand in for it: this strip's field is #FD05FA, not #FF00FF; its
// fit is 255/253, not 256/256; and one cut line (x=1528) really carries 246px of
// wash. Every claim about a frame below is read back out of the decoded RGBA —
// `meta` is what the implementation says, the pixels are what it did.

const STRIP_FIXTURE = path.join(REPO, 'tests/fixtures/anim/chaser_idle_f1_8dir.png')
const STRIP_RAW = path.join(REPO, '.ie/probe/chaser_idle_f1_8dir.png')
const DIRS8 = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east']

/** Decode one frame back to RGBA and count what is really in it. */
async function frameCensus(url) {
  const { data, info } = await sharp(Buffer.from(url.split(',')[1], 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3]
  let opaque = 0
  let partial = 0
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] === 0) continue
    if (data[i] === 255) opaque++
    else partial++
  }
  return {
    bytes: data.length,
    opaque,
    partial,
    corners: [
      alphaAt(0, 0),
      alphaAt(info.width - 1, 0),
      alphaAt(0, info.height - 1),
      alphaAt(info.width - 1, info.height - 1),
    ],
  }
}

test('strip-frames: one real strip to N frames, no baseline alignment', async (t) => {
  const jobs = [
    { op: 'strip-frames', opts: { cell: 512, dirs: DIRS8 }, inputs: [STRIP_FIXTURE] },
    { op: 'strip-frames', opts: { cell: 512, dirs: DIRS8, key: { castThreshold: 256 } }, inputs: [STRIP_FIXTURE] },
    { op: 'strip-frames', opts: { cell: 256, dirs: DIRS8 }, inputs: [STRIP_FIXTURE] },
    { op: 'strip-frames', opts: { cell: 512, dirs: DIRS8, preset: 'default' }, inputs: [STRIP_FIXTURE] },
  ]
  const hasRaw = existsSync(STRIP_RAW)
  if (hasRaw) jobs.push({ op: 'strip-frames', opts: { cell: 512, dirs: DIRS8 }, inputs: [STRIP_RAW] })

  const results = bridgeBatch(jobs)
  assert.equal(results.length, hasRaw ? 5 : 4, 'one result per job')
  const [ok, neverKeyed, small, defaultPreset, raw] = results

  const okCensus = []
  await t.test('the fixture becomes eight frames', async () => {
    assert.equal(ok.ok, true)
    assert.equal(ok.meta.ok, true, 'the occupied cut line is keyed wash, not the creature: the strip still succeeds')
    assert.equal(ok.data.length, 8)
    assert.deepEqual(ok.written, [], 'no out/outDir was given: nothing may land on disk')

    const meta = ok.meta
    assert.equal(meta.cells, 8)
    assert.equal(meta.cell, 512)
    assert.equal(meta.preset, 'binary')
    assert.equal(meta.dirs.join(','), DIRS8.join(','), 'the direction order is the caller contract')

    const fitted = meta.fitted
    assert.equal(fitted.spacing, 255, 'the pitch is searched for, not assumed to be 256')
    assert.equal(fitted.phase, 253)
    assert.equal(fitted.trials, 10496)
    assert.equal(fitted.medianMass, 167)
    assert.equal(fitted.residual, 246)
    assert.ok(
      Math.abs(fitted.residualPct - 0.079436) < 0.0005,
      `residualPct drifted: ${fitted.residualPct}`,
    )
    assert.equal(
      fitted.gutterOk,
      false,
      "the fit's verdict on the SOURCE profile says the grid is dirty — and the strip succeeds anyway, because the rescue is what decides",
    )
    assert.deepEqual(fitted.cutLines.map((line) => line.x), [508, 763, 1018, 1273, 1528, 1783, 2038])
    assert.deepEqual(fitted.cutLines.map((line) => line.mass), [0, 0, 0, 0, 246, 0, 0])

    assert.equal(meta.field.hex, '#FD05FA', 'the field is sampled off the corners, never assumed to be #FF00FF')
    assert.equal(meta.field.cast, 245)
    assert.equal(meta.field.preset, 'binary')

    assert.deepEqual(meta.windows[0], { x0: 0, x1: 253 }, 'the origin is normalised: neither a cell lost nor a cell clipped')
    assert.deepEqual(meta.windows[7], { x0: 1783, x1: 2038 })

    assert.equal(meta.gutter.ok, true)
    assert.equal(meta.gutter.tolerance, 3, 'round(167 x 0.02)')
    assert.deepEqual(meta.gutter.unrescued, [])
    assert.deepEqual(meta.gutter.lines.map((line) => line.keyed), [0, 0, 0, 0, 0, 0, 0])
    assert.deepEqual(meta.gutter.lines.map((line) => line.after), [0, 0, 0, 0, 0, 0, 0])

    assert.deepEqual(meta.counters, {
      keyed: 8,
      fieldSurvived: 0,
      borderTrimmed: 5,
      borderFailed: 0,
      isolated: 1,
      isolatedPx: 365,
      isolateFailed: 0,
      scaled: 0,
      centred: 8,
      empty: 0,
      rescued: 0,
    }, 'every best-effort step counts, and the ones that must have fired are non-zero')

    const cap = Math.floor(512 * 0.875)
    assert.equal(cap, 448)
    for (let i = 0; i < meta.frames.length; i++) {
      const frame = meta.frames[i]
      assert.equal(frame.index, i)
      assert.equal(frame.dir, DIRS8[i])
      assert.ok(
        Math.abs(frame.scale - Math.min(1, cap / Math.max(frame.bbox.w, frame.bbox.h))) < 1e-9,
        `frame ${i}: scale ${frame.scale} is not the 87.5% rule`,
      )
      assert.equal(frame.out.w, Math.round(frame.bbox.w * frame.scale))
      assert.equal(frame.out.h, Math.round(frame.bbox.h * frame.scale))
      assert.equal(frame.out.x, Math.round((512 - frame.out.w) / 2))
      assert.equal(frame.out.y, Math.round((512 - frame.out.h) / 2))

      const census = await frameCensus(ok.data[i])
      assert.equal(census.bytes, 512 * 512 * 4, `frame ${i} is not exactly 512x512`)
      assert.deepEqual(census.corners, [0, 0, 0, 0], `frame ${i} has an opaque corner: keying missed the field`)
      assert.equal(census.partial, 0, `frame ${i} carries ${census.partial} translucent pixels; binary keying leaves none`)
      assert.ok(census.opaque > 10000, `frame ${i} has only ${census.opaque} content pixels`)
      okCensus.push(census)
    }

    const first = meta.frames[0]
    const last = meta.frames[7]
    assert.deepEqual([first.bbox.w, first.bbox.h], [243, 204])
    assert.deepEqual([first.out.w, first.out.h, first.out.x, first.out.y], [243, 204, 135, 154])
    assert.deepEqual([last.bbox.w, last.bbox.h], [242, 246])
    assert.deepEqual([last.out.w, last.out.h, last.out.x, last.out.y], [242, 246, 135, 133])

    const narrowest = Math.min(...meta.frames.map((frame) => frame.margins.l))
    assert.ok(
      narrowest >= 131,
      `the narrowest left margin is ${narrowest}px; the 512 arm measured 131 (its construction floor, cell/16, is 32 — far looser)`,
    )

    const bottoms = new Set(meta.frames.map((frame) => frame.margins.b))
    assert.ok(
      bottoms.size >= 3,
      `all eight frames share ${bottoms.size} distinct bottom margins — baseline alignment would pin every cell to one floor and lose content; centring lets each box height show through`,
    )
  })

  await t.test('a key that removes nothing fails the strip', async () => {
    assert.equal(neverKeyed.meta.ok, false, 'castThreshold 256 keys nothing, so the strip must not pass')
    assert.equal(neverKeyed.data.length, 0, 'no half a set: zero frames, the raw strip stays')
    assert.equal(neverKeyed.meta.counters.fieldSurvived, 8, 'the second gate is the one that catches it')
    assert.deepEqual(
      neverKeyed.meta.gutter.lines.map((line) => line.keyed),
      [246, 246, 246, 246, 246, 246, 246],
      'the field colour survived untouched in every sampled edge column',
    )
    assert.deepEqual(
      neverKeyed.meta.gutter.lines.map((line) => line.after),
      [0, 0, 0, 0, 0, 0, 0],
      'yet the first gate reads a clean gutter: removeFrameBorder blanks the very edge columns it samples, so a gate without fieldSurvived would pass a solid magenta strip',
    )
  })

  const smallCensus = []
  await t.test('cell 256 makes the 87.5% box bite', async () => {
    const meta = small.meta
    assert.equal(meta.ok, true)
    assert.equal(meta.counters.scaled, 7, 'seven of eight boxes exceed floor(256 x 0.875) = 224')
    assert.equal(meta.counters.fieldSurvived, 0, 'same strip, same keying, whatever the cell')
    assert.equal(meta.counters.isolated, 1)
    assert.equal(meta.counters.borderTrimmed, 5)

    const cap = Math.floor(256 * 0.875)
    assert.equal(cap, 224)
    for (let i = 0; i < meta.frames.length; i++) {
      const frame = meta.frames[i]
      assert.ok(
        Math.max(frame.out.w, frame.out.h) <= cap,
        `frame ${i} is ${frame.out.w}x${frame.out.h}: the 87.5% box of a 256 cell is 224`,
      )
      assert.ok(
        Math.min(frame.margins.l, frame.margins.r, frame.margins.t, frame.margins.b) >= 16,
        `frame ${i} leaves less than frameMarginFloor(256) = 16 — note 131 belongs to the 512 arm, not this one`,
      )
      const census = await frameCensus(small.data[i])
      assert.equal(census.bytes, 256 * 256 * 4)
      assert.deepEqual(census.corners, [0, 0, 0, 0])
      smallCensus.push(census)
    }

    const first = meta.frames[0]
    const last = meta.frames[7]
    assert.deepEqual([first.bbox.w, first.bbox.h], [243, 204])
    assert.deepEqual([first.out.w, first.out.h, first.out.x, first.out.y], [224, 188, 16, 34])
    assert.ok(Math.abs(first.scale - 224 / 243) < 1e-9)
    assert.deepEqual([last.out.w, last.out.h, last.out.x, last.out.y], [220, 224, 18, 16])

    // The interpolation trap only closes here: seven frames are really rescaled,
    // so a smoothing rescale would show up. On the 512 arm every scale is 1 and
    // the same assertion would prove nothing.
    assert.equal(
      smallCensus.reduce((n, census) => n + census.partial, 0),
      0,
      'a nearest-neighbour rescale leaves no half-alpha; with imageSmoothingEnabled = true these eight frames carry 7414 translucent pixels',
    )
  })

  await t.test('the default preset leaves a translucent film, binary does not', async () => {
    let film = 0
    for (let i = 0; i < defaultPreset.data.length; i++) film += (await frameCensus(defaultPreset.data[i])).partial
    assert.ok(
      film > 1000,
      `the default preset left ${film} translucent pixels on this strip; its soft edge is real, and it is what binary exists to remove`,
    )
    assert.equal(
      defaultPreset.meta.counters.isolated,
      0,
      'this strip needs no rescue under default either — so the success arm\'s isolated:1 is not background noise',
    )
    assert.equal(
      okCensus.reduce((n, census) => n + census.partial, 0),
      0,
      'binary is exactly 0 where default is thousands: D-23 has a counted, visible consequence',
    )
  })

  await t.test(
    'the gitignored raw strip fails on the one line it really occupies',
    { skip: hasRaw ? false : 'raw strip is gitignored (.ie/probe)' },
    async () => {
      const meta = raw.meta
      assert.equal(meta.ok, false)
      assert.equal(raw.data.length, 0)
      assert.equal(meta.fitted.spacing, 360, 'the same search over a 2928px strip gives a different lattice')
      assert.equal(meta.fitted.phase, 20)
      assert.equal(meta.fitted.trials, 21594)
      assert.equal(meta.fitted.medianMass, 239)
      assert.equal(meta.fitted.residual, 352)
      assert.equal(meta.fitted.gutterOk, false)
      assert.equal(meta.field.hex, '#FC06FA', 'a different strip, a different sampled field')
      assert.equal(meta.windows[0].x0, 20)
      assert.deepEqual(
        meta.gutter.unrescued,
        [2180],
        'that line survives the rescue: its 58px are the creature itself, not a neighbour reaching in',
      )
      assert.equal(
        meta.counters.isolatedPx,
        883,
        'the rescue did run and did cut pixels — it just cannot win this one, which is why the verdict is ok:false rather than another rescue',
      )
    },
  )

  await t.test('no baseline alignment anywhere in the chain', async () => {
    const forbidden = ['alignSpriteFramesToBaseline', 'normalizeSpriteFrameScale']
    const why = 'it pins every cell to one shared floor (losing content on top-down views) / it resamples pixel art into mush'
    const framesSrc = await readFile(path.join(REPO, 'app/lib/animFrames.ts'), 'utf8')
    for (const name of forbidden) {
      assert.equal(
        framesSrc.split(name).length - 1,
        0,
        `app/lib/animFrames.ts names ${name}: ${why}`,
      )
    }
    assert.equal(
      framesSrc.split('FRAME_FILL = 0.875').length - 1,
      1,
      'the 87.5% ratio must be declared exactly once',
    )

    const bridgeSrc = await readFile(path.join(REPO, 'cli/native/bridge.mjs'), 'utf8')
    const start = bridgeSrc.indexOf("case 'strip-frames'")
    const body = bridgeSrc.slice(start, bridgeSrc.indexOf("case '", start + 1))
    assert.ok(body.length >= 200, 'the strip-frames case body could not be sliced out — an empty string must never pass this')
    for (const name of forbidden) {
      assert.ok(!body.includes(name), `the strip-frames case body calls ${name}: ${why}`)
    }

    // The op is only reachable if the chain made it into the IIFE the page gets:
    // `page.evaluate` serializes function source, so a module outside
    // BROWSER_IMPORTS is invisible in the browser. force:true because the cache
    // is keyed on source mtime — a stale bundle already hoists planStripFrames
    // into the IIFE scope, so a pin against it would pass while the real chain
    // was gone. The arms above ran through this same bundle, so they cover the
    // behaviour; this covers the pin.
    const bundle = await readFile(browserBundle({ force: true }), 'utf8')
    for (const pin of ['planStripFrames', 'frameMarginFloor', 'fitBox', '0.875']) {
      assert.ok(bundle.includes(pin), `the browser bundle does not carry ${pin}`)
    }
  })
})
