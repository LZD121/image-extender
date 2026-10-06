#!/usr/bin/env node
/**
 * bridge.mjs — run image-extender's OWN client-side image code, headlessly.
 *
 * The browser app does every pixel transform (chroma key, slicing, tileability,
 * Poisson seam blending, corner reconciliation, sprite pose rigs, frame
 * alignment) in TypeScript under `app/utils/` and `app/lib/`. This bridge:
 *   1. bundles those modules into one IIFE with esbuild,
 *   2. launches a headless Chromium via playwright-core,
 *   3. injects the bundle and calls the app's own exported functions.
 *
 * Generation is NOT here: that goes through the real dev server (`ie serve`),
 * so prompt engineering and provider config stay server-side. This process only
 * does pixel math — no network, no API keys.
 *
 * Protocol: one JSON job spec on argv[2] (or stdin) in, one JSON result on
 * stdout out. File I/O happens in Node; the pixels happen in the browser.
 *
 * `page.evaluate` serializes only the function source, so everything the page
 * program needs (including its tuning constants) lives INSIDE PAGE_PROGRAM.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserBundle } from './bundle.mjs'
import { CHROMIUM_INSTALL_HINT, IE_DIR, REPO_ROOT, findChromium } from './deps.mjs'

function dataUrlFromFile(p) {
  const ext = path.extname(p).toLowerCase()
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,` + readFileSync(p).toString('base64')
}

function writeDataUrl(dataUrl, outPath) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, Buffer.from(b64, 'base64'))
}

/** In-page program. Runs inside Chromium with `window.IE` = the app's modules. */
const PAGE_PROGRAM = async (job) => {
  const IE = window.IE
  const out = { data: [], files: {}, meta: {} }
  const opts = job.opts || {}
  const IN = job.inputs

  /**
   * The app's own chroma tunings and tile export names. Both used to be copies
   * here (only a human kept them in step); the bundle already carries the
   * modules that own them, so the bridge reads them from there.
   */
  const CHROMA = IE.CHROMA_PRESETS
  const ROLE_FILE = Object.fromEntries(IE.TILESET_SLOTS.map((slot) => [slot.role, slot.fileName]))

  const load = (durl) =>
    new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('image load failed'))
      i.src = durl
    })
  const canvasOf = (w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  const toUrl = (c) => c.toDataURL('image/png')
  /** Re-apply the role mask so a keyed tile keeps only its autotile region. */
  const roleMask = async (role, durl) => {
    if (role === 'body') return durl
    const img = await load(durl)
    const c = canvasOf(img.width, img.height)
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const id = ctx.getImageData(0, 0, img.width, img.height)
    IE.applyFeatheredRoleMask(id.data, img.width, img.height, role, Math.round(img.width / 4), Math.round(img.height / 4))
    ctx.putImageData(id, 0, 0)
    return toUrl(c)
  }
  /** The app's tile post-processing, role by role (mirrors page.tsx). */
  const postTile = async (role, raw, cell) => {
    if (role === 'body') {
      const d = await IE.chromaKeyToAlpha(raw, CHROMA.despill)
      return IE.makeTileable2D(d, {
        equalizeStrength: 1,
        blendWidthPx: Math.round(cell * 0.22),
        verticalBlendHeightPx: Math.round(cell * 0.22),
      })
    }
    if (role === 'top' || role === 'bottom') {
      const t = await IE.makeHorizontallyTileable(raw)
      return roleMask(role, await IE.chromaKeyToAlpha(t, CHROMA.tile))
    }
    if (role === 'left' || role === 'right') {
      const t = await IE.makeVerticallyTileable(raw)
      return roleMask(role, await IE.chromaKeyToAlpha(t, CHROMA.tile))
    }
    return roleMask(role, await IE.chromaKeyToAlpha(raw, CHROMA.tile))
  }
  const hasSplitMass = (profile) => {
    const peak = Math.max(...profile)
    if (peak <= 0) return false
    const occ = peak * 0.06
    const minGap = Math.max(3, Math.round(profile.length * 0.05))
    const segs = []
    let cur = null
    let gap = 0
    for (let i = 0; i < profile.length; i++) {
      if (profile[i] > occ) {
        if (cur === null) {
          segs.push(0)
          cur = segs.length - 1
        }
        segs[cur] += profile[i]
        gap = 0
      } else if (cur !== null) {
        gap++
        if (gap >= minGap) cur = null
      }
    }
    if (segs.length < 2) return false
    segs.sort((a, b) => b - a)
    return segs[1] >= segs[0] * 0.45
  }
  /** A frame that reads as two disconnected masses (torn-apart limbs). */
  const duplicateFlag = async (durl) => {
    const n = 100
    const img = await load(durl)
    const c = canvasOf(n, n)
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, n, n)
    ctx.drawImage(img, 0, 0, n, n)
    const d = ctx.getImageData(0, 0, n, n).data
    const col = new Array(n).fill(0)
    const row = new Array(n).fill(0)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const a = d[(y * n + x) * 4 + 3]
        col[x] += a
        row[y] += a
      }
    return hasSplitMass(col) || hasSplitMass(row)
  }
  /** Role images named by `opts.roles` → one image per role, as data URLs. */
  const roleImages = () => {
    const byRole = {}
    for (const [role, index] of Object.entries(opts.roles || {})) {
      if (typeof index === 'number' && IN[index]) byRole[role] = IN[index]
    }
    return byRole
  }

  switch (job.op) {
    case 'chroma': {
      let u = await IE.chromaKeyToAlpha(IN[0], CHROMA[opts.preset || 'default'])
      if (opts.role) u = await roleMask(opts.role, u)
      out.data.push(u)
      break
    }
    case 'prop-sheet': {
      // A whole props batch end to end, exactly as page.tsx does it: slice the
      // sheet, key each cell's magenta, then trim the dark cell-edge band the
      // model likes to paint. A failed trim keeps the keyed cell.
      const cell = opts.cell || 512
      const cells = await IE.sliceImageGrid(IN[0], { cols: opts.cols, rows: opts.rows, cellSize: cell })
      for (const raw of cells) {
        const keyed = await IE.chromaKeyToAlpha(raw, CHROMA.prop)
        try {
          out.data.push(await IE.removeFrameBorder(keyed))
        } catch (e) {
          out.meta.borderFailed = (out.meta.borderFailed || 0) + 1
          out.data.push(keyed)
        }
      }
      out.meta.count = out.data.length
      break
    }
    case 'slice': {
      const cells = await IE.sliceImageGrid(IN[0], { cols: opts.cols, rows: opts.rows, cellSize: opts.cell })
      out.data = cells
      out.meta.count = cells.length
      break
    }
    case 'tileable': {
      const key = opts.keyMagenta ? { r: 255, g: 0, b: 255, threshold: 80 } : undefined
      let u
      if (opts.axis === 'h') u = await IE.makeHorizontallyTileable(IN[0], { ignoreKeyColor: key })
      else if (opts.axis === 'v') u = await IE.makeVerticallyTileable(IN[0], { ignoreKeyColor: key })
      else u = await IE.makeTileable2D(IN[0], { ignoreKeyColor: key })
      out.data.push(u)
      break
    }
    case 'tile-guide': {
      out.data.push(IE.buildTileSheetGuideDataUrl())
      break
    }
    case 'tile-extract': {
      const cell = opts.cell || IE.TILESET_TILE_SIZE
      let sheetUrl = IN[0]
      if (opts.align !== false) {
        try {
          sheetUrl = await IE.alignAiOutputToTemplate(sheetUrl)
        } catch (e) {
          out.meta.alignFailed = true
        }
      }
      const cells = await IE.sliceImageGrid(sheetUrl, { cols: 8, rows: 8, cellSize: cell })
      const samples = IE.TILE_TEMPLATE_SAMPLES
      const byRole = {}
      for (const role of Object.keys(samples)) {
        const { col, row } = samples[role]
        const raw = cells[row * 8 + col]
        out.files[`raw/${ROLE_FILE[role]}.png`] = raw
        byRole[role] = opts.post === false ? raw : await postTile(role, raw, cell)
      }
      let reconciled = byRole
      try {
        reconciled = await IE.reconcileAllCorners(byRole)
      } catch (e) {
        out.meta.reconcileFailed = true
      }
      for (const [role, url] of Object.entries(reconciled)) out.files[`${ROLE_FILE[role]}.png`] = url
      out.meta.roles = Object.keys(reconciled).length
      break
    }
    case 'tile-preview': {
      // The QA critic's input: the app's own platform preview — the 13 tiles
      // placed by the autotile role map over a sky gradient, downscaled to 96px
      // cells (exactly what page.tsx hands /api/tile-review).
      const CELL = 96
      const cols = IE.TILE_TEMPLATE_COLS
      const rows = IE.TILE_TEMPLATE_ROWS
      const c = canvasOf(cols * CELL, rows * CELL)
      const ctx = c.getContext('2d')
      const g = ctx.createLinearGradient(0, 0, 0, c.height)
      g.addColorStop(0, '#8cc3eb')
      g.addColorStop(1, '#28466e')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      const byRole = roleImages()
      const placed = {}
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const role = IE.templateRoleForCell(x, y)
          if (!role || !byRole[role] || placed[role]) continue
          placed[role] = true
          const img = await load(byRole[role])
          ctx.drawImage(img, x * CELL, y * CELL, CELL, CELL)
        }
      }
      out.data.push(toUrl(c))
      out.meta.roles = Object.keys(placed).length
      break
    }
    case 'tile-sheet': {
      // The raw 4×4 atlas (512px cells) the library stores as raw/sheet.png.
      const byRole = roleImages()
      const c = canvasOf(IE.TILESET_SHEET_W, IE.TILESET_SHEET_H)
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      let placed = 0
      for (const spec of IE.TILESET_SLOTS) {
        const url = byRole[spec.role]
        if (!url) continue
        const img = await load(url)
        ctx.drawImage(img, spec.col * IE.TILESET_TILE_SIZE, spec.row * IE.TILESET_TILE_SIZE, IE.TILESET_TILE_SIZE, IE.TILESET_TILE_SIZE)
        placed++
      }
      out.data.push(toUrl(c))
      out.meta.roles = placed
      break
    }
    case 'sprite-align': {
      let cells
      if (opts.cols && opts.rows) {
        cells = await IE.sliceImageGrid(IN[0], { cols: opts.cols, rows: opts.rows, cellSize: opts.cell })
      } else {
        cells = IN.slice()
      }
      if (!opts.keyed) {
        const cleaned = []
        for (const cell of cells) {
          let u = await IE.chromaKeyToAlpha(cell)
          try {
            u = await IE.removeFrameBorder(u)
          } catch (e) {
            /* keep the un-cropped frame */
          }
          if (opts.bodyPlan && opts.bodyPlan !== 'biped') {
            const enableSplit = opts.bodyPlan === 'quadruped' || opts.bodyPlan === 'blob'
            try {
              u = await IE.isolatePrimarySpriteComponent(u, { enableSplit })
            } catch (e) {
              /* keep the original frame */
            }
          }
          cleaned.push(u)
        }
        cells = cleaned
      }
      const scaled = await IE.normalizeSpriteFrameScale(cells, { tolerance: 0.05, maxScaleAdjust: 0.18 })
      const aligned = await IE.alignSpriteFramesToBaseline(scaled.cells, {
        groundAll: !opts.airborne,
        targetBaseline: Math.round(opts.cell * (opts.baselineFrac || 0.9)),
      })
      const centered = await IE.centerSpriteFramesHorizontally(aligned.cells, { mode: 'cellCenter' })
      const flagged = []
      for (let i = 0; i < centered.cells.length; i++) {
        if (await duplicateFlag(centered.cells[i])) flagged.push(i)
      }
      centered.cells.forEach((u, i) => {
        out.files[`frame_${String(i).padStart(2, '0')}.png`] = u
      })
      out.meta = {
        count: centered.cells.length,
        duplicateFrames: flagged,
        targetSize: scaled.targetSize,
        sizes: scaled.sizes,
        scales: scaled.scales,
        baseline: aligned.targetBaseline,
        detectedBottoms: aligned.detected,
        baselineShifts: aligned.shifted,
        centroidsX: centered.detected,
      }
      break
    }
    case 'pose-guide': {
      // The app's deterministic skeletal pose map: measure the subject in the
      // anchor frame, then draw one mannequin per frame via the body-plan rig.
      const S = opts.cell || 512
      const anchor = await load(IN[0])
      const measureCanvas = canvasOf(S, S)
      const mx = measureCanvas.getContext('2d')
      mx.drawImage(anchor, 0, 0, S, S)
      const measured = IE.measureSubjectBounds(mx.getImageData(0, 0, S, S).data, S, S)
      const subject = measured || { height: Math.round(S * 0.78), centerX: S / 2, baseline: Math.round(S * 0.92) }
      const cols = opts.cols || 4
      const rows = opts.rows || 2
      const c = canvasOf(cols * S, rows * S)
      IE.drawPoseGuideSheet(c.getContext('2d'), {
        anim: opts.anim || 'walk',
        bodyPlan: opts.bodyPlan || 'biped',
        cols,
        rows,
        cellSize: S,
        frameCount: cols * rows,
        subject,
      })
      out.data.push(toUrl(c))
      out.meta.subject = subject
      break
    }
    case 'expand-canvas': {
      const res = await IE.createFullContextExtension(IN[0], opts.direction, opts.percent, opts.refDims, opts.maxDim || 1536)
      out.data.push(res.fullImageWithBlankArea)
      out.meta.extensionInfo = res.extensionInfo
      break
    }
    case 'create-chunked': {
      const res = await IE.createChunkedExtension(
        IN[0],
        opts.direction,
        opts.percent,
        opts.overlapPercent,
        opts.refDims,
        opts.maxDim || 1536
      )
      out.data.push(res.chunkToExtend)
      out.meta.chunkInfo = res.chunkInfo
      break
    }
    case 'apply-full-context': {
      out.data.push(await IE.applyFullContextResult(IN[0], opts.extensionInfo, IN[1]))
      break
    }
    case 'stitch-chunk': {
      out.data.push(await IE.stitchExtendedChunk(IN[0], IN[1], opts.chunkInfo, !!opts.debug))
      break
    }
    case 'measure-seam': {
      out.meta.score = await IE.measureSeamResidual(IN[0], opts.extensionInfo, IN[1])
      break
    }
    case 'extend-finalize': {
      // The horizontal extend pipeline's tail: reject an AI result that never
      // filled the extension region, else Poisson-blend it into the source and
      // score the seam. One op because both steps share their inputs, and an
      // attempt costs a browser round trip.
      if (await IE.isAiExtensionUnfilled(IN[1], opts.extensionInfo)) {
        out.meta.unfilled = true
        break
      }
      const blended = await IE.applyFullContextResult(IN[1], opts.extensionInfo, IN[0])
      out.data.push(blended)
      out.meta.score = await IE.measureSeamResidual(blended, opts.extensionInfo, IN[0])
      break
    }
    default:
      throw new Error('unknown op: ' + job.op)
  }
  return out
}

