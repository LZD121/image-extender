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
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
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
