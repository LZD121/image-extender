// app/lib/animFrames.ts
/**
 * One strip in, N frames out — the only implementation.
 *
 * Why it lives in `app/lib`: the CLI's bridge op (`strip-frames`) and the studio
 * UI both have to produce the SAME frames (spec §4 / POST-04). `chromaPresets.ts`
 * already records what a second private copy costs — `bridge.mjs` carried one
 * until a human was the only thing keeping them in step.
 *
 * Why it is a browser-side module: every step below is canvas work, and the CLI
 * reaches it through `BROWSER_IMPORTS` -> `window.IE`. `page.evaluate` serializes
 * only the function source, so anything defined in the bridge's own module scope
 * is invisible to the page.
 *
 * The chain is spec §7, in this order and no other: panel fit -> chroma key ->
 * border strip -> component isolation -> trim to the alpha box -> scale into
 * `FRAME_FILL` of the cell -> centre. Two steps are deliberately absent:
 * snapping every cell to one shared ground line (it plants top-down and
 * bottom-up cells on the same floor and throws content away) and a resampled
 * rescale (it smears pixel art). Both are written out in words here on purpose,
 * so an identifier-level scan of this file stays a real check.
 *
 * The 87.5% box is not a taste call: the consumers' own sheet builder packs 56px
 * of content into a 64px cell (`dark-black/tools/build_handpainted_sheets.py`).
 */
import { CHROMA_PRESETS, type ChromaKeyOptions, type ChromaPreset } from '@/app/lib/chromaPresets'
import { GUTTER_RATIO, columnProfile, fitPanelGrid, magentaCast, sampleFieldRgb } from '@/app/lib/animStrip'
import { chromaKeyToAlpha, isolatePrimarySpriteComponent, removeFrameBorder } from '@/app/utils/imageProcessor'

/** Content may fill this fraction of the cell; the rest is margin (see header). */
export const FRAME_FILL = 0.875

/** The alpha above which a pixel counts as content when trimming to the box. */
const CONTENT_ALPHA = 32

/**
 * The smallest margin the 87.5% rule can leave on one side. A construction
 * guarantee, not a measurement: the real strips land far better (131px on the
 * 512 cell) because content is never square.
 */
export function frameMarginFloor(cell: number): number {
  if (!Number.isInteger(cell) || cell < 1) throw new Error(`cell must be a positive integer, got ${cell}`)
  return Math.floor((cell * (1 - FRAME_FILL)) / 2)
}

/**
 * Where a `bw × bh` alpha box lands inside a `cell × cell` frame: the uniform
 * scale into the 87.5% box (never up — upscaling would resample), the rounded
 * content size, and the centring offset. Pure arithmetic, no canvas, so it can
 * be asserted anywhere.
 */
export function fitBox(
  box: { bw: number; bh: number },
  cell: number,
  fill: number = FRAME_FILL
): { scale: number; w: number; h: number; x: number; y: number } {
  if (!Number.isInteger(cell) || cell < 1) throw new Error(`cell must be a positive integer, got ${cell}`)
  if (!Number.isFinite(box.bw) || !Number.isFinite(box.bh) || box.bw <= 0 || box.bh <= 0) {
    throw new Error(`box must be positive, got ${box.bw}x${box.bh}`)
  }
  if (!(fill > 0 && fill <= 1)) throw new Error(`fill must be in (0, 1], got ${fill}`)
  const cap = Math.floor(cell * fill)
  const scale = Math.min(1, cap / Math.max(box.bw, box.bh))
  const w = Math.max(1, Math.round(box.bw * scale))
  const h = Math.max(1, Math.round(box.bh * scale))
  return { scale, w, h, x: Math.round((cell - w) / 2), y: Math.round((cell - h) / 2) }
}

export type StripFramesOptions = {
  /** Output order, one entry per frame. Required and non-empty. */
  dirs: readonly string[]
  /** Edge length of the square frames. Default 512. */
  cell?: number
  /** How many cells the fit looks for. Default `dirs.length`. */
  cells?: number
  /** Name from `CHROMA_PRESETS`. Default 'binary'. An unknown name throws. */
  preset?: string
  /** Fit window overrides — how hard `fitPanelGrid` searches and how clean a cut must be. */
  fit?: { spanPct?: number; gutterRatio?: number }
  /** Explicit threshold override, on top of the preset. */
  key?: Partial<ChromaKeyOptions>
  /** Content fraction of the cell. Default `FRAME_FILL`. */
  fill?: number
  /** Border-strip knobs, forwarded to `removeFrameBorder`. */
  border?: { coverage?: number; bandFraction?: number; alphaThreshold?: number }
}