/** Collect what one job produced, writing every image the job carries. */
function collect(job, res) {
  const outDir = job.outDir || path.join(IE_DIR, 'bridge-out')
  const written = []
  const leftover = []
  for (let i = 0; i < res.data.length; i++) {
    const target = (job.out && job.out[i]) || null
    if (target) {
      writeDataUrl(res.data[i], target)
      written.push(target)
    } else {
      leftover.push(res.data[i])
    }
  }
  if (leftover.length && job.outDir) {
    leftover.forEach((u, i) => {
      const target = path.join(outDir, `cell_${String(i).padStart(2, '0')}.png`)
      writeDataUrl(u, target)
      written.push(target)
    })
    leftover.length = 0
  }
  for (const [rel, url] of Object.entries(res.files || {})) {
    const target = path.join(outDir, rel)
    writeDataUrl(url, target)
    written.push(target)
  }
  // Images with no destination travel back as data URLs: a studio pass chains
  // one op's output straight into the next request instead of a temp file.
  return { ok: true, meta: res.meta, written, data: leftover }
}

/**
 * Run jobs back to back in ONE browser. Launching Chromium (~1s) per op is the
 * dominant cost of a studio pass, so a command that needs four ops sends four
 * jobs in one call.
 */
export async function runJobs(jobs) {
  const bundle = browserBundle()
  const exe = findChromium()
  const { chromium } = await import('playwright-core')
  let browser
  try {
    browser = exe ? await chromium.launch({ executablePath: exe }) : await chromium.launch()
  } catch (e) {
    throw new Error(`could not launch Chromium (${e.message}). Install one with:\n  ${CHROMIUM_INSTALL_HINT}`)
  }
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')
    await page.addScriptTag({ path: bundle })
    const results = []
    for (const job of jobs) {
      const inputs = (job.inputs || []).map((v) => (String(v).startsWith('data:') ? String(v) : dataUrlFromFile(v)))
      const res = await page.evaluate(PAGE_PROGRAM, { op: job.op, opts: job.opts || {}, inputs })
      results.push(collect(job, res))
    }
    return results
  } finally {
    await browser.close()
  }
}

export async function runJob(job) {
  return (await runJobs([job]))[0]
}

/** `ie doctor` needs to know the bundle and the browser are present, cheaply. */
export function nativeStatus() {
  const bundle = browserBundle()
  return { repo: REPO_ROOT, bundle, bundleBytes: statSync(bundle).size, chromium: findChromium() }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  try {
    const specPath = process.argv[2]
    const spec = JSON.parse(specPath ? readFileSync(specPath, 'utf8') : readFileSync(0, 'utf8'))
    if (spec.op === 'doctor') {
      process.stdout.write(JSON.stringify({ ok: true, ...nativeStatus() }) + '\n')
    } else if (Array.isArray(spec.jobs)) {
      // One browser for a whole pass: `results[i]` answers `jobs[i]`.
      process.stdout.write(JSON.stringify({ ok: true, results: await runJobs(spec.jobs) }) + '\n')
    } else {
      process.stdout.write(JSON.stringify(await runJob(spec)) + '\n')
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n')
    process.exit(1)
  }
}