export type StripFramesMeta = {
  ok: boolean
  cells: number
  cell: number
  preset: string
  dirs: string[]
  /** The fit that cut the strip. `cutLines[].mass` is the SOURCE-profile mass. */
  fitted: {
    spacing: number
    phase: number
    residual: number | null
    residualPct: number | null
    medianMass: number
    trials: number
    /** The fit's own confidence in the source profile — provenance, not the verdict. */
    gutterOk: boolean
    cutLines: { x: number; mass: number | null }[]
  }
  /** The field, sampled off the corners — never assumed to be pure magenta. */
  field: { rgb: [number, number, number]; hex: string; cast: number; preset: string }
  windows: { x0: number; x1: number }[]
  /** The verdict: occupancy at each interior cut AFTER the rescue, in alpha pixels. */
  gutter: {
    ok: boolean
    tolerance: number
    lines: { x: number; keyed: number; after: number }[]
    unrescued: number[]
  }
  /** One integer per best-effort step, so a silent no-op is visible. */
  counters: Record<string, number>
  frames: {
    index: number
    dir: string
    window?: { x0: number; x1: number }
    bbox?: { x: number; y: number; w: number; h: number }
    scale?: number
    out?: { w: number; h: number; x: number; y: number }
    margins?: { l: number; r: number; t: number; b: number }
    content?: number
  }[]
}

/** The eleven step counters, all present from the start (a missing key is not a zero). */
const COUNTER_KEYS = [
  'keyed',
  'fieldSurvived',
  'borderTrimmed',
  'borderFailed',
  'isolated',
  'isolatedPx',
  'isolateFailed',
  'scaled',
  'centred',
  'empty',
  'rescued',
]

/**
 * `CHROMA_PRESETS` is `as const`, so a `string` index is a TS7053. The obvious
 * workarounds — a cast, or a nullish fallback to the `default` entry — all turn a
 * typo into a silent pure-magenta key. Check, then throw: the bridge turns that
 * into `ok:false` and the CLI can say which name was wrong.
 */
function resolvePreset(name: string): ChromaPreset {
  const preset = (CHROMA_PRESETS as Record<string, ChromaPreset | undefined>)[name]
  if (!preset) throw new Error(`unknown chroma preset: ${name}`)
  return preset
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const { promise, resolve, reject } = Promise.withResolvers<HTMLImageElement>()
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => resolve(img)
  img.onerror = () => reject(new Error('strip-frames: image load failed'))
  img.src = url
  return promise
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('strip-frames: no 2d context')
  return ctx
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

/** The alpha plane of a data URL, plus the decoded image so callers can redraw it. */
async function alphaOf(
  url: string
): Promise<{ img: HTMLImageElement; alpha: Uint8ClampedArray; w: number; h: number }> {
  const img = await loadImage(url)
  const ctx = context2d(canvasOf(img.width, img.height))
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data
  const alpha = new Uint8ClampedArray(img.width * img.height)
  for (let p = 0; p < alpha.length; p++) alpha[p] = data[p * 4 + 3]
  return { img, alpha, w: img.width, h: img.height }
}

function opaqueInColumn(alpha: Uint8ClampedArray, w: number, h: number, x: number): number {
  let count = 0
  for (let y = 0; y < h; y++) if (alpha[y * w + x] > 0) count++
  return count
}

function hexOf(rgb: readonly [number, number, number]): string {
  const byte = (v: number) => v.toString(16).toUpperCase().padStart(2, '0')
  return '#' + byte(rgb[0]) + byte(rgb[1]) + byte(rgb[2])
}

type CellRecord = {
  index: number
  dir: string
  window: { x0: number; x1: number }
  img: HTMLImageElement | null
  bbox: { x: number; y: number; w: number; h: number } | null
  content: number
  keyedFirst: number
  keyedLast: number
  finalFirst: number
  finalLast: number
}

/**
 * A strip -> N frames. Every threshold has a measured default and an override;
 * the fit and the gutter verdict always come back in `meta`, pass or fail, so a
 * caller can tell "the grid itself is bad" from "the rescue did not work".
 */
export async function planStripFrames(
  stripDataUrl: string,
  opts: StripFramesOptions
): Promise<{ frames: string[]; meta: StripFramesMeta }> {
  if (!opts || !Array.isArray(opts.dirs) || opts.dirs.length === 0) {
    throw new Error('strip-frames: opts.dirs must name at least one direction')
  }
  const dirs = opts.dirs.slice()
  const cells = opts.cells === undefined ? dirs.length : opts.cells
  if (!Number.isInteger(cells) || cells < 1) throw new Error(`strip-frames: cells must be a positive integer, got ${cells}`)
  const cell = opts.cell === undefined ? 512 : opts.cell
  if (!Number.isInteger(cell) || cell < 1) throw new Error(`strip-frames: cell must be a positive integer, got ${cell}`)
  const fill = opts.fill === undefined ? FRAME_FILL : opts.fill
  const presetName = opts.preset || 'binary'
  const keyOpts: ChromaKeyOptions = { ...resolvePreset(presetName), ...(opts.key || {}) }

  const counters: Record<string, number> = {}
  for (let i = 0; i < COUNTER_KEYS.length; i++) counters[COUNTER_KEYS[i]] = 0

  // 1. Decode once. Every measurement below reads this one buffer.
  const strip = await loadImage(stripDataUrl)
  const w = strip.width
  const h = strip.height
  const source = context2d(canvasOf(w, h))
  source.imageSmoothingEnabled = false
  source.drawImage(strip, 0, 0)
  const buf = source.getImageData(0, 0, w, h).data

  // 2. The field colour, sampled off the corners. Two real strips measured
  //    #FD05FA and #FC06FA — nothing here may assume pure magenta.
  const fieldRgb = sampleFieldRgb(buf, w, h)
  const field = {
    rgb: [fieldRgb[0], fieldRgb[1], fieldRgb[2]] as [number, number, number],
    hex: hexOf(fieldRgb),
    cast: magentaCast(fieldRgb),
    preset: presetName,
  }

  // 3. The fit — Phase 2's search, never a constant.
  const fit = fitPanelGrid(columnProfile(buf, w, h, fieldRgb), { cells, ...(opts.fit || {}) })

  // 4. `phase` is a MODULAR representative: the search scans [0, spacing), so a
  //    naive origin puts the last cell out of bounds (8px on the fixture) and
  //    silently drops a frame. Slide the lattice left just enough to fit all
  //    `cells` windows. Slack at the edges is fine; a lost cell is not.
  const overflow = Math.max(0, Math.ceil((fit.phase + cells * fit.spacing - w) / fit.spacing))
  const origin = fit.phase - fit.spacing * overflow
  const bounds: number[] = []
  for (let j = 0; j <= cells; j++) bounds.push(Math.min(w, Math.max(0, Math.round(origin + j * fit.spacing))))

  // 5. Slice by hand. `sliceImageGrid` would rescale the strip to `cols × cell`.
  const records: CellRecord[] = []
  for (let i = 0; i < cells; i++) {
    const x0 = bounds[i]
    const x1 = bounds[i + 1]
    const dir = dirs[i] === undefined ? String(i) : dirs[i]
    if (x1 - x0 < 2) {
      counters.empty++
      continue
    }
    const cw = x1 - x0
    const sliceCtx = context2d(canvasOf(cw, h))
    sliceCtx.imageSmoothingEnabled = false
    sliceCtx.drawImage(strip, x0, 0, cw, h, 0, 0, cw, h)
    const cellUrl = sliceCtx.canvas.toDataURL('image/png')

    // 6. key -> border -> isolate, each best-effort and each counted.
    const keyed = await chromaKeyToAlpha(cellUrl, keyOpts)
    counters.keyed++
    const keyedAlpha = await alphaOf(keyed)
    const corners = [
      keyedAlpha.alpha[0],
      keyedAlpha.alpha[cw - 1],
      keyedAlpha.alpha[(h - 1) * cw],
      keyedAlpha.alpha[cw * h - 1],
    ]
    if (corners[0] > 0 && corners[1] > 0 && corners[2] > 0 && corners[3] > 0) counters.fieldSurvived++

    let bordered = keyed
    try {
      const trimmed = await removeFrameBorder(keyed, opts.border)
      if (trimmed !== keyed) counters.borderTrimmed++
      bordered = trimmed
    } catch (e) {
      counters.borderFailed++
    }

    let isolated = bordered
    try {
      const split = await isolatePrimarySpriteComponent(bordered)
      if (split !== bordered) counters.isolated++
      isolated = split
    } catch (e) {
      counters.isolateFailed++
    }

    const before = await alphaOf(bordered)
    const after = await alphaOf(isolated)
    if (isolated !== bordered) {
      for (let p = 0; p < after.alpha.length; p++) {
        if (before.alpha[p] > 0 && after.alpha[p] === 0) counters.isolatedPx++
      }
    }

    let minX = cw
    let minY = h
    let maxX = -1
    let maxY = -1
    let content = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < cw; x++) {
        const a = after.alpha[y * cw + x]
        if (a === 0) continue
        content++
        if (a <= CONTENT_ALPHA) continue
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
    const empty = maxX < 0
    if (empty) counters.empty++

    records.push({
      index: i,
      dir,
      window: { x0, x1 },
      img: after.img,
      bbox: empty ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
      content,
      keyedFirst: opaqueInColumn(keyedAlpha.alpha, cw, h, 0),
      keyedLast: opaqueInColumn(keyedAlpha.alpha, cw, h, cw - 1),
      finalFirst: opaqueInColumn(after.alpha, cw, h, 0),
      finalLast: opaqueInColumn(after.alpha, cw, h, cw - 1),
    })
  }

  // 7. Gate, first level — occupancy across every INTERIOR cut of the windows
  //    actually used. This counts alpha AFTER keying (`keyed`) and after the
  //    rescue (`after`); the fit's `cutLines[].mass` is a different quantity
  //    measured on the source profile.
  const tolerance = Math.max(1, Math.round(fit.medianMass * (opts.fit && opts.fit.gutterRatio !== undefined ? opts.fit.gutterRatio : GUTTER_RATIO)))
  const lines: { x: number; keyed: number; after: number }[] = []
  const unrescued: number[] = []
  for (let j = 1; j < records.length; j++) {
    const left = records[j - 1]
    const right = records[j]
    const keyed = Math.max(left.keyedLast, right.keyedFirst)
    const after = Math.max(left.finalLast, right.finalFirst)
    lines.push({ x: right.window.x0, keyed, after })
    if (keyed > tolerance && after <= tolerance) counters.rescued++
    if (after > tolerance) unrescued.push(right.window.x0)
  }
  const gutterOk = unrescued.length === 0

  // 8. Gate, second level. The first level alone has a measured hole: with a
  //    threshold nothing clears at, the whole cell stays solid and
  //    `removeFrameBorder` blanks the sampled edge columns anyway, so `after`
  //    reads 0 and a solid magenta strip passes. A cell whose four corners are
  //    STILL opaque after keying is a cell keying never touched.
  const ok = gutterOk && counters.fieldSurvived === 0 && counters.empty === 0

  // 9. Trim + box + centre, only once the strip is known good — no half a set.
  const frames: string[] = []
  const frameMeta: StripFramesMeta['frames'] = []
  if (ok) {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]
      const bbox = rec.bbox as { x: number; y: number; w: number; h: number }
      const box = fitBox({ bw: bbox.w, bh: bbox.h }, cell, fill)
      const target = canvasOf(cell, cell)
      const ctx = context2d(target)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(rec.img as HTMLImageElement, bbox.x, bbox.y, bbox.w, bbox.h, box.x, box.y, box.w, box.h)
      counters.scaled += box.scale < 1 ? 1 : 0
      counters.centred++
      frames.push(target.toDataURL('image/png'))
      frameMeta.push({
        index: rec.index,
        dir: rec.dir,
        window: rec.window,
        bbox,
        scale: box.scale,
        out: { w: box.w, h: box.h, x: box.x, y: box.y },
        margins: { l: box.x, r: cell - box.x - box.w, t: box.y, b: cell - box.y - box.h },
        content: rec.content,
      })
    }
  }

  return {
    frames,
    meta: {
      ok,
      cells,
      cell,
      preset: presetName,
      dirs,
      fitted: {
        spacing: fit.spacing,
        phase: fit.phase,
        residual: fit.residual,
        residualPct: fit.residualPct,
        medianMass: fit.medianMass,
        trials: fit.trials,
        gutterOk: fit.gutterOk,
        cutLines: fit.cutLines.map((line) => ({ x: line.x, mass: line.mass })),
      },
      field,
      windows: records.map((rec) => ({ x0: rec.window.x0, x1: rec.window.x1 })),
      gutter: { ok: gutterOk, tolerance, lines, unrescued },
      counters,
      frames: frameMeta,
    },
  }
}
